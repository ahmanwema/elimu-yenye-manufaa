-- Student registration number (technical implementation of A64's "Student ID / registration
-- number"; the format is an engineering choice, not a business rule).
--
-- - Only STUDENT memberships carry one; unique per Markaz (index from 20261013000600).
-- - 8 characters from an unambiguous alphabet (no 0/O/1/I/L). Random, so not guessable
--   or sequential; ~8.5e11 combinations per Markaz.
-- - Assigned exactly once, by this trigger, for every insert path (Prisma, SQL, seed).
--   Never changes afterwards — re-activating a membership keeps the same number.
-- - It is an identifier, not a secret: a parent self-request with it only ever creates a
--   PENDING request that staff must verify and activate.

CREATE OR REPLACE FUNCTION app.new_registration_number()
RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION app.assign_registration_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.registration_number IS NOT NULL
     AND NEW.registration_number IS DISTINCT FROM OLD.registration_number THEN
    RAISE EXCEPTION 'registration_number is immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.role = 'STUDENT' AND NEW.registration_number IS NULL THEN
    LOOP
      candidate := app.new_registration_number();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.tenant_id = NEW.tenant_id AND m.registration_number = candidate
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'could not allocate a registration number';
      END IF;
    END LOOP;
    NEW.registration_number := candidate;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.new_registration_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assign_registration_number() FROM PUBLIC;

CREATE TRIGGER memberships_assign_registration_number
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION app.assign_registration_number();

-- Backfill existing STUDENT memberships (the trigger assigns on this no-op update).
UPDATE public.memberships SET registration_number = NULL
WHERE role = 'STUDENT' AND registration_number IS NULL;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_registration_number_student_only
    CHECK (role = 'STUDENT' OR registration_number IS NULL),
  ADD CONSTRAINT memberships_registration_number_format
    CHECK (registration_number IS NULL OR registration_number ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  ADD CONSTRAINT memberships_registration_number_present
    CHECK (role <> 'STUDENT' OR registration_number IS NOT NULL);
