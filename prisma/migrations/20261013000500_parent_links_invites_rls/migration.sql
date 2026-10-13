-- Elimu Yenye Manufaa — parent-link workflow, explicit permissions, parent invitations.
-- Supabase-specific, like the other *_rls migrations. Separate from 20261013000400 because
-- enum values added there cannot be used in the same transaction.

-- 1. Parent link state ↔ audit fields (A55–A57). Each state carries exactly the actor/time
--    metadata of the steps that led to it.
ALTER TABLE public.parent_student_links
  DROP CONSTRAINT parent_student_links_verified_fields,
  ADD CONSTRAINT parent_student_links_state_fields CHECK (
    CASE status
      WHEN 'PENDING' THEN verified_at IS NULL AND activated_at IS NULL AND revoked_at IS NULL
      WHEN 'VERIFIED' THEN verified_at IS NOT NULL AND verified_by_id IS NOT NULL
                           AND activated_at IS NULL AND revoked_at IS NULL
      WHEN 'ACTIVE' THEN verified_at IS NOT NULL AND verified_by_id IS NOT NULL
                         AND activated_at IS NOT NULL AND activated_by_id IS NOT NULL
                         AND revoked_at IS NULL
      WHEN 'REVOKED' THEN revoked_at IS NOT NULL AND revoked_by_id IS NOT NULL
    END
  ),
  ADD CONSTRAINT parent_student_links_order CHECK (
    (activated_at IS NULL OR activated_at >= verified_at)
    AND (verified_at IS NULL OR verified_at >= requested_at)
  );

-- 2. Invitation kinds (A61): MEMBERSHIP needs a role and no student; PARENT has no role.
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_kind_fields CHECK (
    (kind = 'MEMBERSHIP' AND role IS NOT NULL AND proposed_student_id IS NULL)
    OR (kind = 'PARENT' AND role IS NULL)
  );

-- One pending invitation per (Markaz, email, kind, role). The previous index ignored NULL
-- roles, which would have allowed duplicate pending PARENT invitations. Requires PostgreSQL 15+
-- (Supabase and PGlite both qualify).
DROP INDEX public.invitations_one_pending;
CREATE UNIQUE INDEX invitations_one_pending
  ON public.invitations (tenant_id, email, kind, role) NULLS NOT DISTINCT
  WHERE status = 'PENDING';

-- 3. Explicit permissions: every grantable permission is eligible for MARKAZ_ADMIN and
--    TEACHER only (mirrors GRANTABLE_PERMISSION_ROLES). Still no platform-admin bypass.
CREATE OR REPLACE FUNCTION app.has_tenant_permission(p_tenant_id uuid, p_permission public."TenantPermission")
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_permission_grants g
    WHERE g.tenant_id = p_tenant_id
      AND g.profile_id = auth.uid()
      AND g.permission = p_permission
      AND g.revoked_at IS NULL
  )
  AND app.has_tenant_role(p_tenant_id, ARRAY['MARKAZ_ADMIN', 'TEACHER']::public."TenantRole"[]);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;

-- 4. RLS -------------------------------------------------------------------------------
-- Parent links of a Markaz are visible to its Markaz Admins and to holders of any
-- parent-link permission there.
DROP POLICY parent_student_links_select_tenant ON public.parent_student_links;
CREATE POLICY parent_student_links_select_tenant ON public.parent_student_links FOR SELECT TO authenticated
USING (
  app.has_tenant_role(tenant_id, ARRAY['MARKAZ_ADMIN']::public."TenantRole"[])
  OR app.has_tenant_permission(tenant_id, 'PARENT_LINK_CREATE')
  OR app.has_tenant_permission(tenant_id, 'PARENT_LINK_VERIFY')
  OR app.has_tenant_permission(tenant_id, 'PARENT_LINK_ACTIVATE')
  OR app.has_tenant_permission(tenant_id, 'PARENT_LINK_REVOKE')
);

-- Link history is server-only.
ALTER TABLE public.parent_link_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_link_events FROM anon, authenticated;
