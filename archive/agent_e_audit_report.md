# Agent E — End-to-End MVP Journey Simulator

> **Scope:** Simulate the complete user journey through the system and identify missing transitions, orphan states, recovery paths, and UX dead ends.  
> **Journey:** Upload → OCR → Blocks → Embedding → Extraction → Review → Conflicts → Chat → Manual Popup → Derivation → Report → PDF → Regenerate → Dashboard / Notifications  
> **Documents read:** `project_spec.md`, `implementation_plan.md`, `pipeline_plan.md`, `data_model_migration_plan.md`, `frontend_plan.md`  
> **Fixed decisions (not reopened):** Three-process deployment · `LOW_CONFIDENCE_THRESHOLD = 0.70` · bbox as ratio coords (0.0–1.0) · Puppeteer in dedicated container

---

## Issues

---

### E-01 — Observation status enum in implementation plan missing `superseded` and `invalidated`

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Type** | Orphan State / Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `observations.status` vs `project_spec.md` §2.5 |
| **Symptom** | Implementation plan declares `status ENUM('candidate', 'approved', 'rejected')`. Spec requires five states: `candidate | approved | rejected | superseded | invalidated`. The conflict resolution flow (§11.2–§11.3) transitions losers to `superseded`; document re-processing (§2.5) transitions stale observations to `invalidated`. Neither state exists in the implementation schema. |
| **Impact** | Conflict resolution cannot mark the losing observation — latest-wins policy is unimplementable. The entire Conflict Inbox UI (Slice 4) shows winning/losing values, but there is no DB state to represent the loser. Any query for "current approved observations" cannot filter out superseded ones. Derivation pre-checks (`status = approved`) will include both winner and loser. |
| **Fix** | Extend the observation status enum to `candidate | approved | rejected | superseded | invalidated` in `0001_initial.sql`. Add the transition rules from spec §2.5 as application-layer guards in `PATCH /api/observations/{id}/status`. |
| **Slice** | 1 (schema), 4 (conflict logic) |
| **Risk if deferred** | Conflict resolution is blocked entirely. No observation can ever be superseded; reports may include contradictory data for the same metric and period. |

---

### E-02 — Pipeline exact-match conflict detection fires on candidates, not approved observations

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Type** | Missing Transition |
| **Where** | `pipeline_plan.md` Stage 4 step 8 vs `project_spec.md` §11.1 |
| **Symptom** | Stage 4 step 8 says: "For each new observation: query existing observations for same `company_id`, same `normalized_key`, overlapping period, `status = 'approved'`… create ConflictCase… apply latest-wins policy." But the new observation is `status = candidate` — it exits the pipeline as a candidate (§5.2, FR-7). Applying latest-wins would supersede an already-approved observation based on an unreviewed candidate. The spec §11.1 explicitly states conflicts exist between "two or more **approved** observations." |
| **Impact** | A user who approved observation A (Scope 1 = 1200 tCO2e) uploads a new document. The pipeline creates candidate observation B (Scope 1 = 1500 tCO2e) and immediately supersedes observation A. The user has lost their approved data before reviewing B. If B is later rejected, observation A remains superseded with no mechanism to restore it. |
| **Fix** | Pipeline Stage 4 should only **flag** potential exact-match conflicts (store a `ConflictCase` with `resolution_status = 'pending'` and `winning_observation_id = NULL`) but NOT apply latest-wins or change any observation's status. Actual conflict resolution (latest-wins + status transitions) should trigger only when the new observation is approved — either via the `semantic-conflict-job` (already designed for approval-time) or an inline check in `PATCH /api/observations/{id}/status`. |
| **Slice** | 3 (extraction job) |
| **Risk if deferred** | Approved observations are silently superseded by unreviewed candidates. Data integrity violation — directly contradicts the "no auto-approval" invariant (FR-7). |

---

### E-03 — `pipeline_status` enum values diverge between spec and implementation plan

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `document_versions.pipeline_status` vs `project_spec.md` §5.1 |
| **Symptom** | Spec defines: `uploaded → ocr_processing → ocr_done → embedding → embedded → extracting → review_ready \| failed`. Implementation plan defines: `pending → ocr_processing → ocr_complete → embedding → embedded → extraction → done \| failed`. Four values differ: `uploaded`↔`pending`, `ocr_done`↔`ocr_complete`, `extracting`↔`extraction`, `review_ready`↔`done`. |
| **Impact** | Every consumer of `pipeline_status` is affected: SSE event payloads (§16.1 uses spec values), frontend `PipelineStageBadge` component, pipeline worker gate checks, `GET /api/documents/{id}/status` response, Dashboard `documents_by_status` keys, and the French UI labels (which differ by status string). If SSE publishes `"review_ready"` but the frontend switch statement expects `"done"`, the badge stays on "Extraction…" forever. |
| **Fix** | Align the implementation plan enum to match the spec exactly: `uploaded \| ocr_processing \| ocr_done \| embedding \| embedded \| extracting \| review_ready \| failed`. Update all references in the worker gate checks, SSE publisher, and frontend badge mapping. |
| **Slice** | 1 (schema) |
| **Risk if deferred** | Every status-dependent feature (SSE badges, dashboard counts, gate checks) must be patched individually. High risk of silent mismatches at integration time. |

---

### E-04 — `embedding_status` field absent from both spec schema and implementation plan schema

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Orphan State |
| **Where** | `pipeline_plan.md` R4 mitigation vs `project_spec.md` §2.3 vs `implementation_plan.md` §1.4 `evidence_blocks` |
| **Symptom** | Pipeline plan R4 says: "Add `embedding_status ENUM('pending' \| 'completed' \| 'failed' \| 'skipped')` to EvidenceBlock." The pipeline's embedding job, chunking logic, and retrieval queries all depend on this field. But neither the spec §2.3 EvidenceBlock schema, the data model migration (0003), nor the implementation plan §1.4 `evidence_blocks` table include it. The migration only has `low_confidence` (boolean) and `embedding` (nullable vector). |
| **Impact** | The embedding job cannot distinguish "not yet processed" from "permanently failed." Retry logic re-embeds already-completed blocks. The extraction job's retrieval query cannot filter to `embedding_status = 'completed'` — it must guess from `embedding IS NOT NULL`, which conflates "failed" with "pending." Chunking cannot mark superseded originals as `skipped`. |
| **Fix** | Add `embedding_status` column to the `evidence_blocks` table in migration 0003. Default `'pending'`. Set `'skipped'` for `low_confidence = true` blocks and for original blocks superseded by merging/splitting. Set `'completed'` after successful embedding. Set `'failed'` after all retries exhausted. Gate retrieval queries on `WHERE embedding_status = 'completed'`. |
| **Slice** | 1 (schema), 2 (OCR + embedding jobs) |
| **Risk if deferred** | Embedding retry wastes OpenAI quota. Retrieval includes un-embedded blocks (null vectors crash cosine distance). |

