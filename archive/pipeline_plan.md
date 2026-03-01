# Agent D — Pipeline + Jobs Plan

> **Scope:** BullMQ + Redis async pipeline, stage-by-stage worker architecture, retry/timeout policy, risks/gaps, and slice suggestions for ReportFlow.  
> **Tech stack:** BullMQ + Redis · Baidu PaddleOCR-VL 1.5 · OpenAI `text-embedding-3-small` · xAI Grok `grok-4-1-fast-reasoning` · Puppeteer · pgvector + HNSW · pg_trgm.

---

## 1. Risks & Gaps

### R1 — OCR response schema is unspecified

**Problem:** §5.1 step 4 lists the request format for PaddleOCR-VL 1.5 but says nothing about the response JSON shape. The job must parse it to create `EvidenceBlock` records (page, bbox, text, `ocr_confidence`, `block_type`). Without a documented response contract it is unknown whether:
- Bounding boxes are absolute pixels or relative 0–1 fractions.
- Confidence is per-block or per-page (the spec uses "page-level OCR confidence" in §5.1 but "ocr_confidence" per block in §2.3).
- `block_type` (`paragraph | table_cell | header | list_item | figure_caption | other`) maps to PaddleOCR layout categories or must be inferred by the job.
- Multi-page PDFs return results as a flat array or keyed by page.

**Mitigation:** Write a single `parseOcrResponse(raw: unknown): ParsedBlock[]` adapter function behind a unit-tested interface. Document the assumed response shape in a `PADDLEOCR_RESPONSE.md` fixture file and validate against it with a live integration smoke test on first integration. Treat the adapter as the sole place to absorb API drift.

---

### R2 — Page image rendering path is undefined

**Problem:** §5.1 step 4 requires page PNGs stored at `{company_id}/{document_id}/pages/{page_number}.png`. No rendering tool is specified. PaddleOCR does not serve rendered page images — it serves OCR text. For PDFs this requires a separate PDF-to-image conversion step (e.g. `pdf2pic`, `pdftoppm`, `sharp + pdfium`). For images (PNG/JPG/TIFF) the original file is the page image.

**Gaps:**
- No library is listed in the tech stack for PDF rasterisation.
- Resolution/DPI for stored PNGs is not specified (affects bbox overlay accuracy on the frontend).
- If rendered in the same OCR worker, large PDFs (200 pages) will significantly extend the 60s OCR timeout.

**Mitigation:**
- For images: upload original to the page key directly (no extra rendering needed).
- For PDFs: add `pdf2pic` (wraps Ghostscript/poppler) to the worker container, render at 150 DPI, upload pages concurrently to R2, then call PaddleOCR. This must be declared as a worker dependency (not compatible with serverless).
- Clarify timeout: the 60s policy covers only the PaddleOCR API call; page rendering is a separate timed step with its own limit (suggest 90s for a 200-page PDF at 150 DPI).

---

### R3 — `ocr_confidence` threshold contradiction

**Problem:** §2.3 sets `low_confidence = true` when `ocr_confidence < 0.80`. §5.1 step 4 and the retry/timeout table in the prompt brief use `< 0.70`. These are different thresholds on the same field. Using the wrong one silently embeds low-quality blocks or discards useful ones.

**Mitigation:** Resolve to a single constant (`LOW_CONFIDENCE_THRESHOLD`). Based on §5.1 step 4 being the authoritative pipeline definition, use `0.70` and update §2.3 in the next spec revision. Add a named config constant so a single-line change adjusts both the flag logic and tests.

---

### R4 — `embedding_failed` status field missing from EvidenceBlock schema

**Problem:** §12.5 states "Block marked `embedding_failed`; skip in retrieval" on embedding timeout/failure. No such field or enum value exists on `EvidenceBlock` in §2.3. The schema only has `low_confidence` (boolean) and `embedding` (nullable vector). Without a status field, the job cannot distinguish an un-embedded block (not yet processed) from one that permanently failed embedding.

**Mitigation:** Add `embedding_status ENUM('pending' | 'completed' | 'failed' | 'skipped')` to the `EvidenceBlock` schema. Default: `pending`. Set to `skipped` for `low_confidence = true` blocks at HNSW index build time. Set to `failed` after all retries exhausted. This field gates retrieval: only `completed` blocks enter cosine search.

---

### R5 — BM25 via pg_trgm is rank-based approximation, not true BM25

**Problem:** The hybrid scoring formula `0.6 × cosine_similarity + 0.4 × BM25_score via RRF(k=60)` conflates two different things. `pg_trgm`'s `similarity()` returns a trigram overlap ratio (0–1), not a BM25 IDF-weighted term frequency score. True BM25 requires per-term document frequency statistics that pg_trgm does not maintain. RRF (Reciprocal Rank Fusion) is a rank-fusion method using `1/(k + rank_i)`, but the formula shown looks like a raw-score linear combination, not RRF.

