-- Shareable join links, and the student details collected when one is redeemed
-- (owner decisions 2026-11-22; Stage 2 of docs/features/self-service-onboarding.md).
--
-- ADDITIVE ONLY. One new table, two new enums and two new nullable columns. No existing row is
-- changed and every new CHECK is satisfied by existing rows, so none needs NOT VALID.
--
-- Why a new table at all: an invitation (A60) is bound to ONE email address and is single use.
-- The owner asked for one link that many students can use, shared over WhatsApp. That is a
-- different object with different risks -- it creates accounts for addresses nobody vetted --
-- so it gets its own table, its own limits and its own authorization, instead of loosening
-- invitations.

-- 1. Student details collected at join time -------------------------------------------------
-- Gender did not exist anywhere in the schema before this.
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- Phone is a property of the person, not of one Markaz, so it sits on the profile beside the
-- display name. Nullable: every existing profile has none, and no flow requires one.
ALTER TABLE public.profiles ADD COLUMN phone text;
ALTER TABLE public.profiles
  ADD CONSTRAINT profile_phone_shape CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 7 AND 32);

-- Gender belongs to the student account, like the date of birth beside it.
ALTER TABLE public.student_accounts ADD COLUMN gender "Gender";

-- 2. Join links -------------------------------------------------------------------------------
CREATE TYPE "JoinLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE public.join_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- NULL = join the Markaz only. Set = the student is also enrolled in this class on redemption.
  class_id    uuid REFERENCES public.classes (id) ON DELETE CASCADE,
  -- Only the hash is stored, exactly as invitations do. The raw token is shown once, to its
  -- creator, and is never recoverable from the database.
  token_hash  text NOT NULL UNIQUE,
  label       text NOT NULL,
  status      "JoinLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  -- Both limits are mandatory in the service; NULL max_uses means "no ceiling" at the data layer
  -- only, for a future decision. A link that creates accounts must always be able to be closed.
  expires_at  timestamptz NOT NULL,
  max_uses    integer,
  use_count   integer NOT NULL DEFAULT 0,
  created_by_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  revoked_at  timestamptz,
  CONSTRAINT join_link_label_present CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT join_link_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT join_link_use_count_sane CHECK (use_count >= 0 AND (max_uses IS NULL OR use_count <= max_uses)),
  CONSTRAINT join_link_revoke_fields CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by_id IS NOT NULL))
);

CREATE INDEX join_links_tenant_id_created_at_idx ON public.join_links (tenant_id, created_at);

-- 3. Who used a link ---------------------------------------------------------------------------
-- One row per successful redemption. Lets a Markaz see who came in through which link and lets a
-- leaked link be traced, which audit_events alone cannot do per-link without scanning metadata.
CREATE TABLE public.join_link_uses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_link_id  uuid NOT NULL REFERENCES public.join_links (id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  used_at       timestamptz NOT NULL DEFAULT now(),
  -- One person cannot consume the same link twice: redemption is idempotent by design.
  CONSTRAINT join_link_uses_join_link_id_profile_id_key UNIQUE (join_link_id, profile_id)
);

CREATE INDEX join_link_uses_tenant_id_used_at_idx ON public.join_link_uses (tenant_id, used_at);

-- 4. The class a link points at must belong to the link's Markaz -------------------------------
-- Mirrors the cross-tenant guards the Live Class tables use: a link for Markaz A can never place
-- a student in a class of Markaz B.
CREATE OR REPLACE FUNCTION app.join_link_class_matches_tenant()
RETURNS trigger
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id = NEW.class_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'join link class must belong to the same tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.join_link_class_matches_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER join_links_class_tenant_guard
  BEFORE INSERT OR UPDATE ON public.join_links
  FOR EACH ROW EXECUTE FUNCTION app.join_link_class_matches_tenant();
