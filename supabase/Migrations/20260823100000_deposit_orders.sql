-- ═══════════════════════════════════════════════════════════════════════════
-- Deposit orders — layaway, kept in the books
--
-- The shop's arrangement: a customer picks goods, puts money down, and comes
-- back — sometimes more than once — to pay the rest and take things home.
-- Until now that lived on paper and in a drawer, where nobody could see what
-- was held for whom, how long it had been sitting, or what had been paid.
--
-- ── THE SHAPE OF IT ────────────────────────────────────────────────────────
--
-- A deposit order is NOT a sale. The defining fact of a layaway is that the
-- goods stay in the shop: no sale has happened yet, so nothing is recorded in
-- `sales`, no VAT falls due, and the takings reports stay quiet about it.
-- What exists instead is three tables:
--
--   deposit_orders          the header: who, what status, collect-by date
--   deposit_order_items     the goods, with the PRICE FROZEN at deposit time
--   deposit_order_payments  an append-only ledger of money in and back out
--
-- The sale is written on PICKUP, per visit, covering whatever items the
-- customer takes that day (`sales.deposit_order_id` links it back). That is
-- when the goods leave, which is when this shop's revenue happens — the same
-- reasoning 20260820100000 applied to credit, read in reverse: there the
-- goods left before the money; here the money may arrive before the goods.
--
-- ── WHY THE PRICE FREEZES AT DEPOSIT ───────────────────────────────────────
--
-- A layby is a quote the customer has paid against. Re-pricing at pickup from
-- `product_variants.selling_price` — which is how `commitSale` treats a
-- normal basket — would let next month's price rise reach into an agreement
-- already part-paid, and the customer would be right to refuse it. So the
-- unit price and any line discount are copied onto the item rows when the
-- order opens, and pickup prices come FROM THOSE ROWS, never from the
-- catalogue again.
--
-- ── HOW STOCK RESERVES ─────────────────────────────────────────────────────
--
-- Taking the deposit writes a real stock movement per line — type
-- 'deposit_reserve' — through the same `record_stock_movement` RPC every
-- other flow uses. qty_on_hand drops immediately, which buys three things
-- for free:
--
--   1. Nobody else can sell those units — the `qty_on_hand >= 0` constraint
--      from migration 009 guards the reserve exactly as it guards a sale.
--   2. Both tills' catalogues show the truth without a code change: reserved
--      units are simply not on the shelf any more.
--   3. Low-stock views stay honest — units in a cupboard with a name on them
--      are not stock a shopper can buy.
--
-- Cancelling writes 'deposit_release' movements to put what was never
-- collected back. Pickup writes NO movement: the stock already left the
-- shelf when the order opened; handing it over moves nothing.
--
-- ── WHERE THE MONEY SITS UNTIL PICKUP ──────────────────────────────────────
--
-- Deposit cash is real notes in a real drawer, so it must be expected at
-- close. It travels by `record_till_movement` — the exact path a settlement
-- on account takes (20260820100000) — labelled "Deposit <no> — <customer>",
-- so z_totals folds it into expected_cash and lists it by reason.
-- Card/Juice/my.t money deposits touch no drawer and write no movement,
-- exactly as their account-settlement twins do not.
--
-- At pickup the day's cash arrives as ordinary `sale_payments` rows on the
-- collecting shift, so the drawer expects it through the normal sales path.
-- Money ALREADY taken arrives as a payment row in method 'deposit' — a
-- tender meaning "received earlier under this order". It carries no cash of
-- its own: the notes were counted into a drawer on the day they came in, and
-- counting them again today would make some Z short by exactly that much.
--
-- 'deposit' joins the ledger vocabulary CHECK but deliberately NOT
-- settings.payment_methods, for the same reason 'credit' stays out of it
-- (see the long comment in 20260820100000): it is never an open tender a
-- cashier can pick. Only collect_deposit_order writes it, only ever against
-- the unallocated credit of the order being collected.
--
-- ── PARTIAL PICKUP AND THE CREDIT IT LEAVES BEHIND ─────────────────────────
--
-- Items are collected in any number of visits. Each item tracks its own
-- collected_qty, and each visit's charge is the frozen price of what was
-- actually taken. Line discounts split proportionally across visits, with
-- the final visit sweeping whatever rounding left behind, so a line's whole
-- discount lands once and only once.
--
-- Money paid but not yet converted into goods is "unallocated credit":
--
--     paid − refunded − sum(sale_payments.method = 'deposit' on live sales)
--
-- Refunds exist only at cancellation, and cancellation refunds ONLY the
-- unallocated part — money already turned into a pickup sale bought real
-- goods, and returns on those goods are a job for credit notes, not for
-- this feature. Because allocation reads the sale's own tender row, voiding
-- a pickup sale automatically releases its allocation back into refundable
-- credit: the invariant survives every path that already knows how to void.
--
-- ── WHAT ENFORCES IT ───────────────────────────────────────────────────────
--
-- Four SECURITY DEFINER RPCs are the only write paths; the tables carry RLS
-- with SELECT-only policies, mirroring the credit ledger. Every RPC
-- re-checks what its route checked: prices from the database, discounts
-- clamped, balances recomputed from the ledgers, shifts refused when closed.
-- Each one takes an advisory lock — on the idempotency key, or on the ORDER
-- row while mutating it — so two tills collecting or cancelling the same
-- layaway serialise instead of racing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the vocabulary grows ────────────────────────────────────────────────────

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN
    ('purchase', 'sale', 'adjustment', 'return', 'opening', 'import',
     'deposit_reserve', 'deposit_release'));

COMMENT ON CONSTRAINT stock_movements_movement_type_check ON stock_movements IS
  'deposit_reserve: units set aside under an open deposit order. '
  'deposit_release: reserved units returned to the shelf. Both are written '
  'only by the deposit RPCs, through record_stock_movement.';

ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('cash', 'card', 'juice', 'myt_money', 'bank', 'credit', 'deposit'));

COMMENT ON CONSTRAINT sale_payments_method_check ON sale_payments IS
  'Every method the ledger has ever been written in. Only grows. ''credit'' '
  '(20260820100000) bills an account; ''deposit'' covers money already taken '
  'under the deposit order named by sales.deposit_order_id — never an open '
  'tender, never in settings.payment_methods.';

-- One historical surprise: the live CHECK here reads ('sale','credit','z'),
-- wider than 027 wrote it — someone widened it by hand, and a single 'z'
-- counter row exists. Under the old next_doc_no an unknown kind fell into
-- the credit branch, so that 'z' row may stand behind issued CN numbers;
-- deleting it could re-issue one. It stays, and 'z' stays legal.
ALTER TABLE doc_counters DROP CONSTRAINT IF EXISTS doc_counters_kind_check;
ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_kind_check
  CHECK (kind IN ('sale', 'credit', 'deposit', 'z'));

