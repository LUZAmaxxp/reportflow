# ReportFlow

A proof-first ESG/RSE reporting platform for SMEs. ReportFlow ingests company documents (PDFs, images) through a multi-stage pipeline — OCR → chunking → embedding → LLM extraction — storing every extracted fact as a fully traceable **Observation** backed by atomic **EvidenceBlocks**. A tool-calling AI agent then answers ESG questions and generates ISO 26000-style reports strictly from governed data, with no hallucinated facts.

---

## Architecture Overview

ReportFlow is split into two planes that share a PostgreSQL database but execute independently:

**Plane A — Data Plane (ingestion & facts)**

```
Upload (R2) → BullMQ OCR job → PaddleOCR → EvidenceBlocks (pgvector)
           → BullMQ Embedding job → OpenAI text-embedding-3-small
           → BullMQ Extraction job → Grok LLM → Candidate Observations
           → Conflict detection (exact + semantic cosine similarity)
           → User review UI → Approved Observations
```

**Plane B — Agent Plane (Q&A & report generation)**

```
Chat message → Agentic loop (Grok + MCP tool schemas)
             → tool calls: search_observations, get_derivation, fetch_evidence_block, …
             → structured answer / HTML report → Puppeteer PDF
```

The agent **never reads raw documents** and never performs extraction directly. It only calls typed tools that query the already-governed facts layer.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Database | PostgreSQL with `pgvector`, `pg_trgm`, `pgcrypto`, `uuid-ossp` |
| ORM / Migrations | Drizzle ORM, 11 sequential SQL migrations via `drizzle-kit` |
| Job Queue | BullMQ 5 backed by Redis (ioredis) |
| Object Storage | Cloudflare R2 (S3-compatible, `@aws-sdk/client-s3`) |
| OCR | PaddleOCR (external HTTP API) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim vectors) |
| Agent LLM | xAI Grok (`XAI_API_KEY`) via OpenAI-compatible chat completions API |
| Agent Memory | mem0 (persistent tone/layout/language preferences per company) |
| Auth | NextAuth v5 (credentials provider, bcryptjs, JWT sessions) |
| PDF Rendering | Puppeteer (HTML snapshot → PDF) |
| UI | shadcn/ui, Radix UI, Tailwind CSS v4, Framer Motion |
| Testing | Vitest (unit), Playwright (E2E), Testcontainers PostgreSQL |

---

## Data Model

The fact hierarchy flows from raw file to final output:

```
Company
└── DocumentCategory (max 5-level nested tree, materialized path)
    └── DocumentVersion (immutable file record, R2 key)
        └── EvidenceBlock (OCR block: page, bbox float[4], text, embedding vector(1536))
            └── Observation (extracted or attested fact; carries label, normalized_key,
                             value, numeric_value, unit, data_type, time_behavior,
                             period_start/end, confidence_score, status)
                └── DerivationResult (on-demand: sum/average/delta/ratio/count over
                                      explicit observation_id sets)
Report (HTML snapshot + PDF; references observations and derivations)
```

All primary keys are **UUIDv7** (time-sortable, collision-free across workers).  
Multi-tenancy is enforced via **PostgreSQL Row-Level Security** — every table with a `company_id` foreign key carries an RLS policy that binds reads and writes to the authenticated tenant context.

### Observation lifecycle

```
candidate → approved → superseded
          → rejected
          → invalidated
```

Observations are immutable once approved. Conflict detection runs as a BullMQ job after each extraction and flags pairs sharing the same `normalized_key` (exact match) or whose label embeddings exceed a cosine similarity threshold (semantic match). Users resolve conflicts in a dedicated UI; resolution is recorded with `conflict_resolution_status ∈ {auto_resolved, user_reviewed, user_overridden}`.

---

## Ingestion Pipeline

Each uploaded document advances through a typed state machine:

```
uploaded → ocr_processing → ocr_done → embedding → embedded
         → extracting → review_ready → (user approves) → done
         failed (any stage)
```

State transitions are driven by **BullMQ jobs** in `workers/pipeline/jobs/`:

| Job | Description |
|---|---|
| `ocr.ts` | Sends page images to PaddleOCR; persists `EvidenceBlock` rows with bbox, text, and `ocr_confidence` |
| `embedding.ts` | Calls OpenAI embeddings API; writes `vector(1536)` back to each block |
| `extraction.ts` | Constructs a ranked RAG context from the top-k evidence blocks (pgvector cosine search); prompts Grok with a soft reference key list; parses structured `Observation` candidates |
| `semanticConflict.ts` | Runs post-extraction conflict detection; uses pgvector similarity on observation-label embeddings |
| `pending-obs-timeout.ts` | Cron job that expires unconfirmed manual observation requests after a configurable TTL |
| `agent-loop.ts` | Executes a single agentic loop turn for report generation background jobs |
| `company-deletion.ts` | Cascades company data deletion in safe topological order |

