# Exchange Refund and Idempotency Design

**Date:** 2026-08-26
**Status:** Approved in conversation; awaiting written-spec review
**Scope:** Supabase `create_exchange`/`create_credit_note`, the till's `/api/till/exchange` route, the Android `ExchangeScreen`/`TillViewModel`, and `ReceiptBuilder`

## Purpose

Today the till's Exchange screen only lets a customer trade up: if the replacement item(s) cost more than the credit for what came back, the customer pays the gap. If the replacement costs *less*, `create_exchange` refuses the whole exchange and tells the cashier to process the difference through the separate Returns screen instead.

This splits one customer interaction into two receipts and two mental models for no reason the shop cares about. The fix: let the exchange screen settle the gap in either direction — the customer pays when the replacement costs more, the shop pays back when it costs less — using the same "settle by" payment-method picker that already exists.

Investigating a live error message surfaced a second, unrelated bug worth fixing in the same pass: `/api/till/exchange` has no idempotency protection, so a lost response after a successful exchange invites the cashier to retry, which then fails validation with a confusing raw SQL message. That gap gets closed here too, mirroring the sale-checkout flow's existing idempotency key.

## Non-goals

- **Store credit.** The refund leaves the shop as real money (cash/card/bank/Juice) through the existing settle-method picker, not as account credit. Kids Corner's `customer_credit_entries` ledger is a separate feature and is untouched.
- **Refund-size approval gate.** The existing manager-approval flow only gates on the *original sale's age* (>7 days). No new approval threshold is introduced for the refunded amount.
- **"Select any variant."** Already works — the replacement search in `ExchangeScreen` already searches the whole catalogue by name/SKU, not just siblings of the returned item. No change.
- **Receipt reconciliation for the credit portion.** The exchange's new-sale receipt has never shown the credit-note value that covers part of its total (only the gap payment prints as a tender) — that's a pre-existing simplification and stays out of scope here.
- **Idempotency for `/api/till/refund`.** It has the same missing-key gap as `/api/till/exchange`, but fixing it is not part of this exchange-focused change. Worth a follow-up.

## 1. Bidirectional settlement in `create_exchange`

`v_gap := round(v_new_subtotal - v_credit_subtotal, 2)` is already computed. The only structural change is deleting the block that raises when it's negative:

```sql
IF v_gap < 0 THEN
    RAISE EXCEPTION 'The replacement items cost MUR % less...';
END IF;
```

