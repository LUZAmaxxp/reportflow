# ReportFlow — Consolidated Pre-Build Risk Audit

> **Date:** 2026-02-21  
> **Agents:** A (Cross-slice completeness), B (Data model & contracts), C (Concurrency & state machines), D (Infra & deployment), E (E2E journey simulation)  
> **Inputs:** `project_spec.md`, `implementation_plan.md` (6 slices), `pipeline_plan.md`, `data_model_migration_plan.md`, `frontend_plan.md`, `api_audit.md`

---

## 0) SOURCES READ

### Project Spec
§1.1–§1.4 (Purpose, problem, audience, non-goals), §2.1–§2.9 (Architecture, data hierarchy, EvidenceBlock, DocumentCategory, Observation, Derivation, RAG, mem0, ISO mapping), §3.1–§3.3 (Objectives), §4.1–§4.2 (Scope), §5.1–§5.6 (Flows: ingestion, extraction, review, chat, report, notifications), §7 (Entity definitions — all 21 types), §8.1 (mem0 scoping), §9.2–§9.3 (Chunking, HNSW), §10.2–§10.5 (Derivation operations, cache, coverage), §11.1–§11.5 (Conflict detection, resolution, ConflictCase schema), §12.1–§12.4 (SLAs, rate limiting), §13.1–§13.3 (Demo script), §15.4–§15.10 (MCP tools), §16 (API endpoints), §16.1–§16.2 (SSE/notifications), §17.3 (R2 keying)

### Implementation Plan
§1.4 (DB schema — all 21 tables), §1.5–§1.9 (Migrations, Auth, middleware, env, acceptance criteria), §2.4–§2.17 (Upload, OCR, chunking, embedding, SSE, status badges, edge cases, acceptance criteria), §3.3–§3.15 (File inventory, API routes, extraction job, hybrid retrieval, extraction output, observation state machine, UI components, edge cases), §4.4–§4.15 (Conflict API, semantic conflict job, key equivalence cache, notifications, manual observation, UI, edge cases), §5.1–§5.17 (Chat session, SSE, agent loop, MCP tools, manual obs popup, report API, PDF worker, regeneration, chat message types, edge cases), §6.2–§6.11 (Dashboard, categories, settings, audit log, polish, edge cases)

### Pipeline Plan
R1–R12 (All risk items), Stages 1–6 (OCR, chunking, embedding, extraction, conflict, PDF)

### Data Model Migration Plan
Migrations 0001–0007 (Foundation, document layer, evidence layer, observation layer, derivation/conflict layer, chat/report/preferences, async/audit/RLS)

### Frontend Plan
R1–R7 (All risk areas), component structure

---

## 1) EXECUTIVE VERDICT

### **READY WITH FIXES**

Justification:

- **The implementation plan's Slice 1 DB schema (§1.4) is drastically out of sync with both the project spec and the migration SQL.** This is the single root cause of ~60% of all findings. The migration SQL is largely correct; the Drizzle schema declaration that developers will implement is not. A targeted reconciliation of §1.4 against the migration DDL unblocks most issues.
- **No architectural redesign is required.** The slice structure, three-process deployment model, pipeline stages, and agentic architecture are sound. All issues are correctable with schema alignment, enum fixes, and targeted additions.
- **Concurrency and state machine issues are well-understood** and require specific code-level guards (atomic CAS updates, advisory locks, `ON CONFLICT` clauses) — not re-architecture.
- **Infrastructure gaps are container configuration (Dockerfiles, system deps, pool sizing) and operational tooling (health checks, cleanup jobs, rate limiting)** — all addable within existing slices.
- **The E2E journey is complete in coverage** (all 41 FRs mapped to slices) but has 5 critical schema gaps and 3 missing recovery paths that must be addressed before building.

---

## 2) CRITICAL RISKS (must fix before coding)

---

### CR-01 — Implementation plan §1.4 Drizzle schema is systemically out of sync with spec and migration SQL
| Field | Detail |
|-------|--------|
| **Sources** | A-001→A-004, B-001→B-005, B-008→B-014, E-01, E-06, E-07, E-08, E-09 |
| **Severity** | CRITICAL |
| **Type** | Data model |
| **Where** | Slice 1 §1.4 (all 21 tables) |
| **Symptom** | §1.4 was written as a simplified summary and never reconciled with the spec §7 entity definitions or the migration DDL. 15+ tables have missing columns, wrong enum values, different column names, or inverted FK directions. The later slices (§3–§6) reference the correct spec columns in API contracts, creating an internal contradiction: the ORM schema is wrong but the endpoint contracts are right. |
| **Impact** | Developers implementing Slice 1 will produce a Drizzle schema that contradicts every subsequent slice's route handlers. Every observation INSERT, chat message INSERT, report INSERT, and conflict INSERT will fail at compile or runtime. |
| **Minimal fix** | Perform a line-by-line reconciliation of §1.4 against the migration SQL (0001–0007). For each of the 21 tables: match every column name, type, enum values, FK direction, and index. The migration SQL is the source of truth (with 4 exceptions noted in CR-02). This is a documentation-only task — no code exists yet. |
| **Slice** | 1 (before any implementation begins) |
| **Risk if deferred** | Every slice is unbuildable. |

