-- Comment moderation before publication: the column the pending decision said
-- this would take, arriving with the setting that switches it on.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY EVERY COMMENT IS STAMPED, INCLUDING WHEN THE GATE IS OFF
--
-- approved_at is set at insert whenever moderation is off, so it means "this
-- comment has cleared publication" and not "an admin looked at this one". The
-- alternative — NULL for everything written while the gate was off — would mean
-- that switching moderation ON hid every comment ever written, retroactively,
-- because none of them carried an approval. A setting that erases the history
-- of the board the moment it is enabled is not a setting anybody can try.
--
-- The rule that falls out of it is worth stating plainly, because it is the one
-- an admin has to be able to predict:
--
--   turning moderation ON  affects comments written from then on, and nothing
--                          that is already on screen
--   turning moderation OFF releases whatever is waiting, because the visibility
--                          test asks whether the gate is up NOW as well as
--                          whether the row cleared it
--
-- Without the second half, comments written during a moderated week would be
-- stranded forever the moment an admin decided moderation was more trouble than
-- it was worth: invisible, and with nothing left in the interface to approve
-- them from.
--
-- WHY NOT approved_by
--
-- deleted_by exists on this table because a moderator removing somebody's words
-- is contested and needs a name against it. Approval is the opposite act — it
-- lets the words stand as written — and nobody is served by knowing which admin
-- waved a comment through. The audit trail is for what was taken away.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE comments
  ADD COLUMN approved_at DATETIME(3) NULL AFTER edited_at,

  -- Serves the moderation queue: everything still waiting, oldest first. The
  -- queue is the only listing that reads this column on its own rather than as
  -- one term in a visibility test, and it is the one an admin sits in front of.
  ADD KEY idx_comments_pending (approved_at, created_at);

-- Everything that already exists was written under no gate at all, so it has
-- already cleared publication. Stamped from created_at rather than from now, so
-- the column never claims a comment was approved before it was written.
UPDATE comments SET approved_at = created_at;