**Gaps:**
- Calling pg_trgm output "BM25_score" overpromises precision, especially for numeric ESG keywords and short text blocks.
- The formula as written does not reflect standard RRF: `score_RRF = 1/(k + rank_cosine) + 1/(k + rank_BM25)`, which then could be weighted.
- No tokenisation or stop-word strategy is defined for the BM25 keyword vocabulary.

**Mitigation:** Acknowledge pg_trgm as a BM25 approximation. Implement hybrid retrieval as:
1. Dense: embed a broad ESG query → cosine search via pgvector HNSW → keep ranked list A.
2. Sparse: `similarity(block.text, keyword_bag)` via pg_trgm → keep ranked list B.
3. RRF: `score = 0.6 × (1/(60 + rank_A)) + 0.4 × (1/(60 + rank_B))` where missing rank = N + 1.
Document this clearly. Flag it in §9.5 RAG evaluation: measure recall@150 vs a true BM25 baseline (e.g. via `ts_rank_cd`) on the demo corpus. Swap in `ts_rank_cd` if pg_trgm recall is materially worse.

---

### R6 — HNSW index build time under concurrent ingestion

**Problem:** `CREATE INDEX ... USING hnsw` on the `embedding` column with `ef_construction=128, m=16` is a table-level lock operation. Under concurrent document ingestion the index build will block all inserts to `EvidenceBlock`. For a 200-page document with dense tables this can be 5,000–30,000 blocks.

**Mitigation:**
- Use `CREATE INDEX CONCURRENTLY` in migrations to avoid table locks.
- Build the index once at schema migration time (before any data). The embedding job does INSERTs; the index auto-updates incrementally in HNSW — no full rebuild needed per document.
- Monitor index build time in the §9.5 RAG evaluation harness. If p95 cosine query latency exceeds 500ms at scale, increase `ef_search` at query time (default is 40; can be set per-session with `SET hnsw.ef_search = 100`).

---

### R7 — Puppeteer is incompatible with Next.js serverless / edge runtimes

**Problem:** §12.3 specifies a "worker pool: max 3 concurrent Puppeteer instances." Puppeteer spawns headless Chromium, which requires a persistent process with write access to `/tmp` and a specific binary. This is fundamentally incompatible with:
- Vercel serverless functions (ephemeral, 50 MB code bundle hard limit, no persistent process).
- Next.js edge runtime.
- Any stateless function-per-request architecture.

**Mitigation:** Puppeteer must run in a **dedicated long-running server process**, separate from the Next.js app server. Options:
1. **Preferred (MVP):** A standalone Node.js `pdf-worker.ts` process (separate Dockerfile) with its own BullMQ consumer on the `render-pdf` queue. Communicates with the main app only via the shared PostgreSQL DB and Redis.
2. Alternative: `@sparticuz/chromium` + `puppeteer-core` inside a Lambda-style function with a container image (512 MB+ package).

This architectural decision affects deployment topology. Mark as a **build blocker** before deploying to any serverless platform.

---

### R8 — BullMQ job state recovery and idempotency

**Problem:** §12.5 states "Jobs are idempotent per stage. If a job fails and is retried, it resumes from the last completed stage stored in `DocumentVersion.pipeline_status`." However, BullMQ retries re-execute the entire job handler function from the top. If:
- The OCR job succeeded but the R2 upload of page images failed mid-stream, a retry will re-call PaddleOCR (consuming quota and time) before re-attempting R2 uploads.
- The embedding job partially embedded 200 of 500 blocks before timing out, a retry will re-embed blocks that already have `embedding_status = completed`.

**Mitigation:**
- Each job handler must begin with a **gate check**: read `DocumentVersion.pipeline_status` and bail early if it already shows the completed state for this stage.
- Embedding job: `SELECT block_id FROM evidence_blocks WHERE document_version_id = $1 AND embedding_status = 'pending'` — only process pending blocks.
- OCR job: check if `EvidenceBlock` count > 0 for this document version before calling PaddleOCR; if so, skip the API call and proceed directly to status transition.
- Mark all job handlers with a `// IDEMPOTENCY: ...` comment explaining the gate.

---

### R9 — SSE fan-out under horizontal scaling

**Problem:** `GET /api/pipeline/events` is a long-lived SSE endpoint. A Next.js App Router route handler holds an open HTTP response writer. In a horizontally scaled deployment (2+ app instances behind a load balancer), a pipeline event emitted by Worker A will only reach SSE clients connected to Instance A. Clients on Instance B miss the event.

**Mitigation (specified in §16.1 as an option):** Use Redis pub/sub as the SSE fan-out layer:
1. Each pipeline stage transition publishes a message to a Redis channel: `pipeline:events:{company_id}`.
2. Each app instance's SSE handler subscribes to this channel via `ioredis` subscriber connection.
3. On message, push JSON to all active `EventSource` clients on that instance.

This requires keeping a `Map<company_id, Set<Response>>` in process memory per app instance. SSE connections must be cleaned up on `close` events to prevent memory leaks. Add a 30s heartbeat comment (`event: ping\ndata: {}\n\n`) to detect dead connections.

---

### R10 — Semantic near-duplicate detection trigger point mismatch

