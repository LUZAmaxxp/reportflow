# ReportFlow — Implementation Plan

> **Version:** 1.7 · **Date:** 2026-02-21  
> **Status:** All six slices fully expanded with architectural plans. Blueprint complete.  
> **Working rule:** Expand one slice at a time. Say "continue" to expand the next slice.

---

## Front Matter

### Project Goals

1. Deliver a proof-first ESG/RSE reporting platform for SMEs that turns uploaded PDFs/images into an auditable facts layer and generates ISO 26000-style HTML→PDF reports via an AI agent.
2. Every reported fact must trace to an approved observation or a derivation over approved observations — hallucination is structurally impossible.
3. Minimal UI friction: users upload, confirm, chat. No long forms, no manual field schemas.

### Architecture Decision: Three-Process Deployment

The production deployment uses **three separate processes**:

| Process | Responsibilities | Why separate |
|---------|-----------------|--------------|
| **Next.js app server** | REST API route handlers, SSE endpoints, MCP tools (in-process), Auth.js | Stateless; horizontally scalable |
| **Pipeline worker** | BullMQ consumers: `ocr-job`, `embedding-job`, `extraction-job`, `semantic-conflict-job` | Long-running blocking jobs incompatible with serverless constraints; needs persistent Redis connection |
| **PDF worker** | Puppeteer pool (max 3 concurrent instances); restarts after 50 renders | Chromium cannot run in a serverless/edge environment; requires a persistent container with Chromium binary |

> **Critical risk (Agent D R7):** Puppeteer is a **build blocker** if deployed to Vercel or any serverless platform. The PDF worker must run as a separate containerized service (Docker). Plan for this from Slice 1's infrastructure setup.

### Assumptions

- **Runtime:** Node.js 20 LTS.
- **Framework:** Next.js 14 (App Router). All route handlers live under `src/app/api/`.
- **ORM:** Drizzle ORM with Drizzle Kit for migrations on PostgreSQL 16 + pgvector extension.
- **Queue:** BullMQ 5 + Redis 7.
- **Object storage:** Cloudflare R2 accessed via the AWS S3-compatible SDK (`@aws-sdk/client-s3`).
- **Auth:** Auth.js (NextAuth v5), JWT strategy, HTTP-only `Secure` + `SameSite=Lax` cookie, 1-hour access tokens.
- **Styling:** Tailwind CSS 3 + shadcn/ui component library.
- **Animation:** Framer Motion 11.
- **Forms:** react-hook-form + Zod.
- **Drag-and-drop:** dnd-kit (category tree reorder).
- **PDF rendering:** Puppeteer 22 in a dedicated Docker container.
- **MVP UI language:** French (FR) for all navigation labels, system messages, empty states, and notifications. Report content language is configurable.
- **Testing:** Vitest (unit), Playwright (E2E), `@testcontainers/postgresql` for integration tests.
- **UUIDv7:** Use the `uuidv7` npm package for all primary key generation.

### Non-Goals (MVP)

- Interactive PDF citations (web-app only).
- Eager/background derivation recomputation after uploads.
- File types beyond PDF/image.
- ESG certification or compliance claims.
- Multi-language UI (French only in MVP).
- Self-hosted LLM (uses xAI Grok API).
- Company-wide shared mem0 defaults across users.
- Post-MVP: searchable chat session sidebar.

### Environment Variables (complete list)

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/reportflow

# Redis / BullMQ
REDIS_URL=redis://localhost:6379

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

# AI providers
XAI_API_KEY=          # xAI Grok (extraction, report gen, equivalence classifier)
OPENAI_API_KEY=       # OpenAI text-embedding-3-small
PADDLEOCR_TOKEN=      # Baidu PaddleOCR-VL 1.5
PADDLEOCR_API_URL=    # e.g. https://aip.baidubce.com/...

# mem0
MEM0_API_KEY=

# Auth.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=      # openssl rand -base64 32
AUTH_TRUST_HOST=true  # for production behind reverse proxy

# PDF worker (internal service URL)
PDF_WORKER_URL=http://localhost:3001

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Definition of Done (applies to every slice)

- [ ] All tasks in the slice checklist are completed.
- [ ] No TypeScript errors (`tsc --noEmit` passes).
- [ ] Unit tests pass (`vitest run`).
- [ ] Integration tests pass against a local Postgres + Redis testcontainer.
- [ ] "How to verify" steps in the slice section produce the expected output.
- [ ] No console errors or warnings in browser for covered pages.
- [ ] All UI copy is in French where specified.

---

## Spec Index

| Section | Purpose |
|---------|---------|
| §1 | System purpose: proof-first ESG platform for SMEs; two-plane architecture |
| §2 | Core concepts: EvidenceBlock, DocumentCategory, Observation, DerivationResult, RAG, mem0 definitions |
| §3 | System objectives: functional, data integrity, UX (low interaction, French MVP) |
| §4 | Scope: in-scope features and explicit non-goals |
| §5 | End-to-end workflows: upload→OCR→embedding→extraction→review→chat→manual obs popup→report→PDF→regenerate |
| §6 | Functional requirements (FR-1 to FR-41): authoritative feature list |
| §7 | Data model: all entity schemas with field types, constraints, relationships |
| §8 | mem0 memory architecture: scoping, read/write policy, what it stores |
| §9 | RAG architecture: HNSW indexing, chunking strategy, hybrid retrieval, agent-time search_evidence |
| §10 | Derivation engine: on-demand only, operations, hashing, cache invalidation, partial coverage |
| §11 | Conflict & consistency: detection, latest-wins, audit trail, semantic near-duplicate (Grok classifier) |
| §12 | Non-functional requirements: performance SLAs, security/RBAC/RLS, reliability, observability |
| §13 | Demo strategy: sample docs, HTML report template structure, ISO 26000 sections |
| §14 | Risks and tradeoffs |
| §15 | MCP tool contracts: search_observations, search_evidence, compute_derivation, propose_manual_observation, create_report, render_pdf, get_categories, merge_observations, get_report_data, get_preferences |
| §16 | REST API: complete endpoint table, pagination conventions, SSE event shapes (§16.1 pipeline, §16.2 chat) |
| §17 | Provider API configuration: xAI Grok, PaddleOCR-VL 1.5, Cloudflare R2 |

### MVP Critical User Journeys (anchoring slices)

```
Upload → OCR → EvidenceBlocks → Embedding → Extraction → Observations (candidate)
  → Review Queue (approve/reject) → [Conflicts resolved]
  → Chat: "Generate ISO 26000 report"
    → search_observations → search_evidence (fallback) → propose_manual_observation (popup)
    → compute_derivation → create_report → render_pdf
  → Report detail (iframe preview + PDF download)
  → "Make it more concise" → mem0 write → regenerate → new Report version

Plus: Dashboard counts, Notification bell, Category management
```

---

## Consolidated Risks (from parallel agents)

The following critical and high-severity risks are **pre-resolved** in this plan:

| Risk | Source | Resolution in Plan |
|------|--------|-------------------|
| Puppeteer incompatible with serverless | Agent D R7 | PDF worker = separate Docker container; `PDF_WORKER_URL` env var; Slice 5 |
| Chat SSE race condition (tokens before EventSource opens) | Agent A RISK-03 | `POST /messages` returns immediately; SSE stream uses `Last-Event-ID` header + 60-second in-memory replay buffer keyed by session_id |
| RLS `SET LOCAL` pool leak | Agent B 1.4 | Every DB call uses a transaction scope with `SET LOCAL app.current_company_id = ?`; connection pool `afterRelease` resets the variable |
| HNSW `CREATE INDEX` table-lock | Agent B 1.3 | Migration `0003b` runs `CREATE INDEX CONCURRENTLY` outside a transaction; marked `{ transaction: false }` in Drizzle |
| BullMQ job retry idempotency | Agent D R8 | Each pipeline stage checks `DocumentVersion.pipeline_status` as a gate before executing; idempotent by design |
| `low_confidence` threshold contradiction (§2.3 says 0.80, §5.1 says 0.70) | Agent D R3 | **Decision: use 0.70** (§5.1 is the pipeline spec; §2.3 is conceptual). Single constant `LOW_CONFIDENCE_THRESHOLD = 0.70` in `src/lib/constants.ts`. |
| SSE fan-out with horizontal scaling | Agent D R9 | Pipeline SSE uses Redis pub/sub (separate `redis-sub` client); each app instance subscribes to same channel |
| `company_id` on SSE query param bypasses tenant isolation | Agent A RISK-02 | SSE handler extracts `company_id` from `auth()` session only; query param is ignored entirely |
| Page image PNG rendering library/DPI unspecified | Agent D R2 | Use `pdf2pic` (wraps GraphicsMagick/ImageMagick) at 150 DPI in the pipeline worker during OCR stage; PNG stored at `{company_id}/{document_id}/pages/{page_number}.png` |
| EvidenceBlock `bbox` coordinate system unspecified | Agent C R5 | **Decision: ratio coordinates** (0.0–1.0 relative to page dimensions). The SVG overlay uses `viewBox="0 0 1 1"`. Pipeline worker normalizes PaddleOCR pixel bboxes by dividing by page width/height. |

---

## Slice Map

> 6 slices. Each delivers an end-to-end, testable increment of user value.

---

### Slice 1 — Foundation: Project Scaffold, DB (Full Schema Reconciled with Migration SQL), Auth, Shell, Queue Declarations

**Scope:** Set up the entire project scaffold, database schema (all migrations), Auth.js authentication, global layout shell with navigation, and all infrastructure clients (R2, Redis, BullMQ queues). No pipeline logic, no AI calls.

**End-to-end value:** A developer can log in, see the French navigation shell, and all DB tables exist and pass integration checks.

**Key routes/pages:** `/login`, `/` (empty dashboard shell), global layout  
**Key API endpoints:** Auth.js providers endpoints (`/api/auth/[...nextauth]`)  
**Key DB entities:** All 21 tables created (see §1.4 below)  
**Background jobs:** BullMQ queues registered (no workers yet)  
**Dependencies:** None

---

#### §1.1 — Responsibilities

This slice establishes the full structural skeleton on which every subsequent slice builds. No business logic is implemented. Its sole concerns are:

1. **Monorepo structure** — establish folder conventions that all future files will follow
2. **Database schema** — declare all 21 tables with correct columns, constraints, foreign keys, and indexes; run migrations to completion against a local Postgres 16 + pgvector instance
3. **Row-Level Security (RLS)** — enforce tenant isolation at the database layer for every multi-tenant table
4. **Auth layer** — Auth.js v5 with credentials provider (email + bcrypt password); JWT strategy issuing `{ user_id, company_id, role }` claims; session cookie configuration
5. **Infrastructure clients** — singleton module exports for: Drizzle ORM pool, Redis client, R2 S3 client, BullMQ queue registry (queues declared, no consumers)
6. **Layout shell** — authenticated root layout with French sidebar; `/login` page; root `/` redirects to dashboard shell
7. **Environment validation** — fail-fast at boot if required env vars are absent

---

#### §1.2 — System Boundaries

```
Browser
  └── Next.js App Server (port 3000)
        ├── /login              → Auth.js credentials handler
        ├── /api/auth/[...nextauth]  → Auth.js catch-all
        ├── / (shell only)      → authenticated root layout
        └── Drizzle ORM
              └── PostgreSQL 16 (port 5432) + pgvector

Redis 7 (port 6379)
  └── BullMQ queue declarations (no consumers in this slice)

Cloudflare R2
  └── S3 client singleton (no uploads in this slice)
```

**What is explicitly NOT in scope:**
- Pipeline workers (no BullMQ consumers)
- Any R2 uploads
- Any AI/ML API calls
- Chat, reports, observations, conflicts
- PDF worker container

---

#### §1.3 — Directory Structure (file names and responsibilities only)

```
reportflow/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx          # Login page — credential form, FR copy
│   │   ├── (app)/
│   │   │   ├── layout.tsx            # Authenticated root layout — sidebar + topbar shell
│   │   │   └── page.tsx              # Dashboard shell — empty state placeholder
│   │   ├── api/
│   │   │   └── auth/
│   │   │       └── [...nextauth]/
│   │   │           └── route.ts      # Auth.js catch-all handler
│   │   ├── layout.tsx                # Root HTML layout — font, metadata, providers
│   │   └── globals.css               # Tailwind base imports
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # FR navigation — 7 items, active state, collapse
│   │   │   ├── Topbar.tsx            # User avatar, company name, logout button
│   │   │   └── NavItem.tsx           # Single nav link — icon + label + active indicator
│   │   └── ui/                       # shadcn/ui re-exports (button, input, badge, etc.)
│   │
│   ├── lib/
│   │   ├── auth.ts                   # Auth.js config — providers, callbacks, JWT shape
│   │   ├── db/
│   │   │   ├── index.ts              # Drizzle pool singleton — exports `db`
│   │   │   ├── schema/
│   │   │   │   ├── index.ts          # Re-exports all table definitions
│   │   │   │   ├── auth.ts           # companies, users tables
│   │   │   │   ├── documents.ts      # clients, document_categories, documents, document_versions tables
│   │   │   │   ├── evidence.ts       # evidence_blocks table
│   │   │   │   ├── observations.ts   # observations, attestation_records, pending_manual_observations tables
│   │   │   │   ├── derivations.ts    # derivation_results, key_equivalence_cache tables
│   │   │   │   ├── conflicts.ts      # conflict_cases, conflict_resolutions tables
│   │   │   │   ├── reports.ts        # reports table
│   │   │   │   ├── memory.ts         # preference_memory_pointers table
│   │   │   │   ├── pipeline.ts       # pipeline_runs table
│   │   │   │   └── notifications.ts  # notifications, chat_sessions, chat_messages, audit_log tables
│   │   │   └── rls.ts                # Helper: wraps every query in SET LOCAL transaction
│   │   ├── redis.ts                  # Redis client singleton (ioredis)
│   │   ├── r2.ts                     # R2 / S3 client singleton
│   │   ├── queues.ts                 # BullMQ Queue declarations (no workers)
│   │   ├── constants.ts              # LOW_CONFIDENCE_THRESHOLD, queue names, etc.
│   │   └── env.ts                    # Zod env schema — throws at boot on missing vars
│   │
│   ├── middleware.ts                 # Auth.js session guard — protect all (app) routes
│   └── types/
│       ├── auth.ts                   # Augmented Session / JWT types
│       └── db.ts                     # Inferred Drizzle select/insert types (re-exported)
│
├── drizzle/
│   ├── migrations/
│   │   ├── 0001_foundation.sql       # Extensions, ENUMs, trigger fn, company/user/client
│   │   ├── 0002_document_layer.sql   # document_category, document, document_version
│   │   ├── 0003_evidence_layer.sql   # evidence_block, pipeline_run, HNSW index
│   │   ├── 0004_fact_layer.sql       # attestation_record, observation (circular FK)
│   │   ├── 0005_derivation_conflict.sql  # derivation_result, conflict_case/resolution, key_equivalence_cache
│   │   ├── 0006_report_chat_notification.sql  # report, preference_memory_pointer, chat_session/message, notification
│   │   └── 0007_async_audit_rls.sql  # pending_manual_observation, audit_log, all RLS policies
│   └── drizzle.config.ts             # Drizzle Kit config
│
├── workers/
│   └── pipeline/
│       └── index.ts                  # Worker process entry — connects Redis, registers queues (no consumers yet)
│
├── .env.example                      # All env vars documented with comments
├── next.config.ts                    # Next.js config
├── tailwind.config.ts                # Tailwind + shadcn theme tokens
└── tsconfig.json                     # Path aliases: @/* → src/*
```

---

#### §1.4 — Database Schema (tables, columns, constraints — no DDL code)

> This is the complete schema declared in Slice 1. All subsequent slices only write data into these tables.
> Source of truth: `archive/data_model_migration_plan.md` (migrations 0001–0007). Known migration SQL gaps are annotated with ⚠️.

##### ENUM types (all defined in migration 0001)

| Enum name | Values |
|-----------|--------|
| `user_role` | `admin`, `editor`, `viewer` |
| `detected_doc_type` | `sustainability_report`, `energy_bill`, `hr_report`, `financial_statement`, `other` |
| `pipeline_status` | `uploaded`, `ocr_processing`, `ocr_done`, `embedding`, `embedded`, `extracting`, `review_ready`, `failed` |
| `block_type` | `paragraph`, `table_cell`, `header`, `list_item`, `figure_caption`, `other` |
| `chunk_type` | `original`, `merged`, `split`, `superseded` |
| `observation_status` | `candidate`, `approved`, `rejected`, `superseded`, `invalidated` |
| `data_type_enum` | `numeric`, `percentage`, `text`, `boolean` |
| `time_behavior_enum` | `periodic`, `point_in_time`, `none` |
| `provenance_type_enum` | `document`, `manual` |
| `derivation_operation` | `sum`, `average`, `delta`, `ratio`, `count` |
| `conflict_match_method` | `exact`, `semantic` |
| `conflict_resolution_status` | `auto_resolved`, `user_reviewed`, `user_overridden` |
| `report_status` | `draft`, `final` |
| `pipeline_run_status` | `running`, `completed`, `failed` |
| `notification_type` | `pipeline_completed`, `pipeline_failed`, `conflict_detected`, `report_ready`, `manual_obs_requested` |
| `chat_role` | `user`, `assistant`, `tool` ⚠️ migration SQL has `(user, agent, system)` — must be patched to match LLM API convention |
| `chat_message_type` | `user_text`, `agent_text`, `agent_tool_call`, `manual_obs_request`, `report_ready`, `error` |
| `key_equivalence_result` | `SAME_KEY`, `DIFFERENT_KEY` |
| `pending_obs_status` | `pending`, `confirmed`, `skipped`, `timed_out` |

##### Helper function

- `set_updated_at()` — trigger function that sets `updated_at = now()` on every UPDATE. Attached via `BEFORE UPDATE` trigger to all tables that have `updated_at`.

##### Tables

**`company`** (migration 0001)
- `company_id` — UUID, PK
- `name` — text, not null
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)

**`user`** (migration 0001)
- `user_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `email` — text, not null, UNIQUE
- `password_hash` — text, not null (bcrypt) ⚠️ missing from migration SQL — must be added to 0001_foundation.sql
- `role` — user_role, not null, default `viewer`
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- **Index:** btree on `(company_id)`

**`client`** (migration 0001)
- `client_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `name` — text, not null
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- `created_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- **Index:** btree on `(company_id)`

**`document_category`** (migration 0002)
- `category_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `name` — text, not null
- `description` — text, nullable
- `parent_category_id` — FK → document_category.category_id, nullable, ON DELETE RESTRICT (must reassign children before delete)
- `path` — text, not null, default `''` (materialized ltree-style path, e.g. `root.env.energy`). **Note:** `DEFAULT ''` conflicts with `CHECK (path <> '')` — application must always supply a non-empty value
- `sort_order` — integer, not null, default 0
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- `created_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- **Constraint:** `CHECK (path <> '')`
- **Index:** btree on `(company_id)`, btree on `(parent_category_id)`, GIN trgm on `path`

**`document`** (migration 0002)
- `document_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `category_id` — FK → document_category.category_id, nullable, ON DELETE SET NULL
- `title` — text, not null
- `detected_type` — detected_doc_type, not null, default `other`
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- `created_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- **Index:** btree on `(company_id)`, btree on `(category_id)`, GIN trgm on `title`

> Note: `client_id` is on `report`, not `document`. A document is company-scoped; client association happens at report generation time.

**`document_version`** (migration 0002)
- `document_version_id` — UUID, PK
- `document_id` — FK → document.document_id, not null, ON DELETE CASCADE
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `file_hash` — text, not null (SHA-256 of uploaded file)
- `object_key` — text, not null (R2 object key)
- `original_filename` — text, not null
- `page_count` — integer, not null
- `file_size_bytes` — bigint, not null
- `pipeline_status` — pipeline_status, not null, default `uploaded`
- `pipeline_status_updated_at` — timestamptz, not null, default now()
- `pipeline_error_message` — text, nullable
- `ocr_quality_warning` — boolean, not null, default false
- `detected_type` — detected_doc_type, not null, default `other`
- `created_at` — timestamptz, not null, default now()
- `created_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- **Index:** btree on `(document_id)`, btree on `(company_id)`, partial btree on `(pipeline_status) WHERE pipeline_status NOT IN ('review_ready', 'failed')`
- No `updated_at` — content is immutable; `pipeline_status_updated_at` tracks the only mutable dimension

**`evidence_block`** (migration 0003)
- `block_id` — UUID, PK
- `document_version_id` — FK → document_version.document_version_id, not null, ON DELETE CASCADE
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE (denormalized for RLS)
- `page_number` — integer, not null
- `bbox` — float[], not null (ratio coords `[x1, y1, x2, y2]` all 0.0–1.0). **Constraint:** `CHECK (array_length(bbox, 1) = 4)`
- `text` — text, not null
- `block_type` — block_type, not null
- `embedding` — vector(1536), nullable (null until embedding stage completes)
- `low_confidence` — boolean, not null, default false
- `ocr_confidence` — float, not null. **Constraint:** `CHECK (ocr_confidence BETWEEN 0.0 AND 1.0)`
- `chunk_type` — chunk_type, not null, default `original`
- `embedding_status` — enum(`pending`, `completed`, `failed`, `skipped`), not null, default `pending`. Tracks per-block embedding lifecycle; `failed`/`skipped` blocks are excluded from retrieval queries.
- `merged_block_ids` — UUID[], nullable (set when chunk_type = `merged`)
- `parent_block_id` — FK → evidence_block.block_id, nullable, ON DELETE SET NULL (self-referential for split chunks)
- `doc_date` — date, nullable
- `period_start` — date, nullable
- `period_end` — date, nullable
- `site` — text, nullable
- `supplier` — text, nullable
- `created_at` — timestamptz, not null, default now()
- **Index:** btree on `(document_version_id)`, btree on `(company_id)`, partial btree on `(parent_block_id)` WHERE NOT NULL, GIN on `(merged_block_ids)`, GIN trgm on `text`
- **Index:** HNSW on `embedding` using `vector_cosine_ops` (m=16, ef_construction=128) — created CONCURRENTLY in separate non-transactional migration step

**`pipeline_run`** (migration 0003)
- `run_id` — UUID, PK
- `document_version_id` — FK → document_version.document_version_id, not null, ON DELETE CASCADE
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `started_at` — timestamptz, not null, default now()
- `completed_at` — timestamptz, nullable
- `status` — pipeline_run_status, not null, default `running`
- `observations_created` — integer, not null, default 0
- `observations_skipped` — integer, not null, default 0
- **Index:** btree on `(document_version_id)`, btree on `(company_id)`, partial btree on `(status) WHERE status = 'running'`

**`attestation_record`** (migration 0004)
- `attestation_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `created_by` — FK → user.user_id, not null, ON DELETE RESTRICT
- `created_at` — timestamptz, not null, default now()
- `note` — text, nullable. **Constraint:** `CHECK (char_length(note) <= 1000)`
- `source_reference` — text, nullable. **Constraint:** `CHECK (char_length(source_reference) <= 500)`
- `upgraded_by_observation_id` — FK → observation.observation_id, nullable, ON DELETE SET NULL, DEFERRABLE INITIALLY DEFERRED (circular FK — added via ALTER TABLE after observation table is created)
- **Index:** btree on `(company_id)`, partial btree on `(upgraded_by_observation_id)` WHERE NOT NULL

**`observation`** (migration 0004)
- `observation_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `label` — text, not null (human-readable display name)
- `normalized_key` — text, not null (e.g. `ghg_scope1_tco2e`)
- `value` — text, not null
- `numeric_value` — numeric, nullable (parsed numeric form of `value` when applicable)
- `unit` — text, not null, default `''`
- `data_type` — data_type_enum, not null
- `time_behavior` — time_behavior_enum, not null
- `period_start` — date, nullable
- `period_end` — date, nullable
- `category_id` — FK → document_category.category_id, nullable, ON DELETE SET NULL
- `source_document_version_id` — FK → document_version.document_version_id, nullable, ON DELETE RESTRICT (null for manual observations)
- `status` — observation_status, not null, default `candidate`
- `provenance_type` — provenance_type_enum, not null
- `evidence_block_ids` — UUID[], not null, default `{}`
- `attestation_record_id` — FK → attestation_record.attestation_id, nullable, ON DELETE RESTRICT, DEFERRABLE INITIALLY DEFERRED
- `confidence_score` — float, nullable. **Constraint:** `CHECK (confidence_score BETWEEN 0.0 AND 1.0)`
- `extraction_run_id` — FK → pipeline_run.run_id, nullable, ON DELETE SET NULL
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- `created_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- **Constraint:** `CHECK (provenance_type <> 'document' OR array_length(evidence_block_ids, 1) > 0)` — document-provenance observations must have evidence blocks
- **Constraint:** `CHECK (provenance_type <> 'manual' OR attestation_record_id IS NOT NULL)` — manual observations must have an attestation record
- **Index:** btree on `(company_id, normalized_key, status)`, btree on `(company_id, period_start, period_end)`, partial btree on `(source_document_version_id)` WHERE NOT NULL, partial btree on `(category_id)` WHERE NOT NULL, partial btree on `(attestation_record_id)` WHERE NOT NULL, GIN on `(evidence_block_ids)`, GIN trgm on `(normalized_key)`

**`derivation_result`** (migration 0005)
- `result_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `label` — text, nullable
- `operation` — derivation_operation, not null
- `result_value` — numeric, not null
- `unit` — text, not null
- `input_observation_ids` — UUID[], not null
- `coverage` — jsonb, not null. **Constraint:** `CHECK (coverage ? 'present_periods' AND coverage ? 'expected_periods' AND coverage ? 'fraction')`
- `fingerprint_hash` — text, not null (SHA-256 of sorted input IDs + operation)
- `stale` — boolean, not null, default false
- `computed_at` — timestamptz, not null, default now()
- **Unique constraint:** `(company_id, fingerprint_hash)`
- **Index:** btree on `(company_id)`, btree on `(fingerprint_hash)`, partial btree on `(company_id, stale) WHERE stale = true`, GIN on `(input_observation_ids)`

**`key_equivalence_cache`** (migration 0005)
- `cache_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE ⚠️ missing from migration SQL — must be added for RLS
- `key_pair_hash` — text, not null (SHA-256 of `sort(key_a, key_b)`)
- `key_a` — text, not null
- `key_b` — text, not null
- `result` — key_equivalence_result, not null
- `rationale` — text, not null
- `created_at` — timestamptz, not null, default now()
- **Unique constraint:** `(key_pair_hash)`
- **Index:** btree on `(created_at)` (for TTL eviction)

**`conflict_case`** (migration 0005)
- `conflict_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `normalized_key` — text, not null
- `conflict_group_id` — UUID, not null
- `match_method` — conflict_match_method, not null
- `period_start` — date, not null
- `period_end` — date, not null
- `observation_ids` — UUID[], not null
- `winning_observation_id` — FK → observation.observation_id, nullable, ON DELETE SET NULL
- `auto_resolved` — boolean, not null, default false
- `resolution_status` — conflict_resolution_status, not null, default `auto_resolved`
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- **Index:** btree on `(company_id)`, btree on `(company_id, normalized_key)`, btree on `(conflict_group_id)`, btree on `(company_id, resolution_status)`, GIN on `(observation_ids)`

**`conflict_resolution`** (migration 0005)
- `resolution_id` — UUID, PK
- `conflict_id` — FK → conflict_case.conflict_id, not null, ON DELETE CASCADE
- `chosen_observation_id` — FK → observation.observation_id, not null, ON DELETE RESTRICT
- `resolved_by` — FK → user.user_id, not null, ON DELETE RESTRICT
- `resolved_at` — timestamptz, not null, default now()
- `reason` — text, nullable. **Constraint:** `CHECK (char_length(reason) <= 500)`
- **Index:** btree on `(conflict_id)`

