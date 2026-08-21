-- Pinning gains an actor and a time, which the boolean could not carry.
--
-- is_pinned is REPLACED rather than supplemented. Keeping both would mean two
-- columns describing one fact, free to disagree the first time something writes
-- one and forgets the other — the same argument that keeps a vote counter out
-- of this schema. "Pinned" is now derived: pinned_at IS NOT NULL.
ALTER TABLE feedback_requests
  ADD COLUMN pinned_at DATETIME(3) NULL,
  ADD COLUMN pinned_by BIGINT UNSIGNED NULL;

-- Preserve anything already pinned. The actor is unknown for these — nobody
-- recorded it — and pinned_by stays NULL rather than inventing an admin.
UPDATE feedback_requests SET pinned_at = CURRENT_TIMESTAMP(3) WHERE is_pinned = 1;

-- idx_requests_feed led with is_pinned, so it goes with the column.
ALTER TABLE feedback_requests DROP INDEX idx_requests_feed;
ALTER TABLE feedback_requests DROP COLUMN is_pinned;

ALTER TABLE feedback_requests
  -- RESTRICT, like every other reference to a user. An admin who pinned things
  -- cannot be deleted without the account-deletion slice deciding what that
  -- means.
  ADD CONSTRAINT fk_requests_pinned_by FOREIGN KEY (pinned_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Serves both halves of the split board: the pinned panel reads
  -- WHERE pinned_at IS NOT NULL ORDER BY pinned_at DESC, and the main list
  -- filters WHERE pinned_at IS NULL.
  ADD KEY idx_requests_pinned (pinned_at DESC, id DESC),

  -- For the "newest first" option arriving with the filters slice. The default
  -- sort is by vote count, which no index can serve.
  ADD KEY idx_requests_recent (created_at DESC, id DESC);
