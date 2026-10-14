-- Owner decisions 2026-10-15 (A81–A91): integrity rules and RLS for the new states.
-- Hand-written. Constraints are dropped and re-created with their new meaning (no data change);
-- rules that existing rows might not satisfy are added NOT VALID (checked for new/updated rows).

-- 1. Date of birth: entered (student/guardian) and verified (Markaz Admin) — A82 -------------
ALTER TABLE public.student_accounts DROP CONSTRAINT student_dob_recorded_fields;
ALTER TABLE public.student_accounts
  ADD CONSTRAINT student_dob_entered_fields CHECK (
    (date_of_birth IS NULL) = (date_of_birth_entered_by_id IS NULL)
    AND (date_of_birth IS NULL) = (date_of_birth_entered_at IS NULL)
  ),
  ADD CONSTRAINT student_dob_verified_fields CHECK (
    (date_of_birth_verified_by_id IS NULL) = (date_of_birth_verified_at IS NULL)
    AND (date_of_birth_verified_at IS NULL OR date_of_birth IS NOT NULL)
  );

-- 2. Consent: an adult's own consent (A83) -----------------------------------------------------
ALTER TABLE public.recording_consents DROP CONSTRAINT consent_method_fields;
ALTER TABLE public.recording_consents
  ADD CONSTRAINT consent_method_fields CHECK (
    (method = 'GUARDIAN_ONLINE'
      AND guardian_profile_id IS NOT NULL AND tenant_id IS NULL
      AND offline_consenter_description IS NULL AND evidence_reference IS NULL)
    OR
    (method = 'OFFLINE_VERIFIED'
      AND guardian_profile_id IS NULL AND tenant_id IS NOT NULL
      AND offline_consenter_description IS NOT NULL AND offline_consenter_description <> ''
      AND evidence_reference IS NOT NULL AND evidence_reference <> '')
    OR
    (method = 'SELF_ONLINE'
      AND guardian_profile_id IS NULL AND tenant_id IS NULL
      AND offline_consenter_description IS NULL AND evidence_reference IS NULL
      AND recorded_by_id = student_profile_id)
  );
CREATE UNIQUE INDEX recording_consents_live_self
  ON public.recording_consents (student_profile_id)
  WHERE method = 'SELF_ONLINE' AND withdrawn_at IS NULL;

-- 3. Correction clips: at most 10 MB (A91) ----------------------------------------------------
-- 10 MB = 10 * 1024 * 1024 bytes (the meaning of Supabase Storage's "10MB" file-size limit).
ALTER TABLE public.correction_audio_clips
  ADD CONSTRAINT clip_finalized_max_10mb CHECK (status <> 'FINALIZED' OR byte_size <= 10485760) NOT VALID;

-- 4. Recordings: review workflow with REJECTED and resubmission (A87), teacher notice (A89) ----
ALTER TABLE public.recordings DROP CONSTRAINT recording_status_fields;
ALTER TABLE public.recordings
  ADD CONSTRAINT recording_status_fields CHECK (
    (status = 'DRAFT') = (submitted_at IS NULL)
    AND (submitted_at IS NULL) = (submitted_by_id IS NULL)
    AND (status IN ('APPROVED', 'REVOKED'))
        = (approved_at IS NOT NULL AND approved_by_id IS NOT NULL AND approval_scope IS NOT NULL)
    AND (status = 'REVOKED') = (approval_revoked_at IS NOT NULL AND approval_revoked_by_id IS NOT NULL)
    AND (status = 'REJECTED') = (rejected_at IS NOT NULL AND rejected_by_id IS NOT NULL)
    AND (rejection_reason IS NULL OR status = 'REJECTED')
  ),
  ADD CONSTRAINT recording_teacher_notice_fields CHECK (
    (teacher_notice_acknowledged_at IS NULL) = (teacher_notice_acknowledged_by_id IS NULL)
  );
ALTER TABLE public.recordings DROP CONSTRAINT recording_started_with_notice;
ALTER TABLE public.recordings
  ADD CONSTRAINT recording_started_with_notices CHECK (
    started_at IS NULL OR (notice_shown_at IS NOT NULL AND teacher_notice_acknowledged_at IS NOT NULL)
  ) NOT VALID;

-- 5. Deletion requests: cancel / decline, and no self-approval (A84–A85) ----------------------
ALTER TABLE public.media_deletion_requests DROP CONSTRAINT deletion_approval_fields;
ALTER TABLE public.media_deletion_requests
  ADD CONSTRAINT deletion_status_fields CHECK (
    (status = 'APPROVED') = (approved_at IS NOT NULL AND approved_by_id IS NOT NULL)
    AND (status = 'DECLINED') = (declined_at IS NOT NULL AND declined_by_id IS NOT NULL)
    AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)
    AND (decline_reason IS NULL OR status = 'DECLINED')
  ),
  -- A84: the approver is never the requester — enforced here as well as in the service.
  ADD CONSTRAINT deletion_no_self_approval CHECK (approved_by_id IS NULL OR approved_by_id <> requested_by_id),
  -- A85: only the requester cancels their own request.
  ADD CONSTRAINT deletion_cancel_by_requester CHECK (cancelled_by_id IS NULL OR cancelled_by_id = requested_by_id);

-- 6. Option C entitlement (A90) ---------------------------------------------------------------
ALTER TABLE public.recording_entitlements
  ADD CONSTRAINT entitlement_status_fields CHECK (
    (status <> 'PENDING' OR (requested_by_id IS NOT NULL AND requested_at IS NOT NULL))
    AND (status = 'ENABLED') = (enabled_by_id IS NOT NULL AND enabled_at IS NOT NULL)
  );

-- 7. RLS: the entitlement table is server-only, like the other recording tables. -------------
ALTER TABLE public.recording_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recording_entitlements FROM anon, authenticated;