---

### E-05 — Chunking merge threshold "20px vertical gap" is incompatible with ratio coordinates

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `project_spec.md` §9.2 / `pipeline_plan.md` Stage 2 step 2 vs fixed decision (bbox = ratio 0.0–1.0) |
| **Symptom** | The chunking merge rule (§9.2) states: "adjacent blocks on the same page with vertical gap < 20px." The fixed decision specifies bboxes as ratio coordinates relative to page dimensions (0.0–1.0). The pipeline worker normalizes PaddleOCR pixel bboxes by dividing by page width/height. After normalization, "20px" has no meaning — a 20px gap on a 3000px-tall page is 0.0067 in ratio coords; on a 1000px-tall page it is 0.02. The threshold varies by page resolution. |
| **Impact** | The merge step either (a) uses 20 as a ratio threshold (merging nothing, since gaps are always < 1.0), (b) uses 0.02 as a hardcoded approximation (wrong for high-DPI pages), or (c) crashes because the comparison is nonsensical. Incorrect merging degrades embedding quality and retrieval precision. |
| **Fix** | Define the merge gap threshold as a ratio constant, not absolute pixels. Recommended: `MERGE_GAP_THRESHOLD = 0.015` (~20px on a typical 1333px A4 page at 150 DPI). Alternatively, pass the page pixel dimensions from the OCR response into the chunking function and convert 20px to a ratio per page. Document the chosen approach in `src/lib/constants.ts`. |
| **Slice** | 2 (chunking logic) |
| **Risk if deferred** | Blocks are incorrectly merged or never merged. Extraction LLM receives fragmented context. |

---

### E-06 — Observation schema in implementation plan missing `label`, `numeric_value`, `data_type`, `time_behavior`

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Type** | UX Dead End / Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `observations` vs `project_spec.md` §2.5 |
| **Symptom** | The implementation plan `observations` table omits: `label` (human-readable name), `numeric_value` (decimal for computations), `data_type` (numeric \| percentage \| text \| boolean), `time_behavior` (periodic \| point_in_time \| none), `attestation_record_id` (FK for manual obs), `confidence_score` (uses `extraction_confidence` instead), and `created_by`. |
| **Impact** | (1) **`label`**: the Review Queue, Observation cards, Conflict inbox, and report sections all display by `label` — without it, the UI shows only `normalized_key` (e.g., `ghg_scope1` instead of "GHG Emissions Scope 1"). (2) **`data_type` + `time_behavior`**: derivation pre-checks require `data_type = numeric \| percentage` (§10.2); the manual observation popup form requires `time_behavior` to conditionally show period pickers (§5.4.1). (3) **`numeric_value`**: derivation operations (`sum`, `average`, `delta`, `ratio`) operate on `numeric_value` — without it, the engine must parse `value` (text) at compute time, losing precision and type safety. (4) **`attestation_record_id`**: manual observations cannot link to their attestation proof. |
| **Fix** | Add all missing columns to the `observations` table: `label TEXT NOT NULL`, `numeric_value NUMERIC`, `data_type data_type_enum NOT NULL`, `time_behavior time_behavior_enum NOT NULL`, `attestation_record_id UUID REFERENCES attestation_records(id)`, rename `extraction_confidence` → `confidence_score`, add `created_by UUID REFERENCES users(id)`. |
| **Slice** | 1 (schema) |
| **Risk if deferred** | Review Queue is unusable (no label). Derivation engine cannot perform pre-checks or compute. Manual observation popup cannot render `time_behavior` controls. |

---