-- One function, rewritten for three kinds. Same transactional counter, same
-- shop-clock day; 'D' joins the prefixes. An aborted create rolls its number
-- back with the transaction, exactly as 027 intended.
CREATE OR REPLACE FUNCTION public.next_doc_no(p_kind TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_day TEXT := to_char(now() AT TIME ZONE 'Indian/Mauritius', 'YYMMDD');
    v_n   INT;
BEGIN
    INSERT INTO doc_counters AS c (kind, day, n) VALUES (p_kind, v_day, 1)
    ON CONFLICT (kind, day) DO UPDATE SET n = c.n + 1
    RETURNING n INTO v_n;

    RETURN CASE p_kind
        WHEN 'sale'   THEN 'S'
        WHEN 'credit' THEN 'CN'
        ELSE               'D'
    END || v_day || '-' || v_n;
END;
$$;

-- ── the tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deposit_orders (
    id              BIGSERIAL PRIMARY KEY,

    -- 'D<YYMMDD>-<n>' on the shop's clock, gapless like every document.
    order_no        TEXT NOT NULL UNIQUE,

    -- A layaway without a name behind it is a shelf nobody can release, so a
    -- customer is NOT NULL — stricter than sales, where walk-ins exist.
    customer_id     INT NOT NULL REFERENCES customers(id),

    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'collected', 'cancelled')),

    total           NUMERIC(12,2) NOT NULL DEFAULT 0
                    CHECK (total >= 0),

    -- Optional promise date. Nothing expires automatically — an overdue
    -- deposit is flagged for staff to chase, not cancelled over the
    -- customer's head.
    collect_by      DATE,

    note            TEXT,

    created_shift_id INT REFERENCES shifts(id),
    cashier_id      UUID REFERENCES profiles(id),
    device_id       INT REFERENCES pos_devices(id),

    -- The manager who authorised money off, when a line carries a discount.
    -- Verified at the till boundary (the PIN never reaches the database);
    -- recorded here so a discounted layaway names who approved it, exactly as
    -- a sale's line discount is named in sale_discounts.approved_by.
    approved_by     UUID REFERENCES profiles(id),

    -- Names one create attempt, replay-safe like sales.idempotency_key.
    idempotency_key TEXT UNIQUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    collected_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID REFERENCES profiles(id),
    cancelled_reason TEXT,

    CONSTRAINT deposit_orders_lifecycle_check CHECK (
        (status = 'open'      AND collected_at IS NULL AND cancelled_at IS NULL)
     OR (status = 'collected' AND collected_at IS NOT NULL AND cancelled_at IS NULL)
     OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND collected_at IS NULL))
);

COMMENT ON TABLE deposit_orders IS
  'Layaway headers. Goods are reserved when the order opens and leave via a '
  'sale per pickup visit; money sits in deposit_order_payments until then. '
  'Status moves forward only; corrections are new rows in the child ledgers.';

-- Re-runnable, like the rest of this migration: the CREATE TABLE above defines
-- approved_by on a fresh database, and this reaches a deposit_orders that was
-- first created before the column existed.
ALTER TABLE deposit_orders ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_deposit_orders_customer
    ON deposit_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_orders_open
    ON deposit_orders (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_deposit_orders_collect_by
    ON deposit_orders (collect_by) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS deposit_order_items (
    id             BIGSERIAL PRIMARY KEY,
    order_id       BIGINT NOT NULL REFERENCES deposit_orders(id) ON DELETE CASCADE,
    variant_id     INT NOT NULL REFERENCES product_variants(id),

    -- Frozen label: product · size · colour as they read on deposit day, so
    -- slips print true even if the catalogue renames later.
    description    TEXT NOT NULL,

    qty            INT NOT NULL CHECK (qty > 0),
    collected_qty  INT NOT NULL DEFAULT 0,

    -- THE frozen price. Pickup charges read this, never selling_price.
    unit_price     NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    discount       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    discount_taken NUMERIC(10,2) NOT NULL DEFAULT 0,

    line_total     NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price - discount) STORED,

    CONSTRAINT deposit_items_collected_range CHECK (collected_qty BETWEEN 0 AND qty),
    CONSTRAINT deposit_items_discount_floor CHECK (
        unit_price * qty - discount >= 0),
    CONSTRAINT deposit_items_discount_taken_range CHECK (
        discount_taken >= 0 AND discount_taken <= discount)
);

COMMENT ON COLUMN deposit_order_items.unit_price IS
  'Frozen at deposit time. Price changes after this do not touch the order.';
COMMENT ON COLUMN deposit_order_items.discount_taken IS
  'How much of this line''s discount earlier pickups consumed. Splits '
  'proportionally per visit; the final visit sweeps the remainder.';

CREATE INDEX IF NOT EXISTS idx_deposit_items_order
    ON deposit_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_deposit_items_variant
    ON deposit_order_items (variant_id);

