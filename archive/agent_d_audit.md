# Agent D — Infra, Deployment & Performance Realism Audit

> **Auditor:** Agent D  
> **Date:** 2026-02-21  
> **Documents reviewed:** `project_spec.md`, `implementation_plan.md` (all 6 slices), `pipeline_plan.md`, `data_model_migration_plan.md`  
> **Fixed decisions respected (not reopened):** Three-process deployment, `LOW_CONFIDENCE_THRESHOLD = 0.70`, ratio bbox coords, Puppeteer in dedicated container.

---

## Issues

---

### D-01

- **Severity:** CRITICAL
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0003 / `implementation_plan.md` §1.4 User schema
- **Symptom / contradiction:** The `user` table in migration `0001_foundation.sql` has no `password_hash` column. The implementation plan §1.4 schema specifies `password_hash — text, not null (bcrypt)` and Auth.js is configured with a credentials provider that calls `bcrypt.compare(password, hash)`. The DDL as written will make login impossible.
- **Why it matters:** Auth.js credentials provider cannot authenticate any user. First deployment will fail at the login screen — no user can sign in.
- **Minimal fix:**
  1. Add `password_hash TEXT NOT NULL` to the `"user"` table in `0001_foundation.sql`.
  2. Update the seed script to insert a hashed password via `bcrypt.hash(password, 12)`.
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** Total deployment blocker — zero users can authenticate.

---

### D-02

- **Severity:** CRITICAL
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0003 / `implementation_plan.md` §2.7–§2.8
- **Symptom / contradiction:** The `chunk_type` ENUM is defined as `('original', 'merged', 'split')` in migration `0001_foundation.sql`. The implementation plan §2.7 introduces a fourth state `"superseded"` for blocks that were merged or split. INSERTs or UPDATEs with `chunk_type = 'superseded'` will fail with a PostgreSQL ENUM type error.
- **Why it matters:** The OCR job's chunking step will crash on every document with mergeable blocks, which is the majority of PDFs. Pipeline will fail at `ocr_processing` for most uploads.
- **Minimal fix:**
  1. Add `'superseded'` to the `chunk_type` ENUM definition in `0001_foundation.sql`: `CREATE TYPE chunk_type AS ENUM ('original', 'merged', 'split', 'superseded');`
  2. Alternatively, use `embedding_status = 'skipped'` as the proxy and filter `chunk_type IN ('original','merged','split')` for embedding rather than adding a fourth type. Pick one approach and align all queries.
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** Pipeline crash on every document with adjacent paragraph blocks.

---

### D-03

- **Severity:** CRITICAL
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0003 / Pipeline plan R4 / `implementation_plan.md` §2.8
- **Symptom / contradiction:** Pipeline plan R4 identifies that `EvidenceBlock` needs an `embedding_status ENUM('pending' | 'completed' | 'failed' | 'skipped')` column. The pipeline plan Slice 1 scope explicitly says "Add `embedding_status ENUM` to `EvidenceBlock` (from R4 fix)." However, the actual migration SQL in `0003_evidence_layer.sql` does **not** include this column. The embedding job (Slice 2 §2.8) uses `embedding IS NULL AND low_confidence = false AND chunk_type != 'superseded'` as a proxy, but this cannot distinguish "not yet processed" from "permanently failed" — a failed-then-retried batch will re-attempt all blocks, including ones that consistently fail (e.g., blocks with unparseable Unicode).
- **Why it matters:** Without `embedding_status`, the system cannot implement partial-failure isolation per pipeline plan R8 (idempotent retry). Failed blocks are retried forever, wasting OpenAI API quota. The implementation plan §2.8 acknowledges this gap by saying "mark those blocks `embedding_status = 'failed'`" — a column that doesn't exist in the DDL.
- **Minimal fix:**
  1. Add `embedding_status` ENUM type in `0001_foundation.sql`: `CREATE TYPE embedding_status AS ENUM ('pending', 'completed', 'failed', 'skipped');`
  2. Add `embedding_status embedding_status NOT NULL DEFAULT 'pending'` to the `evidence_block` table in `0003_evidence_layer.sql`.
  3. Update embedding job query to filter `WHERE embedding_status = 'pending'`.
  4. On embedding failure: `UPDATE SET embedding_status = 'failed'`.
  5. On low_confidence: set `embedding_status = 'skipped'` at INSERT time.
- **Slice it should be fixed in:** Slice 1 (migration)
- **Risk if deferred:** Infinite retry on failed blocks; OpenAI cost amplification; extraction job processes with incorrect block set.

---

### D-04

