-- ═══════════════════════════════════════════════════════════════════════════
-- Credit customers — the shop's account book, kept in the database
--
-- The owner wants to let known customers take goods now and settle later. In a
-- Mauritian neighbourhood shop that is an old arrangement written in a paper
-- exercise book, and the reason to move it here is not tidiness: the book has
-- no idea what anyone's limit is, two people writing in it at once lose an
-- entry, and nothing reconciles it against the till.
--
-- ── WHY 'credit' IS A TENDER AND NOT A SECOND KIND OF SALE ─────────────────
--
-- A sale on account is a completed sale. The goods leave, stock moves, the VAT
-- is due, the receipt prints. The only unusual thing is that the money has not
-- arrived. So it is recorded the way every other tender is — a `sale_payments`
-- row — with method 'credit'.
--
-- That choice is what keeps `commitSale`'s central invariant intact: payments
-- must sum to exactly the sale total, no more and no less. A credit row for
-- the unpaid remainder satisfies it, which means a deposit works for free:
-- Rs 200 cash + Rs 300 credit is a Rs 500 sale, half paid, half owed, with no
-- special case anywhere in the pricing path.
--
-- The alternative — an "unpaid sale" with no payment rows — would have meant
-- teaching every report, every Z, and both tills that a sale might not balance.
--
-- ── WHY 'credit' IS **NOT** ADDED TO settings.payment_methods ──────────────
--
-- Migration 040 drew the distinction this migration depends on. The CHECK
-- constraint is the vocabulary the ledger is written in; `settings.payment_
-- methods` is what the shop offers today, and both tills build their tender
-- tiles from it. 'credit' joins the FIRST list and stays out of the SECOND,
-- which is a deliberate refusal, not an omission.
--
-- Adding it to the settings list would put a tile on the tablet at the next
-- sync with no code change — and no gate. Every other tender is
-- unconditional: cash is cash whoever is standing there. Credit is the only
-- one that is illegal without an attached customer, refusable because of a
-- limit, and refusable because of who the customer is. A tile the server can
-- switch on but not qualify would let a cashier put Rs 8,000 on the account of
-- a walk-in nobody, so the affordance is written into the tills explicitly and
-- shown only when a real account backs it.
--
-- The same list also feeds the refund-method picker, so keeping 'credit' out
-- of it stops "refund to account" appearing on a cash sale, where it would be
-- meaningless.
--
-- ── WHAT IS TRUTH HERE ─────────────────────────────────────────────────────
--
-- `customer_credit_entries` is an append-only ledger and it is the balance.
-- There is no `customers.balance` column, on purpose: a cached figure is a
-- second truth, and the one thing worse than not knowing what a customer owes
-- is confidently knowing the wrong number. A balance is `sum(amount)` and
-- nothing else, which is cheap at shop scale and cannot drift.
--
-- Signs are fixed and enforced: POSITIVE increases what the customer owes,
-- NEGATIVE reduces it. A charge is positive, a settlement negative. Nothing is
-- ever updated or deleted — a mistake is corrected by an 'adjustment' that
-- says so, so the history of an account survives being wrong.
--
-- ── WHAT ENFORCES IT ───────────────────────────────────────────────────────
--
-- A trigger on `sale_payments`, not application code. `lib/pos/sale-core.ts`
-- checks the same rules first and produces the sentence the cashier reads, but
-- the database refuses a credit payment with no customer, on a dormant
-- account, or over the limit regardless of which client wrote it. The limit
-- check takes an advisory lock on the customer so two tills selling to the
-- same person at the same moment cannot both find room under it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the vocabulary grows ────────────────────────────────────────────────────
--
-- 'credit' means "billed to the customer's account". It only ever grows, for
-- the reason 040 gives: a receipt reprinted next year has to render it.

ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('cash', 'card', 'juice', 'myt_money', 'bank', 'credit'));

COMMENT ON CONSTRAINT sale_payments_method_check ON sale_payments IS
  'Every method the ledger has ever been written in. Only grows — retiring a '
  'method is a change to settings.payment_methods, not to this. ''credit'' is '
  'in here and deliberately NOT in that list: it needs a customer and a limit, '
  'so the tills gate it explicitly rather than drawing it from settings.';