**`report`** (migration 0006)
- `report_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `client_id` — FK → client.client_id, nullable, ON DELETE SET NULL
- `version` — integer, not null, default 1
- `source_report_id` — FK → report.report_id, nullable, ON DELETE SET NULL (previous version link)
- `language` — text, not null (BCP-47 code, e.g. `fr`)
- `status` — report_status, not null, default `draft`
- `reporting_period_start` — date, nullable
- `reporting_period_end` — date, nullable
- `html_snapshot_r2_key` — text, not null (R2 object key, e.g., `{company_id}/reports/{report_id}/snapshot.html`). Presigned URL is generated fresh per API request — never stored.

> **Spec deviation (intentional):** The original spec (§14) defines an inline `html_snapshot` text column storing the full HTML string. This plan upgrades to R2-backed storage (`html_snapshot_r2_key`) for better scalability and to avoid multi-MB text columns in Postgres. A presigned URL is generated on each read request. All API consumers receive the presigned URL rather than raw HTML.

- `style_snapshot` — jsonb, nullable
- `pdf_r2_key` — text, nullable (R2 object key for generated PDF, e.g., `{company_id}/reports/{report_id}/report.pdf`). Presigned URL generated per request.
- `observation_ids` — UUID[], not null, default `{}`
- `derivation_result_ids` — UUID[], not null, default `{}`
- `generated_at` — timestamptz, not null, default now()
- `generated_by` — FK → user.user_id, nullable, ON DELETE SET NULL
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- **Index:** btree on `(company_id)`, partial btree on `(client_id)` WHERE NOT NULL, partial btree on `(source_report_id)` WHERE NOT NULL, GIN on `(observation_ids)`, GIN on `(derivation_result_ids)`, btree on `(company_id, generated_at DESC)`

**`preference_memory_pointer`** (migration 0006)
- `pointer_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `user_id` — FK → user.user_id, not null, ON DELETE CASCADE
- `client_id` — FK → client.client_id, nullable, ON DELETE CASCADE (null = company-wide scope)
- `mem0_scope_key` — text, not null
- `created_at` — timestamptz, not null, default now()
- **Unique constraint:** `(company_id, user_id, client_id)` — PostgreSQL treats multiple NULLs as distinct
- **Unique index:** `(company_id, user_id) WHERE client_id IS NULL` — enforces at most one company-wide pointer per user
- **Index:** btree on `(user_id)`

**`chat_session`** (migration 0006)
- `session_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `user_id` — FK → user.user_id, not null, ON DELETE CASCADE
- `title` — text, not null. **Constraint:** `CHECK (char_length(title) <= 200)`
- `created_at` — timestamptz, not null, default now()
- `updated_at` — timestamptz, not null, default now() (trigger: `set_updated_at`)
- **Index:** btree on `(user_id, created_at DESC)`, btree on `(company_id)`

**`chat_message`** (migration 0006)
- `message_id` — UUID, PK
- `session_id` — FK → chat_session.session_id, not null, ON DELETE CASCADE
- `role` — chat_role, not null
- `type` — chat_message_type, not null
- `content` — jsonb, not null (structured content; schema varies by `type`)
- `created_at` — timestamptz, not null, default now()
- **Index:** btree on `(session_id, created_at ASC)`

**`notification`** (migration 0006)
- `notification_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `user_id` — FK → user.user_id, nullable, ON DELETE CASCADE (null = broadcast to all company users)
- `type` — notification_type, not null
- `payload` — jsonb, not null, default `{}`
- `read` — boolean, not null, default false
- `created_at` — timestamptz, not null, default now()
- **Index:** partial btree on `(company_id, user_id, read) WHERE read = false`, btree on `(company_id, created_at DESC)`

**`pending_manual_observation`** (migration 0007)
- `pending_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE
- `session_id` — FK → chat_session.session_id, not null, ON DELETE CASCADE
- `status` — pending_obs_status, not null, default `pending`
- `prefilled` — jsonb, not null, default `{}` (agent-suggested values)
- `created_at` — timestamptz, not null, default now()
- `expires_at` — timestamptz, not null, GENERATED ALWAYS AS `(created_at + INTERVAL '10 minutes')` STORED
- **Index:** btree on `(session_id)`, partial btree on `(expires_at) WHERE status = 'pending'` (for cron cleanup), btree on `(company_id)`

**`audit_log`** (migration 0007) — append-only
- `log_id` — UUID, PK
- `company_id` — FK → company.company_id, not null, ON DELETE CASCADE ⚠️ missing from migration SQL — must be added for RLS
- `entity_type` — text, not null
- `entity_id` — UUID, not null
- `action` — text, not null (e.g. `observation.approved`, `conflict.resolved`)
- `actor_id` — FK → user.user_id, nullable, ON DELETE SET NULL
- `timestamp` — timestamptz, not null, default now()
- `metadata` — jsonb, not null, default `{}`
- **Rule:** `no_update_audit_log` — prevents UPDATEs via `DO INSTEAD NOTHING`
- **Rule:** `no_delete_audit_log` — prevents DELETEs via `DO INSTEAD NOTHING`
- **Index:** btree on `(entity_type, entity_id)`, partial btree on `(actor_id)` WHERE NOT NULL, btree on `(timestamp DESC)`

> **Total tables declared in Slice 1:** 21
> ⚠️ **4 migration SQL gaps to fix before running** (see notes above): `user.password_hash`, `chat_role` enum values, `key_equivalence_cache.company_id`, `audit_log.company_id`

---

#### §1.5 — Migration Strategy

Seven migration files, applied in order. All use raw SQL via Drizzle's `migrate()` runner (not schema-push) because HNSW CONCURRENTLY, RLS policies, DEFERRABLE FKs, and append-only rules are unsupported in Drizzle's schema DSL.

| # | File | Contents | Special handling |
|---|------|----------|-----------------|
| 0001 | `0001_foundation.sql` | Extensions (`pgcrypto`, `uuid-ossp`, `vector`, `pg_trgm`), all ENUM types, `set_updated_at()` trigger function, `company`, `user`, `client` | Standard transaction |
| 0002 | `0002_document_layer.sql` | `document_category`, `document`, `document_version` | Standard transaction |
| 0003 | `0003_evidence_layer.sql` | `evidence_block`, `pipeline_run` + HNSW index on `evidence_block.embedding` | HNSW index portion runs **outside transaction** (`{ transaction: false }`). Sets `maintenance_work_mem = '1GB'` before HNSW build |
| 0004 | `0004_fact_layer.sql` | `attestation_record` (without circular FK), `observation`, then `ALTER TABLE` for circular FK | Standard transaction. Uses `DEFERRABLE INITIALLY DEFERRED` for circular FK |
| 0005 | `0005_derivation_conflict.sql` | `derivation_result`, `conflict_case`, `conflict_resolution`, `key_equivalence_cache` | Standard transaction |
| 0006 | `0006_report_chat_notification.sql` | `report`, `preference_memory_pointer`, `chat_session`, `chat_message`, `notification` | Standard transaction |
| 0007 | `0007_async_audit_rls.sql` | `pending_manual_observation`, `audit_log` (append-only with RULE no_update/no_delete), all RLS policies | Standard transaction. RLS special-cases `chat_message` (via session subquery) and `conflict_resolution` (via conflict subquery) |

**RLS policy shape (per multi-tenant table):**
- Policy name: `tenant_isolation`
- Target roles: all (or `authenticated` if using Supabase-style roles)
- `USING` expression: `company_id = current_setting('app.current_company_id')::uuid`
- Applied to: `SELECT`, `INSERT`, `UPDATE`, `DELETE`

**RLS transaction wrapper (in `src/lib/db/rls.ts`):**
- Every request that touches the DB runs inside a transaction that first executes `SET LOCAL app.current_company_id = ?` with the `company_id` from the Auth.js session
- The wrapper is a function: `withTenant(db, companyId, callback)` → runs a transaction, sets the local variable, then calls the callback with the transaction client
- **Pool leak guard:** The `afterRelease` hook on the Drizzle pool connection resets `app.current_company_id` to `''` before returning the connection to the pool

---

#### §1.6 — Authentication Architecture

**Provider:** Credentials (email + password). No OAuth providers in MVP.

**JWT claims structure:**
```json
{
  "sub": "<user_id>",
  "company_id": "<company_id>",
  "role": "admin | editor | viewer",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Cookie configuration:**
- `httpOnly: true`
- `secure: true` (enforced in production)
- `sameSite: lax`
- Max age: 3600 seconds (1 hour)

**`auth()` helper contract (in `src/lib/auth.ts`):**
- Returns `{ user_id, company_id, role }` when called from a Server Component or route handler
- Returns `null` when no valid session exists
- Route handlers must call `auth()` and return 401 if null

**Auth.js callbacks:**
- `jwt` callback: on sign-in, fetches `company_id` and `role` from DB and embeds them in the token
- `session` callback: projects `{ user_id, company_id, role }` onto the client-visible session object; **no password hash is ever projected**

**`middleware.ts` guard:**
- Matcher: `/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)` — all routes except auth endpoints and static assets
- If no valid session cookie → redirect to `/login`
- If valid session → pass through; sets `x-user-id` and `x-company-id` headers on the request for downstream use

---

#### §1.7 — Infrastructure Client Responsibilities

**`src/lib/db/index.ts`**
- Creates a Drizzle/node-postgres pool using `DATABASE_URL`
- Pool size: min 2, max 10
- Exports `db` singleton
- Registers `afterRelease` hook to reset `app.current_company_id`
- Not exported until env validation passes

**`workers/pipeline/db.ts`** (pipeline worker DB pool — Slice 2)
- Creates a **separate** Drizzle/node-postgres pool using `DATABASE_URL` (or `WORKER_DATABASE_URL` if provided)
- Pool size: min 1, max 5 (workers run fewer concurrent queries but hold connections longer during jobs)
- Same `afterRelease` hook to reset `app.current_company_id`
- Separate pool prevents long-running pipeline jobs from starving the Next.js app server's connection pool

**`src/lib/redis.ts`**
- Creates an ioredis client using `REDIS_URL`
- Exports two singletons: `redis` (general use) and `redisSub` (reserved for pub/sub in later slices; created here to establish the pattern)
- Attaches an `error` listener that logs but does not crash the process
- Connection is lazy (ioredis default)

**`src/lib/r2.ts`**
- Creates an AWS S3Client pointed at `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- Exports `r2Client` and `R2_BUCKET` (from env)
- No upload logic in this slice — just the client

**`src/lib/queues.ts`**
- Declares six BullMQ `Queue` instances: `ocr-job`, `embedding-job`, `extraction-job`, `semantic-conflict-job`, `render-pdf-job`, `pending-obs-timeout`
- Exports queue objects for use in route handlers (to enqueue jobs)
- No `Worker` instances in this file — workers live in `workers/pipeline/index.ts`
- Each queue uses a `{ connection: redis }` shared connection reference
- Each queue configures `removeOnComplete: { count: 500 }` and `removeOnFail: { count: 1000 }` to prevent unbounded Redis memory growth
- **Per-queue job timeouts** (BullMQ `defaultJobOptions.timeout`):
  | Queue | Timeout | Rationale |
  |-------|---------|-----------|
  | `ocr-job` | 180 000 ms (3 min) | Up to 200 pages × ~1s/page PaddleOCR + page PNG conversion |
  | `embedding-job` | 120 000 ms (2 min) | OpenAI batch embedding; 512-block batches complete in ~30s |
  | `extraction-job` | 300 000 ms (5 min) | Grok LLM call (longest stage); aligns with extraction timeout in §3.5 |
  | `semantic-conflict-job` | 60 000 ms (1 min) | Single Grok equivalence classifier call |
  | `render-pdf-job` | 90 000 ms (90 s) | Puppeteer render + R2 upload; aligns with MCP tool timeout in §5.7 |
  | `pending-obs-timeout` | 30 000 ms (30 s) | Lightweight DB sweep; should complete in < 1s |

**`src/lib/env.ts`**
- Uses Zod to parse `process.env` at module load time
- Throws a descriptive error listing all missing/invalid variables if validation fails
- Exported as `env` — all other modules import from here, never from `process.env` directly

---

#### §1.8 — UI Shell Architecture

**Route groups:**
- `(auth)` group — unauthenticated routes: `/login`
- `(app)` group — authenticated routes: everything else. The layout in this group renders the `Sidebar` + `Topbar` wrapper.

**`Sidebar` component responsibilities:**
- Renders exactly 7 nav items in French:
  1. Tableau de bord → `/`
  2. Documents → `/documents`
  3. Observations → `/observations`
  4. Conflits → `/conflicts`
  5. Rapports → `/reports`
  6. Chat → `/chat`
  7. Paramètres → `/settings`
- Active item determined by `usePathname()`
- Collapses to icon-only on small screens (Tailwind responsive classes)
- No dynamic data fetched in this slice (notification badge added in Slice 4)

**`Topbar` component responsibilities:**
- Displays company name (from session)
- User avatar with dropdown: profile link + sign-out button
- Sign-out calls Auth.js `signOut()` action

**`/login` page:**
- Email + password form using react-hook-form + Zod validation
- Calls Auth.js `signIn("credentials", ...)` on submit
- Error state: displays "Identifiants incorrects" on auth failure (French)
- Redirect on success: to `/` (middleware handles unauthenticated redirect)
- No registration form in MVP (seed script creates initial admin user)

**`/` page (dashboard shell):**
- Server Component
- Calls `auth()` — if null, middleware has already redirected; this is a safety net
- Renders a placeholder card: "Tableau de bord — Bienvenue" with empty state text
- Real dashboard content added in Slice 6

---

#### §1.9 — Data Flow: Login Sequence

```
Browser                  Next.js                  PostgreSQL
  |                         |                          |
  |-- POST /api/auth/sign-in (email, password) ------->|
  |                   [Auth.js credentials provider]   |
  |                         |-- SELECT user WHERE email = ? -->|
  |                         |<-- { id, company_id, role, password_hash } --|
  |                   [bcrypt.compare(password, hash)]  |
  |                   [JWT signed: { sub, company_id, role }]
  |                   [Set-Cookie: session (httpOnly, Secure, SameSite=Lax)]
  |<-- 200 + Set-Cookie ---|                           |
  |                         |                          |
  |-- GET / ------------->  |                          |
  |              [middleware checks session cookie]    |
  |              [session valid → pass through]        |
  |<-- 200 (dashboard shell) --|                       |
```

---

#### §1.10 — Data Flow: Authenticated Request with RLS

```
Route Handler
  └── auth()                          → { user_id, company_id, role }
  └── withTenant(db, company_id, async (tx) => {
        SET LOCAL app.current_company_id = '<company_id>';
        SELECT * FROM observations;   → RLS policy filters rows automatically
      })
  └── afterRelease hook               → RESET app.current_company_id
```

**Why `SET LOCAL` and not `SET`?**
`SET LOCAL` scopes the variable to the current transaction. Because Drizzle wraps the operation in a transaction, the variable is automatically cleared when the transaction commits or rolls back — no risk of leaking to the next pool user.

---

#### §1.11 — Validation Logic

**Login form (client side, Zod schema):**
- `email` — valid email format, max 255 chars
- `password` — min 8 chars, max 128 chars

**Environment variables (on boot, `src/lib/env.ts`):**
- All variables listed in the Front Matter env block are validated
- Type coercions: no booleans coerced from strings except `AUTH_TRUST_HOST` (coerce to boolean)
- URL variables validated as valid URLs (`DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_URL`, `PADDLEOCR_API_URL`, `NEXT_PUBLIC_APP_URL`)

---

#### §1.12 — Security & RBAC Implications

| Concern | Decision |
|---------|----------|
| Password storage | bcrypt, cost factor 12 |
| Session secret | `NEXTAUTH_SECRET` — minimum 32 bytes of random data (`openssl rand -base64 32`) |
| JWT leakage | `company_id` and `role` are in the JWT but the JWT is in an httpOnly cookie — never accessible from JS |
| RLS bypass | Only possible if `withTenant` wrapper is bypassed. All DB access must go through `withTenant`. Direct `db` access without tenant context is a code-review violation. |
| Tenant isolation | Verified by integration test (cross-tenant read attempt returns 0 rows, not an error) |
| RBAC in Slice 1 | Not yet enforced at route level (no protected operations exist). Role is embedded in JWT for use from Slice 3 onward. |
| `AUTH_TRUST_HOST` | Set `true` only when behind a trusted reverse proxy. Document this clearly in `.env.example`. |

---

#### §1.13 — Testing Strategy

**Unit tests (Vitest):**
- `env.ts` — test that boot throws with a descriptive message when a required variable is missing
- `auth.ts` — test JWT callback correctly projects `company_id` and `role`; test session callback strips password hash
- `db/rls.ts` — test that `withTenant` issues `SET LOCAL` before the callback and that `afterRelease` resets the variable

**Integration tests (`@testcontainers/postgresql`):**
- Spin up Postgres 16 container with pgvector
- Run all three migrations
- Assert `information_schema.tables` count ≥ 21
- Assert RLS enforcement: insert a row for company A; attempt to read with company B context → 0 rows returned
- Assert credentials provider: insert a seeded user; call `signIn` → receive valid JWT claims

**E2E tests (Playwright):**
- Navigate to `/` without a session → verify redirect to `/login`
- Submit valid credentials → verify redirect to `/` with sidebar visible
- Assert all 7 FR nav items are present in the DOM
- Submit invalid credentials → verify error message "Identifiants incorrects" is displayed

---

#### §1.14 — Edge Cases

| Case | Handling |
|------|----------|
| Login with unknown email | Auth.js returns generic "CredentialsSignin" error; UI shows "Identifiants incorrects" (no leaking whether email exists) |
| Login with correct email, wrong password | Same generic error as above |
| Expired JWT cookie | Middleware redirects to `/login` |
| DB unreachable at boot | Drizzle pool creation does not fail eagerly; first query to DB will throw; route handler returns 503 |
| Redis unreachable at boot | ioredis retries with backoff; does not crash Next.js process; BullMQ queue enqueue will fail at job creation time |
| `withTenant` called with null `companyId` | Throw immediately with a typed error before executing any DB query |
| Migration run twice | Drizzle Kit tracks applied migrations in `__drizzle_migrations` table; re-running is a no-op |
| HNSW migration run in transaction | Migration `0003` is marked `{ transaction: false }` — Drizzle Kit will not wrap it |

---

#### §1.15 — Acceptance Criteria

- [ ] `GET /` returns 200 for authenticated user; redirects to `/login` for unauthenticated
- [ ] `auth()` returns `{ user_id, company_id, role }` claims from JWT
- [ ] `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'` returns ≥ 21 tables
- [ ] RLS cross-tenant test: user from company A cannot read rows belonging to company B
- [ ] French sidebar renders with all 7 nav items: Tableau de bord, Documents, Observations, Conflits, Rapports, Chat, Paramètres
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `vitest run` passes all unit tests
- [ ] Integration test: migrations applied cleanly against a fresh Postgres 16 + pgvector container
- [ ] Playwright E2E: login flow, guard redirect, and sidebar navigation all pass
- [ ] Boot with a missing env variable throws a descriptive error listing the missing key

---

#### §1.16 — Verification Checklist

```
# 1. Start Postgres + Redis locally (or via Docker)
# 2. Copy .env.example → .env and fill in values
# 3. Run migrations
npx drizzle-kit migrate

# 4. Verify table count
psql $DATABASE_URL -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Expected: ≥ 21

# 5. Start Next.js dev server
npm run dev

# 6. Navigate to http://localhost:3000 — expect redirect to /login
# 7. Sign in with seeded credentials — expect dashboard shell with FR sidebar
# 8. Verify all 7 nav items render in French
# 9. Run unit tests
npx vitest run

# 10. Run E2E tests
npx playwright test
```

---

Slice 1 architectural plan complete. Say "continue" to expand the next slice.

---

### Slice 2 — Upload → OCR → Evidence Blocks → Pipeline SSE + Retry Endpoint + Stale Detection Cron + Document Versions

**Scope:** Complete upload flow (presigned R2), OCR pipeline job (PaddleOCR-VL 1.5), EvidenceBlock creation + page PNG rendering, chunking strategy, embedding stage (OpenAI text-embedding-3-small), pipeline SSE events via Redis pub/sub, Documents list page with real-time status badges.

**End-to-end value:** User uploads a PDF, watches it move through OCR → embedding on the Documents page with live stage badges, with no page reload required.

**Key routes/pages:** `/documents`, `/documents/[id]` (read-only metadata)  
**Key API endpoints:** `POST /api/uploads/init`, `POST /api/uploads/complete`, `GET /api/documents`, `GET /api/documents/{id}`, `GET /api/documents/{id}/status`, `GET /api/documents/{id}/blocks`, `GET /api/documents/{id}/pages/{n}`, `PATCH /api/documents/{id}/category`, `GET /api/pipeline/events` (SSE)  
**Key DB entities:** Document, DocumentVersion, EvidenceBlock (with embeddings), PipelineRun, Notification  
**Background jobs:** `ocr-job`, `embedding-job` (pipeline worker process)  
**Dependencies:** Slice 1

---

#### §2.1 — Responsibilities

This slice delivers the full document ingestion pipeline from user upload to embedded evidence blocks, plus the real-time status layer that communicates pipeline progress to the browser.

1. **Upload API** — generate presigned R2 PUT URLs; validate file size and MIME type; create Document + DocumentVersion records; enqueue `ocr-job`
2. **OCR stage** — fetch file from R2; convert PDF pages to PNGs via `pdf2pic`; call PaddleOCR-VL 1.5 API per page; parse response into EvidenceBlock rows; flag low-confidence blocks; upload page PNGs to R2
3. **Chunking** — post-OCR in-process step: merge adjacent same-type blocks within token budget; split oversized blocks; mark superseded originals
4. **Embedding stage** — batch-512 calls to OpenAI text-embedding-3-small; bulk-update `embedding` column; skip low-confidence blocks; dispatch `extraction-job` on success
5. **Pipeline SSE** — Redis pub/sub publisher used by pipeline worker at every status transition; Next.js SSE route handler subscribes and streams events to the browser
6. **Documents UI** — Documents list page with status badge per document; real-time updates driven by SSE; upload trigger button
7. **Pipeline worker process** — standalone Node.js process that consumes BullMQ queues; manages OCR and embedding job handlers

---

#### §2.2 — System Boundaries

```
Browser
  ├── PUT <presigned R2 URL>        (direct R2 upload, bypasses Next.js)
  ├── POST /api/uploads/init        → Next.js (generates presigned URL)
  ├── POST /api/uploads/complete    → Next.js (creates DB records, enqueues job)
  ├── GET  /api/documents           → Next.js
  ├── GET  /api/documents/{id}      → Next.js
  ├── GET  /api/documents/{id}/status  → Next.js
  ├── GET  /api/documents/{id}/blocks  → Next.js
  ├── GET  /api/documents/{id}/pages/{n} → Next.js (returns presigned R2 GET URL)
  ├── PATCH /api/documents/{id}/category → Next.js (reassign document category)
  └── GET  /api/pipeline/events     → Next.js SSE handler
        └── subscribes to Redis channel: pipeline:events:{company_id}

Pipeline Worker (separate process, port 3002)
  ├── GET /health (port 3002) → { status: "ok", active_jobs, uptime_s } (MR-14)
  ├── System deps: ghostscript, graphicsmagick (required by pdf2pic)
  ├── Separate DB pool (min 1, max 5 connections)
  ├── Consumes BullMQ: ocr-job
  │     ├── GET <R2 signed URL>     (fetch PDF/image)
  │     ├── pdf2pic                 (PDF → PNG per page)
  │     ├── PUT R2 page PNGs        (store page images)
  │     ├── PaddleOCR API           (OCR per page)
  │     ├── INSERT evidence_blocks  (Drizzle)
  │     ├── chunking step           (in-process, no external API)
  │     └── enqueue embedding-job
  └── Consumes BullMQ: embedding-job
        ├── OpenAI embeddings API   (batch 512)
        ├── UPDATE evidence_blocks  (set embedding vector)
        └── enqueue extraction-job  (Slice 3)

Redis (shared)
  ├── BullMQ queues
  └── pub/sub channel: pipeline:events:{company_id}

Cloudflare R2
  ├── {company_id}/{document_version_id}/original.{ext}   (uploaded file)
  └── {company_id}/{document_version_id}/pages/{n}.png    (page images)
```

**Not in scope for this slice:**
- Extraction job (observation creation)
- Semantic conflict detection
- Any AI report generation
- Chat

---

#### §2.3 — New Files (additions to Slice 1 directory structure)

```
src/
  app/
    (app)/
      documents/
        page.tsx                     # DocumentsListPage — paginated list, upload button, status badges
        [id]/
          page.tsx                   # DocumentDetailPage — read-only metadata shell (split-view in Slice 3)
    api/
      uploads/
        init/
          route.ts                   # POST /api/uploads/init
        complete/
          route.ts                   # POST /api/uploads/complete
      documents/
        route.ts                     # GET /api/documents
        [id]/
          route.ts                   # GET /api/documents/{id}
          versions/
            route.ts                 # GET /api/documents/{id}/versions
          status/
            route.ts                 # GET /api/documents/{id}/status
          blocks/
            route.ts                 # GET /api/documents/{id}/blocks
          pages/
            [pageNumber]/
              route.ts               # GET /api/documents/{id}/pages/{n}
          retry/
            route.ts                 # POST /api/documents/{id}/retry
          category/
            route.ts                 # PATCH /api/documents/{id}/category (reassign document category)
      pipeline/
        events/
          route.ts                   # GET /api/pipeline/events  (SSE)

  components/
    documents/
      DocumentsTable.tsx             # Paginated table of document rows
      DocumentStatusBadge.tsx        # Animated Framer Motion pulse badge per pipeline_status
      UploadButton.tsx               # Opens file picker; triggers upload flow
      UploadProgressOverlay.tsx      # Upload % progress indicator
    pipeline/
      PipelineSSEProvider.tsx        # Singleton EventSource; reconnect backoff; context provider
      usePipelineStream.ts           # Hook — subscribe to SSE events by document_id

  lib/
    uploads/
      presign.ts                     # generateUploadUrl(companyId, ext) → { uploadUrl, objectKey }
      validate.ts                    # validateUploadRequest(body) — Zod schema + size/MIME checks
    pipeline/
      pubsub.ts                      # publishPipelineEvent(companyId, event) — Redis pub/sub publisher
      events.ts                      # PipelineEvent type union; event shape constants
    ocr/
      paddleocr.ts                   # callPaddleOcr(pageBase64[]) → raw API response
      parse.ts                       # parseOcrResponse(raw) → { blocks: ParsedBlock[] }
      pdf2pic.ts                     # convertPdfToPages(r2Key) → Buffer[] (one per page)
    chunking/
      merge.ts                       # mergeAdjacentBlocks(blocks[]) → ChunkedBlock[]
      split.ts                       # splitOversizedBlock(block) → ChunkedBlock[]
      tokenize.ts                    # countTokens(text) using tiktoken cl100k_base
    embeddings/
      openai.ts                      # batchEmbed(texts[], batchSize=512) → vector[][]

workers/
  pipeline/
    index.ts                         # Worker process entry — registers consumers + starts HTTP health check server on port 3002 (MR-14)
    db.ts                            # Separate DB pool for pipeline worker (pool size min 1, max 5)
    health.ts                        # HTTP server: GET /health on port 3002 → { status: "ok", active_jobs, uptime_s } (MR-14)
    jobs/
      ocr.ts                         # processOcrJob(job) — full OCR stage handler
      embedding.ts                   # processEmbeddingJob(job) — full embedding stage handler
    dlq.ts                           # Dead-letter handler — sets pipeline_status=failed, inserts Notification
    cron/
      stale-pipeline.ts              # Stale-pipeline detection — runs every 5 min via BullMQ repeatable job
```

---

#### §2.4 — API Endpoint Contracts

---

##### `POST /api/uploads/init`

**Purpose:** Validate file metadata, generate a presigned R2 PUT URL.

**Auth:** Required. `company_id` from session.

**Request body:**
```json
{
  "filename": "rapport-energie-2025.pdf",
  "fileSize": 10485760,
  "mimeType": "application/pdf",
  "pageCount": 12,
  "categoryId": "<uuid | null>"
}
```

**Validation rules:**
- `mimeType` — must be one of: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/tiff`
- `fileSize` — max 52428800 bytes (50 MB); return 422 `{ code: "file_too_large" }` on violation
- `mimeType` not in allowlist — return 422 `{ code: "unsupported_mime_type" }`
- `pageCount` — integer, 1–200; return 422 `{ code: "page_count_exceeded", max: 200 }` if > 200
- `categoryId` — if provided, must be a valid UUID belonging to the session's `company_id`

**Success response `200`:**
```json
{
  "uploadUrl": "https://<r2-presigned-put-url>",
  "objectKey": "<company_id>/<uuidv7>/original.pdf",
  "expiresIn": 900
}
```
Presigned URL valid for 15 minutes. `objectKey` is stable — used in `/complete`.

**Error responses:**
- `422` — validation failure with `{ code, field? }`
- `401` — no valid session

---

##### `POST /api/uploads/complete`

**Purpose:** Record upload completion; create Document + DocumentVersion; enqueue `ocr-job`.

**Auth:** Required.

**Request body:**
```json
{
  "objectKey": "<company_id>/<uuidv7>/original.pdf",
  "filename": "rapport-energie-2025.pdf",
  "pageCount": 12,
  "categoryId": "<uuid | null>",
  "clientId": "<uuid | null>"
}
```

**Validation rules:**
- `objectKey` — must match pattern `{session.company_id}/<uuid>/original.<ext>`; guards against cross-tenant injection
- `pageCount` — re-validated server-side: 1–200
- Object must exist in R2 (HEAD request to verify); return 422 `{ code: "object_not_found" }` if not

**Server actions:**
0. **Idempotency check:** `SELECT document_version WHERE object_key = objectKey`. If exists, return the existing `{ documentId, documentVersionId, pipelineStatus }` with HTTP `200` (not `201`). Do NOT create duplicate rows or re-enqueue.
1. Create `Document` row (`company_id`, `category_id`, `title = filename`)
2. Create `DocumentVersion` row (`document_id`, `company_id`, `object_key = objectKey`, `file_hash`, `original_filename`, `file_size_bytes`, `page_count`, `pipeline_status = "uploaded"`)
3. Enqueue `ocr-job` with `{ documentVersionId }`
4. Create `PipelineRun` row (`status = "running"`, `started_at = now`)
5. Publish SSE event `pipeline_stage_changed` with new status

**Success response `201`:**
```json
{
  "documentId": "<uuid>",
  "documentVersionId": "<uuid>",
  "pipelineStatus": "uploaded"
}
```

**Idempotent replay response `200`:** (same shape as `201`, returned when `objectKey` already exists)

**Error responses:**
- `422` — validation failure

---

##### `GET /api/documents`

**Purpose:** Paginated list of documents for the authenticated company.

**Auth:** Required.

**Query params:** `?page=1&limit=20&status=<pipeline_status>&categoryId=<uuid>&q=<search>`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "originalFilename": "rapport.pdf",
      "categoryId": "<uuid | null>",
      "clientId": "<uuid | null>",
      "pipelineStatus": "embedded",
      "createdAt": "<iso8601>"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

- Sorted by `created_at DESC` by default
- `pipelineStatus` reflects the latest `DocumentVersion` for the document

---

##### `GET /api/documents/{id}`

**Purpose:** Single document with its latest version metadata.

**Auth:** Required. RLS enforces company isolation.

**Response `200`:**
```json
{
  "id": "<uuid>",
  "originalFilename": "rapport.pdf",
  "categoryId": "<uuid | null>",
  "clientId": "<uuid | null>",
  "latestVersion": {
    "id": "<uuid>",
    "version": 1,
    "pipelineStatus": "embedded",
    "pageCount": 12,
    "sizeBytes": 10485760,
    "createdAt": "<iso8601>"
  }
}
```

**Error:** `404` if document doesn't exist or belongs to different company (RLS returns zero rows → treat as 404).

---

##### `GET /api/documents/{id}/versions`

**Purpose:** List all versions of a document (supports re-upload history).

**Auth:** Required. RLS enforces company isolation.

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "version": 2,
      "pipelineStatus": "embedded",
      "pageCount": 14,
      "fileSizeBytes": 12345678,
      "objectKey": "<key>",
      "pipelineError": null,
      "createdAt": "<iso8601>"
    }
  ]
}
```

Sorted by `created_at DESC` (latest first). Returns all versions, including `failed` ones.

**Error:** `404` — document not found or belongs to different company.

---

##### `GET /api/documents/{id}/status`

**Purpose:** Lightweight polling endpoint for pipeline status.

**Auth:** Required.

**Response `200`:**
```json
{
  "pipelineStatus": "ocr_processing",
  "pipelineError": null
}
```

---

##### `GET /api/documents/{id}/blocks`

**Purpose:** All evidence blocks for the latest document version.

**Auth:** Required.

**Query params:** `?page=<n>&limit=100&lowConfidence=true|false`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "pageNumber": 1,
      "textContent": "Émissions de GES scope 1 : 1 240 tCO2e",
      "ocrConfidence": 0.97,
      "lowConfidence": false,
      "bbox": { "x1": 0.05, "y1": 0.12, "x2": 0.60, "y2": 0.15 },
      "hasEmbedding": true
    }
  ],
  "total": 87,
  "page": 1,
  "pageSize": 100
}
```

Note: `embedding` vector is **never returned** in the API response (large payload, server-side only).

---

##### `GET /api/documents/{id}/pages/{pageNumber}`

**Purpose:** Return a presigned R2 GET URL for the page PNG.

**Auth:** Required.

**Success response `200`:**
```json
{
  "pageImageUrl": "https://<r2-presigned-get-url>",
  "expiresIn": 3600
}
```

**Error — page not ready:**
```json
{
  "code": "page_not_ready",
  "pipelineStatus": "ocr_processing"
}
```
HTTP `404`. Returned when `pipeline_status` has not yet reached `ocr_done`.

**Error:** `404` — `pageNumber` out of range (> `page_count`).

---

##### `POST /api/documents/{id}/retry`

**Purpose:** Retry a failed or stalled pipeline. Resets the document version to `uploaded` and re-enqueues the OCR job.

**Auth:** Required. RLS enforces company isolation. `role !== "viewer"` required (403 otherwise).

**Request body:** _(none)_

**Server actions:**
1. Fetch latest `DocumentVersion` for the document.
2. Validate `pipeline_status` is `failed` or has been stuck in a processing state > 10 minutes (based on `pipeline_status_updated_at`).
3. UPDATE `pipeline_status = 'uploaded'`, clear `pipeline_error_message`
4. Enqueue `ocr-job` with `{ documentVersionId }`
5. INSERT `pipeline_run` (status: running)
6. Publish SSE `pipeline_stage_changed`

**Success response `200`:**
```json
{
  "documentVersionId": "<uuid>",
  "pipelineStatus": "uploaded"
}
```

**Error responses:**
- `404` — document not found or belongs to different company
- `409` — pipeline is not in a retriable state (actively processing and not stale)
- `403` — viewer role

---

##### `PATCH /api/documents/{id}/category`

**Purpose:** Assign or change the category of a document (FR-10).

**Auth:** Required. Role: `editor` or `admin` — returns `403` for `viewer`.

**Request body:**
```json
{ "categoryId": "<uuid> | null" }
```
- `null` unsets the category (document becomes uncategorized).
- If `categoryId` is provided, must belong to `ctx.companyId` — `422` with `{ code: "invalid_category" }` otherwise.

**Server actions:**
1. Validate document belongs to `ctx.companyId` (RLS).
2. If `categoryId` is non-null: verify the `DocumentCategory` row exists and belongs to `ctx.companyId`.
3. UPDATE `document.category_id = categoryId`.
4. INSERT `AuditLog` entry.

**Success response `200`:**
```json
{ "documentId": "<uuid>", "categoryId": "<uuid> | null", "updatedAt": "<iso8601>" }
```

**Error `403`:** Viewer role.
**Error `404`:** Document not found (RLS).
**Error `422`:** `{ code: "invalid_category" }` — category does not exist or belongs to another company.

---

##### `GET /api/pipeline/events` (SSE)

**Purpose:** Server-Sent Events stream of pipeline stage changes for the authenticated company.

**Auth:** Required. `company_id` extracted **exclusively from session** — query params ignored (resolves RISK-02).

**Connection lifecycle:**
- On connect: subscribe to Redis channel `pipeline:events:{company_id}` via `redisSub` client
- On each Redis message: write `data: <json>\n\n` to the response stream
- Heartbeat: write `data: {"type":"heartbeat"}\n\n` every 30 seconds
- On client disconnect: unsubscribe from Redis channel; clean up response reference

**Event shape — `pipeline_stage_changed`:**
```json
{
  "type": "pipeline_stage_changed",
  "documentVersionId": "<uuid>",
  "documentId": "<uuid>",
  "pipelineStatus": "ocr_processing",
  "timestamp": "<iso8601>"
}
```

**Event shape — `pipeline_failed`:**
```json
{
  "type": "pipeline_failed",
  "documentVersionId": "<uuid>",
  "documentId": "<uuid>",
  "stage": "ocr",
  "error": "PaddleOCR API timeout",
  "timestamp": "<iso8601>"
}
```

**Event shape — `extraction_complete`** (published at end of Slice 3's extraction job, but SSE layer is established here):
```json
{
  "type": "extraction_complete",
  "documentVersionId": "<uuid>",
  "documentId": "<uuid>",
  "observationCount": 14,
  "timestamp": "<iso8601>"
}
```

**Race condition mitigation (RISK-03 pre-resolution for pipeline SSE):**
- An in-memory `Map<companyId, Event[]>` replay buffer holds the last 60 seconds of events per company
- On new SSE connection, server reads the `Last-Event-ID` header; replays any events from the buffer that occurred after the last seen ID
- Each event has a monotonic `id` field for `Last-Event-ID` tracking

---

#### §2.5 — Upload Flow (Data Flow)

```
Browser
  1. User selects file
  2. Client validates: size ≤ 50MB, MIME allowed, pageCount ≤ 200
     └── Error? Show inline validation message. No API call.
  3. POST /api/uploads/init  { filename, fileSize, mimeType, pageCount, categoryId }
     └── Server: validate → generate presigned R2 PUT URL → return { uploadUrl, objectKey }
  4. PUT <uploadUrl>  (direct to R2, with Content-Type header)
     └── Monitor XHR progress for UploadProgressOverlay
  5. POST /api/uploads/complete  { objectKey, filename, pageCount, categoryId, clientId }
     └── Server:
           a. HEAD R2 to confirm object exists
           b. INSERT document + document_version (status: pending)
           c. enqueue ocr-job
           d. INSERT pipeline_run (stage: ocr, status: queued)
           e. publishPipelineEvent → Redis → SSE → Browser badge update
     └── Response: { documentId, documentVersionId, pipelineStatus: "pending" }
  6. Browser optimistically adds document card to list with status "Importé"
  7. SSE stream delivers status updates as pipeline progresses
