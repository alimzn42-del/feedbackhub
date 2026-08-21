-- One row per vote. There is no count column anywhere in this schema: the total
-- is derived by counting these rows when the board is queried. A stored counter
-- would be one more thing that can drift away from the rows it claims to count,
-- and nothing here is hot enough to earn that risk.
CREATE TABLE votes (
  user_id    BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- The primary key IS the "one user, one request, at most once" rule. It is
  -- enforced by the database rather than by an application check that a future
  -- code path could forget to make.
  --
  -- request_id leads deliberately. InnoDB clusters rows on the primary key, so
  -- counting the votes for a request is a contiguous range scan, and the board
  -- query aggregates by request_id on every page load. The reverse lookup —
  -- "has this user voted on these twenty requests" — is served by the secondary
  -- key below.
  PRIMARY KEY (request_id, user_id),
  KEY idx_votes_user (user_id, request_id),

  -- CASCADE here, where the rest of this schema uses RESTRICT, and deliberately
  -- so. A vote has no meaning without the request it is attached to, and
  -- deleting a request is already permitted for its author and for admins;
  -- refusing that deletion because somebody voted would be the wrong answer.
  CONSTRAINT fk_votes_request FOREIGN KEY (request_id) REFERENCES feedback_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- RESTRICT, matching feedback_requests.author_id. Account deletion is its own
  -- slice and has to decide what happens to a departing user's votes rather
  -- than having them disappear silently as a side effect.
  CONSTRAINT fk_votes_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
