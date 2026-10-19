-- Live Class decision fixes (owner decisions 2026-10-19, A131-A137): integrity rules and the
-- time-zone null-handling. Hand-written. No table, column or row is dropped.

-- 1. Markaz time zone must be explicitly chosen (A131) ---------------------------------------
-- The previous migration gave every Markaz timezone = 'UTC' by DEFAULT. A default is not a
-- choice: clear it wherever no Markaz Admin ever set a zone (no TENANT_TIMEZONE_SET audit
-- event). Scheduling then fails closed until a zone is chosen. A deliberately chosen zone —
-- including a deliberately chosen 'UTC' — is kept.
UPDATE public.tenants t SET timezone = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_events e
  WHERE e.tenant_id = t.id AND e.action::text = 'TENANT_TIMEZONE_SET'
);

ALTER TABLE public.tenants DROP CONSTRAINT tenant_timezone_present;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenant_timezone_present CHECK (timezone IS NULL OR length(btrim(timezone)) BETWEEN 1 AND 64);

-- 2. Attendance and punctuality are separate dimensions (A132) --------------------------------
-- Attendance is PRESENT or ABSENT only; the interim LATE attendance value is never stored.
-- Punctuality exists exactly when the student arrived.
ALTER TABLE public.attendance_records DROP CONSTRAINT attendance_adjustment_fields;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_presence_only CHECK (status IN ('PRESENT', 'ABSENT') AND computed_status IN ('PRESENT', 'ABSENT')),
  ADD CONSTRAINT attendance_punctuality_with_arrival CHECK ((computed_punctuality IS NULL) = (first_arrival_at IS NULL)),
  ADD CONSTRAINT attendance_adjustment_fields CHECK (
    (adjusted_at IS NULL) = (adjusted_by_id IS NULL)
    AND (adjusted_at IS NULL) = (adjustment_reason IS NULL)
    AND (adjusted_at IS NOT NULL OR (status = computed_status AND punctuality IS NOT DISTINCT FROM computed_punctuality))
  );

-- 3. Waitlist order override always records actor, time and reason (A134) ---------------------
ALTER TABLE public.class_enrollments
  ADD CONSTRAINT enrollment_queue_override_fields CHECK (
    (queue_override_by_id IS NULL) = (queue_override_at IS NULL)
    AND (queue_override_by_id IS NULL) = (queue_override_reason IS NULL)
    AND (queue_override_reason IS NULL OR length(btrim(queue_override_reason)) > 0)
  );