- **Severity:** HIGH
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0005 / `implementation_plan.md` §1.4 / §4.5
- **Symptom / contradiction:** The `key_equivalence_cache` table in migration `0005_derivation_conflict.sql` has no `company_id` column. Columns are: `cache_id, key_pair_hash, key_a, key_b, result, rationale, created_at`. But the implementation plan §1.4 schema says `company_id — FK → companies.id, not null`, and the semantic conflict job (§4.5 step 3b) queries `WHERE company_id = $companyId AND id = $cacheKey`. This query will fail at runtime with "column company_id does not exist."
- **Why it matters:** Semantic conflict detection is broken. Every `semantic-conflict-job` will crash. Also, without `company_id`, cache entries leak across tenants (two different companies' key pairs share the same cache), violating tenant isolation.
- **Minimal fix:**
  1. Add `company_id UUID NOT NULL REFERENCES company (company_id) ON DELETE CASCADE` to `key_equivalence_cache` in `0005_derivation_conflict.sql`.
  2. Update the unique constraint: `CONSTRAINT uq_key_pair UNIQUE (company_id, key_pair_hash)`.
  3. Add RLS policy. Remove from "company-agnostic" exclusion list in `0007_async_audit_rls.sql`.
- **Slice it should be fixed in:** Slice 1 (migration)
- **Risk if deferred:** Runtime crash on every observation approval that triggers semantic conflict detection. Cross-tenant cache leakage.

---

### D-05

- **Severity:** HIGH
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0007 / `implementation_plan.md` §1.4
- **Symptom / contradiction:** The `audit_log` table in migration `0007_async_audit_rls.sql` has no `company_id` column. The implementation plan §1.4 schema says `company_id — FK → companies.id, not null`. Every audit write in the implementation plan passes `company_id`. The migration explicitly marks audit_log as "company-agnostic — no RLS." Without `company_id`, admins will see audit logs from all companies, or the application-layer filter will fail.
- **Why it matters:** Multi-tenant data leak — admin of company A can read audit entries belonging to company B. Also, the `withTenant` RLS wrapper won't scope audit reads, so either the app layer must add explicit filtering (fragile) or the query returns all companies' logs.
- **Minimal fix:**
  1. Add `company_id UUID NOT NULL` to `audit_log` in `0007`.
  2. Add an RLS policy for audit_log scoped to `current_company_id()`.
  3. Remove from the "company-agnostic" exclusion comment.
- **Slice it should be fixed in:** Slice 1 (migration)
- **Risk if deferred:** Cross-tenant audit log exposure in production.

---

### D-06

- **Severity:** HIGH
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.6 (OCR job flow step 6) / `project_spec.md` §5.1 step 4
- **Symptom / contradiction:** The spec §5.1 sends the **entire PDF** as a single base64 payload to PaddleOCR-VL 1.5 (`{ "file": "<base64>", "fileType": 0 }`). The implementation plan §2.6 step 6 sends **individual page PNGs** to PaddleOCR per-page (`max 4 concurrent`). These are fundamentally different strategies with different latency profiles, error handling semantics, and cost implications.
- **Why it matters:**
  - Per-page approach: requires pdf2pic rendering FIRST, then N separate PaddleOCR calls. For a 50-page PDF: ~22s render + 13 sequential PaddleOCR batches (at concurrency 4) ≈ much higher latency.
  - Per-file approach: one PaddleOCR call, but PaddleOCR must parse multi-page PDFs internally, and the base64 payload for a 50MB PDF is ~67MB.
  - `parseOcrResponse()` must handle completely different response shapes depending on the strategy.
  - The timeout (60s) is calibrated for one approach but not the other.
- **Minimal fix:**
  1. Decide: the implementation plan's per-page approach is safer for partial failure isolation but slower. If per-page: adjust the OCR job timeout to `pageCount * 20s` (capped at 600s), not flat 60s.
  2. Update the spec §5.1 or the implementation plan to match. The `parseOcrResponse` adapter must be tested against the actual API response shape for the chosen strategy.
  3. If per-file: remove pdf2pic from the OCR stage (only use it for page PNG rendering for the UI) and handle PaddleOCR output pagination.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** OCR job fails unpredictably; timeout miscalibration causes either premature failure or unbounded wall-clock time.

---

### D-07

- **Severity:** HIGH
- **Type:** Performance
- **Where:** `project_spec.md` §12.1 / `implementation_plan.md` §2.6, §3.5
- **Symptom / contradiction:** The SLA for a 50-page PDF is "< 5 minutes end-to-end (p95)." The latency budget, assuming the per-page PaddleOCR strategy from the implementation plan:
  - pdf2pic: ~22s (50 pages at 150 DPI)
  - PaddleOCR (50 pages, concurrency 4, ~8s/page typical): ~100s
  - R2 page PNG uploads (50 concurrent): ~10s
  - Chunking: ~2s
  - Embedding (250 blocks, 1 batch): ~8s
  - Extraction (Grok call): up to 120s
  - **Total: ~262s optimistic, ~360s+ realistic with API latency variance**
  
  Dense ESG documents (30+ blocks/page) will generate 1500+ blocks, requiring 3 embedding batches. The SLA has no margin for PaddleOCR or Grok rate limiting, network jitter, or retry loops.
- **Why it matters:** The published SLA of 5 minutes will be routinely violated for documents with >30 pages of dense table content. User expectations set by the SLA won't match reality.
- **Minimal fix:**
  1. Benchmark the actual per-page PaddleOCR latency on a representative 50-page PDF. If >8s/page, switch to per-file strategy.
  2. Increase SLA to "< 8 minutes p95 for 50-page PDF" or scope the 5-minute SLA to "< 20 pages."
  3. Add pipeline-level latency tracking from the first slice (instrument `PipelineRun` with `started_at`/`completed_at` per stage).
  4. Consider increasing PaddleOCR concurrency from 4 to 8 if the API supports it.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** User-visible performance promise broken; no data to diagnose root cause without instrumentation.

---

### D-08

- **Severity:** HIGH
- **Type:** Infra
- **Where:** `data_model_migration_plan.md` § Migration 0003 / `implementation_plan.md` §1.5 / Pipeline plan R6
- **Symptom / contradiction:** The HNSW index DDL in `0003_evidence_layer.sql` uses `CREATE INDEX idx_eb_embedding_hnsw` **without** the `CONCURRENTLY` keyword. The implementation plan §1.5 says "0003_hnsw_index.sql" uses `CREATE INDEX CONCURRENTLY`. The data_model_migration_plan note says to split into `0003b_hnsw_index.sql` with `{ transaction: false }`, but the actual SQL omits `CONCURRENTLY`.
- **Why it matters:** Without `CONCURRENTLY`, the index build takes a `SHARE` lock on `evidence_block`, blocking all INSERTs during the build. On an initial empty table this is harmless (~1s). But if the migration is ever re-run against a populated table (e.g., re-seeding, or adding the index post-data-load), it will lock the table for minutes to hours, halting all pipeline processing.
- **Minimal fix:**
  1. Change the DDL in `0003b_hnsw_index.sql` to: `CREATE INDEX CONCURRENTLY idx_eb_embedding_hnsw ON evidence_block USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);`
  2. Confirm the Drizzle migration config marks this file as `{ transaction: false }`.
  3. Keep the `SET maintenance_work_mem = '1GB'` but ensure it's scoped to the session, not connection-level.
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** Table lock during redeployment or data refresh; pipeline downtime.

---

### D-09

- **Severity:** HIGH
- **Type:** Infra
- **Where:** `implementation_plan.md` Slice 5 §5.11 / Pipeline plan R7
- **Symptom / contradiction:** The PDF worker `Dockerfile` is referenced but no base image, system dependencies, or memory limits are specified. Puppeteer 22 with headless Chromium requires: `libnss3`, `libatk1.0`, `libgbm1`, `libgtk-3-0`, `libasound2`, `fonts-liberation`, and ~400MB of Chromium binaries. The plan says "Docker image installs Node 20 + Chromium" but omits all details.
- **Why it matters:** Without a concrete Dockerfile, the PDF worker will fail on first deploy. Chromium's dependency tree changes across versions and distros. This is the single most common failure mode for Puppeteer containerization.
- **Minimal fix:**
  1. Base image: `node:20-slim` (Debian Bookworm).
  2. Add: `RUN apt-get update && apt-get install -y chromium fonts-liberation libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2 --no-install-recommends && rm -rf /var/lib/apt/lists/*`
  3. Set `ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
  4. Set `ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` to avoid double-downloading.
  5. Memory limit: minimum 512MB per container; recommend 1GB with 3 concurrent browser instances.
- **Slice it should be fixed in:** Slice 5 (PDF worker implementation)
- **Risk if deferred:** PDF worker container fails to start. Complete blocker for PDF output.

---

### D-10

- **Severity:** HIGH
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.6 step 5 / Pipeline plan R2
- **Symptom / contradiction:** `pdf2pic` requires a system-level rasterizer — either GraphicsMagick, ImageMagick, or Ghostscript — installed in the pipeline worker container. This dependency is not declared in any Dockerfile, `package.json` dependency list, or dev setup instructions.
- **Why it matters:** pdf2pic silently delegates to a CLI binary (`gm` or `convert` or `gs`). If none is present, it throws a cryptic error like `spawn gm ENOENT` at runtime. The pipeline worker container will crash on every PDF upload.
- **Minimal fix:**
  1. Add `ghostscript` and `graphicsmagick` to the pipeline worker's system dependencies.
  2. Document in `.env.example` or `README` that local dev requires `brew install graphicsmagick` (macOS) or `apt install graphicsmagick` (Linux).
  3. Add an integration test that confirms `pdf2pic` can rasterize a 2-page fixture PDF.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** All PDF uploads crash at `ocr_processing` stage.

---

### D-11

- **Severity:** HIGH
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.10 / Pipeline plan R9
- **Symptom / contradiction:** Redis pub/sub is fire-and-forget. If the Next.js app server is restarting (deploy, crash, scale-to-zero), pipeline events published by the worker are permanently lost. The in-memory replay buffer is per-process and non-durable — it only helps for brief client disconnects within a single app instance. During a rolling deployment (common on Railway/Fly.io), SSE connections are severed and the new instance has an empty replay buffer.
- **Why it matters:** Users will see stale pipeline status badges after a deployment. Documents may appear stuck at an intermediate state (e.g., "OCR en cours…") even though they've reached `review_ready`. The user must manually refresh to discover the true state.
- **Minimal fix:**
  1. On SSE reconnect, emit a `GET /api/documents/{id}/status` fetch per visible document (client-side reconciliation).
  2. Alt: add a lightweight `reconnect_sync` SSE event that the server emits on new connection, containing current `pipeline_status` for all in-progress documents for the company.
  3. Document this limitation as a known degradation mode during deployments.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** User confusion about document pipeline state after every deployment.

---

### D-12

- **Severity:** MEDIUM
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Migration 0002 / `implementation_plan.md` §1.4
- **Symptom / contradiction:** The `document_category.path` column has `DEFAULT ''` and a `CHECK (path <> '')` constraint. These contradict each other: any INSERT that relies on the default will violate the CHECK constraint. The application must always compute and set `path` before INSERT, but the DEFAULT signals that it's safe to omit — a trap for seed scripts, migrations, and admin utilities.
- **Why it matters:** Category creation will fail with `check_violation (path_not_empty)` if any code path (seed, migration, admin tool) omits the `path` field.
- **Minimal fix:**
  1. Remove `DEFAULT ''` — make path a required field with no default.
  2. Or: remove the CHECK constraint and validate at the API layer only (simpler, since the spec already says path is API-enforced).
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** Seed scripts and admin tools fail silently; developer confusion.

---

### D-13

- **Severity:** MEDIUM
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.6, Workers section / Pipeline plan § Deployment note
- **Symptom / contradiction:** The pipeline worker has total BullMQ concurrency of 15 (3 OCR + 5 embedding + 2 extraction + 5 semantic-conflict). Each concurrent job uses a DB transaction (via `withTenant`). The app server pool is configured as `min 2, max 10`. No separate pool configuration for the pipeline worker is specified.
- **Why it matters:** If the pipeline worker shares the same pool defaults, 15 concurrent jobs will exhaust a 10-connection pool instantly. Jobs will queue for connections, causing cascading timeouts. The extraction job alone (120s+ Grok call while holding a connection) can starve all others.
- **Minimal fix:**
  1. Configure the pipeline worker's DB pool separately: `min: 5, max: 20`.
  2. Ensure long-running external API calls (PaddleOCR, Grok, OpenAI) happen **outside** the DB transaction — only acquire a connection for the DB write, not for the entire job duration.
  3. Document pool sizing in `.env.example` or worker config.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** Connection pool exhaustion under moderate load (3+ simultaneous document uploads). Jobs timeout; pipeline status stuck at intermediate states.

---

### D-14

- **Severity:** MEDIUM
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.4 (presigned URL) / `project_spec.md` §5.1
- **Symptom / contradiction:** Presigned R2 PUT URLs are valid for 15 minutes. If a user uploads to R2 but never calls `POST /api/uploads/complete` (browser crash, tab close, network failure), the object persists in R2 indefinitely. R2 has no native lifecycle/expiration policy equivalent to S3's. Over time, orphaned objects accumulate and consume storage quota.
- **Why it matters:** Storage cost leak. For a SaaS platform, orphaned objects from failed uploads will grow linearly with usage.
- **Minimal fix:**
  1. Add a daily BullMQ cron job that lists R2 objects with `original.*` keys that have no matching `document_version` row in the DB. Delete orphans older than 24 hours.
  2. Or: use R2's `LifecycleConfiguration` (now supported since 2025) with a `NoncurrentVersionTransition` rule if available.
  3. Log cleanup count for monitoring.
- **Slice it should be fixed in:** Slice 2 (post-upload cleanup)
- **Risk if deferred:** Gradual storage cost growth; no visibility into wasted space.

---

### D-15

- **Severity:** MEDIUM
- **Type:** Performance
- **Where:** `data_model_migration_plan.md` § Migration 0007 / `implementation_plan.md` §3.5
- **Symptom / contradiction:** The RLS policy for `chat_message` uses a per-row subquery: `session_id IN (SELECT session_id FROM chat_session WHERE company_id = current_company_id())`. For tables with high row counts (chat messages grow linearly with usage), this subquery is executed per row during sequential scans. The `idx_chat_msg_session` btree index helps for indexed lookups, but `SELECT *` or unindexed filter combinations will trigger full-table scans with per-row subquery evaluation.
- **Why it matters:** Chat message queries will degrade as message volume grows. A company with 10,000 messages will experience noticeably slow message list loads.
- **Minimal fix:**
  1. Denormalize: add `company_id UUID NOT NULL` to `chat_message` directly (same pattern used for `evidence_block`).
  2. Add RLS directly on `company_id` instead of via subquery.
  3. Or: create a materialized view / function-based index if denormalization is undesirable.
- **Slice it should be fixed in:** Slice 1 (migration)
- **Risk if deferred:** 10x query slowdown for active chat users; becomes harder to fix after data exists.

---

### D-16

- **Severity:** MEDIUM
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.6 step 6d / `project_spec.md` §17.3
- **Symptom / contradiction:** Page images are stored at `{company_id}/{document_id}/pages/{n}.png`. If a document has multiple `DocumentVersion`s (re-upload), the page PNGs from version 2 will overwrite version 1's PNGs at the same R2 key. The original version's page images are silently destroyed.
- **Why it matters:** If a user re-processes a document and the new version's OCR fails, the original page PNGs are already overwritten. Evidence proof (bbox overlay on page image) for observations from the first version becomes broken.
- **Minimal fix:**
  1. Change page image key to `{company_id}/{document_version_id}/pages/{n}.png` (scope to version, not document).
  2. Update `GET /api/documents/{id}/pages/{n}` to resolve via the specific `document_version_id`.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** Silent data loss on document re-upload; broken evidence display for previous version's observations.

---

### D-17

- **Severity:** MEDIUM
- **Type:** Security
- **Where:** `project_spec.md` §12.4 / `implementation_plan.md` — no slice implements rate limiting
- **Symptom / contradiction:** The spec §12.4 requires "Rate limiting: 100 requests/minute per user." No slice, API middleware, or library is referenced in the implementation plan. No Redis-backed rate limiter is configured.
- **Why it matters:** Without rate limiting, a single malicious or buggy client can exhaust pipeline workers (via repeated uploads), consume LLM API quota (via rapid chat messages), or degrade DB performance (via observation list queries).
- **Minimal fix:**
  1. Add `rate-limiter-flexible` or `@upstash/ratelimit` as a dependency.
  2. Create a `src/middleware/rateLimit.ts` that checks request count per `user_id` in Redis (sliding window, 100 req/min).
  3. Apply to all API route handlers via the Next.js middleware or a shared wrapper.
- **Slice it should be fixed in:** Slice 1 (infrastructure) or Slice 6 (polish)
- **Risk if deferred:** API abuse; LLM cost amplification; no protection against automated attacks.

---

### D-18

- **Severity:** MEDIUM
- **Type:** Infra
- **Where:** Pipeline plan R12 / `implementation_plan.md` — BullMQ queue config
- **Symptom / contradiction:** BullMQ jobs are not configured with `removeOnComplete`. The default is to keep all completed jobs in Redis indefinitely. Pipeline plan R12 mentions `removeOnFail: { count: 100 }` for failed jobs, but says nothing about completed jobs. A busy system processing 50 documents/day generates ~200 completed jobs/day across 4 queues.
- **Why it matters:** Redis memory grows unboundedly with completed job data. After months, Redis OOM is possible if maxmemory is not set.
- **Minimal fix:**
  1. Add `removeOnComplete: { count: 500, age: 86400 }` (keep last 500 or 24h) to all queue declarations in `src/lib/queues.ts`.
  2. Set `removeOnFail: { count: 200 }` as already recommended.
  3. Configure Redis `maxmemory-policy: noeviction` and set an appropriate `maxmemory` (e.g., 256MB for MVP).
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** Redis memory leak; eventual OOM crash affecting all queues and pub/sub.

---

### D-19

- **Severity:** MEDIUM
- **Type:** Infra
- **Where:** `implementation_plan.md` — Worker processes / Pipeline plan § Deployment note
- **Symptom / contradiction:** Neither the pipeline worker nor the PDF worker exposes a health check endpoint. In a containerized deployment (Docker Compose, Fly.io, Railway), the orchestrator needs liveness/readiness probes. BullMQ workers are headless Node.js processes with no HTTP server. If a worker silently hangs (e.g., Chromium process frozen, Redis connection dropped), the orchestrator cannot detect it.
- **Why it matters:** Dead workers are not restarted. Jobs queue indefinitely. Documents stuck at intermediate pipeline states with no alerting.
- **Minimal fix:**
  1. Add a minimal HTTP health server on a dedicated port (e.g., 3002 for pipeline, 3003 for PDF) that returns 200 if the BullMQ connection is alive: `redis.status === 'ready'`.
  2. Configure Docker/Fly.io health check to poll this endpoint every 30s.
  3. Alt: use BullMQ's `Worker.isRunning()` check within a setInterval and exit on failure (rely on container restart policy).
- **Slice it should be fixed in:** Slice 2 (pipeline worker) and Slice 5 (PDF worker)
- **Risk if deferred:** Silent worker death; pipeline stalls with no visibility.

---

### D-20

- **Severity:** MEDIUM
- **Type:** Performance
- **Where:** `implementation_plan.md` §3.5 step 10 / Pipeline plan R11
- **Symptom / contradiction:** The extraction job timeout is documented as 260s (120s × 2 + 20s buffer) in the pipeline plan, but no BullMQ job-level timeout is configured in the queue declarations or worker setup. BullMQ defaults to no timeout. If the Grok API hangs beyond 260s (e.g., due to rate limiting or API degradation), the extraction worker slot is consumed indefinitely, blocking other extraction jobs.
- **Why it matters:** One stuck Grok call (concurrency = 2) locks 50% of extraction capacity. Two stuck calls = complete extraction pipeline halt.
- **Minimal fix:**
  1. Set BullMQ job timeout: `{ timeout: 300000 }` (300s = 260s + 40s grace) when enqueueing `extraction-job`.
  2. Set per-stage timeouts for all queues in `src/lib/queues.ts`: OCR = 180s, embedding = 120s, extraction = 300s, semantic-conflict = 60s, render-pdf = 90s.
- **Slice it should be fixed in:** Slice 1 (queue declarations)
- **Risk if deferred:** Hung extraction jobs silently block pipeline capacity.

---

### D-21

- **Severity:** MEDIUM
- **Type:** Config
- **Where:** `data_model_migration_plan.md` § Risk 1.12 / `implementation_plan.md` §5.8
- **Symptom / contradiction:** The data model plan recommends a BullMQ cron job to expire `PendingManualObservation` rows where `status = 'pending' AND expires_at < now()`. The implementation plan §5.8 says "a background timeout task (BullMQ delayed job, scheduled at creation time)" handles this. But no queue for this scheduled job is declared in `src/lib/queues.ts` (which only declares `ocr-job`, `embedding-job`, `extraction-job`, `semantic-conflict-job`). No slice assigns responsibility for implementing this timeout mechanism.
- **Why it matters:** Pending manual observations that time out remain in `status = 'pending'` forever. The agent polling loop (`max 10 minutes, poll every 5 seconds`) will eventually time out on its side, but the DB row is never cleaned up. Stale pending rows confuse any admin inspection.
- **Minimal fix:**
  1. Use BullMQ's `Queue.add(..., { delay: 600000 })` on a `pending-obs-timeout` queue at creation time.
  2. Or: use PostgreSQL `GENERATED ALWAYS AS` for `expires_at` (already done in migration 0007) combined with a cron job that `UPDATE SET status = 'timed_out' WHERE status = 'pending' AND expires_at < now()` every minute.
  3. Add the queue to `src/lib/queues.ts` and the consumer to the pipeline worker.
- **Slice it should be fixed in:** Slice 5
- **Risk if deferred:** Stale pending observations in DB; minor data hygiene issue.

---

### D-22

- **Severity:** MEDIUM
- **Type:** Security
- **Where:** `implementation_plan.md` §5.11, §5.17 / `project_spec.md` §12.4
- **Symptom / contradiction:** The PDF worker fetches HTML from R2 and renders it in Puppeteer's `page.setContent()` with `waitUntil: 'networkidle0'`. The HTML is generated by Grok LLM. If the LLM output contains `<script>` tags, `<img onerror>`, `<link>` to external stylesheets, or `<iframe>` elements, Puppeteer will execute them in a full Chromium context. This is a server-side script injection / SSRF vector.
- **Why it matters:** A malicious user who can influence the LLM's HTML output (via prompt injection in observations) could potentially trigger SSRF from the PDF worker (e.g., `<img src="http://internal-service:port/...">`), exfiltrate data, or cause Chromium to hang/crash.
- **Minimal fix:**
  1. Sanitize HTML before `setContent`: strip `<script>`, `<iframe>`, `<object>`, `<embed>`, event handler attributes (`onerror`, `onclick`, etc.).
  2. Use DOMPurify on the server side before passing to Puppeteer.
  3. Pass `--disable-web-security=false` and `--no-sandbox` flags explicitly in the Puppeteer launch config.
  4. Network isolation: run the PDF worker with no outbound internet access (Docker `--network=none` or firewall rules allowing only R2 + Redis + PostgreSQL).
- **Slice it should be fixed in:** Slice 5
- **Risk if deferred:** SSRF from PDF worker; potential internal network scanning; Chromium exploitation.

---

### D-23

- **Severity:** MEDIUM
- **Type:** Performance
- **Where:** `implementation_plan.md` §2.8 / `project_spec.md` §5.1 step 6
- **Symptom / contradiction:** The embedding job batches up to 512 blocks per OpenAI API call. OpenAI's `text-embedding-3-small` has a per-request **total token limit** (~8191 tokens per individual input, and a practical total batch limit). If OCR blocks average 200 tokens and a batch has 512 blocks, the total token count is ~102,400 per request. OpenAI may reject or truncate oversized batches, especially under rate limiting.
- **Why it matters:** Batch failures at the OpenAI level will trigger the per-batch failure handler, marking all 512 blocks as `failed`. This is overly aggressive — the entire batch fails for a limit exceeded by a few blocks.
- **Minimal fix:**
  1. Reduce default batch size from 512 to 256, with a configurable constant.
  2. Pre-compute total token count per batch using tiktoken; split the batch if it exceeds a safe threshold (e.g., 100K tokens).
  3. Add retry with smaller batch size: on `400 Bad Request`, halve the batch and retry.
- **Slice it should be fixed in:** Slice 2
- **Risk if deferred:** Embedding batch failures for documents with many long text blocks.

---

### D-24

- **Severity:** LOW
- **Type:** Infra
- **Where:** `implementation_plan.md` §2.11 / Pipeline plan §R1
- **Symptom / contradiction:** The `parseOcrResponse` adapter assumes a response shape `{ boxes: [[x1,y1,x2,y2], ...], texts: ["..."], scores: [0.97, ...] }` based on the implementation plan §2.11. But the PaddleOCR-VL 1.5 response schema is not documented in any official Baidu documentation referenced by the project. The response shape is assumed, not verified.
- **Why it matters:** If the actual PaddleOCR response uses different field names (e.g., `results` instead of `boxes`, or nested per-page arrays), the adapter will return empty blocks for every document.
- **Minimal fix:**
  1. Make a real test call to the PaddleOCR API with a sample PDF before Slice 2 implementation.
  2. Save the raw response as a fixture file (`tests/fixtures/paddleocr_response.json`).
  3. Build `parseOcrResponse` against the actual fixture.
- **Slice it should be fixed in:** Slice 2 (before implementation)
- **Risk if deferred:** OCR stage produces zero blocks; entire pipeline yields no observations.

---

### D-25

- **Severity:** LOW
- **Type:** Config
- **Where:** `implementation_plan.md` §5.7 / `project_spec.md` §10.3
- **Symptom / contradiction:** The `compute_derivation` MCP tool in the implementation plan §5.7 uses operations `"sum"|"avg"|"min"|"max"|"ratio"` while the spec §10.2 and migration ENUM define `"sum"|"average"|"delta"|"ratio"|"count"`. The operation names `avg` ≠ `average`, and `min`/`max` are not in the ENUM at all while `delta`/`count` are missing from the tool input.
- **Why it matters:** Agent requests for `"avg"` will fail with an ENUM type error on INSERT. `delta` and `count` operations from the spec are unreachable.
- **Minimal fix:**
  1. Align the MCP tool input enum to the DB ENUM: `"sum"|"average"|"delta"|"ratio"|"count"`.
  2. Or: update the DB ENUM to match the tool if `min`/`max` are desired.
- **Slice it should be fixed in:** Slice 5
- **Risk if deferred:** Runtime errors on derivation operations; inconsistent tool behavior.

---

### D-26

- **Severity:** LOW
- **Type:** Config
- **Where:** `implementation_plan.md` §1.4 / `data_model_migration_plan.md` § Migration 0004
- **Symptom / contradiction:** The implementation plan §1.4 `observations` table uses `provenance_type — enum('extracted', 'manual', 'derived')` while the migration uses `provenance_type_enum AS ENUM ('document', 'manual')`. The value `'extracted'` ≠ `'document'`, and `'derived'` is not in the migration ENUM.
- **Why it matters:** Application code inserting `provenance_type = 'extracted'` (as per implementation plan) will fail against the migration ENUM which expects `'document'`. Minor, but causes runtime errors on first observation insert.
- **Minimal fix:**
  1. Align: use `'document'` in all application code (matching the migration), or update the migration ENUM to use `'extracted'`.
  2. Remove `'derived'` from the implementation plan schema if derivations are stored separately.
- **Slice it should be fixed in:** Slice 1
- **Risk if deferred:** First observation insert fails; caught immediately in integration tests.

---

### D-27

- **Severity:** LOW  
- **Type:** Infra
- **Where:** `data_model_migration_plan.md` § Risk 1.13 / `implementation_plan.md` §4.6
- **Symptom / contradiction:** `KeyEquivalenceCache` entries never expire. The data model plan Risk 1.13 recommends a 30-day TTL or periodic eviction but marks it as "post-MVP." The implementation plan §4.6 says "Cache entries are permanent." If a user renames a `normalized_key`, the stale `SAME_KEY` cache entry can cause incorrect conflict grouping for the new key value.
- **Why it matters:** A renamed observation key could be incorrectly classified as conflicting with its old pair, creating spurious `ConflictCase` records that confuse users.
- **Minimal fix:**
  1. Add a `created_at` index and a scheduled job that deletes entries older than 30 days.
  2. Or: invalidate cache entries on `normalized_key` update in the `PATCH /api/observations/{id}` handler.
- **Slice it should be fixed in:** Post-MVP (acceptable deferral)
- **Risk if deferred:** Occasional spurious conflict grouping after key renames; low likelihood in MVP.

---

### D-28

- **Severity:** LOW
- **Type:** Performance
- **Where:** `implementation_plan.md` §3.6 / `project_spec.md` §9.3
- **Symptom / contradiction:** The extraction job sets `SET LOCAL hnsw.ef_search = 100` for each query (up from the default 40). With extraction concurrency = 2, this doubles the HNSW search effort per query. At scale with many concurrent extraction jobs, each transaction holds a connection with elevated `ef_search`, increasing query time by ~2.5x.
- **Why it matters:** Minor performance impact at MVP scale. At growth (10+ concurrent extractions), this creates measurable DB CPU load.
- **Minimal fix:**
  1. Accept for MVP; document the tuning parameter.
  2. Monitor `pg_stat_statements` for HNSW query latency; reduce to 60 if p95 < 500ms.
- **Slice it should be fixed in:** Post-MVP (monitoring only)
- **Risk if deferred:** Negligible at MVP scale.

---

## Deployment Blockers Checklist

The following items **MUST** be resolved before the first production deployment. Items are ordered by dependency (earlier items unblock later ones).

1. **Add `password_hash TEXT NOT NULL` to `user` table** (D-01). Without this, Auth.js credentials provider cannot authenticate any user. Verify: seed script inserts a bcrypt hash; `signIn()` succeeds.

2. **Add `'superseded'` to `chunk_type` ENUM** (D-02). Without this, the OCR chunking step crashes on every mergeable document. Verify: INSERT with `chunk_type = 'superseded'` succeeds.

3. **Add `embedding_status` ENUM and column to `evidence_block`** (D-03). Without this, embedding failure tracking is impossible and retry logic is broken. Verify: embedding job can mark individual blocks as `failed`.

4. **Add `company_id` to `key_equivalence_cache`** (D-04). Without this, semantic conflict detection crashes at runtime and cache leaks across tenants. Verify: INSERT with `company_id` succeeds; RLS scopes reads.

5. **Add `company_id` to `audit_log`** (D-05). Without this, admin audit reads leak cross-tenant. Verify: RLS scopes audit_log to authenticated company.

6. **Add `CONCURRENTLY` to HNSW index DDL** (D-08). Critical for redeployment safety. Verify: migration file contains `CREATE INDEX CONCURRENTLY`.

7. **Fix `document_category.path` DEFAULT/CHECK contradiction** (D-12). Without this, category seed scripts and some creation paths fail. Verify: category INSERT without explicit `path` either fails gracefully or computes path.

8. **Align `provenance_type` ENUM values** across migration and application code (D-26). Without this, first observation INSERT fails. Verify: pipeline creates observations with the correct enum value.

9. **Align `compute_derivation` operation ENUM values** between MCP tool and DB (D-25). Without this, derivation calls with `avg`/`min`/`max` crash. Verify: all operation values used by the agent exist in the DB ENUM.

10. **Install `ghostscript` / `graphicsmagick` in pipeline worker container** (D-10). Without this, pdf2pic fails on every PDF upload. Verify: `pdf2pic` rasterizes a 2-page test PDF in the pipeline worker container.

11. **Specify PDF worker Dockerfile with Chromium dependencies and memory limits** (D-09). Without this, the PDF worker container cannot start. Verify: `docker build` succeeds; Puppeteer launches headless browser inside the container.

12. **Add health check endpoints to pipeline worker and PDF worker** (D-19). Without these, orchestrators cannot detect dead workers. Verify: `GET /healthz` returns 200 when Redis connection is alive.

13. **Configure BullMQ job timeouts per queue** (D-20). Without these, hung API calls block worker slots indefinitely. Verify: a job exceeding its timeout is marked as failed.

14. **Configure `removeOnComplete` for all BullMQ queues** (D-18). Without this, Redis memory grows unboundedly. Verify: completed jobs are pruned after configured retention.

15. **Resolve PaddleOCR call strategy (per-file vs per-page)** and validate actual API response shape (D-06, D-24). Without this, OCR job may produce zero blocks or exceed timeout. Verify: a real PaddleOCR API call returns parseable blocks.

16. **Implement rate limiting middleware** (D-17). Without this, the API is unprotected against abuse. Verify: 101st request within 1 minute returns 429.

17. **Sanitize HTML before Puppeteer rendering** (D-22). Without this, the PDF worker is an SSRF vector. Verify: HTML containing `<script>` or `<img onerror>` is stripped before `setContent()`.

---

*End of Agent D audit report.*
