-- 050 added p_note to complete_sale_keyed_at_policy, but CREATE OR REPLACE
-- only replaces an identical signature — the ten-argument version survived
-- beside the eleven-argument one, and PostgREST refuses an overloaded RPC
-- name as ambiguous. Drop the old shape; the new one's DEFAULT keeps every
-- caller that never sends a note working.
drop function if exists public.complete_sale_keyed_at_policy(
  text, integer, integer, uuid, numeric, jsonb, jsonb, jsonb, bigint,
  timestamp with time zone
);