CREATE TABLE IF NOT EXISTS deposit_order_payments (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES deposit_orders(id) ON DELETE CASCADE,

    entry_type  TEXT NOT NULL CHECK (entry_type IN ('payment', 'refund')),

    -- Signed like customer_credit_entries: positive money in, negative back
    -- out. Never zero — an entry that moves nothing is noise.
    amount      NUMERIC(12,2) NOT NULL CHECK (amount <> 0),

    -- Real tenders only. An order cannot be paid with an account or with
    -- itself; 'deposit' as a SALE tender lives on sale_payments, not here.
    method      TEXT NOT NULL CHECK (method IN ('cash', 'card', 'juice', 'myt_money', 'bank')),

    -- The drawer the cash moved through, when it moved at a till.
    shift_id    INT REFERENCES shifts(id),
    till_movement_id BIGINT REFERENCES till_movements(id),

    -- Names one attempt, so a retried top-up cannot charge twice.
    idempotency_key TEXT UNIQUE,

    reason      TEXT,
    created_by  UUID REFERENCES profiles(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT deposit_payments_sign_check CHECK (
        CASE entry_type WHEN 'payment' THEN amount > 0 ELSE amount < 0 END),
    CONSTRAINT deposit_payments_cash_needs_drawer CHECK (
        method <> 'cash' OR shift_id IS NOT NULL)
);

COMMENT ON TABLE deposit_order_payments IS
  'Append-only. The order''s paid-so-far is sum(amount) over these rows; '
  'what pickups have claimed is read off their sale_payments rows, so the '
  'balance is stored nowhere else.';

CREATE INDEX IF NOT EXISTS idx_deposit_payments_order
    ON deposit_order_payments (order_id, created_at);

-- Pickups are ordinary sales with a pointer home. No cascade either way: the
-- sale stands on its own, and an order is never deleted.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_order_id BIGINT REFERENCES deposit_orders(id);
CREATE INDEX IF NOT EXISTS idx_sales_deposit_order
    ON sales (deposit_order_id) WHERE deposit_order_id IS NOT NULL;

COMMENT ON COLUMN sales.deposit_order_id IS
  'Set when this sale collected items from a deposit order. Its '
  'method=''deposit'' payment rows are that order''s allocation record.';

-- ═══════════════════════════════════════════════════════════════════════
-- Shared helper
-- ═══════════════════════════════════════════════════════════════════════

-- Unallocated credit on an order: money taken that no live pickup has
-- converted into goods. Voided pickup sales drop out of the allocation,
-- which is what makes their money refundable again after a void.
CREATE OR REPLACE FUNCTION public.deposit_unallocated_credit(p_order_id BIGINT)
RETURNS numeric(12,2)
LANGUAGE sql STABLE
SET search_path TO ''
AS $function$
    SELECT (
        (SELECT coalesce(sum(amount), 0) FROM public.deposit_order_payments
          WHERE order_id = p_order_id)
      -
        (SELECT coalesce(sum(sp.amount), 0)
           FROM public.sale_payments sp
           JOIN public.sales s ON s.id = sp.sale_id
          WHERE s.deposit_order_id = p_order_id
            AND s.status <> 'void'
            AND sp.method = 'deposit')
    )::numeric(12,2);
$function$;

COMMENT ON FUNCTION public.deposit_unallocated_credit(BIGINT) IS
  'Money taken under a deposit order that no completed pickup has claimed '
  'yet. Cancel refunds exactly this and no more.';

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 1 — open an order
-- ═══════════════════════════════════════════════════════════════════════
--
-- p_items   : [{"variant_id":1,"qty":2,"discount":0}] — PRICES COME FROM THE DB
-- p_payment : {"method":"cash","amount":200,"tendered":null} or NULL for a
--             zero-down reservation.

CREATE OR REPLACE FUNCTION public.create_deposit_order(
    p_key           TEXT,
    p_customer_id   INTEGER,
    p_items         JSONB,
    p_payment       JSONB DEFAULT NULL,
    p_collect_by    DATE DEFAULT NULL,
    p_note          TEXT DEFAULT NULL,
    p_shift_id      INTEGER DEFAULT NULL,
    p_cashier_id    UUID DEFAULT NULL,
    p_device_id     INTEGER DEFAULT NULL,
    p_approved_by   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_key        text := nullif(pg_catalog.btrim(p_key), '');
    v_existing   record;
    v_name       text;
    v_item       jsonb;
    v_variant_id integer;
    v_row        record;
    v_asked      integer;
    v_unit_price numeric(10,2);
    v_discount   numeric(10,2);
    v_gross      numeric(12,2);
    v_total      numeric(12,2) := 0;
    v_order_id   bigint;
    v_order_no   text;
    v_pay_method text;
    v_pay_amount numeric(12,2);
    v_move_id    bigint;
begin
    -- A replay belongs to the order already opened, whatever else the payload
    -- now says — same rule, same ordering, as complete_sale's key handling.
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_key));

        select id, order_no into v_existing
        from public.deposit_orders
        where idempotency_key = v_key;

        if found then
            return pg_catalog.jsonb_build_object(
                'order_id', v_existing.id, 'order_no', v_existing.order_no,
                'replayed', true);
        end if;
    end if;

    select full_name into v_name from public.customers where id = p_customer_id;
    if not found then
        raise check_violation using message = 'That customer does not exist.';
    end if;

    if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
       or pg_catalog.jsonb_array_length(p_items) = 0 then
        raise check_violation using message = 'A deposit needs at least one item.';
    end if;

    -- ── validate every line against the live catalogue ─────────────────
    --
    -- Prices are re-read here, ignoring whatever was posted: this function is
    -- reachable by any signed-in device, so a posted price is a claim, not a
    -- fact. Custom lines are refused outright — they move no stock, so there
    -- is nothing to hold in the cupboard.
    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_variant_id := (v_item->>'variant_id')::integer;
        if v_variant_id is null then
            raise check_violation using message =
                'Deposit lines must be catalogue items — custom lines have no stock to hold.';
        end if;

        select selling_price, qty_on_hand, pv.is_active,
               p.name as product_name
          into v_row
          from public.product_variants pv
          join public.products p on p.id = pv.product_id
         where pv.id = v_variant_id;

        if not found then
            raise check_violation using message =
                'An item in the deposit no longer exists. Clear it and rescan.';
        end if;
        if not v_row.is_active then
            raise check_violation using message =
                pg_catalog.format('%s has been retired and cannot be put on deposit.',
                    v_row.product_name);
        end if;

        -- Duplicates summed per variant, as complete_sale measures its cart,
        -- so 2 + 2 cannot slip past 3 units on the shelf.
        select coalesce(pg_catalog.sum((i->>'qty')::integer), 0) into v_asked
          from pg_catalog.jsonb_array_elements(p_items) i
         where (i->>'variant_id')::integer = v_variant_id;

        if v_asked > v_row.qty_on_hand then
            raise check_violation using message = pg_catalog.format(
                'Only %s of %s on the shelf — the deposit asks for %s.',
                v_row.qty_on_hand, v_row.product_name, v_asked);
        end if;
    end loop;

    -- ── open the header, then stamp its gapless number ──────────────────
    insert into public.deposit_orders (
        order_no, customer_id, status, total, collect_by, note,
        created_shift_id, cashier_id, device_id, idempotency_key, approved_by
    ) values (
        'pending-' || pg_catalog.gen_random_uuid()::text,
        p_customer_id, 'open', 0, p_collect_by,
        nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
        p_shift_id, coalesce(p_cashier_id, auth.uid()), p_device_id, v_key,
        p_approved_by
    ) returning id into v_order_id;

    update public.deposit_orders
       set order_no = public.next_doc_no('deposit')
     where id = v_order_id
    returning order_no into v_order_no;

    -- ── freeze the lines ────────────────────────────────────────────────
    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        select selling_price,
               p.name as product_name, s.label as size_label, c.name as colour_name
          into v_row
          from public.product_variants pv
          join public.products p on p.id = pv.product_id
          join public.sizes s on s.id = pv.size_id
          join public.colours c on c.id = pv.colour_id
         where pv.id = (v_item->>'variant_id')::integer;

        v_unit_price := pg_catalog.round(v_row.selling_price::numeric, 2);
        v_gross := pg_catalog.round(v_unit_price * (v_item->>'qty')::integer, 2);
        v_discount := least(
            greatest(coalesce((v_item->>'discount')::numeric, 0), 0::numeric),
            v_gross);

        -- Money off needs a manager, the same bar as a sale's line discount.
        -- The route verifies the PIN; the header records WHO in approved_by,
        -- and this refuses a discounted line if nobody approved it.
        if v_discount > 0 and p_approved_by is null then
            raise check_violation using message =
                'A deposit with money off needs a manager''s approval.';
        end if;

        insert into public.deposit_order_items (
            order_id, variant_id, description, qty, collected_qty,
            unit_price, discount, discount_taken
        ) values (
            v_order_id, (v_item->>'variant_id')::integer,
            v_row.product_name || ' · ' || v_row.size_label || ' · ' || v_row.colour_name,
            (v_item->>'qty')::integer, 0,
            v_unit_price, v_discount, 0);

        v_total := v_total + v_gross - v_discount;
    end loop;

    update public.deposit_orders
       set total = pg_catalog.round(v_total, 2)
     where id = v_order_id;

    -- ── reserve the stock ───────────────────────────────────────────────
    --
    -- Real movements: the shelf count drops NOW, which is what stops another
    -- till selling these units overnight. If a race beats the pre-check, the
    -- qty_on_hand floor constraint raises and the whole order rolls back —
    -- number included, which is why gapless numbering survives.
    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        perform public.record_stock_movement(
            (v_item->>'variant_id')::integer,
            'deposit_reserve',
            -((v_item->>'qty')::integer),
            'deposit_order',
            v_order_id,
            null);
    end loop;

    -- ── first money, if any ─────────────────────────────────────────────
    if p_payment is not null and pg_catalog.jsonb_typeof(p_payment) = 'object' then
        v_pay_method := nullif(p_payment->>'method', '');
        v_pay_amount := pg_catalog.round(coalesce((p_payment->>'amount')::numeric, 0), 2);

        if v_pay_amount > 0 then
            if v_pay_method not in ('cash', 'card', 'juice', 'myt_money', 'bank') then
                raise check_violation using message =
                    'A deposit can be paid in cash, card, Juice, my.t money or bank — not on account.';
            end if;
            if v_pay_amount > v_total + 0.001 then
                raise check_violation using message = pg_catalog.format(
                    'The order comes to %s — %s would be more than the whole deposit.',
                    pg_catalog.to_char(v_total, 'FM999999990.00'),
                    pg_catalog.to_char(v_pay_amount, 'FM999999990.00'));
            end if;
            if v_pay_method = 'cash' and p_shift_id is null then
                raise check_violation using message =
                    'Cash belongs in a drawer — open the till before taking a deposit.';
            end if;

            -- Into the drawer's books the same moment the notes go into the
            -- drawer. record_till_movement refuses a closed shift itself.
            v_move_id := null;
            if v_pay_method = 'cash' then
                select public.record_till_movement(
                    p_shift_id, v_pay_amount,
                    'Deposit ' || v_order_no || ' — ' || v_name)
                  into v_move_id;
            end if;

            insert into public.deposit_order_payments (
                order_id, entry_type, amount, method, shift_id,
                till_movement_id, idempotency_key, reason, created_by
            ) values (
                v_order_id, 'payment', v_pay_amount, v_pay_method,
                case when v_pay_method = 'cash' then p_shift_id else null end,
                v_move_id,
                case when v_key is not null then v_key || ':pay' else null end,
                'Deposit ' || v_order_no || ' — ' || v_name,
                coalesce(p_cashier_id, auth.uid()));
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'order_id',   v_order_id,
        'order_no',   v_order_no,
        'total',      pg_catalog.round(v_total, 2),
        'balance',    pg_catalog.round(v_total, 2)
                      - public.deposit_unallocated_credit(v_order_id),
        'replayed',   false);
