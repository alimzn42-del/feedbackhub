-- Admin-managed taxonomy, not an application enum.
CREATE TABLE categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- `name` is the display label and admins may rename it freely.
  name        VARCHAR(60) NOT NULL,

  -- `slug` is the stable handle. List filters live in URL query parameters, so a
  -- shared or bookmarked link must survive an admin renaming the category.
  slug        VARCHAR(60) NOT NULL,

  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  -- Categories are retired, never deleted: existing requests must keep pointing
  -- at something. Paired with ON DELETE RESTRICT on the referencing tables.
  archived_at DATETIME(3) NULL,

  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  UNIQUE KEY uq_categories_name (name),
  KEY idx_categories_display_order (sort_order, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
