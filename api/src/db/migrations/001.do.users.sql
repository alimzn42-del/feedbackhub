-- Local identity table. Profile fields and preferences live here rather than in
-- the identity provider, so the application owns its own user data.
CREATE TABLE users (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Will hold the identity provider's `sub` once authentication lands. NULL
  -- until then; MySQL permits many NULLs under a UNIQUE key, so the constraint
  -- is correct from day one without blocking the seeded users.
  external_id  VARCHAR(255) NULL,

  email        VARCHAR(320) NOT NULL,
  display_name VARCHAR(120) NOT NULL,

  -- Deliberately an ENUM and not a taxonomy table: the policy module branches on
  -- these two literals, which makes them code. Categories and statuses are tables
  -- precisely because no code branches on their values.
  role         ENUM('user', 'admin') NOT NULL DEFAULT 'user',

  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_external_id (external_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