end;
$function$;

COMMENT ON FUNCTION public.create_deposit_order(TEXT, INTEGER, JSONB, JSONB, DATE, TEXT, INTEGER, UUID, INTEGER, UUID) IS
  'Opens a layaway: freezes prices from the catalogue, reserves stock with '
  'deposit_reserve movements, takes optional first money (cash also writes a '
  'till movement so the drawer expects it). Replay-safe on p_key.';

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 2 — top up an open order
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_deposit_payment(
    p_key         TEXT,
    p_order_id    BIGINT,
    p_method      TEXT,
    p_amount      NUMERIC,
    p_tendered    NUMERIC DEFAULT NULL,
    p_shift_id    INTEGER DEFAULT NULL,
    p_cashier_id  UUID DEFAULT NULL,
    p_device_id   INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_key        text := nullif(pg_catalog.btrim(p_key), '');
    v_existing   bigint;
    v_order      public.deposit_orders%rowtype;
    v_name       text;
    v_credit     numeric(12,2);
    v_amount     numeric(12,2) := pg_catalog.round(coalesce(p_amount, 0), 2);
    v_payment_id bigint;
begin
    -- Replay: the ledger row is the receipt of record, so a retried top-up
    -- answers with the row it already made instead of taking money twice.
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('deposit-pay:' || v_key));

        select id into v_existing
        from public.deposit_order_payments
        where idempotency_key = 'topup:' || v_key;

        if found then
            return pg_catalog.jsonb_build_object('payment_id', v_existing, 'replayed', true);
        end if;
    end if;

    select * into v_order from public.deposit_orders where id = p_order_id for update;
    if not found then
        raise check_violation using message = 'That deposit does not exist.';
    end if;
    if v_order.status <> 'open' then
        raise check_violation using message = pg_catalog.format(
            'Deposit %s is already %s — no more money can go onto it.',
            v_order.order_no,
            case v_order.status when 'collected' then 'collected' else 'cancelled' end);
    end if;

    if v_amount <= 0 then
        raise check_violation using message = 'A payment has to be more than nothing.';
    end if;
    if p_method not in ('cash', 'card', 'juice', 'myt_money', 'bank') then
        raise check_violation using message =
            'Deposits are paid in cash, card, Juice, my.t money or bank.';
    end if;
    if p_method = 'cash' and p_shift_id is null then
        raise check_violation using message = 'Open the till before taking cash.';
    end if;

    select full_name into v_name from public.customers where id = v_order.customer_id;

    -- Refused rather than clamped: an over-payment is nearly always a
    -- mistyped figure, and the shop holding money with no reason on record
    -- is exactly what this ledger exists to prevent.
    v_credit := public.deposit_unallocated_credit(p_order_id);
    if v_amount + v_credit > v_order.total + 0.001 then
        raise check_violation using message = pg_catalog.format(
            'The balance on %s is %s — that is all it can take.',
            v_order.order_no,
            pg_catalog.to_char(greatest(v_order.total - v_credit, 0::numeric), 'FM999999990.00'));
    end if;

    insert into public.deposit_order_payments (
        order_id, entry_type, amount, method, shift_id,
        idempotency_key, reason, created_by
    ) values (
        p_order_id, 'payment', v_amount, p_method,
        case when p_method = 'cash' then p_shift_id else null end,
        case when v_key is not null then 'topup:' || v_key else null end,
        'Top-up — ' || v_name,
        coalesce(p_cashier_id, auth.uid()))
    returning id into v_payment_id;

    if p_method = 'cash' then
        perform public.record_till_movement(
            p_shift_id, v_amount,
            'Deposit ' || v_order.order_no || ' top-up — ' || v_name);
    end if;

    return pg_catalog.jsonb_build_object(
        'payment_id', v_payment_id,
        'paid',       public.deposit_unallocated_credit(p_order_id),
        'balance',    pg_catalog.round(v_order.total, 2)
                      - public.deposit_unallocated_credit(p_order_id),
        'replayed',   false);
end;
$function$;

COMMENT ON FUNCTION public.add_deposit_payment(TEXT, BIGINT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, INTEGER) IS
  'Records a top-up against an open deposit order. Cash also writes a till '
  'movement. Refuses over-paying; replay-safe on p_key.';

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 3 — collect some or all of an order (the pickup visit)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Creates ONE sale for the items taken today, at the FROZEN prices, with:
--   • a method='deposit' payment row for money already in hand (the
--     allocation record — no cash behind it),
--   • ordinary rows for whatever is paid now.
-- No stock movement: those units left the shelf when the order opened.
--
-- p_lines        : [{"item_id":1,"qty":2}]
-- p_new_payments : [{"method":"cash","amount":300,"tendered":500}] (may be [])
-- Returns the new sale's id; replays on p_key like complete_sale.