```

---

#### §2.6 — OCR Job Flow (Pipeline Worker)

```
BullMQ dequeues ocr-job { documentVersionId }

processOcrJob:
  1. Fetch DocumentVersion — check pipeline_status
     └── If already completed or beyond (ocr_done, embedding, embedded, extracting, review_ready) → idempotency guard: skip
     └── If "ocr_processing" → allow re-entry (crash recovery: previous attempt may have died mid-job)
     └── If "failed" → allow re-entry (explicit retry via POST /api/documents/{id}/retry)
     └── If "pending" → proceed normally
  2. UPDATE pipeline_status = "ocr_processing"; publish SSE event
  3. INSERT or UPDATE pipeline_run (status: running, started_at: now)
  4. GET signed R2 URL for objectKey; stream file to temp buffer
  5. If PDF:
       pdf2pic(buffer, { density: 150, format: 'png' }) → [Buffer, Buffer, ...]  (one per page)
       **System dependency:** `pdf2pic` shell-spawns `gm` (GraphicsMagick) and `gs` (Ghostscript). Both must be installed in the pipeline worker container: `apt-get install -y ghostscript graphicsmagick`. Local dev: `brew install ghostscript graphicsmagick` (macOS), `choco install ghostscript graphicsmagick` (Windows).
     If image:
       treat as single-page [buffer]
  6. For each page (in parallel, max 4 concurrent):
       a. base64-encode page PNG buffer
       b. POST PaddleOCR-VL API { image: base64, ... }
       c. parseOcrResponse(raw) → ParsedBlock[]  (bbox pixel→ratio normalization here)
       d. PUT page PNG to R2 at key: {company_id}/{document_version_id}/pages/{n}.png

> **Open decision — PaddleOCR call strategy:** The current plan calls PaddleOCR once **per page** (step 6b). PaddleOCR-VL 1.5 may also accept multi-page PDFs in a single API call (per-file mode), which would reduce HTTP round-trips but increase per-call latency and blast radius on failure. **Decision needed before implementation:** validate whether the PaddleOCR-VL 1.5 API supports batched/multi-page input. If yes, decide per-file vs per-page based on error isolation and timeout considerations. If per-page, adjust timeout to `pageCount × 20s`. Document the chosen strategy and validate API response shape with a test call.
  7. Run chunking step (in same process — see §2.8)
  8. bulk INSERT evidence_blocks (all pages in one transaction)
     └── low_confidence = (ocr_confidence < LOW_CONFIDENCE_THRESHOLD)
     └── embedding = null (populated by embedding-job)
  9. UPDATE document_version: page_count = actual page count, pipeline_status = "ocr_done"
 10. UPDATE pipeline_run: status = done, finished_at = now
 11. publishPipelineEvent(companyId, { type: "pipeline_stage_changed", pipelineStatus: "ocr_done" })
 12. Enqueue embedding-job { documentVersionId }
 13. INSERT pipeline_run (stage: embedding, status: queued)
```

**DLQ / failure path:**
- BullMQ retries: 2 attempts with exponential backoff (1s, 4s)
- After all retries exhausted → `dlq.ts` handler:
  - UPDATE `document_version.pipeline_status = "failed"`, `pipeline_error = error.message`
  - UPDATE `pipeline_run.status = "failed"`, `error = error.message`, `finished_at = now`
  - INSERT `notification` for company
  - publishPipelineEvent `pipeline_failed`

---

#### §2.7 — Chunking Strategy

Chunking runs synchronously within the `ocr-job` handler, before bulk-inserting to DB. No external API call.

**Input:** Array of `ParsedBlock` from OCR (already ordered by page, then top-to-bottom y1).

**Rules:**

| Rule | Condition | Action |
|------|-----------|--------|
| **Merge** | Two adjacent blocks, same `block_type` (both `paragraph`), vertical gap < 20px (ratio), combined tokens ≤ 512 | Merge into one block; set `chunk_type = "merged"`; store `merged_block_ids = [a.id, b.id]`; mark originals `chunk_type = "superseded"` |
| **No merge across page** | Blocks on different pages | Never merge |
| **No merge for tables** | `block_type = "table_cell"` or `"table"` | Keep as-is; `chunk_type = "original"` |
| **Split** | Single block with tokens > 512 | Split at sentence boundary near 512-token mark; `chunk_type = "split"`; set `parent_block_id` on each fragment |
| **Pass-through** | Block ≤ 512 tokens, no adjacent merge candidate | `chunk_type = "original"` |

**Token counting:** `tiktoken` with `cl100k_base` encoding (matches OpenAI embedding model tokenizer).

**Superseded blocks behavior:**
- `chunk_type = "superseded"` blocks are stored in DB for provenance tracing
- They are excluded from embedding (their `embedding` stays null; `low_confidence` set to true as a proxy flag to skip embedding)
- They are not returned in `/blocks` API by default (filter `chunk_type != "superseded"` unless `?includeSuperseeded=true`)

---

#### §2.8 — Embedding Job Flow (Pipeline Worker)

```
BullMQ dequeues embedding-job { documentVersionId }

processEmbeddingJob:
  1. Fetch DocumentVersion — check pipeline_status
     └── If already completed or beyond (embedded, extracting, review_ready) → idempotency guard: skip
     └── If earlier stage still running (pending, ocr_processing) → skip (should not happen; log warning)
     └── If "embedding" → allow re-entry (crash recovery)
     └── If "ocr_done" → proceed normally
  2. UPDATE pipeline_status = "embedding"; publish SSE event
  3. INSERT or UPDATE pipeline_run (status: running, started_at: now)
  4. SELECT evidence_blocks WHERE document_version_id = ? 
       AND low_confidence = false 
       AND chunk_type != "superseded"
       AND embedding IS NULL
  5. Partition blocks into batches of 512 (OpenAI limit)
  6. For each batch:
       a. POST OpenAI embeddings API { input: [text...], model: "text-embedding-3-small" }
       b. On success: bulk UPDATE embedding = vector for each block in batch
       c. On failure for batch: mark those blocks embedding_status = "failed"; continue
  7. UPDATE pipeline_status = "embedded"
  8. UPDATE pipeline_run (stage: embedding, status: done, finished_at: now)
  9. publishPipelineEvent(companyId, { type: "pipeline_stage_changed", pipelineStatus: "embedded" })
 10. Enqueue extraction-job { documentVersionId }  (consumed in Slice 3)
 11. INSERT pipeline_run (stage: extraction, status: queued)
```

**Per-batch failure isolation:** A single batch failure does not abort the job. Blocks from the failed batch are marked individually; the pipeline still advances to `embedded`. An `extraction-job` is still enqueued — the extractor will simply have fewer evidence blocks to work with.

---

#### §2.9 — Database Writes in This Slice

All tables are already declared in Slice 1. This slice only writes data:

| Table | Operation | Trigger |
|-------|-----------|---------|
| `documents` | INSERT | `POST /api/uploads/complete` |
| `document_versions` | INSERT, UPDATE (pipeline_status, page_count) | `POST /api/uploads/complete`, each pipeline stage |
| `evidence_blocks` | bulk INSERT | end of OCR job |
| `evidence_blocks` | bulk UPDATE (embedding) | embedding job |
| `pipeline_runs` | INSERT, UPDATE (status, timestamps, error) | each pipeline stage |
| `notifications` | INSERT | DLQ failure handler |

**No new tables or migrations in Slice 2.**

---

#### §2.10 — Redis Pub/Sub Architecture for SSE

**Publisher (`src/lib/pipeline/pubsub.ts`):**
- `publishPipelineEvent(companyId: string, event: PipelineEvent): Promise<void>`
- Calls `redis.publish("pipeline:events:" + companyId, JSON.stringify(event))`
- Used by pipeline worker; also usable from route handlers

**Subscriber (in SSE route handler):**
- Uses the dedicated `redisSub` client (set up in Slice 1 `src/lib/redis.ts`)
- `redisSub.subscribe("pipeline:events:" + companyId)`
- On `message` event: write to HTTP response stream
- On connection close: `redisSub.unsubscribe(channel)`

**Fan-out with horizontal scaling:**
- Each Next.js instance subscribes independently to the same Redis channel
- All instances receive every event — correct; each SSE connection is handled by exactly one instance
- No sticky sessions required

**In-memory replay buffer:**
- `Map<companyId, Array<{ id: number, event: PipelineEvent, timestamp: number }>>` in the SSE route module
- Max size per company: 200 events; TTL: 60 seconds
- On each publish, also push to buffer (buffer lives in the publishing process — only useful for single-instance dev; production relies on Redis pub/sub)
- On SSE connect with `Last-Event-ID` header: replay matching events from buffer before subscribing

---

#### §2.11 — PaddleOCR Response Parsing & Coordinate Normalization

**PaddleOCR-VL 1.5 returns pixel-coordinate bounding boxes:**
```json
{ "boxes": [[x1, y1, x2, y2], ...], "texts": ["..."], "scores": [0.97, ...] }
```

**`parseOcrResponse` responsibilities:**
- Map each `(box, text, score)` triple to a `ParsedBlock`
- Normalize bbox: `{ x1: box[0]/pageWidth, y1: box[1]/pageHeight, x2: box[2]/pageWidth, y2: box[3]/pageHeight }`
- `pageWidth` and `pageHeight` come from the PNG buffer dimensions (read via `sharp` or `image-size` before calling PaddleOCR)
- Clamp all ratio values to `[0.0, 1.0]`
- Infer `block_type`: if page image metadata indicates tabular layout, mark `block_type = "table_cell"`, else `"paragraph"` (heuristic: aspect ratio and text density)

---

#### §2.12 — UI Responsibilities

**`DocumentsListPage` (`/documents`):**
- Server component: initial fetch of `GET /api/documents?page=1&limit=20` for SSR
- Client hydration: mounts `PipelineSSEProvider`; subscribes to `pipeline_stage_changed` events
- On SSE event: updates document card `pipelineStatus` optimistically in React state without refetch
- Shows `UploadButton` prominently; opens file picker
- Empty state: "Importez votre premier document" when `data.total === 0`

**`DocumentStatusBadge`:**
- Maps `pipeline_status` string to FR label and color:
  - `pending` → "En attente" (grey)
  - `ocr_processing` → "OCR en cours…" (blue, animated pulse)
  - `ocr_done` → "OCR terminé" (blue)
  - `embedding` → "Analyse…" (blue, animated pulse)
  - `embedded` → "Analysé" (green)
  - `failed` → "Échec" (red)
- Framer Motion `animate` prop drives the pulse on `_processing` / `embedding` states

**`PipelineSSEProvider`:**
- Singleton `EventSource` per authenticated session (not per component)
- Reconnect: exponential backoff starting at 1s, max 30s, sends `Last-Event-ID` on reconnect
- Exposes context: `{ subscribe(handler), unsubscribe(handler) }`
- Mounted once in the `(app)/layout.tsx`

**`UploadButton` / upload flow:**
- Client-side size and MIME validation before calling `/init`
- Shows `UploadProgressOverlay` with XHR progress % during R2 PUT
- On `/complete` success: adds document card optimistically to list

**`UploadProgressOverlay` — 403 retry with fresh presigned URL (MR-30):**
- During the R2 PUT, if the XHR response returns HTTP `403` (presigned URL expired), the overlay automatically:
  1. Calls `POST /api/uploads/init` again with the same file metadata to obtain a fresh presigned URL.
  2. Retries the PUT from the beginning with the new URL (upload progress resets to 0%).
  3. Shows inline message: « Le lien d’import a expiré. Nouvel essai en cours… » during the retry.
- Maximum 1 automatic retry. If the second PUT also returns 403: show error « Le délai d’import a expiré. Veuillez réessayer. » with a manual « Réessayer » button that restarts the full flow from `/init`.
- Non-403 errors (network failure, 5xx) are not auto-retried; they show the standard error state immediately.

---

#### §2.13 — Validation Logic

**Upload init (server, Zod):**
- `filename`: string, 1–255 chars
- `fileSize`: integer > 0, max 52428800
- `mimeType`: enum of allowed types
- `pageCount`: integer, 1–200
- `categoryId`: UUID or null; if present, verify belongs to session's `company_id`

**Upload complete (server, Zod):**
- `objectKey`: string matching regex `^[0-9a-f-]{36}/[0-9a-f-]{36}/original\.(pdf|png|jpg|jpeg|webp)$`
- `filename`: string, 1–255 chars
- `pageCount`: integer, 1–200
- Cross-check: `objectKey` must start with `session.company_id + "/"` (prefix guard)

**Client-side (before calling `/init`):**
- File size ≤ 50MB — show "Fichier trop volumineux (max 50 Mo)" without API call
- MIME type from `file.type` must be in allowlist — show "Type de fichier non supporté"
- Page count read from PDF: use `pdfjs-dist` in the browser to count pages before upload

---

#### §2.14 — Security & RBAC

| Concern | Decision |
|---------|----------|
| R2 presigned URL scope | PUT URL scoped to exactly one object key; server sets `Content-Length` and `Content-Type` in the presigned URL conditions to prevent upload substitution |
| `objectKey` prefix check | Server validates `objectKey` starts with `session.company_id/` — prevents a user from completing an upload that places an object in another tenant's namespace |
| SSE `company_id` isolation | Derived from Auth.js session only; query params are ignored (RISK-02 resolved) |
| Pipeline worker DB access | Worker process calls `withTenant(db, company_id, ...)` using `company_id` from the job payload — `company_id` is injected at job-enqueue time from the authenticated session |
| Page image access | `GET /api/documents/{id}/pages/{n}` validates document belongs to session's `company_id` via RLS before generating presigned URL |
| RBAC for upload | `role = viewer` cannot upload — route handler checks `session.role !== "viewer"` and returns 403 |

---

#### §2.15 — Testing Strategy

**Unit tests (Vitest):**
- `lib/uploads/validate.ts` — test each validation rule in isolation (size, MIME, pageCount, objectKey prefix)
- `lib/ocr/parse.ts` — test coordinate normalization (known input pixel coords → expected ratios)
- `lib/chunking/merge.ts` — test merge rule: adjacent paragraphs merge; table cells do not; cross-page never merges
- `lib/chunking/split.ts` — test split rule: block >512 tokens splits correctly; `parent_block_id` set on fragments
- `lib/chunking/tokenize.ts` — count tokens for known strings; assert cl100k_base encoding

**Integration tests (`@testcontainers/postgresql` + mocked external APIs):**
- Mock PaddleOCR API: return fixed OCR response for a known PDF
- Mock OpenAI embeddings API: return fixed 1536-dim zero vector
- `POST /api/uploads/init` → `POST /api/uploads/complete` (with mocked R2 HEAD) → assert `documents` + `document_versions` rows created
- Run `processOcrJob` in test process → assert `evidence_blocks` rows with correct `page_number`, `bbox`, `low_confidence` flags
- Run `processEmbeddingJob` → assert `embedding` column non-null for non-low-confidence blocks
- Assert idempotency: run `processOcrJob` twice on same job → second run is a no-op (status gate check)

**E2E tests (Playwright):**
- Upload a test PDF (< 50KB fixture) → verify document card appears with "En attente" badge
- Wait for SSE event → verify badge transitions to "Analysé" (polled via `page.waitForFunction`)
- Attempt upload with a `.txt` file → verify client-side error "Type de fichier non supporté" without network call
- Attempt upload with a >50MB file → verify inline size error

---

#### §2.16 — Edge Cases

| Case | Handling |
|------|----------|
| R2 PUT times out (user lost connection mid-upload) | `POST /api/uploads/complete` will fail R2 HEAD check → 422 `object_not_found`. Client shows retry prompt. |
| PaddleOCR returns empty text on a page | Insert EvidenceBlock with `text_content = ""`, `ocr_confidence = 0` → `low_confidence = true`. PDF still processes. |
| PDF with 0 pages (corrupt file) | `pdf2pic` throws; OCR job catches → DLQ path. `pipeline_status = "failed"`. |
| Presigned URL expires before user uploads | Client PUT to R2 returns 403. `UploadProgressOverlay` auto-retries once: calls `/init` for a fresh presigned URL, then retries PUT (progress resets to 0%). Shows « Le lien d’import a expiré. Nouvel essai en cours… ». If second attempt also fails 403: shows « Le délai d’import a expiré. Veuillez réessayer. » with manual retry button. (MR-30) |
| Same objectKey completed twice | Unique constraint violation or idempotency check on `document_version.r2_key`; second call returns 409. |
| OpenAI embedding batch partial failure | Failed batch blocks get `embedding = null`; pipeline advances. These blocks are skipped by extractor. |
| OCR job retried after partial page PNGs uploaded | Idempotency gate: check `pipeline_status`. If `ocr_done`, skip. If `ocr_processing`, re-run from scratch (page PNGs are overwritten in R2). |
| Document version never reaches `embedded` (worker crash) | Stale-pipeline detection cron runs every 5 minutes: any `DocumentVersion` stuck in `ocr_processing`, `embedding`, or `extracting` for > 10 minutes (based on `pipeline_status_updated_at`) is marked `pipeline_status = 'failed'` with `pipeline_error_message = 'Pipeline stalled — timed out'`. A `Notification` of type `pipeline_failed` is inserted. User can retry via `POST /api/documents/{id}/retry`. |
| Large document (200 pages) exceeds embedding API rate limits | Batches are submitted serially per batch call; no spike. OpenAI rate limits are per-minute; 200 pages × ~4 blocks/page = ~800 blocks → ≤ 2 batches of 512. Well within limits. |

---

#### §2.17 — Acceptance Criteria

- [ ] Uploading a PDF under 50MB triggers pipeline; `DocumentVersion.pipeline_status` reaches `embedded` within 5 minutes (p95)
- [ ] `GET /api/documents/{id}/blocks` returns ≥ 1 EvidenceBlock with `hasEmbedding: true`
- [ ] `GET /api/pipeline/events` SSE stream delivers `pipeline_stage_changed` event within 2 seconds of each status transition
- [ ] Page image available at `GET /api/documents/{id}/pages/1` after OCR completes; returns 404 with `{ code: "page_not_ready" }` before OCR is done
- [ ] Blocks with `ocr_confidence < 0.70` have `low_confidence = true` and `embedding = null`
- [ ] Client-side: uploading a file > 50MB shows FR validation error without calling `/api/uploads/init`
- [ ] SSE stream with mismatched `company_id` returns 403 immediately
- [ ] `tsc --noEmit` passes; `vitest run` passes all new unit + integration tests
- [ ] Re-running `processOcrJob` for an already-completed document version is a no-op (idempotency)
- [ ] Re-running `processOcrJob` for a crashed-in-progress document version (`ocr_processing`) allows re-entry (crash recovery)
- [ ] `POST /api/documents/{id}/retry` resets a `failed` document version to `uploaded` and re-enqueues `ocr-job`; returns 409 for non-retriable states
- [ ] Stale-pipeline cron marks document versions stuck in processing states > 10 min as `failed` and inserts a notification
- [ ] `GET /api/documents/{id}/versions` returns all document versions sorted by version DESC
- [ ] `POST /api/uploads/complete` with a duplicate `objectKey` returns 200 with existing data (idempotent, no duplicate rows)

---

#### §2.18 — Verification Checklist

```
# 1. Start pipeline worker
node workers/pipeline/index.ts

