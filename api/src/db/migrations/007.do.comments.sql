-- Comments on a feedback request, one level of replies deep.
--
-- Deletion here is two different things and the table has to carry both:
--   * Deleting the REQUEST removes its comments outright — they have no
--     meaning without the thing they discuss, so this cascades.
--   * Deleting a COMMENT hides it. The row stays, with deleted_at and
--     deleted_by recording when and by whom, because a moderator removing
--     somebody else's words is exactly the kind of act that needs a trail.
CREATE TABLE comments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,

  -- NULL for a top-level comment; the comment being replied to otherwise.
  parent_id  BIGINT UNSIGNED NULL,

  author_id  BIGINT UNSIGNED NOT NULL,
  body       TEXT NOT NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- Distinct from updated_at, which also moves when a comment is hidden or
  -- restored. "Edited" is a claim about the text, so it needs its own column
  -- rather than being inferred from a timestamp that changes for other reasons.
  edited_at  DATETIME(3) NULL,

  -- Set together or not at all; see chk_comments_deletion below.
  deleted_at DATETIME(3) NULL,
  deleted_by BIGINT UNSIGNED NULL,

  PRIMARY KEY (id),

  -- Exists to be the target of fk_comments_parent below, which is what makes a
  -- reply provably belong to the same request as the comment it answers.
  UNIQUE KEY uq_comments_id_request (id, request_id),

  -- Serves both halves of a thread: the top-level comments of a request
  -- (parent_id IS NULL) and the replies to one of them, oldest first.
  KEY idx_comments_thread (request_id, parent_id, created_at, id),
  KEY idx_comments_author (author_id),
  KEY idx_comments_deleted_by (deleted_by),

  CONSTRAINT fk_comments_request FOREIGN KEY (request_id) REFERENCES feedback_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- Composite on purpose. A plain reference to comments(id) would allow a reply
  -- on one request to answer a comment on another; including request_id in both
  -- sides makes that impossible rather than merely unlikely.
  --
  -- CASCADE so that removing a request takes roots and replies with it. Without
  -- it the self-reference blocks its own parent's deletion — verified, not
  -- assumed: with the default RESTRICT, deleting a request fails with error
  -- 1451 while its replies still point at their root.
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id, request_id)
    REFERENCES comments (id, request_id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- RESTRICT, matching every other reference to a user. Account deletion is its
  -- own slice and must decide what happens to a departing user's words.
  CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- No ON UPDATE action, unlike the others: MySQL refuses a CHECK constraint on
  -- a column that carries a referential action (error 3818). User ids never
  -- change, so the cascade bought nothing and the check is worth more.
  CONSTRAINT fk_comments_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id)
    ON DELETE RESTRICT,

  -- A hidden comment always records who hid it, and a comment with a moderator
  -- recorded is always hidden. Half a deletion is not a state this table has.
  CONSTRAINT chk_comments_deletion CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS SCHEMA DOES NOT ENFORCE, AND WHY
--
-- "A reply cannot be replied to" is not a database constraint here. It can be
-- expressed in MySQL — a generated column marking root rows, a unique key on
-- (id, is_root), and a composite foreign key from (parent_id, 1) to it. That
-- was built and tested, and it works: inserting a reply to a reply fails with
-- error 1452.
--
-- It cannot coexist with the cascade above. MySQL refuses ON DELETE CASCADE on
-- a foreign key involving generated columns (error 1215), so the choice was
-- between the database guaranteeing the depth limit and the database
-- guaranteeing that deleting a request removes its comments. Only one was
-- available, and losing the cascade would have meant comments outliving the
-- request they belong to unless application code remembered otherwise — the
-- worse failure of the two.
--
-- So depth is enforced in the service layer when a reply is created: the parent
-- must exist and must itself have parent_id IS NULL. The two rules the database
-- does keep — a reply belongs to its parent's request, and a hidden comment
-- names its moderator — are the ones it can hold without giving anything up.
-- ─────────────────────────────────────────────────────────────────────────────
