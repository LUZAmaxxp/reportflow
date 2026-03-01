# 1. Project Overview

## 1.1 System purpose

Build a proof-first ESG/RSE reporting platform for SMEs that:

* **Ingests company documents** (PDFs/images) into a structured, auditable facts layer
* Extracts **observations** (document-backed or manual attested) with traceable proof
* Enables an **AI agent** to answer questions and generate **ISO 26000-style self-assessment reports** in any language/style, using only trusted tool outputs (no hallucinated facts)
* Produces **HTML reports rendered to PDF** for flexible formatting

## 1.2 Core problem being solved

SMEs repeatedly answer ESG questionnaires without:

* a reusable data catalog
* fast discovery of supporting evidence
* reliable traceability and audit trail
* consistent formatting per client/company

## 1.3 Who this is for

* **Company (SME)**: owns documents, fields, observations, derivations, reports.
* **Client context**: “who the report is for” (affects style, ordering, language, template preferences).

## 1.4 What the product is NOT

* Not an ESG certification/compliance guarantee engine.
* Not a manual form-heavy ESG platform.
* Not “chat over PDFs” only: facts must come from governed data + tools.

---

# 2. Core Concepts & Definitions

## 2.1 Two-plane architecture

### Plane A — Document & Facts System (Data Plane)

Responsible for:

* documents -> OCR blocks -> evidence blocks
* candidate selection (local RAG)
* observation extraction + conflict handling
* storing facts + audit trail
* serving authoritative APIs/tools for retrieval and derivations

### Plane B — Agentic ESG Assistant (Agent Plane)

Responsible for:

* chat Q&A
* report generation (HTML->PDF)
* using MCP tools to fetch facts and compute derivations
* mem0-driven preferences (tone, language, layout/template)

The **agent does not ingest docs** and does not run extraction directly; it only uses tools over already ingested data.

---

## 2.2 Data hierarchy (truth + proof)

From raw to final output:

1. **DocumentVersion** (immutable file version)
2. **DocumentCategory** (user-managed nested folder; inherited by observations)
3. **EvidenceBlock** (OCR/layout blocks stored with bbox/page/text)
4. **Observation** (self-describing extracted fact + time period + provenance + evidence; no predefined field catalog required)
5. **DerivationResult** (computed values from explicit observation IDs; on-demand)
6. **Report** (HTML snapshot + PDF; references to evidence/derivations)
7. **Memory preferences** (mem0): formatting/layout preferences only

---

## 2.3 EvidenceBlock

Atomic proof unit extracted from OCR/layout:

* 'block_id' (UUIDv7)
* 'document_version_id' (FK -> DocumentVersion)
* 'page_number' (integer)
* 'bbox' (x,y,w,h — float[4])
* 'text' (string; OCR output for this block)
* 'block_type' (ENUM: 'paragraph | table_cell | header | list_item | figure_caption | other')
* 'embedding' (vector(1536); OpenAI 'text-embedding-3-small' output; nullable until embedding stage completes)
* 'low_confidence' (boolean; 'true' when 'ocr_confidence < 0.80')
* 'ocr_confidence' (float 0–1; raw OCR confidence score from the OCR service)
* 'chunk_type' (ENUM: 'original | merged | split'; default 'original'; see §9.2 chunking strategy)
* 'merged_block_ids[]' (nullable UUID[]; set when 'chunk_type = merged'; references the original blocks that were combined)
* 'parent_block_id' (nullable FK → EvidenceBlock; set when 'chunk_type = split'; references the oversized block that was divided)
* 'created_at'
* optional parsed hints: 'doc_date', 'period_start/end', 'site', 'supplier'

**MVP proof UX:** show page image + highlight the block bbox.

---

## 2.4 DocumentCategory (nested document folders)

User-managed folders for organizing documents. Categories are **nested** (tree structure) via `parent_category_id`. A document's category is inherited directly by all observations extracted from it.

### Schema

* `category_id` (UUIDv7)
* `company_id` (FK → Company; tenant isolation)
* `name` (string; user-defined; e.g. "2026", "Finance", "Energy Bills Q1")
* `description` (optional string)
* `parent_category_id` (nullable FK → DocumentCategory; `null` = root category)
* `path` (string; materialized full path for display, e.g. `"2026 / Finance / Energy Bills"`; computed synchronously on every `POST /api/categories` and `PATCH /api/categories/{id}` call; all descendant paths recomputed in the same transaction)
* `sort_order` (integer; default 0; display order among siblings under the same `parent_category_id`; updated atomically by `PATCH /api/categories/reorder`)
* `created_at`, `updated_at`, `created_by`

### Nesting rules

* Max depth: 5 levels (enforced at API layer).
* Deleting a category requires either reassigning or deleting its children first.
* A document can belong to exactly one category (nullable — uncategorized is allowed).
* Observations inherit the category of their source document at extraction time. The user can reassign `category_id` on an individual observation during validation.

### Soft reference keys (extraction prompt guidance)

The extraction LLM is prompted with a **soft reference list** of preferred `normalized_key` values as naming suggestions — not stored entities, not enforced constraints. Example suggestions: `ghg_scope1`, `ghg_scope2`, `ghg_scope3`, `energy_consumption_total`, `energy_renewable_share`, `water_consumption_total`, `waste_generated_total`, `waste_recycled_share`, `employee_count_fte`, `employee_gender_female_share`, `employee_training_hours_avg`, `work_accidents_frequency_rate`, `gender_pay_gap`, `supplier_esg_assessed_share`, `governance_board_independence_share`. The LLM may use these keys or generate new ones for unlisted concepts. No user setup is required.

---

## 2.5 Observation

A self-describing stored fact extracted from a document or manually attested. All descriptive metadata (label, key, unit, data type, time behavior) is carried on the observation itself — no external field catalog is required.

### Schema

* `observation_id` (UUIDv7)
* `company_id` (FK → Company; tenant isolation)
* `label` (string; human-readable name, e.g. "GHG Emissions Scope 1"; LLM-generated, user-editable at validation)
* `normalized_key` (string; snake_case identifier, e.g. `ghg_scope1`; LLM-generated from soft reference list; user-editable; used as soft conflict detection axis)
* `value` (string; raw representation as extracted or entered)
* `numeric_value` (nullable decimal; for numeric/percentage observations; LLM normalizes to standard unit at extraction time)
* `unit` (string; LLM-inferred and normalized, e.g. `kg CO2eq`, `kWh`, `m³`; user-editable at validation)
* `data_type`: `numeric | percentage | text | boolean` (LLM-inferred)
* `time_behavior`: `periodic | point_in_time | none` (LLM-inferred from document context)
* `period_start` (ISO 8601 date, nullable)
* `period_end` (ISO 8601 date, nullable)
* `category_id` (nullable FK → DocumentCategory; inherited from source document at extraction time; user-editable at validation)
* `source_document_version_id` (nullable FK → DocumentVersion; set for document-provenance observations)
* `status`: `candidate | approved | rejected | superseded | invalidated`
* `provenance_type`: `document | manual`
* `evidence_block_ids[]` (non-empty when `provenance_type = document`)
* `attestation_record_id` (FK → AttestationRecord; non-null when `provenance_type = manual`)
* `confidence_score` (float 0–1; from extraction LLM; null for manual observations)
* `extraction_run_id` (FK → PipelineRun; links to the pipeline run that created this observation)
* `created_at`, `updated_at`, `created_by`

### Observation Status Lifecycle

States: `candidate` → `approved` → `superseded` (or `invalidated`)

**Transition rules:**

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `candidate` | `approved` | User approves in Review Queue | User |
| `candidate` | `rejected` | User rejects OR extraction output fails schema validation | User / Pipeline |
| `rejected` | `candidate` | User clicks "Reconsider" | User |
| `approved` | `superseded` | Newer `approved` observation wins for same `normalized_key` + overlapping period | System (conflict handler) |
| `approved` | `invalidated` | DocumentVersion re-processed; old EvidenceBlocks replaced | System (pipeline) |
| `superseded` | `approved` | User manually overrides "latest wins" and promotes this observation | User (admin/editor) |

**Invariants:**
- Only `approved` observations are usable in derivations or reports.
- At most one `approved` observation per (`normalized_key`, `company_id`, overlapping period) should exist — enforced as a soft constraint surfaced in the conflict queue, not a hard DB unique index (because `normalized_key` is user-editable and semantically fuzzy).
- `invalidated` observations cannot be re-approved; they are historical records only.

### Manual observations

Manual observation evidence is an **AttestationRecord**:

* `attestation_id` (UUIDv7)
* `company_id` (FK)
* `created_by` (FK → User)
* `created_at`
* `note` (optional free text; max 1000 chars)
* `source_reference` (optional URL or document name; max 500 chars)
* `upgraded_by_observation_id` (nullable FK → Observation; set when a doc-backed observation replaces this manual one)

---
## 2.6 Derivation (derived calculations)

Derivations are **not extracted**. They are computed **on-demand** via tools. There is no stored `DerivationSpec` — each derivation is driven by an explicit set of `observation_ids[]` passed at call time.

**Pre-check (enforced by the tool before computing):**
- All input observations must share the same `unit`.
- All input observations must have `data_type = numeric` or `percentage`.
- All input observations must have `status = approved`.
- If any check fails, the tool returns an error before computing.

### DerivationResult

| Field | Type | Notes |
|-------|------|-------|
| `result_id` | UUIDv7, PK | |
| `company_id` | FK → Company | Tenant isolation |
| `label` | string (optional) | User or agent-provided name for this derivation |
| `operation` | ENUM | `sum\|average\|delta\|ratio\|count` |
| `result_value` | decimal | Computed output |
| `unit` | string | Inherited from input observations |
| `input_observation_ids[]` | UUID[] | Observations used |
| `coverage` | `{ present_periods: int, expected_periods: int, fraction: float }` | `expected_periods` count is derived from the `expected_periods[]` input supplied by the agent at call time — not inferred by the system. |
| `fingerprint_hash` | string | SHA-256 of `sorted(input_observation_ids) + operation`; see §10.4 |
| `stale` | boolean | `true` when any input observation changed status since last compute |
| `computed_at` | timestamptz | |

---

## 2.7 “RAG” in this project (your clarified meaning)

RAG here means:

> **Local candidate retrieval over embeddings of OCR blocks** to avoid giving the extraction LLM all blocks.

* Embeddings are stored in the DB alongside 'EvidenceBlock'.
* For each document, a single broad ESG/RSE hybrid retrieval pass returns the **top-N = 150** candidate blocks (see §5.2 and §9.3 for full details).
* Hybrid scoring uses Reciprocal Rank Fusion with smoothing constant **k = 60**: `score = 0.6 × cosine_similarity + 0.4 × BM25_score` via RRF(k=60).
* Those top-150 blocks are passed to the extraction LLM (xAI Grok, `grok-4-1-fast-reasoning`) in one call.

