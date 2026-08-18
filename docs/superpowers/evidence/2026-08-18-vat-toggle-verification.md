# VAT Registration Toggle — Verification Evidence

**Date:** 2026-08-19
**Branch:** `claude/codex-vat-toggle-68a2c1`
**Spec:** [2026-08-18-vat-registration-toggle-design.md](../specs/2026-08-18-vat-registration-toggle-design.md)
**Plan:** [2026-08-18-vat-registration-toggle.md](../plans/2026-08-18-vat-registration-toggle.md)
**Authorized test database:** Kids Corner, project ref `lfjfccxqlkhetbbcicjb`

## Scope of this session

Tasks 1–4 (the database ledger, transaction-time VAT freezing, snapshot-driven
reports, and the migration applied to the test database) were completed and
committed on `codex/vat-toggle` in a prior session and merged here. This session
completed the remaining plan tasks:

| Task | Area | Commit |
| --- | --- | --- |
| 4 (remainder) | FK-index migration checked in, catch-up regen incl. `private` schema, types | `6cbca25` |
| 5 | Owner-only VAT Settings card + policy read service | `d4a1f36` |
| 6 | Till bootstrap / sale detail frozen-VAT contracts | `c7b28ec` |
| 7 | Browser receipts, sale detail, return screens from frozen VAT | `4f0f1b0` |
| 8 | Android VAT models + queue serialization | `ff0f5be` |
| 9 | Android basket / payment / shift UI policy-aware | `d4d2064` |
| 10 | Android receipts, credit notes, Z reports from snapshots | `cfad71c` |
| 11 | Android policy refresh before trading, frozen checkout | `4a0283e` |
| 12 | Gallery states, verification, evidence | _this commit_ |

## Database (against the authorized test project)

The migration and both follow-ups are present on the remote and checked in:

- `20260818090000_vat_registration_policies` — the ledger, snapshots, and RPCs.
- `20260818194018_index_vat_policy_foreign_keys` — the advisor's unindexed-FK
  fix (recovered from the remote ledger and checked in this session).

SQL acceptance suites run through the linked project connector, all passing:

```
supabase db query --linked -f supabase/tests/vat_policy.sql    # asserts pass, rolled back
supabase db query --linked -f supabase/tests/vat_ledger.sql    # asserts pass, rolled back
supabase db query --linked -f supabase/tests/vat_reports.sql   # asserts pass, rolled back
```

Advisors (security + performance) show **no new** findings against the VAT
objects beyond the platform-wide `authenticated_security_definer_function`
notice that every RPC in this schema already carries — the two VAT RPCs
(`set_vat_policy`, `complete_sale_keyed_at_policy`) are intentionally
SECURITY DEFINER and granted only to `authenticated`, revoked from `anon`.

`supabase/catch-up.sql` was regenerated from the live schema (now emitting the
`private` helper schema the VAT reports call into) — object counts: **30 tables,
4 views, 42 functions, 46 policies**, `anon_can_execute` **0**.

## Web quality gates

```
npm test        # 44 files, 381 tests passing
npm run typecheck  # clean
npm run lint       # clean
npm run build      # succeeds; every route compiles
```

## Android quality gates

Working directory `till-android`:

```
./gradlew.bat :app:testDebugUnitTest   # full unit suite passing
./gradlew.bat :app:lintDebug           # see result below
./gradlew.bat :app:assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

New Android test classes: `VatPolicyCompatibilityTest`, `VatUiPolicyTest`,
`VatPolicySyncTest`, `CreditNoteTest`, plus VAT cases added to `ReceiptTest`,
`ZReportTest`, `MoneyTest`, `OfflineGateTest`.

## Emulator QA — deterministic gallery states

The debug `GalleryActivity` gained nine deterministic VAT states, each built
through the **real** screens and document builders (no hard-coded text), with
historical samples deliberately carrying a current-vs-frozen VAT-number mismatch
so misuse is visible:

```
sellVatOff  sellVatOn  paymentVatOff  paymentVatOn
receiptVatOff  receiptVatOn  creditVatOff  creditVatOn  zMixedVat
```

Launch a state with:

```
adb shell am start -n mu.kidscorner.till/.debug.GalleryActivity -e screen receiptVatOn
```

Built and installed on AVD `kids_corner_till_15` (`adb install -r`), then each
state launched cold (`am force-stop` between launches so the screen extra is
re-read) and screen-captured. Verified:

- **receiptVatOn** — document header **VAT INVOICE KC-00412**; `excl. VAT :
  1604.78Rs`; `VAT : 240.72Rs`; `excl. VAT = 1604.78Rs / Incl. tax = 1845.50Rs`.
- **receiptVatOff** — same sale, header **RECEIPT KC-00412**, same `Total:
  1845.50Rs`, and **no** exclusive line, VAT breakdown or registration number.
- **creditVatOn** — **VAT CREDIT NOTE** No. CN0007; `VAT reversed : 73.79Rs`;
  `VAT number : 20123456` — the **frozen** number, though the shop identity
  passed in carried `VAT-CURRENT-99`, proving the document reads the snapshot.
- **sellVatOff** — the basket TOTAL shows no `incl. VAT` line at all, versus the
  enabled screen which prints `incl. VAT 15% …` beneath it.

Screenshots captured to the session scratch dir (not committed).

## What still needs the owner's credentials (release handoff)

The end-to-end back-office → till acceptance sequence (Plan Task 12 step 7)
requires signing into the back office as an owner to actually toggle VAT, which
needs the owner's password and must not be automated. It should be run by the
shop owner against the test database before production release:

1. Confirm Settings shows **VAT disabled · Rate saved at 15%**.
2. Ring a disabled sale — basket and payment show no VAT wording; receipt says
   **Receipt** with no VAT number.
3. Enable VAT with a clearly-fake test number; confirm one Activity entry.
4. Refresh the till, ring a new sale — 15% contained VAT, **VAT Invoice**, the
   test number.
5. Reprint the first sale — still a non-VAT **Receipt**.
6. Disable VAT; confirm one more Activity entry.
7. Reprint the enabled sale — still a **VAT Invoice** with its frozen number.
8. Return the enabled sale while disabled — credit note reverses the 15% VAT.
9. Close/read a mixed shift — total turnover plus only the frozen VAT bands.
10. Queue a sale offline under a known policy, toggle the server, reconnect —
    the queued sale keeps its original policy; the next sale uses the new one.
11. Verify browser receipt/history, VAT return, daily summary, journal, P&L,
    and CSV/XLSX for the same records.

## Release coordination

Because old Android builds always labelled receipts **VAT INVOICE**, the new APK
and the server/schema release must be coordinated: install the updated APK
before the owner relies on the disabled state in daily trading. Production VAT
must remain **disabled** until both the schema/server and the updated APK are
deployed. Do not apply the production migration or enable VAT as part of
emulator acceptance.
