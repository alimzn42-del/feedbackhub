ALTER TABLE feedback_requests DROP FOREIGN KEY fk_requests_pinned_by;

ALTER TABLE feedback_requests
  DROP INDEX idx_requests_pinned,
  DROP INDEX idx_requests_recent,
  ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0;

UPDATE feedback_requests SET is_pinned = 1 WHERE pinned_at IS NOT NULL;

ALTER TABLE feedback_requests
  DROP COLUMN pinned_at,
  DROP COLUMN pinned_by,
  ADD KEY idx_requests_feed (is_pinned DESC, created_at DESC, id DESC);
