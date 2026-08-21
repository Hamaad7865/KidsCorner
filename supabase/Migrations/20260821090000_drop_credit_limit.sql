-- ═══════════════════════════════════════════════════════════════════════════
-- Credit accounts lose their numeric limit
--
-- The owner does not want to manage a per-customer ceiling. A credit account is
-- now simply OPEN or not: a known customer the shop is willing to let run a tab,
-- with no figure capping how much that tab may reach. Judgement replaces the
-- number — the shop already knows who it will and will not extend credit to.
--
-- What DOESN'T change: credit is still a tender only a named customer can use,
-- an account can still be put on hold, and the balance is still the sum of the
-- append-only ledger and nothing else. Only the ceiling — and the arithmetic
-- that policed it (`available`, the over-limit refusal) — goes away.
--
-- ── THE GATE MOVES FROM AN AMOUNT TO A FLAG ────────────────────────────────
--
-- `credit_limit > 0` used to carry two meanings at once: "has an account" and
-- "may owe up to this much". Dropping the ceiling would leave `0 = no account`
-- resting on a column whose only other value is meaningless, so the "has an
-- account" question moves to its own boolean, `credit_enabled`, and the amount
-- stops being consulted anywhere.
--
-- `credit_limit` itself is LEFT in place, unused, rather than dropped: removing
-- a column is destructive and irreversible, the figures on it are the shop's
-- own history of what it once allowed, and nothing reads it any more. It is
-- marked deprecated so a future reader knows it is inert.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the flag ────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Every customer who had a limit had an account; carry them over unchanged.
UPDATE customers SET credit_enabled = TRUE
  WHERE credit_limit > 0 AND credit_enabled = FALSE;

COMMENT ON COLUMN customers.credit_enabled IS
  'Whether the shop has opened a credit account for this customer. The single '
  'gate now: an open account may run a tab of any size, subject only to the '
  'on-hold flag.';
COMMENT ON COLUMN customers.credit_limit IS
  'DEPRECATED and unused since the credit ceiling was removed. Kept only as a '
  'record of the limits the shop once set. The account gate is credit_enabled.';

-- ── the view gains the flag, and KEEPS the retired columns for now ──────────
--
-- `credit_enabled` is added, but `credit_limit` and `available` STAY in the
-- view on purpose. The credit feature is already deployed and its running code
-- — the back office and the tablet's /api/till/customers — still selects those
-- two columns. Dropping them here would 500 that live code the instant this
-- migration ran, before the code that stops reading them is deployed. They are
-- kept as an expand-then-contract bridge: this migration expands (adds the
-- flag), the app switches to the flag, and a later migration may contract
-- (drop the columns) once nothing reads them. `available` is still computed the
-- old way so the currently-deployed till keeps behaving until it updates.
--
-- Columns are being added in the middle, which CREATE OR REPLACE VIEW cannot
-- do, so the view is dropped and rebuilt. `security_invoker` is preserved per
-- migration 034 — the view must read with the caller's own permissions.

DROP VIEW IF EXISTS public.customer_credit_accounts;

CREATE VIEW public.customer_credit_accounts
WITH (security_invoker = true) AS
SELECT
    c.id                                   AS customer_id,
    c.full_name,
    c.phone,
    c.credit_enabled,
    c.credit_limit,
    c.credit_terms_days,
    c.credit_on_hold,
    coalesce(l.balance, 0)::numeric(12,2)  AS balance,
    -- Deprecated alongside credit_limit; kept only so the currently-deployed
    -- till, which still reads it, does not error before it updates.
    greatest(
        0,
        c.credit_limit - coalesce(l.balance, 0)
    )::numeric(12,2)                       AS available,
    l.oldest_due_on,
    l.last_activity_at,
    coalesce(l.charge_count, 0)            AS charge_count
FROM customers c
LEFT JOIN (
    SELECT
        customer_id,
        sum(amount)                                             AS balance,
        min(due_on) FILTER (WHERE entry_type = 'charge')         AS oldest_due_on,
        max(created_at)                                         AS last_activity_at,
        count(*) FILTER (WHERE entry_type = 'charge')            AS charge_count
    FROM customer_credit_entries
    GROUP BY customer_id
) l ON l.customer_id = c.id;

COMMENT ON VIEW public.customer_credit_accounts IS
  'One row per customer, whether or not they have an account. Filter on '
  'credit_enabled or balance <> 0 for the ones that matter. credit_limit and '
  'available are deprecated and retained only as a bridge for already-deployed '
  'code — an open account has no ceiling any more.';

