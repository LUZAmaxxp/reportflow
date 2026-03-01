# Agent A — Cross-Slice Dependency Analysis & Completeness Rubric

> **Auditor:** Agent A  
> **Date:** 2026-02-21  
> **Scope:** Implementation Plan v1.7 — 6 slices × 6 criteria + FR coverage + cross-slice gaps

---

## 1. PASS/FAIL Summary Table

| Criterion | Slice 1 | Slice 2 | Slice 3 | Slice 4 | Slice 5 | Slice 6 |
|-----------|---------|---------|---------|---------|---------|---------|
| **(a)** Files: clear responsibility, no orphans | PASS | PASS | **FAIL** | PASS | PASS | PASS |
| **(b)** API routes: req/res fully specified | PASS | PASS | PASS | PASS | PASS | PASS |
| **(c)** DB entities: created in prior/same slice | PASS | **FAIL** | **FAIL** | **FAIL** | **FAIL** | PASS |
| **(d)** UI components: data source identified | PASS | PASS | **FAIL** | **FAIL** | PASS | PASS |
| **(e)** Acceptance criteria: testable | PASS | PASS | PASS | PASS | PASS | PASS |
| **(f)** Dependencies on prior slices listed | PASS | PASS | **FAIL** | **FAIL** | PASS | PASS |

**Totals:** 8 FAIL cells across 36 (22% failure rate). All 8 FAILs are in Slices 2–5; criterion (c) is the systemic weakness (4/6 slices fail).

---

## 2. Cross-Slice Dependency Issues

---

```
ID: A-001
Severity: critical
Type: gap
Where: implementation_plan.md §1.4 (observations table) vs §3.4, §3.7
Symptom: Observation table schema in Slice 1 is missing 6 columns actively used by Slice 3 API responses and extraction output: `label`, `numeric_value`, `data_type`, `time_behavior`, `confidence_score` (plan uses `extraction_confidence`), and `attestation_record_id`.
Impact: Slice 3's extraction job produces output with fields that have no DB column to write to; API responses (GET /api/observations/{id}) return fields (label, dataType, timeBehavior, numericValue, confidenceScore) that don't exist in the schema. Build will fail at the first DB insert in the extraction job.
Fix: Add to §1.4 `observations` table and migration 0001: `label TEXT NOT NULL`, `numeric_value NUMERIC`, `data_type TEXT NOT NULL DEFAULT 'text'` (or enum), `time_behavior TEXT NOT NULL DEFAULT 'none'` (or enum), `attestation_record_id UUID REFERENCES attestation_records(id)`, `created_by UUID REFERENCES users(id)`, `extraction_run_id UUID REFERENCES pipeline_runs(id)`. Rename `extraction_confidence` to `confidence_score` for spec alignment.
Slice: 1, 3
Risk-if-deferred: Extraction pipeline is unbuildable; all Slice 3 API routes return incorrect shapes.
```

---

```
ID: A-002
Severity: critical
Type: gap
Where: implementation_plan.md §1.4 (observations status enum) vs §3.8, §4.5
Symptom: Observation `status` enum is declared as `('candidate', 'approved', 'rejected')` in Slice 1 but the state machine in Slice 3 (§3.8) and conflict handler in Slice 4 (§4.5) use `superseded` and `invalidated` states. The DB enum lacks these values.
Impact: Conflict resolution (latest-wins → loser set to `superseded`) will throw a DB constraint violation. The entire conflict pipeline is non-functional.
Fix: Change the enum declaration in §1.4 and migration 0001 to: `enum('candidate', 'approved', 'rejected', 'superseded', 'invalidated')`.
Slice: 1, 3, 4
Risk-if-deferred: Conflict detection and resolution (Slices 3–4) are unbuildable.
```

---

