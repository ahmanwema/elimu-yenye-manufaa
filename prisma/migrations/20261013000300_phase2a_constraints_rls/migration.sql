-- Elimu Yenye Manufaa — Phase 2A constraints and Row Level Security.
-- Supabase-specific (uses auth.uid() and the `authenticated` role), like 20261013000100.
--
-- Same model as before: RLS protects Supabase Data API reads; Prisma (server) bypasses
-- RLS and is protected by src/server/authz + src/server/services. No write policies.

-- 1. Partial unique indexes (Prisma cannot express these) -------------------------
-- At most one live grant per (tenant, profile, permission).
CREATE UNIQUE INDEX tenant_permission_grants_one_active
  ON public.tenant_permission_grants (tenant_id, profile_id, permission)
  WHERE revoked_at IS NULL;

-- At most one pending invitation per (tenant, email, role).
CREATE UNIQUE INDEX invitations_one_pending
  ON public.invitations (tenant_id, email, role)
  WHERE status = 'PENDING';

-- At most one pending appointment request per (tenant, candidate). This also closes the
-- race where two admins submit the same request at the same moment.
CREATE UNIQUE INDEX markaz_admin_appointment_requests_one_pending
  ON public.markaz_admin_appointment_requests (tenant_id, candidate_profile_id)
  WHERE status = 'PENDING';

-- 2. Integrity checks --------------------------------------------------------------
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_email_normalized CHECK (email = lower(btrim(email)) AND email <> ''),
  ADD CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at),
  ADD CONSTRAINT invitations_accepted_fields CHECK (
    (status = 'ACCEPTED') = (accepted_at IS NOT NULL AND accepted_by_id IS NOT NULL)
  ),
  ADD CONSTRAINT invitations_revoked_fields CHECK (
    (status = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by_id IS NOT NULL)
  );

ALTER TABLE public.markaz_admin_appointment_requests
  -- Nobody reviews their own request.
  ADD CONSTRAINT appointment_reviewer_is_not_requester CHECK (reviewed_by_id IS NULL OR reviewed_by_id <> requested_by_id),
  ADD CONSTRAINT appointment_candidate_is_not_requester CHECK (candidate_profile_id <> requested_by_id),
  ADD CONSTRAINT appointment_review_fields CHECK (
    (status = 'PENDING') = (reviewed_at IS NULL AND reviewed_by_id IS NULL)
  );

-- VERIFIED and ACTIVE both require that a verification happened (A48 state meaning).
ALTER TABLE public.parent_student_links
  ADD CONSTRAINT parent_student_links_verified_fields CHECK (
    status NOT IN ('VERIFIED', 'ACTIVE') OR (verified_at IS NOT NULL AND verified_by_id IS NOT NULL)
  );

-- Correction clips: provenance must match the source type; a FINALIZED clip must
-- describe its own stored object. No codec or duration limits are approved, so none are set.
ALTER TABLE public.correction_audio_clips
  ADD CONSTRAINT clip_direct_capture_has_no_source CHECK (
    source_type <> 'DIRECT_CAPTURE'
    OR (source_recording_id IS NULL AND source_start_ms IS NULL AND source_end_ms IS NULL)
  ),
  ADD CONSTRAINT clip_extracted_has_segment CHECK (
    source_type <> 'EXTRACTED_FROM_RECORDING'
    OR (source_start_ms IS NOT NULL AND source_end_ms IS NOT NULL
        AND source_start_ms >= 0 AND source_end_ms > source_start_ms)
  ),
  ADD CONSTRAINT clip_status_matches_source CHECK (
    (status <> 'AWAITING_UPLOAD' OR source_type = 'DIRECT_CAPTURE')
    AND (status <> 'AWAITING_EXTRACTION' OR source_type = 'EXTRACTED_FROM_RECORDING')
  ),
  ADD CONSTRAINT clip_finalized_fields CHECK (
    (status = 'FINALIZED') = (finalized_at IS NOT NULL)
    AND (status <> 'FINALIZED' OR byte_size IS NOT NULL)
  ),
  ADD CONSTRAINT clip_non_negative_sizes CHECK (
    (byte_size IS NULL OR byte_size >= 0) AND (duration_ms IS NULL OR duration_ms >= 0)
  ),
  ADD CONSTRAINT clip_storage_key_present CHECK (storage_object_key <> '' AND storage_bucket <> '');