**Terminology**: N = 150 is the candidate count returned to the LLM. k = 60 is the RRF smoothing constant used in the hybrid scoring formula — it is *not* a retrieval count.

RAG returns **candidates**, not truth.

---

## 2.8 Memory (mem0)

Use Mem0 only for:

* formatting preferences (tone, wording, language)
* layout/template preferences (sections, ordering, table style)
* scoped to the “context” the user indicates (company or company+client)

**mem0 does not store numeric truth.**

---
## 2.9 ISO 26000 Core Subjects — Dynamic Mapping

The agent assembles ISO 26000 sections **dynamically** using semantic search over approved observations — no static field-key mapping table is required.

| ISO 26000 Core Subject | Theme | Example search query used by agent |
|------------------------|-------|------------------------------------|
| **Organizational Governance** | Governance structure | `"board independence governance structure"` |
| **Human Rights** | Non-discrimination | `"gender pay gap discrimination equality"` |
| **Labour Practices** | Employment & relations | `"employee headcount FTE workforce"` |
| **Labour Practices** | Health & safety | `"work accidents injury frequency rate"` |
| **Labour Practices** | Training & development | `"training hours learning development"` |
| **Labour Practices** | Diversity | `"gender diversity female share pay gap"` |
| **The Environment** | Climate change mitigation | `"greenhouse gas emissions CO2 scope carbon"` |
| **The Environment** | Energy | `"energy consumption renewable electricity"` |
| **The Environment** | Water | `"water consumption usage withdrawal"` |
| **The Environment** | Waste | `"waste generated recycled valorised"` |
| **Fair Operating Practices** | Supply chain responsibility | `"supplier ESG assessment responsible procurement"` |
| **Consumer Issues** | *(qualitative; evidence search fallback)* | `"consumer product safety transparency"` |
| **Community Involvement** | *(qualitative; evidence search fallback)* | `"community involvement local engagement"` |

**Usage rules:**
1. The agent iterates over all core subjects in the order shown.
2. For each theme, the agent calls `search_observations(query, { period_filter })` via MCP.
3. If `search_observations` returns observations that **do not answer the question or do not provide the required fields** for the theme (qualitative completion test by the agent — **no numeric threshold**), agent **MUST** call `search_evidence(query)` with a broadened query to surface qualitative evidence blocks.
4. If still no data, agent proposes a manual observation popup.
5. Derivations (e.g., total GHG = scope1 + scope2 + scope3 observations) are computed via `compute_derivation(observation_ids[], operation)`.
6. Sections with no data AND no manual confirmation are marked "Not reported" in the output.

---

# 3. System Objectives

## 3.1 Functional objectives

* Fully automatic ingestion pipeline (upload -> extraction)
* Evidence blocks stored with proof metadata
* Observation extraction with minimal review friction
* Manual observation popup for missing fields during reporting
* Deterministic derivation tool (partial allowed with explicit flagging)
* Agent-generated HTML reports rendered to PDF

## 3.2 Data integrity objectives

* Any reported fact must trace to:

  * an approved observation (doc/manual), or
  * a derivation result that traces to observations
* Conflicts are recorded; “current” is determined by policy (latest wins)
* Audit trail is preserved for all edits and overrides

## 3.3 UX objectives (low interaction)

* User does not fill long forms
* Most actions are:
  * upload docs
  * confirm/edit popups
  * chat requests (generate report / ask question)
* **MVP UI language: French only (FR).** All navigation labels, system messages, empty states, and notification copy are in French. Report *content* language is configurable (default FR, per mem0 preference).

---

# 4. Scope

## 4.1 In-scope

* PDFs + images upload
* OCR/layout -> evidence blocks
* embeddings stored in DB for evidence blocks
* local RAG retrieval per document for candidate selection
* extraction LLM to propose observation candidates
* automatic conflict handling (“latest wins”) with audit trail
* manual observation creation via popup during reporting
* on-demand derivations via MCP tool call
* ISO 26000 self-assessment style report generation as HTML->PDF
* mem0 preferences for formatting/layout

## 4.2 Non-goals (explicit)

* No interactive citations inside the PDF (web app only).
* No eager/background derivation recomputation after uploads.
* No additional file types beyond PDF/image in MVP (architecture should be extensible).
* No full ESG certification/compliance claims.

---

# 5. End-to-End Workflow

## 5.1 Document ingestion (separate pipeline, not chat)

**Pipeline states** (stored on `DocumentVersion.pipeline_status`):
`uploaded → ocr_processing → ocr_done → embedding → embedded → extracting → review_ready | failed`

Steps:
1. **Upload flow (Cloudflare R2 presigned PUT):**
   - Client calls `POST /api/uploads/init` with `{ filename, fileSize, mimeType }`.
   - Server validates: max 50 MB, allowed MIME types (PDF, PNG, JPG, TIFF); returns `{ uploadUrl, objectKey }` on success, or error ("Fichier trop volumineux" / "Format non supporté").
   - `objectKey` follows scheme: `{company_id}/{document_id}/original.{ext}` (Cloudflare R2).
   - Client PUTs file binary directly to `uploadUrl` (presigned PUT URL; valid 15 minutes).
   - Client calls `POST /api/uploads/complete` with `{ objectKey, filename }`. Server validates page count (max 200), creates `Document` + `DocumentVersion` records referencing `objectKey`. Status → `uploaded`.
2. User optionally assigns the document to a `DocumentCategory` (existing or new, nested up to 5 levels). Uncategorized is allowed.
3. System creates `DocumentVersion` (immutable). Status → `uploaded`.
4. Async job: OCR/layout via **Baidu PaddleOCR-VL 1.5** external API extracts `EvidenceBlock`s per page. Status → `ocr_processing` → `ocr_done`.

   **PaddleOCR-VL 1.5 request format:**
   ```
   POST ${PADDLEOCR_API_URL}
   Headers:
     Authorization: token ${PADDLEOCR_TOKEN}
     Content-Type: application/json
   Body (required):
     { "file": "<base64-encoded file content>", "fileType": 0 }
     // fileType: 0 = PDF, 1 = image (PNG/JPG/TIFF)
   Body (optional — all false in MVP):
     { "useDocOrientationClassify": false, "useDocUnwarping": false, "useChartRecognition": false }
   ```
   `PADDLEOCR_TOKEN` and `PADDLEOCR_API_URL` are server-side environment variables. File content is base64-encoded before sending.

   - If page-level OCR confidence < 0.70, block is flagged `low_confidence = true`; it is stored but excluded from embedding.
   - Retry policy: 2 attempts, 60s timeout each. On persistent failure: status → `failed`, user notified.
5. Store blocks + metadata in DB.
6. Async job: compute and store embeddings for each non-flagged block. Status → `embedding` → `embedded`.
   - Model: `text-embedding-3-small` (OpenAI, 1536d). Batch up to 512 blocks per API call.
   - Store vector in pgvector column with HNSW index (ef_construction=128, m=16).
7. System auto-detects a display label for the document type from OCR content (`sustainability_report | energy_bill | hr_report | financial_statement | other`). This is display metadata only — it does **not** drive field routing. User can override in UI.
8. Trigger extraction pipeline. Status → `extracting`.

## 5.2 Observation extraction (pipeline LLM)

For each new `DocumentVersion` reaching status `embedded`:

1. **Broad ESG retrieval** — run a single hybrid BM25+dense query over the current document's blocks using a broad ESG/RSE coverage prompt (covering emissions, energy, water, waste, employees, governance, suppliers, diversity, health & safety). Returns top-150 blocks ranked by hybrid score. Blocks with `low_confidence = true` are excluded.
   - Hybrid score: `0.6 × cosine_similarity + 0.4 × BM25_score` via Reciprocal Rank Fusion (k=60).
   - If fewer than 10 blocks returned: log `insufficient_blocks`, skip extraction, mark `review_ready`.

2. **Single-pass structured extraction** — send top-150 candidate blocks to extraction LLM (xAI Grok, `grok-4-1-fast-reasoning`, JSON mode) in one call.
   - System prompt instructs the LLM to:
     - Extract every piece of data useful for ESG/RSE reporting found in the blocks.
     - Assign a `normalized_key` (snake_case; prefer keys from the soft reference list in §2.4 when applicable; invent new keys for unlisted concepts).
     - Infer and normalize `unit` to standard conventions (`kg CO2eq` for GHG, `kWh` for energy, `m³` for water, `kg` for waste, etc.).
     - Infer `data_type` (`numeric | percentage | text | boolean`) and `time_behavior` (`periodic | point_in_time | none`) from document context.
     - Infer `period_start` / `period_end` when stated in the document.
     - Link each extracted fact to the specific `evidence_block_id`(s) it came from.
     - Output a `confidence_score` (0–1) per fact.
   - Output schema per fact: `{ label, normalized_key, value, unit, data_type, time_behavior, period_start?, period_end?, evidence_block_ids[], confidence_score }`
   - Schema-validate output. If invalid: retry once. If still invalid: mark `extraction_failed`, log, alert.
   - Hallucination guard: verify every cited `evidence_block_id` exists in the document. If not, reject that fact.
   - All extracted facts are stored with `status = candidate` — **auto-approval is OFF**. `confidence_score` is used only for ranking/sorting within the Review Queue (higher confidence sorted first).

3. **Fact → Observation** — for each valid extracted fact:
   - Create an `Observation` record with `category_id` inherited from the document's `DocumentCategory`.
   - Apply conflict detection on `(normalized_key, company_id, overlapping_period)` (§11).
   - Status → `review_ready`.

## 5.3 User review (mandatory for approvals)

All extracted observations enter the Review Queue as `candidate` — **no auto-approval**. Users (editor/admin) must review every extracted observation before it can be used in derivations or reports.

- `confidence_score` is used only for ranking within the Review Queue (higher confidence shown first); it never triggers automatic approval.
- Conflicts also appear in the queue and require explicit override if the user disagrees with the default "latest wins" policy.

La file de validation affiche les observations groupées par statut : **Approuvé · Candidat · Rejeté · Conflit**.

## 5.4 Agentic workflow (chat interface)

User asks e.g.:
- "Answer this question using my documents"
- "Generate an ISO 26000 self-assessment report for Client X in French, formal tone"

Agent does:

1. Identify required ISO 26000 sections (§2.9).
2. Read formatting preferences from mem0 for the user's stated context.
3. For each section, call `search_observations(query, { period_filter })` MCP tool to retrieve approved observations.
4. If `search_observations` returns observations that **do not answer the question or do not provide the required fields** for the section (qualitative completion test performed by the agent — **no numeric threshold**):
   - Agent **MUST** call `search_evidence(query)` MCP tool with a broadened query as fallback to retrieve raw evidence blocks.