**Problem:** The pipeline plan places conflict detection in Stage 4 (extraction). However, §11.6 explicitly states: "After each new **approved** observation, check candidates. Trigger: observation status → approved." All observations exit the pipeline as `candidate`, not `approved`. Approval happens later via user action in the Review Queue. This means the Grok equivalence classifier (Stage 4 in the plan) either:
- Runs prematurely on candidates (before there is a second approved observation to conflict with), or
- Is deferred to observation approval time (outside the pipeline entirely).

**Mitigation:** Separate the two conflict detection paths:
1. **In pipeline (Stage 4):** Run exact-match conflict detection only (`normalized_key` + period overlap) against already-approved observations in the DB. Create `ConflictCase` records for exact matches.
2. **On approval (observation status hook):** When `PATCH /api/observations/{id}/status` transitions to `approved`, trigger semantic near-duplicate detection via a BullMQ `semantic-conflict-job`. This keeps the pipeline fast and the semantically expensive Grok classifier out of the critical path.

---

### R11 — Grok extraction retry on schema-invalid output counts against the 120s timeout

**Problem:** §5.2 states "Schema-validate output. If invalid: retry once." The single retry re-calls Grok. If each Grok call takes ~90s for a large document, two calls = 180s, exceeding the 120s timeout. The timeout policy needs to account for the retry explicitly.

**Mitigation:** Set the job-level timeout to `timeout = 120s × 2 + 20s buffer = 260s` (to cover both the initial call and one retry). Alternatively, set a per-call timeout of 90s within the job and let BullMQ's job timeout govern the outer wall-clock limit separately. Document this as a known discrepancy with §12.5.

---

### R12 — No defined BullMQ Dead Letter Queue (DLQ) consumer

**Problem:** §12.3 mentions "failed jobs move to a dead-letter queue (DLQ) for inspection" but no DLQ consumer, alerting hook, or inspection mechanism is defined. Without this, failed jobs accumulate silently in Redis.

**Mitigation:** Add a `failed` event listener on each BullMQ queue that:
1. Logs the job ID, error, and `document_version_id` as structured JSON.
2. Creates a `Notification` record (type: `pipeline_failed`).
3. Updates `DocumentVersion.pipeline_status = 'failed'` and `pipeline_error_message`.
4. Optionally publishes to an error monitoring service (Sentry / Datadog).

Retain failed jobs in Redis with `removeOnFail: { count: 100 }` to allow manual replay via BullMQ Dashboard or Bull Board.

---

## 2. Worker Architecture

### Process topology

```
┌─────────────────────────────────────────────────────┐
│  Next.js App Server (Node.js long-running)          │
│                                                     │
│  Route Handlers:                                    │
│  • POST /api/uploads/complete  ─── dispatches job  │
│  • GET  /api/pipeline/events   ─── SSE endpoint    │
│         (subscribes Redis pub/sub channel)          │
│  • All REST endpoints (§16)                         │
│                                                     │
│  In-process MCP tools (§15):                        │
│  search_observations, search_evidence,              │
│  compute_derivation, propose_manual_observation,    │
│  create_report, render_pdf (queues job → waits)     │
└────────────────────┬────────────────────────────────┘
                     │ BullMQ dispatch + Redis pub/sub
                     ▼
┌─────────────────────────────────────────────────────┐
│  Pipeline Worker Process  (worker/pipeline.ts)       │
│  Separate long-running Node.js process               │
│                                                     │
│  Queues consumed:                                   │
│  • ocr-job          concurrency: 3                  │
│  • embedding-job    concurrency: 5                  │
│  • extraction-job   concurrency: 2                  │
│  • semantic-conflict-job  concurrency: 5            │
│                                                     │
│  On stage complete: publishes to Redis pub/sub       │
│    channel: pipeline:events:{company_id}            │
└──────────────────────────────────────────────────────┘
                     │ separate queue
                     ▼
┌─────────────────────────────────────────────────────┐
│  PDF Worker Process  (worker/pdf.ts)                 │
│  Separate long-running Node.js process               │
│  (requires headless Chromium — never serverless)     │
│                                                     │
│  Queue consumed:                                    │
│  • render-pdf-job   concurrency: 3 (§12.3)         │
│  Worker restarts after 50 renders (§12.3)           │
│  Timeout: 30s per render; 1 retry; HTML fallback    │
└──────────────────────────────────────────────────────┘
                     │ BullMQ / Redis
                     ▼
┌─────────────────────────────────────────────────────┐
│  Redis (REDIS_URL)                                  │
│  • BullMQ job state (all queues)                   │
│  • pub/sub channel per company                      │
│  • KeyEquivalenceCache TTL-backed hash              │
└──────────────────────────────────────────────────────┘
```

### Queue definitions summary

| Queue | Worker process | Concurrency | Consumer |
|---|---|---|---|
| `ocr-job` | pipeline worker | 3 | `processOcrJob` |
| `embedding-job` | pipeline worker | 5 | `processEmbeddingJob` |
| `extraction-job` | pipeline worker | 2 | `processExtractionJob` |
| `semantic-conflict-job` | pipeline worker | 5 | `processSemanticConflictJob` |
| `render-pdf-job` | pdf worker | 3 | `processPdfRenderJob` |