**Key tables requiring reconciliation (highest divergence):**

| Table | Missing/Wrong Items | Agent Refs |
|-------|-------------------|------------|
| `observations` | 7 missing columns (`label`, `numeric_value`, `data_type`, `time_behavior`, `attestation_record_id`, `confidence_score`, `created_by`), 2 wrong names, 2 wrong enums (`status`, `provenance_type`) | A-001, A-002, B-002, B-003, B-004, E-01, E-06, E-22 |
| `reports` | 10+ missing columns (`language`, `status`, `reporting_period_start/end`, `html_snapshot_r2_key`, `style_snapshot`, `observation_ids[]`, `derivation_result_ids[]`, `generated_at`, `generated_by`, `client_id`) | A-004, B-010, E-07, E-28 |
| `evidence_blocks` | 4+ missing columns (`block_type`, `chunk_type`, `merged_block_ids`, `parent_block_id`), bbox type mismatch | A-003, B-008, B-009 |
| `chat_messages` | `content` is TEXT not JSONB, missing `type` column, wrong `role` enum | A-007, B-014, E-08 |
| `attestation_records` | Entirely different structure (approval log vs attestation proof), inverted FK direction | A-013, B-005, B-028, E-09 |
| `conflict_cases` | 4 missing columns (`conflict_group_id`, `match_method`, `period_start/end`, `resolution_status`), redundant `auto_resolved` boolean | A-006, B-011, E-21 |
| `derivation_results` | Missing `stale`, `label`, `coverage`, `computed_at`; `result_value` is TEXT not NUMERIC | A-005, B-012, C-010, E-16 |
| `document_versions` | Missing `company_id`, `file_hash`, `pipeline_status_updated_at`, `detected_type`; wrong pipeline_status enum | A-017, A-022, B-013, B-027, E-03, E-26 |
| `pending_manual_observations` | Missing `expires_at`, `observation_id`; missing `timed_out` enum value | A-008, B-026, B-041, B-042, C-003 |
| `preference_memory_pointers` | Missing `client_id`; scope enum doesn't match spec's string key model | B-025, E-20 |
| `pipeline_status enum` | 4/8 values wrong (`pending`→`uploaded`, `ocr_complete`→`ocr_done`, `extraction`→`extracting`, `done`→`review_ready`) | A-017, B-001, E-03 |
| `notification.type enum` | Missing `pipeline_failed`, `manual_obs_requested`; renamed `pipeline_completed`→`pipeline_done` | A-014, B-020, E-30 |
| `key_equivalence_cache` | Three-way divergence between spec, migration, and plan | B-029 |
| `pipeline_runs` | Per-stage model vs per-run model divergence | B-035, E-31 |

---

### CR-02 — Migration SQL itself has 4 structural gaps
| Field | Detail |
|-------|--------|
| **Sources** | B-006, B-007, D-01, D-04, D-05 |
| **Severity** | CRITICAL |
| **Type** | Data model |
| **Where** | Migration files 0001, 0005, 0007 |
| **Symptom** | (1) `chat_role` enum is `(user, agent, system)` — should be `(user, assistant, tool)` per spec. (2) `user` table missing `password_hash TEXT NOT NULL`. (3) `key_equivalence_cache` missing `company_id` FK. (4) `audit_log` missing `company_id` FK. |
| **Impact** | (1) Chat messages with `role='assistant'` fail. (2) Auth.js credentials provider cannot authenticate anyone. (3) Semantic conflict detection crashes + cross-tenant cache leakage. (4) Cross-tenant audit log exposure. |
| **Minimal fix** | 4 targeted ALTER/ADD statements in the respective migration files. |
| **Slice** | 1 |
| **Risk if deferred** | Login impossible; chat broken; security violations. |

---

### CR-03 — Pipeline gate checks reject retries of crashed-in-progress jobs
| Field | Detail |
|-------|--------|
| **Sources** | C-001 |
| **Severity** | CRITICAL |
| **Type** | Concurrency |
| **Where** | Slice 2 §2.6, §2.8; Slice 3 §3.5 |
| **Symptom** | OCR gate: "If NOT `pending` → skip." If OCR crashes after setting `ocr_processing`, the retry sees `ocr_processing` and skips. Document stuck forever. Same pattern in embedding and extraction gates. |
| **Impact** | Any worker crash permanently orphans the document. No self-healing. Requires manual DB intervention. |
| **Minimal fix** | Change gate logic to "skip only if stage has already COMPLETED or a later stage is active." Treat in-progress states as re-entrant. Align with pipeline_plan.md R8 Stage 1 ("If already `ocr_done` or beyond, return early"). |
| **Slice** | 2 (OCR + embedding), 3 (extraction) |
| **Risk if deferred** | Documents permanently stuck in intermediate pipeline states. |

---

