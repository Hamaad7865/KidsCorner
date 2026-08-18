# VAT Registration Toggle Design

**Date:** 2026-08-18  
**Status:** Approved in conversation; awaiting written-spec review  
**Scope:** Back-office Settings, Supabase sale and purchase ledgers, Android till, receipts, credit notes, Z/X reports, and management reports

## Purpose

Kids Corner is not VAT registered yet. The owner needs one global, owner-only control that keeps VAT disabled now and can activate VAT later without changing shelf prices or rewriting history.

The configured VAT rate defaults to 15%. Disabling VAT does not replace that rate with 0%; it changes the shop's registration status. When VAT is enabled, VAT is extracted from VAT-inclusive prices. When it is disabled, the same customer-facing totals contain no VAT.

## Approved business rules

- VAT is disabled by default.
- The saved VAT rate defaults to 15%.
- Enabling VAT requires a non-empty VAT registration number.
- Enabling or disabling affects new activity only.
- A completed sale, received purchase, credit note, receipt, and closed Z report retain the VAT policy used when that event occurred.
- A return reverses the VAT frozen on the original sale, regardless of the current setting.
- Historical receipts and reports never change because the current setting changes.
- VAT status changes are owner-only and recorded in Activity with the actor and timestamp.
- Switching VAT does not add to or subtract from shelf prices or transaction totals. It changes only the VAT portion contained in those totals.

## Terminology

- **Configured rate:** The rate saved for the next VAT-enabled policy, initially 15%.
- **Effective rate:** The rate used by a transaction. It is 0% when VAT is disabled and the configured rate when enabled.
- **VAT policy:** An immutable version containing enabled/disabled status, configured rate, VAT number, activation time, and actor.
- **Frozen VAT snapshot:** The enabled status, effective rate, VAT number where relevant, and VAT amount stored on a business event.

## Source of truth and policy history

The current state remains available through the existing `settings` model:

- `vat_enabled`: boolean, seeded `false`;
- `vat_rate`: numeric fraction, seeded or preserved as `0.15`;
- `vat_number`: text, blank until the shop is registered.

An immutable `vat_policies` table records each state version. Its rows contain an ID, enabled status, configured rate, VAT number snapshot, creation timestamp, and the owner who made the change. The latest policy is the current transaction policy. Keeping explicit policy versions solves two problems that a single mutable setting cannot:

1. offline Android sales can carry the exact policy they showed and printed; and
2. historical events can prove which status and rate produced their VAT amount.

The owner action updates the current settings and creates a policy version atomically. It rejects activation when the VAT number is blank or the rate is outside 0–100%, and it rejects calls from non-owners. The action also writes the existing `setting.changed` audit event.

## Back-office Settings experience

Settings gains a dedicated VAT card, separate from general shop and payment settings.

### Disabled state

- Status: **VAT disabled** / **Not VAT registered**.
- Supporting text: new sales and purchases record no VAT; saved rate is retained.
- VAT rate field defaults to 15% and remains editable by the owner.
- VAT number field may be prepared in advance.
- Primary action: **Enable VAT**.
- The confirmation explains that new sales, receipts, returns, purchases, and reports will use VAT from activation onward.
- Activation validates and saves the rate and VAT number in the same atomic action.

### Enabled state

- Status: **VAT active · 15%** (using the configured rate).
- The saved VAT number is displayed.
- VAT details can be saved without changing status; saving a new rate creates a new policy for future activity.
- Secondary/destructive action: **Disable VAT**.
- The confirmation explains that new activity will contain no VAT while historical VAT records remain unchanged.
- Disabling retains the configured rate and VAT number for later reactivation.

Managers may view the status but only owners may edit or toggle it. Buttons show pending state, prevent duplicate submissions, surface validation errors, and confirm success with a toast. Settings, dashboard, reports, receipt routes, and till bootstrap caches are revalidated after a change.

## Transaction snapshots

### Sales

Each sale freezes:

- VAT policy ID;
- VAT enabled status;
- effective VAT rate;
- VAT registration number when enabled; and
- calculated VAT amount.

The database sale function remains authoritative for totals and VAT. It uses a verified policy version, not client-provided booleans or numeric rates. Disabled sales store `vat_amount = 0`; enabled sales extract VAT using `round(total - total / (1 + rate), 2)`.

Existing sales are backfilled as VAT-enabled under the pre-toggle behavior so their current receipts and reports remain unchanged. Their rate is the configured pre-migration rate and their VAT number snapshot is the value present at migration time.

### Credit notes and returns

A credit note never reads the current VAT setting. It derives the refundable VAT from the original sale snapshot and the actual paid share being returned. A non-VAT sale therefore produces a non-VAT credit note even after activation; a VAT sale produces a VAT credit note even after VAT is disabled.

The credit note freezes its own source policy ID, enabled status, rate, VAT number, and VAT amount. Existing credit notes are backfilled consistently with their source sales.

### Purchases

VAT is frozen when a purchase becomes **received**, because that is when it enters stock and the supplier invoice becomes reportable. Each received purchase stores policy ID, enabled status, effective rate, and VAT amount. Purchases received while VAT is disabled store zero input VAT. A purchase created while disabled but received after activation uses the policy active at receipt time.

Existing received purchases are backfilled using the old 15%-inclusive report behavior so historical VAT reports do not change during migration. Future VAT reports read the frozen purchase VAT amount rather than deriving all purchases at today's rate.

## Android behavior and offline sales

Till bootstrap returns:

- `vatEnabled`;
- `vatRate` (configured rate);
- `effectiveVatRate`;
- `vatPolicyId`; and
- the policy VAT number.

