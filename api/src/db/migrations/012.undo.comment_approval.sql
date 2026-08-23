ALTER TABLE comments
  DROP KEY idx_comments_pending,
  DROP COLUMN approved_at;
