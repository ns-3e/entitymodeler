-- One-time sign-in links sent by email. Stored by SHA-256 of the token; each works once, for 15 minutes.
CREATE TABLE email_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  return_path TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_links_email ON email_links(email, created_at);
