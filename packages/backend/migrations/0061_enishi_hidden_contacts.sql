CREATE TABLE enishi_hidden_contacts (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_enishi_hidden_contacts_unique ON enishi_hidden_contacts(member_id, contact_id);