CREATE OR REPLACE FUNCTION public.collect_deposit_order(
    p_order_id       BIGINT,
    p_lines          JSONB,
    p_new_payments   JSONB,
    p_shift_id       INTEGER,
    p_cashier_id     UUID,
    p_device_id      INTEGER DEFAULT NULL,
    p_vat_policy_id  BIGINT DEFAULT NULL,
    p_checked_out_at TIMESTAMPTZ DEFAULT NULL,
    p_key            TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_key          text := nullif(pg_catalog.btrim(p_key), '');
    v_existing     bigint;
    v_order        public.deposit_orders%rowtype;
    v_item         jsonb;
    v_line         public.deposit_order_items%rowtype;
    v_remaining    integer;
    v_gross        numeric(12,2);
    v_disc_share   numeric(10,2);
    v_charge       numeric(12,2);
    v_x            numeric(12,2) := 0;
    v_credit       numeric(12,2);
    v_use_credit   numeric(12,2);
    v_due_now      numeric(12,2);
    v_new_total    numeric(12,2) := 0;
    v_pay          jsonb;
    v_pay_method   text;
    v_sale_id      bigint;
    v_policy       public.vat_policies%rowtype;
    v_checkout_at  timestamptz;
    v_rate         numeric(7,6);
    v_snapshot_no  text;
    v_vat_amount   numeric(12,2);
begin
    -- Idempotency BEFORE anything else, exactly as complete_sale orders it: a
    -- retry belongs to the sale already made even if the order has since
    -- moved on.
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('collect:' || v_key));

        select id into v_existing from public.sales where idempotency_key = v_key;
        if found then
            return v_existing;
        end if;
    end if;

    select * into v_order from public.deposit_orders where id = p_order_id for update;
    if not found then
        raise check_violation using message = 'That deposit does not exist.';
    end if;
    if v_order.status <> 'open' then
        raise check_violation using message = pg_catalog.format(
            'Deposit %s was already %s.',
            v_order.order_no,
            case v_order.status when 'collected' then 'collected' else 'cancelled' end);
    end if;

    if p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array'
       or pg_catalog.jsonb_array_length(p_lines) = 0 then
        raise check_violation using message = 'Choose what the customer is taking today.';
    end if;

    -- ── what today's visit costs, at frozen prices ───────────────────────
    --
    -- A line's discount splits across visits proportionally to units taken,
    -- and the FINAL visit sweeps whatever rounding left behind — so the
    -- whole discount lands once and only once, and no visit is ever charged
    -- more than its share. Each line's figures are computed once here and
    -- kept for the sale write below.
    -- Session-private scratch for today's lines. ON COMMIT DROP cleans up
    -- after the request's own transaction; the DROP first lets two visits
    -- happen inside one transaction (a retry path, and the probe below)
    -- without colliding on the name.
    drop table if exists _pickup_lines;
    create temp table _pickup_lines on commit drop as
        select null::bigint      as id,
               null::integer     as qty,
               null::numeric(12,2) as gross,
               null::numeric(10,2) as disc_share,
               null::numeric(12,2) as charge
        where false;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_lines) loop
        select * into v_line from public.deposit_order_items
        where id = (v_item->>'item_id')::bigint and order_id = p_order_id;

        if not found then
            raise check_violation using message =
                'A chosen line does not belong to this deposit.';
        end if;

        v_remaining := v_line.qty - v_line.collected_qty;
        if v_remaining <= 0 then
            raise check_violation using message =
                v_line.description || ' has already been collected.';
        end if;
        if coalesce((v_item->>'qty')::integer, 0) < 1 then
            raise check_violation using message =
                'Choose how many of ' || v_line.description || ' are being taken.';
        end if;
        if (v_item->>'qty')::integer > v_remaining then
            raise check_violation using message = pg_catalog.format(
                'Only %s of %s still held for this customer.',
                v_remaining, v_line.description);
        end if;

        v_gross := pg_catalog.round(v_line.unit_price * (v_item->>'qty')::integer, 2);

        if v_line.discount > 0 then
            if (v_item->>'qty')::integer = v_remaining then
                -- Taking the last units: sweep the remainder.
                v_disc_share := pg_catalog.round(v_line.discount - v_line.discount_taken, 2);
            else
                v_disc_share := least(
                    pg_catalog.round(
                        (v_line.discount - v_line.discount_taken)
                          * (v_item->>'qty')::integer / v_remaining,
                        2),
                    pg_catalog.round(v_line.discount - v_line.discount_taken, 2));
            end if;
        else
            v_disc_share := 0;
        end if;

        v_charge := pg_catalog.round(v_gross - v_disc_share, 2);
        v_x := v_x + v_charge;

        insert into _pickup_lines values (v_line.id, (v_item->>'qty')::integer, v_gross, v_disc_share, v_charge);

        update public.deposit_order_items
           set collected_qty = collected_qty + (v_item->>'qty')::integer,
               discount_taken = discount_taken + v_disc_share
         where id = v_line.id;

    end loop;

    v_x := pg_catalog.round(v_x, 2);

    -- ── split the charge between credit in hand and money now ───────────
    v_credit := public.deposit_unallocated_credit(p_order_id);
    if v_credit < 0 then
        -- Cannot happen through these RPCs; refuse rather than guess.
        raise check_violation using message =
            'This deposit''s payments do not add up — an owner needs to look at it.';
    end if;

    v_use_credit := least(v_credit, v_x);
    v_due_now := pg_catalog.round(v_x - v_use_credit, 2);

    if p_new_payments is null or pg_catalog.jsonb_typeof(p_new_payments) <> 'array' then
        raise check_violation using message = 'Payments must be a list.';
    end if;

    for v_pay in select * from pg_catalog.jsonb_array_elements(p_new_payments) loop
        v_new_total := v_new_total + coalesce((v_pay->>'amount')::numeric, 0);
    end loop;
    v_new_total := pg_catalog.round(v_new_total, 2);

    if v_new_total + 0.001 < v_due_now then
        raise check_violation using message = pg_catalog.format(
            'Still owed today: %s. Payments cover %s — take %s more.',
            pg_catalog.to_char(v_due_now, 'FM999999990.00'),
            pg_catalog.to_char(v_new_total, 'FM999999990.00'),
            pg_catalog.to_char(v_due_now - v_new_total, 'FM999999990.00'));
    end if;
    if v_new_total > v_due_now + 0.001 then
        raise check_violation using message = pg_catalog.format(
            'Only %s is owed today — the rest belongs in change, not in the amount.',
            pg_catalog.to_char(v_due_now, 'FM999999990.00'));
    end if;

    for v_pay in select * from pg_catalog.jsonb_array_elements(p_new_payments) loop
        v_pay_method := nullif(v_pay->>'method', '');
        if coalesce((v_pay->>'amount')::numeric, 0) <= 0 then
            raise check_violation using message = 'A payment has to be more than nothing.';
        end if;
        if v_pay_method not in ('cash', 'card', 'juice', 'myt_money', 'bank') then
            raise check_violation using message =
                'Balance payments are cash, card, Juice, my.t money or bank.';
        end if;
    end loop;

    -- ── resolve the VAT policy, byte-for-byte the complete_sale rules ────
    if p_vat_policy_id is null then
        select * into strict v_policy from public.vat_policies where is_legacy;
    else
        if p_checked_out_at is null then
            raise check_violation using message =
                'A checkout time is required with a VAT policy id';
        end if;

        select * into v_policy from public.vat_policies where id = p_vat_policy_id;

        if not found then
            raise check_violation using message = pg_catalog.format(
                'VAT policy %s does not exist', p_vat_policy_id);
        end if;
        if v_policy.created_at > p_checked_out_at then
            raise check_violation using message = pg_catalog.format(
                'VAT policy %s was created after checkout', p_vat_policy_id);
        end if;
    end if;

    v_checkout_at := coalesce(p_checked_out_at, pg_catalog.clock_timestamp());
    v_rate := case when v_policy.enabled then v_policy.configured_rate else 0 end;
    v_snapshot_no := case when v_policy.enabled then v_policy.vat_number else null end;

    -- Prices are VAT-inclusive everywhere in this shop.
    v_vat_amount := case
        when v_policy.enabled then
            pg_catalog.round(v_x - v_x / (1 + v_rate), 2)
        else 0
    end;

    -- ── write the sale (no stock movements — see header) ─────────────────
    insert into public.sales (
        sale_no, shift_id, customer_id, sale_date, subtotal, discount,
        vat_amount, total, cashier_id, vat_policy_id, vat_enabled, vat_rate,
        vat_number, idempotency_key, deposit_order_id
    ) values (
        'pending-' || pg_catalog.gen_random_uuid()::text,
        p_shift_id, v_order.customer_id, v_checkout_at, v_x, 0,
        v_vat_amount, v_x, coalesce(p_cashier_id, auth.uid()),
        v_policy.id, v_policy.enabled, v_rate, v_snapshot_no,
        v_key, p_order_id
    ) returning id into v_sale_id;

    update public.sales set sale_no = public.next_doc_no('sale') where id = v_sale_id;

    -- The allocation row FIRST so the money trail reads in order: what was
    -- already handed over, then whatever is paid today.
    if v_use_credit > 0 then
        insert into public.sale_payments (sale_id, method, amount, tendered)
        values (v_sale_id, 'deposit',
                pg_catalog.round(v_use_credit, 2), null);
    end if;

    for v_pay in select * from pg_catalog.jsonb_array_elements(p_new_payments) loop
        insert into public.sale_payments (sale_id, method, amount, tendered)
        values (
            v_sale_id,
            v_pay->>'method',
            pg_catalog.round((v_pay->>'amount')::numeric, 2),
            pg_catalog.round((v_pay->>'tendered')::numeric, 2));
    end loop;

    -- Stamp each taken line onto the sale, at its frozen figures — read
    -- back from _pickup_lines, whose shares were computed before any item
    -- row moved.
    insert into public.sale_items (
        sale_id, variant_id, description, qty, unit_price, discount, line_total
    )
    select v_sale_id,
           di.variant_id,
           di.description,
           pl.qty,
           di.unit_price,
           pl.disc_share,
           pl.charge
      from _pickup_lines pl
      join public.deposit_order_items di on di.id = pl.id;

    -- ── close the visit ─────────────────────────────────────────────────
    if not exists (
        select 1 from public.deposit_order_items
        where order_id = p_order_id and collected_qty < qty
    ) then
        update public.deposit_orders
           set status = 'collected',
               collected_at = coalesce(p_checked_out_at, pg_catalog.clock_timestamp())
         where id = p_order_id;
    end if;

    return v_sale_id;