### CR-04 — Pipeline exact-match conflict fires on candidates, superseding approved observations
| Field | Detail |
|-------|--------|
| **Sources** | C-013, E-02 |
| **Severity** | CRITICAL |
| **Type** | Data model / UX-flow |
| **Where** | Slice 3 §3.5 steps 14–15; pipeline_plan Stage 4 step 8 |
| **Symptom** | Extraction job detects exact-match conflicts between new `candidate` observations and existing `approved` ones, then applies latest-wins to supersede the approved observation. Spec §11.1: conflicts exist between "two or more **approved** observations." |
| **Impact** | Approved observation silently demoted by an unreviewed candidate. If candidate is later rejected, approved observation remains superseded with no restoration path. Direct violation of "no auto-approval" invariant. |
| **Minimal fix** | Pipeline Stage 4 should only *flag* potential conflicts (create ConflictCase with `resolution_status = 'pending'`, no winner). Actual resolution triggers on approval of the new observation. |
| **Slice** | 3 |
| **Risk if deferred** | Data integrity violation — approved observations silently lost. |

---

## 3) HIGH RISKS (fix before Slice 3)

---

### HR-01 — `embedding_status` column missing from evidence_blocks
| Field | Detail |
|-------|--------|
| Sources | A-019, D-03, E-04 |
| Severity | HIGH |
| Type | Data model |
| Where | Slice 1 §1.4, Migration 0003, Pipeline plan R4 |
| Symptom | Pipeline plan R4 mandates `embedding_status ENUM('pending'|'completed'|'failed'|'skipped')`. Migration SQL doesn't include it. Implementation plan references it in §2.8 but the schema lacks it. |
| Impact | Cannot distinguish "not yet processed" from "permanently failed" blocks. Failed blocks retried forever, wasting OpenAI quota. |
| Fix | Add column to migration 0003 and §1.4. |
| Slice | 1 |
| Risk if deferred | Infinite retry on failed blocks; API cost amplification. |

---

### HR-02 — `chunk_type` enum missing `superseded` value
| Field | Detail |
|-------|--------|
| Sources | D-02 |
| Severity | HIGH |
| Type | Data model |
| Where | Migration 0001 / Slice 2 §2.7 |
| Symptom | Enum is `('original','merged','split')`. §2.7 uses `'superseded'` for blocks replaced by merge/split. |
| Impact | OCR chunking crashes on every document with mergeable blocks. |
| Fix | Add `'superseded'` to chunk_type enum. |
| Slice | 1 |

---

### HR-03 — Chat SSE in-memory replay buffer breaks under horizontal scaling
| Field | Detail |
|-------|--------|
| Sources | C-012 |
| Severity | HIGH |
| Type | Infra |
| Where | Slice 5 §5.4 |
| Symptom | Replay buffer is per-process. If `POST /messages` hits Instance A but `EventSource` connects to Instance B, the client gets empty stream. |
| Impact | Chat completely broken under horizontal scaling. |
| Fix | Replace with Redis-backed buffer (Redis Streams or List with TTL). Or ensure sticky sessions. Decision needed before Slice 5 implementation. |
| Slice | 5 |

---

### HR-04 — Confirm vs timeout race on pending manual observations
| Field | Detail |
|-------|--------|
| Sources | C-003, C-006 |
| Severity | HIGH |
| Type | Concurrency |
| Where | Slice 5 §5.8 |
| Symptom | `timed_out` missing from pending_manual_observations enum. Confirm handler and timeout job can race without atomic CAS update. |
| Impact | User-confirmed data silently discarded. Timeout DB writes fail with enum violation. |
| Fix | Add `timed_out` to enum. Both confirm/skip handlers and timeout job must use `UPDATE ... WHERE status = 'pending' RETURNING *` (atomic CAS). |
| Slice | 1 (enum), 5 (handlers) |

---

### HR-05 — Duplicate ConflictCases from concurrent semantic-conflict-jobs
| Field | Detail |
|-------|--------|
| Sources | C-004, E-15 |
| Severity | HIGH |
| Type | Concurrency |
| Where | Slice 4 §4.5 |
| Symptom | Two observations approved near-simultaneously → both jobs detect each other as conflicts → duplicate ConflictCase rows. TOCTOU gap between existence check and INSERT. |
| Impact | Duplicate conflict records; possible both observations superseded with no winner. |
| Fix | `INSERT ... ON CONFLICT DO NOTHING` on unique constraint `(company_id, LEAST(obs_a_id, obs_b_id), GREATEST(obs_a_id, obs_b_id))`. Advisory lock or single-concurrency queue per key. |
| Slice | 4 |

---

### HR-06 — `render_pdf` MCP tool polling budget exactly matches worker retry budget (60s = 60s)
| Field | Detail |
|-------|--------|
| Sources | C-005, E-10 |
| Severity | HIGH |
| Type | Concurrency / Infra |
| Where | Slice 5 §5.7, §5.11 |
| Symptom | MCP tool polls for 60s. Worker has 30s timeout × 2 attempts = 60s. With BullMQ overhead, worker regularly exceeds MCP budget. No defined completion mechanism. |
| Impact | PDF renders frequently "timeout" from agent perspective even though they succeed. |
| Fix | Increase MCP polling to 90s, or use Redis pub/sub notification from PDF worker. Define frontend fallback state ("PDF en cours de génération…"). |
| Slice | 5 |

