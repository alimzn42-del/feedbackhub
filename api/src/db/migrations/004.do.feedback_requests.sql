CREATE TABLE feedback_requests (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(160) NOT NULL,

  -- TEXT is generous; the API caps submissions well below the column limit.
  description TEXT NOT NULL,

  category_id BIGINT UNSIGNED NOT NULL,
  status_id   BIGINT UNSIGNED NOT NULL,
  author_id   BIGINT UNSIGNED NOT NULL,

  -- No endpoint sets this in slice 1; pin/unpin is admin-only and arrives later.
  is_pinned   TINYINT(1) NOT NULL DEFAULT 0,

  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),

  -- Serves the current default sort: pinned first, then newest first. `id` is the
  -- tiebreaker that makes the ordering a total order — without it two rows sharing
  -- a millisecond can swap between page 1 and page 2 under offset pagination.
  --
  -- This index does not generalise. The brief also requires sorting by vote count,
  -- which becomes the primary sort key once voting lands; that count is derived
  -- rather than stored, so it cannot be served by this index and will need its own
  -- treatment in that slice.
  KEY idx_requests_feed (is_pinned DESC, created_at DESC, id DESC),

  KEY idx_requests_category (category_id),
  KEY idx_requests_status (status_id),
  KEY idx_requests_author (author_id),

  -- RESTRICT throughout. Deleting a category, a status or a user is a decision
  -- with consequences for existing content; the database refuses until the
  -- application says explicitly what should happen instead of cascading silently.
  CONSTRAINT fk_requests_category FOREIGN KEY (category_id) REFERENCES categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_requests_status FOREIGN KEY (status_id) REFERENCES statuses (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_requests_author FOREIGN KEY (author_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
