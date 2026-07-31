-- ============================================================
-- Kids Corner — migration 010: PIN attempt limiting
--
-- WHY THIS EXISTS NOW.
--
-- Until now the PIN only decided whose name went on a sale; the Supabase
-- session was the real authentication, and 001 says so. On the Android till
-- that flips: the device stays signed in permanently and the PIN becomes the
-- only thing between a stranger and the drawer. A 4-digit PIN is 10,000
-- guesses, which a person can work through by hand in an evening and a script
-- can do in seconds. Hashing does not help — the attacker is guessing at the
-- front door, not reading the database.
--
-- So the count has to be kept, and it has to be kept HERE. Anything the client
-- tracks is reset by restarting the app, and `profiles` is not writable by a
-- cashier under the 001 RLS policy, so the counter is maintained by a
-- SECURITY DEFINER function instead.
--
-- The lockout escalates rather than being fixed: a cashier fat-fingering a
-- digit twice should not be locked out of a queue, but someone grinding through
-- the space should hit minutes of delay within a dozen tries.
--
-- Migrations 001-009 are untouched.
-- ============================================================

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS pin_failed_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pin_last_used_at TIMESTAMPTZ;

-- ===== pin_lock_state =====
-- How long a profile is locked out for, in seconds. Zero means it may try.
-- Readable by any signed-in device so the keypad can show the wait without
-- having to burn an attempt to discover it.
CREATE OR REPLACE FUNCTION pin_lock_state(p_profile_id UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT GREATEST(
        0,
        COALESCE(
            EXTRACT(EPOCH FROM (pin_locked_until - now()))::INT,
            0
        )
    )
    FROM profiles
    WHERE id = p_profile_id;
$$;

-- ===== register_pin_attempt =====
-- Records the outcome of one PIN attempt and returns the seconds the profile
-- must now wait. The APP verifies the hash — that stays in application code
-- where the PBKDF2 implementation lives — and reports the verdict here.
--
-- That split is safe because this function is not what decides access: it only
-- counts. A caller lying about `p_ok` would be a caller that already holds a
-- valid session and could simply not call it at all. What it buys is that the
-- counter survives app restarts and is shared across every till in the shop.
CREATE OR REPLACE FUNCTION register_pin_attempt(p_profile_id UUID, p_ok BOOLEAN)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_failed INT;
    v_wait   INT := 0;
BEGIN
    IF p_ok THEN
        UPDATE profiles
           SET pin_failed_count = 0,
               pin_locked_until = NULL,
               pin_last_used_at = now()
         WHERE id = p_profile_id;
        RETURN 0;
    END IF;

    UPDATE profiles
       SET pin_failed_count = pin_failed_count + 1
     WHERE id = p_profile_id
    RETURNING pin_failed_count INTO v_failed;

    IF v_failed IS NULL THEN
        RETURN 0;
    END IF;

    -- Three free misses, because a keypad in a busy shop gets mistyped. After
    -- that the wait doubles: 5s, 10s, 20s ... capped at five minutes. Twenty
    -- wrong guesses already costs well over an hour, which puts the full 10,000
    -- out of reach without ever locking a real cashier out for long.
    IF v_failed > 3 THEN
        v_wait := LEAST(300, 5 * POWER(2, v_failed - 4)::INT);
        UPDATE profiles
           SET pin_locked_until = now() + make_interval(secs => v_wait)
         WHERE id = p_profile_id;
    END IF;

    RETURN v_wait;
END;
$$;

REVOKE ALL ON FUNCTION pin_lock_state(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_pin_attempt(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pin_lock_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION register_pin_attempt(UUID, BOOLEAN) TO authenticated;

-- ===== clear_pin_lock =====
-- An owner or manager can free a locked-out cashier without waiting, which is
-- the difference between a security control and an operational problem.
CREATE OR REPLACE FUNCTION clear_pin_lock(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_role_of_user() NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Only an owner or manager can clear a PIN lock';
    END IF;

    UPDATE profiles
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = p_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION clear_pin_lock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_pin_lock(UUID) TO authenticated;
