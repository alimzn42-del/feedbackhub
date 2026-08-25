-- Baseline data: the first admin, two regular users, and the taxonomy from the
-- brief. Re-running this file is safe — every insert reconciles against the
-- natural key rather than creating duplicates.
--
-- Decision 6: the first admin comes from seed data. There is no bootstrap
-- endpoint and no `owner` role.

-- external_id is the `sub` of the matching identity in
-- keycloak/realm-feedbackhub-development.json, which pins the same three ids
-- rather than letting Keycloak generate them.
--
-- THIS IS THE JOIN BETWEEN THE TWO SETS OF PEOPLE, and it has to be written
-- down on both sides. Without it the seeded admin signs in successfully,
-- matches no row — matching is on external_id, never on the address — and gets
-- sent to provisioning, which collides with uq_users_email. The symptom is the
-- one account that can reach the admin screens being unable to get in, on a
-- board with nothing that can promote anybody else.
--
-- Change an id here and change it in the realm file in the same commit.
INSERT INTO users (email, display_name, role, external_id) VALUES
  ('admin@feedbackhub.local', 'Robin Alvarez', 'admin', '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a01'),
  ('dana@feedbackhub.local',  'Dana Okafor',   'user',  '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a02'),
  ('sam@feedbackhub.local',   'Sam Lindqvist', 'user',  '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a03')
AS incoming
ON DUPLICATE KEY UPDATE
  display_name = incoming.display_name,
  role         = incoming.role,
  external_id  = incoming.external_id;

INSERT INTO categories (name, slug, sort_order) VALUES
  ('Bug',         'bug',         1),
  ('Feature',     'feature',     2),
  ('Improvement', 'improvement', 3),
  ('Question',    'question',    4)
AS incoming
ON DUPLICATE KEY UPDATE
  name       = incoming.name,
  sort_order = incoming.sort_order;

-- 'New' is the default. The unique key on the generated column means this stays
-- consistent even if the file is re-run after the default has been moved.
INSERT INTO statuses (name, slug, sort_order, is_default) VALUES
  ('New',          'new',          1, 1),
  ('Under Review', 'under-review', 2, 0),
  ('Planned',      'planned',      3, 0),
  ('In Progress',  'in-progress',  4, 0),
  ('Done',         'done',         5, 0),
  ('Declined',     'declined',     6, 0)
AS incoming
ON DUPLICATE KEY UPDATE
  name       = incoming.name,
  sort_order = incoming.sort_order;
