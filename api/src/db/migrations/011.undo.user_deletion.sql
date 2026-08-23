ALTER TABLE users
  DROP CONSTRAINT chk_users_deleted_has_no_external_id,
  DROP COLUMN deleted_at;