---

### HR-07 — Duplicate observations on extraction job retry
| Field | Detail |
|-------|--------|
| Sources | C-008 |
| Severity | HIGH |
| Type | Concurrency |
| Where | Slice 3 §3.5 step 13 |
| Symptom | Job crashes after inserting observations but before setting `review_ready`. Retry re-inserts identical candidates. |
| Impact | User sees duplicate facts in review queue. Approving both creates spurious conflicts. |
| Fix | Delete existing `candidate` observations for `(document_version_id, extraction_run_id)` before re-inserting. Or wrap insert + status update in single transaction. |
| Slice | 3 |

---

### HR-08 — Report regeneration has no agent invocation path outside chat
| Field | Detail |
|-------|--------|
| Sources | E-11 |
| Severity | HIGH |
| Type | UX-flow |
| Where | Slice 5 §5.12 |
| Symptom | "Regenerate" button calls `POST /reports/{id}/regenerate`. This requires the agent loop (Grok + MCP tools) but the REST endpoint has no mechanism to invoke it. |
| Impact | Regenerate button is a dead control, or blocks HTTP response for 30–60s with no streaming. |
| Fix | Either (a) regeneration creates a new chat session and redirects user, or (b) define a `regeneration-job` BullMQ queue. Document in Slice 5. |
| Slice | 5 |

---

### HR-09 — No stuck-pipeline detection or manual retry mechanism
| Field | Detail |
|-------|--------|
| Sources | E-13 |
| Severity | HIGH |
| Type | UX-flow / Infra |
| Where | All slices — no slice addresses this |
| Symptom | If BullMQ retries exhausted or worker permanently down, document stuck at intermediate state forever. No cron, no admin endpoint, no UI retry button. |
| Impact | Stuck documents accumulate. User has no recourse except re-uploading. |
| Fix | Add `POST /api/documents/{id}/retry` (resets to `uploaded`, re-enqueues). Add stale-pipeline detection cron (every 5 min, checks `pipeline_status_updated_at`). Add "Réessayer" button on failed documents. |
| Slice | 2 |

---

### HR-10 — Agent polling for manual observation blocks event loop for 10 minutes
| Field | Detail |
|-------|--------|
| Sources | E-14 |
| Severity | HIGH |
| Type | Concurrency / Performance |
| Where | Slice 5 §5.7–§5.11 |
| Symptom | Agent polls `GET /pending/{id}` every 5s for 10 min (120 HTTP calls). Blocks the SSE stream. Multiple concurrent agents = event loop exhaustion. |
| Impact | Chat appears frozen during manual obs flow. 3–4 missing fields = 30–40 min blocking. |
| Fix | Replace polling with Redis pub/sub push. Agent subscribes to `manual-obs:{pending_id}` channel. Handler publishes on confirm/skip/timeout. |
| Slice | 5 |

---

### HR-11 — Report `html_snapshot_url` missing — iframe preview breaks
| Field | Detail |
|-------|--------|
| Sources | E-28 |
| Severity | HIGH |
| Type | UX-flow / Security |
| Where | Slice 5 / §1.4 reports table |
| Symptom | Plan has `html_content TEXT` but no R2 key for iframe src. Spec forbids `dangerouslySetInnerHTML` for report HTML. |
| Impact | Report detail page cannot render in sandboxed iframe (XSS isolation bypassed). |
| Fix | Upload HTML to R2 at report creation. Store `html_snapshot_r2_key`. Generate presigned GET URL in API response. |
| Slice | 5 |

---

### HR-12 — HNSW index DDL missing `CONCURRENTLY`
| Field | Detail |
|-------|--------|
| Sources | D-08 |
| Severity | HIGH |
| Type | Infra |
| Where | Migration 0003 |
| Symptom | `CREATE INDEX` without `CONCURRENTLY` takes `SHARE` lock on table. |
| Impact | Table locked during index build. Harmless on empty table but dangerous on redeployment or data refresh. |
| Fix | Add `CONCURRENTLY` keyword. Confirm Drizzle migration config uses `{ transaction: false }`. |
| Slice | 1 |

---

### HR-13 — pdf2pic and GraphicsMagick/Ghostscript undeclared system dependency
| Field | Detail |
|-------|--------|
| Sources | D-10 |
| Severity | HIGH |
| Type | Infra |
| Where | Slice 2 §2.6 |
| Symptom | pdf2pic delegates to `gm`/`convert`/`gs` CLI. Not in any Dockerfile or dependency list. |
| Impact | Pipeline worker crashes with `spawn gm ENOENT` on every PDF upload. |
| Fix | Add `ghostscript` and `graphicsmagick` to pipeline worker container. Document local dev setup. |
| Slice | 2 |