end;
$function$;

COMMENT ON FUNCTION public.collect_deposit_order(BIGINT, JSONB, JSONB, INTEGER, UUID, INTEGER, BIGINT, TIMESTAMPTZ, TEXT) IS
  'One pickup visit: writes a real sale at frozen prices (no stock movement '
  '— units left the shelf at deposit), allocates in-hand credit as a '
  'method=''deposit'' tender, takes fresh payments for the rest. Replay-safe '
  'on p_key via sales.idempotency_key.';

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 4 — cancel an order and refund what has not been collected
-- ═══════════════════════════════════════════════════════════════════════
--
-- Refunds ONLY the unallocated credit, method-for-method FIFO across the
-- payments made; cash leaves through record_till_movement so the drawer's
-- books move with the notes. Reserved-but-uncollected stock goes back on
-- the shelf. Pickup sales that already happened stand untouched.

CREATE OR REPLACE FUNCTION public.cancel_deposit_order(
    p_key         TEXT,
    p_order_id    BIGINT,
    p_reason      TEXT,
    p_shift_id    INTEGER DEFAULT NULL,
    p_cashier_id  UUID DEFAULT NULL,
    p_device_id   INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_key        text := nullif(pg_catalog.btrim(p_key), '');
    v_order      public.deposit_orders%rowtype;
    v_name       text;
    v_credit     numeric(12,2);
    v_left       numeric(12,2);
    v_take       numeric(12,2);
    v_pay        public.deposit_order_payments%rowtype;
    v_item_row   public.deposit_order_items%rowtype;
    v_cash_out   numeric(12,2) := 0;
    v_released   integer := 0;
begin
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('cancel:' || v_key));
    end if;

    select * into v_order from public.deposit_orders where id = p_order_id for update;
    if not found then
        raise check_violation using message = 'That deposit does not exist.';
    end if;

    -- Cancelling twice answers with the state it already reached.
    if v_order.status = 'cancelled' then
        return pg_catalog.jsonb_build_object(
            'refunded', 0, 'released_units', 0, 'already_cancelled', true);
    end if;
    if v_order.status <> 'open' then
        raise check_violation using message =
            'Deposit ' || v_order.order_no || ' was fully collected — nothing to cancel.';
    end if;

    if coalesce(pg_catalog.btrim(coalesce(p_reason, '')), '') = '' then
        raise check_violation using message = 'Say why the deposit is being cancelled.';
    end if;

    select full_name into v_name from public.customers where id = v_order.customer_id;

    v_credit := public.deposit_unallocated_credit(p_order_id);
    v_left := v_credit;

    -- Find out whether cash needs to leave BEFORE anything is written: the
    -- ledger row demands a drawer (its CHECK says so) and the notes demand
    -- an open one.
    select coalesce(sum(amount), 0) into v_cash_out
      from public.deposit_order_payments
     where order_id = p_order_id and entry_type = 'payment' and method = 'cash';
    v_cash_out := least(v_cash_out, v_credit);
    if v_cash_out > 0 and p_shift_id is null then
        raise check_violation using message =
            'Open the till before refunding cash.';
    end if;
    v_cash_out := 0;

    -- FIFO over what came in, oldest note first, so a refund mirrors how
    -- the money actually arrived.
    for v_pay in
        select * from public.deposit_order_payments
        where order_id = p_order_id and entry_type = 'payment'
        order by created_at, id
    loop
        exit when v_left <= 0;

        v_take := least(v_pay.amount, v_left);
        if v_take <= 0 then continue; end if;

        insert into public.deposit_order_payments (
            order_id, entry_type, amount, method, shift_id,
            idempotency_key, reason, created_by
        ) values (
            p_order_id, 'refund', -v_take, v_pay.method,
            case when v_pay.method = 'cash' then p_shift_id else null end,
            case when v_key is not null
                 then 'refund:' || v_key || ':' || v_pay.id::text else null end,
            'Refund on cancellation — ' || coalesce(pg_catalog.btrim(p_reason), ''),
            coalesce(p_cashier_id, auth.uid()));

        if v_pay.method = 'cash' then
            v_cash_out := v_cash_out + v_take;
        end if;

        v_left := pg_catalog.round(v_left - v_take, 2);
    end loop;

    -- The notes physically leave this drawer, so its books must show it.
    -- record_till_movement refuses a closed shift and an empty drawer —
    -- both are real refusals a cashier can act on.
    if v_cash_out > 0 then
        perform public.record_till_movement(
            p_shift_id, -v_cash_out,
            'Deposit ' || v_order.order_no || ' refund — ' || v_name);
    end if;

    -- Whatever was never collected goes back on the shelf.
    select coalesce(sum(qty - collected_qty), 0) into v_released
      from public.deposit_order_items
     where order_id = p_order_id;

    if v_released > 0 then
        for v_item_row in
            select * from public.deposit_order_items
            where order_id = p_order_id and collected_qty < qty
        loop
            perform public.record_stock_movement(
                v_item_row.variant_id,
                'deposit_release',
                v_item_row.qty - v_item_row.collected_qty,
                'deposit_order',
                p_order_id,
                'Cancelled — ' || coalesce(pg_catalog.btrim(p_reason), ''));
        end loop;
    end if;

    update public.deposit_orders
       set status = 'cancelled',
           cancelled_at = pg_catalog.clock_timestamp(),
           cancelled_by = coalesce(p_cashier_id, auth.uid()),
           cancelled_reason = pg_catalog.btrim(p_reason)
     where id = p_order_id;

    return pg_catalog.jsonb_build_object(
        'refunded',        v_credit,
        'cash_refunded',   v_cash_out,
        'released_units',  v_released,
        'already_cancelled', false);
end;
$function$;

COMMENT ON FUNCTION public.cancel_deposit_order(TEXT, BIGINT, TEXT, INTEGER, UUID, INTEGER) IS
  'Cancels an open deposit: refunds unallocated credit FIFO by original '
  'method (cash via a till movement), releases uncollected stock, closes the '
  'order. Pickup sales already made stand. Replay-safe on p_key.';

