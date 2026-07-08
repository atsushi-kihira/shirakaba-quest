CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  email_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  from_email TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