# 2. Upload a test PDF via the UI or curl:
curl -X POST http://localhost:3000/api/uploads/init \
  -H "Cookie: <session>" \
  -d '{"filename":"test.pdf","fileSize":102400,"mimeType":"application/pdf","pageCount":2}'
# → returns { uploadUrl, objectKey }

# 3. PUT the PDF to the presigned URL
curl -X PUT "<uploadUrl>" --data-binary @fixture.pdf -H "Content-Type: application/pdf"

# 4. Complete the upload
curl -X POST http://localhost:3000/api/uploads/complete \
  -H "Cookie: <session>" \
  -d '{"objectKey":"...","filename":"test.pdf","pageCount":2}'
# → returns { documentId, documentVersionId, pipelineStatus: "pending" }

# 5. Poll status (or watch SSE)
curl http://localhost:3000/api/documents/{id}/status -H "Cookie: <session>"

# 6. After pipeline completes, verify blocks
curl http://localhost:3000/api/documents/{id}/blocks -H "Cookie: <session>"
# → data array with ≥ 1 block, hasEmbedding: true

# 7. Verify page image
curl http://localhost:3000/api/documents/{id}/pages/1 -H "Cookie: <session>"
# → { pageImageUrl: "https://..." }

# 8. Run tests
npx vitest run
npx playwright test --grep "upload"
```

---

Slice 2 architectural plan complete. Say "continue" to expand the next slice.

---

### Slice 3 — Extraction → Review Queue → Document Detail Split-View + Read-Only Categories Endpoint

**Scope:** Extraction pipeline job (Grok, hybrid RAG retrieval, hallucination guard, exact-match conflict detection), Observation candidate creation, Review Queue page with approve/reject/edit/reconsider, Document detail split-view with live bbox highlights, Observations list page with filters.

**End-to-end value:** User reviews AI-extracted observation candidates, approves or rejects them, and sees the supporting evidence highlighted on the source page image.

**Key routes/pages:** `/documents/[id]`, `/documents/[id]/review`, `/observations`  
**Key API endpoints:** `GET /api/documents/{id}/observations`, `GET /api/observations`, `GET /api/observations/{id}`, `PATCH /api/observations/{id}`, `PATCH /api/observations/{id}/status`, `GET /api/categories`  
**Key DB entities:** Observation (candidate → approved/rejected), AttestationRecord, PipelineRun (completed)  
**Background jobs:** `extraction-job` (pipeline worker process)  
**Dependencies:** Slice 2

---

#### §3.1 — Responsibilities

1. **Extraction job** — consume `extraction-job` from BullMQ; hybrid RAG retrieval (dense + sparse RRF); Grok structured extraction; hallucination guard; bulk-insert Observation candidates; exact-match conflict detection
2. **Observation status API** — `PATCH /api/observations/{id}/status` enforces the state machine; creates AttestationRecord on `approved`; dispatches `semantic-conflict-job` on `approved` (consumed in Slice 4)
3. **Observation edit API** — `PATCH /api/observations/{id}` allows updating `label`, `normalized_key`, `value`, `unit`, `period_start`, `period_end`, `category_id`
4. **Document detail page** — split-view: left panel = page image; right panel = observation list for that document; clicking an observation sends its bbox to the image overlay
5. **Review Queue page** — tabbed view (Candidat / Approuvé / Rejeté) per document; inline approve/reject/reconsider/edit; pagination per tab
6. **Observations list page** — company-wide observation browser; filter by `status`, `normalized_key`, `category_id`, `q` (text search), `period`; paginated

---

#### §3.2 — System Boundaries

```
Browser
  ├── GET  /api/documents/{id}                    → Next.js (already in Slice 2)
  ├── GET  /api/documents/{id}/blocks             → Next.js (already in Slice 2)
  ├── GET  /api/documents/{id}/pages/{n}          → Next.js (already in Slice 2)
  ├── GET  /api/documents/{id}/observations       → Next.js (new)
  ├── GET  /api/observations                      → Next.js (new)
  ├── GET  /api/observations/{id}                 → Next.js (new)
  ├── PATCH /api/observations/{id}                → Next.js (new)
  ├── PATCH /api/observations/{id}/status         → Next.js (new)
  │     └── on approved: enqueue semantic-conflict-job (Slice 4 consumes)
  └── GET  /api/categories                        → Next.js (new — moved from Slice 6; read-only)

Pipeline Worker
  └── Consumes: extraction-job
        ├── SELECT evidence_blocks (hybrid retrieval)
        ├── POST xAI Grok API        (structured extraction)
        ├── INSERT observations      (candidates)
        ├── INSERT conflict_cases    (exact-match only)
        └── publish SSE: extraction_complete

Redis / SSE
  └── pipeline:events:{company_id}  (extraction_complete event)
```

**Not in scope for this slice:**
- Semantic (Grok-powered) conflict detection — that is Slice 4
- Manual observation creation — Slice 4
- Notification bell SSE — Slice 4
- Chat, reports, derivations

---

#### §3.3 — New Files

```
src/
  app/
    (app)/
      documents/
        [id]/
          page.tsx                     # DocumentDetailPage — split-view (page image + observation panel)
          review/
            page.tsx                   # ReviewQueuePage — tabbed approve/reject/reconsider
      observations/
        page.tsx                       # ObservationsListPage — company-wide browser with filter panel
    api/
      documents/
        [id]/
          observations/
            route.ts                   # GET /api/documents/{id}/observations
      observations/
        route.ts                       # GET /api/observations  (company-wide, paginated, filtered)
        [id]/
          route.ts                     # GET + PATCH /api/observations/{id}  (merged; App Router requires route.ts)
          status/
            route.ts                   # PATCH /api/observations/{id}/status
      categories/
        route.ts                       # GET /api/categories  (read-only tree; moved from Slice 6)

  components/
    documents/
      DocumentSplitView.tsx            # Layout: PageImageViewer (left) + ObservationListPanel (right)
      PageImageViewer.tsx              # Renders page PNG; mounts SVG bbox overlay
      BboxOverlay.tsx                  # SVG layer; renders highlight rect from active bbox prop
    observations/
      ObservationListPanel.tsx         # Scrollable list of obs for one document; click → emit active bbox
      ObservationReviewRow.tsx         # Single row: fields + approve/reject/reconsider/edit buttons
      ObservationEditForm.tsx          # react-hook-form + Zod; all editable fields + CategorySelect
      ReviewQueueTabs.tsx              # shadcn Tabs: Candidat · Approuvé · Rejeté
      ObservationCard.tsx              # Card variant for ObservationsListPage
      ObservationFilterPanel.tsx       # Filter sidebar: status, category, key, period, text search

  lib/
    observations/
      stateMachine.ts                  # isValidTransition(from, to, role) → boolean
      transitions.ts                   # applyTransition(db, obsId, toStatus, userId) — DB write + attestation
    extraction/
      hybridRetrieval.ts               # hybridRetrieve(db, docVersionId, queryVec) → block[]
      grokExtract.ts                   # callGrokExtraction(blocks[], context) → raw JSON
      parseExtraction.ts               # Zod schema + parseExtractionResponse(raw) → ParsedObservation[]
      hallucinationGuard.ts            # validateBlockIds(obs[], knownBlockIds) → valid obs[]
      exactConflict.ts                 # detectExactConflicts(db, companyId, newObs[]) → ConflictCase[]

workers/
  pipeline/
    jobs/
      extraction.ts                    # processExtractionJob(job) — full extraction stage handler
```

---

#### §3.4 — API Endpoint Contracts

---

##### `GET /api/documents/{id}/observations`

**Purpose:** All observations extracted from a specific document (any status). Used by split-view and review queue.

**Auth:** Required. RLS enforces company isolation.

**Query params:** `?status=candidate|approved|rejected&page=1&limit=50`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "label": "Émissions de GES Scope 1",
      "normalizedKey": "ghg_scope1",
      "value": "1240",
      "unit": "tCO2e",
      "dataType": "numeric",
      "timeBehavior": "periodic",
      "periodStart": "2024-01-01",
      "periodEnd": "2024-12-31",
      "status": "candidate",
      "confidenceScore": 0.91,
      "categoryId": "<uuid | null>",
      "evidenceBlockIds": ["<uuid>", "<uuid>"],
      "createdAt": "<iso8601>"
    }
  ],
  "total": 14,
  "page": 1,
  "pageSize": 50
}
```

---

##### `GET /api/observations`

**Purpose:** Company-wide paginated observation browser.

**Auth:** Required.

**Query params:**
- `?status=candidate|approved|rejected|superseded`
- `?normalizedKey=ghg_scope1` (exact match)
- `?categoryId=<uuid>`
- `?q=<free text>` — searches `label` and `normalized_key` with `ILIKE`
- `?periodStart=2024-01-01&periodEnd=2024-12-31` — overlapping period filter
- `?page=1&limit=20&sort=confidence_score:desc`

**Response `200`:** Same paginated envelope as above. All items include full observation fields.

---

##### `GET /api/observations/{id}`

**Purpose:** Single observation with full detail including linked evidence block summaries.

**Auth:** Required.

**Response `200`:**
```json
{
  "id": "<uuid>",
  "label": "Émissions de GES Scope 1",
  "normalizedKey": "ghg_scope1",
  "value": "1240",
  "unit": "tCO2e",
  "dataType": "numeric",
  "timeBehavior": "periodic",
  "periodStart": "2024-01-01",
  "periodEnd": "2024-12-31",
  "numericValue": 1240.0,
  "status": "candidate",
  "provenanceType": "document",
  "confidenceScore": 0.91,
  "categoryId": "<uuid | null>",
  "sourceDocumentVersionId": "<uuid>",
  "extractionRunId": "<uuid>",
  "evidenceBlocks": [
    {
      "id": "<uuid>",
      "pageNumber": 3,
      "textContent": "Scope 1 : 1 240 tCO2e",
      "bbox": { "x1": 0.05, "y1": 0.42, "x2": 0.55, "y2": 0.45 },
      "ocrConfidence": 0.97
    }
  ],
  "createdAt": "<iso8601>",
  "updatedAt": "<iso8601>"
}
```

---

##### `PATCH /api/observations/{id}`

**Purpose:** Edit editable fields on a candidate or approved observation. Does not change `status`.

**Auth:** Required. Role: `editor` or `admin` only — returns `403` for `viewer`.

**Allowed fields (Zod partial schema):**
```json
{
  "label": "string (max 200)",
  "normalizedKey": "snake_case string (max 100, regex ^[a-z][a-z0-9_]*$)",
  "value": "string (max 500)",
  "unit": "string (max 50)",
  "periodStart": "ISO 8601 date | null",
  "periodEnd": "ISO 8601 date | null",
  "categoryId": "UUID | null"
}
```

**Business rule:** `normalizedKey` changes on an `approved` observation trigger a re-check for exact-match conflicts (enqueue `semantic-conflict-job` with `reason: "key_changed"`).

**Response `200`:** Updated observation object (same shape as `GET /api/observations/{id}`).

**Error `403`:** Viewer role.  
**Error `422`:** `normalizedKey` fails regex; `periodEnd < periodStart`.

---

##### `PATCH /api/observations/{id}/status`

**Purpose:** Transition observation status according to the state machine.

**Auth:** Required. Role: `editor` or `admin` — returns `403` for `viewer`.

**Request body:**
```json
{ "status": "approved | rejected | candidate" }
```

**Valid transitions (enforced by `isValidTransition`):**

| From | To | Notes |
|------|----|-------|
| `candidate` | `approved` | Creates AttestationRecord; enqueues `semantic-conflict-job` |
| `candidate` | `rejected` | Creates AttestationRecord |
| `rejected` | `candidate` | Reconsider — no attestation record |
| `superseded` | `approved` | Admin/editor override only; creates AttestationRecord |
| `approved` | `invalidated` | System-only trigger (pipeline re-run on same document); not exposed to user-facing API; creates AuditLog entry |

**All other transitions** → `422` with:
```json
{ "code": "invalid_transition", "from": "approved", "to": "candidate" }
```

**Side effects on `approved`:**
1. Insert `AttestationRecord` with `created_by = session.user_id`
2. Enqueue `semantic-conflict-job { observationId, companyId }` (Slice 4 consumer)
3. Publish SSE event `observation_approved` (used for Conflicts badge update in Slice 4)
4. Insert `AuditLog` entry

**Side effects on `rejected`:**
1. Insert `AttestationRecord` with `created_by = session.user_id`
2. Insert `AuditLog` entry

**Response `200`:** `{ id, status, updatedAt }`

**Error `403`:** Viewer role.  
**Error `422`:** Invalid transition with `{ code, from, to }`.  
**Error `404`:** Observation not found (RLS: belongs to different company).

---

##### `GET /api/categories`

**Purpose:** Return the full category tree for the authenticated company. Read-only; moved here from Slice 6 because extraction results reference `category_id`.

**Auth:** Required. Any role (`viewer`, `editor`, `admin`).

**Query params:** *(none)*

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string | null",
      "parentCategoryId": "uuid | null",
      "path": "string",
      "sortOrder": 0
    }
  ]
}
```

**Notes:**
- Returns all categories belonging to `session.user.company_id` (RLS-filtered).
- The `path` column is a materialized text path (e.g. `"Financial > Revenue"`) useful for breadcrumb display.
- Results are ordered by `path` then `sort_order` so the client can render the tree without additional sorting.

**Error `401`:** Not authenticated.

---

#### §3.5 — Extraction Job Flow (Pipeline Worker)

```
BullMQ dequeues extraction-job { documentVersionId, companyId }