The till stores this policy with its cached bootstrap. It refreshes bootstrap on startup, reconnect, cashier unlock, periodically while online, and immediately before payment confirmation. If an online refresh finds a newer policy, the basket's VAT display is recalculated; the payable total does not change because prices are VAT-inclusive.

An offline device cannot receive a setting change that happened after it disconnected. In that unavoidable case, it continues with its last successfully synced policy. The queued sale stores the policy ID and local checkout timestamp alongside its existing idempotent payload, and the receipt uses that same frozen policy. When the queue syncs, the server resolves that immutable policy and stores it on the sale instead of silently applying a newer policy. On reconnection, the till refreshes the current policy before the next new sale.

No queued payload is rewritten after checkout. The migration creates a legacy VAT-enabled policy before creating the new current disabled policy. Older queued rows created before this feature carry no policy ID, so the server assigns them that legacy policy and preserves the VAT behavior under which they were checked out.

## Receipts and customer documents

Receipt rendering uses the sale snapshot, never current settings.

| Sale snapshot | Receipt behavior |
| --- | --- |
| VAT disabled | Title **Receipt**, no VAT registration number, no “VAT included”, “excl. VAT”, or VAT breakdown lines |
| VAT enabled | Title **VAT Invoice**, frozen VAT registration number, effective rate, net amount, and contained VAT breakdown |

This applies to Android thermal printing, reprints, the browser receipt page, and sale-history detail. A VAT-enabled zero-total sale still remains a VAT invoice because status is explicit rather than inferred from `vat_amount > 0`.

Credit-note output follows the source sale snapshot. Z reports and X reads include non-VAT turnover in totals but include only VAT-enabled transactions in VAT bands. A report spanning a status change may legitimately contain both non-VAT turnover and VAT bands. Closed Z reports remain frozen exactly as today.

## Management reports

- Sales journals and P&L use the frozen sale and credit-note VAT amounts.
- VAT returns include output VAT only from VAT-enabled sales/credit notes and input VAT only from VAT-enabled received purchases.
- Disabling VAT does not hide the VAT report; the owner may still need historical returns. The current period shows zero new VAT activity after disablement.
- CSV/XLSX exports use the same frozen fields as the screens.
- Existing date ranges retain their pre-migration totals through backfill.

## Error handling and consistency

- Missing VAT number while enabling: block activation with a field-level error.
- Invalid rate: block saving or activation.
- Concurrent owner changes: the atomic policy function serializes the current-policy update and produces one ordered version per successful change.
- Android policy changes during an online checkout: refresh and recalculate the VAT display before confirming; total remains unchanged.
- Unknown or deleted policy ID in a sale request: reject the sale without changing stock or payments. Policy rows are immutable and not deletable through the application.
- Partial settings update: impossible; current settings, policy version, and audit-visible result commit or roll back together.

## Security and permissions

- Only active owners may create a VAT policy or alter VAT settings.
- Managers and other authenticated staff may read the current status needed for screens and reports but cannot mutate it.
- Android receives policy data only through authenticated till APIs.
- The client never supplies its own arbitrary VAT rate or VAT amount. It supplies the immutable policy ID it previously received; the server resolves the stored values.
- New exposed tables use RLS. Mutation policies and any RPC grants are restricted to the minimum roles required.

## Migration and rollout

The migration:

1. captures a legacy VAT-enabled policy using the pre-migration rate and VAT number;
2. seeds `vat_enabled = false` while preserving/defaulting `vat_rate = 0.15`, then creates the current disabled policy;
3. adds frozen VAT fields to sales, credit notes, and purchases;
4. backfills historical events and pre-feature queued-sale fallback behavior against the legacy policy to preserve existing output;
5. replaces sale, credit-note, purchase-receipt, and report paths to use snapshots; and
6. updates the catch-up schema and generated application types.

Because old Android builds always label receipts as VAT invoices, the new APK and server/schema release must be coordinated. The updated APK must be installed before the owner relies on the disabled state in daily trading. The test database may be migrated and exercised freely before production release.

## Testing and acceptance criteria

### Database and server

- Migration defaults to disabled with a configured rate of 15%.
- Non-owner toggle attempts fail.
- Activation without a VAT number fails atomically.
- Disabled and enabled sales keep identical totals but store zero vs extracted VAT.
- A return reverses the original sale VAT under both opposite-current-status cases.
- Purchases freeze zero or 15%-inclusive VAT at receipt time.
- Existing rows and historical report totals remain unchanged after backfill.
- Repeating an idempotent or queued sale preserves its original policy.

### Back office

- Status, buttons, confirmations, validation, audit entries, and owner permissions are covered by component and action tests.
- Receipt and report tests cover enabled, disabled, historical, zero-total, mixed-period, and export cases.

### Android

- Bootstrap/cache serialization covers both statuses and older cached data.
- Basket VAT is zero and all VAT labels disappear while disabled.
- Enabled basket and receipts show 15% and the VAT number.
- A queued offline sale retains its policy after a later toggle.
- Reconnect refreshes the policy before another sale.
- Emulator QA performs one disabled sale/receipt and one enabled sale/receipt, then verifies historical reprints and a return across the toggle.

## Non-goals

- Multiple simultaneous tax rates or product-specific tax classes.
- VAT-exclusive shelf pricing.
- Automatic MRA registration or filing.
- Changing historical transaction VAT because the current setting changes.
- Guessing whether an individual supplier is VAT registered; this remains a future purchase-invoice enhancement.
