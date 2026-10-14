-- Recording & correction media: integrity rules, append-only audit, and RLS.
-- Hand-written (Prisma does not model CHECKs, partial indexes, triggers or policies).
-- Pre-existing rows are never rewritten or rejected: CHECKs on the pre-existing
-- correction_audio_clips table are NOT VALID (they apply to new and updated rows); the only
-- data change is a non-destructive backfill that marks one primary clip per correction.

-- 1. Correction clips ------------------------------------------------------------------
-- Backfill: the newest live FINALIZED clip of each correction becomes its primary clip.
UPDATE public.correction_audio_clips c SET is_primary = true
WHERE c.id IN (
  SELECT DISTINCT ON (correction_id) id FROM public.correction_audio_clips
  WHERE status = 'FINALIZED' AND deleted_at IS NULL
  ORDER BY correction_id, finalized_at DESC, created_at DESC
)
AND NOT EXISTS (
  SELECT 1 FROM public.correction_audio_clips p WHERE p.correction_id = c.correction_id AND p.is_primary
);

-- At most one primary clip per correction; only a live FINALIZED clip can be primary (A68).
CREATE UNIQUE INDEX correction_audio_clips_one_primary
  ON public.correction_audio_clips (correction_id) WHERE is_primary;

ALTER TABLE public.correction_audio_clips
  ADD CONSTRAINT clip_primary_is_live_finalized CHECK (
    NOT is_primary OR (status = 'FINALIZED' AND deleted_at IS NULL)
  ),
  -- A69: a finalized clip is AAC in M4A ("audio/mp4") of at most 60 s, as measured by the server.
  ADD CONSTRAINT clip_finalized_is_m4a_max_60s CHECK (
    status <> 'FINALIZED' OR (mime_type = 'audio/mp4' AND duration_ms IS NOT NULL AND duration_ms <= 60000)
  ) NOT VALID,
  ADD CONSTRAINT clip_failed_fields CHECK ((status = 'FAILED') = (failed_at IS NOT NULL)) NOT VALID,
  -- A73–A75 lifecycle: soft delete ⇒ archived + purge date; purge never before the grace period.
  ADD CONSTRAINT clip_deletion_lifecycle CHECK (
    (deleted_at IS NULL OR (archived_at IS NOT NULL AND purge_eligible_at IS NOT NULL AND purge_eligible_at >= deleted_at))
    AND (purged_at IS NULL OR (deleted_at IS NOT NULL AND purged_at >= purge_eligible_at))
  );

-- 2. Anchors: the historical snapshot is always a JSON object -----------------------------
ALTER TABLE public.correction_anchors
  ADD CONSTRAINT anchor_snapshot_is_object CHECK (jsonb_typeof(snapshot) = 'object'),
  ADD CONSTRAINT anchor_position_is_object CHECK (position IS NULL OR jsonb_typeof(position) = 'object');

-- 3. Date of birth: recorded together with who recorded it ------------------------------
ALTER TABLE public.student_accounts
  ADD CONSTRAINT student_dob_recorded_fields CHECK (
    (date_of_birth IS NULL) = (date_of_birth_recorded_by_id IS NULL)
    AND (date_of_birth IS NULL) = (date_of_birth_recorded_at IS NULL)
  );

-- 4. Consent (A70–A72) ---------------------------------------------------------------------
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
  ),
  ADD CONSTRAINT consent_withdrawal_fields CHECK ((withdrawn_at IS NULL) = (withdrawn_by_id IS NULL));

-- One live consent per guardian per student, and one live offline consent per Markaz.
CREATE UNIQUE INDEX recording_consents_live_guardian
  ON public.recording_consents (student_profile_id, guardian_profile_id)
  WHERE method = 'GUARDIAN_ONLINE' AND withdrawn_at IS NULL;
CREATE UNIQUE INDEX recording_consents_live_offline
  ON public.recording_consents (student_profile_id, tenant_id)
  WHERE method = 'OFFLINE_VERIFIED' AND withdrawn_at IS NULL;

-- 5. Recordings (A77–A80) ------------------------------------------------------------------
ALTER TABLE public.recordings
  ADD CONSTRAINT recording_status_fields CHECK (
    (status = 'DRAFT') = (submitted_at IS NULL)
    AND (submitted_at IS NULL) = (submitted_by_id IS NULL)
    AND (status IN ('APPROVED', 'REVOKED'))
        = (approved_at IS NOT NULL AND approved_by_id IS NOT NULL AND approval_scope IS NOT NULL)
    AND (status = 'REVOKED') = (approval_revoked_at IS NOT NULL AND approval_revoked_by_id IS NOT NULL)
  ),
  ADD CONSTRAINT recording_media_fields CHECK (
    (media_finalized_at IS NULL OR (storage_object_key IS NOT NULL AND byte_size IS NOT NULL))
    AND (storage_object_key IS NULL) = (storage_bucket IS NULL)
  ),
  ADD CONSTRAINT recording_started_with_notice CHECK (started_at IS NULL OR notice_shown_at IS NOT NULL),
  ADD CONSTRAINT recording_deletion_lifecycle CHECK (
    (deleted_at IS NULL OR (archived_at IS NOT NULL AND purge_eligible_at IS NOT NULL AND purge_eligible_at >= deleted_at))
    AND (purged_at IS NULL OR (deleted_at IS NOT NULL AND purged_at >= purge_eligible_at))
  ),
  ADD CONSTRAINT recording_non_negative CHECK (
    (byte_size IS NULL OR byte_size >= 0) AND (duration_ms IS NULL OR duration_ms >= 0)
  );

