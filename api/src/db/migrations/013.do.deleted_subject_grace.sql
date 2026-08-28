-- The gap between an account being deleted and the token for it expiring.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FAILURE THIS CLOSES
--
-- Anonymisation clears external_id and moves the address to a placeholder, both
-- of which are correct and both of which have the same consequence: the next
-- request carrying the SAME access token — still signed, still unexpired, up to
-- five more minutes of life in it — matches no row on external_id, finds the
-- address free, and is provisioned a brand new account. The person who pressed
-- Delete is signed straight back in as a stranger with their own name on it,
-- and the board now holds two rows for them.
--
-- The web application did this to itself within a second of the 204 (it called
-- config.reload() afterwards, which is fixed on that side too). But the client
-- is not where this belongs: any client holding a valid token can do it, and
-- "please sign out first" is not a rule an API can enforce by asking nicely.
--
-- SCOPE says a returning person gets a new account. That stays true. What it
-- does not say, and what this refuses, is that the SAME SESSION should get one.
--
-- WHY A HASH AND NOT THE SUBJECT
--
-- chk_users_deleted_has_no_external_id says a departed row carries no
-- provider subject, and that constraint is the right one — keeping the raw
-- `sub` would leave the identity provider's identifier sitting in a row whose
-- entire purpose is that it no longer identifies anybody.
--
-- A SHA-256 of the subject is enough for the only question ever asked of it:
-- "is this exact subject the one that just left?" It cannot be read backwards
-- into an identifier, it cannot be used to look anybody up at the provider, and
-- it is compared only against a value the API already has in its hand.
--
-- WHY A COLUMN AND NOT A CACHE IN MEMORY
--
-- There are two API replicas in the deployment manifests and no shared cache.
-- A refusal that only one pod knows about is not a refusal.
--
-- NOT UNIQUE, on purpose: somebody may leave, return, and leave again, and each
-- departure is its own row. The lookup is "the most recent one, if it is recent
-- enough", which is what the index serves.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN deleted_subject_hash CHAR(64) NULL AFTER deleted_at,

  -- Only a departed row may carry one: it is written by the same statement that
  -- sets deleted_at, from the subject that statement is clearing.
  ADD CONSTRAINT chk_users_subject_hash_is_deleted
    CHECK (deleted_subject_hash IS NULL OR deleted_at IS NOT NULL),

  -- The grace lookup: one subject, most recent departure first.
  ADD KEY idx_users_deleted_subject (deleted_subject_hash, deleted_at);

-- Rows anonymised before this migration have no hash, so they are outside the
-- grace period by construction. That is correct rather than a gap: their tokens
-- expired long before this schema change was applied.