---

### HR-14 — PDF worker Dockerfile unspecified
| Field | Detail |
|-------|--------|
| Sources | D-09 |
| Severity | HIGH |
| Type | Infra |
| Where | Slice 5 §5.11 |
| Symptom | No base image, Chromium dependencies, or memory limits specified for PDF worker. |
| Impact | PDF worker container fails to start. |
| Fix | Specify: `node:20-slim` base, Chromium system deps, `PUPPETEER_EXECUTABLE_PATH`, 512MB–1GB memory limit. |
| Slice | 5 |

---

### HR-15 — PaddleOCR call strategy mismatch (per-file vs per-page)
| Field | Detail |
|-------|--------|
| Sources | D-06 |
| Severity | HIGH |
| Type | Infra |
| Where | Spec §5.1 vs Slice 2 §2.6 |
| Symptom | Spec sends entire PDF as base64. Plan sends individual page PNGs. Different response shapes, timeout profiles, cost models. |
| Impact | Timeout miscalibration; `parseOcrResponse` untestable until strategy is decided. |
| Fix | Decide strategy and align spec/plan. If per-page: adjust timeout to `pageCount × 20s`. Validate actual API response shape with a test call. |
| Slice | 2 |

---

### HR-16 — SLA budget (5 min for 50 pages) has no margin
| Field | Detail |
|-------|--------|
| Sources | D-07 |
| Severity | HIGH |
| Type | Performance |
| Where | Spec §12.1 / Slice 2 §2.6, Slice 3 §3.5 |
| Symptom | Estimated total: 262s optimistic, 360s+ realistic for 50-page dense PDF. 5-minute SLA = 300s. No margin for rate limiting, retry, or jitter. |
| Impact | SLA routinely violated for dense documents > 30 pages. |
| Fix | Benchmark actual latency. Increase SLA to 8 min p95, or scope 5 min to ≤20 pages. Add per-stage latency instrumentation. |
| Slice | 2 |

---

### HR-17 — Next.js App Router `index.ts` file ignored for observation PATCH route
| Field | Detail |
|-------|--------|
| Sources | A-009 |
| Severity | HIGH |
| Type | Contract |
| Where | Slice 3 §3.3 |
| Symptom | `src/app/api/observations/[id]/index.ts` — Next.js App Router only recognizes `route.ts`. File is silently ignored. |
| Impact | `PATCH /api/observations/{id}` is dead code. Observation editing non-functional. |
| Fix | Merge PATCH handler into `route.ts` alongside GET. |
| Slice | 3 |

---

### HR-18 — `GET /api/categories` forward dependency (Slice 6) blocks Slice 3–5 UI
| Field | Detail |
|-------|--------|
| Sources | A-010 |
| Severity | HIGH |
| Type | Contract |
| Where | Slice 3 §3.11, Slice 4 §4.10, Slice 5 §5.9 |
| Symptom | Category tree select in ObservationFilterPanel, ManualObservationForm, and ManualObsPopup all reference `GET /api/categories`, defined only in Slice 6. |
| Impact | Category filter and select render empty/404 for 3 slices. |
| Fix | Move read-only `GET /api/categories` to Slice 3 (requires only reading `document_categories` table). |
| Slice | 3 |

---

## 4) MEDIUM RISKS

