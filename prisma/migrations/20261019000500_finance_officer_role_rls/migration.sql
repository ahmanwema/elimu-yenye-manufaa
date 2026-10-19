-- Finance Officer / Accountant (owner decision 2026-10-19, A140). Hand-written. No row is changed.

-- 1. payment.verify is no longer grantable (A140 supersedes the interim A136 grant) ----------------
-- Payment verification comes from the MARKAZ_ADMIN or FINANCE_OFFICER role only; a Teacher can never
-- hold it. The enum value cannot be dropped in PostgreSQL, so it is refused here. NOT VALID keeps any
-- pre-existing local row from blocking the migration (none exist on DEV: the value was never applied
-- there); every new or updated row is checked.
ALTER TABLE public.tenant_permission_grants
  ADD CONSTRAINT grant_not_payment_verify CHECK (permission <> 'PAYMENT_VERIFY') NOT VALID;

-- 2. A Finance Officer is a member of their Markaz -------------------------------------------------
-- Same signature and attributes as before; the role list gains FINANCE_OFFICER so a finance-only
-- staff member can read their own Markaz row (tenants_select) like any other member. Nothing else
-- uses this function. No other RLS policy names FINANCE_OFFICER: it unlocks no student data.
CREATE OR REPLACE FUNCTION app.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT app.has_tenant_role(p_tenant_id, ARRAY['MARKAZ_ADMIN', 'TEACHER', 'STUDENT', 'FINANCE_OFFICER']::public."TenantRole"[]);
$$;
REVOKE ALL ON FUNCTION app.is_tenant_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_tenant_member(uuid) TO authenticated;
