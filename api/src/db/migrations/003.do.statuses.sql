-- Admin-managed workflow states. Same name/slug split and retirement rule as
-- categories, plus a designated default for newly created requests.
CREATE TABLE statuses (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(60) NOT NULL,
  slug        VARCHAR(60) NOT NULL,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  archived_at DATETIME(3) NULL,

  -- The status a newly created request receives, so that POST /api/requests does
  -- not hardcode the string 'New' against a row an admin is free to rename.
  is_default  TINYINT(1) NOT NULL DEFAULT 0,

  -- This generated column plus the unique key below enforce AT MOST ONE default.
  -- They do NOT enforce "exactly one": nothing here prevents an admin clearing
  -- every default and leaving the table without one, which would break request
  -- creation. That lower bound is enforced in application logic when statuses are
  -- edited, and request creation fails loudly rather than silently if it is ever
  -- violated. See api/src/modules/requests/requests.service.ts.
  is_default_marker TINYINT UNSIGNED GENERATED ALWAYS AS (IF(is_default = 1, 1, NULL)) STORED,

  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_statuses_slug (slug),
  UNIQUE KEY uq_statuses_name (name),
  UNIQUE KEY uq_statuses_single_default (is_default_marker),
  KEY idx_statuses_display_order (sort_order, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
