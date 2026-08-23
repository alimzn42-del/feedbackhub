-- A content edit gets its own timestamp, because updated_at cannot carry the
-- distinction.
--
-- updated_at is ON UPDATE CURRENT_TIMESTAMP(3), so pinning a request, unpinning
-- it or changing its status all move it. Deriving "edited" from
-- updated_at <> created_at would therefore mark a request as edited by its
-- author because an admin pinned it — a claim about somebody's words that
-- nobody made. The comments table keeps an explicit edited_at for exactly this
-- reason; this mirrors it.
--
-- NULL means never edited, which is the same convention comments.edited_at uses.
ALTER TABLE feedback_requests
  ADD COLUMN edited_at DATETIME(3) NULL AFTER updated_at;