```
ID: A-003
Severity: critical
Type: gap
Where: implementation_plan.md §1.4 (evidence_blocks table) vs §2.7 chunking strategy
Symptom: EvidenceBlock schema in Slice 1 is missing 4 columns required by Slice 2's chunking strategy: `block_type` (enum), `chunk_type` (enum: original|merged|split|superseded), `merged_block_ids` (UUID[]), `parent_block_id` (UUID FK → self). These are actively referenced in §2.7 merge/split rules and §2.8 embedding selection query (`chunk_type != "superseded"`).
Impact: Chunking logic has no columns to write to; the embedding job's WHERE clause referencing `chunk_type` will fail. Entire Slice 2 pipeline is broken.
Fix: Add to §1.4 `evidence_blocks` table and migration 0001: `block_type TEXT NOT NULL DEFAULT 'paragraph'`, `chunk_type TEXT NOT NULL DEFAULT 'original'`, `merged_block_ids UUID[]`, `parent_block_id UUID REFERENCES evidence_blocks(id)`. Add appropriate enum types or CHECK constraints.
Slice: 1, 2
Risk-if-deferred: OCR pipeline is unbuildable from Slice 2 onward.
```

---

```
ID: A-004
Severity: critical
Type: gap
Where: implementation_plan.md §1.4 (reports table) vs §5.1, §5.2, §5.10
Symptom: Report table schema in Slice 1 has only 9 columns: `{id, company_id, chat_session_id, source_report_id, version, title, html_content, pdf_url, created_at}`. Slice 5 actively uses 12+ additional columns not declared: `language`, `status` (draft|final), `reporting_period_start`, `reporting_period_end`, `html_snapshot_r2_key` (Slice 5 stores HTML in R2, not inline), `pdf_r2_key` (not a URL), `style_snapshot` (jsonb), `observation_ids[]`, `derivation_result_ids[]`, `generated_at`, `generated_by`, `client_id`.
Impact: Report creation (MCP create_report tool), PDF worker, report list/detail APIs, and version chain all reference non-existent columns. Slice 5 is fundamentally unbuildable.
Fix: Replace §1.4 `reports` schema with the spec's §7 schema. At minimum add: `client_id UUID`, `language TEXT`, `status TEXT DEFAULT 'draft'`, `reporting_period_start DATE`, `reporting_period_end DATE`, `html_snapshot_r2_key TEXT`, `pdf_r2_key TEXT`, `style_snapshot JSONB`, `observation_ids UUID[]`, `derivation_result_ids UUID[]`, `generated_at TIMESTAMPTZ`, `generated_by UUID`. Remove or rename `html_content` to `html_snapshot` if keeping inline text, or remove entirely if R2-only storage is used.
Slice: 1, 5
Risk-if-deferred: Report generation, PDF rendering, and report listing are unbuildable.
```

---

```
ID: A-005
Severity: high
Type: gap
Where: implementation_plan.md §1.4 (derivation_results table) vs §4.4, §4.5, §5.7
Symptom: DerivationResult table is missing the `stale` boolean column and `label` column. The `stale` column is actively written by Slice 4's conflict resolution (§4.4 step 5: "Mark all DerivationResults referencing affected observation IDs as stale = true") and read by Slice 5's `compute_derivation` MCP tool (returns `stale: boolean` in output). The `coverage` jsonb column and `label` column from the spec are also absent.
Impact: Conflict resolution's derivation invalidation silently fails (no column to update). `compute_derivation` returns incorrect staleness information. Derivation cache invalidation is broken.
Fix: Add to §1.4 `derivation_results` table: `stale BOOLEAN NOT NULL DEFAULT false`, `label TEXT`, `coverage JSONB`. Add a CHECK constraint on coverage shape per data_model_migration_plan.md §1.9.
Slice: 1, 4, 5
Risk-if-deferred: Derivation cache invalidation is broken; stale results served to reports without warning.
```

---

```
ID: A-006
Severity: high
Type: gap
Where: implementation_plan.md §1.4 (conflict_cases table) vs §4.4, §4.5
Symptom: ConflictCase table schema in Slice 1 is missing 4 columns actively used by Slice 4: `conflict_group_id` (UUID, for semantic grouping), `match_method` (exact|semantic), `period_start`/`period_end` (date), and `resolution_status` (auto_resolved|user_reviewed|user_overridden). The API responses in §4.4 (`GET /api/conflicts`) return all of these fields.
Impact: Semantic conflict grouping cannot be stored; conflict inbox API returns fields that don't exist in the DB. Conflict filtering by `resolutionStatus` and `matchMethod` is impossible.
Fix: Add to §1.4 `conflict_cases` table: `conflict_group_id UUID NOT NULL`, `match_method TEXT NOT NULL DEFAULT 'exact'`, `period_start DATE`, `period_end DATE`, `resolution_status TEXT NOT NULL DEFAULT 'auto_resolved'`. Remove `auto_resolved` boolean (redundant with `resolution_status`). Add `updated_at TIMESTAMPTZ`.
Slice: 1, 4
Risk-if-deferred: Conflict inbox page displays empty/broken data; semantic vs exact conflict distinction is lost.
```