### E-07 — Report schema missing `observation_ids[]`, `derivation_result_ids[]`, and 8 other spec fields

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Type** | Missing Transition / Traceability Break |
| **Where** | `implementation_plan.md` §1.4 `reports` vs `project_spec.md` §7 Report |
| **Symptom** | Implementation plan `reports` table has: `id`, `company_id`, `chat_session_id`, `source_report_id`, `version`, `title`, `html_content`, `pdf_url`, `created_at`. Missing: `client_id`, `language`, `status` (draft \| final), `reporting_period_start/end`, `html_snapshot_url`, `style_snapshot` (JSONB), `observation_ids[]` (UUID[]), `derivation_result_ids[]` (UUID[]), `generated_at`, `generated_by`. |
| **Impact** | (1) **`observation_ids[]` / `derivation_result_ids[]`**: the core traceability promise ("every reported fact must trace to an approved observation") is broken — the report cannot enumerate which observations it references. `get_report_data` MCP tool (§15.9) returns associated observations by reading these arrays; without them, it returns nothing. (2) **`html_snapshot_url`**: the frontend `ReportIframe` loads the report in a sandboxed iframe via this URL. Without it, the iframe has no `src`. The fallback is `dangerouslySetInnerHTML`, which the spec explicitly forbids for security (§5.6). (3) **`language` / `client_id`**: `GET /api/reports` filters by client and the regeneration flow needs the language to re-invoke the agent — both impossible without these fields. (4) **`style_snapshot`**: the mem0 preference snapshot at generation time is lost — regeneration cannot show what changed. |
| **Fix** | Add all missing columns to the `reports` table. At minimum for MVP: `client_id UUID REFERENCES clients(id)`, `language TEXT NOT NULL`, `status report_status NOT NULL DEFAULT 'draft'`, `reporting_period_start DATE`, `reporting_period_end DATE`, `html_snapshot_url TEXT NOT NULL`, `style_snapshot JSONB`, `observation_ids UUID[] NOT NULL DEFAULT '{}'`, `derivation_result_ids UUID[] NOT NULL DEFAULT '{}'`, `generated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `generated_by UUID REFERENCES users(id)`. |
| **Slice** | 1 (schema), 5 (report creation) |
| **Risk if deferred** | Reports are unauditable — no traceability chain. Report detail page cannot render in iframe. Filtering by client impossible. Entire demo script (§13.1 steps 6–7) fails. |

---

### E-08 — `chat_message.content` typed as `text` in implementation plan; must be `JSONB`

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `chat_messages` vs `project_spec.md` §7 ChatMessage / `data_model_migration_plan.md` 0006 |
| **Symptom** | Implementation plan declares `content TEXT NOT NULL`. Spec §7 and migration 0006 both define `content JSONB NOT NULL` with shape varying by `type` field. The implementation plan also adds a separate `tool_call JSONB` column (not in spec). The message `type` enum itself is missing from the implementation plan (spec defines: `user_text \| agent_text \| agent_tool_call \| manual_obs_request \| report_ready \| error`). The `role` enum uses `assistant \| tool` instead of spec's `agent \| system`. |
| **Impact** | The chat SSE stream delivers structured payloads: `manual_obs_request` includes `{ pending_id, prefilled: {...} }`, `report_ready` includes `{ report_id, title, html_snapshot_url, pdf_url }`, `agent_tool_call` includes `{ tool_name, summary, details }`. These are persisted in `content` for session replay. With `TEXT` type, this structured data is stringified and must be re-parsed, losing type safety. The `tool_call` column creates an alternative data path that conflicts with the spec's `type`-based content polymorphism. The role mismatch (`assistant` vs `agent`) affects every frontend role check and message rendering. |
| **Fix** | Change `content` to `JSONB NOT NULL`. Add `type` column as `chat_message_type ENUM`. Align `role` to spec: `user \| agent \| system`. Remove the separate `tool_call` column. |
| **Slice** | 1 (schema), 5 (chat logic) |
| **Risk if deferred** | Chat session replay renders broken cards. `manual_obs_request` message not reconstructable on page refresh (frontend R3 mitigation depends on stored message type). |

---

### E-09 — `attestation_record` schema serves a completely different purpose in implementation plan vs spec

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `attestation_records` vs `project_spec.md` §2.5 |
| **Symptom** | **Spec** defines AttestationRecord as the **evidence anchor for manual observations**: `attestation_id`, `company_id`, `created_by`, `note` (1000 chars), `source_reference` (URL, 500 chars), `upgraded_by_observation_id`. It is linked FROM observation via `observation.attestation_record_id`. **Implementation plan** defines it as an **approval action log**: `observation_id` (FK → observations), `attested_by`, `action` (approved \| rejected \| overridden), `note`. It is linked TO observation, not from it. Fields `company_id`, `source_reference`, `upgraded_by_observation_id` are absent. The `action` enum doesn't exist in the spec. |
| **Impact** | Manual observations cannot be created. The spec requires `provenance_type = 'manual'` observations to have `attestation_record_id` pointing to an AttestationRecord with `source_reference` and `note` as proof. Without this structure: (1) `POST /api/observations/manual` has no attestation target to create, (2) `POST /api/manual-observations/pending/{id}/confirm` cannot create the attestation + observation pair, (3) the DB constraint `manual_obs_needs_attestation` (migration 0004) has nothing to reference, (4) manual observation display cannot show "Source: [URL]" or "Attested by: [user]". |
| **Fix** | Rewrite `attestation_records` to match spec: `id UUID PK`, `company_id FK → companies`, `created_by FK → users`, `note TEXT (max 1000)`, `source_reference TEXT (max 500)`, `upgraded_by_observation_id UUID FK → observations`. Remove the `action` enum. Add `attestation_record_id UUID FK → attestation_records` to the `observations` table. If an approval action log is also needed, create a separate `observation_status_changes` table or use the existing `audit_log`. |
| **Slice** | 1 (schema), 3 (manual obs creation), 5 (manual obs popup) |
| **Risk if deferred** | Manual observations are completely blocked. The manual observation popup (§5.4.1) — a core part of the demo flow (§13.1 step 4) — cannot function. |

---

### E-10 — `render_pdf` MCP tool has no defined polling or callback mechanism

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `project_spec.md` §15.6 / `pipeline_plan.md` Stage 6 / `implementation_plan.md` Slice 5 |
| **Symptom** | `render_pdf` MCP tool (§15.6) expects a synchronous return: `{ pdf_url, report_id }`. But PDF rendering is an async BullMQ job (`render-pdf-job`) on a separate process. The pipeline plan says "dispatches a job and polls for completion." No polling endpoint, polling interval, timeout, or completion callback is defined. The implementation plan Slice 5 §5.16 says `render_pdf` "queues job → waits" without specifying how it waits. |
| **Impact** | The agent calls `render_pdf(report_id)` after `create_report`. If it returns immediately, `pdf_url` is null. If it "waits," it blocks the agent's SSE stream for up to 30s (render timeout) + 30s (retry) = 60s with no intermediate feedback. The chat's `report_ready` SSE event includes `pdf_url: string \| null` — if null, the download button is dead. No defined recovery: no "PDF still rendering, check back later" state. |
| **Fix** | Define the completion mechanism explicitly. Recommended: `render_pdf` dispatches the BullMQ job and polls `Report.pdf_url` every 2 seconds for up to 60 seconds. If still null, return `{ pdf_url: null, status: "rendering" }`. The `report_ready` SSE event sends whatever is available. The Report detail page shows a "PDF en cours de génération…" state when `pdf_url` is null and polls `GET /api/reports/{id}` every 5 seconds until `pdf_url` is populated. Define the frontend fallback state in Slice 5. |
| **Slice** | 5 (MCP tool + frontend) |
| **Risk if deferred** | Demo step 6 ("rendered to PDF via Puppeteer → displayed in Reports tab") shows a broken download link or hangs the agent stream for 60s with no user feedback. |

---

### E-11 — Report regeneration outside chat has no agent invocation path

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | UX Dead End |
| **Where** | `project_spec.md` §16 `POST /api/reports/{id}/regenerate` / `implementation_plan.md` Slice 5 |
| **Symptom** | The report detail page (`/reports/[id]`) has a "Regenerate" button that calls `POST /api/reports/{id}/regenerate`. The regeneration contract (§16) says: "Re-runs the full report generation flow (§5.4 steps 1–9) using the source report's observation_ids[]." Steps 1–9 include: identify ISO sections, read mem0 preferences, search_observations, compute_derivation, generate HTML, create_report, render_pdf. This requires the **agent loop** (Grok LLM calls, MCP tool orchestration). But `POST /api/reports/{id}/regenerate` is a REST endpoint on the Next.js server — no mechanism is defined for it to invoke the agentic flow. It is not connected to a chat session. |
| **Impact** | Clicking "Regenerate" on a report either: (a) returns 500 because the route handler has no agent implementation, (b) makes Grok calls synchronously in the route handler (blocking the HTTP response for 30–60s with no streaming), or (c) does nothing. The user has no progress feedback — no SSE stream exists outside a chat session. Demo step 7 ("user says 'Make it more concise' → mem0 learns → report regenerates") works only from chat, not from the report detail page. |
| **Fix** | Option A: Regeneration always creates a new chat session behind the scenes and redirects the user to `/chat?session={id}` where they can see the agent working. The "Regenerate" button becomes "Regénérer via Chat" and opens the chat with a pre-filled system message. Option B: Define a `regeneration-job` BullMQ queue consumed by the pipeline worker. The REST endpoint enqueues the job and returns `{ status: "regenerating" }`. The frontend polls `GET /api/reports/{id}` until status changes from `draft` to `final` and a new version appears. Either way, document the chosen path in Slice 5. |
| **Slice** | 5 |
| **Risk if deferred** | "Regenerate" button is a dead control. Users must return to chat to regenerate, which is unintuitive and undiscoverable from the report detail page. |

---

### E-12 — Fewer than 10 retrieved blocks silently skips extraction with no user explanation

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | UX Dead End |
| **Where** | `project_spec.md` §5.2 / `pipeline_plan.md` Stage 4 step 4 |
| **Symptom** | When fewer than 10 blocks are retrieved by hybrid search, the pipeline logs `insufficient_blocks`, sets `pipeline_status = review_ready` (via `done` in impl plan), publishes `extraction_complete` SSE with `observations_created: 0`, and returns. The user sees a pipeline completion toast ("Document traité — 0 observations extraites") and an empty review queue. No explanation is provided for why zero observations were extracted. |
| **Impact** | A user uploads a scanned document with poor OCR quality. All blocks are `low_confidence` → all are excluded from embedding → zero embeddable blocks → insufficient_blocks → zero observations. The user sees "0 observations" with no guidance. They cannot tell whether to re-upload a higher quality scan, whether the document type is unsupported, or whether the system failed. This is an especially likely scenario for non-native-PDF documents (images, scans of faxes). |
| **Fix** | (1) Add a `pipeline_warning` field (nullable text) to `document_version`. When `insufficient_blocks` triggers, set it to `"insufficient_embeddable_blocks"`. (2) The SSE `extraction_complete` event includes a `warning` field. (3) The Documents list and document detail page show a yellow warning badge: "Pas assez de contenu exploitable détecté. Vérifiez la qualité du document." (4) The notification includes the reason. |
| **Slice** | 3 (extraction job), 2 (SSE), frontend Slice 3 |
| **Risk if deferred** | Users re-upload the same bad document repeatedly, generating support requests. |

---

### E-13 — No stuck-pipeline detection or manual retry mechanism

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Recovery Path |
| **Where** | `implementation_plan.md` (all slices) / `pipeline_plan.md` R8 |
| **Symptom** | If the pipeline worker crashes mid-job (OOM, unhandled exception, process kill), `DocumentVersion.pipeline_status` remains at the interrupted state (e.g., `ocr_processing`). BullMQ marks the job as stalled and may retry it, but only if the worker restarts within the stall-check interval (default 30s). If the worker is permanently down or the job exceeds the maximum retry count, the document is stuck forever. No cron job, health check, or administrative endpoint exists to detect or recover these stuck documents. No UI control exists for the user to retry a failed pipeline. |
| **Impact** | A document stuck at `ocr_processing` shows an animated "OCR en cours…" badge indefinitely. The user cannot retry, cannot delete the stuck document version, and has no feedback that anything went wrong. Over time, stuck documents accumulate. |
| **Fix** | (1) Add `POST /api/documents/{id}/retry` (editor role) that resets `pipeline_status → uploaded` and re-enqueues `ocr-job`. Gate: only callable when `pipeline_status = 'failed'`. (2) Add a stale-pipeline detection cron (runs every 5 minutes) that queries `SELECT * FROM document_versions WHERE pipeline_status NOT IN ('review_ready', 'failed') AND pipeline_status_updated_at < NOW() - INTERVAL '15 minutes'` → sets status to `failed` with `pipeline_error = 'stagnant_pipeline_timeout'` and creates a notification. (3) Add a "Réessayer" button on the document card when `pipeline_status = 'failed'`. |
| **Slice** | 2 (API + cron), frontend Slice 2 (retry button) |
| **Risk if deferred** | Stuck documents require database-level manual intervention. No self-service recovery exists. |

---

### E-14 — Agent polling for manual observation confirmation blocks the agent loop for up to 10 minutes

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `project_spec.md` §15.4 / `implementation_plan.md` Slice 5 §5.7–§5.11 |
| **Symptom** | §15.4 states: "Agent polls `GET /manual-observations/pending/{pending_id}` until `status = confirmed \| skipped` (max 10 minutes, poll every 5 seconds)." MCP tools are "typed async TypeScript functions" running in-process with the Next.js server. During those 10 minutes, the agent function is blocked in a polling loop (120 iterations × 5s). This ties up server resources and keeps the SSE stream idle (no tokens emitted). The chat UI shows the typing indicator or the manual obs banner for up to 10 minutes with no activity. |
| **Impact** | (1) The agent occupies a process thread/async context for 10 minutes per manual observation popup. If the report generation flow triggers 3–4 missing fields (plausible for a first-time user with a sparse document set), that's 30–40 minutes of blocking. (2) The SSE stream is idle — the user may think the system is frozen and refresh, triggering frontend R3's sessionStorage recovery. (3) Under concurrent usage, multiple agents polling simultaneously can exhaust the event loop. |
| **Fix** | Replace polling with a push-based mechanism. Recommended: when `POST /api/manual-observations/pending/{id}/confirm` or `/skip` is called, the handler publishes to a Redis pub/sub channel `manual-obs:{pending_id}`. The agent's `propose_manual_observation` tool subscribes to this channel and resolves the awaited promise immediately on message. Timeout after 10 minutes. This eliminates 120 HTTP calls and frees the agent to yield the event loop. |
| **Slice** | 5 |
| **Risk if deferred** | Agent loop blocks for minutes per popup. Demo will appear frozen during step 4 (manual observation). |

---

### E-15 — Observation approval race condition: parallel semantic-conflict-jobs miss each other

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `pipeline_plan.md` Stage 5 / `implementation_plan.md` Slice 4 |
| **Symptom** | When `PATCH /api/observations/{id}/status` transitions to `approved`, a `semantic-conflict-job` is dispatched. If a user rapidly approves two observations with semantically equivalent keys (e.g., `ghg_scope_1` and `ghg_scope1`), two BullMQ jobs are dispatched nearly simultaneously. Job A for obs-1 queries approved observations at time T and does not see obs-2 (not yet approved when the query ran). Job B for obs-2 similarly does not see obs-1 (already approved, but B's query may execute before A's approval is committed). Both jobs find zero conflicts. |
| **Impact** | Two approved observations for the same real-world metric coexist without a ConflictCase. Dashboard shows zero conflicts. Derivations include both, double-counting the metric. |
| **Fix** | Add a `pg_advisory_xact_lock(hashtext(company_id \|\| normalized_key))` in the semantic-conflict-job's query transaction to serialize conflict checks for the same key within a company. Alternatively, use a BullMQ `concurrency: 1` per company (group key) for the `semantic-conflict-job` queue, ensuring sequential processing. |
| **Slice** | 4 |
| **Risk if deferred** | Silent double-counting of metrics in reports. Conflicts go undetected until manual audit. |

---

### E-16 — `DerivationResult` missing `stale`, `coverage`, `label`, `computed_at` fields

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `derivation_results` vs `project_spec.md` §2.6 / §10.3 |
| **Symptom** | Implementation plan has: `result_value TEXT`, `result_unit`, `input_hash`. Missing: `label` (human-readable name), `coverage` (JSONB: `{ present_periods, expected_periods, fraction }`), `stale` (boolean), `computed_at`, `unit` (impl uses `result_unit`), `result_value` is TEXT not NUMERIC. Also: `fingerprint_hash` → `input_hash` naming difference. |
| **Impact** | (1) **`stale`**: cache invalidation (§10.4) depends on marking derivations stale when input observations change status. Without it, the `compute_derivation` tool returns outdated results indefinitely. (2) **`coverage`**: partial coverage reporting (§10.5) requires `{ present_periods, expected_periods, fraction }`. Without it, the agent cannot flag "only 3 of 4 quarters represented" in the report. (3) **`result_value` as TEXT**: arithmetic operations (`sum`, `average`, `delta`, `ratio`) require numeric values. Parsing from text at read time loses precision and adds error surface. (4) **`label`**: the agent provides a label (e.g., "Total GHG Emissions") — without storing it, the report section heading is lost on re-read. |
| **Fix** | Change `result_value` to `NUMERIC NOT NULL`. Add: `label TEXT`, `coverage JSONB NOT NULL` (with CHECK constraint per migration 0005), `stale BOOLEAN NOT NULL DEFAULT false`, `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Rename `input_hash` → `fingerprint_hash` for consistency. |
| **Slice** | 1 (schema), 5 (derivation tool) |
| **Risk if deferred** | Derivation cache never invalidates. Partial coverage goes unreported. |