-- Rebuilding the view dropped its grants; restore them exactly as migration
-- 20260820100000 set them.
GRANT SELECT ON public.customer_credit_accounts TO authenticated;
REVOKE ALL ON public.customer_credit_accounts FROM anon;

-- ── the trigger stops policing a ceiling ────────────────────────────────────
--
-- Same guarantee as before minus one clause: a credit tender still needs a
-- customer, still needs an OPEN account, and is still refused on a held one —
-- but the "would this pass the limit?" check is gone, because there is no
-- limit. The advisory lock stays: it was there to serialise the balance read
-- for the ceiling check, and while the ceiling is gone the lock is harmless and
-- keeps concurrent charges to one account writing their ledger rows in order.

CREATE OR REPLACE FUNCTION public.credit_payment_charges_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_sale     public.sales%rowtype;
    v_customer public.customers%rowtype;
begin
    if new.method <> 'credit' then
        return new;
    end if;

    select * into v_sale from public.sales where id = new.sale_id;
    if not found then
        raise exception 'Sale % does not exist', new.sale_id;
    end if;

    -- The rule that makes the whole feature safe. A credit tender is a promise
    -- by a named person; with no customer on the sale there is nobody to bill
    -- and the money would simply vanish from the reconciliation.
    if v_sale.customer_id is null then
        raise check_violation using
            message = 'A sale on account needs a customer attached to it';
    end if;

    -- Serialised per customer, so concurrent charges to one account write their
    -- ledger rows in a defined order.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('customer_credit:' || v_sale.customer_id::text)
    );

    select * into v_customer from public.customers where id = v_sale.customer_id;

    if not v_customer.credit_enabled then
        raise check_violation using
            message = pg_catalog.format(
                '%s does not have a credit account', v_customer.full_name
            );
    end if;
    if v_customer.credit_on_hold then
        raise check_violation using
            message = pg_catalog.format(
                '%s''s account is on hold', v_customer.full_name
            );
    end if;

    insert into public.customer_credit_entries (
        customer_id, entry_type, amount, sale_payment_id, sale_id,
        due_on, created_by, reason
    ) values (
        v_sale.customer_id,
        'charge',
        new.amount,
        new.id,
        new.sale_id,
        -- Frozen from the terms in force today, so changing a customer's terms
        -- next month does not silently re-age debt already on the books.
        (v_sale.sale_date AT TIME ZONE 'Indian/Mauritius')::date
            + v_customer.credit_terms_days,
        v_sale.cashier_id,
        'Sale ' || v_sale.sale_no
    )
    on conflict (sale_payment_id) do nothing;

    return new;
end;
$function$;

-- ── prove the flag and the view, in a transaction that rolls back ───────────

DO $$
DECLARE
    v_customer  int;
    v_balance   numeric;
    v_enabled   boolean;
BEGIN
    -- The view must expose the new flag. (The deprecated columns stay as a
    -- bridge for deployed code, so they are deliberately NOT asserted gone.)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customer_credit_accounts' AND column_name = 'credit_enabled'
    ) THEN
        RAISE EXCEPTION 'the view does not expose credit_enabled';
    END IF;

    BEGIN
        INSERT INTO customers (full_name, phone, credit_enabled, credit_terms_days)
        VALUES ('Credit probe', NULL, TRUE, 14)
        RETURNING id INTO v_customer;

        -- A charge far larger than any limit the shop ever set must simply land:
        -- there is no ceiling to refuse it.
        INSERT INTO customer_credit_entries
            (customer_id, entry_type, amount, due_on, reason)
        VALUES (v_customer, 'charge', 5000000, CURRENT_DATE + 14, 'probe charge');

        SELECT balance, credit_enabled INTO v_balance, v_enabled
        FROM customer_credit_accounts WHERE customer_id = v_customer;

        IF v_balance <> 5000000 THEN
            RAISE EXCEPTION 'balance read %, expected 5000000', v_balance;
        END IF;
        IF NOT v_enabled THEN
            RAISE EXCEPTION 'view reported the account closed';
        END IF;

        RAISE NOTICE 'credit_enabled gate and uncapped balance both behave';
        RAISE EXCEPTION 'rollback the probe';
    EXCEPTION
        WHEN others THEN
            IF sqlerrm <> 'rollback the probe' THEN RAISE; END IF;
            RAISE NOTICE 'probe rolled back; no probe customer remains';
    END;
END $$;
