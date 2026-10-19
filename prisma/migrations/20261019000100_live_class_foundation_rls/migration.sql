-- Live Class foundation (2026-10-19, A101-A130): integrity rules, cross-tenant membership
-- guards and Row Level Security. Hand-written (Prisma does not model CHECKs, partial indexes,
-- triggers or policies). No existing row is changed. Every new CHECK is satisfied by existing
-- rows (all new columns are NULL or defaulted), so none needs NOT VALID.

-- 1. Markaz settings ----------------------------------------------------------------------
-- Capacity ceilings are configurable, never defaulted: exact numbers are not approved (A33).
ALTER TABLE public.tenants
  ADD CONSTRAINT tenant_timezone_present CHECK (length(btrim(timezone)) BETWEEN 1 AND 64),
  ADD CONSTRAINT tenant_capacity_max_positive CHECK (
    (class_enrollment_capacity_max IS NULL OR class_enrollment_capacity_max > 0)
    AND (class_live_capacity_max IS NULL OR class_live_capacity_max > 0)
  );

-- 2. Classes --------------------------------------------------------------------------------
ALTER TABLE public.classes
  ADD CONSTRAINT class_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT class_capacity_positive CHECK (
    (enrollment_capacity IS NULL OR enrollment_capacity > 0) AND (live_capacity IS NULL OR live_capacity > 0)
  ),
  ADD CONSTRAINT class_archive_fields CHECK (
    (status = 'ARCHIVED') = (archived_at IS NOT NULL AND archived_by_id IS NOT NULL)
  );

-- 3. Teacher assignments (A103): exactly one active PRIMARY, one active row per teacher ----
CREATE UNIQUE INDEX class_teacher_assignments_one_active_primary
  ON public.class_teacher_assignments (class_id) WHERE role = 'PRIMARY' AND ended_at IS NULL;
CREATE UNIQUE INDEX class_teacher_assignments_one_active_per_teacher
  ON public.class_teacher_assignments (class_id, teacher_profile_id) WHERE ended_at IS NULL;
ALTER TABLE public.class_teacher_assignments
  ADD CONSTRAINT class_teacher_end_fields CHECK ((ended_at IS NULL) = (ended_by_id IS NULL));