5. If still no data:
   - Call `propose_manual_observation` MCP tool → returns `{ "pending_id", "prefilled_label", "prefilled_value", "prefilled_unit", "prefilled_period" }`.
   - Frontend renders the manual observation popup (see §5.4.1). Agent suspends until result.
   - On user confirm → observation created and approved → agent resumes.
   - On user skip → section marked "Not reported" in output.
6. For totals/rollups: agent selects the relevant approved observation IDs and calls `compute_derivation(observation_ids[], operation)` MCP tool. Partial derivations flagged in output.
7. Agent generates HTML string using the report template structure (§13).
8. Agent calls `create_report` MCP tool with HTML string + all referenced `observation_ids[]` and `derivation_result_ids[]` → receives `{ "report_id", "version", "html_snapshot_url" }`. The Report entity is stored with full traceability.
9. Agent calls `render_pdf` MCP tool with `report_id` → receives `{ "pdf_url" }`. Agent returns report link + PDF download to user.


## 5.4.1 Manual observation popup (frontend design)

A modal dialog rendered by the frontend when the agent calls `propose_manual_observation`. Uses shadcn/ui `Dialog` + `Form` components.

**Fields (all validated with Zod):**

| Field | Control | Pre-filled? | Editable? | Validation |
|-------|---------|-------------|-----------|------------|
| `label` | Text input | Yes (from agent) | Yes | Required, max 200 chars |
| `normalized_key` | Text input | Yes (from agent) | Yes | Required, snake_case, max 100 chars |
| `value` | Text input | Yes (from agent) | Yes | Required |
| `unit` | Text input | Yes (from agent) | Yes | Optional, max 50 chars |
| `data_type` | Select | Inferred | Yes | Required; `numeric \| percentage \| text \| boolean` |
| `time_behavior` | Toggle group | Inferred | Yes | Required; `periodic \| point_in_time \| none` |
| `period_start` | Date picker | Yes (if available) | Yes | Required when `time_behavior = periodic` |
| `period_end` | Date picker | Yes (if available) | Yes | Required when `time_behavior = periodic` |
| `category_id` | Category select | Inherited from context | Yes | Optional; shows category tree |
| `source_reference` | Text input | Empty | Yes | Optional, max 500 chars (URL or document name) |
| `note` | Textarea | Empty | Yes | Optional, max 1000 chars |

**Actions:** "Confirm" button (primary) + "Skip this field" link (secondary).

**Behavior:**
- On Confirm → `POST /api/manual-observations/pending/{pending_id}/confirm` with all fields → observation created and auto-approved → agent resumes.
- On Skip → `POST /api/manual-observations/pending/{pending_id}/skip` → agent marks section "Not reported" → agent resumes.
- Timeout: if no user action within 10 minutes, agent treats as skip.

**Note max length**: 1000 characters (aligned with AttestationRecord schema in §2.5).

**`pending_id` propagation:** The `pending_id` value is received by the frontend from the `manual_obs_request` event on the chat SSE stream (see §16.2). It is passed directly to the `confirm` and `skip` endpoints. The `prefilled` object in the same event pre-populates all editable fields in this dialog.


## 5.4.2 Chat interface design (frontend)

The chat interface is the primary interaction mode for report generation and Q&A.

**Layout:** Right-side panel (collapsible) or dedicated `/chat` page. Uses a scrollable message list + fixed input bar at the bottom. Built with shadcn/ui `ScrollArea`, `Input`, and `Card` components.

**Message types:**

| Type | Sender | Rendering |
|------|--------|----------|
| `user_text` | User | Plain text bubble (right-aligned) |
| `agent_text` | Agent | Markdown-rendered bubble (left-aligned); supports tables, lists, bold |
| `agent_tool_call` | Agent | Collapsed card showing tool name + summary (e.g., "Searched 42 observations"); expandable for details |
| `manual_obs_request` | Agent | Inline card with "Fill in missing data" CTA → opens manual observation popup (§5.4.1) |
| `report_ready` | Agent | Card with report title + "View Report" / "Download PDF" buttons |
| `error` | System | Red-tinted card with error message + retry suggestion |

**States:**
- **Vide :** Message de bienvenue + 2–3 suggestions (ex. : « Générer un rapport ISO 26000 pour… », « Quelles sont mes émissions GES pour 2025 ? »).
- **Chargement / Streaming :** Agent response streams token-by-token via SSE. A typing indicator (animated dots via Framer Motion) shows while the agent is processing tool calls.
- **Saisie manuelle requise :** Chat input is disabled while the popup is open. A banner reads « En attente de votre saisie pour [label]… ».
- **Erreur :** Agent message shows error + « Réessayer » button. User can also retype.

**Session management:**
- Chat sessions are scoped per user. History is stored server-side in a `ChatSession` / `ChatMessage` table.
- A "New chat" button starts a fresh session.
- Previous sessions are listed in a sidebar (post-MVP: searchable).


## 5.5 Report correction loop (mem0 learns)

If user says "Make it more concise", "Use headings like this", "Always put tables before narrative for this client":

- Agent classifies the correction as 'style' vs 'fact'.
  - 'style' -> write to mem0 for the stated context (user + company or user + company + client). Latest-wins for conflicting preference keys.
  - 'fact' -> agent directs user to update the observation in the Data Plane; does NOT write to mem0.
- Regenerate HTML/PDF with updated preferences.
- Store new Report version alongside previous (incremented 'version' counter on Report entity).

## 5.6 Application Navigation & Information Architecture

### Page map (Next.js App Router)

| Route | Page | Purpose | Roles |
|-------|------|---------|-------|
| `/` | Dashboard | Company overview: recent documents, pipeline status summary, unresolved conflict count, recent reports | all |
| `/documents` | Documents list | Filterable/searchable list of all documents; upload button; category sidebar filter | all |
| `/documents/[id]` | Document detail | Split view: page image viewer (left) + extracted observations list (right); evidence block highlighting on hover | all (edit: editor+) |
| `/documents/[id]/review` | File de validation | Observations grouped by status tabs: Approuvé · Candidat · Rejeté · Conflit; inline approve/reject/edit actions | editor, admin |
| `/observations` | Observations list | Company-wide observation browser; filter by category, key, period, status; search bar | all |
| `/conflicts` | Conflict inbox | List of unresolved conflicts with winning/losing values; override action | editor, admin |
| `/reports` | Reports list | All generated reports; filter by client, date, status; "New report" CTA → opens chat | all |
| `/reports/[id]` | Report detail | HTML preview (`html_snapshot_url` rendered in a sandboxed `<iframe sandbox="allow-scripts allow-same-origin">` to prevent XSS; never use `dangerouslySetInnerHTML` for report HTML) + PDF download; version history sidebar (see `GET /api/reports/{id}/versions`); "Regenerate" button → calls `POST /api/reports/{id}/regenerate` | all |
| `/chat` | Chat | Full-page chat interface (§5.4.2); sidebar lists previous sessions | editor, admin |
| `/settings` | Settings | Company settings, user management (admin), category management, preferences | admin |
| `/settings/categories` | Category manager | Tree view of DocumentCategories; CRUD operations; drag-and-drop reordering | editor, admin |

### Global layout

- **Sidebar navigation** (collapsible): Tableau de bord, Documents, Observations, Conflits (badge du nombre non résolus), Rapports, Chat, Paramètres.
- **Top bar**: Company name, user avatar + role badge, notification bell (pipeline completions, conflict alerts).
- **Responsive**: sidebar collapses to bottom tab bar on mobile (post-MVP polish).
- Built with shadcn/ui `Sidebar`, `NavigationMenu`, and `Avatar` components. Page transitions use Framer Motion `AnimatePresence`. Styling uses **Tailwind CSS** (utility-first); all shadcn/ui components are styled via Tailwind class variants.

### Notification triggers

| Event | Channel | Message |
|-------|---------|---------|
| Pipeline completed (success) | Toast + bell | « Document «\u00a0[title]\u00a0» traité — [n] observations extraites » |
| Pipeline failed | Toast (error) + bell | « Échec du traitement du document «\u00a0[title]\u00a0» — [reason] » |
| Manual observation requested | Chat inline + bell | « Saisie requise\u00a0: [label] » |
| Conflict detected | Bell | « [n] nouveau(x) conflit(s) détecté(s) pour [key] » |
| Report ready | Toast + bell | « Rapport «\u00a0[title]\u00a0» prêt — Consulter / Télécharger » |

Toasts use shadcn/ui `Sonner` integration. Auto-dismiss after 5 seconds for success; persist until dismissed for errors.

### Key UI states (applied consistently across all pages)

| State | Rendering |
|-------|-----------|
| **Empty** | Illustration + descriptive text + primary CTA (e.g., « Importez votre premier document »). Uses shadcn/ui `EmptyState` pattern. |
| **Loading** | Skeleton loaders (shadcn/ui `Skeleton`) matching content shape; no spinners on page-level loads |
| **Error** | Red alert banner (shadcn/ui `Alert` variant `destructive`) with error message + "Retry" or "Contact support" action |
| **Success** | Green toast notification (auto-dismiss after 5s); no full-page success screens |
| **Processing** | Progress indicator: pipeline stage badge on document cards (e.g., "OCR processing…" with animated pulse via Framer Motion) |

### Onboarding (first-run experience)

1. On first login (no documents), Dashboard shows a welcome card: « Commencez par importer votre premier document » with an upload CTA.
2. After first successful extraction, a brief tooltip highlights the review queue: « Vérifiez et approuvez vos observations extraites. »
3. After first report, a tooltip suggests: « Essayez de dire ‘Rends-le plus concis’ pour personnaliser le style. »

---

# 6. Functional Requirements

### Data Plane