---

### E-17 — `PendingManualObservation.expires_at` cleanup job never defined in any slice

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Missing Recovery Path |
| **Where** | `data_model_migration_plan.md` 0007 / all implementation slices |
| **Symptom** | Migration 0007 creates `pending_manual_observation.expires_at` as a generated column (`created_at + 10 minutes`) and an index `idx_pending_obs_expires WHERE status = 'pending'` annotated "for cron cleanup job." No cron job, scheduled task, or BullMQ repeatable job is defined in any slice of the implementation plan. |
| **Impact** | Expired pending observations accumulate in the DB with `status = 'pending'` forever. If the agent times out and treats the pending obs as skipped (§5.4.1), the DB record still says `'pending'`. If the user later visits the chat, the frontend may reconstruct the popup from sessionStorage (frontend R3 mitigation) even though the agent has moved on. The popup's confirm/skip endpoints will succeed (no expiry check), but the agent won't be listening anymore. |
| **Fix** | Add a BullMQ repeatable job (`cleanup-expired-pending-obs`) running every 5 minutes. SQL: `UPDATE pending_manual_observations SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()`. Add `'expired'` to the `pending_obs_status` enum. In `/confirm` and `/skip` endpoints, check `status != 'expired'` and return `410 Gone` if expired. Clear `sessionStorage` on receiving 410. |
| **Slice** | 5 |
| **Risk if deferred** | Zombie pending records confuse the frontend recovery logic. Table bloats. |