-- 4. Weekly schedules (Markaz-local wall time) ----------------------------------------------
ALTER TABLE public.class_schedules
  ADD CONSTRAINT class_schedule_ranges CHECK (
    weekday BETWEEN 0 AND 6
    AND start_minute BETWEEN 0 AND 1439
    AND duration_minutes BETWEEN 1 AND 1440
    AND (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
  ),
  ADD CONSTRAINT class_schedule_end_fields CHECK ((ended_at IS NULL) = (ended_by_id IS NULL));

-- 5. Enrollments (A106-A110) ----------------------------------------------------------------
-- History is never overwritten: at most one non-ENDED enrollment per student per class.
CREATE UNIQUE INDEX class_enrollments_one_open
  ON public.class_enrollments (class_id, student_profile_id) WHERE status <> 'ENDED';
ALTER TABLE public.class_enrollments
  ADD CONSTRAINT enrollment_end_fields CHECK (
    (status = 'ENDED') = (ended_at IS NOT NULL AND ended_by_id IS NOT NULL)
  ),
  ADD CONSTRAINT enrollment_waitlist_fields CHECK (status <> 'WAITLISTED' OR waitlisted_at IS NOT NULL),
  ADD CONSTRAINT enrollment_grace_fields CHECK (status <> 'GRACE' OR grace_until IS NOT NULL),
  -- A controlled override always records actor, time and a reason (A110).
  ADD CONSTRAINT enrollment_capacity_override_fields CHECK (
    (capacity_override_by_id IS NULL) = (capacity_override_at IS NULL)
    AND (capacity_override_by_id IS NULL) = (capacity_override_reason IS NULL)
    AND (capacity_override_reason IS NULL OR length(btrim(capacity_override_reason)) > 0)
  );

ALTER TABLE public.grace_extensions
  ADD CONSTRAINT grace_extension_reason_present CHECK (length(btrim(reason)) BETWEEN 1 AND 500);

-- 6. Manual payment/access verification (A107) ----------------------------------------------
ALTER TABLE public.access_payment_submissions
  ADD CONSTRAINT payment_period_order CHECK (period_end > period_start),
  ADD CONSTRAINT payment_text_present CHECK (
    length(btrim(evidence_reference)) BETWEEN 1 AND 200 AND length(btrim(coverage_note)) BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT payment_status_fields CHECK (
    (status = 'VERIFIED') = (verified_at IS NOT NULL AND verified_by_id IS NOT NULL)
    AND (status = 'REJECTED') = (rejected_at IS NOT NULL AND rejected_by_id IS NOT NULL)
  );

-- 7. Live sessions (A111-A116) --------------------------------------------------------------
-- At most one LIVE session per class at a time.
CREATE UNIQUE INDEX live_sessions_one_live_per_class
  ON public.live_sessions (class_id) WHERE status = 'LIVE';
ALTER TABLE public.live_sessions
  ADD CONSTRAINT live_session_schedule_order CHECK (scheduled_end_at > scheduled_start_at),
  ADD CONSTRAINT live_session_status_fields CHECK (
    (status IN ('LIVE', 'ENDED')) = (actual_start_at IS NOT NULL AND started_by_id IS NOT NULL)
    AND (status = 'ENDED') = (actual_end_at IS NOT NULL AND end_reason IS NOT NULL)
    AND (end_reason IS DISTINCT FROM 'MANUAL' OR ended_by_id IS NOT NULL)
    AND (end_reason IS DISTINCT FROM 'SAFETY_CLOSE' OR ended_by_id IS NULL)
    AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)
    AND (actual_end_at IS NULL OR actual_end_at >= actual_start_at)
  ),
  -- Only scheduled sessions are cancelled; an ad hoc session starts LIVE.
  ADD CONSTRAINT live_session_cancel_scheduled_only CHECK (status <> 'CANCELLED' OR kind = 'SCHEDULED'),
  ADD CONSTRAINT live_session_substitute_fields CHECK (
    (substitute_profile_id IS NULL) = (substitute_assigned_by_id IS NULL)
    AND (substitute_profile_id IS NULL) = (substitute_assigned_at IS NULL)
  );

-- 8. Participants: permissions are STUDENT business state; one student mic at a time (A117) --
CREATE UNIQUE INDEX live_session_participants_one_student_mic
  ON public.live_session_participants (session_id) WHERE mic_granted_at IS NOT NULL;
ALTER TABLE public.live_session_participants
  ADD CONSTRAINT participant_student_only_state CHECK (
    (role = 'STUDENT') = (admission IS NOT NULL)
    AND (role = 'STUDENT' OR (mic_granted_at IS NULL AND whiteboard_granted_at IS NULL AND hand_raised_at IS NULL))
  ),
  ADD CONSTRAINT participant_grant_fields CHECK (
    (mic_granted_at IS NULL) = (mic_granted_by_id IS NULL)
    AND (whiteboard_granted_at IS NULL) = (whiteboard_granted_by_id IS NULL)
    AND (removed_at IS NULL) = (removed_by_id IS NULL)
  ),
  -- A removed participant holds nothing.
  ADD CONSTRAINT participant_removed_holds_nothing CHECK (
    removed_at IS NULL OR (mic_granted_at IS NULL AND whiteboard_granted_at IS NULL AND hand_raised_at IS NULL)
  );

-- 9. Device connections (A121): one open PRIMARY device per participant ---------------------
CREATE UNIQUE INDEX live_session_connections_one_open_primary
  ON public.live_session_connections (participant_id) WHERE mode = 'PRIMARY' AND disconnected_at IS NULL;
ALTER TABLE public.live_session_connections
  ADD CONSTRAINT connection_time_order CHECK (
    (disconnected_at IS NULL OR disconnected_at >= connected_at)
    AND (admitted_at IS NULL OR admitted_at >= connected_at)
  );

-- 10. Attendance (A122) ------------------------------------------------------------------------
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_seconds_valid CHECK (present_seconds >= 0 AND session_seconds >= 0),
  ADD CONSTRAINT attendance_adjustment_fields CHECK (
    (adjusted_at IS NULL) = (adjusted_by_id IS NULL)
    AND (adjusted_at IS NULL) = (adjustment_reason IS NULL)
    AND (adjusted_at IS NOT NULL OR status = computed_status)
  );

-- 11. Chat (A120) -----------------------------------------------------------------------------
ALTER TABLE public.live_chat_messages
  ADD CONSTRAINT chat_body_present CHECK (length(btrim(body)) BETWEEN 1 AND 2000);

-- 12. Recording participants: session integration (A124-A125) ---------------------------------
ALTER TABLE public.recording_participants
  ADD CONSTRAINT participant_audio_from_requires_audio CHECK (audio_included_from IS NULL OR audio_included),
  ADD CONSTRAINT participant_exclusion_fields CHECK ((excluded_at IS NULL) = (excluded_by_id IS NULL));

-- 13. Cross-tenant guard at the database layer ------------------------------------------------
-- The service layer checks memberships first; this makes a cross-Markaz or non-member row
-- impossible even for a buggy server path. TG_ARGV: (profile column, required TenantRole).
CREATE OR REPLACE FUNCTION app.require_active_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_profile uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF v_profile IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.profile_id = v_profile
      AND m.role = TG_ARGV[1]::public."TenantRole"
      AND m.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION '% requires an ACTIVE % membership in the same Markaz', TG_TABLE_NAME, TG_ARGV[1]
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.require_active_membership() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER class_teacher_assignments_require_teacher
  BEFORE INSERT ON public.class_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION app.require_active_membership('teacher_profile_id', 'TEACHER');
CREATE TRIGGER class_enrollments_require_student
  BEFORE INSERT ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION app.require_active_membership('student_profile_id', 'STUDENT');
CREATE TRIGGER live_sessions_require_substitute_teacher
  BEFORE INSERT OR UPDATE OF substitute_profile_id ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION app.require_active_membership('substitute_profile_id', 'TEACHER');
CREATE TRIGGER access_payment_submissions_require_student
  BEFORE INSERT ON public.access_payment_submissions
  FOR EACH ROW EXECUTE FUNCTION app.require_active_membership('student_profile_id', 'STUDENT');

-- 14. Row Level Security: ALL Live Class tables are SERVER-ONLY -------------------------------
-- Their read rules depend on class assignments, enrollment access state, session roles and
-- (for parents) on stripping raw timestamps — none of which a direct Data API read could
-- honour. Raw presence, payment evidence references, overrides, waitlist, grace extensions and
-- chat are therefore reachable only through the server's authorization layer.
ALTER TABLE public.classes                               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_teacher_assignments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grace_extensions                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_payment_submissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_payment_submission_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_session_participants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_session_connections              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat_messages                    ENABLE ROW LEVEL SECURITY;

-- Supabase grants new tables to the API roles by default: take everything back.
REVOKE ALL ON public.classes, public.class_teacher_assignments, public.class_schedules,
  public.class_enrollments, public.grace_extensions, public.access_payment_submissions,
  public.access_payment_submission_enrollments, public.live_sessions,
  public.live_session_participants, public.live_session_connections, public.attendance_records,
  public.live_chat_messages
  FROM anon, authenticated;