**FR-1** Upload supports PDF and images; max 200 pages, max 50 MB per file.
**FR-2** Ingestion pipeline runs fully automatically after upload via async job queue.
**FR-3** OCR/layout produces evidence blocks with page + bbox + text + OCR confidence score.
**FR-4** Evidence blocks are stored in DB with 1536-dimension embeddings (OpenAI `text-embedding-3-small`) in pgvector with HNSW index.
**FR-5** Candidate selection uses a single broad ESG/RSE hybrid retrieval pass (BM25 + cosine via RRF) per document, returning top-150 blocks; no per-field routing loop.
**FR-6** Extraction LLM (xAI Grok, `grok-4-1-fast-reasoning`) receives top-150 candidate blocks and outputs a structured JSON array of all ESG-relevant observations found; each observation includes `label`, `normalized_key`, `value`, `unit`, `data_type`, `time_behavior`, `period_start/end`, `evidence_block_ids[]`, and `confidence_score`. Block IDs validated before acceptance.
**FR-7** All extracted observations are stored with `status = candidate` — **auto-approval is OFF** by default. `confidence_score` is used only for ranking/sorting within the Review Queue (higher confidence shown first). Observations are approved/rejected/edited by users (editor/admin roles) in the Review Queue; only `approved` observations are usable in derivations or reports.
**FR-8** Conflicts are detected (`normalized_key` + overlapping period + different value) and resolved by "latest wins" (using `DocumentVersion.uploaded_at`), preserving full audit history.
**FR-9** Manual observations are supported with an AttestationRecord and can be upgraded later by doc-backed proof.
**FR-10** Documents can be assigned to a nested `DocumentCategory` (user-managed; max 5 levels deep). Observations extracted from a document automatically inherit its `category_id`; user can reassign at validation.
**FR-11** A `merge_observations` utility (user-triggered) clusters semantically similar observations by `normalized_key`/`label`, shows groups, and remaps selected observations to a canonical key/label.
**FR-18** System auto-detects a document type label (`sustainability_report | energy_bill | hr_report | financial_statement | other`) from OCR content for display purposes only; user can override. This does **not** drive extraction routing.
**FR-20** System computes 1536-dimension vector embeddings for each non-flagged `EvidenceBlock` using `text-embedding-3-small` and stores them in pgvector. Blocks with OCR confidence < 0.70 are excluded.
**FR-22** System provides a per-document review queue showing all extracted observation candidates grouped by status: `Approved | Candidate | Rejected | Conflicted`.
**FR-23** Manual observations must include an AttestationRecord with `created_by`, `created_at`, and optional `note` (max 1000 chars) and `source_reference`.
**FR-24** User (admin/editor) can override "latest wins" for a specific conflict, promoting any `superseded` observation to `approved`. Action creates a `ConflictResolution` record and marks affected DerivationResults `stale`.

### Agent Plane

**FR-25** Agent cannot ingest documents; it only calls MCP tools (see §15).
**FR-26** Agent retrieves approved observations via `search_observations(query, filters)` MCP tool (semantic search over `label`, `normalized_key`, `value`, `unit`).
**FR-27** If `search_observations` returns results that the agent determines do not answer the question or do not provide the required fields (qualitative completion test — no numeric threshold), the agent **MUST** call `search_evidence(query)` MCP tool with a broadened query (hybrid+reranking over EvidenceBlocks) before proposing a manual observation.
**FR-28** Missing data triggers `propose_manual_observation` MCP tool call; frontend renders popup; agent suspends until user confirms or skips.
**FR-29** Derivations are computed via `compute_derivation(observation_ids[], operation)` MCP tool (on-demand, deterministic). Pre-check: all inputs must share the same `unit` and be `numeric`/`percentage`. Partial coverage allowed but flagged.
**FR-30** Reports are generated in any language/style by xAI Grok; output is HTML rendered to PDF by Puppeteer (headless Chromium worker). HTML and PDF snapshots are stored. Report creation uses `create_report` tool (stores entity + HTML) followed by `render_pdf` tool (generates PDF).
**FR-31** PDF citations are static references (e.g., `[R12]`); interactive evidence navigation (block highlight, page image) exists only in the web app.
**FR-32** User can request report regeneration with updated preferences. System stores the new version alongside the previous (incremented `version` on Report entity).

### Memory

**FR-33** mem0 stores formatting + layout/template preferences only, scoped per-user per context (`user:{id}:company:{id}` or `user:{id}:company:{id}:client:{id}`).
**FR-34** mem0 never stores numeric facts. Agent must classify any correction as `style` (→ mem0) or `fact` (→ Data Plane observation update) before writing.

### FR Addendum (added post-audit)

**FR-35** Authentication is handled by Auth.js (NextAuth v5) with a JWT session strategy. All API route handlers and server actions validate the session via `auth()` and extract `user_id`, `company_id`, and `role` from session claims.

**FR-36** Authorization enforces three roles (`admin | editor | viewer`) on every API route handler and server action. Role checks use a shared middleware utility. Unauthorized access returns `403`.

**FR-37** Real-time pipeline status updates are delivered to the frontend via Server-Sent Events (SSE) on `GET /api/pipeline/events?company_id={id}`. The frontend subscribes on the Documents page and Dashboard.

**FR-38** A notification bell in the global top bar shows unread event counts (pipeline completions, conflicts, report ready). Events are stored in a `Notification` table and marked read on click.

**FR-39** All state transitions on Observations, ConflictCases, and Reports are recorded in an append-only `AuditLog` table with `entity_type`, `entity_id`, `action`, `actor_id`, `timestamp`, and `metadata` (JSON). Readable by `admin` only.

**FR-40** The `confirm_manual_observation` action is a REST endpoint (`POST /api/manual-observations/pending/{pending_id}/confirm`), not an MCP tool. It is called by the frontend only. See §16 for contract.

**FR-41** The `skip_manual_observation` action is a REST endpoint (`POST /api/manual-observations/pending/{pending_id}/skip`). It sets the pending record status to `skipped` and resumes the agent.

# 7. Data Model (Conceptual)

## ID Strategy

All primary keys use **UUIDv7** (time-sortable UUID). This ensures global uniqueness, natural time-ordering without additional indexes, and no enumeration risk.

## Timestamp Convention

All mutable entities carry: 'created_at' (timestamp with timezone), 'updated_at' (auto-updated), 'created_by' (FK -> User, nullable for system-generated records).
Mostly-immutable entities (EvidenceBlock) carry 'created_at' only — content never changes after creation. **Exceptions to pure immutability:**
- 'DocumentVersion': content fields (file_hash, file_url, etc.) are immutable, but 'pipeline_status' and 'pipeline_error_message' are mutable. The entity therefore also carries 'pipeline_status_updated_at' (timestamptz; auto-updated on every 'pipeline_status' transition).
- 'AttestationRecord': all fields are set at creation and never overwritten, except 'upgraded_by_observation_id' which may be set exactly once (null -> UUID) when a document-backed observation supersedes the manual one. It is never overwritten a second time.

## Entity Schemas

### Company
`company_id`, `name`, `created_at`, `updated_at`

### Client
`client_id`, `company_id` (FK), `name`, `created_at`, `updated_at`, `created_by`

### User
`user_id`, `company_id` (FK), `email`, `role` (`admin | editor | viewer`), `created_at`, `updated_at`

### DocumentCategory
`category_id` (UUIDv7), `company_id` (FK), `name`, `description` (optional), `parent_category_id` (nullable FK → DocumentCategory; null = root), `path` (materialized string, e.g. `"2026 / Finance / Energy Bills"`; computed synchronously on every `POST /api/categories` and `PATCH /api/categories/{id}` call; all descendant paths recomputed in the same transaction), `sort_order` (integer; default 0; display order among siblings; updated atomically by `PATCH /api/categories/reorder`), `created_at`, `updated_at`, `created_by`

### Document
`document_id`, `company_id` (FK), `category_id` (nullable FK → DocumentCategory), `title`, `detected_type` (display label only: `sustainability_report | energy_bill | hr_report | financial_statement | other`), `created_at`, `created_by`

### DocumentVersion
`document_version_id` (UUIDv7), `document_id` (FK), `company_id` (FK; denormalized), `file_hash` (SHA-256), `object_key` (string; Cloudflare R2 key, e.g. `{company_id}/{document_id}/original.{ext}`), `original_filename`, `page_count`, `file_size_bytes`, `pipeline_status` (`uploaded|ocr_processing|ocr_done|embedding|embedded|extracting|review_ready|failed`), `pipeline_status_updated_at`, `pipeline_error_message` (nullable), `ocr_quality_warning` (boolean), `detected_type` (display only), `created_at`, `created_by`

> **Note:** `file_url` is derived from `object_key` as a time-limited presigned GET URL at read time; it is not stored.

### EvidenceBlock
See §2.3 for full schema.

### Observation
See §2.5 for full schema.

### AttestationRecord
See §2.5 (Manual observations) for full schema.

### DerivationResult
See §2.6 for full schema.

### ConflictCase
`conflict_id` (UUIDv7), `company_id` (FK), `normalized_key` (the observation key that conflicted), `conflict_group_id` (UUIDv7; groups ConflictCases from the same semantic equivalence cluster; equals `conflict_id` for exact-match-only conflicts), `match_method` (ENUM: `exact | semantic`), `period_start`, `period_end`, `observation_ids[]` (all observations involved), `winning_observation_id` (FK → Observation; auto-selected by latest-wins), `auto_resolved` (boolean), `resolution_status` (`auto_resolved | user_reviewed | user_overridden`), `created_at`, `updated_at`

### ConflictResolution
`resolution_id` (UUIDv7), `conflict_id` (FK), `chosen_observation_id` (FK), `resolved_by` (FK → User), `resolved_at`, `reason` (optional text; max 500 chars)

### Report
`report_id` (UUIDv7), `company_id` (FK), `client_id` (nullable FK), `version` (integer; starts at 1), `source_report_id` (nullable FK → Report; `null` for the first version of a lineage; set to the preceding `report_id` when `POST /api/reports/{id}/regenerate` creates a new version), `language` (BCP-47), `status` (`draft | final`), `reporting_period_start` (ISO 8601 date, nullable), `reporting_period_end` (ISO 8601 date, nullable), `html_snapshot` (text; the full HTML string — **"HTML is the report"**), `html_snapshot_url` (string; URL to stored HTML in Cloudflare R2), `style_snapshot` (JSON, nullable; copy of mem0 preferences applied at generation time), `pdf_url` (nullable), `observation_ids[]`, `derivation_result_ids[]`, `generated_at`, `generated_by` (FK → User), `created_at`, `updated_at`

> **No `template_id`.** Styling is derived from mem0 preferences at generation time and captured in `style_snapshot`. PDF rendering always uses the stored `html_snapshot`.

### PreferenceMemoryPointer
`pointer_id` (UUIDv7), `company_id` (FK), `user_id` (FK), `client_id` (nullable FK), `mem0_scope_key` (string), `created_at`

### PipelineRun
`run_id` (UUIDv7), `document_version_id` (FK), `company_id` (FK), `started_at`, `completed_at` (nullable), `status` (`running | completed | failed`), `observations_created` (count), `observations_skipped` (count)

### Notification
`notification_id` (UUIDv7), `company_id` (FK → Company), `user_id` (nullable FK → User; `null` = company-wide notification), `type` (ENUM: `pipeline_completed | pipeline_failed | conflict_detected | report_ready | manual_obs_requested`), `payload` (JSON; event-specific data — see §16.1 for per-type payload shapes), `read` (boolean; default `false`), `created_at`

