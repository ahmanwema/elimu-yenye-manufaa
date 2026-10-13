-- Elimu Yenye Manufaa — Supabase-specific foundation migration.
--
-- REQUIRES a Supabase database (or a stand-in that provides the `auth` schema,
-- `auth.users`, `auth.uid()` and the `anon` / `authenticated` roles — see
-- tests/db/harness.ts). It will fail on a plain Postgres, by design.
--
-- What this does:
--   1. Links profiles.id to auth.users.id (no competing user table).
--   2. Creates a profile row automatically when a Supabase Auth user is created.
--   3. Adds integrity checks Prisma cannot express.
--   4. Enables Row Level Security on every application table, deny-by-default.
--   5. Adds READ-ONLY policies for the `authenticated` role. There are NO write
--      policies: all writes go through the server-side authorization layer
--      (src/server/authz) using Prisma.
--
-- IMPORTANT (see docs/system/security.md §2.1): Prisma connects with a database
-- role that bypasses RLS. These policies protect traffic that goes through the
-- Supabase Data API (PostgREST / supabase-js) with a user JWT. They do NOT
-- protect Prisma queries — the server-side authorization layer does that.

-- 1. Identity link -----------------------------------------------------------
-- RESTRICT (not CASCADE): account-deletion mechanics are not decided, so deleting
-- an auth user must not silently delete application data.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_auth_users_fkey
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE RESTRICT;

-- 2. Profile bootstrap ---------------------------------------------------------
-- Creates only the profile. It does NOT create a student/parent account, any
-- membership, or any role — those require explicit, authorized server actions.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Integrity checks ------------------------------------------------------------
ALTER TABLE public.parent_student_links
  ADD CONSTRAINT parent_student_links_not_self
  CHECK (parent_profile_id <> student_profile_id);

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_ended_at_matches_status
  CHECK ((status = 'ENDED') = (ended_at IS NOT NULL));

-- 4. Authorization helper functions ----------------------------------------------
-- SECURITY DEFINER so policies on `memberships` can consult `memberships`
-- without recursive RLS evaluation. search_path is pinned to avoid hijacking.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO authenticated;

CREATE OR REPLACE FUNCTION app.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.profile_id = auth.uid()
  );
$$;

-- Only ACTIVE memberships grant tenant access. An ENDED membership grants nothing.
CREATE OR REPLACE FUNCTION app.has_tenant_role(p_tenant_id uuid, p_roles public."TenantRole"[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = p_tenant_id
      AND m.profile_id = auth.uid()
      AND m.status = 'ACTIVE'
      AND m.role = ANY (p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION app.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT app.has_tenant_role(p_tenant_id, ARRAY['MARKAZ_ADMIN', 'TEACHER', 'STUDENT']::public."TenantRole"[]);
$$;

-- True when the caller is an ACTIVE Markaz Admin of a tenant in which the target
-- profile currently holds an ACTIVE membership.
CREATE OR REPLACE FUNCTION app.administers_member(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships target
    JOIN public.memberships admin
      ON admin.tenant_id = target.tenant_id
    WHERE target.profile_id = p_profile_id
      AND target.status = 'ACTIVE'
      AND admin.profile_id = auth.uid()
      AND admin.role = 'MARKAZ_ADMIN'
      AND admin.status = 'ACTIVE'
  );
$$;

-- Only an ACTIVE link grants a Parent access. PENDING / VERIFIED / REVOKED grant nothing.
CREATE OR REPLACE FUNCTION app.has_active_parent_link(p_student_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links l
    WHERE l.student_profile_id = p_student_profile_id
      AND l.parent_profile_id = auth.uid()
      AND l.status = 'ACTIVE'
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;

-- 5. Row Level Security ---------------------------------------------------------
-- Deny-by-default: RLS on, no policy for `anon`, read-only policies for `authenticated`.
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_links  ENABLE ROW LEVEL SECURITY;

-- Belt and braces: Supabase grants table privileges to anon/authenticated by default.
REVOKE ALL ON public.profiles, public.platform_admins, public.tenants, public.memberships,
  public.student_accounts, public.parent_accounts, public.parent_student_links
  FROM anon, authenticated;
GRANT SELECT ON public.profiles, public.platform_admins, public.tenants, public.memberships,
  public.student_accounts, public.parent_accounts, public.parent_student_links
  TO authenticated;

-- profiles: self; Markaz Admin for active members of their own Markaz;
-- Parent for an ACTIVE-linked child; platform admin.
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR app.is_platform_admin()
  OR app.administers_member(id)
  OR app.has_active_parent_link(id)
);

-- platform_admins: a user may see whether they themselves are a platform admin;
-- platform admins see the list.
CREATE POLICY platform_admins_select ON public.platform_admins FOR SELECT TO authenticated
USING (profile_id = auth.uid() OR app.is_platform_admin());

-- tenants: active members of that tenant; platform admin.
CREATE POLICY tenants_select ON public.tenants FOR SELECT TO authenticated
USING (app.is_tenant_member(id) OR app.is_platform_admin());

-- memberships: own rows (including ENDED, for history); all rows of a tenant the
-- caller actively administers; platform admin. Teachers/students do NOT see other
-- members' rows — roster visibility for those roles is not decided.
CREATE POLICY memberships_select ON public.memberships FOR SELECT TO authenticated
USING (
  profile_id = auth.uid()
  OR app.has_tenant_role(tenant_id, ARRAY['MARKAZ_ADMIN']::public."TenantRole"[])
  OR app.is_platform_admin()
);

-- student_accounts: the student; ACTIVE-linked parent; Markaz Admin of a Markaz
-- where the student is an active member; platform admin.
CREATE POLICY student_accounts_select ON public.student_accounts FOR SELECT TO authenticated
USING (
  profile_id = auth.uid()
  OR app.has_active_parent_link(profile_id)
  OR app.administers_member(profile_id)
  OR app.is_platform_admin()
);

-- parent_accounts: the parent; platform admin.
CREATE POLICY parent_accounts_select ON public.parent_accounts FOR SELECT TO authenticated
USING (profile_id = auth.uid() OR app.is_platform_admin());

-- parent_student_links: the parent sees their own links in every state (so a
-- PENDING link is visible to them); platform admin. Whether the student or a
-- Markaz Admin sees links depends on the undecided verification workflow (OQ14).
CREATE POLICY parent_student_links_select ON public.parent_student_links FOR SELECT TO authenticated
USING (parent_profile_id = auth.uid() OR app.is_platform_admin());
