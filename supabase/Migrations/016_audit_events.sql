-- ============================================================
-- Kids Corner — migration 016: traceability
--
-- Most of what a shop needs to trace already leaves a record: a sale is a sale
-- row, a stock adjustment is a stock_movement, a reprint is a receipt_print,
-- a close is a z_report. The activity feed is built by reading those, not by
-- duplicating them into a log — a log that can disagree with the thing it
-- describes is worse than no log.
--
-- WHAT LEAVES NO TRACE TODAY, AND SHOULD.
--
--   • A SELLING PRICE CHANGE. `product_variants` has no timestamps and no
--     audit at all. Someone can halve a price, sell to a friend, and put it
--     back, and nothing anywhere records it. After cash, this is the single
--     most important thing in a shop to be able to trace.
--   • A PIN OR ROLE CHANGE. Both are access control.
--   • A SETTINGS OR DISCOUNT-RULE CHANGE. Both move money.
--
-- WHY TRIGGERS RATHER THAN APPLICATION CODE.
--
-- The app is not the only way in. A migration, a psql session, or the Supabase
-- table editor all bypass it. A trigger sees every write, and an audit trail
-- with a documented hole in it is not an audit trail.
--
-- Migrations 001-015 are untouched.
-- ============================================================

-- NOT ADDED HERE: an author column on `credit_notes`.
--
-- It already has `cashier_id`, set by `create_credit_note` to the PIN-selected
-- cashier — which is the better attribution of the two, because it names the
-- person accountable rather than the shared device account they were signed in
-- under. A second author column would have sat permanently NULL and implied
-- refunds were going unattributed when they were not.