---

```
ID: A-007
Severity: high
Type: gap
Where: implementation_plan.md §1.4 (chat_messages table) vs §5.2, §5.13
Symptom: ChatMessage table declares `role` as `enum('user', 'assistant', 'tool')` and `content` as `TEXT`. Slice 5 requires: `role` as `enum('user', 'agent', 'system')` (spec §7), a `type` column `enum('user_text', 'agent_text', 'agent_tool_call', 'manual_obs_request', 'report_ready', 'error')`, and `content` as `JSONB` (per-type polymorphic shapes defined in §5.13).
Impact: Chat message storage and retrieval are structurally incompatible with Slice 5's design. The `type` column is critical for the frontend's `MessageBubble` component to dispatch rendering. Without jsonb content, structured data (tool calls, report links) cannot be stored.
Fix: In §1.4 `chat_messages` table: change `role` enum to `('user', 'agent', 'system')`, add `type TEXT NOT NULL` (enum of the 6 types), change `content TEXT` to `content JSONB NOT NULL`. Retain `tool_call JSONB` or merge it into `content` by type.
Slice: 1, 5
Risk-if-deferred: Chat UI cannot reconstruct message history from DB; all message types render identically.
```

---

```
ID: A-008
Severity: high
Type: gap
Where: implementation_plan.md §1.4 (pending_manual_observations) vs §5.8
Symptom: PendingManualObservation table is missing the `expires_at` column. Slice 5 (§5.8) actively reads this column, returns it in the API response, and uses it for timeout logic ("If `expires_at` passes without action, a background timeout task sets `status = timeout`"). The `timed_out` status value is also missing from the `status` enum (plan has `pending|confirmed|skipped`).
Impact: Manual observation popup cannot show a countdown timer; timeout cleanup job has no timestamp to compare against; the popup never auto-closes.
Fix: Add `expires_at TIMESTAMPTZ NOT NULL` to §1.4 `pending_manual_observations`. Add `timed_out` to the status enum: `('pending', 'confirmed', 'skipped', 'timed_out')`.
Slice: 1, 5
Risk-if-deferred: Manual observation popups never time out; abandoned popups accumulate with `pending` status indefinitely.
```

---

```
ID: A-009
Severity: high
Type: gap
Where: implementation_plan.md §3.3 (file inventory)
Symptom: `src/app/api/observations/[id]/index.ts` is listed as the PATCH route handler for observation editing. In Next.js App Router, only `route.ts` files are recognized as route handlers. An `index.ts` file in this location is silently ignored — it will never handle HTTP requests.
Impact: The PATCH /api/observations/{id} endpoint for editing observation fields is a dead file. The edit functionality in the Review Queue and split-view is non-functional.
Fix: Remove `index.ts`. Merge the PATCH handler into `src/app/api/observations/[id]/route.ts` alongside the existing GET handler. Export both `GET` and `PATCH` named functions from the same `route.ts` file.
Slice: 3
Risk-if-deferred: Observation editing is broken; users cannot correct extraction errors.
```

---

```
ID: A-010
Severity: high
Type: gap
Where: implementation_plan.md §3.11 (ObservationFilterPanel) and §4.10 (ManualObservationForm) vs Slice 6 §6.5
Symptom: Slice 3's `ObservationFilterPanel` references `GET /api/categories` for the category tree select filter. Slice 4's `ManualObservationForm` also uses a category tree select. But `GET /api/categories` is only defined in Slice 6 (§6.5). These UI components reference an API route that won't exist for 3 slices.
Impact: Category filter on the Observations page renders empty or throws a 404. Manual observation form cannot populate the category select. Both pages are partially non-functional until Slice 6.
Fix: Move `GET /api/categories` (read-only tree endpoint) from Slice 6 to Slice 3. It requires only reading the `document_categories` table (created in Slice 1). Alternatively, add a stub `GET /api/categories` in Slice 3 that returns the flat/nested list, and expand it with POST/PATCH/DELETE/reorder in Slice 6.
Slice: 3, 4, 6
Risk-if-deferred: Category-based filtering and category selection are broken in Slices 3–5. Developers must stub the endpoint ad-hoc, creating undocumented implicit dependencies.
```