---

### E-18 — `pageCount` validated client-side at upload init but client cannot determine PDF page count before uploading

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §2.4 `POST /api/uploads/init` / `project_spec.md` §5.1 |
| **Symptom** | `POST /api/uploads/init` requires `{ filename, fileSize, mimeType, pageCount, categoryId }` and validates `pageCount` (1–200). But `pageCount` comes from the client. A browser cannot determine the page count of a PDF before uploading it without parsing the PDF client-side (requires pdf.js or similar). For images, the page count is always 1, which is trivial. The `POST /api/uploads/complete` endpoint also validates page count. |
| **Impact** | Frontend must either (a) ship pdf.js (~1MB gzipped) for client-side page counting, (b) send `pageCount` as a guess/zero and rely on server validation in `/complete`, or (c) skip the field in `/init` and only validate in `/complete` after the OCR step actually counts pages. Option (a) adds significant bundle weight. Option (b) allows uploading a 200-page PDF and having it rejected at `/complete` — wasting the user's upload time and R2 bandwidth. |
| **Fix** | Make `pageCount` optional in `/init` (remove from validation). Move page count validation to `/complete`, where the server reads the PDF from R2 and counts pages using a lightweight library (e.g., `pdf-lib` — zero native dependencies, works in Node.js). If page count > 200: delete the R2 object, return `422 { code: "page_count_exceeded" }`. This avoids client-side PDF parsing while still enforcing the limit. |
| **Slice** | 2 |
| **Risk if deferred** | Frontend must bundle pdf.js or silently pass an incorrect page count. |

---

### E-19 — Presigned upload URL expiry (15 min) with no recovery path for slow connections

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Missing Recovery Path |
| **Where** | `project_spec.md` §5.1 / `implementation_plan.md` §2.4 |
| **Symptom** | Presigned PUT URL is valid for 15 minutes. A 50 MB file on a 500 Kbps connection takes ~13 minutes to upload. Any interruption (network blip, browser tab backgrounding) means the user must restart. The client uploads directly to R2 — the Next.js server doesn't see the PUT. If the PUT fails with a 403 (expired URL), the user sees a raw R2 error with no application-level recovery. |
| **Impact** | Users on slow connections cannot upload large files. The `UploadProgressOverlay` component shows progress but has no "URL expired, requesting new URL" fallback. The user must click upload again from scratch. |
| **Fix** | (1) In the `UploadProgressOverlay`, catch 403 from the R2 PUT. On 403, automatically call `POST /api/uploads/init` again with the same parameters to get a fresh URL, then resume/retry the upload. (2) Consider multipart upload for files > 10 MB (R2 supports S3-compatible multipart) to enable resumability. (3) At minimum, show a toast: "Le lien d'envoi a expiré. Réessai en cours…" and retry transparently. |
| **Slice** | Frontend Slice 2 |
| **Risk if deferred** | Support tickets from users with slow internet. |

---

