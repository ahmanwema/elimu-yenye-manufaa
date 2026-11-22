-- Row Level Security for the join-link tables (2026-11-22). Hand-written; no row is changed.
--
-- Both tables are SERVER-ONLY, for the same reason the twelve Live Class tables are. A join link
-- is a credential: anyone holding the raw token can cause an account and a membership to be
-- created. Its row carries the token hash, the remaining uses and the Markaz it opens, and
-- join_link_uses says which person came in through which link. None of that may be reachable
-- through the Data API by anyone, authenticated or not -- it is reachable only through the
-- server's own authorization layer (canManageJoinLinks, and token validation for redemption).
--
-- Note that the student redeeming a link is NOT signed in yet and has no account at all, so no
-- policy could express the redemption path in the first place: it is necessarily server-side.

ALTER TABLE public.join_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_link_uses ENABLE ROW LEVEL SECURITY;

-- Supabase grants new tables to the API roles by default: take everything back.
REVOKE ALL ON public.join_links, public.join_link_uses FROM anon, authenticated;
