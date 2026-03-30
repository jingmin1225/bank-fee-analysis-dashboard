require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./db');

const migrations = [
/* ══════════════════════════════════════════
   001 — USERS & ROLES
══════════════════════════════════════════ */
`CREATE TYPE user_role AS ENUM ('admin','treasurer','document_manager','individual')`,

`CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'individual',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE TABLE IF NOT EXISTS user_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE TABLE IF NOT EXISTS user_group_members (
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  user_group_id UUID REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, user_group_id)
)`,

/* ══════════════════════════════════════════
   002 — REQUEST TYPES
══════════════════════════════════════════ */
`CREATE TYPE entity_type AS ENUM ('Company','Account','Signer','Authority','Other')`,

`CREATE TABLE IF NOT EXISTS request_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  mapped_entity_type entity_type NOT NULL DEFAULT 'Account',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

/* ══════════════════════════════════════════
   003 — DOCUMENT TYPES
══════════════════════════════════════════ */
`CREATE TYPE doc_category AS ENUM (
  'Certificate of Incorporation','Balance Sheet','Personal ID',
  'Board Resolution','Account Agreement','MoA / AoA','PoA','Other'
)`,

`CREATE TABLE IF NOT EXISTS document_types (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  category     doc_category NOT NULL DEFAULT 'Other',
  entity_type  entity_type NOT NULL DEFAULT 'Company',
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

/* ══════════════════════════════════════════
   004 — DOCUMENTATION RULES
══════════════════════════════════════════ */
`CREATE TABLE IF NOT EXISTS documentation_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type_id     UUID NOT NULL REFERENCES request_types(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  rank                INTEGER NOT NULL DEFAULT 1,
  conditions          JSONB NOT NULL DEFAULT '[]',
  required_documents  JSONB NOT NULL DEFAULT '[]',
  company_ownership   TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE INDEX IF NOT EXISTS idx_doc_rules_request_type ON documentation_rules(request_type_id)`,
`CREATE INDEX IF NOT EXISTS idx_doc_rules_rank ON documentation_rules(request_type_id, rank)`,

/* ══════════════════════════════════════════
   005 — DOCUMENT MANAGERS
══════════════════════════════════════════ */
`CREATE TABLE IF NOT EXISTS document_managers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conditions               JSONB NOT NULL DEFAULT '{}',
  assigned_user_ids        UUID[] NOT NULL DEFAULT '{}',
  assigned_user_group_ids  UUID[] NOT NULL DEFAULT '{}',
  notification_template_id UUID,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

/* ══════════════════════════════════════════
   006 — ENTITIES
══════════════════════════════════════════ */
`CREATE TABLE IF NOT EXISTS entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  entity_type entity_type NOT NULL,
  country     TEXT,
  currency    TEXT,
  source      TEXT NOT NULL DEFAULT 'Manual',
  metadata    JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`,
`CREATE INDEX IF NOT EXISTS idx_entities_code ON entities(code)`,

/* ══════════════════════════════════════════
   007 — ENTITY DOCUMENTS
══════════════════════════════════════════ */
`CREATE TABLE IF NOT EXISTS entity_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  document_type_id   UUID NOT NULL REFERENCES document_types(id),
  file_name          TEXT,
  file_url           TEXT,
  file_path          TEXT,
  issuance_date      DATE NOT NULL,
  expiration_date    DATE,
  comment            TEXT,
  uploaded_by        UUID REFERENCES users(id),
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by    UUID REFERENCES users(id),
  last_updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE INDEX IF NOT EXISTS idx_entity_docs_entity ON entity_documents(entity_id)`,
`CREATE INDEX IF NOT EXISTS idx_entity_docs_type ON entity_documents(document_type_id)`,

/* ══════════════════════════════════════════
   008 — DOCUMENT REQUIREMENTS
══════════════════════════════════════════ */
`CREATE TYPE doc_status AS ENUM ('Available','WillExpireSoon','Expired','Missing')`,

`CREATE TABLE IF NOT EXISTS document_requirements (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                  UUID NOT NULL,
  entity_id                   UUID NOT NULL REFERENCES entities(id),
  document_type_id            UUID NOT NULL REFERENCES document_types(id),
  is_mandatory                BOOLEAN NOT NULL DEFAULT TRUE,
  document_status             doc_status NOT NULL DEFAULT 'Missing',
  assigned_doc_manager_id     UUID REFERENCES document_managers(id),
  latest_document_id          UUID REFERENCES entity_documents(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

`CREATE INDEX IF NOT EXISTS idx_doc_req_request ON document_requirements(request_id)`,
`CREATE INDEX IF NOT EXISTS idx_doc_req_status ON document_requirements(document_status)`,

/* ══════════════════════════════════════════
   009 — NOTIFICATION LOGS
══════════════════════════════════════════ */
`CREATE TYPE notif_trigger AS ENUM ('Manual','Scheduled')`,

`CREATE TABLE IF NOT EXISTS notification_logs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id         UUID REFERENCES users(id),
  notification_template_id  UUID,
  sent_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_type              notif_trigger NOT NULL DEFAULT 'Manual',
  request_id                UUID,
  document_requirement_ids  UUID[] NOT NULL DEFAULT '{}'
)`,

/* ══════════════════════════════════════════
   010 — API INTEGRATIONS
══════════════════════════════════════════ */
`CREATE TABLE IF NOT EXISTS api_integrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_name  TEXT NOT NULL,
  auth_url         TEXT,
  base_url         TEXT NOT NULL,
  client_id        TEXT,
  client_secret    TEXT,
  scope            TEXT,
  auth_type        TEXT NOT NULL DEFAULT 'OAuth2 Client Credentials',
  last_sync_at     TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

/* ══════════════════════════════════════════
   011 — updated_at trigger function
══════════════════════════════════════════ */
`CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql`,

...['request_types','document_types','documentation_rules','document_managers',
    'entities','entity_documents','document_requirements','api_integrations',
    'users'].map(t =>
  `CREATE OR REPLACE TRIGGER trg_${t}_updated_at
   BEFORE UPDATE ON ${t}
   FOR EACH ROW EXECUTE FUNCTION set_updated_at()`
),
];

async function migrate() {
  console.log('Running BAM migrations…');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of migrations) {
      try {
        await client.query(sql);
      } catch (err) {
        if (err.code === '42710' || err.code === '42P07') {
          // type/table already exists — skip
        } else {
          throw err;
        }
      }
    }
    await client.query('COMMIT');
    console.log('✅  Migrations complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
