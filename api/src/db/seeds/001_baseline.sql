-- Baseline data: the first admin, two regular users, and the taxonomy from the
-- brief. Re-running this file is safe — every insert reconciles against the
-- natural key rather than creating duplicates.
--
-- Decision 6: the first admin comes from seed data. There is no bootstrap
-- endpoint and no `owner` role.

INSERT INTO users (email, display_name, role) VALUES
  ('admin@feedbackhub.local', 'Robin Alvarez', 'admin'),
  ('dana@feedbackhub.local',  'Dana Okafor',   'user'),
  ('sam@feedbackhub.local',   'Sam Lindqvist', 'user')
AS incoming
ON DUPLICATE KEY UPDATE
  display_name = incoming.display_name,
  role         = incoming.role;

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