processExtractionJob:
  1. Gate check: read DocumentVersion.pipeline_status
     └── If already completed or beyond (extracting with completed pipeline_run, review_ready) → skip
     └── If earlier stage (uploaded, ocr_processing, ocr_done, embedding) → skip (should not happen)
     └── If "extracting" with no completed pipeline_run → allow re-entry (crash recovery)
     └── If "embedded" → proceed normally
  2. INSERT pipeline_run (status: running, started_at: now)
  3. UPDATE pipeline_status = "extracting"; publish SSE pipeline_stage_changed

  3b. **FR-18 — Auto-detect document type:**
      - Fetch the first 5 evidence blocks (ordered by `page_number`, `position_index`) for this document version.
      - Build a classification prompt containing their `text_content` and ask Grok to return one of: `sustainability_report`, `annual_report`, `audit_report`, `policy`, `other`.
      - UPDATE `document.detected_type` = result. This value is used downstream by the extraction prompt to tailor ESG indicator extraction to the document type.
      - If classification fails (timeout / parse error), default to `other` and log a warning — do not block the pipeline.

  ── HYBRID RETRIEVAL ──
  4. Embed a fixed broad ESG coverage query string using text-embedding-3-small
     (query: "ESG environmental social governance metrics emissions energy water waste 
      employees training accidents gender pay supply chain governance board")
  5. Dense retrieval: cosine search via pgvector HNSW
       SELECT block_id, 1-(embedding <=> $query_vec) AS cosine_score
       FROM evidence_blocks
       WHERE document_version_id = $1 AND embedding_status = 'completed'
       ORDER BY cosine_score DESC LIMIT 200
       → yields ranked list A with ranks 1…|A|
  6. Sparse retrieval: pg_trgm similarity over ESG keyword bag
       SELECT block_id, similarity(text_content, $keyword_bag) AS trgm_score
       FROM evidence_blocks
       WHERE document_version_id = $1
       ORDER BY trgm_score DESC LIMIT 200
       → yields ranked list B with ranks 1…|B|
  7. RRF fusion:
       score = 0.6 × (1/(60 + rank_A)) + 0.4 × (1/(60 + rank_B))
       Missing rank in either list = N+1 (N = list size)
       Take top 150 by final_score
  8. Low-block guard: if top-150 set has < 10 blocks
     → Insert pipeline warning note on pipeline_run: `{ type: "insufficient_blocks", block_count: N, threshold: 10 }`
     → set pipeline_status = "review_ready" with 0 observations; publish extraction_complete
       (include `warning: "insufficient_blocks"` in SSE payload so UI can display a notice); return

  ── GROK EXTRACTION ──
  9. Build extraction prompt:
       - System: ESG extraction persona, output JSON schema instruction
       - Includes soft reference key list (§2.4)
       - Includes document context (filename, category, client)
  10. POST xAI Grok API (grok-4-1-fast-reasoning, JSON mode)
       Timeout: 120s per call; 1 retry on schema-invalid output; total job timeout: 300s
       Before retry: check elapsed time; if elapsed ≥ 240s, skip retry and fail immediately to stay within BullMQ job timeout
  11. Zod-validate response against ParsedObservation[] schema
      └── On second consecutive invalid response: set pipeline_status = "failed", return

  ── HALLUCINATION GUARD ──
  12. For each parsed observation:
       Verify every evidence_block_id in obs.evidence_block_ids[] exists in the
       document's known block IDs (fetched in step 5 query scope)
       └── Any observation with unknown block ID: log + discard (do not insert)

  ── OBSERVATION INSERT ──
  13. Bulk INSERT valid observations:
       status = "candidate"
       provenance_type = "document"
       company_id = session company (from job payload)
       category_id inherited from Document.category_id
       extraction_run_id = pipeline_run.id
       source_document_version_id = documentVersionId

  ── EXACT-MATCH CONFLICT FLAGGING (flag-only, no auto-resolve) ──
  14. For each newly inserted observation, query:
       SELECT observation_id FROM observation
       WHERE company_id = $companyId
         AND normalized_key = $obs.normalizedKey
         AND status = 'approved'
         AND period_start <= $obs.periodEnd
         AND period_end >= $obs.periodStart
  15. For each match: INSERT conflict_case
       match_method = 'exact'
       conflict_group_id = gen_random_uuid()
       resolution_status = 'auto_resolved'  (pending user review when semantic-conflict-job runs in Slice 4)
       auto_resolved = false
       winning_observation_id = NULL  (no winner assigned at extraction time)
       observation_ids = [$newObsId, $matchedObsId]
       **No observation status changes** — neither the new candidate nor the existing approved observation is superseded. Actual resolution waits for user review via Slice 4 Conflict UI.
       (Semantic near-duplicate detection is deferred to Slice 4's semantic-conflict-job)

  ── COMPLETION ──
  16. UPDATE pipeline_run: status = done, finished_at, observations_created, observations_skipped
  17. UPDATE pipeline_status = "review_ready"
  18. publishPipelineEvent: pipeline_stage_changed (review_ready) + extraction_complete
  19. INSERT Notification (type: pipeline_done, payload: { document_id, observation_count })
```

**DLQ handling:** Same pattern as Slices 1–2 — `dlq.ts` handler fires on all retries exhausted.

---

#### §3.6 — Hybrid Retrieval Details

**Dense index:** HNSW on `evidence_blocks.embedding` — already built in Slice 1 migration `0003`. Query uses `<=>` (cosine distance operator). `ef_search` session parameter set to `100` for extraction queries (override default `40`) via `SET LOCAL hnsw.ef_search = 100` inside the transaction.

**Sparse index:** `pg_trgm` GIN index on `evidence_blocks.text_content` — must be added to the Slice 1 schema index list (no new migration needed if added before first run; otherwise a new migration with `CREATE INDEX CONCURRENTLY`).

> **Spec deviation:** The original spec (§9.3) calls for BM25 ranking for the sparse retrieval leg. This plan uses `pg_trgm` trigram similarity instead, avoiding the need for an external search engine (e.g., Elasticsearch) or a Postgres BM25 extension. Trigram similarity is adequate for the French+English keyword bag and keeps the stack simpler. If retrieval recall proves insufficient in production, BM25 can be introduced via `pg_search` or an external index without schema changes.

**ESG keyword bag** (for sparse query): a static string constant in `src/lib/constants.ts`:
```
"GES émissions scope CO2 énergie eau déchets employés formation accidents genre 
 gouvernance conseil administrateurs fournisseurs achats responsable"
```
(French + English mixed for bilingual documents)

**RRF formula:** `0.6 × 1/(60 + dense_rank) + 0.4 × 1/(60 + sparse_rank)`. Rationale: dense slightly weighted higher for semantic recall; sparse provides keyword anchor for numeric fact pages.

---

#### §3.7 — Grok Extraction: Input Schema & Output Contract

**Prompt context provided per call:**
- Document filename, category name, client name (if set)
- Soft reference key list (§2.4)
- The top-150 evidence blocks: `[{ block_id, page_number, text }]`

**Output schema (Zod, each item in array):**
```typescript
{
  label: string,               // human-readable, max 200 chars
  normalized_key: string,      // snake_case, max 100 chars
  value: string,               // raw extracted value
  numeric_value: number | null,
  unit: string | null,
  data_type: "numeric" | "percentage" | "text" | "boolean",
  time_behavior: "periodic" | "point_in_time" | "none",
  period_start: string | null, // ISO 8601
  period_end: string | null,
  evidence_block_ids: string[], // non-empty array of UUIDv7 strings
  confidence_score: number     // 0–1
}
```

**Validation rules (Zod):**
- `normalized_key` must match `/^[a-z][a-z0-9_]{0,99}$/`
- `evidence_block_ids` must be non-empty array of valid UUID strings
- `confidence_score` must be in range `[0, 1]`
- `period_end` must be ≥ `period_start` if both present
- `data_type = "numeric" | "percentage"` requires `numeric_value` to be present

**On schema validation failure:** Retry once. On second failure: set `pipeline_status = "failed"`, populate `pipeline_error` with truncated Grok response, stop.

---

#### §3.8 — Observation State Machine

Enforced in `src/lib/observations/stateMachine.ts` — single source of truth used by both the route handler and pipeline job.

```
          ┌─────────────────────────────────────────────────────┐
          │                  OBSERVATION STATUS                  │
          │                                                     │
   pipeline insert ─→ [candidate] ──approve──→ [approved]      │
                           │                       │            │
                         reject                superseded       │
                           │                (conflict handler)  │
                           ▼                       │            │
                      [rejected]           user override        │
                           │                       ▼            │
                       reconsider        [superseded] ──→ [approved]
                           │                                    │
                           └──────────────────────────────────→ │
                                                                │
   pipeline re-run ─→ [invalidated]  (terminal; no outgoing)   │
          └─────────────────────────────────────────────────────┘
```

**`isValidTransition(from, to, role)`:**
- Returns `true` for the transitions in the table in §3.4
- Returns `false` for all others — route handler returns `422`
- `superseded → approved` requires `role !== "viewer"` (same as all write operations)
- `approved → invalidated` requires `role === "system"` (internal pipeline trigger only; not exposed to user-facing API)

---

#### §3.9 — Document Detail Split-View (UI Architecture)

**Route:** `/documents/[id]`

**Data fetching strategy:**
- Server Component fetches: `GET /api/documents/{id}` + `GET /api/documents/{id}/observations?status=candidate&page=1`
- Client Component (`DocumentSplitView`) manages:
  - Active page number (state)
  - Active observation (state → drives `BboxOverlay`)

**`PageImageViewer`:**
- Fetches page image URL from `GET /api/documents/{id}/pages/{pageNumber}` (client side, on page change)
- Renders `<img>` with `object-fit: contain`
- Mounts `<BboxOverlay>` as an absolutely-positioned SVG sibling
- SVG viewBox = `"0 0 1 1"` (ratio coordinate space)

**`BboxOverlay`:**
- Receives `activeBbox: { x1, y1, x2, y2 } | null`
- Renders a single `<rect>` with `fill="rgba(59,130,246,0.2)"` and `stroke="rgba(59,130,246,0.8)"`
- Animated: Framer Motion `animate={{ opacity: activeBbox ? 1 : 0 }}`

**`ObservationListPanel`:**
- Receives observation list for the current page
- On row hover/click: emits `{ bbox }` to parent which passes to `BboxOverlay`
- Shows `normalizedKey`, `value`, `unit`, `confidenceScore`, and `status` badge per row
- Page navigation arrows (prev/next) update active page number in parent

---

#### §3.10 — Review Queue Page (UI Architecture)

**Route:** `/documents/[id]/review`

**Three tabs:** Candidat · Approuvé · Rejeté

**Per tab:**
- Server-rendered initial data via search params (`?tab=candidate&page=1`)
- Each row (`ObservationReviewRow`):
  - Displays: label, normalizedKey, value, unit, period, confidenceScore badge, source page number
  - **Candidat tab actions:** "Approuver" (calls `PATCH .../status { status: "approved" }`), "Rejeter" (`{ status: "rejected" }`), "Modifier" (opens inline `ObservationEditForm`)
  - **Rejeté tab actions:** "Reconsidérer" (calls `PATCH .../status { status: "candidate" }`)
  - **Approuvé tab:** read-only display + "Modifier" (edit fields only, not status)
- Optimistic update: row moves to correct tab immediately on status change; reverts on API error with Sonner toast
- `ObservationEditForm`: shadcn Dialog; react-hook-form; Zod validation; calls `PATCH /api/observations/{id}`

---

#### §3.11 — Observations List Page (UI Architecture)

**Route:** `/observations`

**Filter panel (left sidebar):**
- Status multi-select (Candidat / Approuvé / Rejeté / Supersédé)
- Category tree select (from `GET /api/categories` — static, no async)
- Key text input (exact match on `normalizedKey`)
- Period range date pickers
- Free text search `q`

**Filter state:** Reflected in URL query params; supports direct-link sharing and browser back button.

**Observation cards:** paginated grid; each card shows label, key, value, unit, status badge, source document name, period.

**Empty state:** "Aucune observation trouvée" with reset-filters button.

---

#### §3.12 — Validation Logic

**Status transition route (`PATCH .../status`):**
- Body: `{ status: z.enum(["approved", "rejected", "candidate"]) }`
- Call `isValidTransition(current, requested, role)` — no DB writes before this check
- Additional guard: `status = "candidate"` is only valid as a `to` state from `rejected` (reconsider); the Zod schema accepts the enum value, the state machine rejects invalid from/to combos

**Observation edit route (`PATCH /api/observations/{id}`):**
- `normalizedKey`: regex `/^[a-z][a-z0-9_]{0,99}$/`
- `periodEnd` ≥ `periodStart` if both present
- `categoryId`: if provided, must belong to `session.company_id` (RLS query)
- All fields optional (PATCH semantics); empty body is a no-op returning 200

---

#### §3.13 — Security & RBAC

| Concern | Decision |
|---------|----------|
| Viewer cannot approve/reject | `PATCH .../status` checks `session.role !== "viewer"` → `403` |
| Viewer cannot edit fields | `PATCH /api/observations/{id}` checks role → `403` |
| Cross-tenant observation access | RLS `withTenant` wrapper — all observation queries scoped to `session.company_id` |
| `superseded → approved` override | Allowed for `editor` and `admin`; same role check as other writes |
| `invalidated` observations | Cannot be transitioned to any state — `isValidTransition` returns `false` for all `from: "invalidated"` cases |
| Extraction job `company_id` | Injected from DB at job-enqueue time (from authenticated session); never from user input |
| AuditLog | Written for every `PATCH .../status` call — records `action`, `entity_id`, `user_id`, `diff: { from, to }` |

---

#### §3.14 — Testing Strategy

**Unit tests (Vitest):**
- `lib/observations/stateMachine.ts` — test all valid and invalid transition combos for all three roles
- `lib/extraction/hallucinationGuard.ts` — test: valid block IDs pass; unknown ID causes observation rejection; observation with all-unknown IDs is fully discarded
- `lib/extraction/parseExtraction.ts` — test Zod schema: valid output passes; `normalizedKey` with spaces fails; missing `evidence_block_ids` fails; `period_end < period_start` fails
- `lib/extraction/exactConflict.ts` — test: two observations same key + overlapping period → conflict created; same key non-overlapping period → no conflict

**Integration tests (`@testcontainers/postgresql` + mocked Grok API):**
- Mock Grok API to return a fixed valid extraction containing 3 observations
- Run `processExtractionJob` → assert 3 `Observation` rows with `status = "candidate"`
- Assert `PipelineRun.status = "done"` and `pipeline_status = "review_ready"`
- Test hallucination guard: mock Grok to return an observation referencing a non-existent block ID → that observation is not inserted
- Test idempotency: run `processExtractionJob` twice → second run is no-op (gate check)
- Test exact-match conflict: pre-insert an `approved` observation with same key + period → conflict_case created after job; winning observation set to newer one
- Test `PATCH .../status` transitions: valid approve → 200 + AttestationRecord inserted; invalid `approved → candidate` → 422; viewer role → 403

**E2E tests (Playwright):**
- Upload test PDF → wait for `review_ready` → navigate to `/documents/{id}/review`
- Assert "Candidat" tab shows ≥ 1 row
- Click "Approuver" → assert row moves to "Approuvé" tab
- Click "Rejeter" on another candidate → assert it moves to "Rejeté" tab
- Click "Reconsidérer" → assert it moves back to "Candidat"
- Navigate to `/documents/{id}` → click an observation row → assert bbox highlight appears on page image

---

#### §3.15 — Edge Cases

| Case | Handling |
|------|----------|
| Grok returns 0 observations | Insert 0 Observation rows; pipeline still reaches `review_ready`; `extraction_complete` SSE fires with `observationCount: 0` |
| All evidence blocks are low-confidence | Step 8 of extraction job: < 10 embeddable blocks → skip Grok call; set `review_ready` with 0 obs; attach `pipeline_warning: insufficient_blocks` note to pipeline_run; SSE payload includes warning so UI can display user-facing notice |
| Grok returns duplicate `normalized_key` + same period in one batch | Both inserted as candidates; conflict detection only fires against existing **approved** observations; duplicates within the same extraction batch coexist as candidates until user reviews |
| User approves two candidates with same key + overlapping period | The second approval triggers `semantic-conflict-job` (Slice 4); exact-match conflict case created there |
| `PATCH .../status` called concurrently (double-click) | Use a DB transaction with `SELECT FOR UPDATE` on the observation row; second concurrent request finds updated status and returns `422 invalid_transition` |
| Observation `category_id` becomes stale if document category is changed post-extraction | Category is inherited at extraction time; subsequent document category changes do not cascade to existing observations (user must manually reassign) |
| Extraction job timeout (300s exceeded) | BullMQ marks job `failed`; DLQ handler sets `pipeline_status = "failed"`; `pipeline_error` set to "extraction_timeout" |
| `normalizedKey` edited on an approved observation | Triggers re-check via `semantic-conflict-job` (Slice 4 handles it) |

---

#### §3.16 — Acceptance Criteria

- [ ] After `embedded` status, `extraction-job` runs and creates ≥ 1 Observation with `status = "candidate"`
- [ ] `PATCH /api/observations/{id}/status` with `{ status: "approved" }` on a `candidate` → `200` + AttestationRecord inserted
- [ ] `PATCH /api/observations/{id}/status` with `{ status: "approved" }` on an `invalidated` observation → `422` with `{ code: "invalid_transition", from: "invalidated", to: "approved" }`
- [ ] `PATCH /api/observations/{id}/status` with `{ status: "candidate" }` from `rejected` → `200` (reconsider)
- [ ] `viewer` role calling `PATCH .../status` → `403`
- [ ] Document detail split-view: clicking an observation row highlights corresponding bbox on the page image via SVG overlay
- [ ] Review Queue tabs show correct counts per status; optimistic row move on status change
- [ ] Observations list page filters by `status`, `normalizedKey`, `categoryId` and returns paginated envelope `{ data, total, page, pageSize }`
- [ ] Hallucination guard: observations with non-existent block IDs are not inserted to DB
- [ ] `GET /api/categories` returns the full category tree for the company, ordered by `path` then `sort_order`
- [ ] `tsc --noEmit` passes; `vitest run` passes all new unit + integration tests

---

#### §3.17 — Verification Checklist

```
# 1. With a document already at "embedded" status (from Slice 2 verification):
# 2. Watch pipeline worker logs — extraction-job should be dequeued automatically

# 3. Verify observations created
curl http://localhost:3000/api/documents/{id}/observations -H "Cookie: <session>"
# → data array with ≥ 1 item, status: "candidate"

# 4. Approve one observation
curl -X PATCH http://localhost:3000/api/observations/{obsId}/status \
  -H "Cookie: <session>" \
  -d '{"status":"approved"}'
# → { id, status: "approved", updatedAt }

# 5. Attempt invalid transition
curl -X PATCH http://localhost:3000/api/observations/{obsId}/status \
  -H "Cookie: <session>" \
  -d '{"status":"candidate"}'
# → 422 { code: "invalid_transition", from: "approved", to: "candidate" }

# 6. View split-view in browser
# Navigate to /documents/{id} — page image left, observations right
# Click an observation — verify colored bbox rect appears on page image

# 7. View review queue
# Navigate to /documents/{id}/review — verify Candidat/Approuvé/Rejeté tabs

# 8. Run tests
npx vitest run
npx playwright test --grep "review|observation"
```

---

Slice 3 architectural plan complete. Say "continue" to expand the next slice.

---

### Slice 4 — Conflicts + Manual Observations + Notifications

**Scope:** Semantic conflict detection (`semantic-conflict-job` consumer + Grok equivalence classifier + `KeyEquivalenceCache`), Conflict inbox page with latest-wins override, standalone manual observation creation form, Notification bell with SSE delivery (`notification` event type on existing pipeline SSE channel).

**End-to-end value:** User can see and resolve conflicting observations, manually enter missing data, and receive live notifications in the bell without a page reload.

**Key routes/pages:** `/conflicts`, `/observations` (manual creation button)  
**Key API endpoints:** `GET /api/conflicts`, `POST /api/conflicts/{id}/resolve`, `POST /api/observations/manual`, `GET /api/notifications`, `PATCH /api/notifications/{id}/read`  
**Key DB entities:** ConflictCase, ConflictResolution, AttestationRecord, Observation (manual), Notification  
**Background jobs:** `semantic-conflict-job` (pipeline worker, triggered on observation approval)  
**Dependencies:** Slice 3

---

#### §4.1 — Responsibilities

1. **Semantic conflict job** — consume `semantic-conflict-job`; find candidate near-duplicate pairs via `pg_trgm`; consult `KeyEquivalenceCache`; call Grok equivalence classifier for uncached pairs; write cache; create `ConflictCase` records; apply latest-wins; publish `conflict_detected` SSE event
2. **Conflicts API** — `GET /api/conflicts` (paginated, filtered); `POST /api/conflicts/{id}/resolve` (user override of latest-wins)
3. **Manual observation API** — `POST /api/observations/manual` — creates `Observation` + `AttestationRecord`; can immediately approve or leave as candidate
4. **Notifications API** — `GET /api/notifications`; `PATCH /api/notifications/{id}/read`
5. **Notification SSE** — extend the existing pipeline SSE channel with `notification` event type; `Notification` rows published via Redis pub/sub on insert
6. **Conflict inbox page** — `/conflicts` — paginated list of unresolved `ConflictCase` records; side-by-side winning/losing display; override action
7. **Notification bell** — live unread count; dropdown list; mark-read interaction

---

#### §4.2 — System Boundaries

```
Browser
  ├── GET  /api/conflicts                    → Next.js (new)
  ├── POST /api/conflicts/{id}/resolve        → Next.js (new)
  ├── POST /api/observations/manual           → Next.js (new)
  ├── GET  /api/notifications                 → Next.js (new)
  ├── PATCH /api/notifications/{id}/read      → Next.js (new)
  └── GET  /api/pipeline/events (SSE)         → existing; now also delivers:
        ├── conflict_detected event
        └── notification event

Pipeline Worker
  └── Consumes: semantic-conflict-job
        ├── SELECT observations            (pg_trgm candidates)
        ├── SELECT key_equivalence_cache   (cache lookup)
        ├── POST xAI Grok API              (equivalence classifier, if uncached)
        ├── INSERT key_equivalence_cache   (write result)
        ├── INSERT conflict_cases          (SAME_KEY pairs)
        ├── UPDATE observations            (loser → superseded)
        └── publishPipelineEvent           (conflict_detected + notification)

Redis
  └── pipeline:events:{company_id}  pub/sub channel
        (now carries: pipeline_stage_changed, pipeline_failed,
         extraction_complete, conflict_detected, notification)
```

**Not in scope for this slice:**
- Chat, reports, PDF worker
- Dashboard counts (Slice 6)
- Category management (Slice 6)

---

#### §4.3 — New Files

```
src/
  app/
    (app)/
      conflicts/
        page.tsx                     # ConflictInboxPage — paginated conflict list
    api/
      conflicts/
        route.ts                     # GET /api/conflicts
        [id]/
          resolve/
            route.ts                 # POST /api/conflicts/{id}/resolve
      observations/
        manual/
          route.ts                   # POST /api/observations/manual
      notifications/
        route.ts                     # GET /api/notifications
        [id]/
          read/
            route.ts                 # PATCH /api/notifications/{id}/read

  components/
    conflicts/
      ConflictCard.tsx               # Side-by-side winner/loser display; override button
      ConflictInboxPage.tsx          # Paginated list + empty state
      ConfirmOverrideDialog.tsx      # shadcn AlertDialog — confirm before override
    observations/
      ManualObservationForm.tsx      # react-hook-form + Zod; all fields; standalone trigger
    notifications/
      NotificationBell.tsx           # Badge count; dropdown on click; mark-read
      NotificationItem.tsx           # Single notification row — type icon + payload summary

  lib/
    conflicts/
      detectSemantic.ts              # findCandidatePairs(db, obs) → candidate pair[]
      equivalenceClassifier.ts       # callGrokEquivalence(keyA, keyB, ...) → SAME_KEY | DIFFERENT_KEY
      applyLatestWins.ts             # latestWins(obsA, obsB) → { winner, loser }
      cacheKey.ts                    # buildCacheKey(keyA, keyB) → SHA256 string
    notifications/
      publish.ts                     # publishNotification(companyId, notification) → void
                                     # inserts DB row + publishes to Redis pub/sub

workers/
  pipeline/
    jobs/
      semanticConflict.ts            # processSemanticConflictJob(job) — full semantic handler
```

---

#### §4.4 — API Endpoint Contracts

---

##### `GET /api/conflicts`

**Purpose:** Paginated list of conflict cases for the authenticated company.

**Auth:** Required.

**Query params:**
- `?resolutionStatus=auto_resolved|user_reviewed|user_overridden` (default: all)
- `?matchMethod=exact|semantic`
- `?normalizedKey=ghg_scope1` — returns all ConflictCases where at least one involved observation has this key (covers semantic groups per RISK-14 resolution)
- `?page=1&limit=20`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "normalizedKey": "ghg_scope1",
      "conflictGroupId": "<uuid>",
      "matchMethod": "exact",
      "periodStart": "2024-01-01",
      "periodEnd": "2024-12-31",
      "resolutionStatus": "auto_resolved",
      "autoResolved": true,
      "winningObservation": {
        "id": "<uuid>",
        "label": "GHG Scope 1",
        "value": "1240",
        "unit": "tCO2e",
        "sourceDocumentFilename": "rapport-2025.pdf",
        "uploadedAt": "<iso8601>"
      },
      "losingObservations": [
        {
          "id": "<uuid>",
          "label": "GHG Scope 1",
          "value": "1100",
          "unit": "tCO2e",
          "sourceDocumentFilename": "rapport-2024.pdf",
          "uploadedAt": "<iso8601>"
        }
      ],
      "createdAt": "<iso8601>"
    }
  ],
  "total": 7,
  "page": 1,
  "pageSize": 20
}
```

---

##### `POST /api/conflicts/{id}/resolve`

**Purpose:** User manually overrides latest-wins by promoting a specific losing observation.

**Auth:** Required. Role: `editor` or `admin` — returns `403` for `viewer`.

**Request body:**
```json
{ "chosenObservationId": "<uuid>", "reason": "optional free text (max 500 chars)" }
```

**Validation:**
- `chosenObservationId` must be one of the `observation_ids[]` in the conflict case — return `422` if not
- Conflict case must belong to `session.company_id` (RLS)
- Cannot resolve an already `user_overridden` conflict without admin role

**Server actions (all in one DB transaction):**
1. Transition `chosenObservationId.status` → `approved`
2. Transition all other observations in `observation_ids[]` with `status = approved` → `superseded`
3. Insert `ConflictResolution` record: `{ conflict_case_id, chosen_observation_id, resolved_by, reason }`
4. Update `ConflictCase.resolution_status` → `user_overridden`, `winning_observation_id` → chosen
5. Mark all `DerivationResult`s referencing any affected observation IDs as `stale = true`
6. Insert `Notification` (type: `conflict_resolved`, payload: `{ conflict_id, chosen_observation_id }`)
7. `publishNotification(companyId, notification)` → Redis pub/sub → SSE `notification` event
8. Insert `AuditLog` entry

**Response `200`:**
```json
{
  "conflictId": "<uuid>",
  "resolutionStatus": "user_overridden",
  "winningObservationId": "<uuid>"
}
```

**Error `403`:** Viewer role.  
**Error `422`:** `chosenObservationId` not in conflict's observation list.  
**Error `404`:** Conflict not found (RLS).

---

##### `POST /api/observations/manual`

> **Spec deviation (MR-22):** The project spec §16 lists this as `POST /api/observations`. This plan standardizes on `POST /api/observations/manual` to avoid collision with a future `GET /api/observations` listing endpoint and to clearly distinguish manual creation from pipeline-created observations.

**Purpose:** Create a manual observation with an AttestationRecord. Can be submitted as candidate or directly approved.

**Auth:** Required. Role: `editor` or `admin` — returns `403` for `viewer`.

**Request body (Zod schema — all required unless noted):**
```json
{
  "label": "Consommation d'énergie totale",
  "normalizedKey": "energy_consumption_total",
  "value": "4500",
  "numericValue": 4500,
  "unit": "MWh",
  "dataType": "numeric",
  "timeBehavior": "periodic",
  "periodStart": "2024-01-01",
  "periodEnd": "2024-12-31",
  "categoryId": "<uuid | null>",
  "status": "candidate",
  "note": "Données issues du rapport interne.",
  "sourceReference": "https://intranet.example.com/energy-report-2024"
}
```

**Validation rules:**
- `normalizedKey`: regex `/^[a-z][a-z0-9_]{0,99}$/`
- `periodEnd` ≥ `periodStart` if both present; required when `timeBehavior = "periodic"`
- `status`: only `"candidate"` or `"approved"` accepted — `"rejected"` not allowed at creation
- `numericValue`: required when `dataType = "numeric" | "percentage"`
- `categoryId`: if present, must belong to `session.company_id`

**Server actions:**
1. INSERT `Observation` with `provenance_type = "manual"`, `company_id` from session, `created_by` from session
2. INSERT `AttestationRecord` with `action = status === "approved" ? "approved" : "submitted"`, `created_by`, `note`, `source_reference`
3. Update `Observation.attestation_record_id` to the new record ID
4. If `status = "approved"`: enqueue `semantic-conflict-job { observationId, companyId }`
5. INSERT `AuditLog` entry

**Response `201`:**
```json
{
  "id": "<uuid>",
  "status": "candidate",
  "attestationRecordId": "<uuid>"
}
```

**Error `403`:** Viewer role.  
**Error `422`:** Validation failure with `{ code, field }`.

---

##### `GET /api/notifications`

**Purpose:** Paginated notification list for the authenticated user.

**Auth:** Required.

**Query params:** `?unread=true|false` (default: all); `?page=1&limit=30`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "type": "conflict_detected",
      "payload": { "conflictId": "<uuid>", "normalizedKey": "ghg_scope1" },
      "read": false,
      "createdAt": "<iso8601>"
    }
  ],
  "total": 5,
  "unreadCount": 3,
  "page": 1,
  "pageSize": 30
}
```

**Query scope:** Returns notifications where `user_id = session.user_id OR user_id IS NULL` (company-wide notifications), filtered by `company_id`.

---

##### `PATCH /api/notifications/{id}/read`

**Purpose:** Mark a single notification as read.

**Auth:** Required. User can only mark their own notifications or company-wide ones.

**Request body:** none required (action implied by endpoint)

**Response `200`:**
```json
{ "id": "<uuid>", "read": true }
```

**Error `404`:** Notification not found or belongs to different user/company.

---

#### §4.5 — Semantic Conflict Job Flow (Pipeline Worker)

```
BullMQ dequeues semantic-conflict-job { observationId, companyId, reason? }

processSemanticConflictJob:
  1. Load obs_a (the newly approved observation)
     └── Guard: if obs_a.status != "approved" → skip (was un-approved before job ran)

  ── CANDIDATE PAIR GENERATION ──
  2. Query candidate near-duplicates from approved observations:
       SELECT obs_b.*
       FROM observations obs_b
       WHERE obs_b.company_id = $companyId
         AND obs_b.id != $observationId
         AND obs_b.status = 'approved'
         AND (
           similarity(obs_b.normalized_key, $obs_a.normalizedKey) >= 0.5
           OR obs_b.unit = $obs_a.unit
         )
         AND obs_b.period_start <= $obs_a.periodEnd
         AND obs_b.period_end >= $obs_a.periodStart
     (requires pg_trgm GIN index on observations.normalized_key)

  ── PER-PAIR PROCESSING ──
  3. For each candidate obs_b:

    a. Exact key match check:
       If obs_a.normalizedKey == obs_b.normalizedKey:
         → conflict_type = "exact" — skip Grok classifier
         → proceed to step d

    b. Cache lookup:
       cacheKey = SHA256(sort([obs_a.normalizedKey, obs_b.normalizedKey]).join(':'))
       SELECT are_equivalent, classifier_model FROM key_equivalence_cache
       WHERE company_id = $companyId AND id = $cacheKey

    c. If NOT cached → call Grok equivalence classifier:
       Prompt: "Are these two ESG observation keys referring to the same real-world metric?
                Key A: {normalized_key_a} — label: {label_a}, unit: {unit_a}
                Key B: {normalized_key_b} — label: {label_b}, unit: {unit_b}
                Answer exactly: SAME_KEY or DIFFERENT_KEY, then a one-sentence rationale."
       Parse response: first word = SAME_KEY | DIFFERENT_KEY; rest = rationale
       INSERT key_equivalence_cache { company_id, key_a, key_b, are_equivalent, rationale, classifier_model }
         ON CONFLICT (company_id, key_a, key_b) DO NOTHING
       (key_a always < key_b alphabetically to ensure canonical form)

    d. If result = SAME_KEY (or exact match):
       - Confirm value conflict: compare numeric_value after unit normalization
         └── If values equal within tolerance (0.1%): NOT a conflict; skip
       - Determine winner via latestWins(obs_a, obs_b):
           Document obs: use document_version.uploaded_at
           Manual obs:   use attestation_record.created_at
       - INSERT conflict_case:
           normalized_key    = obs_a.normalizedKey (or obs_a if exact; obs_a.normalizedKey otherwise)
           conflict_group_id = existing group if obs_b already in a group, else new UUIDv7
           match_method      = "exact" | "semantic"
           observation_ids   = [obs_a.id, obs_b.id]
           winning_obs_id    = winner.id
           auto_resolved     = true
           resolution_status = "auto_resolved"
         ON CONFLICT (company_id, LEAST(obs_a_id, obs_b_id), GREATEST(obs_a_id, obs_b_id)) DO NOTHING
         — if duplicate row already exists, skip silently (concurrent job already created it)
       - If INSERT was skipped (conflict already exists) → skip remaining steps for this pair
       - UPDATE loser.status → "superseded"
       - Mark stale: UPDATE derivation_results SET stale = true
           WHERE $loser_id = ANY(input_observation_ids)
       - Insert Notification (type: conflict_detected, payload: { conflict_id, normalizedKey })
       - publishNotification(companyId, notification)
       - publishPipelineEvent(companyId, { type: "conflict_detected", conflict_id })

  4. Job complete — no pipeline_run update needed (this job is a side-effect, not a pipeline stage)
```

**Retry policy:** 3 attempts with 2s/4s/8s backoff. Grok call has its own 30s timeout. If Grok consistently fails, log error but do not fail the job — pair is left unclassified (no ConflictCase inserted).

---

#### §4.6 — KeyEquivalenceCache Design

**Purpose:** Avoid redundant Grok calls for the same key pair.

**Cache key construction:**
- Sort `[key_a, key_b]` alphabetically (ensures `SHA256("ghg_scope1:ghg_emissions_scope1")` == `SHA256("ghg_emissions_scope1:ghg_scope1")`)
- Primary key in DB = `SHA256(sorted_pair)` — stored as text in `id` column (or as a unique index on the pair)

**Cache invalidation:** None in MVP. Cache entries are permanent. If a user renames an observation's `normalizedKey`, the new combination is a cache miss and triggers a fresh Grok call.

**Unique constraint in DB:** `(company_id, key_a, key_b)` where `key_a < key_b` enforced at application layer before insert.

**Concurrent INSERT handling:** Use `INSERT ... ON CONFLICT (company_id, key_a, key_b) DO NOTHING` to prevent constraint violation when two semantic-conflict-jobs classify the same key pair simultaneously. The first writer wins; the second silently skips.

---

#### §4.7 — Notification SSE Extension

The `GET /api/pipeline/events` SSE handler established in Slice 2 is extended with two new event types. No new SSE endpoint.

**New event shape — `conflict_detected`:**
```json
{
  "type": "conflict_detected",
  "conflictId": "<uuid>",
  "normalizedKey": "ghg_scope1",
  "matchMethod": "semantic",
  "timestamp": "<iso8601>"
}
```

**New event shape — `notification`:**
```json
{
  "type": "notification",
  "notificationId": "<uuid>",
  "notificationType": "conflict_detected | conflict_resolved | pipeline_done | report_ready",
  "payload": { },
  "unreadCount": 4,
  "timestamp": "<iso8601>"
}
```

**`publishNotification` utility (`src/lib/notifications/publish.ts`):**
- INSERT Notification row into DB
- `redis.publish("pipeline:events:" + companyId, JSON.stringify(notificationEvent))`
- The existing SSE subscriber in Next.js receives it and writes it to active SSE connections
- `unreadCount` is computed with a single `SELECT COUNT(*)` before publishing

---

#### §4.8 — Latest-Wins Resolution Algorithm

**`latestWins(obsA, obsB)` in `src/lib/conflicts/applyLatestWins.ts`:**

```
Inputs: obsA, obsB (with their source timestamps)

1. Determine timestamp for each:
   - provenance_type = "document" → use document_version.uploaded_at
   - provenance_type = "manual"   → use attestation_record.created_at

2. winner = whichever has the later timestamp
   - Tie (same timestamp): arbitrarily pick obsA as winner (log anomaly)

3. Anomaly check:
   - If document has embedded doc_date that differs from uploaded_at by > 30 days:
     log anomaly_notice in ConflictCase record (no change to outcome)

