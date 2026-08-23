-- Configuration, at the two levels that have ever been asked for: one value for
-- the installation, and one value for a person who wants something else.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY TWO TABLES AND NOT ONE
--
-- The obvious shape is a single table with a nullable user_id, NULL meaning
-- "global". It cannot hold its own uniqueness: MySQL permits many NULLs under a
-- UNIQUE key, so `UNIQUE (user_id, setting_key)` would allow two global rows
-- for the same key and the resolver would have to pick one. Making that illegal
-- needs a STORED generated column over IFNULL(user_id, 0) — and this schema has
-- already paid for a generated column once, in migration 007, where it cost a
-- cascade (MySQL error 1215).
--
-- Split in two, both primary keys are NOT NULL and the uniqueness is real
-- without a trick. The scopes also do not share their columns: a global row
-- records which admin last changed it, because that is an administrative act on
-- everybody's behalf, and a personal row has nobody to name but its owner.
--
-- WHY KEY/VALUE ROWS AND NOT A JSON DOCUMENT PER SCOPE
--
-- A document is read-modify-write. Two admins with the settings screen open
-- would each send a whole document and the second would silently undo the
-- first. Rows make a write name exactly the setting it changes.
--
-- WHAT IS NOT HERE
--
-- Defaults. They live in src/settings/registry.ts, and a table with no row for
-- a key is the normal, expected state rather than a missing one. That is what
-- lets a new setting arrive without a migration, and it is also what makes
-- "using the default" answerable: the absence of a row IS the answer.
--
-- Types, too. The registry declares what a key accepts and validates every
-- write against it; the column below only has to hold the result.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app_settings (
  -- The key IS the identity. No surrogate id: there is nothing else a row could
  -- be looked up by, and a second key for the same setting is meaningless.
  setting_key VARCHAR(80) NOT NULL,

  -- JSON rather than a text column with a convention. A setting is a boolean, a
  -- number, a string or a list of strings depending on the key, and JSON is the
  -- one column type that stores all four without the repository having to
  -- serialise on the way in and guess on the way out.
  value       JSON NOT NULL,

  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- Which admin last changed it. NULL only where a row predates a known actor,
  -- which today means the seed.
  updated_by  BIGINT UNSIGNED NULL,

  PRIMARY KEY (setting_key),
  KEY idx_app_settings_updated_by (updated_by),

  -- RESTRICT, matching every other reference to a user in this schema. An
  -- account is anonymised rather than deleted (migration 011), so this never
  -- blocks anybody's departure — it blocks a row vanishing and taking the
  -- record of who changed a setting with it.
  CONSTRAINT fk_app_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE user_settings (
  user_id     BIGINT UNSIGNED NOT NULL,
  setting_key VARCHAR(80) NOT NULL,
  value       JSON NOT NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- One row per person per key, enforced by the key itself rather than by a
  -- unique index over a surrogate. A second override for the same key is not a
  -- conflict to resolve, it is a row that cannot exist.
  PRIMARY KEY (user_id, setting_key),

  -- CASCADE, and the only place in this schema where a user reference does.
  -- These rows are the person's own preferences and nothing else refers to
  -- them: unlike their requests, comments and votes, there is nothing here for
  -- anybody else to lose. Anonymising an account deletes them explicitly
  -- (migration 011 explains why), and this cascade is the backstop that keeps
  -- them from outliving a row that is ever genuinely removed.
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