### ChatSession
`session_id` (UUIDv7), `company_id` (FK → Company), `user_id` (FK → User), `title` (string; auto-generated from first message, max 200 chars), `created_at`, `updated_at`

### ChatMessage
`message_id` (UUIDv7), `session_id` (FK → ChatSession), `role` (ENUM: `user | agent | system`), `type` (ENUM: `user_text | agent_text | agent_tool_call | manual_obs_request | report_ready | error`), `content` (JSON; shape varies by `type`), `created_at`

## Relationships

* Company → Users, Clients, Documents, DocumentCategories
* DocumentCategory → DocumentCategories (children; self-referential), Documents
* Document → DocumentVersions; inherits category from DocumentCategory
* DocumentVersion → EvidenceBlocks, PipelineRuns
* Observation → EvidenceBlocks (document obs) OR AttestationRecord (manual obs); inherits `category_id` from source Document
* DerivationResult → input Observations (via `input_observation_ids[]`)
* Report → Observations + DerivationResults (via reference arrays)
* ConflictCase → Observations, ConflictResolution
* PreferenceMemoryPointer → User + Company + Client


# 8. Memory & Retrieval Architecture

## 8.1 mem0 scoping rule

Preferences are stored **per-user per context**:

- 'user:{user_id}:company:{company_id}' — company-wide context for that user
- 'user:{user_id}:company:{company_id}:client:{client_id}' — client-specific context for that user

Company-wide defaults shared across users are a future feature (not in MVP).

**Isolation enforcement:** The application layer always constructs the scope key from the authenticated user's JWT claims ('user_id', 'company_id'). Calls to mem0 always include this key as 'user_id'. Cross-scope reads are prevented by construction. An integration test asserts that a mem0 read with scope A returns empty when only scope B has preferences stored.

## 8.2 Write policy

mem0 is written to **only** in these cases:
1. User explicitly requests a style change ("make it more formal", "put tables before narrative").
2. Agent detects a new formatting directive in a user message (classified by the agent as 'style').
3. Never on read-only queries or fact-correction messages.

Write behavior: **latest wins** — conflicting preference keys are overwritten (not appended). Uses mem0's update API.

## 8.3 Read policy

mem0 is read at report generation start and at each regeneration. The agent fetches preferences for the active scope and injects them into the generation prompt as a "style instructions" block.

If mem0 is unavailable (timeout > 3s): degrade gracefully — use default preferences (language=en, tone=formal, layout=standard). Log the failure. Do not block report generation.

## 8.4 What mem0 stores

- 'language': ISO 639-1 code (e.g., '"fr"', '"en"')
- 'tone': '"formal" | "concise" | "narrative" | "bullet"'
- 'layout': e.g., '"tables_first"', '"executive_summary_first"'
- 'section_order': ordered list of ISO 26000 core subject keys
- 'style_rules[]': free-text style corrections (e.g., "use 'GES' instead of 'GHG' in French")

## 8.5 What mem0 does NOT store

- Evidence blocks, observations, or derivation numbers.
- Numeric facts of any kind.

## 8.6 Retention and deletion

- Preferences are retained until explicitly deleted by the user or until cascade deletion on company deletion.
- API: 'DELETE /preferences?scope={scope}' clears all preferences for a given scope.
- GDPR Article 17: company data deletion (§12.4) cascades to all mem0 entries for that company.

# 9. RAG Architecture

## 9.1 What is indexed

- `EvidenceBlock.embedding` (1536-dim float vector, `text-embedding-3-small`)
- Stored in PostgreSQL pgvector column with **HNSW index** (`ef_construction=128`, `m=16`)
- Only blocks with `low_confidence = false` are embedded
- Scope: filtered by `document_version_id` during extraction; cross-document queries allowed agent-side

## 9.2 Chunking strategy

- **Merge rule**: adjacent blocks on the same page with vertical gap < 20px and combined length ≤ 512 tokens are merged. Merged block stores `merged_block_ids[]`.
- **Table cells**: never merged; each cell embedded individually.
- **Split rule**: blocks exceeding 512 tokens are split at sentence boundaries; each split stores `parent_block_id`.
- Stored as `EvidenceBlock` with `chunk_type: original | merged | split`.

## 9.3 Extraction-time retrieval (single broad pass)

One query per document — not per field:
- **Dense**: embed a broad ESG/RSE coverage prompt (`text-embedding-3-small`).
- **Sparse**: BM25 over a fixed ESG keyword vocabulary (emissions, énergie, déchets, effectifs, gouvernance, fournisseurs, etc. — multilingual).
- **Combined**: `score = 0.6 × cosine_similarity + 0.4 × BM25_score` via RRF (k=60).
- **topN = 150**. Max LLM context budget = 80K tokens; if 150 blocks exceed this, truncate by ascending score.
- If fewer than 10 blocks retrieved: log `insufficient_blocks`, skip extraction.

## 9.4 Agent-time retrieval (`search_evidence` fallback)

Used when `search_observations` returns insufficient structured results:
1. **Query expansion**: expand user query with ESG synonym list + optional HyDE pass (LLM generates a short hypothetical answer paragraph; embed as additional dense query).
2. **Hybrid retrieval**: BM25+dense over `EvidenceBlock`s (optionally filtered by `category_id` or `document_version_id`). Top-100 candidates.
3. **Cross-encoder reranking**: score each (query, block_text) pair; re-sort; keep top-20–30 for LLM context.
4. Returns: `block_id`, `score`, `page`, `bbox`, `text`, `document_title`, `category_path`.

## 9.5 RAG evaluation requirement

Before any change to embedding model, topN, hybrid weights, or chunking strategy:
- Run offline eval on ≥ 10 annotated documents.
- Measure: **retrieval recall@150** and **extraction F1**.
- Results recorded in evaluation log before deployment.

# 10. Derivation Engine

## 10.1 On-demand only

No background derivation updates. Derivations are computed only when requested via MCP tool.

**No chaining**: DerivationResults can only reference `approved` Observations, never other DerivationResults.

## 10.2 Supported operations (MVP)

| Operation | Description | Example |
|-----------|-------------|---------|
| `sum` | Sum of `numeric_value` across input observations | Total GHG = scope1 obs + scope2 obs + scope3 obs |
| `average` | Mean of `numeric_value` across input observations | Avg training hours over monthly observations |
| `delta` | `(latest - earliest) / earliest × 100` (YoY % change) | GHG reduction YoY |
| `ratio` | `obs[0] / obs[1] × 100` (first ID = numerator, second = denominator) | Renewable share |
| `count` | Count of input observations | Months with reported data |

**Pre-checks (enforced before computing):**
- All input observations must have `status = approved`.
- All must share the same `unit` (exact string match). Error: `incompatible_units`.
- All must have `data_type = numeric` or `percentage`. Error: `non_numeric_input`.

## 10.3 Tool contract

```
// Period type
type Period = {
  type: "FY" | "Q" | "YTD" | "custom",
  start_date: string,    // ISO 8601 date
  end_date: string,      // ISO 8601 date
  label?: string         // e.g. "FY 2025", "Q1 2025"
}

compute_derivation(
  company_id: UUID,
  observation_ids: UUID[],          // explicit list; agent or user selects
  operation: "sum"|"average"|"delta"|"ratio"|"count",
  expected_periods: Period[],       // supplied by the agent at call time; used for coverage gate
  label?: string                    // optional human-readable name for the result
) -> {
  derivation_result_id: UUID,
  result_value: decimal,
  unit: string,
  coverage: { present_periods: int, expected_periods: int, fraction: float },
  input_observation_ids: UUID[],
  status: "fresh" | "reused",
  stale: boolean
}
```

**Error responses:**
- `incompatible_units`: input observations have mixed units.
- `non_numeric_input`: one or more inputs are text or boolean.
- `insufficient_coverage`: fewer than 50% of expected periods represented.
- `division_by_zero`: denominator observation value is zero (ratio/delta).
- `observation_not_approved`: one or more input observations are not in `approved` status.

## 10.4 Hashing and cache invalidation

**Fingerprint**: `SHA256( sorted(observation_ids) | operation )`

- Same fingerprint → reuse existing `DerivationResult` (`status: "reused"`).
- Different fingerprint → compute and store new `DerivationResult`.

**Cache invalidation (lazy)**: when an Observation changes status, all `DerivationResult`s referencing it are marked `stale = true`. On next call: if fingerprint match is stale, recompute.

## 10.5 Partial coverage policy

`expected_periods` is **supplied by the agent** when calling `compute_derivation` (see §10.3). The system does **not** infer it; the agent must pass the full list of periods it expects to be covered.

- Coverage < 50% of `expected_periods` count → error `insufficient_coverage`. No result produced.
- Coverage ≥ 50% and < 100% of `expected_periods` count → compute; return `coverage` metadata; agent displays fraction visibly.
- Coverage = 100% of `expected_periods` count → compute normally.


# 11. Conflict & Consistency Strategy

## 11.1 Conflict detection

A conflict exists when two or more **approved** observations share:

* the same `normalized_key` (**exact match**) **OR** are classified as a **semantic near-duplicate** by the Grok equivalence classifier (see §11.6 — required for MVP), AND
* overlapping time periods (where 'period_start < other.period_end AND period_end > other.period_start' using ISO 8601 date comparison; an observation with 'time_behavior = point_in_time' uses 'period_start = period_end' for the check), AND
* different normalized values after unit conversion to 'base_unit'

**Value comparison rules (to avoid false conflicts):**
- Numeric fields: values are compared after normalization to 'base_unit'. Two values are considered **equal** (no conflict) if '|a - b| / max(|a|, |b|) < 0.001' (0.1% tolerance).
- Percentage fields: absolute tolerance of 0.01 percentage points.
- Text/boolean fields: exact match after trim + lowercase.

**Period containment rule:** An annual observation '[Jan 1, Dec 31]' conflicts with any contained monthly or quarterly observation for the same field (because they describe the same measurement over an overlapping interval).

## 11.2 Default resolution policy

* **Latest wins**: \"latest\" is defined as the **DocumentVersion.uploaded_at** timestamp (deterministic; under company control).
  * If 'doc_date' embedded in the document differs by more than 30 days from 'uploaded_at', the system logs an **anomaly notice** in the conflict record, but still applies 'uploaded_at' for ordering.
* The newest document version\'s approved observation becomes 'current' (status = 'approved'); the loser transitions to 'superseded'.
* Manual observations participate in \"latest wins\" using 'attestation_record.created_at' as their timestamp.
* Older conflicting observations remain stored with status 'superseded' for audit.

## 11.3 Conflict resolution UX