Returns: { winner: Observation, loser: Observation }
```

---

#### §4.9 — Conflict Inbox Page (UI Architecture)

**Route:** `/conflicts`

**Layout:**
- Filter bar: `resolutionStatus` toggle (Tous / Non résolus / Résolus), `matchMethod` select
- Paginated list of `ConflictCard` components
- Empty state: "Aucun conflit non résolu" with green checkmark illustration

**`ConflictCard`:**
- Header: `normalizedKey` badge + `matchMethod` tag ("Exact" / "Sémantique") + period range
- Two columns side by side:
  - Left column (winner, green border): value, unit, source document filename, upload date
  - Right column (loser, red border): same fields
- Footer actions (for `auto_resolved` or `user_reviewed` cases):
  - "Remplacer par cette valeur" button on the **losing** column → opens `ConfirmOverrideDialog`
- For `user_overridden` cases: read-only display with "Résolu manuellement" badge

**`ConfirmOverrideDialog`:**
- shadcn `AlertDialog`
- Copy: "Êtes-vous sûr de vouloir remplacer la valeur gagnante actuelle ?"
- Optional reason textarea (max 500 chars)
- On confirm: calls `POST /api/conflicts/{id}/resolve { chosenObservationId, reason }`
- Optimistic: card moves to resolved state; reverts with Sonner toast on error

**Conflicts badge in sidebar:**
- Unresolved count from `GET /api/conflicts?resolutionStatus=auto_resolved` initial fetch
- Increments live on `conflict_detected` SSE event
- Disappears when count reaches 0

---

#### §4.10 — Manual Observation Form (UI Architecture)

**Trigger:** "+ Ajouter manuellement" button on the `/observations` page → opens a shadcn `Dialog`.

**`ManualObservationForm` fields (react-hook-form + Zod):**

| Field | Control | Pre-filled | Validation |
|-------|---------|------------|------------|
| `label` | Text input | — | Required, max 200 chars |
| `normalizedKey` | Text input | — | snake_case regex, max 100 chars |
| `value` | Text input | — | Required |
| `numericValue` | Number input | — | Required when dataType is numeric/percentage |
| `unit` | Text input | — | Optional, max 50 chars |
| `dataType` | Select | — | Required |
| `timeBehavior` | Toggle group | — | Required |
| `periodStart` | Date picker | — | Required when periodic |
| `periodEnd` | Date picker | — | Required when periodic; ≥ periodStart |
| `categoryId` | Category tree select | — | Optional |
| `status` | Toggle: Candidat / Approuvé | `"candidate"` | Required |
| `note` | Textarea | — | Optional, max 1000 chars |
| `sourceReference` | Text input | — | Optional, max 500 chars |

**On submit:**
- Call `POST /api/observations/manual`
- On success: close dialog; add observation to list optimistically; Sonner toast "Observation ajoutée"
- On error: display field-level Zod errors inline

---

#### §4.11 — Notification Bell (UI Architecture)

**`NotificationBell` (in `Topbar`):**
- Shows `unreadCount` badge (red dot with number)
- On mount: fetches `GET /api/notifications?unread=true` for initial count
- On `notification` SSE event: increments `unreadCount` optimistically; adds item to dropdown list
- On click: opens dropdown `Popover` with `NotificationItem` list
- "Tout marquer comme lu" button: calls `PATCH` for all unread items; clears badge

**`NotificationItem`:**
- Icon per type: pipeline_done (green checkmark), conflict_detected (orange warning), conflict_resolved (blue shield), report_ready (purple document)
- Copy examples (FR):
  - `pipeline_done` → "Document "rapport.pdf" traité — 14 observations extraites"
  - `conflict_detected` → "Conflit détecté sur la clé ghg_scope1"
  - `conflict_resolved` → "Conflit résolu manuellement"
- Timestamp (relative: "il y a 2 minutes" via `date-fns`)
- On click: navigate to relevant page (e.g. `/conflicts` for conflict types); mark as read

---

#### §4.12 — Validation Logic

**`POST /api/observations/manual` (server, Zod):**
- `normalizedKey`: `/^[a-z][a-z0-9_]{0,99}$/`
- `periodEnd >= periodStart` when both present
- `periodStart` and `periodEnd` required when `timeBehavior = "periodic"`
- `numericValue` required (not null) when `dataType = "numeric" | "percentage"`
- `status` must be `"candidate"` or `"approved"` (not `"rejected"` or `"superseded"`)
- `note` max 1000 chars; `sourceReference` max 500 chars

**`POST /api/conflicts/{id}/resolve` (server, Zod):**
- `chosenObservationId`: UUID, present in conflict's `observation_ids[]` array
- `reason`: optional string, max 500 chars

**`PATCH /api/notifications/{id}/read`:**
- No body required; route validates notification ownership via RLS

---

#### §4.13 — Security & RBAC

| Concern | Decision |
|---------|----------|
| Viewer cannot resolve conflicts | `POST /api/conflicts/{id}/resolve` checks `role !== "viewer"` → `403` |
| Viewer cannot create manual observations | `POST /api/observations/manual` checks role → `403` |
| Cross-tenant conflict access | RLS `withTenant` wraps all conflict queries |
| Semantic job `company_id` | Injected at enqueue time from authenticated session in the `PATCH .../status` handler (Slice 3); never from job payload alone |
| Grok equivalence classifier isolation | `company_id` scopes the cache lookup; Grok is called without company-specific data (just key/label/unit text) — no PII risk |
| DerivationResult stale-marking | Done atomically within the same transaction as the conflict resolution — no partial states |
| Notification ownership | `GET /api/notifications` and `PATCH .../read` validate `(company_id, user_id OR user_id IS NULL)` via RLS |
| AuditLog | Written for `POST /api/conflicts/{id}/resolve` and `POST /api/observations/manual` |

---

#### §4.14 — Testing Strategy

**Unit tests (Vitest):**
- `lib/conflicts/cacheKey.ts` — test: `cacheKey("b", "a") === cacheKey("a", "b")` (order-independent)
- `lib/conflicts/applyLatestWins.ts` — test: document obs uses `uploaded_at`; manual obs uses `attestation_record.created_at`; tie returns obsA as winner with anomaly log
- `lib/conflicts/equivalenceClassifier.ts` — test Grok response parsing: `"SAME_KEY because..."` → `{ result: true, rationale: "..." }`; `"DIFFERENT_KEY"` → `{ result: false }`
- `lib/notifications/publish.ts` — test: DB insert happens before Redis publish; `unreadCount` in event payload is accurate

**Integration tests (`@testcontainers/postgresql` + mocked Grok + mocked Redis):**
- Seed two approved observations with same `normalized_key` + overlapping period → run `processSemanticConflictJob` → assert `ConflictCase` inserted, loser `status = "superseded"`
- Seed two observations with similar keys (trigram ≥ 0.5) → mock Grok to return `SAME_KEY` → assert semantic `ConflictCase` inserted; `KeyEquivalenceCache` row present
- Same pair second time → assert Grok is NOT called again (cache hit); assert existing `ConflictCase` not duplicated
- `POST /api/conflicts/{id}/resolve` → assert winner `approved`, loser `superseded`, `ConflictResolution` row present, `DerivationResult.stale = true` for affected rows
- `POST /api/observations/manual` with `status: "approved"` → assert `semantic-conflict-job` enqueued
- Viewer role calling `POST /api/conflicts/{id}/resolve` → `403`

**E2E tests (Playwright):**
- Upload two documents with conflicting GHG scope 1 values → navigate to `/conflicts` → assert conflict card with both values visible
- Click "Remplacer" on the losing value → confirm dialog → assert card shows "Résolu manuellement"
- Click "+ Ajouter manuellement" on `/observations` → fill form → submit → assert new observation appears in list
- Trigger pipeline completion → assert notification bell badge increments without page reload
- Click notification → assert bell count decrements; notification marked read

---

#### §4.15 — Edge Cases

| Case | Handling |
|------|----------|
| Semantic job runs but `obs_a` was rejected between enqueue and dequeue | Gate check at step 1: `obs_a.status != "approved"` → skip entire job silently |
| Two observations with equal numeric values after normalization | Not a conflict — value comparison step (§4.5 step 3d) skips equal values |
| Grok returns malformed response (neither `SAME_KEY` nor `DIFFERENT_KEY`) | Log parse error; do not insert cache entry; treat pair as `DIFFERENT_KEY` (conservative) |
| `processSemanticConflictJob` enqueued twice for same observation (double-approve race) | Idempotency: before inserting `ConflictCase`, check if one already exists for the same `(company_id, observation_ids[])` pair — skip if found |
| Manual observation `normalizedKey` matches an existing approved key + overlapping period | `POST /api/observations/manual` with `status: "approved"` enqueues `semantic-conflict-job` — conflict detected after creation, same as document obs |
| Conflict resolution transaction fails mid-way | DB transaction rolled back atomically; no partial state; Redis publish does NOT happen (publish call is outside the transaction — add it only on commit success) |
| All conflicts resolved — badge should disappear | `unreadCount` in SSE `notification` event reflects real DB count; badge component sets to hidden when `unreadCount === 0` |
| Notification for a company with no active SSE connection | Redis pub/sub publishes; no active subscriber for that channel; event is lost for real-time delivery — but the DB row is persisted; user sees it on next page load or SSE reconnect (replay buffer) |

---

#### §4.16 — Acceptance Criteria

- [ ] Approving two observations with same `normalized_key` + overlapping period creates a `ConflictCase` with `auto_resolved = true` and the later one as `winning_observation_id`
- [ ] `POST /api/conflicts/{id}/resolve` with a valid `chosenObservationId` → `200`; creates `ConflictResolution` record; loser transitions to `superseded`; affected `DerivationResult`s marked `stale`
- [ ] `POST /api/conflicts/{id}/resolve` with `chosenObservationId` not in conflict's observation list → `422`
- [ ] `viewer` role calling `POST /api/conflicts/{id}/resolve` → `403`
- [ ] `POST /api/observations/manual` with valid body + `status: "candidate"` → `201` + `Observation` row + `AttestationRecord` row present in DB
- [ ] `POST /api/observations/manual` with `status: "approved"` → `semantic-conflict-job` enqueued
- [ ] `notification` SSE event delivered within 2 seconds of a `Notification` row insert
- [ ] Notification bell badge count increments on `notification` SSE event without page reload
- [ ] `PATCH /api/notifications/{id}/read` → `200 { read: true }`; subsequent `GET /api/notifications?unread=true` excludes it
- [ ] `KeyEquivalenceCache`: same key pair does not trigger a second Grok call (confirmed via mock call counter)
- [ ] `tsc --noEmit` passes; `vitest run` passes all new unit + integration tests

---

#### §4.17 — Verification Checklist

```
# 1. Approve two observations with the same normalizedKey via the Review Queue
# 2. Verify ConflictCase created
curl http://localhost:3000/api/conflicts -H "Cookie: <session>"
# → data array with ≥ 1 item, resolutionStatus: "auto_resolved"

# 3. Override the conflict (choose the losing observation)
curl -X POST http://localhost:3000/api/conflicts/{id}/resolve \
  -H "Cookie: <session>" \
  -d '{"chosenObservationId":"...", "reason":"La valeur 2024 est plus fiable"}'
# → { conflictId, resolutionStatus: "user_overridden", winningObservationId }

# 4. Create a manual observation
curl -X POST http://localhost:3000/api/observations/manual \
  -H "Cookie: <session>" \
  -d '{"label":"Test","normalizedKey":"test_key","value":"42","unit":"kg",
       "dataType":"numeric","timeBehavior":"none","status":"candidate"}'
# → 201 { id, status: "candidate" }

# 5. Check notifications
curl http://localhost:3000/api/notifications -H "Cookie: <session>"
# → includes conflict_detected and conflict_resolved notifications

# 6. Mark one as read
curl -X PATCH http://localhost:3000/api/notifications/{id}/read -H "Cookie: <session>"
# → { id, read: true }

# 7. Run tests
npx vitest run
npx playwright test --grep "conflict|notification|manual"
```

---

Slice 4 architectural plan complete. Say "continue" to expand the next slice.

---

### Slice 5 — Chat → MCP Tools → Manual Obs Popup → Report → PDF + Redis-Backed SSE Replay

**Scope:** Chat sessions, agent SSE streaming, all MCP tools, manual observation popup, Report detail page, PDF worker.  
**End-to-end value:** User can chat, generate a full ISO 26000 HTML+PDF report, fill in missing data via popup, and view the final result.  
**Dependencies:** Slices 3, 4.  
**Risks resolved in this slice:** RISK-03 (chat SSE race), RISK-04 (pending obs shape), RISK-07 (PDF readiness race), RISK-08 (MCP company_id), RISK-09 (message content shapes), RISK-15 (html_snapshot_url in list).

---

#### §5.1 File Inventory

**New source files — API route handlers:**

| File | Responsibility |
|------|----------------|
| `src/app/api/chat/sessions/route.ts` | `POST` create session; `GET` list sessions (paginated by user) |
| `src/app/api/chat/sessions/[id]/route.ts` | `DELETE` session + cascade messages |
| `src/app/api/chat/sessions/[id]/messages/route.ts` | `POST` user message → enqueues agent turn; returns `{ message_id }` |
| `src/app/api/chat/sessions/[id]/messages/list/route.ts` | `GET` paginated message history with per-type `content` shapes (§5.13) |
| `src/app/api/chat/sessions/[id]/stream/route.ts` | `GET` SSE stream; delivers `token`, `tool_call`, `manual_obs_request`, `report_ready`, `error`, `done` events (§5.4) |
| `src/app/api/manual-observations/pending/[id]/route.ts` | `GET` poll pending obs status (§5.8) |
| `src/app/api/manual-observations/pending/[id]/confirm/route.ts` | `POST` confirm + create Observation + AttestationRecord |
| `src/app/api/manual-observations/pending/[id]/skip/route.ts` | `POST` mark skipped; agent resumes |
| `src/app/api/reports/route.ts` | `GET` list Reports (no `html_snapshot_url` — RISK-15 resolved) |
| `src/app/api/reports/[id]/route.ts` | `GET` single Report with freshly-presigned `html_snapshot_url` + `pdf_url` |
| `src/app/api/reports/[id]/versions/route.ts` | `GET` version lineage chain |
| `src/app/api/reports/[id]/regenerate/route.ts` | `POST` mem0 write + new Report version + enqueue PDF job |

**New source files — agent & MCP layer:**

| File | Responsibility |
|------|----------------|
| `src/lib/agent/loop.ts` | Agent orchestration loop: reads session, invokes tool sequence, writes ChatMessages, publishes to SSE |
| `src/lib/agent/streaming.ts` | Grok streaming response reader; emits `token` SSE events; batches to `ChatMessage` rows on `done` |
| `src/lib/agent/session-buffer.ts` | In-memory per-session replay buffer (60 s TTL, 200 events max); supports `Last-Event-ID` resumption (RISK-03) |
| `src/lib/mcp/index.ts` | MCP tool registry — exports `toolDispatch(name, input, ctx)` |
| `src/lib/mcp/search-observations.ts` | `search_observations` implementation |
| `src/lib/mcp/search-evidence.ts` | `search_evidence` implementation (hybrid retrieval call) |
| `src/lib/mcp/compute-derivation.ts` | `compute_derivation` implementation |
| `src/lib/mcp/propose-manual-observation.ts` | `propose_manual_observation`: creates `PendingManualObservation`, publishes `manual_obs_request` SSE event |
| `src/lib/mcp/create-report.ts` | `create_report`: stores Report entity + uploads HTML to R2 |
| `src/lib/mcp/render-pdf.ts` | `render_pdf`: enqueues `render-pdf-job`; polls `Report.pdf_url` until populated (max 60 s); publishes `report_ready` SSE event |
| `src/lib/mcp/get-categories.ts` | `get_categories` implementation |
| `src/lib/mcp/merge-observations.ts` | `merge_observations` implementation |
| `src/lib/mcp/get-report-data.ts` | `get_report_data` implementation |
| `src/lib/mcp/get-preferences.ts` | `get_preferences`: reads mem0 by `user_id + company_id + optional client_id` scope |

**New source files — PDF worker (separate process):**

| File | Responsibility |
|------|----------------|
| `workers/pdf/index.ts` | BullMQ worker entry point; initialises Puppeteer pool, processes `render-pdf-job` queue |
| `workers/pdf/jobs/render.ts` | Job handler: fetches HTML from R2, renders to PDF, uploads PDF to R2, updates `Report.pdf_url` |
| `workers/pdf/pool.ts` | Puppeteer browser pool: max 3 concurrent instances; restart browser after 50 renders; 30 s per-render timeout |
| `workers/pdf/Dockerfile` | Standalone Docker image for the PDF worker |

**New source files — UI pages:**

| File | Responsibility |
|------|----------------|
| `src/app/(app)/chat/page.tsx` | Full-page chat entry point; loads session list sidebar + active session |
| `src/app/(app)/chat/[sessionId]/page.tsx` | Active chat session view |
| `src/app/(app)/reports/page.tsx` | Reports list page |
| `src/app/(app)/reports/[id]/page.tsx` | Report detail page |

**New source files — UI components:**

| File | Responsibility |
|------|----------------|
| `src/components/chat/ChatShell.tsx` | Scrollable message list + fixed input bar; SSE event listener |
| `src/components/chat/MessageBubble.tsx` | Polymorphic renderer; dispatches per `type` (§5.14) |
| `src/components/chat/ToolCallCard.tsx` | Collapsed card for `agent_tool_call` messages |
| `src/components/chat/ManualObsCard.tsx` | Inline CTA card for `manual_obs_request`; opens popup |
| `src/components/chat/ReportReadyCard.tsx` | Card with "Voir le rapport" + "Télécharger le PDF" buttons |
| `src/components/chat/SessionSidebar.tsx` | Left sidebar; lists sessions; "Nouvelle conversation" button |
| `src/components/chat/ManualObsPopup.tsx` | Modal dialog (shadcn `Dialog` + `Form`); full field spec in §5.9 |
| `src/components/reports/ReportIframe.tsx` | Sandboxed `<iframe>` wrapper for HTML report preview |
| `src/components/reports/VersionSidebar.tsx` | Version history list; "Régénérer" button |

---

#### §5.2 DB Entities — No New Migrations Required

All five entities (`ChatSession`, `ChatMessage`, `PendingManualObservation`, `Report`, `DerivationResult`) were defined in the Slice 1 schema (§1.5). This slice only reads and writes them. Confirm before implementation:

- `ChatMessage.content` is `jsonb` — no schema enforcement at DB level; enforced by Zod in the route handler.
- `PendingManualObservation.expires_at` is `timestamptz` — set to `created_at + INTERVAL '10 minutes'` on insert.
- `Report.html_snapshot_r2_key` stores the R2 object key (not a URL); presigned URL is generated fresh per request.
- `Report.pdf_r2_key` is nullable; `null` while PDF render is in progress.
- `Report.style_snapshot` is `jsonb`; stores a copy of mem0 preferences at generation time.
- `Report.source_report_id` is a self-referential FK; `null` for first-generation reports.

---

#### §5.3 Chat Session API Contracts

**`POST /api/chat/sessions`** — Create session
- Request body: none (session is user-scoped; `user_id` from session JWT)
- Response: `{ session_id, created_at }`
- Sets `ChatSession.title` to `"Nouvelle conversation"` initially; title is updated to the first user message text (truncated to 60 chars) after the first message is stored.

**`GET /api/chat/sessions`** — List sessions (paginated)
- Response data item shape: `{ session_id, title, created_at, updated_at, message_count }`
- Default sort: `updated_at:desc`; limit 20.

**`DELETE /api/chat/sessions/{id}`** — Delete session
- Cascades: deletes all `ChatMessage` rows for the session.
- Returns `204 No Content`.

**`POST /api/chat/sessions/{id}/messages`** — Send user message (RISK-03 resolution)
- Request body: `{ text: string }` (max 4000 chars)
- Behaviour:
  1. Validates session belongs to authenticated user.
  2. Creates `ChatMessage` row: `role=user`, `type=user_text`, `content={ text }`.
  3. Updates `ChatSession.title` if this is the first message (truncated to 60 chars).
  4. Updates `ChatSession.updated_at`.
  5. Dispatches agent loop asynchronously (does NOT await completion).
  6. Returns `202 Accepted` with `{ message_id }`.
- RISK-03 resolution: returns immediately; all agent output arrives via SSE stream. The SSE stream's replay buffer (§5.4) ensures no events are lost if the client opens the stream slightly after the 202.

**`GET /api/chat/sessions/{id}/messages`** — Message history (RISK-09 resolution)
- Returns paginated `ChatMessage[]`.
- Per-type `content` shapes are fully defined (§5.13) — frontend can reconstruct the full chat history without the SSE stream.

---

#### §5.4 Chat SSE Stream Architecture (RISK-03 Resolved)

**`GET /api/chat/sessions/{id}/stream`**

This endpoint returns a persistent `text/event-stream` response.

**Redis-backed session replay buffer** (`src/lib/agent/session-buffer.ts`):
- Uses **Redis Streams** — one stream per session, key: `sse:chat:{session_id}`.
- Each event is appended via `XADD sse:chat:{session_id} MAXLEN ~ 200 * event <type> data <json>`. The stream entry ID (e.g. `1700000000000-0`) is used as the SSE `id`.
- Max capacity: `MAXLEN ~ 200` (approximate trimming per `XADD`).
- TTL: 60 seconds after the `done` event is emitted, call `EXPIRE sse:chat:{session_id} 60`.
- **Architectural decision:** Redis Streams chosen over sticky sessions — the Next.js app may run multiple replicas behind a load balancer; any replica can serve SSE reconnects via the shared Redis stream.
- Keyed by `session_id` (not `company_id` — chat SSE is per-user, not per-company).

**Connection flow:**
```
Client connects to GET /sessions/{id}/stream
  ↓
Route handler reads Last-Event-ID header (may be absent for new connections)
  ↓