-- ── who may read and run what ───────────────────────────────────────────────
--
-- Read for every signed-in member of staff; writes ONLY through the four RPCs
-- above, which are SECURITY DEFINER. No INSERT/UPDATE/DELETE policies exist,
-- which is what makes "append-only" true rather than intended.

ALTER TABLE deposit_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON deposit_orders;
CREATE POLICY read_all ON deposit_orders
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON deposit_order_items;
CREATE POLICY read_all ON deposit_order_items
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON deposit_order_payments;
CREATE POLICY read_all ON deposit_order_payments
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.deposit_orders TO authenticated;
GRANT SELECT ON public.deposit_order_items TO authenticated;
GRANT SELECT ON public.deposit_order_payments TO authenticated;

REVOKE ALL ON public.deposit_orders FROM anon;
REVOKE ALL ON public.deposit_order_items FROM anon;
REVOKE ALL ON public.deposit_order_payments FROM anon;

REVOKE ALL ON FUNCTION public.create_deposit_order(TEXT, INTEGER, JSONB, JSONB, DATE, TEXT, INTEGER, UUID, INTEGER, UUID)
    FROM public, anon;
REVOKE ALL ON FUNCTION public.add_deposit_payment(TEXT, BIGINT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, INTEGER)
    FROM public, anon;
REVOKE ALL ON FUNCTION public.collect_deposit_order(BIGINT, JSONB, JSONB, INTEGER, UUID, INTEGER, BIGINT, TIMESTAMPTZ, TEXT)
    FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_deposit_order(TEXT, BIGINT, TEXT, INTEGER, UUID, INTEGER)
    FROM public, anon;