### Why dedicated processes (not Next.js route handlers)

- Route handlers are request-scoped — they terminate when the HTTP response ends. Long-running jobs (OCR 60s, extraction 120s) cannot live there.
- Puppeteer requires Chromium binary access — not available in any serverless/edge environment.
- BullMQ workers must maintain a persistent Redis connection — not compatible with connection-pool-per-request patterns.
- Horizontal scaling of workers is independent of the web tier.

### Deployment note

For local dev: run `worker/pipeline.ts` and `worker/pdf.ts` as separate `tsx` scripts via `package.json` scripts (`"worker:pipeline"`, `"worker:pdf"`). For production: separate containers/services. If deploying to Vercel, Next.js app runs on Vercel; workers must run on Railway / Fly.io / a VPS.

---

## 3. Detailed Pipeline Stage Specifications

### Stage 1 — OCR Job (`ocr-job` queue)

**Trigger:** `POST /api/uploads/complete` dispatches `ocr-job` after creating `DocumentVersion` with status `uploaded`.

**Job payload:**
```typescript
{ documentVersionId: string; companyId: string; objectKey: string; mimeType: string; }
```

**Steps:**
1. **Gate check:** Read `DocumentVersion.pipeline_status`. If already `ocr_done` or beyond, return early (idempotency).
2. Set `pipeline_status = 'ocr_processing'`. Publish `pipeline_stage_changed` event.
3. Fetch file from R2 using `objectKey`. Base64-encode.
4. Determine `fileType`: `0` for `application/pdf`, `1` for images.
5. `POST ${PADDLEOCR_API_URL}` with `{ file: base64, fileType }` and `Authorization: token ${PADDLEOCR_TOKEN}`. Timeout: 60s. Retry: 2x.
6. Parse response via `parseOcrResponse()` adapter → array of `ParsedBlock[]`.
7. For each block:
   - Create `EvidenceBlock` record: `page_number`, `bbox`, `text`, `ocr_confidence`, `block_type`.
   - Set `low_confidence = ocr_confidence < 0.70`.
   - Set `embedding_status = 'skipped'` if `low_confidence = true`, else `'pending'`.
8. **Page image rendering** (run concurrently with step 7):
   - For images: copy/reference the original file; upload to `{company_id}/{document_id}/pages/1.png`.
   - For PDFs: render each page at 150 DPI using `pdf2pic`; upload each PNG to `{company_id}/{document_id}/pages/{n}.png`. Timeout: 90s separate from OCR call.
9. Set `pipeline_status = 'ocr_done'`. Publish event.
10. Dispatch `embedding-job` to BullMQ.

**On failure:** Set `pipeline_status = 'failed'`, `pipeline_error_message`. Create `Notification` record (type: `pipeline_failed`). Publish `pipeline_failed` SSE event.

---

### Stage 2 — Chunking (in-process, inside OCR job after step 7)

**Runs inside the OCR job**, after all `EvidenceBlock` records are created for the document.

**Steps:**
1. Load all `original` blocks for the document version, ordered by `page_number` ASC, then top `bbox.y` ASC.
2. **Merge pass:** For each pair of adjacent blocks on the same page:
   - Skip if either is `block_type = 'table_cell'` (table cells are never merged).
   - Compute vertical gap: `next_block.bbox.y - (current_block.bbox.y + current_block.bbox.h)`.
   - If gap < 20px AND `token_count(combined_text) ≤ 512`: create a new merged `EvidenceBlock` with `chunk_type = 'merged'`, `merged_block_ids = [id_a, id_b]`. Mark originals with a soft `superseded_by_chunk_id` reference (or simply exclude them from embedding via `embedding_status = 'skipped'`).
3. **Split pass:** For each block (original or merged) where `token_count(text) > 512`:
   - Split at sentence boundaries using a sentence tokenizer. Each split chunk becomes a new `EvidenceBlock` with `chunk_type = 'split'`, `parent_block_id = original_block_id`.
   - Mark original oversized block `embedding_status = 'skipped'`.
4. Token counting uses `tiktoken` with the `cl100k_base` (text-embedding-3-small) encoding. **Add `tiktoken` to worker dependencies.**

---

### Stage 3 — Embedding Job (`embedding-job` queue)

**Trigger:** Dispatched by OCR job on success.

**Job payload:**
```typescript
{ documentVersionId: string; companyId: string; }
```

