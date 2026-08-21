-- A hidden comment has three possible explanations and the previous shape could
-- only tell two of them apart.
--
--   1. Its author removed it            -> deleted_by = author_id
--   2. An admin moderated it            -> deleted_by <> author_id
--   3. It is a reply, hidden because the comment it answered was removed
--                                       -> deleted_by = whoever removed the PARENT
--
-- Cases 2 and 3 are indistinguishable from deleted_by alone: when an author
-- removes their own comment, every reply underneath is hidden with it and
-- stamped with that author's id, which does not match the reply author's. The
-- screen would then accuse an ordinary user of moderating somebody, and the
-- reply author would be told an admin removed their words when nobody did.
--
-- This is not derivable, so it is recorded. Cases 1 and 2 stay derived from
-- deleted_by, because that genuinely is a fact about the data rather than a
-- second copy of one.
ALTER TABLE comments
  ADD COLUMN hidden_with_parent TINYINT(1) NOT NULL DEFAULT 0 AFTER deleted_by,

  -- A row cannot be hidden-with-its-parent while it is not hidden at all. The
  -- check deliberately touches only deleted_at and the new column: MySQL
  -- refuses a CHECK on a column carrying a referential action, and parent_id
  -- carries ON UPDATE CASCADE.
  ADD CONSTRAINT chk_comments_hidden_with_parent
    CHECK (hidden_with_parent = 0 OR deleted_at IS NOT NULL);