-- A return against an account sale must be able to go back to the account.
--
-- Refunding cash for money the shop never received is the obvious wrong
-- answer, and before this it was the ONLY answer: a customer who bought Rs
-- 1,000 on account and returned the lot would have been handed Rs 1,000 in
-- notes while still owing the original Rs 1,000.
ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_refund_method_check;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_refund_method_check
  CHECK (refund_method IN
    ('cash', 'card', 'juice', 'myt_money', 'bank', 'exchange', 'credit'));

-- ── who is allowed an account ───────────────────────────────────────────────
--
-- Nobody, until an owner says so. `credit_limit` defaults to 0 and 0 means "no
-- account" rather than "an account with no room" — the two are the same
-- refusal at the till, and one column carrying both keeps a customer from
-- being half-enrolled.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_terms_days INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS credit_on_hold BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credit_limit_check;
ALTER TABLE customers ADD CONSTRAINT customers_credit_limit_check
  CHECK (credit_limit >= 0);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credit_terms_check;
ALTER TABLE customers ADD CONSTRAINT customers_credit_terms_check
  CHECK (credit_terms_days BETWEEN 0 AND 365);

COMMENT ON COLUMN customers.credit_limit IS
  'Most this customer may owe at once. 0 means no account at all.';
COMMENT ON COLUMN customers.credit_terms_days IS
  'Days from a charge until it is due. Drives the aging report, not a refusal.';
COMMENT ON COLUMN customers.credit_on_hold IS
  'Suspends new charges without forgetting the limit or the history.';

-- ── the ledger ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_credit_entries (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     INT NOT NULL REFERENCES customers(id),
    entry_type      TEXT NOT NULL CHECK (entry_type IN
                    ('charge', 'settlement', 'refund', 'adjustment', 'writeoff')),

    -- Signed. Positive increases what is owed, negative reduces it. Never zero:
    -- an entry that moves nothing is noise in an account statement.
    amount          NUMERIC(12,2) NOT NULL CHECK (amount <> 0),

    -- The credit tender that created a charge. UNIQUE, which is what makes the
    -- trigger idempotent: a replayed sale cannot bill the account twice,
    -- because the payment row it would bill against already has its entry.
    sale_payment_id BIGINT UNIQUE REFERENCES sale_payments(id) ON DELETE CASCADE,
    sale_id         BIGINT REFERENCES sales(id) ON DELETE CASCADE,

    -- The return that credited the account back. UNIQUE for the same reason.
    credit_note_id  BIGINT UNIQUE REFERENCES credit_notes(id) ON DELETE CASCADE,

    -- How a settlement was actually paid. Never 'credit' — an account cannot
    -- be settled with more of itself.
    method          TEXT CHECK (method IS NULL OR method IN
                    ('cash', 'card', 'juice', 'myt_money', 'bank')),

    -- The drawer a settlement was taken into, when it was taken at a till.
    shift_id        INT REFERENCES shifts(id),

    reason          TEXT,

    -- Set on a charge only: when the shop expects to be paid. Aging is measured
    -- from this, so it is frozen at the terms in force on the day of the sale
    -- rather than recomputed from today's terms.
    due_on          DATE,

    created_by      UUID REFERENCES profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Sign discipline, so a "settlement" can never be the thing that grows a
    -- debt. Only an adjustment may go either way, which is the whole point of
    -- there being an adjustment.
    CONSTRAINT customer_credit_entries_sign_check CHECK (
        CASE entry_type
            WHEN 'charge'     THEN amount > 0
            WHEN 'settlement' THEN amount < 0
            WHEN 'refund'     THEN amount < 0
            WHEN 'writeoff'   THEN amount < 0
            ELSE TRUE
        END
    ),

    -- A settlement is money arriving, so it must say how it arrived.
    --
    -- Named for the rule and not the column: Postgres already auto-names the
    -- inline `method` check `customer_credit_entries_method_check`, and reusing
    -- that spelling here collides with it.
    CONSTRAINT customer_credit_entries_settlement_method_check CHECK (
        entry_type <> 'settlement' OR method IS NOT NULL
    )
);