**Steps:**
1. **Gate check:** If `pipeline_status` already `embedded`, return early.
2. Set `pipeline_status = 'embedding'`. Publish `pipeline_stage_changed` event.
3. Query all `EvidenceBlock`s for this document version where `embedding_status = 'pending'` (i.e. `low_confidence = false` and not superseded by chunking).
4. Batch into groups of 512 blocks. For each batch:
   - Call `POST https://api.openai.com/v1/embeddings` with `input: [text_array]`, `model: 'text-embedding-3-small'`. Timeout: 30s. Retry: 3x with exponential backoff (2s, 4s, 8s).
   - On batch success: bulk-update `embedding` vector and `embedding_status = 'completed'` for all blocks in batch.
   - On persistent failure: mark blocks `embedding_status = 'failed'`; log error with `block_id`s; continue with next batch (skip, don't stop entire job).
5. After all batches: set `pipeline_status = 'embedded'`. Publish event.
6. Dispatch `extraction-job` to BullMQ.

**Note:** If zero `pending` blocks remain (all `low_confidence` or all previously failed), still transition to `embedded` and dispatch extraction. Extraction will handle the insufficient-blocks case.

---

### Stage 4 — Extraction Job (`extraction-job` queue)

**Trigger:** Dispatched by embedding job on success.

**Job payload:**
```typescript
{ documentVersionId: string; companyId: string; }
```

**Steps:**
1. **Gate check:** If `pipeline_status` already `review_ready` or `failed`, return early.
2. Create `PipelineRun` record: `status = 'running'`, `started_at`.
3. Set `pipeline_status = 'extracting'`. Publish event.
4. **Hybrid retrieval (BM25 + dense via RRF):**
   - Embed a broad ESG coverage prompt string using `text-embedding-3-small`.
   - Dense query: `SELECT block_id, 1 - (embedding <=> $query_vec) AS cosine_score, rank() OVER (ORDER BY cosine_score DESC) AS dense_rank FROM evidence_blocks WHERE document_version_id = $1 AND embedding_status = 'completed'`.
   - Sparse query: `SELECT block_id, similarity(text, $keyword_bag) AS trgm_score, rank() OVER (ORDER BY trgm_score DESC) AS sparse_rank FROM evidence_blocks WHERE document_version_id = $1`.
   - Fuse: `final_score = 0.6 × (1/(60 + dense_rank)) + 0.4 × (1/(60 + sparse_rank))`. ORDER BY `final_score DESC`. Take top 150.
   - If fewer than 10 blocks: log `insufficient_blocks`, skip extraction (`observations_created = 0`, `observations_skipped = total_blocks`), set `pipeline_status = 'review_ready'`, publish `extraction_complete`. Return.
5. **Grok extraction call:**
   - Build system + user prompt: include soft reference key list (§2.4), block content, and output schema instruction.
   - Call `grok-4-1-fast-reasoning` in JSON mode. Timeout: 120s.
   - Schema-validate output with Zod. On invalid: retry once (new Grok call). On still invalid: set `pipeline_status = 'failed'`, alert, return.
6. **Hallucination guard:** For each extracted fact, verify all `evidence_block_ids[]` exist in the document. Reject facts with unknown block IDs.
7. **Create Observation records** for valid facts: `status = 'candidate'`, `extraction_run_id = run_id`, `category_id` inherited from `Document.category_id`.
8. **Exact-match conflict detection** (against existing approved observations, not candidates):
   - For each new observation: query existing observations for same `company_id`, same `normalized_key`, overlapping period, `status = 'approved'`.
   - If found: create `ConflictCase` with `match_method = 'exact'`, `auto_resolved = true`, apply latest-wins policy.
   - Fire `conflict_detected` SSE event per conflicting key.
9. Update `PipelineRun`: `status = 'completed'`, `completed_at`, `observations_created`, `observations_skipped`.
10. Set `pipeline_status = 'review_ready'`. Publish `pipeline_stage_changed` + `extraction_complete` SSE events.
11. Create `Notification` record (type: `pipeline_completed`).

---

### Stage 5 — Semantic Conflict Job (`semantic-conflict-job` queue)

**Trigger:** Dispatched when `PATCH /api/observations/{id}/status` transitions an observation to `approved` (outside the main pipeline, triggered by user action).

**Job payload:**
```typescript
{ observationId: string; companyId: string; }
```

**Steps:**
1. Load the newly approved observation (`obs_a`).
2. Query candidate near-duplicate pairs:
   ```sql
   SELECT obs_b.*
   FROM observations obs_b
   WHERE obs_b.company_id = $company_id
     AND obs_b.status = 'approved'
     AND obs_b.observation_id != $obs_a_id
     AND (
       similarity(obs_b.normalized_key, $key_a) >= 0.5
       OR obs_b.unit = $unit_a
     )
   ```
   (ISO category same-subject check requires a mapping constant from `normalized_key` to ISO 26000 subject.)
3. For each candidate pair:
   - Check `KeyEquivalenceCache` by `SHA256(sort(key_a, key_b))`. If cached, use cached result.
   - If not cached: call Grok with the equivalence prompt (§11.6). Store result in `KeyEquivalenceCache`.
4. For `SAME_KEY` pairs with overlapping periods and different normalized values: create `ConflictCase` with `match_method = 'semantic'`. Apply latest-wins. Group under shared `conflict_group_id`.
5. Publish `conflict_detected` SSE event and create `Notification`.

---

### Stage 6 — PDF Render Job (`render-pdf-job` queue)

**Trigger:** `render_pdf` MCP tool call (§15.6) dispatches a job and polls for completion. Alternatively, dispatched by `create_report` after HTML is stored (fire-and-forget, then `pdf_url` is null until done).

**Job payload:**
```typescript
{ reportId: string; companyId: string; }
```

**Steps:**
1. Read `Report.html_snapshot` from DB.
2. Acquire a browser instance from the Puppeteer pool (max 3). If pool full, wait (queue handles backpressure).
3. `await page.setContent(html_snapshot, { waitUntil: 'networkidle0' })`. Timeout: 30s.
4. `await page.pdf({ format: 'A4', printBackground: true })`.
5. Upload PDF buffer to R2 at `{company_id}/reports/{report_id}/report.pdf`.
6. Update `Report.pdf_url` with time-limited presigned GET URL.
7. Release browser instance. Increment render counter; if counter ≥ 50, restart browser.
8. Publish `notification` SSE event (type: `report_ready`).

**On failure after 1 retry:** Do not set `pdf_url`. Set `Report.status = 'draft'` (keep HTML). Respond to the MCP caller with `render_timeout` error. Create `Notification` with type `pipeline_failed` and reason `pdf_render_failed`. Return HTML-only fallback URL (`html_snapshot_url`) to user with a notice.

---

## 4. Slice Suggestions

### Slice 1 — Infrastructure Foundations

**Goal:** Standing up the shared runtime so all later work has a real environment to target.

**Scope:**
- `docker-compose.yml` with PostgreSQL (pgvector extension), Redis, and app containers.
- Database migration: all entity schemas from §7 (Company, User, Document, DocumentVersion, EvidenceBlock, Observation, etc.), pgvector `embedding vector(1536)` column, HNSW index (`CREATE INDEX CONCURRENTLY ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=128)`), pg_trgm extension, RLS policies.
- Add `embedding_status ENUM` to `EvidenceBlock` (from R4 fix).
- R2 client wrapper (`lib/r2.ts`): `uploadFile`, `getPresignedPut`, `getPresignedGet`.
- BullMQ queue factory (`lib/queues.ts`): create all 5 queues with baseline retry/timeout configs.
- Stub worker processes `worker/pipeline.ts` and `worker/pdf.ts` that log job receipt and ack.
- `KeyEquivalenceCache` table migration.

**Done when:** `docker compose up` yields a running DB, Redis, and app; migrations run without errors; a test BullMQ job dispatched to `ocr-job` appears in BullBoard.

---

### Slice 2 — Upload Flow + OCR Stage

**Goal:** End-to-end from user upload to `EvidenceBlock` rows in DB.

**Scope:**
- `POST /api/uploads/init` + `POST /api/uploads/complete` route handlers.
- R2 presigned PUT generation; file metadata validation (size, MIME, page count).
- `Document` + `DocumentVersion` creation (status `uploaded`).
- `processOcrJob` handler: R2 fetch, base64 encode, PaddleOCR API call, `parseOcrResponse` adapter, `EvidenceBlock` bulk insert.
- `pdf2pic` page rendering for PDFs; R2 upload of page PNGs.
- `low_confidence` flagging at threshold `0.70`.
- Status transitions `uploaded → ocr_processing → ocr_done` with `pipeline_status_updated_at`.
- DLQ failure handler: `pipeline_status = 'failed'`, `Notification` insert.

**Done when:** Uploading a sample PDF creates `EvidenceBlock` rows with correct `page_number`, `bbox`, `text`, `ocr_confidence`, and page PNG accessible via `GET /api/documents/{id}/pages/1`.

---

### Slice 3 — Chunking + Embedding Stage

**Goal:** Chunked blocks stored with 1536-dim vectors in pgvector.

**Scope:**
- Chunking logic (merge + split) executed at end of OCR job.
- `tiktoken` integration for token counting (`cl100k_base`).
- `processEmbeddingJob` handler: batch-512 OpenAI embeddings, bulk-update `embedding` + `embedding_status`.
- Per-block failure isolation: mark `embedding_status = 'failed'`, continue batch.
- Status transitions `ocr_done → embedding → embedded`.
- Dispatch `extraction-job` on success.

**Done when:** After OCR job, merged blocks appear with `chunk_type = 'merged'` and `merged_block_ids[]`. After embedding job, non-`low_confidence` blocks have a non-null `embedding` vector. Cosine query (`SELECT ... ORDER BY embedding <=> $vec`) returns results without error.

---

### Slice 4 — Extraction Stage (Pipeline core)

**Goal:** LLM extraction producing `candidate` observations in the Review Queue.

**Scope:**
- Hybrid retrieval implementation (dense pgvector + pg_trgm sparse → RRF fusion → top 150).
- `processExtractionJob` handler: `PipelineRun` create, Grok call, Zod schema validation, hallucination guard, `Observation` bulk insert.
- Exact-match conflict detection: query approved observations, create `ConflictCase` on match.
- `PipelineRun` update on complete/fail.
- Status transitions `embedded → extracting → review_ready | failed`.
- `extraction_complete` SSE event dispatch via Redis pub/sub.
- `Notification` insert on pipeline complete.

**Done when:** After pipeline completes on the demo PDF corpus (§13.2), the Review Queue shows `candidate` observations with correct `normalized_key`, `value`, `unit`, `period_start/end`, and `evidence_block_ids[]` pointing to real blocks. GHG scope 1/2 and energy observations are present for doc #1.

---

### Slice 5 — SSE Pipeline Events + Notification Bell

**Goal:** Real-time status updates visible in the UI without polling.

**Scope:**
- Redis pub/sub publisher utility (`lib/pubsub.ts`): `publishPipelineEvent(companyId, event)`.
- All pipeline stage transitions (Slices 2–4) publish via `lib/pubsub.ts`.
- `GET /api/pipeline/events` SSE route handler: subscribe to `pipeline:events:{company_id}`, stream events, heartbeat every 30s.
- `notification` event type added to SSE event table (§16.1).
- `GET /api/notifications` + `PATCH /api/notifications/{id}/read` route handlers.
- In-memory `Map<companyId, Set<Response>>` with cleanup on SSE `close`.

**Done when:** Uploading a document in the browser causes the Documents page pipeline badge to animate through `ocr_processing → ocr_done → embedding → embedded → extracting → review_ready` without a page reload. Notification bell shows unread count +1 on pipeline completion.

---

### Slice 6 — Conflict Detection + Semantic Near-Duplicate

**Goal:** Full conflict handling including semantic equivalence.

**Scope:**
- Observation status change hook: on `approved` transition, dispatch `semantic-conflict-job`.
- `processSemanticConflictJob` handler: pg_trgm candidates, `KeyEquivalenceCache` lookup, Grok equivalence classifier, `ConflictCase` insert.
- `latest-wins` resolution: winner → `approved`, loser → `superseded`.
- `DerivationResult` stale-marking on conflict resolution.
- Conflicts inbox `GET /api/conflicts` with pagination.
- `POST /api/conflicts/{id}/resolve` (user override).
- `conflict_detected` SSE event.

**Done when:** Uploading a second document with an overlapping GHG scope 1 value creates a `ConflictCase`. The Conflicts inbox shows winning/losing values. Approving the losing observation promotes it and supersedes the other. `KeyEquivalenceCache` prevents a second Grok call for the same key pair.

---

### Slice 7 — Puppeteer PDF Worker

**Goal:** `render_pdf` produces a real downloadable PDF from stored HTML.

**Scope:**
- `worker/pdf.ts` standalone process with Puppeteer browser pool (max 3, restart after 50).
- `processPdfRenderJob` handler: `page.setContent` + `page.pdf()`, R2 upload, `Report.pdf_url` update.
- 30s timeout + 1 retry + HTML-only fallback with `Notification`.
- `render_pdf` MCP tool dispatches to queue and polls for up to 60s.
- `report_ready` SSE event + `Notification` on completion.
- `Dockerfile.pdf-worker` with Chromium dependencies.

**Done when:** Calling `render_pdf` from the agent after a full pipeline run produces a `pdf_url` in the DB. Fetching the URL returns a valid A4 PDF matching the `html_snapshot`. Worker restarts cleanly after 50 renders without orphaned Chromium processes.

---

## 5. Acceptance Criteria (Integration Tests)

### Stage 1 — OCR

| # | Check | Pass condition |
|---|-------|----------------|
| AC1-1 | Valid PDF upload triggers OCR job | `DocumentVersion.pipeline_status` transitions from `uploaded → ocr_processing → ocr_done` within 90s for a 10-page test PDF |
| AC1-2 | EvidenceBlocks created with correct structure | For each page, at least one row in `evidence_blocks` with non-null `page_number`, `bbox` (length 4), `text`, and `ocr_confidence` in range [0, 1] |
| AC1-3 | Low-confidence flagging | Inserting a mock OCR response with `ocr_confidence = 0.65` sets `low_confidence = true` and `embedding_status = 'skipped'` |
| AC1-4 | Page PNG stored in R2 | `GET /api/documents/{id}/pages/1` returns `{ page_image_url: string }` that resolves to a valid PNG (HTTP 200, content-type `image/png`) |
| AC1-5 | OCR failure → pipeline_failed | Mock PaddleOCR to return 500 twice (2 retries) → `pipeline_status = 'failed'`, `Notification` row inserted, SSE `pipeline_failed` event emitted |

---

### Stage 2 — Chunking

| # | Check | Pass condition |
|---|-------|----------------|
| AC2-1 | Adjacent blocks merged | Two adjacent `paragraph` blocks on same page with vertical gap < 20px and combined tokens ≤ 512 produce exactly one `merged` block with `merged_block_ids` containing both original IDs |
| AC2-2 | Table cells never merged | Two `table_cell` blocks adjacent with gap < 20px remain as two separate `original` blocks |
| AC2-3 | Oversized block split | A block with 600 tokens is split into ≥ 2 `split` blocks each ≤ 512 tokens, all with `parent_block_id` set to the original |
| AC2-4 | Superseded originals excluded from embedding | Original blocks that were merged or split have `embedding_status = 'skipped'` |

---

### Stage 3 — Embedding

| # | Check | Pass condition |
|---|-------|----------------|
| AC3-1 | Vectors stored for non-low-confidence blocks | After embedding job, all blocks with `low_confidence = false` and `chunk_type != superseded` have `embedding` (pgvector) non-null and `embedding_status = 'completed'` |
| AC3-2 | Batch size respected | A document with 600 embeddable blocks triggers exactly 2 OpenAI API calls (512 + 88) — verify via mock call counter |
| AC3-3 | Per-block failure isolation | Mock OpenAI to fail for one batch → that batch's blocks have `embedding_status = 'failed'`; other batches are `completed`; pipeline continues to `embedded` |
| AC3-4 | HNSW cosine query functional | `SELECT block_id FROM evidence_blocks ORDER BY embedding <=> $test_vec LIMIT 10` returns 10 rows without error after embedding job |
| AC3-5 | Status transitions correctly | `pipeline_status` moves `ocr_done → embedding → embedded`; `pipeline_status_updated_at` is updated at each transition |

---

### Stage 4 — Extraction

| # | Check | Pass condition |
|---|-------|----------------|
| AC4-1 | Hybrid retrieval returns ≤ 150 blocks | Extraction job queries DB and builds a candidate list of ≤ 150 blocks; verify via `PipelineRun.observations_skipped` reflecting blocks outside top-150 |
| AC4-2 | Observations created with required fields | Each `Observation` row has non-null `label`, `normalized_key`, `value`, `unit`, `evidence_block_ids[]` (all IDs exist in `evidence_blocks`), `confidence_score` ∈ [0, 1], `status = 'candidate'` |
| AC4-3 | Hallucination guard rejects unknown block IDs | Mock Grok to return a fact citing a non-existent `block_id` → that fact is not inserted; `PipelineRun.observations_skipped` increments |
| AC4-4 | Schema validation retry | Mock Grok to return malformed JSON on first call, valid JSON on second → `Observation` rows created; exactly 2 Grok API calls made |
| AC4-5 | Exact-match conflict creates ConflictCase | Pre-insert an approved observation with same `normalized_key` + overlapping period → after extraction, a `ConflictCase` row exists with `match_method = 'exact'`, `auto_resolved = true` |

---

### Stage 5 — SSE + Notifications

| # | Check | Pass condition |
|---|-------|----------------|
| AC5-1 | SSE stream delivers pipeline_stage_changed | Open `EventSource` to `/api/pipeline/events?company_id=X`; trigger upload; receive ≥ 5 `pipeline_stage_changed` events with correct `pipeline_status` progression |
| AC5-2 | Multi-instance fan-out via Redis pub/sub | Simulate 2 app instances (2 in-process SSE subscriptions to the same Redis channel); publishing one event delivers it to both connections |
| AC5-3 | Notification row created on pipeline_complete | After `review_ready` state, a `Notification` row with `type = 'pipeline_completed'` exists with correct `payload.document_id` |
| AC5-4 | SSE connection cleanup on client disconnect | Close the `EventSource`; verify in-memory connection map no longer contains the response object (no memory leak) |

---

### Stage 6 — Conflict Detection

| # | Check | Pass condition |
|---|-------|----------------|
| AC6-1 | pg_trgm candidate generation | Inserting two approved observations with `normalized_key` `ghg_scope1` and `ghg_scope_1` (similarity ≥ 0.5) generates exactly one candidate pair forwarded to Grok |
| AC6-2 | KeyEquivalenceCache deduplication | Approve a second observation with the same key pair after the first evaluation → no new Grok call made; cached result `SAME_KEY` used; `ConflictCase` created |
| AC6-3 | Latest-wins correctly resolves | Two conflicting observations for same key: older (`uploaded_at = T-1`) and newer (`T`). Newer becomes `approved`; older becomes `superseded` |
| AC6-4 | User override promotes superseded | `POST /api/conflicts/{id}/resolve` with the older `observation_id` → older becomes `approved`, newer becomes `superseded`, `ConflictResolution` row created, affected `DerivationResult`s marked `stale` |
| AC6-5 | conflict_detected SSE event fired | SSE stream receives `conflict_detected` event with correct `normalized_key` after conflict creation |

---

### Stage 7 — Puppeteer PDF

| # | Check | Pass condition |
|---|-------|----------------|
| AC7-1 | Valid PDF produced | After `render_pdf` job completes, `Report.pdf_url` is non-null; GET request to URL returns HTTP 200 with `Content-Type: application/pdf`; PDF is valid (non-zero byte, parseable by pdf-parse) |
| AC7-2 | Timeout fallback | Mock Puppeteer `page.pdf()` to hang past 30s → after 1 retry, `Report.pdf_url` remains null, `Notification` created with `reason = 'pdf_render_failed'`, `html_snapshot_url` remains accessible |
| AC7-3 | Worker restart after 50 renders | Submit 51 render jobs; verify Chromium browser is closed and re-launched after job #50 (check Puppeteer `browser.close()` was called exactly once during the run) |
| AC7-4 | Concurrency cap respected | Submit 6 render jobs simultaneously; verify at most 3 Puppeteer `page.setContent` calls are active at any point in time |