ALTER TABLE public.recording_participants
  ADD CONSTRAINT participant_audio_requires_consent CHECK (
    audio_included = (eligibility = 'CONSENTED')
    AND (eligibility = 'CONSENTED') = (consent_id IS NOT NULL)
  );

ALTER TABLE public.recording_segments
  ADD CONSTRAINT segment_range CHECK (start_ms >= 0 AND end_ms > start_ms),
  ADD CONSTRAINT segment_media_fields CHECK (
    (storage_object_key IS NULL) = (storage_bucket IS NULL)
    AND (media_finalized_at IS NULL OR (storage_object_key IS NOT NULL AND byte_size IS NOT NULL))
  );

-- 6. Deletion requests (A73–A75) -----------------------------------------------------------
ALTER TABLE public.media_deletion_requests
  ADD CONSTRAINT deletion_exactly_one_target CHECK (num_nonnulls(clip_id, recording_id) = 1),
  ADD CONSTRAINT deletion_approval_fields CHECK (
    (status = 'APPROVED') = (approved_at IS NOT NULL AND approved_by_id IS NOT NULL)
  ),
  ADD CONSTRAINT deletion_consent_reason CHECK ((reason = 'CONSENT_WITHDRAWN') = (consent_id IS NOT NULL));

CREATE UNIQUE INDEX media_deletion_requests_one_pending_clip
  ON public.media_deletion_requests (clip_id) WHERE status = 'PENDING' AND clip_id IS NOT NULL;
CREATE UNIQUE INDEX media_deletion_requests_one_pending_recording
  ON public.media_deletion_requests (recording_id) WHERE status = 'PENDING' AND recording_id IS NOT NULL;

-- 7. Audit events are append-only (A80) — refused for every role, including the owner. ------
CREATE OR REPLACE FUNCTION app.audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
REVOKE ALL ON FUNCTION app.audit_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_append_only();
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_events_append_only();

-- 8. Row Level Security ----------------------------------------------------------------------
ALTER TABLE public.correction_anchors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_consents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_segments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_deletion_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events             ENABLE ROW LEVEL SECURITY;

-- Supabase grants new tables to the API roles by default: take everything back.
REVOKE ALL ON public.correction_anchors, public.recording_consents, public.recordings,
  public.recording_participants, public.recording_segments, public.media_deletion_requests,
  public.audit_events
  FROM anon, authenticated;

-- Server-only (no Data API access at all): consents, recordings and their parts, deletion
-- requests, audit. Their read rules involve consent/approval gates and a MANDATORY audit for
-- Super Admin reads, which a direct Data API read could not honour.
-- Anchors follow their correction exactly like clips do.
GRANT SELECT ON public.correction_anchors TO authenticated;

CREATE POLICY correction_anchors_select ON public.correction_anchors FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.corrections c WHERE c.id = correction_id));

-- Corrections (A66 ownership decisions): the student (always — A32); an ACTIVE-linked parent
-- in ANY Markaz (A41/A48, cross-Markaz by decision); the authoring teacher while an ACTIVE
-- teacher of that Markaz (a departed teacher loses access); a Markaz Admin of THAT Markaz.
-- Super Admins are deliberately NOT included here: their reads go through the server, which
-- writes the mandatory audit event first.
DROP POLICY corrections_select ON public.corrections;
CREATE POLICY corrections_select ON public.corrections FOR SELECT TO authenticated
USING (
  student_profile_id = auth.uid()
  OR app.has_active_parent_link(student_profile_id)
  OR (teacher_profile_id = auth.uid()
      AND app.has_tenant_role(tenant_id, ARRAY['TEACHER']::public."TenantRole"[]))
  OR app.has_tenant_role(tenant_id, ARRAY['MARKAZ_ADMIN']::public."TenantRole"[])
);

-- Date of birth is sensitive and server-only: the Data API keeps only the original columns.
REVOKE SELECT ON public.student_accounts FROM authenticated;
GRANT SELECT (profile_id, created_at) ON public.student_accounts TO authenticated;
