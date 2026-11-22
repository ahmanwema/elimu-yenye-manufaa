-- A join link carries the ROLE the person will hold (owner decision 2026-11-22).
--
-- Until now a link could only make a STUDENT. The owner wants one link per role: a Super Admin
-- sends a Markaz Admin link to whoever will run a new Markaz, and that Markaz Admin sends
-- Teacher, Finance Officer and Student links. Who may issue which role is an authorization
-- rule, in src/server/authz/policy.ts -- only a Super Admin may issue a MARKAZ_ADMIN link, so
-- A52 still holds: a Markaz Admin cannot create another Markaz Admin.
--
-- ADDITIVE. The column defaults to STUDENT, which is exactly what every existing row means.

ALTER TABLE public.join_links
  ADD COLUMN role "TenantRole" NOT NULL DEFAULT 'STUDENT';

-- A class only makes sense for a student: the other roles are not enrolled in anything.
ALTER TABLE public.join_links
  ADD CONSTRAINT join_link_class_only_for_students CHECK (class_id IS NULL OR role = 'STUDENT');