* Conflicts do **not** block normal work by default; the latest-wins winner is used immediately.
* The web app shows a **\"Conflicts\" badge** (count) on the observations/documents tab when unreviewed conflicts exist.
* A **Conflicts inbox** lists all unresolved conflicts with: field label, period, winning value, losing value, source documents, and timestamps.
* An 'admin' or 'editor' user can override \"latest wins\" by promoting any 'superseded' observation to 'approved'. This action:
  1. Transitions the chosen observation back to 'approved'.
  2. Transitions all other overlapping 'approved' observations to 'superseded'.
  3. Creates a 'ConflictResolution' audit record (see §11.5).
  4. Marks all 'DerivationResult's that reference any affected observations as 'stale' (see §10.3).

## 11.4 Manual vs document conflicts

With \"latest wins\", the newest approved observation wins regardless of provenance type.
Manual observations use 'attestation_record.created_at'; document observations use 'document_version.uploaded_at'.

## 11.5 Conflict audit record (ConflictCase + ConflictResolution)

**ConflictCase schema:**

* 'conflict_id' (UUIDv7)
* 'company_id' (FK)
* 'normalized_key' (the observation key axis on which the conflict was detected)
* 'conflict_group_id' (UUIDv7; groups ConflictCases from the same semantic equivalence cluster; set to `conflict_id` for exact-match-only conflicts)
* 'match_method' (ENUM: `exact | semantic`; `exact` = matched on identical `normalized_key`; `semantic` = matched via Grok equivalence classifier, see §11.6)
* 'period_start', 'period_end' (the overlap interval)
* 'observation_ids[]' (all observations involved)
* 'winning_observation_id' (the current 'approved' one)
* 'auto_resolved' (boolean; true = resolved by latest-wins policy without user action)
* 'resolution_status': 'auto_resolved | user_reviewed | user_overridden'
* 'created_at'

**ConflictResolution schema (created only on user override):**

* 'resolution_id' (UUIDv7)
* 'conflict_id' (FK)
* 'chosen_observation_id' (FK -> Observation)
* 'resolved_by' (FK -> User)
* 'resolved_at'
* 'reason' (optional text; max 500 chars)

---

## 11.6 Semantic near-duplicate detection (MVP)

Semantic near-duplicate detection is **required for MVP**. It uses a minimal LLM-based approach requiring no new infrastructure beyond Grok and `pg_trgm`.

### Candidate generation

For each new `approved` observation, candidate near-duplicates are identified if any of the following hold:
- **Trigram similarity** (`pg_trgm`): `similarity(a.normalized_key, b.normalized_key) >= 0.5`
- **Shared ISO category**: same ISO 26000 core subject (see §2.9)
- **Same unit**: `a.unit = b.unit` (after normalization)

Candidate pairs satisfying any condition are forwarded to the Grok equivalence classifier.

### Grok equivalence classifier

For each candidate pair, the server calls Grok (`grok-4-1-fast-reasoning`) with a prompt of the form:

```
"Are these two ESG observation keys referring to the same real-world metric?
  Key A: {normalized_key_a} — label: {label_a}, unit: {unit_a}
  Key B: {normalized_key_b} — label: {label_b}, unit: {unit_b}
  Answer exactly: SAME_KEY or DIFFERENT_KEY, then a one-sentence rationale."
```

- Returns: `SAME_KEY | DIFFERENT_KEY` + rationale string.
- Results are **cached** in a `KeyEquivalenceCache` table `{ key_a, key_b, result, rationale, created_at }` keyed by `SHA256(sort(key_a, key_b))`. Grok is not called again for the same pair.

### Outcome

- Pairs classified `SAME_KEY` are grouped under a shared `conflict_group_id` in their `ConflictCase` records.
- `ConflictCase.match_method = "semantic"` for these pairs; `"exact"` for identical `normalized_key` matches.
- Standard conflict resolution (§11.2–§11.3) applies once pairs are grouped.

---

# 12. Non-Functional Requirements

## 12.1 Performance targets (MVP SLAs)

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Document ingestion (50-page PDF) | < 5 minutes end-to-end | p95 |
| Retrieval per field query | < 2 seconds | p95 |
| Chat / agent response (no report) | < 10 seconds | p95 |
| Report generation (HTML->PDF) | < 60 seconds | p95 |
| Observation extraction (per document) | < 3 minutes | p95 |

## 12.2 Document limits

- Max 200 pages per PDF.
- Max 50 MB per file.
- Max 10 concurrent uploads per company.
- Supported formats: PDF, PNG, JPG, TIFF (MVP).

## 12.3 Concurrency and job architecture

- Document ingestion pipeline runs via **BullMQ + Redis**. Each pipeline stage (OCR, embedding, extraction) is a separate queue with its own concurrency limit and retry policy. Job state is persisted in Redis; failed jobs move to a dead-letter queue (DLQ) for inspection.
- Agent chat sessions are synchronous per session; multiple concurrent sessions are supported via horizontal scaling.
- Puppeteer PDF rendering uses a **worker pool** (max 3 concurrent instances). Workers restart after 50 renders. Timeout per render: 30 seconds. On timeout: retry once. On second failure: return HTML-only with user notice.

## 12.4 Security and isolation

**Authentication**: Auth.js (NextAuth v5) with JWT session strategy. Sessions are managed via secure HTTP-only cookies (`Secure`, `SameSite=Lax`). Access tokens are short-lived (1 hour); Auth.js handles token rotation automatically. All API route handlers and server actions validate the session via the `auth()` helper and extract `user_id`, `company_id`, and `role` from session claims.

**Authorization (RBAC)**:

| Role | Permissions |
|------|-------------|
| 'admin' | All operations including user management, conflict override, audit log read, company data deletion |
| 'editor' | Upload docs, approve/reject observations, create manual observations, conflict override, generate reports |
| 'viewer' | Read-only access to observations, reports, evidence; cannot modify anything |

**Multi-tenant isolation**:
- Every DB table includes 'company_id'.
- PostgreSQL **Row-Level Security (RLS)** policies enforce 'company_id' filtering at the DB level.
- Application layer also enforces 'company_id' from session claims on every query (defense in depth).
- Integration tests assert that cross-tenant queries return empty results.

**Data confidentiality**:
- All document content is treated as confidential.
- LLM provider (xAI Grok): must have a signed Data Processing Agreement (DPA). Zero data retention / no training on customer data must be confirmed.
- Embedding provider (OpenAI): same DPA requirements as LLM provider.
- No raw document text in logs. Log entries reference 'block_id' or 'document_version_id' only.
- Data at rest: encrypted at the storage layer (cloud provider managed encryption).
- TLS required for all API and service-to-service communication.

**API security**:
- Rate limiting: 100 requests/minute per user.
- Input validation: file type whitelist, size limits enforced before processing.
- CORS restricted to the application domain.

**PII handling (MVP)**:
- No automated PII detection in MVP.
- All document content is treated as potentially sensitive.
- Audit logs never contain extracted text values; they reference entity IDs only.

**Data retention and deletion**:
- Company admins can trigger full data deletion: cascades Company -> Documents -> EvidenceBlocks -> Observations -> DerivationResults -> Reports -> mem0 entries -> audit logs.
- API: 'DELETE /companies/{company_id}/data' (admin only). Creates a final audit record before deletion.
- Audit logs retained minimum 2 years. Immutable (append-only table). Readable by 'admin' only.

## 12.5 Reliability and failure handling

**Per-component retry/timeout policy**:

| Component | Timeout | Retry | On Failure |
|-----------|---------|-------|-----------|
| OCR service (PaddleOCR) | 60s | 2x | 'DocumentVersion.pipeline_status = failed'; user notified |
| Embedding API (OpenAI) | 30s | 3x with backoff | Block marked 'embedding_failed'; skip in retrieval |
| Extraction LLM (xAI Grok) | 120s | 1x | Field marked 'extraction_failed'; logged; alert |
| Puppeteer render | 30s | 1x | Return HTML-only with user notice |
| mem0 read | 3s | 0x | Use default preferences; degrade gracefully |
| mem0 write | 5s | 1x | Log failure; do not block response |

**Pipeline state recovery**: Jobs are idempotent per stage. If a job fails and is retried, it resumes from the last completed stage stored in 'DocumentVersion.pipeline_status'.

**Degraded modes**:
- mem0 down -> use default preferences (language=en, tone=formal). Report generation continues.
- Embedding API slow -> timeout at 30s, skip block embedding, log. Extraction proceeds with already-embedded blocks only.
- OCR unavailable -> queue with exponential backoff (max 3 retries over 10 minutes). After that: status 'failed', user notified.

## 12.6 Observability

**Structured logging**: JSON format, levels 'DEBUG|INFO|WARN|ERROR'. Each pipeline run has a 'correlation_id' propagated through all log entries. No raw document text in logs.

**Key metrics to track**:
- Pipeline success/failure rate per stage
- Average and p95 extraction latency
- LLM token usage per document and per report
- Retrieval latency p95 per field query
- Active conflict count per company
- Report generation success rate
- mem0 read/write latency

**Alerting thresholds**:
- Pipeline failure rate > 5% over 1 hour -> alert
- Extraction LLM errors > 10% over 30 minutes -> alert
- Retrieval p95 > 2s -> alert

# 13. Demo Strategy

## 13.1 What is demonstrated (ISO 26000 self-assessment style)

1. Upload 2–3 sample PDF documents into categorized folders (e.g. `2025 / Sustainability`, `2025 / HR`) → automatic pipeline runs → extraction completes with zero field setup.
2. View a document with extracted EvidenceBlocks highlighted; review and approve observation candidates (edit label/key/unit/period as needed).
3. Chat: "Generate an ISO 26000 self-assessment for Client X in French, formal tone."
4. System detects missing water consumption data → shows manual observation popup → user fills in value and confirms.
5. Agent selects GHG scope 1, 2, 3 observation IDs → calls `compute_derivation([id1,id2,id3], "sum")` for total GHG.
6. System generates HTML report → renders to PDF via Puppeteer → displayed in Reports tab.
7. User says "Make it more concise and put the environment section first" → mem0 learns → report regenerates.

## 13.2 Demo document set (required before build)

Three sample PDFs prepared and placed in nested categories:

| # | Category path | Type | Language | Expected observations |
|---|---------------|------|----------|-----------------------|
| 1 | `2025 / Sustainability` | Sustainability report (SME) | French | GHG scope 1 & 2, total energy, employee headcount, total waste |
| 2 | `2025 / Energy` | Energy bill | French | Total energy consumption, renewable share |
| 3 | `2025 / HR` | HR report | French | Employee headcount, female share, avg training hours, accident frequency rate |

Annotations = ground-truth observation values used for retrieval recall@150 and extraction F1 measurement.