| ID | Type | Where | Summary | Fix Slice |
|----|------|-------|---------|-----------|
| MR-01 | Data model | Slice 1 §1.4 | `pg_trgm` extension and GIN indexes not in any migration | 1 |
| MR-02 | Data model | Slice 1 §1.4 | `render-pdf-job` queue not declared in `queues.ts` | 1 |
| MR-03 | Data model | Slice 1 §1.4 | Client CRUD API completely absent from all slices | 6 |
| MR-04 | Data model | Slice 1 §1.4 | `document_category.path` has contradictory DEFAULT '' + CHECK (path <> '') | 1 |
| MR-05 | Concurrency | Slice 3 §3.4, §3.15 | `SELECT FOR UPDATE` mentioned in edge cases but not in handler spec | 3 |
| MR-06 | Concurrency | Slice 3 §3.8 | `approved → invalidated` transition in spec state machine but not in `isValidTransition` | 2–3 |
| MR-07 | Concurrency | Slice 5 §5.12 | Regeneration guard has no atomic lock mechanism | 5 |
| MR-08 | Concurrency | Slice 4 §4.6 | KeyEquivalenceCache concurrent INSERT → constraint violation crashes job | 4 |
| MR-09 | Concurrency | Slice 4 §4.6 | KeyEquivalenceCache entries never expire; stale after key renames | 4 |
| MR-10 | Infra | Slice 2 §2.10 | Pipeline SSE via Redis pub/sub is fire-and-forget; events lost on reconnect | 2 |
| MR-11 | Performance | Slice 1 RLS | `chat_message` RLS uses per-row subquery instead of denormalized `company_id` | 1 |
| MR-12 | Infra | Slice 2 §2.6 | R2 page image key collides across document versions | 2 |
| MR-13 | Security | Slice 5 §5.11 | HTML from LLM rendered in Puppeteer without sanitization (SSRF vector) | 5 |
| MR-14 | Infra | Workers | No health check endpoints on pipeline worker or PDF worker | 2, 5 |
| MR-15 | Performance | Slice 2 §2.8 | Embedding batch size 512 may exceed OpenAI token limits | 2 |
| MR-16 | Security | All slices | No rate limiting middleware defined anywhere | 1 or 6 |
| MR-17 | Infra | Slice 1 §1.7 | BullMQ `removeOnComplete` not configured; Redis memory grows unbounded | 1 |
| MR-18 | Infra | Slice 2 §2.6 | Pipeline worker DB pool not separately configured; 15 concurrent jobs vs 10-conn pool | 2 |
| MR-19 | Performance | Slice 3 §3.5 | Extraction job timeout 260s < worst-case 2×120s+overhead (270s) | 3 |
| MR-20 | Concurrency | Slice 5 §5.5, §5.8 | Agent wall-clock timeout vs BullMQ delayed job race on pending obs | 5 |
| MR-21 | UX-flow | Slice 2 §2.4 | Duplicate DocumentVersion on client retry (no idempotency on `/uploads/complete`) | 2 |
| MR-22 | Contract | Slice 4 §4.4 | Manual obs endpoint path: spec `POST /api/observations` vs plan `POST /api/observations/manual` | 4 |
| MR-23 | Contract | Slice 3 §3.4 | Observation approval: spec has separate approve/reject endpoints vs plan's combined status endpoint | 3 |
| MR-24 | Contract | Slice 5 §5.7 | `compute_derivation` operations mismatch: plan `avg/min/max` vs spec `average/delta/count` | 5 |
| MR-25 | Contract | Spec §16 | `GET /api/derivations/compute` exists in spec but only as MCP tool in plan | 5 |
| MR-26 | Contract | Spec §16 | `GET /api/documents/{id}/versions` endpoint missing from all slices | 2 |
| MR-27 | UX-flow | Slice 3 §3.5 | < 10 retrieved blocks → 0 observations with no user-facing explanation | 3 |
| MR-28 | UX-flow | Slice 5 §5.8 | Expired pending obs cleanup job never defined in any slice | 5 |
| MR-29 | UX-flow | Frontend | Dashboard summary counts stale with no SSE-triggered refresh | 2/6 |
| MR-30 | Infra | Slice 2 §2.4 | Presigned URL 15-min expiry with no 403 recovery for slow connections | 2 |
| MR-31 | Data model | Slice 1 §1.4 | All table PKs use `id` vs spec/migration entity-specific names (`company_id`, `user_id`, etc.) | 1 |
| MR-32 | UX-flow | Slice 2 / Slice 6 | Pipeline failed notification has no retry action or document link | 2 |
| MR-33 | Data model | Slice 1 §1.4 | `pipeline_runs` per-stage model vs spec's per-run model divergence | 1 |
| MR-34 | UX-flow | Slice 5 | Chunking merge threshold "20px" incompatible with ratio coordinates | 2 |
| MR-35 | Infra | Workers | BullMQ job-level timeouts not configured per queue | 1 |

---

## 5) LOW RISKS

| ID | Type | Where | Summary | Fix Slice |
|----|------|-------|---------|-----------|
| LR-01 | Data model | §1.4 | `document_categories` missing `description`, `created_by` | 1 |
| LR-02 | Observability | §2.17 | Extraction-job enqueued in Slice 2 with no consumer until Slice 3 — undocumented | 2 |
| LR-03 | Cosmetic | §1 header | Slice 1 header says "20 tables" but §1.4 lists 21 | 1 |
| LR-04 | Concurrency | §5.4 | Chat SSE buffer TTL (60s) may lose events during laptop sleep | 5 |
| LR-05 | Concurrency | §3.4 | `rejected → candidate` reconsider transition has no attestation record | 3 |
| LR-06 | Infra | §2.10 | Pipeline SSE event IDs are per-process monotonic; cross-instance replay broken | 2 |
| LR-07 | Infra | §2.6 | Orphaned R2 page PNGs on job crash | 2 |
| LR-08 | Performance | §2.8 | Embedding partial-batch retry re-embeds already-completed blocks (cost waste) | 2 |
| LR-09 | Infra | §2.11 | PaddleOCR response shape assumed, not verified | 2 |
| LR-10 | Performance | §3.6 | `ef_search = 100` per extraction query may increase CPU at scale | 3 |
| LR-11 | Concurrency | §5.7 | Derivation cache recomputation on stale: update-in-place vs insert ambiguity | 5 |
| LR-12 | UX-flow | Slice 6 | No bulk mark-read endpoint for notifications | 6 |

---

## 6) CROSS-SLICE CONTRADICTIONS

