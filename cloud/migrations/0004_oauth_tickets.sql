-- A short-lived note of an OAuth authorization in progress. It keeps the (long) request out of sign-in cookies and
-- links, and a consent form can be submitted only once, by the person it was shown to. Stored by SHA-256, as sessions are.
CREATE TABLE oauth_tickets (
  token_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  -- Set on the consent form's ticket, and empty while the person still has to sign in.
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX oauth_tickets_expiry ON oauth_tickets(expires_at);
