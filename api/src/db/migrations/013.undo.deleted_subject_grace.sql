ALTER TABLE users
  DROP KEY idx_users_deleted_subject,
  DROP CONSTRAINT chk_users_subject_hash_is_deleted,
  DROP COLUMN deleted_subject_hash;
