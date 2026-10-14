-- Owner decisions 2026-10-16 (A92–A98): integrity rules. Hand-written. No data is changed;
-- rules that existing rows might not satisfy are added NOT VALID (checked for new/updated rows).

-- 1. A DOB is never verified by the person who entered it (A93) -------------------------------
ALTER TABLE public.student_accounts
  ADD CONSTRAINT student_dob_not_self_verified CHECK (
    date_of_birth_verified_by_id IS NULL OR date_of_birth_verified_by_id <> date_of_birth_entered_by_id
  ) NOT VALID;

-- 2. Option C lifecycle (A96): each state carries who/when of its own step --------------------
-- The row holds the CURRENT request cycle; DISABLED keeps the enable fields of the cycle it ended.
ALTER TABLE public.recording_entitlements DROP CONSTRAINT entitlement_status_fields;
ALTER TABLE public.recording_entitlements
  ADD CONSTRAINT entitlement_status_fields CHECK (
    (status <> 'PENDING' OR (requested_by_id IS NOT NULL AND requested_at IS NOT NULL))
    AND (status IN ('ENABLED', 'DISABLED')) = (enabled_by_id IS NOT NULL AND enabled_at IS NOT NULL)
    AND (status = 'DECLINED') = (declined_by_id IS NOT NULL AND declined_at IS NOT NULL)
    AND (status = 'CANCELLED') = (cancelled_by_id IS NOT NULL AND cancelled_at IS NOT NULL)
    AND (status = 'DISABLED') = (disabled_by_id IS NOT NULL AND disabled_at IS NOT NULL)
  ),
  -- A96: only the requester cancels their own request.
  ADD CONSTRAINT entitlement_cancel_by_requester CHECK (cancelled_by_id IS NULL OR cancelled_by_id = requested_by_id);