-- 3. Helper functions ----------------------------------------------------------------
-- Explicit permission: a live grant AND an eligible ACTIVE role in the same tenant.
-- Eligible roles mirror GRANTABLE_PERMISSION_ROLES in src/server/authz/policy.ts.
-- Platform admins get no bypass here.
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
  AND CASE p_permission
    WHEN 'PARENT_LINK_VERIFY' THEN
      app.has_tenant_role(p_tenant_id, ARRAY['MARKAZ_ADMIN', 'TEACHER']::public."TenantRole"[])
    ELSE false
  END;
$$;

-- Teacher basic roster: the target is an ACTIVE student in a Markaz where the caller is
-- an ACTIVE teacher.
CREATE OR REPLACE FUNCTION app.teaches_in_markaz_of(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships target
    JOIN public.memberships teacher ON teacher.tenant_id = target.tenant_id
    WHERE target.profile_id = p_profile_id
      AND target.role = 'STUDENT'
      AND target.status = 'ACTIVE'
      AND teacher.profile_id = auth.uid()
      AND teacher.role = 'TEACHER'
      AND teacher.status = 'ACTIVE'
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;

-- 4. Row Level Security ---------------------------------------------------------------
ALTER TABLE public.tenant_permission_grants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markaz_admin_appointment_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrections                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_audio_clips             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenant_permission_grants, public.invitations,
  public.markaz_admin_appointment_requests, public.corrections, public.correction_audio_clips
  FROM anon, authenticated;

-- Invitations (token hashes) and appointment requests are server-only: no Data API grant.
GRANT SELECT ON public.tenant_permission_grants, public.corrections, public.correction_audio_clips
  TO authenticated;

-- Teacher basic roster: names of ACTIVE students in the teacher's Markaz.
-- `profiles` must therefore only ever hold basic, non-sensitive columns (docs/system/database.md §7).
CREATE POLICY profiles_select_teacher_roster ON public.profiles FOR SELECT TO authenticated
USING (app.teaches_in_markaz_of(id));

-- Teacher basic roster: the STUDENT membership rows of the teacher's own Markaz.
CREATE POLICY memberships_select_teacher_roster ON public.memberships FOR SELECT TO authenticated
USING (
  role = 'STUDENT' AND status = 'ACTIVE'
  AND app.has_tenant_role(tenant_id, ARRAY['TEACHER']::public."TenantRole"[])
);

-- Parent links: verifiers (explicit permission) and Markaz Admins see the links of
-- their own Markaz. The original parent-only policy is unchanged.
CREATE POLICY parent_student_links_select_tenant ON public.parent_student_links FOR SELECT TO authenticated
USING (
  app.has_tenant_permission(tenant_id, 'PARENT_LINK_VERIFY')
  OR app.has_tenant_role(tenant_id, ARRAY['MARKAZ_ADMIN']::public."TenantRole"[])
);

CREATE POLICY tenant_permission_grants_select ON public.tenant_permission_grants FOR SELECT TO authenticated
USING (
  profile_id = auth.uid()
  OR app.has_tenant_role(tenant_id, ARRAY['MARKAZ_ADMIN']::public."TenantRole"[])
  OR app.is_platform_admin()
);

-- Corrections: the student (always — A32), an ACTIVE-linked parent (A41/A48), and the
-- authoring teacher while they hold an ACTIVE teacher membership in that Markaz.
-- Markaz Admins and platform admins are NOT included (A17; support access is not designed).
CREATE POLICY corrections_select ON public.corrections FOR SELECT TO authenticated
USING (
  student_profile_id = auth.uid()
  OR app.has_active_parent_link(student_profile_id)
  OR (teacher_profile_id = auth.uid()
      AND app.has_tenant_role(tenant_id, ARRAY['TEACHER']::public."TenantRole"[]))
);

-- A clip is readable exactly when its correction is readable by the caller. The subquery
-- runs under the caller's own RLS on `corrections`.
CREATE POLICY correction_audio_clips_select ON public.correction_audio_clips FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.corrections c WHERE c.id = correction_id));