---

```
ID: A-011
Severity: medium
Type: gap
Where: implementation_plan.md §1.4 (migration 0001) + §3.6
Symptom: The `pg_trgm` PostgreSQL extension is required by Slice 3's hybrid retrieval (sparse search via `similarity()` function) and Slice 4's semantic conflict candidate generation. However, `CREATE EXTENSION pg_trgm` is not listed in any migration file. Only `pgvector` is mentioned. Additionally, GIN indexes on `evidence_blocks.text_content` (for trigram search) and `observations.normalized_key` (for conflict candidate generation) are not declared in the Slice 1 migration.
Impact: Hybrid retrieval queries fail with "function similarity() does not exist". Semantic conflict candidate generation fails similarly.
Fix: Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` to migration `0001_initial.sql`. Add `CREATE INDEX ix_eb_text_trgm ON evidence_blocks USING GIN (text_content gin_trgm_ops);` and `CREATE INDEX ix_obs_key_trgm ON observations USING GIN (normalized_key gin_trgm_ops);` to the same migration or a new `0001b_trgm_indexes.sql`.
Slice: 1, 3, 4
Risk-if-deferred: Hybrid retrieval and semantic conflict detection fail at query time.
```

---

```
ID: A-012
Severity: medium
Type: gap
Where: implementation_plan.md §1.7 (queues.ts) vs §5.11
Symptom: `src/lib/queues.ts` in Slice 1 declares 4 BullMQ queues: `ocr-job`, `embedding-job`, `extraction-job`, `semantic-conflict-job`. The `render-pdf-job` queue used by Slice 5's PDF worker is not declared. The PDF worker (§5.11) consumes this queue, and the `render_pdf` MCP tool enqueues to it.
Impact: Slice 5's `render_pdf` MCP tool cannot enqueue jobs (queue reference doesn't exist). PDF rendering is non-functional.
Fix: Add `render-pdf-job` to the queue declarations in `src/lib/queues.ts` (Slice 1 §1.7). This is a one-line addition: `export const renderPdfQueue = new Queue('render-pdf-job', { connection: redis });`.
Slice: 1, 5
Risk-if-deferred: PDF rendering is broken until a developer discovers and adds the missing queue.
```

---

```
ID: A-013
Severity: medium
Type: gap
Where: implementation_plan.md §1.4 (attestation_records table) vs project_spec.md §2.5
Symptom: The `attestation_records` table in Slice 1 is designed as an approval/rejection audit log (`{ id, observation_id, attested_by, action, note, created_at }`). The spec's AttestationRecord (§2.5) is a manual-observation provenance record with different fields: `{ attestation_id, company_id, created_by, note, source_reference, upgraded_by_observation_id }`. These are fundamentally different designs. Slice 4's `POST /api/observations/manual` creates records with `source_reference` (§4.4), but the table has no such column.
Impact: Manual observations cannot store their source reference or upgrade pointer. The dual-use design (approval audit + manual provenance) creates semantic confusion.
Fix: Either (a) split into two tables: `observation_attestations` for approval actions and `manual_attestation_records` for manual provenance, or (b) expand the existing table with: `company_id UUID REFERENCES companies(id)`, `source_reference TEXT`, `upgraded_by_observation_id UUID REFERENCES observations(id)`. Add the spec's `DEFERRABLE INITIALLY DEFERRED` FK per data_model_migration_plan.md §1.1.
Slice: 1, 4
Risk-if-deferred: Manual observation provenance chain is broken; `source_reference` data is lost.
```

---

```
ID: A-014
Severity: medium
Type: gap
Where: implementation_plan.md §1.4 (notification type enum) vs §4.7, §5.9
Symptom: Notification `type` enum is `('pipeline_done', 'conflict_detected', 'conflict_resolved', 'report_ready')`. The spec (§7) and Slice 5 require `pipeline_failed` and `manual_obs_requested` event types. These are actively used: pipeline DLQ handler creates `pipeline_failed` notifications; manual observation popup creates `manual_obs_requested` notifications.
Impact: DLQ failure notifications silently fail to insert (enum constraint violation). Manual observation request notifications are lost.
Fix: Expand the enum: `('pipeline_done', 'pipeline_failed', 'conflict_detected', 'conflict_resolved', 'report_ready', 'manual_obs_requested')`.
Slice: 1, 2, 5
Risk-if-deferred: Pipeline failure notifications and manual observation request notifications are dropped.
```

---

```
ID: A-015
Severity: medium
Type: gap
Where: implementation_plan.md (all slices) — Client entity
Symptom: The `clients` table is created in Slice 1 (§1.4) and referenced by `documents.client_id` and `reports.client_id`, but no CRUD API for clients is defined in any slice. There is no way to create, list, update, or delete Client records. The `create_report` MCP tool accepts `client_id` (§5.7) and the Report API uses it for filtering (§5.10), but users have no mechanism to populate the clients table.
Impact: Users cannot assign clients to documents or reports because no client records exist. The "for Client X" report generation flow is non-functional. The `client_id` FK on documents and reports is always null.
Fix: Add a minimal Client CRUD API to Slice 6 (or Slice 1 as part of foundation): `GET /api/clients`, `POST /api/clients`, `PATCH /api/clients/{id}`, `DELETE /api/clients/{id}`. Add a simple UI in Settings or as a select dropdown during report generation.
Slice: 6 (addition needed)
Risk-if-deferred: Client-scoped reporting ("Generate report for Client X") is non-functional; users must assign null client_id.
```

---

```
ID: A-016
Severity: medium
Type: ambiguity
Where: implementation_plan.md §1.4 (evidence_blocks.bbox) vs project_spec.md §2.3
Symptom: The Slice 1 schema declares `bbox` as `JSONB NOT NULL` with shape `{ x1, y1, x2, y2 }` (two corners, ratio coords). The spec (§2.3) declares `bbox` as `float[4]` with shape `(x, y, w, h)` — position + width/height. These are different coordinate conventions. The BboxOverlay component (§3.9) renders `<rect>` using `x1, y1, x2, y2` from the plan, not `x, y, w, h` from the spec.
Impact: If anyone implements against the spec instead of the plan, bbox rendering will be incorrect (wrong rectangle dimensions). The data_model_migration_plan.md §1.8 references `float[4]` with a CHECK constraint on length — inconsistent with the plan's JSONB decision.
Fix: Standardize on one convention and update both the spec and data_model_migration_plan.md. Recommended: keep the plan's JSONB `{ x1, y1, x2, y2 }` format (more readable, supports named fields). Update spec §2.3 and data_model_migration_plan.md §1.8 accordingly.
Slice: 1, 3
Risk-if-deferred: Developers implementing the SVG overlay may use incorrect coordinate math, producing misaligned evidence block highlights.
```

---

```
ID: A-017
Severity: medium
Type: under-specification
Where: implementation_plan.md §1.4 (document_versions pipeline_status enum)
Symptom: The pipeline_status enum values in §1.4 are `('pending', 'ocr_processing', 'ocr_complete', 'embedding', 'embedded', 'extraction', 'done', 'failed')`. However: (1) the spec uses `uploaded` not `pending` as the initial state; (2) the spec uses `extracting` not `extraction`; (3) the spec uses `review_ready` not `done`; (4) Slice 2's status badge mapping (§2.12) uses `ocr_done` not `ocr_complete`. The enum is inconsistent across sections.
Impact: Front-end badge mapping breaks on mismatched status strings. Pipeline worker status transitions may silently fail if they write a value not in the enum.
Fix: Align the enum with the spec's canonical values: `('uploaded', 'ocr_processing', 'ocr_done', 'embedding', 'embedded', 'extracting', 'review_ready', 'failed')`. Update §1.4 and all references.
Slice: 1, 2, 3
Risk-if-deferred: Status badge displays "Unknown" or blank; pipeline status queries return no results for certain states.
```

---

```
ID: A-018
Severity: medium
Type: under-specification
Where: implementation_plan.md §1.4 (provenance_type enum)
Symptom: Observation `provenance_type` is declared as `enum('extracted', 'manual', 'derived')` in §1.4. The spec uses `'document' | 'manual'` (no 'derived'). Slice 3 uses `provenance_type = "document"` in the extraction job (§3.5 step 13) and Slice 4 uses `provenance_type = "manual"` for manual observations (§4.4). Neither slice uses `'extracted'` or `'derived'`.
Impact: Extraction job writes `provenance_type = "document"` which fails the enum constraint (only `extracted` is valid). A "derived" provenance type is conceptually wrong — derivation results are separate entities, not observations.
Fix: Change the enum to `('document', 'manual')` to match the spec and usage in Slices 3–4.
Slice: 1, 3, 4
Risk-if-deferred: First observation INSERT in the extraction job fails with an enum constraint violation.
```

---

```
ID: A-019
Severity: low
Type: gap
Where: implementation_plan.md §1.4 vs §2.11
Symptom: The `embedding_status` field recommended by pipeline_plan.md R4 ("Add `embedding_status ENUM('pending'|'completed'|'failed'|'skipped')` to EvidenceBlock") is not in the Slice 1 schema. Slice 2's embedding job (§2.8) references it: "On failure for batch: mark those blocks embedding_status = 'failed'." Without this column, failed embedding blocks are indistinguishable from not-yet-embedded blocks (both have `embedding IS NULL`).
Impact: Embedding retries re-process permanently failed blocks on every retry. The extraction job cannot distinguish "not yet embedded" from "embedding permanently failed" blocks.
Fix: Add `embedding_status TEXT NOT NULL DEFAULT 'pending'` to §1.4 `evidence_blocks` table. Add CHECK constraint or enum: `('pending', 'completed', 'failed', 'skipped')`.
Slice: 1, 2
Risk-if-deferred: Minor — the plan's query uses `embedding IS NULL` as a workaround, but failed blocks will be retried indefinitely.
```

---

```
ID: A-020
Severity: low
Type: risk
Where: implementation_plan.md §2.8 (extraction-job dispatch) vs §3.1
Symptom: Slice 2's embedding job enqueues `extraction-job` (step 10) but the consumer is only defined in Slice 3. Between completing Slice 2 and starting Slice 3 implementation, extraction jobs will queue up in Redis with no consumer. This is by design but is not documented as a known intermediate state.
Impact: No user-facing impact during development. However, if Slice 2 is tested in isolation, queued extraction jobs will appear as "stuck" in BullMQ dashboard, potentially confusing developers.
Fix: Add a note in Slice 2's §2.17 acceptance criteria or §2.16 edge cases: "extraction-job is enqueued but will not be consumed until Slice 3 is implemented. Jobs will remain in the `waiting` state in BullMQ until the extraction worker is registered."
Slice: 2, 3
Risk-if-deferred: Developer confusion during Slice 2 testing; no production impact.
```

---

```
ID: A-021
Severity: low
Type: contradiction
Where: implementation_plan.md header (Slice 1 summary) vs §1.4
Symptom: The Slice 1 header states "Key DB entities: All 20 tables created" but §1.4 lists and counts 21 tables. The discrepancy is in the header text only.
Impact: Cosmetic; may cause confusion during planning reviews.
Fix: Change the header count from "20" to "21".
Slice: 1
Risk-if-deferred: None; cosmetic.
```

---

```
ID: A-022
Severity: medium
Type: gap
Where: implementation_plan.md §1.4 (document_versions table) vs project_spec.md §7
Symptom: The `document_versions` table in §1.4 is missing `company_id` (denormalized for RLS), `file_hash` (SHA-256), `detected_type`, `ocr_quality_warning`, and `pipeline_status_updated_at` columns that are defined in the spec. Without `company_id` on document_versions, RLS policies cannot be applied directly to this table — queries must always JOIN through `documents` to get the company scope.
Impact: RLS enforcement requires an extra JOIN for every document_version query; pipeline worker can't use `withTenant` directly on document_version reads. `detected_type` field referenced by dashboard (§6.2 recent_documents shape) has no column to read from.
Fix: Add `company_id UUID NOT NULL REFERENCES companies(id)` (+ RLS policy), `file_hash TEXT`, `pipeline_status_updated_at TIMESTAMPTZ`, and optionally `detected_type TEXT`, `ocr_quality_warning BOOLEAN DEFAULT false` to §1.4 document_versions table.
Slice: 1, 2, 6
Risk-if-deferred: RLS on document_versions requires extra JOINs; dashboard recent_documents returns null for detected_type.
```

---

## 3. FR Coverage Check (FR-1 through FR-41)

| FR | Description | Slice(s) | Status |
|----|-------------|----------|--------|
| FR-1 | Upload PDF/images via drag-and-drop or file picker | 2 | **Covered** |
| FR-2 | System performs OCR on uploaded documents (PaddleOCR-VL 1.5) | 2 | **Covered** |
| FR-3 | System splits OCR text into EvidenceBlocks with bbox coordinates | 2 | **Covered** (but schema gap A-003) |
| FR-4 | System stores full-page images for visual overlay | 2 | **Covered** |
| FR-5 | System embeds evidence blocks for vector search | 2 | **Covered** |
| FR-6 | System extracts structured observations via LLM (Grok) | 3 | **Covered** |
| FR-7 | Each observation includes label, normalized_key, value, unit, confidence, data_type, time_behavior, period | 3 | **Covered in logic** (but schema gap A-001) |
| FR-8 | Observations below confidence threshold are flagged for review | 3 | **Covered** (all are candidates; confidence for ranking only) |
| FR-9 | User can approve/reject/edit observations in review queue | 3 | **Covered** |
| FR-10 | System detects conflicting observations (same normalized_key, different values) | 3 (exact), 4 (semantic) | **Covered** |
| FR-11 | System provides conflict resolution UI with latest-wins default | 4 | **Covered** |
| FR-12 | User can manually add observations | 4 | **Covered** |
| FR-13 | Manual observations are immediately approved (confidence=1.0) | 4 | **Partial** — plan allows `status: "candidate"` OR `"approved"` at creation (§4.4). FR-13 implies always-approved. The plan's flexibility is arguably better but deviates from the FR. |
| FR-14 | System computes derivations (sum, avg, min, max, ratio) on approved observations | 5 | **Covered** (but `min`/`max` not listed in spec §10.2 operations; plan supports sum, avg, delta, ratio, count) |
| FR-15 | Derivation results are cached with hash-based invalidation | 5 | **Covered** (but `stale` column gap A-005) |
| FR-16 | System provides RAG-powered chat interface | 5 | **Covered** |
| FR-17 | Chat agent uses MCP tools to search observations, evidence, compute derivations | 5 | **Covered** |
| FR-18 | Chat agent can propose manual observations via popup | 5 | **Covered** |
| FR-19 | Chat agent generates ISO 26000-aligned reports | 5 | **Covered** |
| FR-20 | Reports include HTML snapshot and PDF rendering | 5 | **Covered** (but schema gap A-004) |
| FR-21 | User can regenerate reports with style instructions | 5 | **Covered** |
| FR-22 | System learns user preferences via mem0 | 5, 6 | **Covered** |
| FR-23 | System maps observations to ISO 26000 themes dynamically | 5 | **Covered** |
| FR-24 | User can organize documents into categories (tree structure) | 6 | **Covered** |
| FR-25 | Categories support drag-and-drop reordering | 6 | **Covered** |
| FR-26 | System provides real-time pipeline status via SSE | 2 | **Covered** |
| FR-27 | System sends notifications for pipeline events | 4 | **Covered** |
| FR-28 | Dashboard shows aggregate statistics | 6 | **Covered** |
| FR-29 | System supports multi-tenant isolation (company-level) | 1 | **Covered** |
| FR-30 | Role-based access control (admin, editor, viewer) | 1 (JWT), 3+ (enforcement) | **Covered** |
| FR-31 | Audit logging for state changes | 3, 4, 5, 6 | **Covered** |
| FR-32 | System provides document detail view with split-pane (text + image overlay) | 3 | **Covered** |
| FR-33 | Evidence blocks are visually highlighted on page images | 3 | **Covered** |
| FR-34 | Observations list with filtering by document, category, status | 3 | **Covered** (but category filter depends on Slice 6 API; see A-010) |
| FR-35 | Report version history with lineage tracking | 5 | **Covered** |
| FR-36 | User can merge duplicate observations | 6 | **Covered** |
| FR-37 | System detects near-duplicate observations semantically | 4 | **Covered** |
| FR-38 | SSE reconnection with Last-Event-ID replay | 2 (pipeline), 5 (chat) | **Covered** |
| FR-39 | All UI strings in French | 6 (polish pass) | **Covered** |
| FR-40 | Responsive sidebar (collapses on small screens) | 1, 6 | **Covered** |
| FR-41 | Onboarding flow for first-time users | 6 | **Covered** |

**Summary:** All 41 FRs are covered by at least one slice. 1 FR has a partial coverage issue (FR-13), and 1 FR has an operation mismatch (FR-14: `min`/`max` from the FR list are not in the spec's supported operations — `delta` and `count` are provided instead).

---

## 4. Orphan Files, Undefined Data Sources, and Untestable Criteria

### 4.1 Orphan / Invalid Files

| File | Issue | Slice |
|------|-------|-------|
| `src/app/api/observations/[id]/index.ts` | **Invalid Next.js App Router file.** Route handlers must be named `route.ts`. This file is silently ignored by Next.js — PATCH /api/observations/{id} is dead code. | 3 |
| `workers/pipeline/index.ts` (Slice 1 version) | Declared as "Worker process entry — connects Redis, registers queues (no consumers yet)" with no consumers. This is an empty entry-point shell that does nothing. Not orphaned per se, but creates a confusing state where `node workers/pipeline/index.ts` starts and immediately idles. | 1 |

### 4.2 Undefined Data Sources

| Component | Missing Data Source | Slice |
|-----------|-------------------|-------|
| `ObservationFilterPanel` → Category tree select | `GET /api/categories` not available until Slice 6 | 3 |
| `ManualObservationForm` → Category tree select | `GET /api/categories` not available until Slice 6 | 4 |
| `ManualObsPopup` → Category select | Same as above — category select in the popup (§5.9) needs `GET /api/categories` | 5 |
| `DocumentsTable` → `clientId` field | No Client CRUD API in any slice; `clientId` in document list items has no source for display (client name lookup) | 2 |
| Sidebar `ConflictsBadge` → unresolved count | §4.9 says "Unresolved count from `GET /api/conflicts?resolutionStatus=auto_resolved` initial fetch" — but this endpoint is defined in Slice 4. The badge is added to the sidebar in Slice 4. This is self-consistent within Slice 4. | 4 (OK) |

### 4.3 Untestable Acceptance Criteria

All acceptance criteria across all 6 slices are testable — they use specific, measurable language (HTTP status codes, exact field values, timing thresholds, row counts). No vague "should work" language was found.

**One near-untestable criterion:** Slice 2 §2.17: "Uploading a PDF under 50MB triggers pipeline; DocumentVersion.pipeline_status reaches `embedded` within 5 minutes (p95)." The "p95" qualifier requires multiple runs to measure statistically, making it unsuitable as a single-pass acceptance check. However, a single run completing within 5 minutes is a reasonable proxy.

---

## 5. Consolidated Risk Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| Critical | 4 | Slice 1 DB schema missing columns needed by Slices 2–5 (A-001 through A-004) |
| High | 5 | Schema enums incomplete, file naming error, forward API dependency (A-005 through A-010) |
| Medium | 8 | Missing extension/indexes, queue declaration, enum mismatches, client CRUD gap (A-011 through A-018, A-022) |
| Low | 3 | Embedding status, job consumer gap, cosmetic count error (A-019 through A-021) |

**Root cause of most issues:** The Slice 1 DB schema (§1.4) was written as a simplified summary that diverged significantly from the spec's entity definitions (§7, §2.3–§2.6). Slices 2–5 were then written against the spec's richer schema, creating a systemic mismatch. **The single highest-impact fix is to reconcile §1.4 with the spec's §7 entity schemas before any implementation begins.**