### E-20 — `preference_memory_pointer` missing `client_id`, breaking client-scoped preferences

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `preference_memory_pointers` vs `project_spec.md` §7 / `data_model_migration_plan.md` 0006 |
| **Symptom** | Implementation plan has: `company_id`, `user_id`, `mem0_memory_id`, `scope ENUM(report_style, data_preference, general)`. Missing: `client_id UUID FK → clients`. The spec requires two scoping levels: `user:{id}:company:{id}` (company-wide) and `user:{id}:company:{id}:client:{id}` (client-specific). The migration defines the table with `client_id` and a unique constraint `(company_id, user_id, client_id)` — but the implementation plan ignores it. The `scope` enum (`report_style \| data_preference \| general`) doesn't exist in the spec. |
| **Impact** | mem0 preferences cannot be scoped per client. When a user says "For Client X, use a formal tone" and "For Client Y, use a concise tone," both preferences write to the same scope. The report for Client X inherits Client Y's tone. The `get_preferences` MCP tool (§15.10) accepts `client_id` — without DB-side tracking, the tool cannot resolve the correct mem0 scope key. |
| **Fix** | Add `client_id UUID REFERENCES clients(id) ON DELETE CASCADE` to `preference_memory_pointers`. Replace the `scope` enum with `mem0_scope_key TEXT NOT NULL`. Add the unique index from migration 0006: `UNIQUE (company_id, user_id, client_id)` + partial unique index for null client. |
| **Slice** | 1 (schema), 5 (mem0 integration) |
| **Risk if deferred** | Client-specific report styles are impossible. Demo step 7 (regeneration with client context) produces wrong styles. |

---

### E-21 — `conflict_case` missing `conflict_group_id`, `match_method`, `period_start/end`, `resolution_status`

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `conflict_cases` vs `project_spec.md` §11.5 / `data_model_migration_plan.md` 0005 |
| **Symptom** | Implementation plan has: `normalized_key`, `observation_ids[]`, `winning_observation_id`, `auto_resolved`, `resolved_at`. Missing: `conflict_group_id` (groups semantic near-duplicates), `match_method` (`exact \| semantic`), `period_start/end` (the overlapping interval), `resolution_status` (`auto_resolved \| user_reviewed \| user_overridden`). |
| **Impact** | (1) **`conflict_group_id`**: semantic near-duplicates (e.g., `ghg_scope1` vs `ghg_scope_1`) are displayed as separate conflicts instead of grouped. The Conflict Inbox cannot show "these 3 observations are about the same metric" because grouping is lost. (2) **`match_method`**: the UI cannot distinguish exact conflicts from semantic ones — the user can't tell why two observations conflict. (3) **`period_start/end`**: the conflict card shows no overlap dates — the user can't verify the conflict is real. (4) **`resolution_status`**: no way to distinguish auto-resolved from user-reviewed conflicts, breaking the `GET /api/conflicts?resolution_status=...` filter. |
| **Fix** | Add all missing columns per spec §11.5 and migration 0005. |
| **Slice** | 1 (schema), 4 (conflict logic + UI) |
| **Risk if deferred** | Conflict inbox shows broken/incomplete cards. Semantic grouping is lost. |

---

### E-22 — `provenance_type` enum mismatch: spec `document | manual` vs impl `extracted | manual | derived`

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `observations.provenance_type` vs `project_spec.md` §2.5 |
| **Symptom** | Spec defines `provenance_type: 'document' \| 'manual'`. Implementation plan uses `'extracted' \| 'manual' \| 'derived'`. (1) `document` ↔ `extracted`: naming differs — every UI badge, filter option, and report citation type that checks `provenance_type === 'document'` will fail. (2) `derived`: derivation results are separate entities (`DerivationResult`) in the spec — they are NOT observations. Adding `derived` as a provenance type conflates the two, violating the data hierarchy (§2.2) where observations and derivations are distinct. |
| **Impact** | The report template references "source type (doc/manual)" per observation (§13.3). If the enum uses `extracted` instead of `document`, the label is wrong. If derivations are stored as observations with `provenance_type = 'derived'`, the system can't distinguish a user-facing fact from a computed rollup, breaking the "derivations reference observations" invariant. |
| **Fix** | Align to spec: `document \| manual`. Drop `derived`. Derivations remain as `DerivationResult` entities, never stored as observations. |
| **Slice** | 1 (schema) |
| **Risk if deferred** | Report citations show "extracted" instead of "Document." Derivations stored as observations contaminate the observation pool. |

---

### E-23 — Dashboard summary counts stale with no polling fallback

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | UX Dead End |
| **Where** | `frontend_plan.md` R7 / `implementation_plan.md` Slice 6 |
| **Symptom** | The Dashboard is a Server Component fetching `GET /api/dashboard/summary` on page load. SSE `pipeline_stage_changed` events update individual document status badges but do NOT update the aggregate `documents_by_status` counts, `unresolved_conflict_count`, or `recent_reports` list. If a user stays on the Dashboard while a pipeline runs, the counts are stale. Frontend R7 suggests `refetchInterval` every 30s as a recovery, but this is listed as a mitigation for the Documents page only, not the Dashboard. |
| **Impact** | The Dashboard is the first thing a user sees. If stale, it misrepresents the system state: "0 conflicts" when there are 3, "2 documents processing" when they're all done. |
| **Fix** | Add a `useDashboardRefresh` hook that triggers `router.refresh()` (Next.js RSC revalidation) on receipt of any `pipeline_stage_changed`, `extraction_complete`, `conflict_detected`, or `notification` SSE event — throttled to once per 10 seconds. This re-fetches the Server Component data without a full page reload. |
| **Slice** | Frontend Slice 2 |
| **Risk if deferred** | Users see stale counts. Low severity but high visibility — it's the landing page. |

---

### E-24 — No bulk mark-read endpoint for notifications

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | UX Dead End |
| **Where** | `project_spec.md` §16 / `implementation_plan.md` Slice 6 |
| **Symptom** | Only `PATCH /api/notifications/{id}/read` exists (marks one notification as read). No `PATCH /api/notifications/read-all` or batch endpoint. |
| **Impact** | After a busy pipeline run (5 documents × 2 events each = 10 notifications), the user must click each notification individually to clear the badge. This is tedious. Power users (10+ documents/day) accumulate dozens of unread notifications with no way to dismiss them in bulk. |
| **Fix** | Add `PATCH /api/notifications/read-all` (viewer role). SQL: `UPDATE notifications SET read = true WHERE company_id = $1 AND user_id = $2 AND read = false`. Add a "Tout marquer comme lu" link in the notification bell dropdown. |
| **Slice** | 6 |
| **Risk if deferred** | Minor UX friction. Users will ignore the bell. |

---

