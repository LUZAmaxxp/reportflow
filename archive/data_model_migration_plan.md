# ReportFlow — Data Model & Migration Plan

> **Agent B output** · PostgreSQL · Drizzle ORM (raw SQL format recommended; see §M-tooling) · Generated 2026-02-21

---

## Table of Contents

1. [Risks & Gaps](#1-risks--gaps)
2. [Migration Sequence (0001 → 0007)](#2-migration-sequence)
3. [Slice Suggestions](#3-slice-suggestions)
4. [Acceptance Criteria per Migration Batch](#4-acceptance-criteria)

---

## 1. Risks & Gaps

### 1.1 Circular FK: `Observation` ↔ `AttestationRecord`

**Risk (HIGH).**
`Observation.attestation_record_id → AttestationRecord` and
`AttestationRecord.upgraded_by_observation_id → Observation` form a **circular foreign-key cycle**. PostgreSQL will reject both FKs if created simultaneously.

**Mitigation:** Create `AttestationRecord` first *without* `upgraded_by_observation_id`. Create `Observation` next with its FK to `AttestationRecord`. Then `ALTER TABLE attestation_record ADD COLUMN upgraded_by_observation_id UUID REFERENCES observation(observation_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED`.

Mark both FKs `DEFERRABLE INITIALLY DEFERRED` so multi-row insertions within a transaction (e.g. confirm-manual-observation flow) do not violate order constraints.

---

### 1.2 UUID Array Columns vs. Join Tables

**Risk (MEDIUM).**
Five entities use `UUID[]` columns instead of normalized join tables:

| Entity | Column | Usage |
|---|---|---|
| `Observation` | `evidence_block_ids[]` | Links obs → blocks |
| `DerivationResult` | `input_observation_ids[]` | Links derivation → observations |
| `ConflictCase` | `observation_ids[]` | All conflicting obs |
| `EvidenceBlock` | `merged_block_ids[]` | Merged source blocks |
| `Report` | `observation_ids[]`, `derivation_result_ids[]` | Report references |

**Consequences:**
- Cannot enforce FK integrity on array elements natively; referential integrity is **application-enforced only**.
- `observation_ids @> ARRAY['{id}']::uuid[]` lookups require GIN indexes and are slower than join-table equi-joins.
- When an Observation is deleted or its status changes, cascade logic must be handled in application code (no `ON DELETE CASCADE` available).
- Backfilling is operationally harder.

**Recommendation:** For MVP the arrays are acceptable on the documented tradeoff (spec is explicit about this pattern). Add GIN indexes on every array column that participates in containment queries. **Post-MVP:** migrate `evidence_block_ids`, `input_observation_ids`, and `Report` reference arrays to join tables.

Required GIN indexes:
```sql
CREATE INDEX ON observation USING GIN (evidence_block_ids);
CREATE INDEX ON derivation_result USING GIN (input_observation_ids);
CREATE INDEX ON conflict_case USING GIN (observation_ids);
CREATE INDEX ON report USING GIN (observation_ids);
CREATE INDEX ON report USING GIN (derivation_result_ids);
```

---

### 1.3 pgvector Extension and HNSW Build Time

**Risk (MEDIUM).**
`CREATE INDEX … USING hnsw` on `evidence_block.embedding` is **not a fast operation** once the table has millions of rows. Building the HNSW index at migration time on a pre-populated table can block deployment for minutes to hours.

**Mitigation:**
- On initial migration (table is empty): create the HNSW index immediately — no issue.
- If migrating against an existing table with data: use `CREATE INDEX CONCURRENTLY` (breaks transactional migration — must be run outside a transaction block in Drizzle with `{ execute: "raw" }` or a separate migration step marked `_concurrent`).
- Set `maintenance_work_mem = '1GB'` for the session before the concurrent HNSW build.

---

### 1.4 RLS Complexity and `app.current_company_id` Session Variable

**Risk (MEDIUM).**
PostgreSQL RLS depends on `current_setting('app.current_company_id')::uuid` being set on every connection. If a connection is reused from a pool without the variable being reset, a tenant-B query can accidentally run under tenant-A context (or raise a runtime error).

**Mitigations:**
- Use `SET LOCAL app.current_company_id = '...'` (transaction-scoped, rolls back on `ROLLBACK`).
- In the connection pool (e.g. PgBouncer in transaction mode, or Neon connection pooler), configure a `server_reset_query` that clears the variable: `RESET app.current_company_id`.
- All RLS policies should use `USING (company_id = current_setting('app.current_company_id', true)::uuid)` with the optional-boolean to avoid errors when the variable is unset (returns NULL, policy fails closed — no row returned).
- Add an integration test that asserts cross-tenant queries return 0 rows.

---

### 1.5 `DocumentCategory.path` Materialized Field Consistency

**Risk (MEDIUM).**
The `path` column is computed synchronously at the API layer. If a direct SQL write bypasses the API (seed scripts, migrations, admin utilities), path can become stale. There is no DB-level trigger enforcing freshness.

**Mitigation:** Add a DB-level `CHECK` constraint that path is not empty (defensive), but accept that correctness is API-enforced. Document this clearly in the schema comment. Consider a `BEFORE INSERT OR UPDATE` trigger on `document_category` that recomputes path from parent chain (optional but safer).

---

### 1.6 `Document` Missing `updated_at`

**Risk (LOW).**
The spec's §7 entity list for `Document` includes `created_at, created_by` but **no `updated_at`**. However `PATCH /api/documents/{id}/category` mutates the entity (changes `category_id`). Without `updated_at` there is no ETag/If-Modified-Since optimistic concurrency support and cache invalidation is harder.

**Recommendation:** Add `updated_at timestamptz DEFAULT now()` to `Document`. The spec's omission appears to be an oversight; the timestamp convention §7 applies to "all mutable entities".

---

### 1.7 `Report.html_snapshot` Size

**Risk (LOW-MEDIUM).**
`html_snapshot TEXT` is unbounded in PostgreSQL but the `create_report` MCP tool spec defines a `> 2MB` error. For very large reports the text column may grow. TOAST handles values > 2kB automatically, so this is a storage concern, not a correctness one.

**Mitigation:** Enforce the 2 MB cap at the API layer (spec already does this). Consider storing `html_snapshot` as a reference-only field that mirrors `html_snapshot_url` (i.e., store only URL in production, keeping the full text for dev/test). No schema change required for MVP.

---

### 1.8 `EvidenceBlock.bbox` as `float[]`

**Risk (LOW).**
`float[4]` is a PostgreSQL array. There is no constraint enforcing exactly 4 elements.

**Mitigation:** Add a `CHECK` constraint:
```sql
CONSTRAINT bbox_length CHECK (array_length(bbox, 1) = 4)
```

---

### 1.9 `DerivationResult.coverage` as JSONB

**Risk (LOW).**
The spec defines an exact shape: `{ present_periods, expected_periods, fraction }`. JSONB does not enforce this.

**Mitigation:** Add a `CHECK` constraint:
```sql
CONSTRAINT coverage_shape CHECK (
  coverage ? 'present_periods'
  AND coverage ? 'expected_periods'
  AND coverage ? 'fraction'
)
```

---

### 1.10 Missing `ON DELETE` Behavior Specification

**Risk (MEDIUM).**
The spec does not define cascade behavior for any FK. Common edge cases not addressed:
- Deleting a `User` → what happens to `created_by` fields across all entities?
- Deleting a `DocumentVersion` → cascade to `EvidenceBlock`, `PipelineRun`, `Observation`?
- Deleting a `Company` → the spec says full cascade (§12.4), but FKs must be set `ON DELETE CASCADE` to enforce at DB level.

**Recommended defaults (applied in migrations below):**

| FK direction | Policy |
|---|---|
| `→ Company` | `ON DELETE CASCADE` (full tenant deletion support) |
| `→ User` (created_by, resolved_by) | `ON DELETE SET NULL` |
| `→ DocumentVersion` | `ON DELETE CASCADE` for EvidenceBlock, PipelineRun; `ON DELETE RESTRICT` for Observation (don't silently orphan facts) |
| `→ DocumentCategory` | `ON DELETE SET NULL` (uncategorize, don't delete) |
| `→ Observation` (attestation upgrade pointer) | `ON DELETE SET NULL` |
| `→ ConflictCase` | `ON DELETE CASCADE` for ConflictResolution |
| `→ ChatSession` | `ON DELETE CASCADE` for ChatMessage |

---

### 1.11 `normalized_key` Soft Uniqueness

**Risk (LOW).**
The spec explicitly rejects a hard UNIQUE constraint on `(normalized_key, company_id, period_overlap)` because the key is user-editable and semantically fuzzy. However this means duplicate-approved observations for the exact same key+period can silently coexist if the conflict detector fails.

**Mitigation:** Add a **partial unique index** as a soft guard that trips on exact `normalized_key` + `period_start` + `period_end` + `approved` status combinations. Make it a WARNING in migration comments, not a hard constraint, since the spec intentionally rejects it. Document the invariant in code comments for the conflict handler.

---

### 1.12 `PendingManualObservation.expires_at` Enforcement

**Risk (LOW).**
`expires_at = created_at + 10 min` is defined at application layer. There is no DB-level TTL or scheduled cleanup. Expired rows with `status = 'pending'` will accumulate.

**Mitigation:** Add a periodic job (BullMQ cron) that sets `status = 'timed_out'` on rows where `expires_at < now() AND status = 'pending'`. The migration should add an index on `expires_at` for this query.

---

### 1.13 `KeyEquivalenceCache` Cache Invalidation

**Risk (LOW).**
Cached equivalence results never expire. If a user renames `normalized_key` values, a stale `SAME_KEY` cache entry could cause spurious conflict grouping.

**Mitigation:** Add a `TTL` column or periodically evict cache entries older than 30 days. Document this as a post-MVP improvement.

---

## 2. Migration Sequence

### Tooling note

**Recommended: raw SQL migrations** (not Drizzle schema-push). Reasons:
1. HNSW index requires `CREATE INDEX CONCURRENTLY` which must run outside a transaction — schema-push forbids this.
2. RLS policies, `DEFERRABLE` FKs, and session-variable functions are poorly supported in Drizzle's schema DSL.
3. Append-only `AuditLog` constraints (`NO FORCE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, table-level policies) differ from standard entity patterns.

Use Drizzle's `migrate()` runner with `.sql` file migrations in `drizzle/migrations/`.

---

### Migration 0001 — Extensions, ENUMs, Foundation Tables

**Purpose:** Install PostgreSQL extensions; define all ENUM types in a single migration (avoids ordering issues); create the three foundation entities required by all other FKs.

```sql
-- 0001_foundation.sql

BEGIN;

-- ── Extensions ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid() fallback
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- uuid_generate_v4() compat shim
CREATE EXTENSION IF NOT EXISTS "vector";          -- pgvector
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- BM25-style trigram
-- Note: UUIDv7 is generated at application layer (e.g. uuidv7 npm package).
-- PostgreSQL has no native UUIDv7 function pre-PG17; the app supplies the value.

-- ── ENUMs ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TYPE detected_doc_type AS ENUM (
  'sustainability_report', 'energy_bill', 'hr_report',
  'financial_statement', 'other'
);

CREATE TYPE pipeline_status AS ENUM (
  'uploaded', 'ocr_processing', 'ocr_done', 'embedding',
  'embedded', 'extracting', 'review_ready', 'failed'
);

CREATE TYPE block_type AS ENUM (
  'paragraph', 'table_cell', 'header', 'list_item',
  'figure_caption', 'other'
);

CREATE TYPE chunk_type AS ENUM ('original', 'merged', 'split');

CREATE TYPE observation_status AS ENUM (
  'candidate', 'approved', 'rejected', 'superseded', 'invalidated'
);

CREATE TYPE data_type_enum AS ENUM ('numeric', 'percentage', 'text', 'boolean');

CREATE TYPE time_behavior_enum AS ENUM ('periodic', 'point_in_time', 'none');

CREATE TYPE provenance_type_enum AS ENUM ('document', 'manual');

CREATE TYPE derivation_operation AS ENUM (
  'sum', 'average', 'delta', 'ratio', 'count'
);

CREATE TYPE conflict_match_method AS ENUM ('exact', 'semantic');

CREATE TYPE conflict_resolution_status AS ENUM (
  'auto_resolved', 'user_reviewed', 'user_overridden'
);

CREATE TYPE report_status AS ENUM ('draft', 'final');

CREATE TYPE pipeline_run_status AS ENUM ('running', 'completed', 'failed');

CREATE TYPE notification_type AS ENUM (
  'pipeline_completed', 'pipeline_failed', 'conflict_detected',
  'report_ready', 'manual_obs_requested'
);

CREATE TYPE chat_role AS ENUM ('user', 'agent', 'system');

CREATE TYPE chat_message_type AS ENUM (
  'user_text', 'agent_text', 'agent_tool_call',
  'manual_obs_request', 'report_ready', 'error'
);

CREATE TYPE key_equivalence_result AS ENUM ('SAME_KEY', 'DIFFERENT_KEY');

CREATE TYPE pending_obs_status AS ENUM (
  'pending', 'confirmed', 'skipped', 'timed_out'
);

-- ── Helper: auto-update updated_at ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Foundation: Company ─────────────────────────────────────────────────────

CREATE TABLE company (
  company_id   UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_company_updated_at
  BEFORE UPDATE ON company
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Foundation: User ────────────────────────────────────────────────────────
-- Note: created BEFORE Client so Client.created_by can FK → user.

CREATE TABLE "user" (
  user_id     UUID PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'viewer',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_email UNIQUE (email)
);

CREATE INDEX idx_user_company ON "user" (company_id);

CREATE TRIGGER trg_user_updated_at
  BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Foundation: Client ──────────────────────────────────────────────────────

CREATE TABLE client (
  client_id   UUID PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES "user" (user_id) ON DELETE SET NULL
);

CREATE INDEX idx_client_company ON client (company_id);

CREATE TRIGGER trg_client_updated_at
  BEFORE UPDATE ON client
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
```

---

### Migration 0002 — Document Layer

**Purpose:** DocumentCategory (self-referential tree), Document, DocumentVersion.

```sql
-- 0002_document_layer.sql

BEGIN;

-- ── DocumentCategory ────────────────────────────────────────────────────────

CREATE TABLE document_category (
  category_id        UUID PRIMARY KEY,
  company_id         UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  parent_category_id UUID REFERENCES document_category (category_id)
                       ON DELETE RESTRICT,   -- must reassign children first
  path               TEXT NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES "user" (user_id) ON DELETE SET NULL,
  CONSTRAINT path_not_empty CHECK (path <> '')
);

CREATE INDEX idx_doc_category_company   ON document_category (company_id);
CREATE INDEX idx_doc_category_parent    ON document_category (parent_category_id);
CREATE INDEX idx_doc_category_path_trgm ON document_category USING GIN (path gin_trgm_ops);

CREATE TRIGGER trg_document_category_updated_at
  BEFORE UPDATE ON document_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Document ────────────────────────────────────────────────────────────────

CREATE TABLE document (
  document_id   UUID PRIMARY KEY,
  company_id    UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  category_id   UUID REFERENCES document_category (category_id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  detected_type detected_doc_type NOT NULL DEFAULT 'other',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES "user" (user_id) ON DELETE SET NULL
  -- Note: updated_at added (see Risk 1.6 — spec omission)
);

CREATE INDEX idx_document_company    ON document (company_id);
CREATE INDEX idx_document_category   ON document (category_id);
CREATE INDEX idx_document_title_trgm ON document USING GIN (title gin_trgm_ops);

CREATE TRIGGER trg_document_updated_at
  BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DocumentVersion ─────────────────────────────────────────────────────────

CREATE TABLE document_version (
  document_version_id        UUID PRIMARY KEY,
  document_id                UUID NOT NULL REFERENCES document (document_id)
                               ON DELETE CASCADE,
  company_id                 UUID NOT NULL REFERENCES company (company_id)
                               ON DELETE CASCADE,
  file_hash                  TEXT NOT NULL,          -- SHA-256
  object_key                 TEXT NOT NULL,           -- R2 key
  original_filename          TEXT NOT NULL,
  page_count                 INTEGER NOT NULL,
  file_size_bytes            BIGINT NOT NULL,
  pipeline_status            pipeline_status NOT NULL DEFAULT 'uploaded',
  pipeline_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pipeline_error_message     TEXT,
  ocr_quality_warning        BOOLEAN NOT NULL DEFAULT false,
  detected_type              detected_doc_type NOT NULL DEFAULT 'other',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 UUID REFERENCES "user" (user_id) ON DELETE SET NULL
  -- Intentionally no updated_at: content fields are immutable;
  -- pipeline_status_updated_at tracks the only mutable dimension.
);

CREATE INDEX idx_docver_document       ON document_version (document_id);
CREATE INDEX idx_docver_company        ON document_version (company_id);
CREATE INDEX idx_docver_pipeline_status ON document_version (pipeline_status)
  WHERE pipeline_status NOT IN ('review_ready', 'failed');

COMMIT;
```

---

### Migration 0003 — Evidence Layer

**Purpose:** EvidenceBlock (with pgvector HNSW index), PipelineRun.

```sql
-- 0003_evidence_layer.sql

BEGIN;

-- ── EvidenceBlock ────────────────────────────────────────────────────────────

CREATE TABLE evidence_block (
  block_id             UUID PRIMARY KEY,
  document_version_id  UUID NOT NULL REFERENCES document_version (document_version_id)
                         ON DELETE CASCADE,
  company_id           UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  page_number          INTEGER NOT NULL,
  bbox                 FLOAT[] NOT NULL,
  text                 TEXT NOT NULL,
  block_type           block_type NOT NULL,
  embedding            VECTOR(1536),              -- nullable until embedded stage
  low_confidence       BOOLEAN NOT NULL DEFAULT false,
  ocr_confidence       FLOAT NOT NULL,
  chunk_type           chunk_type NOT NULL DEFAULT 'original',
  merged_block_ids     UUID[],                    -- set when chunk_type = 'merged'
  parent_block_id      UUID REFERENCES evidence_block (block_id) ON DELETE SET NULL,
  doc_date             DATE,
  period_start         DATE,
  period_end           DATE,
  site                 TEXT,
  supplier             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bbox_length CHECK (array_length(bbox, 1) = 4),
  CONSTRAINT ocr_confidence_range CHECK (ocr_confidence BETWEEN 0.0 AND 1.0)
);

-- B-tree indexes
CREATE INDEX idx_eb_docver   ON evidence_block (document_version_id);
CREATE INDEX idx_eb_company  ON evidence_block (company_id);
CREATE INDEX idx_eb_parent   ON evidence_block (parent_block_id)
  WHERE parent_block_id IS NOT NULL;

-- GIN for array containment (merged_block_ids)
CREATE INDEX idx_eb_merged_ids ON evidence_block USING GIN (merged_block_ids);

-- GIN + trgm for BM25-style text search
CREATE INDEX idx_eb_text_trgm ON evidence_block USING GIN (text gin_trgm_ops);

-- ── PipelineRun ──────────────────────────────────────────────────────────────

CREATE TABLE pipeline_run (
  run_id                UUID PRIMARY KEY,
  document_version_id   UUID NOT NULL REFERENCES document_version (document_version_id)
                          ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  status                pipeline_run_status NOT NULL DEFAULT 'running',
  observations_created  INTEGER NOT NULL DEFAULT 0,
  observations_skipped  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_pipeline_run_docver  ON pipeline_run (document_version_id);
CREATE INDEX idx_pipeline_run_company ON pipeline_run (company_id);
CREATE INDEX idx_pipeline_run_status  ON pipeline_run (status)
  WHERE status = 'running';

COMMIT;

-- ── HNSW vector index (run OUTSIDE transaction; cannot be concurrent in txn) ──
-- Run this as a separate migration step or in a script with SET maintenance_work_mem.
-- With Drizzle: mark this file as a "raw" non-transactional migration.

SET maintenance_work_mem = '1GB';

CREATE INDEX idx_eb_embedding_hnsw
  ON evidence_block
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

RESET maintenance_work_mem;
```

> **Note for Drizzle:** Split the HNSW `CREATE INDEX` into a separate `0003b_hnsw_index.sql` file and execute it with `{ transaction: false }` in the Drizzle migrate config.

---

### Migration 0004 — Fact Layer (Attestation + Observation)

**Purpose:** Resolve the circular FK (Risk 1.1). Create `AttestationRecord` without the back-pointer, then `Observation`, then add the back-pointer FK.

```sql
-- 0004_fact_layer.sql

BEGIN;

-- ── AttestationRecord (without upgraded_by_observation_id) ──────────────────

CREATE TABLE attestation_record (
  attestation_id   UUID PRIMARY KEY,
  company_id       UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES "user" (user_id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note             TEXT CHECK (char_length(note) <= 1000),
  source_reference TEXT CHECK (char_length(source_reference) <= 500),
  -- upgraded_by_observation_id added below after observation table exists
  upgraded_by_observation_id UUID       -- FK added after observation table
);

CREATE INDEX idx_attest_company ON attestation_record (company_id);

-- ── Observation ──────────────────────────────────────────────────────────────

CREATE TABLE observation (
  observation_id              UUID PRIMARY KEY,
  company_id                  UUID NOT NULL REFERENCES company (company_id)
                                ON DELETE CASCADE,
  label                       TEXT NOT NULL,
  normalized_key              TEXT NOT NULL,
  value                       TEXT NOT NULL,
  numeric_value               NUMERIC,
  unit                        TEXT NOT NULL DEFAULT '',
  data_type                   data_type_enum NOT NULL,
  time_behavior               time_behavior_enum NOT NULL,
  period_start                DATE,
  period_end                  DATE,
  category_id                 UUID REFERENCES document_category (category_id)
                                ON DELETE SET NULL,
  source_document_version_id  UUID REFERENCES document_version (document_version_id)
                                ON DELETE RESTRICT,
  status                      observation_status NOT NULL DEFAULT 'candidate',
  provenance_type             provenance_type_enum NOT NULL,
  evidence_block_ids          UUID[] NOT NULL DEFAULT '{}',
  attestation_record_id       UUID REFERENCES attestation_record (attestation_id)
                                ON DELETE RESTRICT
                                DEFERRABLE INITIALLY DEFERRED,
  confidence_score            FLOAT CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  extraction_run_id           UUID REFERENCES pipeline_run (run_id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID REFERENCES "user" (user_id) ON DELETE SET NULL,
  CONSTRAINT doc_obs_needs_blocks CHECK (
    provenance_type <> 'document' OR array_length(evidence_block_ids, 1) > 0
  ),
  CONSTRAINT manual_obs_needs_attestation CHECK (
    provenance_type <> 'manual' OR attestation_record_id IS NOT NULL
  )
);

-- B-tree composite for overlap queries and conflict detection
CREATE INDEX idx_obs_key_status ON observation (company_id, normalized_key, status);
CREATE INDEX idx_obs_period     ON observation (company_id, period_start, period_end);
CREATE INDEX idx_obs_docver     ON observation (source_document_version_id)
  WHERE source_document_version_id IS NOT NULL;
CREATE INDEX idx_obs_category   ON observation (category_id)
  WHERE category_id IS NOT NULL;
CREATE INDEX idx_obs_attest     ON observation (attestation_record_id)
  WHERE attestation_record_id IS NOT NULL;

-- GIN for array containment queries
CREATE INDEX idx_obs_evidence_block_ids ON observation USING GIN (evidence_block_ids);

-- trgm for normalized_key similarity (used by §11.6 candidate generation)
CREATE INDEX idx_obs_key_trgm ON observation USING GIN (normalized_key gin_trgm_ops);

CREATE TRIGGER trg_observation_updated_at
  BEFORE UPDATE ON observation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Close the circular FK on AttestationRecord ──────────────────────────────
-- DEFERRABLE so that within a transaction the two rows can be inserted/updated
-- in any order without violating the constraint mid-transaction.

ALTER TABLE attestation_record
  ADD CONSTRAINT fk_attest_upgraded_by
    FOREIGN KEY (upgraded_by_observation_id)
    REFERENCES observation (observation_id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_attest_upgraded_by ON attestation_record (upgraded_by_observation_id)
  WHERE upgraded_by_observation_id IS NOT NULL;

COMMIT;
```

---

### Migration 0005 — Derivation + Conflict Layer

**Purpose:** DerivationResult, ConflictCase, ConflictResolution, KeyEquivalenceCache.

```sql
-- 0005_derivation_conflict.sql

BEGIN;

-- ── DerivationResult ─────────────────────────────────────────────────────────

CREATE TABLE derivation_result (
  result_id              UUID PRIMARY KEY,
  company_id             UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  label                  TEXT,
  operation              derivation_operation NOT NULL,
  result_value           NUMERIC NOT NULL,
  unit                   TEXT NOT NULL,
  input_observation_ids  UUID[] NOT NULL,
  coverage               JSONB NOT NULL,
  fingerprint_hash       TEXT NOT NULL,
  stale                  BOOLEAN NOT NULL DEFAULT false,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_derivation_fingerprint UNIQUE (company_id, fingerprint_hash),
  CONSTRAINT coverage_shape CHECK (
    coverage ? 'present_periods'
    AND coverage ? 'expected_periods'
    AND coverage ? 'fraction'
  )
);

CREATE INDEX idx_deriv_company       ON derivation_result (company_id);
CREATE INDEX idx_deriv_fingerprint   ON derivation_result (fingerprint_hash);
CREATE INDEX idx_deriv_stale         ON derivation_result (company_id, stale)
  WHERE stale = true;
CREATE INDEX idx_deriv_input_obs_ids ON derivation_result USING GIN (input_observation_ids);

-- ── ConflictCase ─────────────────────────────────────────────────────────────

CREATE TABLE conflict_case (
  conflict_id            UUID PRIMARY KEY,
  company_id             UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  normalized_key         TEXT NOT NULL,
  conflict_group_id      UUID NOT NULL,
  match_method           conflict_match_method NOT NULL,
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  observation_ids        UUID[] NOT NULL,
  winning_observation_id UUID REFERENCES observation (observation_id)
                           ON DELETE SET NULL,
  auto_resolved          BOOLEAN NOT NULL DEFAULT false,
  resolution_status      conflict_resolution_status NOT NULL DEFAULT 'auto_resolved',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conflict_company         ON conflict_case (company_id);
CREATE INDEX idx_conflict_key             ON conflict_case (company_id, normalized_key);
CREATE INDEX idx_conflict_group           ON conflict_case (conflict_group_id);
CREATE INDEX idx_conflict_resolution_stat ON conflict_case (company_id, resolution_status);
CREATE INDEX idx_conflict_obs_ids         ON conflict_case USING GIN (observation_ids);

CREATE TRIGGER trg_conflict_updated_at
  BEFORE UPDATE ON conflict_case
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── ConflictResolution ───────────────────────────────────────────────────────

CREATE TABLE conflict_resolution (
  resolution_id          UUID PRIMARY KEY,
  conflict_id            UUID NOT NULL REFERENCES conflict_case (conflict_id)
                           ON DELETE CASCADE,
  chosen_observation_id  UUID NOT NULL REFERENCES observation (observation_id)
                           ON DELETE RESTRICT,
  resolved_by            UUID NOT NULL REFERENCES "user" (user_id) ON DELETE RESTRICT,
  resolved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason                 TEXT CHECK (char_length(reason) <= 500)
);

CREATE INDEX idx_conflict_res_conflict ON conflict_resolution (conflict_id);

-- ── KeyEquivalenceCache ──────────────────────────────────────────────────────

CREATE TABLE key_equivalence_cache (
  cache_id       UUID PRIMARY KEY,
  key_pair_hash  TEXT NOT NULL,          -- SHA-256(sort(key_a, key_b))
  key_a          TEXT NOT NULL,
  key_b          TEXT NOT NULL,
  result         key_equivalence_result NOT NULL,
  rationale      TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_key_pair_hash UNIQUE (key_pair_hash)
);

CREATE INDEX idx_keq_created_at ON key_equivalence_cache (created_at);

COMMIT;
```

---

### Migration 0006 — Report, Chat, Notification, PreferenceMemoryPointer

**Purpose:** All user-facing output and interaction tables.

```sql
-- 0006_report_chat_notification.sql

BEGIN;

-- ── Report ───────────────────────────────────────────────────────────────────

CREATE TABLE report (
  report_id               UUID PRIMARY KEY,
  company_id              UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  client_id               UUID REFERENCES client (client_id) ON DELETE SET NULL,
  version                 INTEGER NOT NULL DEFAULT 1,
  source_report_id        UUID REFERENCES report (report_id) ON DELETE SET NULL,
  language                TEXT NOT NULL,             -- BCP-47
  status                  report_status NOT NULL DEFAULT 'draft',
  reporting_period_start  DATE,
  reporting_period_end    DATE,
  html_snapshot           TEXT NOT NULL,             -- full HTML string
  html_snapshot_url       TEXT NOT NULL,
  style_snapshot          JSONB,
  pdf_url                 TEXT,
  observation_ids         UUID[] NOT NULL DEFAULT '{}',
  derivation_result_ids   UUID[] NOT NULL DEFAULT '{}',
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by            UUID REFERENCES "user" (user_id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT html_snapshot_size CHECK (octet_length(html_snapshot) <= 2097152) -- 2 MB
);

CREATE INDEX idx_report_company    ON report (company_id);
CREATE INDEX idx_report_client     ON report (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_report_source     ON report (source_report_id) WHERE source_report_id IS NOT NULL;
CREATE INDEX idx_report_obs_ids    ON report USING GIN (observation_ids);
CREATE INDEX idx_report_deriv_ids  ON report USING GIN (derivation_result_ids);
CREATE INDEX idx_report_gen_at     ON report (company_id, generated_at DESC);

CREATE TRIGGER trg_report_updated_at
  BEFORE UPDATE ON report
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── PreferenceMemoryPointer ──────────────────────────────────────────────────

CREATE TABLE preference_memory_pointer (
  pointer_id      UUID PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  client_id       UUID REFERENCES client (client_id) ON DELETE CASCADE,
  mem0_scope_key  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pointer_scope UNIQUE (company_id, user_id, client_id)
  -- NULL client_id = company-wide scope; treated as distinct by UNIQUE
  -- (in PG, UNIQUE allows multiple NULLs — add partial index if strict uniqueness needed)
);

CREATE UNIQUE INDEX uq_pointer_company_scope
  ON preference_memory_pointer (company_id, user_id)
  WHERE client_id IS NULL;

CREATE INDEX idx_pref_user ON preference_memory_pointer (user_id);

-- ── ChatSession ──────────────────────────────────────────────────────────────

CREATE TABLE chat_session (
  session_id  UUID PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(title) <= 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_session_user     ON chat_session (user_id, created_at DESC);
CREATE INDEX idx_chat_session_company  ON chat_session (company_id);

CREATE TRIGGER trg_chat_session_updated_at
  BEFORE UPDATE ON chat_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── ChatMessage ──────────────────────────────────────────────────────────────

CREATE TABLE chat_message (
  message_id  UUID PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES chat_session (session_id) ON DELETE CASCADE,
  role        chat_role NOT NULL,
  type        chat_message_type NOT NULL,
  content     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_msg_session ON chat_message (session_id, created_at ASC);

-- ── Notification ─────────────────────────────────────────────────────────────

CREATE TABLE notification (
  notification_id  UUID PRIMARY KEY,
  company_id       UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  user_id          UUID REFERENCES "user" (user_id) ON DELETE CASCADE,
  type             notification_type NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  read             BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_bell ON notification (company_id, user_id, read)
  WHERE read = false;
CREATE INDEX idx_notif_created ON notification (company_id, created_at DESC);

COMMIT;
```

---

### Migration 0007 — Async Helpers, AuditLog, and RLS Policies

**Purpose:** PendingManualObservation, AuditLog, Row-Level Security on every table.

```sql
-- 0007_async_audit_rls.sql

BEGIN;

-- ── PendingManualObservation ─────────────────────────────────────────────────

CREATE TABLE pending_manual_observation (
  pending_id   UUID PRIMARY KEY,
  company_id   UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES chat_session (session_id) ON DELETE CASCADE,
  status       pending_obs_status NOT NULL DEFAULT 'pending',
  prefilled    JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
                 GENERATED ALWAYS AS (created_at + INTERVAL '10 minutes') STORED
);

CREATE INDEX idx_pending_obs_session ON pending_manual_observation (session_id);
CREATE INDEX idx_pending_obs_expires ON pending_manual_observation (expires_at)
  WHERE status = 'pending';   -- for cron cleanup job
CREATE INDEX idx_pending_obs_company ON pending_manual_observation (company_id);

-- ── AuditLog — append-only ───────────────────────────────────────────────────

CREATE TABLE audit_log (
  log_id       UUID PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  action       TEXT NOT NULL,
  actor_id     UUID REFERENCES "user" (user_id) ON DELETE SET NULL,
  "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata     JSONB NOT NULL DEFAULT '{}'
);

-- Intentionally no updated_at — append-only.
-- Prevent updates and deletes at DB level:
CREATE RULE no_update_audit_log AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE INDEX idx_audit_entity    ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_actor     ON audit_log (actor_id)  WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_timestamp ON audit_log ("timestamp" DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Application sets: SET LOCAL app.current_company_id = '<uuid>';
-- All policies use the optional-boolean form to fail closed when unset.
-- ────────────────────────────────────────────────────────────────────────────

-- Helper: current company UUID (returns NULL if unset → policy fails closed)
CREATE OR REPLACE FUNCTION current_company_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_company_id', true), '')::uuid
$$;

-- Macro: enable RLS + create SELECT/INSERT/UPDATE/DELETE policies for each table.
-- Applied to all tables with company_id below:

DO $rls$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'client', '"user"', 'document_category', 'document',
    'document_version', 'evidence_block', 'pipeline_run',
    'attestation_record', 'observation', 'derivation_result',
    'conflict_case', 'conflict_resolution', 'report',
    'preference_memory_pointer', 'chat_session', 'chat_message',
    'notification', 'pending_manual_observation'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY rls_%s_company ON %s
         USING (company_id = current_company_id())
         WITH CHECK (company_id = current_company_id())',
      regexp_replace(t, '[^a-z0-9]', '_', 'g'), t
    );
  END LOOP;
END;
$rls$;

-- Special case: chat_message has session_id, not company_id directly.
-- Policy via session subquery:
ALTER TABLE chat_message DISABLE ROW LEVEL SECURITY; -- reset from above loop
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_chat_message_company ON chat_message;
CREATE POLICY rls_chat_message_via_session ON chat_message
  USING (
    session_id IN (
      SELECT session_id FROM chat_session
      WHERE company_id = current_company_id()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT session_id FROM chat_session
      WHERE company_id = current_company_id()
    )
  );

-- conflict_resolution has conflict_id, not company_id:
ALTER TABLE conflict_resolution DISABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolution FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_conflict_resolution_company ON conflict_resolution;
CREATE POLICY rls_conflict_resolution_via_conflict ON conflict_resolution
  USING (
    conflict_id IN (
      SELECT conflict_id FROM conflict_case
      WHERE company_id = current_company_id()
    )
  );

-- key_equivalence_cache and audit_log are company-agnostic — no RLS.
-- audit_log is admin-only; enforce via application role check + view.

-- Company and user tables: super-admin bypass only (no RLS self-referential loop):
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_company_self ON company
  USING (company_id = current_company_id());

COMMIT;
```

---

## 3. Slice Suggestions

The following maps each project delivery slice to the tables it needs, so migrations can be run incrementally per slice without breaking later ones.

| Slice | Name | Tables Required | Migrations |
|---|---|---|---|
| **S1** | Auth + Tenant Scaffold | `company`, `user`, `client` | 0001 |
| **S2** | Document Ingestion | `document_category`, `document`, `document_version`, `evidence_block`, `pipeline_run` | 0001 → 0003 |
| **S3** | Observation Extraction + Review Queue | `attestation_record`, `observation` | 0001 → 0004 |
| **S4** | Conflict Detection + Derivations | `conflict_case`, `conflict_resolution`, `derivation_result`, `key_equivalence_cache` | 0001 → 0005 |
| **S5** | Report Generation | `report`, `preference_memory_pointer` | 0001 → 0006 |
| **S6** | Chat + Manual Observations | `chat_session`, `chat_message`, `pending_manual_observation`, `notification` | 0001 → 0007 |
| **S7** | Audit + Complete RLS | `audit_log` + all RLS policies | 0007 complete |

> **All-or-nothing RLS rule:** RLS policies in 0007 must be deployed **atomically with S7**. Running S1–S6 in development without RLS is acceptable; production must have 0007 applied before the first real tenant is created.

### Table → Slice Ownership

```
S1  company
S1  user
S1  client

S2  document_category
S2  document
S2  document_version
S3  evidence_block (needs docver)
S3  pipeline_run

S3  attestation_record
S3  observation

S4  derivation_result
S4  conflict_case
S4  conflict_resolution
S4  key_equivalence_cache

S5  report
S5  preference_memory_pointer

S6  chat_session
S6  chat_message
S6  notification
S6  pending_manual_observation

S7  audit_log
S7  RLS policies (all tables)
```

---

## 4. Acceptance Criteria

Acceptance criteria are expressed as SQL checks that a CI migration-verification script can run against a test database after each migration batch.

---

### Batch 0001 — Extensions, ENUMs, Foundation

**AC-0001-1 — Extensions installed:**
```sql
SELECT count(*) = 3 AS ok
FROM pg_extension
WHERE extname IN ('vector', 'pg_trgm', 'uuid-ossp');
```
Expected: `ok = true`.

**AC-0001-2 — All ENUMs exist:**
```sql
SELECT count(*) = 15 AS ok
FROM pg_type
WHERE typtype = 'e'
  AND typname IN (
    'user_role', 'detected_doc_type', 'pipeline_status',
    'block_type', 'chunk_type', 'observation_status',
    'data_type_enum', 'time_behavior_enum', 'provenance_type_enum',
    'derivation_operation', 'conflict_match_method',
    'conflict_resolution_status', 'report_status',
    'pipeline_run_status', 'notification_type'
  );
```
Expected: `ok = true`.

**AC-0001-3 — Unique email constraint on `user`:**
```sql
INSERT INTO company (company_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Test');
INSERT INTO "user" (user_id, company_id, email, role)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111', 'a@test.com', 'admin');
-- Second insert with same email must raise unique violation:
INSERT INTO "user" (user_id, company_id, email, role)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '11111111-1111-1111-1111-111111111111', 'a@test.com', 'editor');
-- Expect: ERROR 23505 unique_violation
ROLLBACK;
```

---

### Batch 0002 — Document Layer

**AC-0002-1 — `path` NOT NULL / empty guard:**
```sql
INSERT INTO document_category
  (category_id, company_id, name, path)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'Test', '');
-- Expect: ERROR 23514 check_violation (path_not_empty)
ROLLBACK;
```

**AC-0002-2 — `document_version.pipeline_status` partial index is used for queue queries:**
```sql
EXPLAIN (FORMAT JSON)
SELECT * FROM document_version
WHERE pipeline_status = 'ocr_processing';
-- Verify: "Index Name" contains "idx_docver_pipeline_status" in plan output
```

**AC-0002-3 — Cascade delete Company → Document:**
```sql
DELETE FROM company WHERE company_id = '11111111-1111-1111-1111-111111111111';
SELECT count(*) = 0 AS ok FROM document
  WHERE company_id = '11111111-1111-1111-1111-111111111111';
-- Expected: ok = true
ROLLBACK;
```

---

### Batch 0003 — Evidence Layer

**AC-0003-1 — `bbox` length constraint:**
```sql
INSERT INTO evidence_block
  (block_id, document_version_id, company_id, page_number,
   bbox, text, block_type, low_confidence, ocr_confidence)
VALUES
  (gen_random_uuid(), <valid_docver_id>, <valid_company_id>, 1,
   ARRAY[0.1, 0.2, 0.3], 'text', 'paragraph', false, 0.95);
-- Expect: ERROR 23514 check_violation (bbox_length)
ROLLBACK;
```

**AC-0003-2 — HNSW index exists on `embedding`:**
```sql
SELECT count(*) = 1 AS ok
FROM pg_indexes
WHERE tablename = 'evidence_block'
  AND indexname = 'idx_eb_embedding_hnsw';
```
Expected: `ok = true`.

**AC-0003-3 — `ocr_confidence` range constraint:**
```sql
INSERT INTO evidence_block (..., ocr_confidence) VALUES (..., 1.5);
-- Expect: ERROR 23514 check_violation (ocr_confidence_range)
ROLLBACK;
```

---

### Batch 0004 — Fact Layer

**AC-0004-1 — Circular FK is deferrable (no immediate violation on transaction-order insert):**
```sql
BEGIN;
  SET CONSTRAINTS fk_attest_upgraded_by DEFERRED;
  INSERT INTO observation (observation_id, company_id, label, normalized_key,
    value, unit, data_type, time_behavior, status, provenance_type, evidence_block_ids)
  VALUES (<obs_id>, <cid>, 'Test', 'ghg_scope1', '100',
          'kg CO2eq', 'numeric', 'periodic', 'approved', 'document', '{}');
  INSERT INTO attestation_record (attestation_id, company_id, created_by,
    upgraded_by_observation_id)
  VALUES (<att_id>, <cid>, <user_id>, <obs_id>);
COMMIT;
-- Expect: no error (deferred FK satisfied at COMMIT)
```

**AC-0004-2 — `manual_obs_needs_attestation` check constraint:**
```sql
INSERT INTO observation (..., provenance_type, attestation_record_id)
VALUES (..., 'manual', NULL);
-- Expect: ERROR 23514 check_violation (manual_obs_needs_attestation)
ROLLBACK;
```

**AC-0004-3 — `normalized_key` trgm index enables similarity candidate queries:**
```sql
SELECT count(*) > 0 AS ok
FROM pg_indexes
WHERE tablename = 'observation'
  AND indexname = 'idx_obs_key_trgm';
```

---

### Batch 0005 — Derivation + Conflict

**AC-0005-1 — `fingerprint_hash` uniqueness per company:**
```sql
INSERT INTO derivation_result (result_id, company_id, operation,
  result_value, unit, input_observation_ids, coverage, fingerprint_hash)
VALUES (..., <cid>, 'sum', 100, 'kg CO2eq', '{}',
  '{"present_periods":1,"expected_periods":1,"fraction":1.0}', 'abc123');
-- Second insert same cid + fingerprint_hash:
INSERT INTO derivation_result (..., fingerprint_hash) VALUES (..., 'abc123');
-- Expect: ERROR 23505 unique_violation (uq_derivation_fingerprint)
ROLLBACK;
```

**AC-0005-2 — `coverage_shape` JSONB constraint:**
```sql
INSERT INTO derivation_result (..., coverage)
VALUES (..., '{"missing_key": 1}');
-- Expect: ERROR 23514 check_violation (coverage_shape)
ROLLBACK;
```

**AC-0005-3 — `key_equivalence_cache` deduplicated by `key_pair_hash`:**
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'key_equivalence_cache'
  AND indexname = 'uq_key_pair_hash';
-- Expect: 1 row
```

---

### Batch 0006 — Report, Chat, Notifications

**AC-0006-1 — `html_snapshot` size guard (2 MB):**
```sql
INSERT INTO report (..., html_snapshot, html_snapshot_url)
VALUES (..., repeat('x', 2097153), 'https://r2.example.com/report.html');
-- Expect: ERROR 23514 check_violation (html_snapshot_size)
ROLLBACK;
```

**AC-0006-2 — `preference_memory_pointer` company-scope uniqueness (no client_id):**
```sql
-- Two pointers for same company+user with NULL client_id should be rejected:
INSERT INTO preference_memory_pointer (pointer_id, company_id, user_id, mem0_scope_key)
VALUES (<p1>, <cid>, <uid>, 'user:uid:company:cid');
INSERT INTO preference_memory_pointer (pointer_id, company_id, user_id, mem0_scope_key)
VALUES (<p2>, <cid>, <uid>, 'user:uid:company:cid');
-- Expect: ERROR 23505 (uq_pointer_company_scope)
ROLLBACK;
```

**AC-0006-3 — Chat message cascades on session delete:**
```sql
DELETE FROM chat_session WHERE session_id = <sid>;
SELECT count(*) = 0 AS ok FROM chat_message WHERE session_id = <sid>;
-- Expected: ok = true
ROLLBACK;
```

---

### Batch 0007 — Async, AuditLog, RLS

**AC-0007-1 — `audit_log` is append-only (UPDATE silently ignored by RULE):**
```sql
INSERT INTO audit_log (log_id, entity_type, entity_id, action, "timestamp")
VALUES (gen_random_uuid(), 'observation', gen_random_uuid(), 'approved', now());
UPDATE audit_log SET action = 'tampered' WHERE action = 'approved';
SELECT count(*) = 0 AS ok FROM audit_log WHERE action = 'tampered';
-- Expected: ok = true (UPDATE was a no-op)
```

**AC-0007-2 — RLS cross-tenant isolation:**
```sql
-- Company A inserts a document
SET LOCAL app.current_company_id = '<company_a_id>';
INSERT INTO document (...) VALUES (..., '<company_a_id>', ...);

-- Query under company B context returns 0 rows:
SET LOCAL app.current_company_id = '<company_b_id>';
SELECT count(*) = 0 AS ok FROM document
  WHERE company_id = '<company_a_id>';
-- Expected: ok = true (RLS filters it out)
```

**AC-0007-3 — `expires_at` is auto-computed (generated column):**
```sql
INSERT INTO pending_manual_observation
  (pending_id, company_id, session_id, prefilled)
VALUES (gen_random_uuid(), <cid>, <sid>, '{}');
SELECT (expires_at - created_at) = INTERVAL '10 minutes' AS ok
FROM pending_manual_observation
ORDER BY created_at DESC LIMIT 1;
-- Expected: ok = true
```

---

## Appendix A — Migration File Summary

| File | Slice | Key contents |
|---|---|---|
| `0001_foundation.sql` | S1 | Extensions, all ENUMs, `set_updated_at()` trigger fn, `company`, `user`, `client` |
| `0002_document_layer.sql` | S2 | `document_category`, `document`, `document_version`, partial index on pipeline_status |
| `0003_evidence_layer.sql` | S3 | `evidence_block` + constraints + trgm + GIN, `pipeline_run` |
| `0003b_hnsw_index.sql` *(non-transactional)* | S3 | HNSW index on `evidence_block.embedding` |
| `0004_fact_layer.sql` | S3 | `attestation_record`, `observation`, circular FK resolution |
| `0005_derivation_conflict.sql` | S4 | `derivation_result`, `conflict_case`, `conflict_resolution`, `key_equivalence_cache` |
| `0006_report_chat_notification.sql` | S5+S6 | `report`, `preference_memory_pointer`, `chat_session`, `chat_message`, `notification` |
| `0007_async_audit_rls.sql` | S6+S7 | `pending_manual_observation`, `audit_log`, `current_company_id()`, all RLS policies |

## Appendix B — Open Decisions for Team Review

| # | Decision | Options | Recommended |
|---|---|---|---|
| B-1 | Array columns vs join tables for `evidence_block_ids`, `input_observation_ids` | Keep arrays (MVP speed) vs. join tables (integrity) | Keep arrays for MVP; schedule join-table migration post-demo |
| B-2 | Drizzle schema-push vs. raw SQL migrations | Schema-push (DX simpler) vs. raw SQL (full control) | **Raw SQL** — HNSW concurrent index and RLS policies require it |
| B-3 | `updated_at` on `Document` | Add (spec omission) vs. keep as-is | **Add** — needed for cache invalidation and ETag support |
| B-4 | `KeyEquivalenceCache` TTL | Never expire vs. 30-day eviction cron | 30-day eviction cron (post-MVP) |
| B-5 | RLS enforcement during development | Disable in dev (simpler) vs. always-on | Always-on with a `SET LOCAL app.current_company_id` helper in dev seed scripts |
