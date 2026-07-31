-- The PIN lockout stopped locking after 33 wrong guesses.
--
-- The backoff computed `5 * POWER(2, v_failed - 4)::INT` and only THEN clamped
-- it with LEAST(300, ...). At v_failed = 34 that inner expression is
-- 5 * 2^30 = 5,368,709,120, which overflows a 32-bit integer — so instead of
-- returning a wait, the function raised "integer out of range" and its
-- transaction rolled back.
--
-- The consequence is the opposite of what the guard is for. Once the counter
-- reached 33, every further wrong attempt threw before it could increment the
-- count or extend `pin_locked_until` — so the counter froze, the lockout was
-- never reapplied, and the remaining guesses could be made back-to-back with no
-- delay at all. Reaching 33 costs about two hours against the 300-second cap;
-- after that the other ~9,900 combinations of a 4-digit PIN are free.
--
-- Fixed by clamping the EXPONENT rather than the result. 2^6 = 64 already
-- exceeds the 300-second cap once multiplied by 5, so nothing above it can
-- change the answer — and the arithmetic can no longer leave INT range however
-- many times somebody guesses wrong.
--
-- A correct PIN was never affected: that path returns before this line.

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
        -- Exponent clamped, not the result: 5 * 2^6 = 320 is already past
        -- the 300s cap, so anything beyond it is arithmetic that can only
        -- overflow. See the note above.
        v_wait := LEAST(300, 5 * POWER(2, LEAST(v_failed - 4, 6))::INT);
        UPDATE profiles
           SET pin_locked_until = now() + make_interval(secs => v_wait)
         WHERE id = p_profile_id;
    END IF;

    RETURN v_wait;
END;
$$;