| # | Spec Says | Plan Says | Impact |
|---|-----------|-----------|--------|
| 1 | `pipeline_status` values: `uploaded, ocr_done, extracting, review_ready` | §1.4 uses: `pending, ocr_complete, extraction, done` | SSE badges, gate checks, dashboard counts all break |
| 2 | `observation.provenance_type`: `document \| manual` | §1.4 uses: `extracted \| manual \| derived` | First observation INSERT fails enum constraint |
| 3 | `observation.status`: 5 states including `superseded, invalidated` | §1.4 uses: 3 states (`candidate, approved, rejected`) | Conflict resolution and pipeline re-processing blocked |
| 4 | `AttestationRecord`: attestation proof with `source_reference`, `upgraded_by_observation_id` | §1.4: approval action log with `observation_id`, `action` enum | Inverted FK direction; manual observation flow broken |
| 5 | `chat_message.content`: JSONB with per-type shapes | §1.4: `content TEXT` + separate `tool_call JSONB` | Chat history replay loses structured data |
| 6 | `chat_message.role`: `user \| agent \| system` | §1.4: `user \| assistant \| tool` (+ migration uses `user \| agent \| system`) | Three-way role disagreement |
| 7 | `compute_derivation` operations: `sum, average, delta, ratio, count` | §5.7: `sum, avg, min, max, ratio` | Agent calls with wrong operation names; delta/count unreachable |
| 8 | `reports.html_snapshot_url` (R2 presigned URL for iframe) | §1.4: `html_content TEXT` (inline HTML) | Iframe rendering impossible; XSS isolation bypassed |
| 9 | Conflicts between "approved" observations only (§11.1) | Pipeline Stage 4 auto-resolves candidates vs approved (§3.5 step 14–15) | Approved observations silently superseded by unreviewed candidates |
| 10 | `PendingManualObservation.status` includes `timed_out` | §1.4: `pending \| confirmed \| skipped` (no timeout state) | Timeout job crashes with enum violation |
| 11 | `notification.type`: `pipeline_completed, pipeline_failed, manual_obs_requested` | §1.4: `pipeline_done, conflict_detected, conflict_resolved, report_ready` | Pipeline failures and manual obs requests go unnotified |
| 12 | `conflict_cases.resolution_status` enum: `auto_resolved \| user_reviewed \| user_overridden` | §1.4: `auto_resolved BOOLEAN` | Cannot distinguish user review types |

---

## 7) MINIMAL PATCH LIST

### Slice 1 Patches (before any implementation)

1. **§1.4 full schema reconciliation** — Replace all 21 table definitions with versions matching migration SQL 0001–0007. This single action resolves CR-01 and ~40 individual findings. Priority: do this first.

2. **Migration 0001**: Add `password_hash TEXT NOT NULL` to `user` table.

3. **Migration 0001**: Fix `chat_role` enum to `(user, assistant, tool)`.

4. **Migration 0001**: Add `'superseded'` to `chunk_type` enum.

5. **Migration 0001**: Add `embedding_status` ENUM and column to `evidence_block` (or migration 0003).

6. **Migration 0005**: Add `company_id UUID NOT NULL` to `key_equivalence_cache` + RLS policy.

7. **Migration 0007**: Add `company_id UUID NOT NULL` to `audit_log` + RLS policy.

8. **Migration 0003**: Add `CONCURRENTLY` to HNSW index DDL; confirm `{ transaction: false }`.

