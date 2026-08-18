-- Applied to the test project (lfjfccxqlkhetbbcicjb) on 2026-08-18 as version
-- 20260818194018 in response to the performance advisor's unindexed-foreign-key
-- findings on the new VAT snapshot columns. Recovered from the remote migration
-- ledger so the checked-in history matches what the database actually ran.
begin;

create index idx_sales_vat_policy_id
    on public.sales (vat_policy_id);

create index idx_credit_notes_vat_policy_id
    on public.credit_notes (vat_policy_id);

create index idx_purchases_vat_policy_id
    on public.purchases (vat_policy_id);

create index idx_vat_policies_created_by
    on public.vat_policies (created_by);

commit;