The worker process (`workers/pipeline/index.ts`) runs independently from the Next.js server via `tsx` and maintains its own database connection pool (`workers/pipeline/db.ts`).

---

## Chunking Strategy

Before embedding, raw OCR blocks undergo a token-aware chunking pass (`src/lib/chunking/`):

- **Merge**: adjacent short blocks (same semantic region, combined token count ≤ threshold) are fused into a single `chunk_type = merged` block; `merged_block_ids[]` records provenance.
- **Split**: oversized blocks exceeding the token ceiling are divided; each child carries `parent_block_id → original block` and `chunk_type = split`.
- Original unmodified blocks carry `chunk_type = original`.

Token counting uses `tiktoken` with the `cl100k_base` encoding.

---

## Agentic Loop

The agent (`src/lib/agent/loop.ts`) is a **tool-calling ReAct loop**:

1. Append the user message to a session-scoped buffer.
2. Send buffer + tool schemas to Grok via the OpenAI-compatible `/v1/chat/completions` endpoint with `stream: true`.
3. If the model emits a `tool_calls` delta, execute the corresponding server-side tool handler (`src/lib/agent/tools.ts`).
4. Append the tool result as a `role: tool` message and repeat from step 2.
5. When the model emits a plain text response with no tool calls, stream tokens to the client via SSE and commit the final assistant message.

Available MCP tools: `search_observations`, `get_derivation`, `fetch_evidence_block`, `list_categories`, `get_report_context`, and `request_manual_observation`.

Agent memory (tone, preferred language, output format) is persisted per company in **mem0** and injected as a system-prompt prefix at loop start.

---

## Report Generation

Reports are produced as follows:

1. The agent assembles an HTML document referencing approved observations and derivation results.
2. The HTML is sanitized with `isomorphic-dompurify` before persistence.
3. A BullMQ job spawns a **Puppeteer** instance that loads the HTML (injected into a headless Chromium page) and calls `page.pdf()` to produce a print-optimized PDF.
4. The PDF is uploaded to R2; a signed URL is returned to the client.

---

## Environment Variables

All variables are validated at startup via a Zod schema in `src/lib/env.ts`. The build phase is excluded from validation (`NEXT_PHASE = phase-production-build`).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (BullMQ + session cache) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 credentials |
| `XAI_API_KEY` | xAI Grok API key (agent LLM) |
| `OPENAI_API_KEY` | OpenAI API key (embeddings) |
| `PADDLEOCR_TOKEN`, `PADDLEOCR_API_URL` | PaddleOCR service credentials |
| `MEM0_API_KEY` | mem0 agent memory API key |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | NextAuth session config |
| `PDF_WORKER_URL` | Internal URL for the PDF.js worker bundle |
| `NEXT_PUBLIC_APP_URL` | Public base URL (used for absolute links in reports) |
| `PUPPETEER_EXECUTABLE_PATH` | (Optional) Path to Chromium binary |

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ with `pgvector`, `pg_trgm`, `pgcrypto`, `uuid-ossp` extensions
- Redis 7+
- Cloudflare R2 bucket
- xAI, OpenAI, PaddleOCR, and mem0 API keys

### Install & run

```bash
npm install

# Apply all database migrations
npm run db:migrate

# Start the Next.js dev server
npm run dev

# In a separate terminal, start the BullMQ worker
npm run worker
```

### Tests

```bash
# Unit tests (Vitest)
npm test

# End-to-end tests (Playwright — requires a running dev server)
npm run test:e2e
```

---

## Database Migrations

Migrations live in `drizzle/migrations/` and are applied sequentially:

| File | Contents |
|---|---|
| `0001_foundation.sql` | Core enums, `company`, `user`, `client` tables, RLS scaffolding |
| `0002_document_layer.sql` | `document_version`, `document_category` (nested tree) |
| `0003_evidence_layer.sql` | `evidence_block` with pgvector column and GIN/IVFFlat indexes |
| `0004_fact_layer.sql` | `observation`, `pipeline_run` |
| `0005_derivation_conflict.sql` | `derivation_result`, `observation_conflict` |
| `0006_report_chat_notification.sql` | `report`, `chat_message`, `notification` |
| `0007_async_audit_rls.sql` | Row-level security policies, audit log |
| `0008_pending_obs_observation_id.sql` | `pending_observation` request table |
| `0009_notification_enum_extend.sql` | Extended `notification_type` enum values |
| `0010_attestation_action.sql` | `attestation_record` for manual observations |
| `0011_user_company_rls.sql` | Refined per-user/company RLS policies |