9. **Migration 0001**: Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;`. Add GIN indexes for trigram search.

10. **§1.7 queues.ts**: Add `render-pdf-job` and `pending-obs-timeout` queues. Add `removeOnComplete: { count: 500, age: 86400 }` to all queues.

11. **§1.4 document_category.path**: Remove `DEFAULT ''` (contradicts `CHECK (path <> '')`).

12. **Migration 0003/§1.4**: Remove `DEFAULT` contradiction on `document_category.path`.

13. **§1.7 / workers config**: Add per-queue BullMQ job timeouts (OCR=180s, embedding=120s, extraction=300s, semantic-conflict=60s, render-pdf=90s).

### Slice 2 Patches

14. **§2.6 gate logic**: Change OCR/embedding/extraction gates to "skip only if stage already completed or later stage active." (CR-03)

15. **§2.6**: Install `ghostscript` + `graphicsmagick` in pipeline worker container. Document local dev setup.

16. **§2.6**: Resolve PaddleOCR call strategy (per-file vs per-page). Validate API response shape with test call.

17. **§2.6 step 6d**: Change R2 page image key from `{company_id}/{document_id}/pages/{n}.png` to `{company_id}/{document_version_id}/pages/{n}.png`.

18. **§2.4**: Add idempotency check on `POST /api/uploads/complete` (unique constraint on `(document_id, r2_key)`).

19. **§2.4 / workers**: Configure separate DB pool for pipeline worker (`min: 5, max: 20`).

20. **Add**: `POST /api/documents/{id}/retry` endpoint + stale-pipeline detection cron. (HR-09)

21. **Add**: `GET /api/documents/{id}/versions` endpoint. (MR-26)

### Slice 3 Patches

22. **§3.3**: Rename `observations/[id]/index.ts` to merge into `route.ts`. (HR-17)

23. **§3.5 steps 14–15**: Change conflict detection to flag-only (create ConflictCase with `resolution_status='pending'`, no auto-resolve). (CR-04)

24. **§3.4**: Mandate `SELECT FOR UPDATE` in observation status change handler spec, not just edge cases.

25. **Add**: Read-only `GET /api/categories` endpoint (move from Slice 6). (HR-18)

26. **§3.5**: Add pipeline warning for `insufficient_blocks` (< 10 retrieved). Add `pipeline_warning` field to document_version.

27. **§3.5**: Increase extraction job timeout from 260s to 270s. Add elapsed-time check before retry.

28. **§3.8 / state machine**: Add `approved → invalidated` transition with trigger = `system`. Implement in upload/OCR job for re-processed documents.

### Slice 4 Patches

29. **§4.5**: Use `INSERT ... ON CONFLICT DO NOTHING` for ConflictCase deduplication. (HR-05)

30. **§4.6**: Use `INSERT ... ON CONFLICT DO NOTHING` for KeyEquivalenceCache. (MR-08)

31. **§4.4**: Standardize manual observation endpoint path as `POST /api/observations/manual`.

### Slice 5 Patches

32. **§5.4**: Replace in-memory SSE replay buffer with Redis-backed storage. (HR-03). Architectural decision: Redis Streams vs sticky sessions.

33. **§5.7–§5.11**: Replace agent polling with Redis pub/sub push for manual observation confirmation. (HR-10)

34. **§5.7 `render_pdf`**: Increase polling timeout to 90s or use Redis pub/sub notification. Define frontend fallback state. (HR-06)

35. **§5.7 `compute_derivation`**: Align operations to spec: `sum, average, delta, ratio, count`. Remove `min/max/avg`.

36. **§5.11**: Specify PDF worker Dockerfile (base image, Chromium deps, memory limits). (HR-14)

37. **§5.11/§5.17**: Sanitize HTML with DOMPurify before Puppeteer `setContent()`. (MR-13)

38. **§5.12**: Define regeneration mechanism (chat session redirect or dedicated BullMQ queue). (HR-08)

39. **§5.8**: Add pending obs cleanup job (repeatable, every 5 min).

40. **Report creation flow**: Upload HTML to R2; store `html_snapshot_r2_key` instead of inline `html_content`. (HR-11)

### Slice 6 Patches

41. **Add**: Client CRUD API (`GET/POST/PATCH/DELETE /api/clients`). (MR-03)

42. **Add**: `PATCH /api/notifications/read-all` endpoint. (LR-12)

43. **Add**: Rate limiting middleware (100 req/min per user). (MR-16)

### Cross-Slice

44. **Add**: Health check HTTP endpoints on pipeline worker (port 3002) and PDF worker (port 3003). (MR-14)

45. **Frontend**: Add SSE-triggered `router.refresh()` on Dashboard for stale count recovery. (MR-29)

46. **Frontend**: Add 403 retry with fresh presigned URL in UploadProgressOverlay. (MR-30)

---

## 8) SLICE MAP SUFFICIENCY CHECK

The current 6-slice structure is **sufficient**. No new slices are needed. However, several items must be **moved earlier**:

| Item | Current Slice | Move To | Reason |
|------|---------------|---------|--------|
| `GET /api/categories` (read-only) | 6 | 3 | Blocks category UI in Slices 3–5 |
| `POST /api/documents/{id}/retry` + stale-pipeline cron | Not assigned | 2 | Pipeline recovery must exist when pipeline launches |
| `GET /api/documents/{id}/versions` | Not assigned | 2 | Document version history needed for re-upload flow |
| Client CRUD API | Not assigned | 6 | Acceptable in Slice 6 but must be explicitly added |
| Rate limiting middleware | Not assigned | 1 or 6 | If 1: available from start. If 6: acceptable for MVP internal use. |
| Worker health checks | Not assigned | 2 (pipeline), 5 (PDF) | Deploy alongside each worker |

**Revised slice titles (no restructure needed, just scope adjustments):**

- **Slice 1**: Foundation + Auth + **Full DB Schema (reconciled with migration SQL)** + Queue declarations + Worker health check stubs
- **Slice 2**: Upload + OCR + Embedding + SSE + **Pipeline retry endpoint + Stale detection cron + Document versions endpoint**
- **Slice 3**: Extraction + Review + Observation CRUD + **Read-only Categories endpoint** + State machine (with flag-only conflict detection)
- **Slice 4**: Conflict detection + resolution + Manual observation + Notifications
- **Slice 5**: Chat + Agent + MCP tools + Report + PDF + Regeneration + **Redis-backed SSE replay**
- **Slice 6**: Dashboard + Category CRUD + Settings + **Client CRUD** + **Rate limiting** + Polish

---

*End of consolidated audit. 45 patches identified. No architectural redesign required. Primary action: reconcile §1.4 Drizzle schema with migration SQL before writing any code.*