`v_gap` then flows into the single `sale_payments` row already written for the exchange's new sale, unchanged in shape — it already only records the *gap*, never the new sale's full total (that's true today for the trade-up case too: a customer paying Rs 60 on top of a Rs 140 credit toward a Rs 200 replacement gets one `sale_payments` row of Rs 60, not Rs 200). Letting `amount` go negative is a direct extension of that existing shape, not a new concept.

`tendered` (used only to compute cash change back to a paying customer) is only meaningful when the customer is the one handing over cash:

```sql
tendered = CASE
    WHEN p_payment_method = 'cash' AND v_gap > 0
        THEN coalesce(p_tendered, v_gap)
    ELSE NULL
END
```

For a refund leg (`v_gap <= 0`) or any non-cash method, `tendered` is always `NULL` — there is no "change" concept on a payout, and leaving it non-null there would make the receipt's change math run backwards.

`credit_notes.refund_method` keeps its current hardcoded value of `'exchange'` in both directions — nothing here needs to distinguish a trade-up credit note from a trade-down one for reporting purposes (see the Z-report section below for why that's safe).

The route's request validation (`paymentMethod === "cash" && tendered == null` → 400) is removed. The route cannot know the sign of the gap without re-running the pricing/capping logic that only `create_exchange` is allowed to own, so this check moves into the SQL default above (`coalesce(p_tendered, v_gap)` — "assume exact cash, no change" when the till doesn't send one).

## 2. Z-report / cash-drawer accounting

`z_totals` needs **no changes**. Its existing cash math already nets signed `sale_payments.amount`:

```sql
v_cash_in := sum(sp.amount) WHERE sp.method = 'cash'  -- across ALL of the shift's sales
expected_cash := opening_float + v_cash_in + v_movements - v_cash_refund
```

A negative `amount` on the exchange's new-sale payment row (cash refund leg) reduces `v_cash_in` by exactly the amount that left the drawer — the same arithmetic effect as subtracting it from `v_cash_refund` directly, achieved for free. `v_methods`' per-method breakdown already computes `count` as `sum(sign(amount))` specifically so a negative line contributes `-1` rather than inflating the tally — a comment already in the code anticipates this exact shape of data, so this is completing a design that was already half-built, not bolting on something foreign.

`v_cash_refund` (which sums `credit_notes.total` where `refund_method = 'cash'`) is untouched and stays irrelevant to exchanges: `refund_method` stays `'exchange'` on both trade-up and trade-down credit notes, so exchange credit notes never enter that sum, regardless of gap sign. Double-counting is structurally impossible, not just avoided by convention.

## 3. Idempotency

Mirrors `complete_sale_keyed` (migration 011) exactly, reusing infrastructure it already built:

- **No new column.** The exchange's replacement item is itself a row in `sales`, which already has `idempotency_key` and its partial unique index from migration 011.
- **New `create_exchange_keyed(p_key TEXT, ...)`** wraps the existing `create_exchange`:
  - `p_key IS NULL OR btrim(p_key) = ''` → calls `create_exchange` directly (old/unkeyed behavior preserved for any caller that doesn't send one).
  - Otherwise: `pg_advisory_xact_lock(hashtext(p_key))`, then check `sales.idempotency_key = p_key`. A hit returns the existing sale id without re-running anything (no re-validation of the 7-day window, no second credit note) — a deliberate replay, exactly as `complete_sale_keyed` treats a repeated sale key. A miss runs `create_exchange` and stamps the key onto the resulting sale row.
- **`/api/till/exchange`** accepts `idempotencyKey` in its body schema and calls `create_exchange_keyed` instead of `create_exchange`.
- **Android** gets a `private var exchangeKey: String = UUID.randomUUID().toString()` field on `TillViewModel`, following the exact pattern already used for `saleKey`/`collectKey`/`topUpKey`. `submitExchange` sends it as `ExchangeRequest.idempotencyKey`. It rotates to a fresh UUID **only after a successful exchange** (mirroring `collectKey`'s reset at its own success branch) — a business-rule refusal (wrong quantity, gap validation, etc.) never wrote a row under that key, so it's safe and correct to retry the *same* key with corrected inputs; only a definite success invalidates it for reuse.
- `retryExchange` (the existing manager-approval retry path) needs no change — it already replays the stored `pendingExchange` request verbatim, which will now carry the same key.

## 4. Error wording

`create_exchange`'s and `create_credit_note`'s matching validation both raise:

```
Only % of line % can still come back (% sold, % already returned)
```

`%2` is `sale_item.id` — an internal primary key ("line 332") that means nothing at a till. Both call sites gain a cheap lookup of the product name (`product_variants → products`) at the point the check fails, and the message becomes:

```
Only 0 left of "Graphic tee" to exchange (1 sold, 1 already returned)
```

(`create_credit_note`'s parallel message swaps "to exchange" for "to return".) This is a pure wording fix — the refusal itself is correct and stays a refusal in both directions; a fully-returned/exchanged line still can't be touched again.

## 5. Android — `ExchangeScreen`

- **Label:** "CUSTOMER PAYS" → "REFUND TO CUSTOMER" when `gap < 0`. The big figure always shows `abs(gap)`, never clamped to zero (today's `gap.coerceAtLeast(0.0)` would silently show "Rs 0.00" for a refund, which is wrong).
- **Deleted:** the red "The credit is bigger than the replacements. Give the change back through Return instead." block, and the "Replacements cost less than the credit" blocked-button state — both describe a case that no longer exists.
- **`ready`** drops the `gap >= 0` requirement; a negative gap is now a valid, submittable state as long as something is coming back and something is going out.
- **"CASH GIVEN" input** only renders when `gap > 0 && method == "cash"` — it has no meaning on a payout leg (nothing is being tendered by the customer).
- **Bottom button** always shows `abs(gap)`, submits regardless of sign.

## 6. Toast wording and a latent bug fix

`TillViewModel`'s success toast (`"Exchanged — ${formatRs(response.gap ?: 0.0)} taken"`) always reads **"Rs 0.00 taken"** today, because `/api/till/exchange`'s response never actually sets `gap` (`{ ok: true, saleId: newSaleId }`) — `ExchangeResponse.gap` silently defaults to `null` on every successful exchange that has ever run. Found while wiring the toast to the new bidirectional wording; fixed in the same change:

- `route.ts` does one cheap follow-up read after a successful `create_exchange_keyed` call: `sum(sale_payments.amount) WHERE sale_id = newSaleId`, and returns it as `gap` (signed).
- The toast branches on sign: `"Exchanged — Rs X taken"` / `"Exchanged — even swap"` / `"Exchanged — Rs X given back"`.

## 7. Receipt

`ReceiptBuilder`'s tender loop currently prints `"${count}   ${label} : ${amount}"` per payment method group. A negative group sum (a refund leg) would print as `1   CASH : Rs -100.00`, which reads as a mistake on a printed customer receipt. The loop gains one branch: when a group's summed amount is negative, it prints `"${count}   ${label} REFUND : ${abs(amount)}"` instead. No other section of the receipt changes — the sale's own `total`/VAT lines are always the new items' price, unaffected by which direction the gap ran.

## Testing

- SQL: extend `supabase/tests` (wherever the existing exchange/credit-note tests live) with a trade-down case — replacement cheaper than credit, asserting `sale_payments.amount < 0`, `tendered IS NULL`, and that `z_totals(shift_id)` for that shift reflects the reduced `cash_taken`/`expected_cash` correctly.
- SQL: a replay test for `create_exchange_keyed` — same key called twice returns the same sale id and writes only one credit note / one set of stock movements.
- Kotlin: `ExchangeScreen` — gap-negative state shows "REFUND TO CUSTOMER", hides "CASH GIVEN", and submits with `ready = true`.
- Manual: run one trade-down exchange end to end in the emulator (cash), confirm the receipt prints `... REFUND ...` rather than a negative figure, and that pressing "Exchange" a second time on the same still-open screen (simulating a lost response) does not error.