If Last-Event-ID present → XRANGE sse:chat:{session_id} (Last-Event-ID +1 → flush missed events to client
  ↓
Subscribe via XREAD BLOCK 0 COUNT 10 STREAMS sse:chat:{session_id} $ for new events
  ↓
Forward events to client as SSE data lines; stream entry ID used as `id` field
  ↓
On clean disconnect → unsubscribe only; stream key retained until EXPIRE TTL
```

**SSE event catalog** (§16.2):

| Event | Trigger | Data payload |
|-------|---------|-------------|
| `token` | Agent emits a text token | `{ delta: string }` |
| `tool_call` | Agent invokes an MCP tool | `{ tool_name, summary, details? }` |
| `manual_obs_request` | `propose_manual_observation` called | `{ pending_id, prefilled: { label, normalized_key, value, unit, period_start, period_end } }` |
| `report_ready` | `create_report` + `render_pdf` complete | `{ report_id, title, html_snapshot_url, pdf_url }` |
| `error` | Unrecoverable agent error | `{ message, retryable: boolean }` |
| `done` | Agent finishes full response | `{}` |

---

#### §5.5 Agent Loop (Pseudocode)

File: `src/lib/agent/loop.ts`

```
async function runAgentLoop(sessionId, userMessageId, ctx):
  emit tool_call("Lecture des préférences…")
  prefs ← get_preferences(ctx.userId, ctx.companyId)

  sections ← identifyISO26000Sections(userText, prefs)

  for each section in sections:
    obs ← search_observations(section.query, { period_filter })
    if obs incomplete (qualitative test by agent):
      blocks ← search_evidence(section.broaderQuery)
    if still no data:
      pending ← propose_manual_observation(prefillHints)
      result ← subscribe to Redis channel `pending-obs:{pending.pending_id}`; await message (max 10 min)
      if result.status ∈ {skipped, timeout}: section.value = "Non renseigné"

  derivations ← []
  for each rollup needed:
    d ← compute_derivation(obsIds, operation)
    derivations.push(d)

  html ← Grok.generate(template, sections, prefs)  // streaming tokens → emit `token` events

  report ← create_report({ html, observationIds, derivationIds, prefs })
  emit tool_call("Rendu PDF en cours…")
  pdf ← render_pdf(report.report_id)               // waits for PDF worker
  emit report_ready({ report_id, html_snapshot_url, pdf_url })
  emit done
```

Each `emit` call appends to the Redis Stream (`XADD sse:chat:{session_id}`) AND forwards to any currently-connected SSE clients via `XREAD`. All Grok text generation is streamed: tokens are forwarded as `token` events and also accumulated; the full accumulated text is stored as a single `ChatMessage` row after `done`.

---

#### §5.6 MCP Tool Dispatch Layer

File: `src/lib/mcp/index.ts`

- Exports `toolDispatch(toolName: string, input: unknown, ctx: AgentContext): Promise<unknown>`.
- `AgentContext` contains `{ companyId, userId, sessionId }` — derived from the Auth.js session, never from agent input.
- `toolDispatch` validates that `toolName` is in the registry; returns `{ error: "unknown_tool" }` otherwise.
- Each tool implementation receives `(input, ctx)` — `company_id` is always `ctx.companyId` (RISK-08 resolution).
- Tool calls are wrapped in try/catch; on error, the agent loop emits an `error` SSE event and aborts the turn if the error is non-retryable.

---

#### §5.7 MCP Tool Input/Output Shapes (RISK-08: `company_id` removed from all inputs)

All tools derive `company_id` from `ctx.companyId`. It is NOT in the Input schema.

**`search_observations`**
- Input: `{ query, filters?: { category_id?, normalized_key?, period_filter?: { start, end }, status? } }`
- Output: `{ observations: Observation[] }`

**`search_evidence`**
- Input: `{ query, filters?: { document_version_id?, category_id? } }`
- Output: `{ blocks: { block_id, document_version_id, page_number, bbox, text, document_title, category_path, score }[] }`
- Implementation: calls hybrid retrieval (RRF, same path as extraction job) scoped to `ctx.companyId`.

**`compute_derivation`**
- Input: `{ observation_ids: UUID[], operation: "sum"|"average"|"delta"|"ratio"|"count", expected_periods?: Period[] }`
  - `Period` type: `{ type: "FY"|"Q"|"YTD"|"custom", start_date: ISO date, end_date: ISO date, label?: string }`
  - `expected_periods` is required for coverage calculation per spec §10.3. If omitted, `coverage.fraction` defaults to `null` and the 50% threshold guard is skipped.
- Output: `{ derivation_result_id, value: number, unit: string, coverage: { present_periods: Period[], expected_periods: Period[], fraction: number | null }, input_observation_ids: UUID[], status: "fresh" | "reused", stale: boolean }`
  - `fraction` = `present_periods.length / expected_periods.length` (or `null` if no `expected_periods` supplied).
  - `status: "reused"` when cache hit and not stale; `"fresh"` when newly computed.
- Cache key: SHA256(sorted `observation_ids[]` + operation + `companyId`). Returns cached result if not stale.
- **Errors:**
  | Error code | Condition |
  |------------|----------|
  | `incompatible_units` | Input observations have different `unit` values that cannot be auto-converted |
  | `non_numeric_input` | Any input observation has `data_type != 'numeric'` or `numeric_value IS NULL` |
  | `insufficient_coverage` | `coverage.fraction < 0.50` (spec §10.5 threshold); derivation is still stored but flagged |
  | `division_by_zero` | `operation = "ratio"` and denominator observation has `numeric_value = 0` |
  | `observation_not_approved` | Any input observation has `status != 'approved'` |

**`propose_manual_observation`**
- Input: `{ suggested_label?, suggested_normalized_key?, suggested_value?, suggested_unit?, suggested_period_start?, suggested_period_end?, note? }`
- Output: `{ pending_id, prefilled: { label, normalized_key, value, unit, period_start, period_end } }`
- Side-effect: creates `PendingManualObservation` row with `expires_at = now() + 10 min`; publishes `manual_obs_request` SSE event to the session buffer.

**`create_report`**
- Input: `{ client_id?, language, html_content, observation_ids[], derivation_result_ids[], reporting_period_start?, reporting_period_end? }`
- Output: `{ report_id, version, html_snapshot_url, style_snapshot, status: "draft" }`
- Guard: `html_content` max 2 MB; reject with `{ code: "html_too_large" }` otherwise.
- Side-effect: uploads `html_content` to R2 at key `{company_id}/reports/{report_id}/snapshot.html`; stores `html_snapshot_r2_key` on the Report entity (not the URL).
- `generated_by` set from `ctx.userId`; `style_snapshot` set from current mem0 preferences.

**`render_pdf`**
- Input: `{ report_id }`
- Output: `{ pdf_url, report_id }`
- Side-effect: enqueues a `render-pdf-job` on BullMQ. Subscribes to Redis pub/sub channel `render-pdf:{report_id}` with a 90 s timeout. The PDF worker publishes `{ pdf_r2_key }` to this channel on completion. If the pub/sub message arrives, returns freshly-presigned `pdf_url` immediately. Fallback: if pub/sub is missed, polls `Report.pdf_r2_key` every 2 s for the remaining time. On timeout (90 s total), returns `{ error: "render_timeout" }`.
- PDF worker independently updates `Report.pdf_r2_key` on job completion and publishes to `render-pdf:{report_id}`.
- Frontend fallback: if `render_pdf` returns `{ error: "render_timeout" }`, the `ReportDetail` page shows a "PDF en cours…" spinner and polls `GET /api/reports/{id}` every 3 s until `pdf_url !== null`.

**`get_categories`**
- Input: `{}` (no user-supplied fields)
- Output: `{ categories: { category_id, name, path, parent_category_id, children[] }[] }`

**`merge_observations`**
- Input: `{ observation_ids: UUID[], canonical_label, canonical_normalized_key }`
- Output: `{ updated_count }`
- Creates one `AuditLog` row per updated observation.

**`get_report_data`**
- Input: `{ report_id }`
- Output: `{ report, observations: Observation[], derivations: DerivationResult[] }`

**`get_preferences`**
- Input: `{ user_id, client_id? }`
- Output: `{ preferences: { language?, tone?, report_sections_order?, custom_instructions? } }`
- On mem0 read timeout (3 s): returns `{}` and continues without blocking (degraded mode per §12.5).

---

#### §5.8 PendingManualObservation Lifecycle (RISK-04 Resolved)

**`GET /api/manual-observations/pending/{pending_id}`** response shape:
```json
{
  "pending_id": "<uuid>",
  "status": "pending | confirmed | skipped | timeout",
  "observation_id": "<uuid> | null",
  "created_at": "<iso8601>",
  "expires_at": "<iso8601>"
}
```
- `observation_id` is populated only when `status = confirmed`.
- If `pending_id` does not exist or has expired: `404` with `{ code: "pending_not_found" }`.
- Agent subscribes to Redis pub/sub channel `pending-obs:{pending_id}` and awaits a message (max 10 minutes). When the user confirms or skips (or the timeout fires), the handler publishes `{ status, observation_id? }` to the channel. The agent receives the status change instantly without polling. Fallback: if no pub/sub message arrives within 10 minutes, the agent treats it as `skipped`.
- When `expires_at` passes without action, a background timeout task (BullMQ `delayed` job, scheduled at creation time) sets `status = timeout` and publishes `{ status: "timeout" }` to `pending-obs:{pending_id}`. Agent treats `timeout` the same as `skipped`.

**State transitions:**
```
pending
  → confirmed  (POST .../confirm)
  → skipped    (POST .../skip)
  → timeout    (BullMQ delayed job, fires after 10 min)
```
All transitions are terminal — no re-opening. `409 Conflict` returned if confirm/skip is called on a non-`pending` record.

**Pending observation cleanup job** (BullMQ repeatable):
- Queue: `pending-obs-timeout`
- Schedule: every 5 minutes (`repeat: { every: 300_000 }`)
- Job handler:
  1. `SELECT * FROM pending_manual_observation WHERE status = 'pending' AND expires_at < now()`
  2. For each expired row: `UPDATE SET status = 'timeout'`
  3. Publish `{ status: "timeout" }` to Redis pub/sub channel `pending-obs:{pending_id}` for each expired row (unblocks any agent still waiting).
  4. Log count of timed-out rows.
- **Rationale (MR-28):** The per-record BullMQ delayed job (scheduled at creation time) is the primary timeout mechanism. This repeatable sweep is a safety net for any delayed jobs that were lost due to Redis restart or worker crash.

---

#### §5.9 Manual Observation Popup Wiring

Component: `src/components/chat/ManualObsPopup.tsx`

**Trigger:** Frontend SSE listener receives `manual_obs_request` event. The `pending_id` and `prefilled` object are stored in React state. `ManualObsPopup` becomes visible.

**Form fields** (all validated client-side with Zod; same rules as server-side Zod schema):

| Field | Control | Pre-filled | Editable | Validation |
|-------|---------|-----------|---------|------------|
| `label` | Text input | Yes | Yes | Required, max 200 chars |
| `normalized_key` | Text input | Yes | Yes | Required, snake_case regex, max 100 chars |
| `value` | Text input | Yes | Yes | Required |
| `unit` | Text input | Yes | Yes | Optional, max 50 chars |
| `data_type` | Select | Inferred | Yes | Required; enum |
| `time_behavior` | Toggle group | Inferred | Yes | Required; enum |
| `period_start` | Date picker | Yes, if available | Yes | Required when `time_behavior = periodic` |
| `period_end` | Date picker | Yes, if available | Yes | Required when `time_behavior = periodic` |
| `category_id` | Category select | Inherited from context | Yes | Optional |
| `source_reference` | Text input | Empty | Yes | Optional, max 500 chars |
| `note` | Textarea | Empty | Yes | Optional, max 1000 chars |

**Confirm flow:** `POST /api/manual-observations/pending/{pending_id}/confirm` with all field values → `{ observation_id, status: "approved" }` → popup closes → `ManualObsCard` in chat updates to reflect confirmed state → chat input re-enabled.

**Skip flow:** `POST /api/manual-observations/pending/{pending_id}/skip` → popup closes → agent SSE stream resumes → agent marks section with "Non renseigné".

**Banner:** While popup is open, chat input bar is disabled and a banner reads: `« En attente de votre saisie pour [label]… »`.

**Timeout:** 10-minute countdown shown in the popup footer. If the user takes no action, `status` becomes `timeout`; popup auto-closes with a toast: `« Délai expiré – section marquée comme non renseignée »`.

---

#### §5.10 Report API Contracts (RISK-15 Resolved)

**`GET /api/reports`** — List
- Returns paginated `Report[]`.
- Fields per item: `report_id, version, status, language, generated_at, client_id, source_report_id`.
- RISK-15 resolution: **`html_snapshot_url` is excluded** from the list response. No presigned URL is generated at list time.
- Query params: `client_id?`, `status?`, `sort=generated_at:desc` (default).

**`GET /api/reports/{id}`** — Single report
- Returns full Report record.
- `html_snapshot_url`: generated fresh per request — call `r2.getPresignedUrl(report.html_snapshot_r2_key, 3600)`. Every call to this endpoint returns a URL valid for 1 hour.
- `pdf_url`: `null` if PDF is not yet rendered; otherwise a freshly-presigned URL.

**`GET /api/reports/{id}/versions`** — Version chain
- Returns: `{ versions: { report_id, version, source_report_id, generated_at, status, language }[] }`
- Ordered by `version ASC`.
- Implementation: traverse `source_report_id` links starting from the root (where `source_report_id IS NULL`), or query all reports sharing the same lineage root.

---

#### §5.11 PDF Worker Architecture

Files: `workers/pdf/`

**BullMQ job queue:** `render-pdf-job`
- Job payload: `{ report_id: UUID, html_r2_key: string, output_r2_key: string }`
- `output_r2_key` = `{company_id}/reports/{report_id}/report.pdf`

**Job handler flow (`workers/pdf/jobs/render.ts`):**
```
1. Fetch HTML from R2 using html_r2_key → get HTML string
2. Sanitize HTML with `isomorphic-dompurify`:
     const clean = DOMPurify.sanitize(html, {
       WHOLE_DOCUMENT: true,
       FORBID_TAGS: ['script','iframe','object','embed','form','input','textarea','select'],
       FORBID_ATTR: ['onerror','onload','onclick','onmouseover'],
       ALLOW_DATA_ATTR: false,
     });
   Reject job if DOMPurify removed > 5% of content length (likely malicious payload).
3. Acquire Puppeteer browser instance from pool
4. Open new page; setContent(clean); wait for networkidle0
5. page.pdf({ format: 'A4', printBackground: true }) → Buffer
6. Upload PDF buffer to R2 at output_r2_key
7. UPDATE Report SET pdf_r2_key = output_r2_key WHERE report_id = ?
8. Release browser instance to pool
```
- **Dependency:** `pnpm add isomorphic-dompurify` in the PDF worker package.
- **Rationale (MR-13):** HTML is generated by the LLM. Without sanitization, prompt-injected `<script>` or `<iframe>` tags could cause SSRF from the Puppeteer container to internal services.

**Puppeteer pool (`workers/pdf/pool.ts`):**
- Max 3 concurrent browser instances.
- Each instance tracks render count; restarts after 50 renders to prevent memory leaks.
- Per-render timeout: 30 seconds (enforced via `Promise.race`).
- On timeout: job fails; BullMQ retries once (total 2 attempts). After both fail: job is moved to the failed queue. Report `pdf_r2_key` remains `null`; `render_pdf` MCP tool returns `{ error: "render_timeout" }`.
- HTML-only fallback: if both attempts fail, the agent notifies the user and provides the `html_snapshot_url` link instead.

**Environment:** `PDF_WORKER_URL` is not used by the PDF worker itself — it's used by the Next.js app server if a direct HTTP health-check route is needed. The actual communication is via Redis (BullMQ queue).

**Docker (`workers/pdf/Dockerfile`):**
```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation libatk-bridge2.0-0 libgtk-3-0 libnss3 \
    libxss1 libasound2 libx11-xcb1 curl && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY workers/pdf/ ./workers/pdf/
COPY src/lib/r2.ts src/lib/db.ts src/lib/schema/ ./src/lib/
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:3003/health || exit 1
CMD ["node", "--max-old-space-size=512", "workers/pdf/index.ts"]
```
- **Base image:** `node:20-slim` (Debian bookworm).
- **Chromium:** System-installed via `apt`; `PUPPETEER_SKIP_DOWNLOAD=true` prevents the bundled download.
- **Memory limit:** `--max-old-space-size=512` (512 MB); Docker/K8s memory limit should be set to 768 MB to allow headroom for Chromium child processes.
- **Health check:** HTTP GET on port 3003 `/health` (returns `200 OK` with `{ status: "ok", pool_size, active_renders }`).

---

#### §5.12 Report Regeneration (RISK-07 Resolved)

**`POST /api/reports/{id}/regenerate`**
- Request body: `{ style_instruction?: string (max 500), client_id?: UUID, language?: BCP-47 }`
- Behaviour:
  1. Load source report; confirm `company_id` match (403 otherwise).
  2. If `style_instruction` provided: write to mem0 (`user_id + company_id + optional client_id` scope); latest-wins.
  3. **Session handling:** If request includes header `X-Chat-Session-Id`, use that existing session for SSE streaming. Otherwise, create a new `ChatSession` (title: `"Régénération du rapport #${source.version}"`) and return its `session_id` in the response. This ensures SSE events always have a destination.
  4. Dispatch agent loop with `mode = regenerate` on BullMQ queue `agent-loop` (not inline), pre-seeding `observation_ids[]` and `derivation_result_ids[]` from the source report as starting context. The agent loop is identical to the normal flow but skips `search_observations` / `propose_manual_observation` steps (data is already collected).
  5. Agent re-generates HTML (tokens stream via SSE on the resolved session), calls `create_report` (new `report_id`, `version = source.version + 1`, `source_report_id = source.report_id`), then `render_pdf`.
  6. Response: `{ report_id, version, session_id, html_snapshot_url, pdf_url: null | string }`; `pdf_url` is `null` if PDF is still rendering. Client opens `GET /api/chat/sessions/{session_id}/stream` to receive progress events.
- RISK-07 resolution: `pdf_url = null` is the documented state; the client polls `GET /api/reports/{id}` (same endpoint, always returns freshly-presigned URL) until `pdf_url !== null`. The pipeline SSE channel also emits a `notification` event of type `report_ready` when `Report.pdf_r2_key` is set, so the notification bell updates live without polling.
- Guard: `409 Conflict` with `{ code: "generation_in_progress" }` if the source report already has an in-progress regeneration job.

---

#### §5.13 ChatMessage Content Shapes (RISK-09 Resolved)

All `ChatMessage` rows are stored with `content: jsonb`. The per-type shapes are enforced on write by the route handler's Zod schema and used on read to reconstruct chat history.

| `type` | `content` shape |
|--------|----------------|
| `user_text` | `{ text: string }` |
| `agent_text` | `{ text: string }` (accumulated from token stream) |
| `agent_tool_call` | `{ tool_name: string, summary: string, details?: object }` |
| `manual_obs_request` | `{ pending_id: UUID, prefilled: { label, normalized_key, value, unit, period_start, period_end } }` |
| `report_ready` | `{ report_id: UUID, title: string, html_snapshot_url: string, pdf_url: string \| null }` |
| `error` | `{ message: string, retryable: boolean }` |

Note: `html_snapshot_url` stored in `report_ready` messages is a presigned URL. It may expire after 1 hour. When rendering history, if the URL has expired, the frontend calls `GET /api/reports/{report_id}` to obtain a fresh URL.

---

#### §5.14 Chat UI Responsibilities

**`ChatShell.tsx`:**
- Opens `EventSource` to `/api/chat/sessions/{id}/stream` with `Last-Event-ID` support.
- Dispatches incoming events to local state:
  - `token` → appends delta to the streaming agent message bubble.
  - `tool_call` → inserts a `ToolCallCard` (collapsed by default; expandable).
  - `manual_obs_request` → inserts a `ManualObsCard` + opens `ManualObsPopup`; disables chat input.
  - `report_ready` → inserts a `ReportReadyCard`; re-enables chat input.
  - `error` → inserts a red error card with "Réessayer" button.
  - `done` → finalizes streaming bubble; re-enables chat input.
- On reconnect after network drop → passes `Last-Event-ID: {lastEventId}` header so replay buffer fills the gap.

**`MessageBubble.tsx`:**
- `user_text`: right-aligned bubble, plain text.
- `agent_text`: left-aligned bubble, `react-markdown` rendered (supports tables, lists). Streaming mode shows animated cursor.
- All other types: delegate to specialized card components.

**Empty state:** Welcome message + 2–3 suggested prompts:
- `« Générer un rapport ISO 26000 pour… »`
- `« Quelles sont mes émissions GES pour 2025 ? »`
- `« Montrez-moi toutes les observations sur la main-d'œuvre »`

**Loading state:** Typing indicator (3 animated dots, Framer Motion) while agent processes tool calls (between `tool_call` events and the first `token` event).

---

#### §5.15 Reports List and Detail Page Responsibilities

**`/reports` page (`ReportsList`):**
- Fetches paginated reports from `GET /api/reports`.
- Filter bar: by `client_id`, by `status` (draft/final).
- Each row shows: title (if none: `"Rapport #${version}"`), `generated_at`, language badge, "Voir" button.
- Empty state (FR): `« Aucun rapport généré. Commencez par discuter avec l'agent. »` with a CTA to `/chat`.

**`/reports/[id]` page (`ReportDetail`):**
- Fetches `GET /api/reports/{id}` to obtain fresh presigned `html_snapshot_url`.
- Renders `<iframe src={html_snapshot_url} sandbox="allow-scripts allow-same-origin" title="Aperçu du rapport" />`. Never uses `dangerouslySetInnerHTML` for report HTML.
- Right sidebar: `VersionSidebar` lists all versions from `GET /api/reports/{id}/versions`; active version highlighted.
- "Régénérer" button opens a small `Dialog` with a `style_instruction` text field; submits to `POST /api/reports/{id}/regenerate`.
- If `pdf_url` is null: "PDF en cours de rendu…" spinner; polls `GET /api/reports/{id}` every 3 seconds until `pdf_url !== null`.
- Pipeline SSE `notification` event with `type: report_ready` also triggers a re-fetch to stop the polling spinner early.

---

#### §5.16 Validation

| Route | Key validation rules |
|-------|---------------------|
| `POST /sessions/{id}/messages` | `text` required, 1–4000 chars; session must belong to `ctx.userId` |
| `POST /pending/{id}/confirm` | Full field schema per §5.4.1; `pending_id` must exist and have `status = pending`; returns `409` if already confirmed/skipped/timeout |
| `POST /pending/{id}/skip` | `pending_id` must exist and have `status = pending`; same 409 guard |
| `create_report` MCP tool | `html_content` max 2 MB; `observation_ids[]` must all belong to `ctx.companyId` and have `status = approved`; `derivation_result_ids[]` must all belong to `ctx.companyId` |
| `render_pdf` MCP tool | `report_id` must belong to `ctx.companyId`; report must have `html_snapshot_r2_key` set |
| `POST /reports/{id}/regenerate` | `style_instruction` max 500 chars; `report_id` must belong to `ctx.companyId` |

---

#### §5.17 Security

- **RISK-08 (MCP `company_id`):** All MCP tool implementations read `company_id` exclusively from `AgentContext.companyId` (set from the Auth.js session at the route handler level). The tool input schema has no `company_id` field. Prompt injection cannot override the tenant scope.
- **Report HTML sandboxing:** The HTML report is rendered inside `<iframe sandbox="allow-scripts allow-same-origin">`. This prevents script execution that could access parent-window cookies or navigate the parent frame. `dangerouslySetInnerHTML` is never used for report HTML.
- **Presigned URL scoping:** `html_snapshot_url` and `pdf_url` are generated fresh per `GET /api/reports/{id}` call. They are never persisted to a public DB column; only the R2 object key is stored.
- **PendingManualObservation ownership:** `confirm` and `skip` endpoints verify that the `PendingManualObservation` record was created in the same company as the authenticated user.
- **Chat session ownership:** `GET /stream`, `POST /messages`, and `GET /messages` all verify `ChatSession.user_id = ctx.userId` (users cannot access other users' chat sessions, even within the same company).
- **mem0 write on regenerate:** mem0 write timeout (5 s, 1 retry per §12.5); on failure, log and continue — does not block regeneration.

---

#### §5.18 Testing Strategy

**Unit tests (Vitest):**
- `session-buffer.ts`: test Redis Stream `XADD`/`XRANGE`/`XREAD`, `MAXLEN ~ 200` trimming, `EXPIRE` TTL, `Last-Event-ID` replay via `XRANGE`.
- `mcp/index.ts`: verify unknown tool returns `{ error: "unknown_tool" }`; verify `company_id` is never in input shape.
- `mcp/render-pdf.ts`: mock BullMQ enqueue + mock Report polling; test timeout path returns `{ error: "render_timeout" }`.
- Agent loop: stub all MCP tools; assert emitted SSE events match expected sequence for a happy-path report generation.

**Integration tests (`@testcontainers/postgresql` + Redis):**
- `POST /sessions/{id}/messages` → agent runs → `GET /stream` delivers `done` event.
- `propose_manual_observation` → `GET /pending/{id}` returns `status: pending` → `POST /confirm` → `GET /pending/{id}` returns `status: confirmed, observation_id: X`.
- `create_report` → `GET /reports/{id}` returns `html_snapshot_url` (presigned); `GET /reports` does NOT return `html_snapshot_url`.
- Regenerate: `POST /reports/{id}/regenerate` → new report version exists in `GET /reports/{id}/versions`; `source_report_id` is set correctly.
- Timeout path: set `expires_at` to past; `POST /confirm` returns `409`.

**E2E (Playwright):**
- Chat page: type a message → see typing indicator → see `tool_call` cards appear → see `report_ready` card → click "Voir le rapport" → iframe renders.
- Manual obs popup: agent triggers popup → user fills fields → clicks "Confirmer" → popup closes → chat resumes.
- Reports page: regenerate a report → spinner appears → spinner disappears when PDF ready.

---

#### §5.19 Edge Cases

| Case | Handling |
|------|----------|
| Agent loop throws unrecoverable error mid-stream | Emit `error` SSE event; store `ChatMessage(type=error, content={ message, retryable })`; mark session as `error_state` |
| PDF render times out both attempts | `render_pdf` MCP tool returns `{ error: "render_timeout" }`; agent emits `error` SSE then falls back to providing `html_snapshot_url` link |
| User closes popup without confirming/skipping | Popup remains open on re-connection (status still `pending`). Frontend checks popup state on reconnect and re-opens if `status = pending` |
| `EventSource` disconnects mid-stream | On reconnect with `Last-Event-ID`, replay buffer sends missed events. If buffer has expired (>60s), client re-fetches message history from `GET /sessions/{id}/messages` to reconstruct state |
| `html_snapshot_url` in stored `report_ready` ChatMessage has expired | Frontend detects expired URL (HTTP 403 from R2), calls `GET /api/reports/{report_id}` for a fresh URL |
| Regeneration triggered while chat SSE stream is closed | PDF readiness delivered via pipeline SSE `notification` event (type `report_ready`); notification bell updates; report detail page polls `GET /api/reports/{id}` |
| `compute_derivation` with stale cached result | Tool returns `{ stale: true }` in output; agent notes coverage caveat in report narrative |
| mem0 read returns empty `{}` | Agent uses defaults: `language = fr`, `tone = formal`, no `custom_instructions` |

---

#### §5.20 Acceptance Criteria

- [ ] `POST /api/chat/sessions/{id}/messages` returns `202` immediately; agent runs asynchronously.
- [ ] `GET /api/chat/sessions/{id}/stream` delivers `token` events followed by `done`; `Last-Event-ID` replay delivers missed events correctly.
- [ ] Agent calls `propose_manual_observation` → SSE emits `manual_obs_request` → popup opens pre-filled → `POST .../confirm` creates an `approved` observation → chat resumes.
- [ ] `create_report` stores HTML in R2; `render_pdf` enqueues PDF job; `report_ready` event is emitted with both URLs.
- [ ] `GET /api/reports` does NOT include `html_snapshot_url`.
- [ ] `GET /api/reports/{id}` always returns a fresh presigned `html_snapshot_url` (valid ≥1 hour from request time).
- [ ] Report detail page renders HTML inside a sandboxed `<iframe>`; no `dangerouslySetInnerHTML` used.
- [ ] `GET /api/reports/{id}/versions` returns full version chain after regeneration; `source_report_id` correctly set.
- [ ] `GET /api/manual-observations/pending/{id}` returns `{ status, pending_id, observation_id, created_at, expires_at }`.
- [ ] `POST /pending/{id}/confirm` on an already-confirmed record returns `409`.
- [ ] All MCP tool implementations pass `company_id` from `AgentContext`; no tool accepts `company_id` as agent input.
- [ ] PDF worker Dockerfile builds and runs independently; `render-pdf-job` queue is processed even when Next.js app server is down.

---

#### §5.21 Verification Checklist

```
[ ] tsc --noEmit passes with no errors in src/lib/agent/, src/lib/mcp/, workers/pdf/
[ ] vitest run: session-buffer replay test passes for 0-event, mid-stream, and post-done-TTL scenarios
[ ] curl POST /api/chat/sessions/{id}/messages → HTTP 202 returned in < 200ms
[ ] EventSource client receives [ tool_call... token... done ] event sequence for a smoke-test query
[ ] POST /api/manual-observations/pending/{id}/confirm returns { observation_id, status: "approved" }
[ ] GET /api/reports returns list without html_snapshot_url field
[ ] GET /api/reports/{id} returns html_snapshot_url that resolves (HTTP 200) from R2
[ ] PDF worker: docker build workers/pdf succeeds; render-pdf-job job completes and sets Report.pdf_r2_key
[ ] GET /api/reports/{id}/versions returns [ { version: 1, source_report_id: null }, { version: 2, source_report_id: v1_id } ] after one regeneration
[ ] Playwright: full chat → report flow completes end-to-end in < 90 seconds on test fixture data
```

---

### Slice 6 — Dashboard + Settings + Admin + Client CRUD + Rate Limiting + Polish

**Scope:** Dashboard summary, notification bell, category manager (CRUD + dnd-kit reorder), preferences, user management, company settings, observation merge REST endpoint, company data deletion, global UI polish (empty states, skeletons, onboarding, FR copy, Framer Motion transitions, accessibility).

**End-to-end value:** Full production-ready experience across all pages. Every route has complete loading/empty/error states in French. Admin can manage team and categories. Dashboard is live with real aggregated numbers.

**Dependencies:** Slices 1–5.  
**Background jobs:** None new.  
**Risks resolved:** RISK-05 (category reorder parent validation), RISK-06 (preferences scope ambiguity), RISK-10 (user invite lifecycle), RISK-11 (observation merge contract).

---

#### §6.1 File Inventory

**New source files — API route handlers:**

| File | Responsibility |
|------|----------------|
| `src/app/api/dashboard/summary/route.ts` | `GET` — aggregate query: `documents_by_status`, `unresolved_conflict_count`, `recent_documents`, `recent_reports` |
| `src/app/api/notifications/route.ts` | `GET` paginated notifications for authenticated user; supports `?unread=true` |
| `src/app/api/notifications/[id]/read/route.ts` | `PATCH` mark notification read |
| `src/app/api/notifications/read-all/route.ts` | `PATCH` mark all notifications read for authenticated user (MR-12) |
| `src/app/api/categories/route.ts` | `GET` category tree; `POST` create category |
| `src/app/api/categories/reorder/route.ts` | `PATCH` atomic sibling reorder with `parent_category_id` validation (RISK-05) |
| `src/app/api/categories/[id]/route.ts` | `PATCH` rename/move; `DELETE` (guard: no children) |
| `src/app/api/preferences/route.ts` | `GET` mem0 preferences by scope; `DELETE` clear scope (RISK-06) |
| `src/app/api/users/route.ts` | `GET` users for company (admin); `POST` create user — active, no email invite in MVP (RISK-10) |
| `src/app/api/users/[id]/route.ts` | `PATCH` update role; `DELETE` remove user |
| `src/app/api/companies/[id]/route.ts` | `PATCH` update company name |
| `src/app/api/companies/[id]/data/route.ts` | `DELETE` cascade company data deletion (admin only) |
| `src/app/api/clients/route.ts` | `GET` paginated clients; `POST` create client (MR-03) |
| `src/app/api/clients/[id]/route.ts` | `GET` single client; `PATCH` update; `DELETE` remove (MR-03) |
| `src/app/api/observations/merge/route.ts` | `POST` merge observations to canonical key/label (RISK-11) |

**New source files — UI pages:**

| File | Responsibility |
|------|----------------|
| `src/app/(app)/page.tsx` | Dashboard RSC shell — fetches `GET /api/dashboard/summary` server-side |
| `src/app/(app)/settings/page.tsx` | Settings root — company name, preferences section |
| `src/app/(app)/settings/users/page.tsx` | User management table (admin only) |
| `src/app/(app)/settings/categories/page.tsx` | Category tree manager |

**New source files — UI components:**

| File | Responsibility |
|------|----------------|
| `src/components/dashboard/DashboardSummaryCards.tsx` | STATUS count cards + recent documents + recent reports |
| `src/components/dashboard/PipelineStatusBar.tsx` | Horizontal stacked bar showing `documents_by_status` counts |
| `src/components/dashboard/OnboardingWelcomeCard.tsx` | First-run welcome card — shown when `total_documents = 0` |
| `src/components/notifications/NotificationBell.tsx` | Bell icon with unread badge; dropdown list; marks read on click |
| `src/components/notifications/NotificationItem.tsx` | Single notification row renderer — dispatches by `type` |
| `src/components/categories/CategoryTreeManager.tsx` | Root dnd-kit `DndContext` + `SortableContext`; hosts `CategoryNode` list |
| `src/components/categories/CategoryNode.tsx` | Single draggable/sortable node with expand/collapse, rename, delete actions |
| `src/components/categories/CategoryNodeForm.tsx` | Create/rename dialog (shadcn `Dialog` + `Form`) |
| `src/components/settings/CompanyNameForm.tsx` | Inline edit for company name |
| `src/components/settings/PreferencesSection.tsx` | Shows current mem0 preferences; "Effacer les préférences" delete button |
| `src/components/settings/UserTable.tsx` | Paginated table of users; invite button; role select; remove action |
| `src/components/settings/InviteUserDialog.tsx` | Modal form: email + role select; calls `POST /api/users` |
| `src/components/ui/StatusSkeleton.tsx` | Generic content-shape skeleton; parameterised by page type |
| `src/components/ui/EmptyState.tsx` | Shared empty state: illustration + text + optional CTA |
| `src/components/ui/ErrorAlert.tsx` | Red destructive `Alert` with message + retry / contact-support action |
| `src/components/providers/OnboardingProvider.tsx` | Three-step tooltip sequence; localStorage persistence per user |

**Modified files:**

| File | Change |
|------|--------|
| `src/app/(app)/layout.tsx` | Add `OnboardingProvider` wrapping; confirm `AnimatePresence` page transitions wired |
| `src/components/layout/Sidebar.tsx` | Role-guard: hide Settings link for `viewer`; hide Chat/Conflicts for `viewer` |
| `src/components/layout/TopBar.tsx` | Wire `NotificationBell` to `GET /api/notifications` + pipeline SSE `notification` events |
| `src/middleware.ts` | Add rate-limiting check (100 req/min per `user_id`; Redis `INCR` + `EXPIRE`; excludes `/api/auth/*`, `/login`) (MR-16) |

**New shared files:**

| File | Responsibility |
|------|----------------|
| `src/lib/middleware/rate-limit.ts` | Rate limiter: sliding window counter via Redis `INCR`/`EXPIRE`; returns `429` with `Retry-After` header on limit exceeded (MR-16) |

---

#### §6.2 Dashboard Summary API

**`GET /api/dashboard/summary`**

Response shape:
```json
{
  "documents_by_status": {
    "uploaded": 0,
    "ocr_processing": 1,
    "ocr_done": 0,
    "embedding": 0,
    "embedded": 0,
    "extracting": 2,
    "review_ready": 14,
    "failed": 1
  },
  "unresolved_conflict_count": 3,
  "recent_documents": [ /* 5 most recent Document records */ ],
  "recent_reports":  [ /* 5 most recent Report records, no html_snapshot_url */ ]
}
```

- All `PipelineStatus` keys are always present; value is `0` when no documents have that status.
- `recent_documents` sort: `created_at DESC`, limit 5; fields: `document_id, title, detected_type, category_id, created_at`.
- `recent_reports` sort: `generated_at DESC`, limit 5; fields: `report_id, version, status, language, generated_at` — no presigned URLs.
- `unresolved_conflict_count`: COUNT of `ConflictCase` rows where `resolution_status != 'user_overridden'` for the company.
- All queries are scoped to `ctx.companyId` via `withTenant`.
- No pagination — this is a fixed-size summary. Response is not cached (reads are fast aggregation queries).

---

#### §6.3 Dashboard Page UI

File: `src/app/(app)/page.tsx` (RSC)

**Server-side fetch:** Calls `GET /api/dashboard/summary` at render time (Next.js RSC, no client-side fetch for initial data).

**Layout:**
```
[ OnboardingWelcomeCard OR PipelineStatusBar + DashboardSummaryCards ]
[ Recent Documents table  |  Recent Reports table ]
```

- **First-run state:** If `sum(documents_by_status.values()) = 0` → render `OnboardingWelcomeCard` with upload CTA. Card disappears permanently once total > 0.
- **Pipeline SSE subscription:** `PipelineSSEProvider` (already built in Slice 2) is mounted on the dashboard; `pipeline_stage_changed` events update the `documents_by_status` counts in local state without a full re-fetch. **Additionally, a `useEffect` in the dashboard client wrapper calls `router.refresh()` (Next.js App Router) on `pipeline_stage_changed`, `notification`, and `conflict_detected` SSE events to re-trigger the RSC server-side fetch and keep the summary cards, recent documents, and recent reports tables in sync (MR-29).** The `router.refresh()` call is debounced to at most once per 2 seconds to avoid excessive re-renders during rapid pipeline transitions.
- **Conflict badge:** Sidebar `ConflictsBadge` component (already present from Slice 4) receives `unresolved_conflict_count` from the summary; updates via the pipeline SSE `conflict_detected` event.
- **Loading state:** `StatusSkeleton` variant `dashboard` — renders 2 row-shaped card skeletons + 2 table skeletons.
- **Error state:** `ErrorAlert` with « Impossible de charger le tableau de bord. Réessayez. »

---

#### §6.4 Notification Bell + Notifications API

**`GET /api/notifications`**
- Query params: `?unread=true` (boolean), `?sort=created_at:desc` (default), pagination.
- Returns paginated `Notification[]`; fields: `notification_id, type, payload, read, created_at, user_id`.
- Scoped to `ctx.companyId`; if `user_id` is non-null on the record, also filter by `ctx.userId` (user-specific notifications only shown to that user; company-wide notifications shown to all).

**`PATCH /api/notifications/{id}/read`**
- Sets `Notification.read = true`.
- Response: `{ notification_id, read: true }`.
- Returns `404` if notification not found or belongs to another company.

**`PATCH /api/notifications/read-all`** (MR-12)
- Sets `Notification.read = true` for all unread notifications belonging to `ctx.userId` within `ctx.companyId`.
- Response: `{ updated_count: number }`.
- Idempotent — returns `{ updated_count: 0 }` if no unread notifications exist.

**`NotificationBell.tsx` behaviour:**
- Initial unread count: fetched from `GET /api/notifications?unread=true` (returns total count).
- Live updates: pipeline SSE `notification` event increments badge count and prepends item to dropdown.
- Dropdown opens on click; shows last 20 notifications (mix of read/unread); « Tout marquer comme lu » button calls `PATCH /api/notifications/read-all` (single request, not per-item).
- Notification item rendering by `type`:
  - `pipeline_completed` → « Document « [title] » traité — [n] observations extraites »
  - `pipeline_failed` → « Échec du traitement de « [title] » — [reason] »
  - `conflict_detected` → « [n] nouveau(x) conflit(s) pour [key] »
  - `report_ready` → « Rapport « [title] » prêt — Consulter / Télécharger »
  - `manual_obs_requested` → « Saisie requise : [label] »
- Sonner toast also fires on `notification` SSE event (5 s auto-dismiss for success/info; persistent for error).

---

#### §6.5 Category Management API (RISK-05 Resolved)

**`GET /api/categories`**
- Returns nested tree: `{ categories: CategoryNode[] }` where each `CategoryNode` is `{ category_id, name, path, parent_category_id, sort_order, children: CategoryNode[] }`.
- Sorted by `sort_order ASC` at each level.

**`POST /api/categories`**
- Body: `{ name: string (max 100), parent_category_id?: UUID | null }`
- Guard: traverse parent chain — if depth would exceed 5 levels, return `422` with `{ code: "max_depth_exceeded", max: 5 }`.
- Response: `{ category_id, name, path, parent_category_id, sort_order }`.
- `path` computed synchronously: parent's `path` + ` / ` + `name` (or just `name` for root).
- `sort_order` = `MAX(sort_order) + 1` among siblings.

**`PATCH /api/categories/{id}`**
- Body: `{ name?: string, parent_category_id?: UUID | null }`
- On rename: update `path` for self and all descendants in same transaction.
- On move (parent change): recompute `path` for self and all descendants; update `sort_order` to `MAX + 1` in new parent; validate new depth ≤ 5.
- Response: `{ category_id, name, path, parent_category_id, sort_order }`.

**`DELETE /api/categories/{id}`**
- Guard: if any child categories exist → `409` with `{ code: "has_children" }`.
- Guard: if any documents are assigned to this category → `409` with `{ code: "has_documents", count: N }`.
- On success: `204 No Content`.

**`PATCH /api/categories/reorder`** (RISK-05 resolved)
- Body: `{ ordered_ids: UUID[], parent_category_id: UUID | null }`
- `parent_category_id` is **required** — nullable for root-level siblings.
- Validation: fetch all `ordered_ids` from DB; verify every record has `parent_category_id` matching the request value. If any mismatch → `422` with `{ code: "mixed_parents" }`.
- On success: atomically set `sort_order = array_index` for each ID in the ordered list (within a single DB transaction).
- Response: `{ updated_count: N }`.

---

#### §6.6 Category Tree UI

File: `src/components/categories/CategoryTreeManager.tsx`

**dnd-kit integration:**
- `DndContext` with `PointerSensor` (activation distance 8px to avoid accidental drags).
- `SortableContext` per sibling group (flat list of sibling IDs at each nesting level).
- `useSortable` in `CategoryNode.tsx`; drag handle icon on each node.
- On drag end: optimistic reorder (update local tree state immediately) + debounced `PATCH /api/categories/reorder` after 400 ms idle. If server returns `422` → revert to pre-drag order + show `ErrorAlert`.
- `ordered_ids` sent in the request is the full new sibling order for the affected level; `parent_category_id` is the parent of the moved node (RISK-05 body field included).

**CRUD flows:**
- Create: « + Nouvelle catégorie » button per node → `CategoryNodeForm` dialog → `POST /api/categories` → optimistic append.
- Rename: edit icon → inline `CategoryNodeForm` pre-filled → `PATCH /api/categories/{id}`.
- Delete: trash icon → `ConfirmDialog` (« Supprimer cette catégorie ? ») → `DELETE /api/categories/{id}` → if `409 has_children`, show reassignment prompt instead.
- Max depth guard: « + » button disabled and tooltip shows « Profondeur maximale atteinte (5 niveaux) » when current depth = 5.

---

#### §6.7 Preferences API (RISK-06 Resolved)

**`GET /api/preferences`**
- Query param: `?scope=user:{user_id}:company:{company_id}` OR `?scope=user:{user_id}:company:{company_id}:client:{client_id}` (optional; defaults to `user:{ctx.userId}:company:{ctx.companyId}`).
- Reads mem0 by scope key. On mem0 timeout (3 s): returns `{ preferences: {} }` (graceful degradation).
- Response: `{ scope, preferences: { language?, tone?, layout?, section_order?, style_rules? } }`.

**`DELETE /api/preferences`** (RISK-06 resolved)
- Query param: `?scope=` (optional string; when omitted, deletes all scopes for `ctx.userId + ctx.companyId`).
- Valid scope format: `user:{uuid}:company:{uuid}` or `user:{uuid}:company:{uuid}:client:{uuid}`.
- Validates that the scope's `user_id` matches `ctx.userId` (users cannot delete other users' preferences).
- Calls mem0 delete API for the specified scope(s).
- Response: `204 No Content`.
- On mem0 timeout: log failure, return `503` with `{ code: "mem0_unavailable" }`.

**`PreferencesSection.tsx` behaviour:**
- Displays current preferences as a read-only key-value list (language, tone, layout, style_rules count).
- « Effacer les préférences » button → `ConfirmDialog` → `DELETE /api/preferences` with no scope param (deletes all) → toast « Préférences effacées ».
- Empty state when `preferences = {}`: « Aucune préférence enregistrée. Les préférences sont apprises automatiquement lors de la génération de rapports. »

---

#### §6.8 User Management API (RISK-10 Resolved)

**MVP decision (RISK-10 resolved):** No invitation email flow in MVP. `POST /api/users` creates the user as immediately active (no `status: pending` field on User entity). Auth is via Auth.js; the created user authenticates via OAuth/social login with the specified email address. A note is shown in the UI: « L'utilisateur peut se connecter avec son adresse e-mail via l'écran de connexion. »

**`GET /api/users`** (admin only)
- Returns paginated `User[]` for `ctx.companyId`; fields: `user_id, email, role, created_at`.
- Returns `403` for non-admin sessions.

**`POST /api/users`** (admin only)
- Body: `{ email: string (valid email), role: "editor" | "viewer" }`
- Guard: if email already belongs to an active user in this company → `409` with `{ code: "email_already_exists" }`.
- Guard: if email already belongs to a user in a different company → `409` with `{ code: "email_belongs_to_other_company" }` (no cross-company user sharing in MVP).
- Creates `User` record with `company_id = ctx.companyId`, `role`, UUIDv7 `user_id`.
- Response: `{ user_id, email, role, created_at }` with HTTP `201`.
- Returns `403` for non-admin sessions.

**`PATCH /api/users/{id}`** (admin only)
- Body: `{ role: "admin" | "editor" | "viewer" }`
- Guard: admin cannot demote themselves (would result in no admin). If this is the last admin → `422` with `{ code: "last_admin" }`.
- Response: updated `User` record.

**`DELETE /api/users/{id}`** (admin only)
- Guard: same last-admin check as above → `422` `last_admin`.
- Removes user from company. Does not delete their chat sessions or authored observations (audit integrity).
- Response: `204 No Content`.

---

#### §6.9 Company Settings API

**`PATCH /api/companies/{id}`** (admin only)
- Body: `{ name?: string (min 1, max 100) }`
- Guard: `company_id` in path must match `ctx.companyId`.
- Response: `{ company_id, name, updated_at }`.
- Returns `403` for non-admin sessions.

---

#### §6.9a Client CRUD API (MR-03)

**`GET /api/clients`**
- Returns paginated `Client[]` scoped to `ctx.companyId`.
- Query params: `?search=string` (filters by name, case-insensitive `ILIKE`), pagination (`page`, `pageSize`).
- Response: `{ data: Client[], total, page, pageSize }`.

**`POST /api/clients`**
- Body: `{ name: string (min 1, max 200), description?: string (max 1000) }`
- Auth: `editor` or `admin`.
- Response `201`: `{ client_id, company_id, name, description, created_at }`.

**`GET /api/clients/{id}`**
- Response: `{ client_id, company_id, name, description, created_at, updated_at }`.
- `404` if client not found or belongs to another company (RLS).

**`PATCH /api/clients/{id}`**
- Body: `{ name?: string, description?: string }`
- Auth: `editor` or `admin`.
- Response: `{ client_id, name, description, updated_at }`.

**`DELETE /api/clients/{id}`**
- Auth: `admin` only.
- Guard: if any reports reference this `client_id` → `409` with `{ code: "has_reports", count: N }`.
- On success: `204 No Content`.

---

#### §6.10 Observation Merge REST Endpoint (RISK-11 Resolved)

**`POST /api/observations/merge`**
- Body: `{ observation_ids: UUID[] (min 2), canonical_label: string (min 1, max 200), canonical_normalized_key: string (snake_case, max 100) }`
- Guards:
  - All `observation_ids` must belong to `ctx.companyId` → `403` on any mismatch.
  - All `observation_ids` must have `status = approved` → `422` with `{ code: "non_approved_observations", ids: [...] }`.
- Behaviour: update `label` and `normalized_key` on all listed observations; create one `AuditLog` entry per updated observation.
- Response: `{ updated_count: number, canonical_normalized_key: string }`

---

#### §6.11 Company Data Deletion API

**`DELETE /api/companies/{id}/data`** (admin only)
- Guard: `company_id` in path must match `ctx.companyId`.
- Behaviour (sequential, in a transaction or choreographed):
  1. Write one final `AuditLog` record: `{ action: "company_data_deletion_initiated", actor_id: ctx.userId }`.
  2. Delete in dependency order: ChatMessages → ChatSessions → PendingManualObservations → ConflictResolutions → ConflictCases → DerivationResults → Reports → AttestationRecords → Observations → EvidenceBlocks → DocumentVersions → Documents → DocumentCategories → Notifications → AuditLogs (except the deletion record) → PreferenceMemoryPointers → Users (except the requesting admin).
  3. Call mem0 delete API for all scopes matching `company:{company_id}*`.
  4. Delete all R2 objects with prefix `{company_id}/` (S3 batch delete).
  5. Returns `202 Accepted` immediately; actual deletion runs as a background BullMQ job so as not to timeout a large company.
- AuditLogs for the deletion event are retained (minimum 2 years; immutable).
- On completion: a final `Notification` is created for the admin user confirming deletion.

---

#### §6.12 Settings Page UI

File: `src/app/(app)/settings/page.tsx`

- **Access guard:** redirect to `/` with toast « Accès non autorisé » for `viewer` role (checked in the RSC shell or middleware).
- **Sections (tab or section-list layout):**
  - **Entreprise:** `CompanyNameForm` → `PATCH /api/companies/{id}`.
  - **Préférences:** `PreferencesSection` → `GET/DELETE /api/preferences`.
  - **Équipe (admin only):** `UserTable` (invite, role change, remove).
  - **Catégories (editor+):** Link to `/settings/categories`.
  - **Zone de danger (admin only):** `DELETE /api/companies/{id}/data` with triple-confirm pattern (type company name to confirm).

**`UserTable.tsx` behaviour:**
- Paginated list of users (no SSE; polling not needed — low-frequency data).
- Role select dropdown per row → `PATCH /api/users/{id}` → optimistic update; rollback on error.
- Remove button → `ConfirmDialog` → `DELETE /api/users/{id}` → optimistic removal from list.
- « Inviter un utilisateur » button → `InviteUserDialog` → `POST /api/users` → optimistic append.
- Empty state: « Votre équipe ne compte qu'un seul membre. Invitez des collaborateurs. »
- Note display: « Les utilisateurs invités peuvent se connecter directement avec leur adresse e-mail. »

---

#### §6.13 Onboarding / First-Run Experience

File: `src/components/providers/OnboardingProvider.tsx`

**Three-step tooltip sequence (displayed once per user, state persisted in `localStorage` key `reportflow:onboarding:{user_id}`):**

| Step | Trigger | Tooltip text | Target element |
|------|---------|-------------|----------------|
| 1 | First login with no documents | Welcome card (full card, not tooltip) | `/` dashboard — `OnboardingWelcomeCard` |
| 2 | First `extraction_complete` SSE event received | Tooltip | Sidebar « Conflits » link — « Vérifiez et approuvez vos observations extraites. » |
| 3 | First report generated (`report_ready` SSE event) | Tooltip | Chat input bar — « Essayez de dire 'Rends-le plus concis' pour personnaliser le style. » |

**Implementation notes:**
- `OnboardingProvider` wraps the root `(app)/layout.tsx` client component.
- It reads `localStorage` on mount to determine which steps are already dismissed.
- Tooltips use shadcn `Tooltip` + a small dismiss button (✕). Dismissed step → set localStorage flag → tooltip never shown again.
- Step 2 and 3 tooltips are shown even if the user navigates away; they appear attached to the target on next visit to that page.

---

#### §6.14 Global UI Polish

**Empty states — applied to every list/page:**

| Page / State | French empty state text | CTA |
|---|---|---|
| Documents list (no docs) | « Aucun document importé. » | « Importer un document » |
| Observations list (no results) | « Aucune observation trouvée. » | Clear filters |
| Conflicts inbox (all resolved) | « Aucun conflit non résolu. » | — |
| Reports list (no reports) | « Aucun rapport généré. Commencez par discuter avec l'agent. » | « Ouvrir le chat » |
| Chat (new session) | Welcome + 3 suggested prompts | — |
| Notifications (none) | « Aucune notification. » | — |
| Users (one user) | « Votre équipe ne compte qu'un seul membre. » | « Inviter » |
| Categories (empty tree) | « Aucune catégorie créée. » | « Créer une catégorie » |

**Loading skeletons (`StatusSkeleton.tsx`):**
- Parameterised by `variant`: `dashboard | documents-list | observation-list | report-detail | chat | settings`.
- Each variant renders a content-shape skeleton (shadcn `Skeleton` components) matching the target page layout.
- Applied via React `Suspense` boundaries in RSC shells.
- No full-page spinners; skeleton matching content shape at all times.

**Error states:**
- `ErrorAlert.tsx`: shadcn `Alert` with `variant="destructive"`, error message, and one of:
  - « Réessayer » button (refetch action)
  - « Contacter le support » link for unrecoverable errors
- Applied consistently: every `useQuery`/`useSWR` error path renders `ErrorAlert` inline (not a modal).

**Framer Motion page transitions:**
- `AnimatePresence` in `(app)/layout.tsx` wraps the page slot.
- All pages use `motion.div` with `initial={{ opacity: 0, y: 8 }}`, `animate={{ opacity: 1, y: 0 }}`, `exit={{ opacity: 0 }}`, `transition={{ duration: 0.18 }}`.
- No layout shift: `AnimatePresence mode="wait"` ensures previous page exits before new page enters.

**Sonner toasts:**
- Success: 5 s auto-dismiss.
- Error: persists until dismissed.
- Warning (e.g., stale derivation): 8 s auto-dismiss.
- Toast position: `bottom-right`.

**Sidebar responsiveness:**
- `< lg` breakpoint: sidebar collapses to icon-only (icon + tooltip on hover).
- Full bottom tab bar is post-MVP.

**Role-guards (sidebar):**
- `viewer`: hidden = Chat link, Conflits link, Settings link.
- `editor`: hidden = Settings link (except `/settings/categories`).
- `admin`: all items visible.

**French copy pass — all strings confirmed in French:**
- Navigation labels (Tableau de bord, Documents, Observations, Rapports, Chat, Conflits, Paramètres)
- Pipeline status badges (Importé, OCR en cours…, Intégré, Extraction…, À réviser, Échec)
- Toast messages (all defined in a `src/lib/messages/fr.ts` constants file)
- All `EmptyState` texts
- All form validation errors (Zod `.message()` calls all use French strings)
- All `ConfirmDialog` body text
- All ARIA labels on interactive elements

---

#### §6.15 Accessibility

- `ManualObsPopup`: focus trap (`dialog` role + `aria-modal="true"`); `Escape` key → skip + close (calls `POST .../skip`).
- `ReviewQueueTabs`: keyboard navigation — arrow keys move between tabs (`role="tablist"` + `role="tab"`).
- `NotificationBell`: `aria-label="Notifications (N non lues)"` updated on count change; `aria-live="polite"` region for new notification announcements.
- `CategoryTreeManager`: `aria-grabbed` / `aria-dropeffect` attributes on dnd-kit drag handles.
- All icon-only buttons include `aria-label` (no empty `<button>` elements).
- Skip-to-main-content link at top of layout for screen readers.

---

#### §6.16 Validation

| Route | Key rules |
|-------|-----------|
| `POST /api/categories` | `name` required, max 100 chars; depth ≤ 5 |
| `PATCH /api/categories/reorder` | `ordered_ids` non-empty array; `parent_category_id` required (nullable); all IDs must share same parent |
| `DELETE /api/categories/{id}` | No children; no assigned documents |
| `POST /api/users` | Valid email format; `role` enum; admin session |
| `PATCH /api/users/{id}` | `role` enum; last-admin guard |
| `DELETE /api/preferences` | Scope string must match pattern `user:{uuid}:company:{uuid}(:client:{uuid})?`; scope user must match ctx.userId |
| `POST /api/observations/merge` | `observation_ids` min 2; all must be `approved`; all must belong to ctx.companyId; `canonical_normalized_key` snake_case |
| `DELETE /api/companies/{id}/data` | `company_id` in path must match `ctx.companyId`; admin session |

---

#### §6.17 Security

- **Admin-only routes:** `GET/POST /api/users`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}`, `PATCH /api/companies/{id}`, `DELETE /api/companies/{id}/data` — return `403` for non-admin sessions. Check is performed at the route handler entry, before any DB queries.
- **Category reorder CSRF:** `PATCH /api/categories/reorder` validates `parent_category_id` server-side (RISK-05); client cannot silently corrupt sibling ordering across trees.
- **Preferences scope isolation:** `DELETE /api/preferences` validates that the scope's `user_id` segment matches `ctx.userId`. A user cannot delete another user's preferences even within the same company.
- **Data deletion confirmation:** `DELETE /api/companies/{id}/data` requires double confirmation at the API level (a `confirm: true` boolean field in the request body, in addition to the admin role check). UI adds a type-company-name confirmation step.
- **Observation merge scope:** `POST /api/observations/merge` validates that all `observation_ids` belong to `ctx.companyId` before writing. Cross-company merge is structurally impossible.
- **Last-admin guard:** Enforced on `PATCH /api/users/{id}` (role demotion) and `DELETE /api/users/{id}`. Prevents lock-out. Returns `422` with `{ code: "last_admin" }` in both cases.
- **Rate limiting (MR-16):** All authenticated API routes are rate-limited to **100 requests/minute per `user_id`**. Implemented in `src/lib/middleware/rate-limit.ts` using Redis `INCR` + `EXPIRE` (sliding window counter). On limit exceeded: HTTP `429 Too Many Requests` with `Retry-After` header (seconds until window reset). Applied in `src/middleware.ts` before route resolution — runs after auth check so that `user_id` is available as the rate-limit key. Unauthenticated routes (`/api/auth/*`, `/login`) are excluded. SSE endpoints (`/api/pipeline/events`, `/api/chat/sessions/*/stream`) count the initial connection as 1 request (not per-event).

---

#### §6.18 Testing Strategy

**Unit tests (Vitest):**
- `categories/reorder` handler: test `mixed_parents` detection with DB mock returning mixed records.
- `users` handler: test `last_admin` guard with a company that has exactly one admin.
- `preferences` DELETE handler: test scope pattern validation rejects malformed strings; test cross-user scope rejection.
- `observations/merge`: test `non_approved_observations` error path; test audit log creation count.
- `dashboard/summary`: test all `PipelineStatus` keys present even when counts are zero.

**Integration tests (`@testcontainers/postgresql` + Redis):**
- Category reorder: `POST` two sibling categories → `PATCH reorder` with reversed `ordered_ids` → `GET /api/categories` confirms new `sort_order`.
- Category max depth: create 5 nested categories → attempt 6th → `422 max_depth_exceeded`.
- User invite + role change + delete: full lifecycle in one test.
- Preferences: write via mem0 mock → `GET /api/preferences` returns written prefs → `DELETE /api/preferences` → `GET` returns `{}`.
- Merge observations: approve 2 obs → `POST /api/observations/merge` → confirm both have new key/label → confirm 2 AuditLog rows exist.
- Dashboard: ensure `documents_by_status` has all 8 keys and `unresolved_conflict_count` matches actual conflict rows.

**E2E (Playwright):**
- Settings page: admin invites new user → user appears in table → admin changes role to viewer → admin removes user.
- Category manager: drag node to new position → confirm visual reorder + network request with correct `ordered_ids`.
- Dashboard onboarding: first login (no docs) → welcome card visible → upload doc → card disappears on next navigation.
- Notification bell: trigger pipeline completion → badge count increments → click bell → notification visible → click item → `read` flag set.

---

#### §6.19 Edge Cases

| Case | Handling |
|------|----------|
| Admin tries to delete themselves | `DELETE /api/users/{id}` where `id = ctx.userId` → `422` with `{ code: "cannot_delete_self" }` |
| Category rename makes path exceed DB column limit | Max path length guard: if computed `path` would exceed 500 chars → `422` with `{ code: "path_too_long" }` |
| dnd-kit drag during in-flight reorder request | Disable drag during in-flight debounce window; restore on response |
| `PATCH /api/categories/reorder` partial ID list | If `ordered_ids` is a subset of siblings, only those siblings' `sort_order` values are updated; remaining siblings retain their previous order (partial reorder is valid) |
| mem0 unavailable during `GET /api/preferences` | Return `{ preferences: {} }` and `200`; do not surface 503 to the user |
| mem0 unavailable during `DELETE /api/preferences` | Return `503` with `{ code: "mem0_unavailable" }` — deletion cannot be confirmed as complete |
| `DELETE /api/companies/{id}/data` on a large company (1000+ documents) | BullMQ job runs in background; route returns `202` immediately. Progress visible via a new `data_deletion_progress` notification event |
| Notification bell SSE receives event for a user who has just deleted all notifications | Prepend new item to empty dropdown; badge shows 1 |
| `POST /api/users` for an email already in another company | `409 email_belongs_to_other_company` — do not leak which company owns the email in the error message body |

---

#### §6.20 Acceptance Criteria

- [ ] `GET /api/dashboard/summary` returns all 8 `PipelineStatus` keys in `documents_by_status` (values `0` when no documents exist for that status).
- [ ] Dashboard shows `OnboardingWelcomeCard` when no documents exist; card is absent after first document upload.
- [ ] `PATCH /api/categories/reorder` with `ordered_ids` from mixed parents returns `422` with `{ code: "mixed_parents" }`.
- [ ] `DELETE /api/categories/{id}` with children returns `409 has_children`; with no children returns `204`.
- [ ] Category `path` is correct for all descendants immediately after a rename or move (synchronous in same transaction).
- [ ] `DELETE /api/preferences?scope=user:{id}:company:{id}` returns `204`; subsequent `GET /api/preferences` returns `{ preferences: {} }`.
- [ ] `DELETE /api/preferences` without `?scope=` deletes all scopes for `ctx.userId + ctx.companyId`.
- [ ] `POST /api/users` (admin) returns `201` with `{ user_id, email, role, created_at }`; non-admin returns `403`.
- [ ] `PATCH /api/users/{id}` to demote the last admin returns `422` with `{ code: "last_admin" }`.
- [ ] `POST /api/observations/merge` with a non-approved observation in `observation_ids` returns `422 non_approved_observations`.
- [ ] `POST /api/observations/merge` success: both observations reflect `canonical_normalized_key`; two `AuditLog` rows created.
- [ ] Category dnd-kit drag: `PATCH /api/categories/reorder` called exactly once per drag (after 400 ms debounce) with correct `parent_category_id` and `ordered_ids`.
- [ ] Notification bell badge increments within 2 s of `notification` SSE event; clicking the notification marks it `read`.
- [ ] All 8+ page routes render a content-shape skeleton during loading (no full-page spinner visible).
- [ ] All user-facing strings are in French (zero English strings in normal operation).
- [ ] `ManualObsPopup` focus trap: `Tab` cycles through fields; `Escape` calls `POST .../skip` and closes the dialog.

---

#### §6.21 Verification Checklist

```
[ ] tsc --noEmit passes across entire src/ and workers/
[ ] vitest run: all unit tests pass (including last_admin guard, mixed_parents, depth guard)
[ ] GET /api/dashboard/summary returns { documents_by_status: { uploaded:0, ..., review_ready:0, ... } } on fresh DB
[ ] PATCH /api/categories/reorder with mixed parent IDs returns 422 { code: "mixed_parents" }
[ ] DELETE /api/preferences?scope=user:X:company:Y returns 204; GET /api/preferences returns {}
[ ] POST /api/users as non-admin returns 403; as admin returns 201
[ ] PATCH /api/users/{last_admin_id} with role: "editor" returns 422 { code: "last_admin" }
[ ] POST /api/observations/merge success → GET /api/observations/{id} reflects new normalized_key
[ ] Playwright: dashboard shows welcome card on first login; disappears after upload
[ ] Playwright: drag category reorder → exactly 1 network request to PATCH /api/categories/reorder with correct body
[ ] Playwright: notification bell badge increments on pipeline SSE notification event
[ ] Playwright: settings page inaccessible as viewer (redirect + toast)
[ ] Lighthouse accessibility score ≥ 90 on /documents and /chat pages
```

---

