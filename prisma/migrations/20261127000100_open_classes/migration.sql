-- Open classes (owner decision 2026-11-27, A159; refines A106).
--
-- A class may be OPEN to every ACTIVE student of its Markaz. The application then creates the
-- class enrollment itself — when the class is opened, and whenever a student membership becomes
-- ACTIVE — so a student who has joined the Markaz can attend without being enrolled class by
-- class. Enrollment rows still exist, so capacity (waitlist), paid classes (PENDING_PAYMENT),
-- attendance, chat and recording rules keep working unchanged.
--
-- ADDITIVE. Existing classes stay closed (false), which is exactly what they mean today.

ALTER TABLE public.classes
  ADD COLUMN open_to_markaz boolean NOT NULL DEFAULT false;
