-- A module cannot be hidden from the owner.
--
-- Migration 006 seeded every owner cell TRUE and then let the Settings matrix
-- turn any of them off again. It guarded only the till, on the reasoning that a
-- role needs somewhere to land — but the same argument applies with more force
-- to the owner, who is the one person who can undo the change.
--
-- Live, `owner/products` had been switched off. The nav item disappeared and
-- every remaining route into the catalogue — the header search, the low-stock
-- pill, a product opened from a stock row — was bounced by the proxy. The
-- shop's owner could not reach their own products.
--
-- The UI already refused `owner/settings` for exactly this reason: hide the
-- matrix from the owner and nobody can ever put it back. That instinct was
-- right and one cell too narrow. There is no back-office module an owner has
-- any reason not to see, so the invariant belongs here, next to the till's,
-- where the server action cannot write around it.

-- The repair first: setting a cell TRUE is what the guard below permits, so
-- order matters only for reading, not for correctness.
UPDATE module_access
   SET can_view = TRUE
 WHERE role = 'owner'
   AND can_view = FALSE;

CREATE OR REPLACE FUNCTION guard_owner_access()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role = 'owner' AND NEW.can_view = FALSE THEN
        RAISE EXCEPTION 'A module cannot be hidden from the owner';
    END IF;
    RETURN NEW;
END;
$$;

-- Its own trigger rather than an edit to `guard_pos_access`: two separate
-- invariants, each named after the thing it protects.
DROP TRIGGER IF EXISTS trg_module_access_owner ON module_access;
CREATE TRIGGER trg_module_access_owner
    BEFORE INSERT OR UPDATE ON module_access
    FOR EACH ROW EXECUTE FUNCTION guard_owner_access();