### E-25 — Pipeline failed notification offers no retry action

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | UX Dead End |
| **Where** | `project_spec.md` §5.6 notification triggers / `implementation_plan.md` Slice 2 |
| **Symptom** | When a pipeline fails, the notification shows: "Échec du traitement du document «[title]» — [reason]." The notification has no actionable link. The user must navigate to the Documents list, find the failed document, and… there is no retry button (see E-13). The notification is a dead end. |
| **Impact** | Combined with E-13, a failed pipeline leaves the user with no recourse except re-uploading the same document. The notification tells them something broke but gives them nothing to do about it. |
| **Fix** | (1) Add `document_id` and `document_version_id` to the notification payload. (2) Render the notification bell item as a clickable link to `/documents/[id]`. (3) On the document detail page, show a "Réessayer le traitement" button when `pipeline_status = 'failed'` (requires E-13's retry endpoint). |
| **Slice** | 2 (notification payload), frontend Slice 3 (notification link + retry button) |
| **Risk if deferred** | User abandons the failed document. |

---

### E-26 — `document_version` missing `file_hash`, `pipeline_status_updated_at`, `detected_type`, `ocr_quality_warning`

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Missing Transition |
| **Where** | `implementation_plan.md` §1.4 `document_versions` vs `project_spec.md` §7 |
| **Symptom** | (1) **`file_hash`** (SHA-256): used for deduplication — detecting if the same file is uploaded twice. Without it, duplicate uploads create duplicate evidence and duplicate observations. (2) **`pipeline_status_updated_at`**: used by stuck-pipeline detection (E-13) and for ordering "latest wins" in conflicts where `uploaded_at` is inadequate. (3) **`detected_type`** (`sustainability_report \| energy_bill \| …`): FR-18 requires auto-detection; the UI shows type badges. (4) **`ocr_quality_warning`**: flags documents with poor OCR quality for the user. |
| **Impact** | Without `file_hash`, the same 50MB PDF uploaded twice generates 2× OCR costs, 2× embedding costs, and duplicate observations that conflict with each other. Without `pipeline_status_updated_at`, the stuck-pipeline cron (E-13) has no timestamp to compare against. |
| **Fix** | Add: `file_hash TEXT NOT NULL`, `pipeline_status_updated_at TIMESTAMPTZ DEFAULT now()`, `detected_type detected_doc_type_enum`, `ocr_quality_warning BOOLEAN NOT NULL DEFAULT false`. Add a trigger to auto-update `pipeline_status_updated_at` on `pipeline_status` change. Check `file_hash` uniqueness per company in `/api/uploads/complete` (return `409 duplicate_file`). |
| **Slice** | 1 (schema), 2 (dedup + pipeline timing) |
| **Risk if deferred** | Duplicate uploads waste resources and create false conflicts. |

---

### E-27 — Page image rendering failure silently breaks split-view UX

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | UX Dead End |
| **Where** | `pipeline_plan.md` R2 / Stage 1 step 8 / `implementation_plan.md` Slice 2 |
| **Symptom** | Page PNG rendering (Stage 1 step 8) runs concurrently with OCR. If pdf2pic fails (GraphicsMagick not installed, timeout on a 200-page PDF, R2 upload failure), the pipeline continues — evidence blocks are created, embeddings computed, observations extracted. The pipeline succeeds (`review_ready`). But the split-view page (`/documents/[id]`) calls `GET /api/documents/{id}/pages/{n}` and receives `404 page_not_ready` forever because the PNGs were never uploaded. The left panel is permanently blank. |
| **Impact** | The core proof UX — "show page image + highlight the block bbox" (§2.3) — is broken. The user can see observations but cannot verify them against the source document. Evidence trust is undermined. |
| **Fix** | (1) If page rendering fails, set `document_version.ocr_quality_warning = true` and store the error. (2) `GET /api/documents/{id}/pages/{n}` returns `{ pageImageUrl: null, fallback: "page_render_failed" }` instead of 404. (3) The frontend shows a placeholder in the left panel: "Aperçu de la page non disponible. Le texte OCR est affiché ci-dessous." with the raw block text as fallback. (4) Add a separate "re-render pages" endpoint or a manual retry for page rendering. |
| **Slice** | 2 (error handling), frontend Slice 3 (fallback UI) |
| **Risk if deferred** | Split-view left panel shows infinite loading spinner. |

---

### E-28 — `html_snapshot_url` absent from implementation plan Report table — iframe preview approach breaks

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Type** | UX Dead End |
| **Where** | `implementation_plan.md` §1.4 `reports` vs `project_spec.md` §5.6 / `frontend_plan.md` R6 |
| **Symptom** | The implementation plan's `reports` table has `html_content TEXT` but no `html_snapshot_url`. The spec stores both: `html_snapshot` (full HTML text in DB, max 2MB) and `html_snapshot_url` (time-limited presigned R2 URL). The report detail page (§5.6) renders the report in a `<iframe sandbox="allow-scripts allow-same-origin">` with `src={html_snapshot_url}`. Frontend plan R6 details the CSP/CORS considerations for this iframe approach. Without `html_snapshot_url`, the iframe has no source. |
| **Impact** | The report detail page cannot render the report in a sandboxed iframe. The fallback is `dangerouslySetInnerHTML` to inject `html_content` directly — which the spec explicitly forbids ("never use `dangerouslySetInnerHTML` for report HTML" — §5.6). The security model (XSS isolation via cross-origin iframe) is bypassed. |
| **Fix** | At report creation time, upload `html_content` to R2 at `{company_id}/reports/{report_id}/report.html`. Store the R2 object key (not the presigned URL) as `html_snapshot_key TEXT NOT NULL` on the report. Generate a fresh presigned GET URL in `GET /api/reports/{id}` (1-hour expiry). The frontend loads the iframe with this fresh URL. Add the 55-minute refresh `useEffect` per frontend R6. |
| **Slice** | 5 (report creation + API), frontend Slice 5 (iframe) |
| **Risk if deferred** | Report detail page either uses dangerouslySetInnerHTML (XSS risk) or shows nothing. |

---

### E-29 — `document_categories` missing `description` and `created_by`

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Type** | Schema Drift |
| **Where** | `implementation_plan.md` §1.4 `document_categories` vs `project_spec.md` §2.4 |
| **Symptom** | Spec §2.4 includes `description` (optional string) and `created_by` (FK → User). Implementation plan has neither. Also naming: spec uses `parent_category_id`, impl uses `parent_id`. |
| **Impact** | `description` is optional and has no UI consumer defined in the frontend plan — low impact. `created_by` is part of the timestamp convention but only matters for audit. The naming difference (`parent_id` vs `parent_category_id`) will cause confusion during implementation but is functionally equivalent. |
| **Fix** | Add `description TEXT` and `created_by UUID REFERENCES users(id)` to `document_categories`. Align FK naming to `parent_category_id` for spec consistency. |
| **Slice** | 1 (schema) |
| **Risk if deferred** | Minimal. |

---

### E-30 — Notification type enum mismatch between spec and implementation plan

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Schema Drift |
| **Where** | `implementation_plan.md` §1.4 `notifications.type` vs `project_spec.md` §7 |
| **Symptom** | Spec: `pipeline_completed \| pipeline_failed \| conflict_detected \| report_ready \| manual_obs_requested`. Implementation plan: `pipeline_done \| conflict_detected \| conflict_resolved \| report_ready`. Missing: `pipeline_failed`, `manual_obs_requested`. Added: `conflict_resolved` (not in spec). Renamed: `pipeline_completed` → `pipeline_done`. |
| **Impact** | (1) Pipeline failures produce no notification (type doesn't exist). The user is unaware their document failed. (2) Manual observation requests from the chat agent produce no bell notification — the spec says "Manual observation requested → Bell: « Saisie requise : [label] »" (§5.6 notification triggers). (3) `conflict_resolved` in impl but not spec — minor, but creates inconsistency. |
| **Fix** | Align to spec enum. Add `pipeline_failed` and `manual_obs_requested`. Rename `pipeline_done` → `pipeline_completed`. Keep `conflict_resolved` if desired (it's an addition, not a contradiction). |
| **Slice** | 1 (schema) |
| **Risk if deferred** | Pipeline failures go unnotified. Manual obs requests only appear in chat, not in the bell. |

---

### E-31 — `pipeline_run` schema divergence: per-stage model vs per-run model

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Type** | Schema Drift |
| **Where** | `implementation_plan.md` §1.4 `pipeline_runs` vs `project_spec.md` §7 |
| **Symptom** | Spec defines `PipelineRun` as a **per-document-version run record**: `run_id`, `document_version_id`, `company_id`, `started_at`, `completed_at`, `status` (running \| completed \| failed), `observations_created`, `observations_skipped`. One row per pipeline execution. Implementation plan defines it as a **per-stage tracker**: `document_version_id`, `stage` (ocr \| embedding \| extraction), `status` (queued \| running \| done \| failed), with unique constraint `(document_version_id, stage)`. Three rows per document. |
| **Impact** | The `extraction_complete` SSE event includes `observations_created` and `observations_skipped` — these fields exist only on the spec's per-run model, not on the impl's per-stage model. The `get_report_data` MCP tool returns observations linked via `extraction_run_id` — if the run model is per-stage, the FK on observation points to which stage row? The per-stage model has advantages (tracking independent stage timings) but doesn't match the spec's API contracts. |
| **Fix** | Keep the per-stage model for operational tracking but add the spec's per-run model as well: one `pipeline_runs` table (spec shape) with `observations_created` / `observations_skipped`. Link observations via `extraction_run_id` to this table. The per-stage tracking can be columns on `pipeline_runs` (e.g., `ocr_started_at`, `ocr_completed_at`, `embedding_started_at`, etc.) or a separate `pipeline_stage_logs` table. |
| **Slice** | 1 (schema), 3 (extraction linking) |
| **Risk if deferred** | SSE `extraction_complete` events lack the `observations_created` count. Observation traceability to pipeline run is broken. |

---

---

## Broken Flow Map

| Step | Risk | Fix |
|------|------|-----|
| **Upload** | Presigned URL expires on slow connection; no 403 recovery (E-19) | Auto-retry with fresh presigned URL on 403 |
| **Upload** | `pageCount` client-validated but client can't parse PDF pages (E-18) | Move page count validation to server-side in `/complete` |
| **Upload** | Duplicate file not detected — no `file_hash` (E-26) | Add `file_hash` check in `/complete` |
| **OCR** | Page PNG rendering failure silently breaks split-view (E-27) | Fallback "page unavailable" UI; separate retry |
| **Blocks** | Chunking merge "20px" threshold incompatible with ratio bbox (E-05) | Use ratio threshold (e.g., 0.015) |
| **Blocks** | `embedding_status` field doesn't exist in schema (E-04) | Add column to `evidence_blocks` |
| **Embedding** | All blocks low-confidence → zero obs → no explanation (E-12) | Pipeline warning field + user-facing badge |
| **Extraction** | Pipeline conflict detection fires on candidates, supersedes approved obs (E-02) | Flag-only conflicts in pipeline; resolve on approval |
| **Extraction** | `pipeline_status` enum values diverge from spec (E-03) | Align to spec values |
| **Review** | `superseded`/`invalidated` states missing from observation enum (E-01) | Extend enum to 5 states |
| **Review** | Rapid approval of same-key obs → parallel conflict jobs miss each other (E-15) | Advisory lock or single-concurrency queue per key |
| **Review** | Observation missing `label`, `data_type`, `time_behavior` (E-06) | Add columns to schema |
| **Conflicts** | `conflict_case` missing group/method/period info (E-21) | Add columns per spec §11.5 |
| **Conflicts** | `provenance_type` enum mismatch blocks report citations (E-22) | Align to spec: `document \| manual` |
| **Chat** | `chat_message.content` is TEXT not JSONB — structured types break (E-08) | Change to JSONB; add `type` column |
| **Manual Popup** | Agent polling blocks event loop for up to 10 min (E-14) | Redis pub/sub push notification |
| **Manual Popup** | Expired pending obs never cleaned up (E-17) | Repeatable cleanup job every 5 min |
| **Derivation** | `DerivationResult` missing `stale`, `coverage` — cache never invalidates (E-16) | Add fields per spec §2.6 |
| **Report** | Report missing `observation_ids[]` — traceability broken (E-07) | Add traceability arrays to schema |
| **Report** | `html_snapshot_url` missing — iframe can't load (E-28) | Upload HTML to R2; store key |
| **Report** | `attestation_record` purpose inverted — manual obs can't be created (E-09) | Rewrite to match spec schema |
| **PDF** | `render_pdf` has no completion mechanism defined (E-10) | Poll `Report.pdf_url` or use Redis pub/sub |
| **Regenerate** | No agent invocation path outside chat (E-11) | Route through chat session or dedicated job queue |
| **Dashboard** | Summary counts go stale with no refresh (E-23) | SSE-triggered RSC revalidation |
| **Notifications** | Failed pipeline notification has no retry action (E-25) | Link to document + retry button |
| **Notifications** | No bulk mark-read endpoint (E-24) | Add `PATCH /notifications/read-all` |
| **Notifications** | Type enum missing `pipeline_failed`, `manual_obs_requested` (E-30) | Align enum to spec |
| **Preferences** | `preference_memory_pointer` missing `client_id` (E-20) | Add `client_id` FK |
| **Pipeline Recovery** | No stuck-pipeline detection or manual retry (E-13) | Cron + `POST /documents/{id}/retry` |
