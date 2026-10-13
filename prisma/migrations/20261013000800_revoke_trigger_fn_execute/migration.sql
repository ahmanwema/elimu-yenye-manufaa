-- Found by the real-Supabase vs PGlite schema comparison (2026-10-13): Supabase grants EXECUTE
-- on new functions in the public schema to anon/authenticated explicitly, so the earlier
-- "REVOKE ALL ... FROM PUBLIC" left the SECURITY DEFINER trigger function executable by the
-- API roles. It cannot be invoked directly (trigger functions can only run as triggers), but
-- privileged functions should not be executable by API roles at all.
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated;