COMMENT ON TABLE customer_credit_entries IS
  'Append-only. A customer''s balance is sum(amount) over these rows and is '
  'stored nowhere else. Corrections are new ''adjustment'' rows, never edits.';

CREATE INDEX IF NOT EXISTS idx_credit_entries_customer
    ON customer_credit_entries (customer_id, created_at DESC);

-- Serves the aging report, which only ever asks about unsettled charges.
CREATE INDEX IF NOT EXISTS idx_credit_entries_due
    ON customer_credit_entries (due_on)
    WHERE entry_type = 'charge';

-- ── the balance ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.customer_credit_balance(p_customer_id integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT coalesce(pg_catalog.sum(amount), 0)::numeric(12,2)
    FROM public.customer_credit_entries
    WHERE customer_id = p_customer_id;
$function$;

COMMENT ON FUNCTION public.customer_credit_balance(integer) IS
  'What the customer owes right now. Positive = owes the shop. Negative = the '
  'shop holds credit for them, which a return to account can legitimately do.';

-- Every account, with the arithmetic already done.
--
-- `security_invoker` per migration 034: the view must read with the caller's
-- own permissions, so it cannot become a way around the tables' RLS.
CREATE OR REPLACE VIEW public.customer_credit_accounts
WITH (security_invoker = true) AS
SELECT
    c.id                                   AS customer_id,
    c.full_name,
    c.phone,
    c.credit_limit,
    c.credit_terms_days,
    c.credit_on_hold,
    coalesce(l.balance, 0)::numeric(12,2)  AS balance,
    -- What is still spendable. Never negative: an account over its limit has no
    -- room, and reporting "-450 available" invites a client to treat it as a
    -- number to add to.
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
  'credit_limit > 0 or balance <> 0 for the ones that matter.';

-- ── charging an account ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.credit_payment_charges_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_sale     public.sales%rowtype;
    v_customer public.customers%rowtype;
    v_balance  numeric(12,2);
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

    -- Serialised per customer. Two tills ringing up the same account at the
    -- same instant would otherwise both read the pre-sale balance, both find
    -- room under the limit, and between them exceed it.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('customer_credit:' || v_sale.customer_id::text)
    );

    select * into v_customer from public.customers where id = v_sale.customer_id;

    if v_customer.credit_limit <= 0 then
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

    v_balance := public.customer_credit_balance(v_sale.customer_id);

    if v_balance + new.amount > v_customer.credit_limit then
        raise check_violation using
            message = pg_catalog.format(
                '%s owes %s of a %s limit — this sale needs %s more',
                v_customer.full_name,
                pg_catalog.to_char(v_balance, 'FM999999990.00'),
                pg_catalog.to_char(v_customer.credit_limit, 'FM999999990.00'),
                pg_catalog.to_char(new.amount, 'FM999999990.00')
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
    -- The sale RPC replays a completed sale by idempotency key rather than
    -- re-inserting its payments, so this should never fire. It is here because
    -- "should never" and "cannot" are different things when the row means money.
    on conflict (sale_payment_id) do nothing;

    return new;
end;
$function$;

DROP TRIGGER IF EXISTS credit_payment_charges_account ON sale_payments;
CREATE TRIGGER credit_payment_charges_account
    AFTER INSERT ON sale_payments
    FOR EACH ROW
    EXECUTE FUNCTION public.credit_payment_charges_account();

-- ── returning against an account ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.credit_note_credits_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_customer_id integer;
    v_sale_no     text;
begin
    if new.refund_method <> 'credit' then
        return new;
    end if;

    select customer_id, sale_no into v_customer_id, v_sale_no
    from public.sales
    where id = new.sale_id;

    if v_customer_id is null then
        raise check_violation using
            message = 'Only a sale with a customer can be refunded to an account';
    end if;

    -- Negative, so it reduces what is owed. Allowed to take the balance below
    -- zero: a customer who has already settled and then returns goods is owed
    -- money by the shop, and that is a fact the ledger should be able to state
    -- rather than round away to nothing.
    insert into public.customer_credit_entries (
        customer_id, entry_type, amount, credit_note_id, sale_id,
        created_by, reason
    ) values (
        v_customer_id,
        'refund',
        -new.total,
        new.id,
        new.sale_id,
        new.cashier_id,
        'Credit note ' || new.credit_no || ' against ' || v_sale_no
    )
    on conflict (credit_note_id) do nothing;

    return new;
end;
$function$;

DROP TRIGGER IF EXISTS credit_note_credits_account ON credit_notes;
CREATE TRIGGER credit_note_credits_account
    AFTER INSERT ON credit_notes
    FOR EACH ROW
    EXECUTE FUNCTION public.credit_note_credits_account();

-- ── voiding an account sale ─────────────────────────────────────────────────
--
-- A void says the sale never happened. The charge it raised has to go with it,
-- and it goes as a reversing entry rather than a deletion so the account
-- statement still shows that something was rung up and undone.

CREATE OR REPLACE FUNCTION public.void_sale_reverses_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_charge public.customer_credit_entries%rowtype;
begin
    if new.status <> 'void' or old.status = 'void' then
        return new;
    end if;

    for v_charge in
        select * from public.customer_credit_entries
        where sale_id = new.id and entry_type = 'charge'
    loop
        -- Skipped if this charge has already been reversed, so voiding twice
        -- cannot credit the account twice.
        if not exists (
            select 1 from public.customer_credit_entries
            where sale_id = new.id
              and entry_type = 'adjustment'
              and reason = 'Void of sale ' || new.sale_no
        ) then
            insert into public.customer_credit_entries (
                customer_id, entry_type, amount, sale_id, created_by, reason
            ) values (
                v_charge.customer_id,
                'adjustment',
                -v_charge.amount,
                new.id,
                v_charge.created_by,
                'Void of sale ' || new.sale_no
            );
        end if;
    end loop;

    return new;
end;
$function$;

DROP TRIGGER IF EXISTS void_sale_reverses_credit ON sales;
CREATE TRIGGER void_sale_reverses_credit
    AFTER UPDATE OF status ON sales
    FOR EACH ROW
    EXECUTE FUNCTION public.void_sale_reverses_credit();

-- ── taking a payment against an account ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.settle_customer_credit(
    p_customer_id integer,
    p_amount      numeric,
    p_method      text,
    p_shift_id    integer DEFAULT NULL,
    p_reason      text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_customer public.customers%rowtype;
    v_balance  numeric(12,2);
    v_amount   numeric(12,2) := pg_catalog.round(coalesce(p_amount, 0), 2);
    v_entry_id bigint;
begin
    if v_amount <= 0 then
        raise check_violation using
            message = 'A payment has to be more than nothing';
    end if;
    if p_method is null or p_method not in
        ('cash', 'card', 'juice', 'myt_money', 'bank') then
        raise check_violation using
            message = 'A payment on account needs a real payment method';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('customer_credit:' || p_customer_id::text)
    );

    select * into v_customer from public.customers where id = p_customer_id;
    if not found then
        raise exception 'Customer % does not exist', p_customer_id;
    end if;

    v_balance := public.customer_credit_balance(p_customer_id);

    if v_balance <= 0 then
        raise check_violation using
            message = pg_catalog.format(
                '%s does not owe anything', v_customer.full_name
            );
    end if;

    -- Refused rather than clamped. Over-paying an account is nearly always a
    -- mistyped figure, and silently accepting it would leave the shop holding
    -- money it has no record of a reason for. The cashier is told the balance
    -- and can take exactly it.
    if v_amount > v_balance then
        raise check_violation using
            message = pg_catalog.format(
                '%s only owes %s',
                v_customer.full_name,
                pg_catalog.to_char(v_balance, 'FM999999990.00')
            );
    end if;

    insert into public.customer_credit_entries (
        customer_id, entry_type, amount, method, shift_id, reason, created_by
    ) values (
        p_customer_id,
        'settlement',
        -v_amount,
        p_method,
        p_shift_id,
        nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
        pg_catalog.current_setting('request.jwt.claim.sub', true)::uuid
    )
    returning id into v_entry_id;

    -- Cash handed over at a till is in that drawer, and the drawer has to
    -- expect it at close. `record_till_movement` is the existing machinery for
    -- "money arrived that was not a sale", so this reuses it rather than
    -- inventing a second path into expected cash — and it refuses a closed
    -- shift for free.
    --
    -- A cash payment taken with NO shift (an owner in the back office) writes
    -- no movement: it never entered a till, and claiming it did would make some
    -- drawer short by exactly this amount.
    if p_method = 'cash' and p_shift_id is not null then
        perform public.record_till_movement(
            p_shift_id,
            v_amount,
            'Account payment — ' || v_customer.full_name
        );
    end if;

    return pg_catalog.jsonb_build_object(
        'entry_id',    v_entry_id,
        'balance',     public.customer_credit_balance(p_customer_id),
        'settled',     v_amount,
        'customer_id', p_customer_id
    );
end;
$function$;

COMMENT ON FUNCTION public.settle_customer_credit(integer, numeric, text, integer, text) IS
  'Records money received against an account. Cash with a shift also writes a '
  'till movement so the drawer expects it.';

-- ── writing debt off ────────────────────────────────────────────────────────
--
-- Some debts are never collected. Without a way to say so the only options are
-- to leave the aging report permanently wrong or to fake a payment that never
-- happened — and a faked settlement would put money into a cash report that no
-- drawer ever held.

CREATE OR REPLACE FUNCTION public.write_off_customer_credit(
    p_customer_id integer,
    p_amount      numeric,
    p_reason      text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_balance  numeric(12,2);
    v_amount   numeric(12,2) := pg_catalog.round(coalesce(p_amount, 0), 2);
    v_entry_id bigint;
begin
    -- Owner only, and checked here rather than left to RLS: this function is
    -- SECURITY DEFINER, so it runs with privileges that ignore the policies on
    -- the table it writes.
    if public.current_role_of_user() <> 'owner' then
        raise insufficient_privilege using
            message = 'Only an owner can write off a debt';
    end if;

    if v_amount <= 0 then
        raise check_violation using message = 'A write-off needs an amount';
    end if;
    if coalesce(pg_catalog.btrim(p_reason), '') = '' then
        raise check_violation using
            message = 'A write-off needs a reason on the record';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('customer_credit:' || p_customer_id::text)
    );

    v_balance := public.customer_credit_balance(p_customer_id);
    if v_amount > v_balance then
        raise check_violation using
            message = pg_catalog.format(
                'Only %s is owed', pg_catalog.to_char(v_balance, 'FM999999990.00')
            );
    end if;

    insert into public.customer_credit_entries (
        customer_id, entry_type, amount, reason, created_by
    ) values (
        p_customer_id,
        'writeoff',
        -v_amount,
        pg_catalog.btrim(p_reason),
        pg_catalog.current_setting('request.jwt.claim.sub', true)::uuid
    )
    returning id into v_entry_id;

    return pg_catalog.jsonb_build_object(
        'entry_id', v_entry_id,
        'balance',  public.customer_credit_balance(p_customer_id)
    );
end;
$function$;

-- ── who may read and run what ───────────────────────────────────────────────
--
-- Read for every signed-in member of staff: a cashier has to be able to see
-- what someone owes before putting more on the account. No INSERT, UPDATE or
-- DELETE policy at all — the only ways in are the triggers and the two
-- functions above, all SECURITY DEFINER, which is what makes "append-only"
-- true rather than merely intended.

ALTER TABLE customer_credit_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON customer_credit_entries;
CREATE POLICY read_all ON customer_credit_entries
    FOR SELECT TO authenticated
    USING (true);

GRANT SELECT ON public.customer_credit_entries TO authenticated;
GRANT SELECT ON public.customer_credit_accounts TO authenticated;

-- Migration 035's rule: `anon` is what the publishable key maps to, and it has
-- no business reaching any of this.
REVOKE ALL ON public.customer_credit_entries FROM anon;
REVOKE ALL ON public.customer_credit_accounts FROM anon;

REVOKE ALL ON FUNCTION public.customer_credit_balance(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.settle_customer_credit(integer, numeric, text, integer, text)
    FROM public, anon;
REVOKE ALL ON FUNCTION public.write_off_customer_credit(integer, numeric, text)
    FROM public, anon;

GRANT EXECUTE ON FUNCTION public.customer_credit_balance(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_customer_credit(integer, numeric, text, integer, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_off_customer_credit(integer, numeric, text)
    TO authenticated;

-- The trigger functions are reached only by the triggers, never called
-- directly. Nothing needs EXECUTE on them.
REVOKE ALL ON FUNCTION public.credit_payment_charges_account() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_note_credits_account() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_sale_reverses_credit() FROM public, anon, authenticated;

-- ── prove it ────────────────────────────────────────────────────────────────
--
-- Exercised for real against a throwaway customer, then rolled back, in the
-- style migration 040 set. A migration that only creates objects has not shown
-- that they behave.

DO $$
DECLARE
    v_customer  int;
    v_balance   numeric;
    v_result    jsonb;
BEGIN
    -- The constraint has to accept the new value before anything else matters.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sale_payments_method_check'
          AND pg_get_constraintdef(oid) LIKE '%credit%'
    ) THEN
        RAISE EXCEPTION 'sale_payments still refuses a credit tender';
    END IF;

    BEGIN
        INSERT INTO customers (full_name, phone, credit_limit, credit_terms_days)
        VALUES ('Credit probe', NULL, 1000, 14)
        RETURNING id INTO v_customer;

        -- A charge, as the sale trigger would write it.
        INSERT INTO customer_credit_entries
            (customer_id, entry_type, amount, due_on, reason)
        VALUES (v_customer, 'charge', 600, CURRENT_DATE + 14, 'probe charge');

        v_balance := customer_credit_balance(v_customer);
        IF v_balance <> 600 THEN
            RAISE EXCEPTION 'balance read %, expected 600', v_balance;
        END IF;

        -- The view has to agree, and report the room left.
        SELECT available INTO v_balance
        FROM customer_credit_accounts WHERE customer_id = v_customer;
        IF v_balance <> 400 THEN
            RAISE EXCEPTION 'available read %, expected 400', v_balance;
        END IF;

        -- Sign discipline: a settlement that INCREASES a debt is not a thing.
        BEGIN
            INSERT INTO customer_credit_entries
                (customer_id, entry_type, amount, method)
            VALUES (v_customer, 'settlement', 50, 'cash');
            RAISE EXCEPTION 'a positive settlement was accepted';
        EXCEPTION
            WHEN check_violation THEN NULL;
        END;

        -- A settlement with no method is money from nowhere.
        BEGIN
            INSERT INTO customer_credit_entries (customer_id, entry_type, amount)
            VALUES (v_customer, 'settlement', -50);
            RAISE EXCEPTION 'a settlement with no method was accepted';
        EXCEPTION
            WHEN check_violation THEN NULL;
        END;

        -- Paying more than is owed is refused, not clamped.
        BEGIN
            PERFORM settle_customer_credit(v_customer, 900, 'cash');
            RAISE EXCEPTION 'an over-payment was accepted';
        EXCEPTION
            WHEN check_violation THEN NULL;
        END;

        -- And a real payment lands, with no shift, so no till movement.
        v_result := settle_customer_credit(v_customer, 250, 'cash', NULL, 'probe');
        IF (v_result->>'balance')::numeric <> 350 THEN
            RAISE EXCEPTION 'balance after settling read %, expected 350',
                v_result->>'balance';
        END IF;

        RAISE NOTICE 'credit ledger, view, sign checks and settlement all behave';
        RAISE EXCEPTION 'rollback the probe';
    EXCEPTION
        WHEN others THEN
            IF sqlerrm <> 'rollback the probe' THEN RAISE; END IF;
            RAISE NOTICE 'probe rolled back; no probe customer remains';
    END;
END $$;
