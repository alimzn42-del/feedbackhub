-- Account deletion, which in this application is anonymisation.
--
-- The decision it implements: the person goes, their contributions stay. A
-- request with six votes and a thread underneath it does not become a hole in
-- the board because its author left, and the five people who commented do not
-- lose the conversation they had.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS ONE NULLABLE COLUMN AND NOT A DELETE
--
-- feedback_requests.author_id, comments.author_id, comments.deleted_by and
-- votes.user_id are all ON DELETE RESTRICT. That was never an obstacle waiting
-- to be removed: it is the schema refusing to let a person's departure silently
-- rewrite other people's screens. Anonymising leaves every one of those
-- references intact and pointing at a row that no longer says who it was.
--
-- So there is no cascade to add here and no reference to change. The erasure
-- happens in the UPDATE the endpoint runs, not in the schema:
--
--   external_id  -> NULL   the identity provider can no longer match anybody
--   email        -> a per-id placeholder at an unroutable domain
--   display_name -> a placeholder
--   deleted_at   -> now
--
-- email cannot simply be emptied: it is NOT NULL UNIQUE, and every departed
-- account would collide on the empty string. A placeholder built from the id is
-- unique by construction and carries nothing about the person.
--
-- WHY deleted_at EXISTS AT ALL, GIVEN THE FIELDS ARE ALREADY CLEARED
--
-- Two reasons, and neither is bookkeeping. The identity seam has to refuse a
-- departed account rather than treat the placeholder as a login; and a screen
-- rendering "Deleted user" must be able to tell a real person who chose that
-- display name from an account that is gone. Deriving either from the shape of
-- the email placeholder would be a string convention doing a column's job.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER updated_at,

  -- A departed account has no identity-provider subject. The reverse is not
  -- constrained: a live account has external_id NULL too, until authentication
  -- lands.
  ADD CONSTRAINT chk_users_deleted_has_no_external_id
    CHECK (deleted_at IS NULL OR external_id IS NULL);