## 13.3 HTML report template structure

The agent generates HTML using this section schema (order is user-configurable via mem0):

1. **Cover page**: company name, client name, report date, reporting period (`reporting_period_start` – `reporting_period_end`), language.
2. **Executive summary**: 3–5 sentence narrative generated by the agent.
3. **Per ISO 26000 core subject sections** (§2.9 order):
   - Section heading (translated to report language)
   - Observations table: label | value + unit | period | source type (doc/manual) | static citation [R#]
   - Short narrative paragraph generated by agent
   - Coverage caveat if derivation has partial coverage
4. **Appendix — Evidence references**: `[R1] Document title, page X, block excerpt`
5. **Disclaimer**: "This self-assessment is not a certification. Values are sourced from company-provided documents and manual attestations."

## 13.4 Demo assumptions

- No predefined field setup required; extraction LLM discovers observations automatically.
- Demo ISO 26000 coverage: Governance, Environment, Labour Practices, Fair Operating Practices.
- Demo language: French with formal tone.
- No real client data; sample PDFs are synthetic or publicly available.

# 14. Risks & Tradeoffs
* **Neighbor expansion OFF** increases risk of missing adjacent "period" blocks -> mitigated via hybrid retrieval (BM25 + cosine) + two-step fallback broadening (§9.5).
* **Latest-wins conflict policy** reduces user friction but can hide meaningful discrepancies -> mitigated by conflict inbox, badge notification, and full audit trail with manual override (§11).
* **Manual observations reduce proof strength** -> mitigated by clear provenance labeling ("Manual / Attested") in all report outputs and the ability to upgrade with doc-backed proof at any time.
* **Top-150 retrieval may miss relevant blocks** for very long documents with dense ESG content -> mitigated by offline RAG evaluation harness (§9.5), hybrid scoring (BM25 + cosine via RRF with k=60), and fallback broadening.
* **LLM provider data exposure** -> mitigated by requiring a signed DPA with zero-retention clause; future mitigation is self-hosted LLM.
* **Derivation cache staleness** -> mitigated by lazy stale-marking on any observation status change (§10.4) and explicit 'stale' flag visible in tool responses.
* **mem0 unavailability** -> mitigated by graceful degradation to default preferences without blocking report generation.

# 15. MCP Tool Contract (Agent ↔ Data Plane Interface)

All tools are called by the Agent Plane only. For MVP, both planes run in the same Next.js process, so these tools are implemented as **typed async TypeScript functions** that the agent invokes directly. The function signatures follow MCP-compatible conventions to allow future extraction to a separate service over HTTP+SSE transport. All tools derive `company_id` from the authenticated session (not passed by the agent).

## 15.1 `search_observations`

```
Input:  {
  company_id,
  query: string,                        // semantic search over label + normalized_key + value + unit
  filters?: {
    category_id?: UUID,                 // filter by document category (includes descendants)
    normalized_key?: string,            // exact or prefix match
    period_filter?: { start, end },
    status?: "approved"                 // default: approved only
  }
}
Output: { observations: Observation[] }
Errors: company_not_found
```

## 15.2 `search_evidence`

```
Input:  {
  company_id,
  query: string,
  filters?: { document_version_id?: UUID, category_id?: UUID }
}
Output: { blocks: { block_id, document_version_id, page_number, bbox, text, document_title, category_path, score }[] }
Errors: company_not_found
```

Hybrid BM25+dense + cross-encoder reranking over EvidenceBlocks. Agent fallback when `search_observations` is insufficient.

## 15.3 `compute_derivation`

See full contract in §10.3.

## 15.4 `propose_manual_observation`

```
Input:  {
  company_id,
  suggested_label?: string,
  suggested_normalized_key?: string,
  suggested_value?: string,
  suggested_unit?: string,
  suggested_period_start?: date,
  suggested_period_end?: date,
  note?: string
}
Output: { pending_id: UUID, prefilled: { label, normalized_key, value, unit, period_start, period_end } }
```

Creates a pending manual observation request. Frontend uses `pending_id` to render the popup. Agent polls `GET /manual-observations/pending/{pending_id}` until `status = confirmed | skipped` (max 10 minutes, poll every 5 seconds).

## 15.5 `create_report`

```
Input:  {
  company_id: UUID,
  client_id?: UUID,
  language: string,                     // BCP-47 (e.g., "fr", "en")
  html_content: string,                 // agent-generated HTML string -- "HTML is the report"
  observation_ids: UUID[],              // all observations referenced in this report
  derivation_result_ids: UUID[],        // all derivations referenced in this report
  reporting_period_start?: string,      // ISO 8601 date; agent-inferred from input observations
  reporting_period_end?: string,        // ISO 8601 date; agent-inferred from input observations
}
Output: {
  report_id: UUID,
  version: number,
  html_snapshot_url: string,
  style_snapshot: object | null,        // copy of mem0 preferences applied at generation time
  status: "draft"
}
Errors: company_not_found, invalid_observation_ids, html_too_large (> 2MB)
```

Creates the Report entity with full traceability. Stores `html_content` as `html_snapshot` (required) and a copy of the current mem0 preferences as `style_snapshot`. **"HTML is the report"** — no template required; styling is derived from mem0 preferences at generation time. The `generated_by` field is set from the authenticated session's `user_id`. Does **not** render PDF — call `render_pdf` next.

## 15.6 `render_pdf`

```
Input:  { report_id: UUID }
Output: { pdf_url: string, report_id: UUID }
Errors: render_timeout, report_not_found
```

Renders the stored HTML snapshot to PDF via Puppeteer. Updates the Report entity with `pdf_url`. Called by the agent after `create_report`.

## 15.7 `get_categories`

```
Input:  { company_id }
Output: { categories: { category_id, name, path, parent_category_id, children: [...] }[] }
```

Returns DocumentCategory tree for the company.

## 15.8 `merge_observations`

```
Input:  { company_id, observation_ids: UUID[], canonical_label: string, canonical_normalized_key: string }
Output: { updated_count: int }
```

Remaps all listed observations to the chosen canonical label and key. Creates an audit record per update.

## 15.9 `get_report_data`

```
Input:  { company_id, report_id: UUID }
Output: { report: Report, observations: Observation[], derivations: DerivationResult[] }
```

## 15.10 `get_preferences`

```
Input:  { company_id, user_id: UUID, client_id?: UUID }
Output: { preferences: { language?, tone?, report_sections_order?, custom_instructions? } }
Errors: (none — returns empty object when no preferences exist)
```


# 16. Data Plane REST API (OpenAPI stub)

All endpoints are implemented as Next.js App Router **route handlers** under `/api/`. All endpoints require a valid Auth.js session. Cross-company access returns `403`. Request bodies are validated with Zod schemas.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/uploads/init` | editor | Initialize upload: validate file metadata; return presigned Cloudflare R2 PUT URL + `objectKey` (`{company_id}/{document_id}/original.{ext}`) |
| `POST` | `/api/uploads/complete` | editor | Complete upload: validate page count (max 200); create Document + DocumentVersion referencing `objectKey`; trigger ingestion pipeline |
| `GET` | `/api/dashboard/summary` | viewer | Returns `{ documents_by_status: Record<PipelineStatus, number>, unresolved_conflict_count: number, recent_documents: Document[], recent_reports: Report[] }` |
| `GET` | `/api/documents` | viewer | List Documents for company |
| `GET` | `/api/documents/{id}` | viewer | Get single Document with metadata |
| `GET` | `/api/documents/{id}/status` | viewer | Get pipeline status |
| `GET` | `/api/documents/{id}/blocks` | viewer | List EvidenceBlocks for a document |
| `GET` | `/api/documents/{id}/pages/{page_number}` | viewer | Return pre-rendered page image URL for the document split-view viewer |
| `GET` | `/api/documents/{id}/observations` | viewer | List observations extracted from this document |
| `PATCH` | `/api/documents/{id}/category` | editor | Assign or change document category |
| `GET` | `/api/categories` | viewer | List DocumentCategory tree for company |
| `POST` | `/api/categories` | editor | Create a new DocumentCategory (with optional `parent_category_id`) |
| `PATCH` | `/api/categories/{id}` | editor | Rename or move a category |
| `DELETE` | `/api/categories/{id}` | editor | Delete category (must reassign or delete children first) |
| `PATCH` | `/api/categories/reorder` | editor | Reorder sibling categories; body: `{ ordered_ids: UUID[] }` scoped to siblings under the same `parent_category_id`; updates `sort_order` atomically |
| `GET` | `/api/observations` | viewer | List observations (filter: `normalized_key`, `category_id`, `status`, `period`) |
| `GET` | `/api/observations/{id}` | viewer | Get single observation with evidence block details |
| `PATCH` | `/api/observations/{id}` | editor | Edit observation fields (label, key, unit, period, value) at validation |
| `PATCH` | `/api/observations/{id}/status` | editor | Approve or reject a candidate |
| `POST` | `/api/observations/manual` | editor | Create manual observation with AttestationRecord |
| `POST` | `/api/observations/merge` | editor | Merge observation group to canonical key/label |
| `GET` | `/api/manual-observations/pending/{pending_id}` | editor | Poll pending manual observation status |
| `POST` | `/api/manual-observations/pending/{pending_id}/confirm` | editor | Confirm manual observation from popup; creates observation + AttestationRecord (moved from MCP §15.5) |
| `POST` | `/api/manual-observations/pending/{pending_id}/skip` | editor | Skip manual observation; agent resumes with "Not reported" |
| `GET` | `/api/conflicts` | viewer | List unresolved ConflictCases |
| `POST` | `/api/conflicts/{id}/resolve` | editor/admin | Override latest-wins for a conflict |
| `GET` | `/api/reports` | viewer | List Reports |
| `GET` | `/api/reports/{id}` | viewer | Get Report with HTML/PDF URLs |
| `GET` | `/api/reports/{id}/versions` | viewer | List all versions in a report lineage: `{ versions: { report_id, version, source_report_id, generated_at, status }[] }` |
| `POST` | `/api/reports/{id}/regenerate` | editor | Trigger report regeneration with updated preferences; creates new version |
| `POST` | `/api/chat/sessions` | editor | Create a new chat session; response: `{ session_id: UUID, created_at: string }` |
| `GET` | `/api/chat/sessions` | editor | List chat sessions for the authenticated user (paginated) |
| `DELETE` | `/api/chat/sessions/{id}` | editor | Delete a chat session and all its messages |
| `POST` | `/api/chat/sessions/{id}/messages` | editor | Send a user message to a session; triggers agent; response: `{ message_id: UUID }`; agent reply arrives via SSE stream |
| `GET` | `/api/chat/sessions/{id}/messages` | editor | List messages in a session (paginated) |
| `GET` | `/api/chat/sessions/{id}/stream` | editor | SSE stream of agent response tokens and events for the active session (see §16.2) |
| `GET` | `/api/preferences` | viewer | Get mem0 preferences for current user + scope |
| `DELETE` | `/api/preferences` | editor | Clear mem0 preferences for a scope |
| `GET` | `/api/notifications` | viewer | List notifications for the authenticated user; supports `?unread=true` filter |
| `PATCH` | `/api/notifications/{id}/read` | viewer | Mark a notification as read; response: `{ notification_id, read: true }` |
| `GET` | `/api/users` | admin | List users for the authenticated company |
| `POST` | `/api/users` | admin | Invite a new user to the company; body: `{ email, role }` |
| `PATCH` | `/api/users/{id}` | admin | Update user role; body: `{ role }` |
| `DELETE` | `/api/users/{id}` | admin | Remove user from company |
| `GET` | `/api/pipeline/events` | viewer | SSE stream for real-time pipeline status updates (filtered by `company_id`); see §16.1 for event shapes |
| `DELETE` | `/api/companies/{id}/data` | admin | Trigger full company data deletion |
| `PATCH` | `/api/companies/{id}` | admin | Update company name or settings; body: `{ name?: string }` |

**Note on page images (`GET /api/documents/{id}/pages/{page_number}`):** Page images (PNG format) are rendered and stored in object storage during the OCR pipeline stage (§5.1 step 4) alongside the source document. The response is `{ page_image_url: string }` where `page_image_url` is a time-limited signed URL (valid 1 hour). The frontend uses this URL in the `<img>` tag of the split-view left panel on `/documents/[id]` to display the selected page and overlay evidence block bounding boxes.

### `confirm_manual_observation` request/response contract

```typescript
// Zod schema
const ConfirmManualObservationSchema = z.object({
  label: z.string().min(1).max(200),
  normalized_key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100),
  value: z.string().min(1),
  unit: z.string().max(50).optional(),
  data_type: z.enum(["numeric", "percentage", "text", "boolean"]),
  time_behavior: z.enum(["periodic", "point_in_time", "none"]),
  period_start: z.string().date().optional(),
  period_end: z.string().date().optional(),
  category_id: z.string().uuid().optional(),
  source_reference: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
});

