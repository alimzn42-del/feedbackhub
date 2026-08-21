ALTER TABLE comments
  DROP CONSTRAINT chk_comments_hidden_with_parent,
  DROP COLUMN hidden_with_parent;