-- ===== audit_events =====
CREATE TABLE IF NOT EXISTS audit_events (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL means the change did not come through the app — a migration, or
    -- somebody in the SQL editor. Worth being able to see, so it is recorded
    -- rather than hidden behind a placeholder.
    actor_id   UUID REFERENCES profiles(id),
    event_type TEXT NOT NULL,
    ref_type   TEXT NOT NULL,
    ref_id     TEXT,
    -- Just enough to render the line without joining back to a row that may
    -- since have changed or been deleted.
    summary    TEXT NOT NULL,
    detail     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events (event_type, at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Readable by staff; written only by the triggers below, which are SECURITY
-- DEFINER. There is deliberately no INSERT, UPDATE or DELETE policy: a trail
-- that the people it describes can edit is not a control.
DROP POLICY IF EXISTS read_audit_events ON audit_events;
CREATE POLICY read_audit_events ON audit_events
    FOR SELECT TO authenticated USING (true);

-- ===== the recorder =====
CREATE OR REPLACE FUNCTION log_audit(
    p_event_type TEXT,
    p_ref_type   TEXT,
    p_ref_id     TEXT,
    p_summary    TEXT,
    p_detail     JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit_events (actor_id, event_type, ref_type, ref_id, summary, detail)
    VALUES (auth.uid(), p_event_type, p_ref_type, p_ref_id, p_summary, p_detail);
END;
$$;

-- ===== price changes =====
--
-- Guarded by a WHEN clause on the trigger, not by an IF inside the function.
-- `complete_sale` updates `qty_on_hand` on every line of every sale, so a
-- trigger that fired on any UPDATE would write an audit row per item sold and
-- bury the price changes it exists to surface.
CREATE OR REPLACE FUNCTION audit_variant_price() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_name TEXT;
BEGIN
    SELECT p.name INTO v_name
      FROM products p WHERE p.id = NEW.product_id;

    IF OLD.selling_price IS DISTINCT FROM NEW.selling_price THEN
        PERFORM log_audit(
            'price.changed', 'product_variant', NEW.id::TEXT,
            format('%s (%s): price %s to %s',
                   coalesce(v_name, 'a product'), NEW.sku,
                   to_char(OLD.selling_price, 'FM999999990.00'),
                   to_char(NEW.selling_price, 'FM999999990.00')),
            jsonb_build_object('sku', NEW.sku, 'product', v_name,
                               'from', OLD.selling_price, 'to', NEW.selling_price)
        );
    END IF;

    IF OLD.cost_price IS DISTINCT FROM NEW.cost_price THEN
        PERFORM log_audit(
            'cost.changed', 'product_variant', NEW.id::TEXT,
            format('%s (%s): cost %s to %s',
                   coalesce(v_name, 'a product'), NEW.sku,
                   to_char(OLD.cost_price, 'FM999999990.00'),
                   to_char(NEW.cost_price, 'FM999999990.00')),
            jsonb_build_object('sku', NEW.sku, 'product', v_name,
                               'from', OLD.cost_price, 'to', NEW.cost_price)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_variant_price ON product_variants;
CREATE TRIGGER trg_audit_variant_price
    AFTER UPDATE ON product_variants
    FOR EACH ROW
    WHEN (OLD.selling_price IS DISTINCT FROM NEW.selling_price
       OR OLD.cost_price IS DISTINCT FROM NEW.cost_price)
    EXECUTE FUNCTION audit_variant_price();

-- ===== staff access =====
CREATE OR REPLACE FUNCTION audit_profile_access() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
        PERFORM log_audit(
            'staff.role_changed', 'profile', NEW.id::TEXT,
            format('%s: role %s to %s', NEW.full_name, OLD.role, NEW.role),
            jsonb_build_object('from', OLD.role, 'to', NEW.role)
        );
    END IF;

    -- The hash itself is never recorded, only that it changed. An audit trail
    -- carrying credentials is a second copy of them.
    IF OLD.pin_code IS DISTINCT FROM NEW.pin_code THEN
        PERFORM log_audit(
            'staff.pin_changed', 'profile', NEW.id::TEXT,
            format('%s: PIN %s', NEW.full_name,
                   CASE WHEN NEW.pin_code IS NULL THEN 'cleared' ELSE 'set' END),
            jsonb_build_object('cleared', NEW.pin_code IS NULL)
        );
    END IF;

    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        PERFORM log_audit(
            'staff.active_changed', 'profile', NEW.id::TEXT,
            format('%s: %s', NEW.full_name,
                   CASE WHEN NEW.is_active THEN 'reactivated' ELSE 'deactivated' END),
            jsonb_build_object('active', NEW.is_active)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_access ON profiles;
CREATE TRIGGER trg_audit_profile_access
    AFTER UPDATE ON profiles
    FOR EACH ROW
    WHEN (OLD.role IS DISTINCT FROM NEW.role
       OR OLD.pin_code IS DISTINCT FROM NEW.pin_code
       OR OLD.is_active IS DISTINCT FROM NEW.is_active)
    EXECUTE FUNCTION audit_profile_access();

-- ===== settings =====
CREATE OR REPLACE FUNCTION audit_settings() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM log_audit(
        'setting.changed', 'setting', NEW.key,
        format('%s changed', NEW.key),
        jsonb_build_object('key', NEW.key, 'from', OLD.value, 'to', NEW.value)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_settings ON settings;
CREATE TRIGGER trg_audit_settings
    AFTER UPDATE ON settings
    FOR EACH ROW
    WHEN (OLD.value IS DISTINCT FROM NEW.value)
    EXECUTE FUNCTION audit_settings();

-- ===== discount rules =====
-- These decide how much money can come off a sale, so a change to one is a
-- change to the shop's pricing policy.
CREATE OR REPLACE FUNCTION audit_discounts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit('discount.created', 'discount', NEW.id::TEXT,
            format('Discount created: %s', NEW.name),
            to_jsonb(NEW) - 'created_at');
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM log_audit('discount.deleted', 'discount', OLD.id::TEXT,
            format('Discount deleted: %s', OLD.name),
            to_jsonb(OLD) - 'created_at');
        RETURN OLD;
    END IF;

    PERFORM log_audit('discount.changed', 'discount', NEW.id::TEXT,
        format('Discount changed: %s', NEW.name),
        jsonb_build_object(
            'from', to_jsonb(OLD) - 'created_at',
            'to',   to_jsonb(NEW) - 'created_at'));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_discounts ON discounts;
CREATE TRIGGER trg_audit_discounts
    AFTER INSERT OR UPDATE OR DELETE ON discounts
    FOR EACH ROW EXECUTE FUNCTION audit_discounts();

-- ===== voided and refunded sales =====
-- A status change on a sale is money reversed.
CREATE OR REPLACE FUNCTION audit_sale_status() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM log_audit(
        'sale.' || NEW.status, 'sale', NEW.id::TEXT,
        format('%s marked %s (%s)', NEW.sale_no, NEW.status,
               to_char(NEW.total, 'FM999999990.00')),
        jsonb_build_object('sale_no', NEW.sale_no, 'from', OLD.status,
                           'to', NEW.status, 'total', NEW.total)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_sale_status ON sales;
CREATE TRIGGER trg_audit_sale_status
    AFTER UPDATE ON sales
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION audit_sale_status();

GRANT EXECUTE ON FUNCTION log_audit(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