REVOKE ALL ON FUNCTION public.deposit_unallocated_credit(BIGINT) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_deposit_order(TEXT, INTEGER, JSONB, JSONB, DATE, TEXT, INTEGER, UUID, INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_deposit_payment(TEXT, BIGINT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, INTEGER)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_deposit_order(BIGINT, JSONB, JSONB, INTEGER, UUID, INTEGER, BIGINT, TIMESTAMPTZ, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_deposit_order(TEXT, BIGINT, TEXT, INTEGER, UUID, INTEGER)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.deposit_unallocated_credit(BIGINT) TO authenticated;

-- ── prove it ────────────────────────────────────────────────────────────────
--
-- Exercised for real against throwaway rows, then rolled back, in the style
-- migration 20260820100000 set. A migration that only creates objects has not
-- shown that they behave.

DO $probe$
DECLARE
    v_profile  uuid;
    v_customer int;
    v_category int;
    v_size     int;
    v_colour   int;
    v_product  int;
    v_product2 int;
    v_variant  int;
    v_variant2 int;
    v_shift    int;
    v_result   jsonb;
    v_order1   bigint;
    v_order_no text;
    v_item1    bigint;
    v_sale1    bigint;
    v_sale2    bigint;
    v_onhand   int;
    v_credit   numeric;
BEGIN
    SELECT id INTO v_profile FROM public.profiles ORDER BY full_name LIMIT 1;
    IF v_profile IS NULL THEN
        RAISE EXCEPTION 'probe needs at least one profile';
    END IF;

    INSERT INTO public.customers (full_name, phone)
    VALUES ('Deposit probe', '+2300000000')
    RETURNING id INTO v_customer;

    INSERT INTO public.categories (name) VALUES ('__deposit_probe_cat')
    RETURNING id INTO v_category;
    INSERT INTO public.sizes (size_type, label) VALUES ('age_range', '__probe')
    RETURNING id INTO v_size;
    INSERT INTO public.colours (name) VALUES ('__probe')
    RETURNING id INTO v_colour;

    INSERT INTO public.products (name, category_id)
    VALUES ('__Probe toy', v_category) RETURNING id INTO v_product;
    INSERT INTO public.products (name, category_id)
    VALUES ('__Probe toy 2', v_category) RETURNING id INTO v_product2;
    INSERT INTO public.product_variants (product_id, size_id, colour_id, sku,
            selling_price, qty_on_hand)
    VALUES (v_product, v_size, v_colour, '__PROBE-A', 100, 0)
    RETURNING id INTO v_variant;

    -- A variant is unique per product+size+colour, so the second probe item
    -- lives under its own product.
    INSERT INTO public.product_variants (product_id, size_id, colour_id, sku,
            selling_price, qty_on_hand)
    VALUES (v_product2, v_size, v_colour, '__PROBE-B', 100, 0)
    RETURNING id INTO v_variant2;

    -- Stock arrives the way all stock does.
    PERFORM public.record_stock_movement(v_variant, 'opening', 10, 'probe', NULL, NULL);
    PERFORM public.record_stock_movement(v_variant2, 'opening', 10, 'probe', NULL, NULL);

    -- A private open shift so cash movements land somewhere owned by the probe.
    INSERT INTO public.shifts (opened_by, opening_float)
    VALUES (v_profile, 50) RETURNING id INTO v_shift;

    BEGIN
        -- ═══ open an order with a discounted line and Rs 100 cash down ═══
        SELECT * INTO v_result FROM public.create_deposit_order(
            'probe-key-1', v_customer,
            ('[{"variant_id":' || v_variant || ', "qty":2, "discount":10}]')::jsonb,
            '{"method":"cash","amount":100}'::jsonb,
            CURRENT_DATE + 14, NULL, v_shift, v_profile, NULL, v_profile);

        v_order1 := (v_result->>'order_id')::bigint;
        v_order_no := v_result->>'order_no';

        IF (v_result->>'total')::numeric <> 190 THEN
            RAISE EXCEPTION 'expected frozen total 190, got %', v_result->>'total';
        END IF;
        IF (v_result->>'balance')::numeric <> 90 THEN
            RAISE EXCEPTION 'expected balance 90 after Rs 100 down, got %',
                v_result->>'balance';
        END IF;
        IF v_order_no !~ '^D[0-9]{6}-[0-9]+$' THEN
            RAISE EXCEPTION 'order number % does not follow the D-doc pattern', v_order_no;
        END IF;

        -- Stock reserved for real.
        SELECT qty_on_hand INTO v_onhand FROM public.product_variants WHERE id = v_variant;
        IF v_onhand <> 8 THEN
            RAISE EXCEPTION 'reserve did not move the shelf count: %', v_onhand;
        END IF;

        -- The approving manager is named on the order, not merely checked:
        -- this order opened with a discounted line and v_profile's nod.
        IF (SELECT approved_by FROM public.deposit_orders WHERE id = v_order1)
           IS DISTINCT FROM v_profile THEN
            RAISE EXCEPTION 'the discount approver was not recorded on the order';
        END IF;

        -- Cash went into THIS drawer.
        IF NOT EXISTS (
            SELECT 1 FROM public.till_movements
            WHERE shift_id = v_shift AND amount = 100
              AND reason LIKE 'Deposit ' || v_order_no || '%'
        ) THEN
            RAISE EXCEPTION 'cash deposit did not reach the drawer books';
        END IF;

        -- Replay answers with the SAME order and opens nothing else.
        v_result := public.create_deposit_order(
            'probe-key-1', v_customer,
            ('[{"variant_id":' || v_variant || ', "qty":2, "discount":10}]')::jsonb,
            NULL, NULL, NULL, NULL, v_profile, NULL, NULL);
        IF (v_result->>'order_id')::bigint <> v_order1 THEN
            RAISE EXCEPTION 'create replay opened a second order';
        END IF;

        SELECT id INTO v_item1 FROM public.deposit_order_items
        WHERE order_id = v_order1 LIMIT 1;

        -- ═══ a card top-up; over-paying is refused, not clamped ════════
        PERFORM public.add_deposit_payment('probe-topup-1', v_order1,
            'card', 50, NULL, NULL, v_profile, NULL);
        SELECT public.deposit_unallocated_credit(v_order1) INTO v_credit;
        IF v_credit <> 150 THEN
            RAISE EXCEPTION 'credit after top-up should be 150, got %', v_credit;
        END IF;

        BEGIN
            PERFORM public.add_deposit_payment('probe-overpay', v_order1,
                'cash', 500, NULL, v_shift, v_profile, NULL);
            RAISE EXCEPTION 'an over-payment was accepted';
        EXCEPTION WHEN check_violation THEN NULL;
        END;

        -- ═══ first visit: take ONE of two units ═════════════════════════
        --
        -- Charge = 100 − half the line''s discount = 95, covered entirely by
        -- credit in hand; nothing owed today.
        v_sale1 := public.collect_deposit_order(v_order1,
            ('[{"item_id":' || v_item1 || ', "qty":1}]')::jsonb,
            '[]'::jsonb, v_shift, v_profile, NULL, NULL, now(), 'probe-collect-1');

        IF v_sale1 IS NULL THEN
            RAISE EXCEPTION 'pickup produced no sale';
        END IF;

        SELECT public.deposit_unallocated_credit(v_order1) INTO v_credit;
        IF v_credit <> 55 THEN
            RAISE EXCEPTION 'unallocated after pickup should be 55, got %', v_credit;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.stock_movements sm
            WHERE sm.reference_type = 'pos_sale' AND sm.reference_id = v_sale1
        ) THEN
            RAISE EXCEPTION 'a pickup wrote a second stock-out — units would leave twice';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.sale_payments
            WHERE sale_id = v_sale1 AND method = 'deposit' AND amount = 95
        ) THEN
            RAISE EXCEPTION 'the allocation tender row is missing or wrong';
        END IF;

        -- Replay hands back the SAME sale.
        v_sale2 := public.collect_deposit_order(v_order1,
            ('[{"item_id":' || v_item1 || ', "qty":1}]')::jsonb,
            '[]'::jsonb, v_shift, v_profile, NULL, NULL, now(), 'probe-collect-1');
        IF v_sale2 <> v_sale1 THEN
            RAISE EXCEPTION 'collect replay made a second sale';
        END IF;

        -- ═══ final visit sweeps the discount remainder; order closes ════
        --
        -- Charge = 100 − the other half of the discount = 95. Credit in hand
        -- is 55, so Rs 40 cash settles it (tendered 50 exercises change).
        v_sale2 := public.collect_deposit_order(v_order1,
            ('[{"item_id":' || v_item1 || ', "qty":1}]')::jsonb,
            '[{"method":"cash","amount":40,"tendered":50}]'::jsonb,
            v_shift, v_profile, NULL, NULL, now(), 'probe-collect-2');

        SELECT total INTO v_credit FROM public.sales WHERE id = v_sale2;
        IF v_credit <> 95 THEN
            RAISE EXCEPTION 'final pickup sale should total 95, got %', v_credit;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.sale_payments
            WHERE sale_id = v_sale2 AND method = 'deposit' AND amount = 55
        ) OR NOT EXISTS (
            SELECT 1 FROM public.sale_payments
            WHERE sale_id = v_sale2 AND method = 'cash' AND amount = 40
        ) THEN
            RAISE EXCEPTION 'final pickup payments do not read credit 55 + cash 40';
        END IF;

        SELECT public.deposit_unallocated_credit(v_order1) INTO v_credit;
        IF v_credit <> 0 THEN
            RAISE EXCEPTION 'fully collected order still holds % unallocated', v_credit;
        END IF;
        IF (SELECT status FROM public.deposit_orders WHERE id = v_order1) <> 'collected' THEN
            RAISE EXCEPTION 'a fully collected order did not close itself';
        END IF;

        -- Custom lines have no stock to hold — refused outright.
        BEGIN
            PERFORM public.create_deposit_order('probe-custom', v_customer,
                '[{"variant_id":null,"qty":1,"discount":0,"description":"wrap"}]'::jsonb,
                NULL, NULL, NULL, NULL, v_profile, NULL, NULL);
            RAISE EXCEPTION 'a custom line was accepted onto a deposit';
        EXCEPTION WHEN check_violation THEN NULL;
        END;

        -- ═══ cancel: zero-down order, pay cash, then walk away ══════════
        v_result := public.create_deposit_order(
            'probe-key-2', v_customer,
            ('[{"variant_id":' || v_variant2 || ', "qty":3, "discount":0}]')::jsonb,
            '{"method":"cash","amount":30}'::jsonb,
            NULL, NULL, v_shift, v_profile, NULL, v_profile);

        -- Under-payment of the balance at pickup is refused with what to do.
        BEGIN
            PERFORM public.collect_deposit_order(
                (v_result->>'order_id')::bigint,
                jsonb_build_array(jsonb_build_object(
                    'item_id', (SELECT id FROM public.deposit_order_items
                                WHERE order_id = (v_result->>'order_id')::bigint LIMIT 1),
                    'qty', 1)),
                '[]'::jsonb, v_shift, v_profile, NULL, NULL, now(), 'probe-under');
            RAISE EXCEPTION 'an under-paid pickup was accepted';
        EXCEPTION WHEN check_violation THEN NULL;
        END;

        v_result := public.cancel_deposit_order('probe-cancel-1',
            (SELECT order_id FROM (
                 SELECT id AS order_id FROM public.deposit_orders
                 WHERE idempotency_key = 'probe-key-2') t),
            'Customer changed their mind', v_shift, v_profile, NULL);

        IF (v_result->>'refunded')::numeric <> 30 THEN
            RAISE EXCEPTION 'cancel should refund exactly the 30 taken, got %',
                v_result->>'refunded';
        END IF;
        IF (v_result->>'released_units')::int <> 3 THEN
            RAISE EXCEPTION 'cancel should release 3 units, got %',
                v_result->>'released_units';
        END IF;

        SELECT qty_on_hand INTO v_onhand FROM public.product_variants WHERE id = v_variant2;
        IF v_onhand <> 10 THEN
            RAISE EXCEPTION 'released stock did not return to the shelf: %', v_onhand;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.till_movements
            WHERE shift_id = v_shift AND amount = -30
              AND reason LIKE 'Deposit D% refund%'
        ) THEN
            RAISE EXCEPTION 'cash refund never reached the drawer books';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.deposit_order_payments
            WHERE order_id = (SELECT id FROM public.deposit_orders
                              WHERE idempotency_key = 'probe-key-2')
              AND entry_type = 'refund' AND amount = -30 AND method = 'cash'
        ) THEN
            RAISE EXCEPTION 'no refund ledger row for the cancellation';
        END IF;

        -- Cancelling twice answers calmly instead of raising.
        v_result := public.cancel_deposit_order('probe-cancel-1',
            (SELECT id FROM public.deposit_orders WHERE idempotency_key = 'probe-key-2'),
            'again', v_shift, v_profile, NULL);
        IF NOT (v_result->>'already_cancelled')::boolean THEN
            RAISE EXCEPTION 'second cancel was not recognised as a replay';
        END IF;

        RAISE NOTICE 'create, reserve, top-up, pickups, sweep, close and cancel all behave';
        RAISE EXCEPTION 'rollback the probe';
    EXCEPTION
        WHEN others THEN
            IF sqlerrm <> 'rollback the probe' THEN RAISE; END IF;
            RAISE NOTICE 'probe rolled back; no probe rows remain';
    END;
END;
$probe$;