// Response
{ observation_id: UUID, status: "approved" }

// Errors: 404 pending_not_found, 409 already_confirmed, 422 validation_error
```

### `regenerate_report` request/response contract

```typescript
// Zod schema
const RegenerateReportSchema = z.object({
  style_instruction: z.string().max(500).optional(), // e.g., "Make it more concise"
  client_id: z.string().uuid().optional(),           // override client context for this version
  language: z.string().optional(),                   // BCP-47; override language for this version
});

// Behavior:
// 1. Reads current mem0 preferences for the authenticated user + scope (§8.3).
// 2. If style_instruction is provided, writes it to mem0 (latest-wins) before regenerating (§8.2).
// 3. Re-runs the full report generation flow (§5.4 steps 1–9) using the source report's
//    observation_ids[] and derivation_result_ids[] as starting context.
// 4. Creates a NEW Report entity (new report_id) with version = source_report.version + 1.
//    The source report entity is unchanged and remains accessible for comparison.

// Response
{
  report_id: string,         // new report_id for this regenerated version
  version: number,           // incremented version number
  html_snapshot_url: string,
  pdf_url: string | null     // null if Puppeteer render is still in progress
}

// Errors: 404 report_not_found, 403 forbidden, 409 generation_in_progress
```
```

---

## 16.0 Common API Conventions

### Pagination

All list endpoints accept:
- `?page` (integer, 1-based; default: 1)
- `?limit` (integer; default: 20; max: 100)

Response envelope for all paginated list endpoints:

```typescript
{
  data: T[],
  total: number,      // total matching records (for computing page count)
  page: number,       // current page
  page_size: number   // items returned in this page (≤ limit)
}
```

### Sorting

`?sort={field}:{asc|desc}` (e.g., `?sort=created_at:desc`). Supported sort fields are listed per endpoint below.

### Endpoint-specific query parameters

#### `GET /api/documents`

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by `pipeline_status` (e.g., `review_ready`) |
| `category_id` | UUID | Filter by category (exact match) |
| `sort` | string | `created_at:asc\|desc` (default: `created_at:desc`) |
| `q` | string | Full-text search on `title` |

Response: paginated envelope wrapping `Document[]`.

#### `GET /api/observations`

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | `candidate\|approved\|rejected\|superseded\|invalidated` |
| `normalized_key` | string | Exact or prefix match |
| `category_id` | UUID | Filter by category (includes descendants) |
| `period_start` | date | ISO 8601; include observations whose period overlaps |
| `period_end` | date | ISO 8601; include observations whose period overlaps |
| `sort` | string | `created_at:asc\|desc` or `confidence_score:desc` (default: `confidence_score:desc`) |
| `q` | string | Semantic search over label + value |

Response: paginated envelope wrapping `Observation[]`.

#### `GET /api/reports`

| Param | Type | Description |
|-------|------|-------------|
| `client_id` | UUID | Filter by client |
| `status` | string | `draft\|final` |
| `sort` | string | `generated_at:asc\|desc` (default: `generated_at:desc`) |

Response: paginated envelope wrapping `Report[]` (excluding `html_snapshot` field; use `GET /api/reports/{id}` for full HTML).

#### `GET /api/conflicts`

| Param | Type | Description |
|-------|------|-------------|
| `resolution_status` | string | `auto_resolved\|user_reviewed\|user_overridden`; omit for all unresolved |
| `normalized_key` | string | Exact match |
| `sort` | string | `created_at:asc\|desc` (default: `created_at:desc`) |

Response: paginated envelope wrapping `ConflictCase[]`.

#### `GET /api/notifications`

| Param | Type | Description |
|-------|------|-------------|
| `unread` | boolean | `true` = unread only |
| `sort` | string | `created_at:asc\|desc` (default: `created_at:desc`) |

Response: paginated envelope wrapping `Notification[]`.

#### `GET /api/chat/sessions`

Response: `{ data: { session_id, title, created_at, updated_at, message_count }[], total, page, page_size }`.

#### `GET /api/chat/sessions/{id}/messages`

Response: paginated envelope wrapping `ChatMessage[]` where `ChatMessage = { message_id, session_id, role: "user" | "agent" | "system", type: "user_text" | "agent_text" | "agent_tool_call" | "manual_obs_request" | "report_ready" | "error", content: object, created_at }`.

---

## 16.1 Pipeline SSE event shapes (`GET /api/pipeline/events`)

The client opens a persistent `EventSource` to `GET /api/pipeline/events?company_id={id}`. Each SSE message has an `event:` line and a `data:` line containing a JSON payload.

| Event name | Trigger | Data payload |
|------------|---------|--------------|
| `pipeline_stage_changed` | Any `DocumentVersion.pipeline_status` transition | `{ document_id: UUID, document_title: string, pipeline_status: PipelineStatus, updated_at: string }` |
| `extraction_complete` | Status reaches `review_ready` | `{ document_id: UUID, document_title: string, observations_created: number, observations_skipped: number }` |
| `pipeline_failed` | Status reaches `failed` | `{ document_id: UUID, document_title: string, reason: string }` |
| `conflict_detected` | New `ConflictCase` created | `{ conflict_count: number, normalized_key: string, document_title: string }` |
| `notification` | Any new `Notification` record created for this company | `{ notification_id: UUID, type: NotificationType, payload: object, unread_count: number }` |

The `notification` event is the live delivery mechanism for the notification bell. On receipt, the frontend increments the unread badge count and prepends the item to the bell dropdown. The full notification list is fetched via `GET /api/notifications`.

---

## 16.2 Chat SSE stream event shapes (`GET /api/chat/sessions/{id}/stream`)

The client opens a persistent `EventSource` to receive the streaming agent response. The stream is available while the agent is processing the latest user message (posted via `POST /api/chat/sessions/{id}/messages`).

| Event name | Trigger | Data payload |
|------------|---------|--------------|
| `token` | Agent emits a text token | `{ delta: string }` |
| `tool_call` | Agent invokes an MCP tool | `{ tool_name: string, summary: string, details?: object }` |
| `manual_obs_request` | Agent calls `propose_manual_observation` | `{ pending_id: UUID, prefilled: { label: string, normalized_key: string, value: string, unit: string \| null, period_start: string \| null, period_end: string \| null } }` |
| `report_ready` | `create_report` + `render_pdf` complete | `{ report_id: UUID, title: string, html_snapshot_url: string, pdf_url: string \| null }` |
| `error` | Agent encounters an unrecoverable error | `{ message: string, retryable: boolean }` |
| `done` | Agent has finished the full response | `{}` |

**`manual_obs_request` wiring:** The `pending_id` field from this event is passed directly to `POST /api/manual-observations/pending/{pending_id}/confirm` and `POST /api/manual-observations/pending/{pending_id}/skip`. The `prefilled` object pre-populates all editable fields in the manual observation popup (§5.4.1).

---

# 17. Provider API Configuration

## 17.1 xAI Grok (LLM)

| Parameter | Value |
|-----------|-------|
| Model | `grok-4-1-fast-reasoning` |
| Context window | 2,000,000 tokens (capability note; no special handling required for MVP document sizes) |
| Base URL | `https://api.x.ai/v1` |
| Auth header | `Authorization: Bearer ${XAI_API_KEY}` |
| Environment variable | `XAI_API_KEY` (server-side only; never exposed to client) |

**Usage in this spec:**
- Observation extraction (§5.2): single-call structured JSON extraction over top-150 candidate blocks.
- Report generation (§5.4): generates the HTML report string.
- Grok equivalence classifier (§11.6): semantic near-duplicate key detection.

## 17.2 Baidu PaddleOCR-VL 1.5 (OCR)

See full request format in §5.1 step 4.

| Parameter | Value |
|-----------|-------|
| Environment variable (token) | `PADDLEOCR_TOKEN` |
| Environment variable (URL) | `PADDLEOCR_API_URL` |
| File encoding | Base64 string |
| `fileType` mapping | `0` = PDF, `1` = image (PNG/JPG/TIFF) |

## 17.3 Cloudflare R2 (Object Storage)

| Parameter | Value |
|-----------|-------|
| Object key scheme | `{company_id}/{document_id}/original.{ext}` |
| Page image key scheme | `{company_id}/{document_id}/pages/{page_number}.png` |
| Environment variables | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| Upload method | Presigned PUT URLs (§5.1 upload flow); valid 15 minutes |
| Read URL expiry | 1 hour (time-limited presigned GET) |

 