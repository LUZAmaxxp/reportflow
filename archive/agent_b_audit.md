# Agent B Audit — Data Model, API Contracts & Data Integrity

**Auditor:** Agent B — Data Model & Integrity  
**Date:** 2026-02-21  
**Documents reviewed:** `project_spec.md` (§1–§17), `implementation_plan.md` (§1.4 + Slices 1–6), `data_model_migration_plan.md` (migrations 0001–0007), `api_audit.md` (RISK-01–RISK-15)

---

## Summary

The **migration plan SQL** is closely aligned with the **project spec** and can serve as the source of truth for the database layer. However, the **implementation plan §1.4** (the Drizzle schema that Slice 1 developers will implement) is **severely out of sync** with both the spec and the migration SQL across 15+ tables. Later implementation plan slices (§3–§5) reference correct columns in API contracts, creating an internal contradiction where the schema declaration is wrong but the endpoint contracts are right.

Additionally, the migration SQL itself has 4 structural gaps (missing `company_id` on two tables, missing `password_hash`, wrong chat role enum) that must be fixed before RLS and auth can work.

**Issue count:** 42 findings (7 CRITICAL, 12 HIGH, 15 MEDIUM, 8 LOW)

---

## Findings

---

```
ID: B-001
Severity: CRITICAL
Type: enum-inconsistency
Where: [Implementation Plan §1.4 pipeline_status enum] vs [Spec §5.1 / §7] vs [Migration 0001]
Symptom: Implementation plan pipeline_status enum uses 6 wrong values out of 8
Impact: Drizzle schema declares (pending, ocr_processing, ocr_complete, embedding, embedded, extraction, done, failed). Spec and migration SQL use (uploaded, ocr_processing, ocr_done, embedding, embedded, extracting, review_ready, failed). SSE badges in §2.12 reference spec-aligned statuses ('ocr_done'), but the schema wouldn't allow them. All pipeline status checks, transitions, and badge mappings will fail.
Fix: Replace the implementation plan §1.4 pipeline_status enum with the spec/migration values: uploaded, ocr_processing, ocr_done, embedding, embedded, extracting, review_ready, failed.
Slice: Slice 1
Risk-if-deferred: Every pipeline status transition, SSE event, and UI badge will reference non-existent enum values. Hard runtime errors on first pipeline run.
```

---

```
ID: B-002
Severity: CRITICAL
Type: enum-inconsistency
Where: [Implementation Plan §1.4 observation.status] vs [Spec §2.5] vs [Migration 0004]
Symptom: Implementation plan observation.status enum has only (candidate, approved, rejected) — missing superseded and invalidated
Impact: The conflict handler (Slice 3 §3.5 step 15, Slice 4 §4.5) sets loser observations to 'superseded'. The state machine in §3.8 explicitly shows superseded→approved transitions. Pipeline re-run sets observations to 'invalidated'. Without these enum values in the Drizzle schema, all conflict resolution and pipeline re-processing will throw DB constraint errors.
Fix: Add 'superseded' and 'invalidated' to the observation.status enum in §1.4 to match the spec and migration SQL: (candidate, approved, rejected, superseded, invalidated).
Slice: Slice 1
Risk-if-deferred: Conflict auto-resolution is impossible. Observation lifecycle state machine is broken. Hard DB errors on any conflict detection.
```

---

```
ID: B-003
Severity: CRITICAL
Type: enum-inconsistency
Where: [Implementation Plan §1.4 observation.provenance_type] vs [Spec §2.5] vs [Migration 0004]
Symptom: Implementation plan uses enum (extracted, manual, derived). Spec and migration use (document, manual). 'extracted' and 'derived' do not exist in the DB.
Impact: Every observation INSERT from the extraction pipeline uses provenance_type='extracted' (per impl plan convention), but the DB enum only allows 'document'. Manual observation creation uses 'manual' (correct). The 'derived' value has no spec basis — derivations are separate entities, not observations.
Fix: Change impl plan §1.4 provenance_type enum to (document, manual). Replace all code references to 'extracted' with 'document'. Remove 'derived' entirely.
Slice: Slice 1
Risk-if-deferred: Hard DB constraint error on every observation INSERT from the extraction pipeline.
```

---

```
ID: B-004
Severity: CRITICAL
Type: schema-mismatch
Where: [Implementation Plan §1.4 observations table] vs [Spec §2.5] vs [Migration 0004]
Symptom: Implementation plan §1.4 observations table is missing 7 columns that spec and migration define, and uses 2 different column names
Impact: Missing columns: label, numeric_value, data_type (enum), time_behavior (enum), attestation_record_id (FK), extraction_run_id (FK), created_by (FK). Wrong names: extraction_confidence → should be confidence_score, document_version_id → should be source_document_version_id. The implementation plan's own API contracts in §3.4 and extraction output in §3.7 reference ALL these columns (label, dataType, timeBehavior, etc.), creating an internal contradiction — the Drizzle schema doesn't declare what the route handlers read/write.
Fix: Update impl plan §1.4 observations table to match spec §2.5 and migration 0004: add label TEXT NOT NULL, numeric_value NUMERIC, data_type data_type_enum NOT NULL, time_behavior time_behavior_enum NOT NULL, attestation_record_id UUID FK (DEFERRABLE), extraction_run_id UUID FK, created_by UUID FK. Rename extraction_confidence to confidence_score, document_version_id to source_document_version_id.
Slice: Slice 1
Risk-if-deferred: Drizzle schema won't compile against the route handlers defined in Slices 3–5. Every observation query/insert will fail type checks.
```

---

```
ID: B-005
Severity: CRITICAL
Type: schema-mismatch
Where: [Implementation Plan §1.4 attestation_records] vs [Spec §2.5] vs [Migration 0004]
Symptom: Implementation plan defines attestation_records as {observation_id FK, attested_by FK, action enum(approved,rejected,overridden), note}. Spec §2.5 defines it as {company_id FK, created_by FK, note, source_reference, upgraded_by_observation_id FK}. These are fundamentally different structures — the impl plan models it as an audit log for status changes, while the spec models it as proof-of-attestation for manual observations.
Impact: The circular FK resolution strategy described in migration 0004 and data_model_migration_plan.md §1.1 depends on the spec structure (AttestationRecord → upgraded_by_observation_id → Observation). The impl plan's observation_id FK goes the wrong direction. Manual observation confirmation flow (Slice 5 §5.8) needs source_reference and note fields per the popup form (§5.9).
Fix: Replace impl plan §1.4 attestation_records with spec §2.5 structure: attestation_id PK, company_id FK, created_by FK, created_at, note TEXT, source_reference TEXT, upgraded_by_observation_id UUID FK (DEFERRABLE). Remove observation_id and action columns. Follow migration 0004's circular FK strategy.
Slice: Slice 1
Risk-if-deferred: Manual observation creation will attempt to write source_reference and upgraded_by_observation_id to columns that don't exist. Circular FK mitigation strategy is impossible with the wrong schema.
```

---

```
ID: B-006
Severity: CRITICAL
Type: schema-mismatch
Where: [Migration 0001 chat_role enum] vs [Spec §7 / §16.2]
Symptom: Migration SQL creates chat_role enum as (user, agent, system). Spec defines ChatMessage.role as (user, assistant, tool). The implementation plan §1.4 correctly uses (user, assistant, tool).
Impact: Stored chat messages will use enum values that don't match spec or implementation plan code. Frontend history replay and SSE stream events all reference 'assistant' and 'tool' roles. Any ChatMessage INSERT with role='assistant' will fail with a DB constraint error.
Fix: Change migration 0001 chat_role enum to (user, assistant, tool) to match the spec and implementation plan.
Slice: Slice 1
Risk-if-deferred: Hard DB constraint error on every ChatMessage INSERT. Chat feature completely broken.
```

---

```
ID: B-007
Severity: CRITICAL
Type: missing-column
Where: [Migration 0001 user table] vs [Implementation Plan §1.4]
Symptom: Migration SQL user table has no password_hash column. Implementation plan §1.4 declares password_hash as text, not null (bcrypt). Auth.js credentials provider (§1.6) requires password_hash for bcrypt.compare().
Impact: Authentication flow described in §1.9 (SELECT user → bcrypt.compare(password, hash)) is impossible without the column. Login will fail.
Fix: Add password_hash TEXT NOT NULL to the user table in migration 0001.
Slice: Slice 1
Risk-if-deferred: Authentication is completely non-functional. No user can log in.
```

---

```
ID: B-008
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 evidence_blocks] vs [Spec §2.3] vs [Migration 0003]
Symptom: Implementation plan §1.4 evidence_blocks is missing 10 columns and has 2 naming differences vs spec and migration SQL
Impact: Missing: block_type (enum), chunk_type (enum), merged_block_ids UUID[], parent_block_id FK, doc_date DATE, period_start DATE, period_end DATE, site TEXT, supplier TEXT. Wrong name: text_content → should be 'text' per spec and migration. The chunking strategy in impl plan §2.7 explicitly references chunk_type and merged_block_ids, creating an internal inconsistency.
Fix: Add all missing columns to impl plan §1.4 evidence_blocks to match spec §2.3 and migration 0003. Rename text_content to text.
Slice: Slice 1
Risk-if-deferred: Chunking strategy (§2.7) cannot set chunk_type or merged_block_ids. OCR block type classification is impossible. Drizzle ORM type inference will not include these fields.
```

---

```
ID: B-009
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 evidence_blocks.bbox] vs [Spec §2.3 / Migration 0003]
Symptom: Impl plan §1.4 declares bbox as JSONB ({x1,y1,x2,y2}). Migration SQL declares it as FLOAT[] with CHECK(array_length=4). Spec §2.3 declares it as float[4] (x,y,w,h).
Impact: Three-way format disagreement. The Drizzle ORM type will differ from the actual DB column type. The coordinate semantics also differ: spec uses (x,y,w,h) but impl plan uses (x1,y1,x2,y2). The migration SQL uses FLOAT[] without specifying the semantic format. The SVG overlay in §3.9 renders rect from {x1,y1,x2,y2} which is the impl plan format, not the spec format.
Fix: Standardize on FLOAT[] (matching migration SQL) with the (x1,y1,x2,y2) ratio-coordinate semantic (matching impl plan §2.11). Update spec §2.3 to use (x1,y1,x2,y2) instead of (x,y,w,h). Keep migration SQL's CHECK constraint for length=4. Update impl plan §1.4 from jsonb to real[].
Slice: Slice 1
Risk-if-deferred: Drizzle schema declares jsonb; actual column is FLOAT[]. Every bbox read/write will have a type mismatch. SVG overlay may render incorrect highlights.
```

---

```
ID: B-010
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 reports table] vs [Spec §7] vs [Migration 0006]
Symptom: Impl plan §1.4 reports table is missing 7 columns and has 3 naming/type differences vs spec and migration SQL
Impact: Missing: language, status (draft|final enum), reporting_period_start, reporting_period_end, style_snapshot (jsonb), generated_by FK, html_snapshot_r2_key (R2 key reference). Wrong names/types: html_content TEXT → should be html_snapshot TEXT, pdf_url → should be pdf_r2_key. Extra: chat_session_id FK (not in spec or migration). The Slice 5 report API contracts (§5.10) reference all spec columns, contradicting §1.4.
Fix: Update impl plan §1.4 reports table to match spec §7 and migration 0006. Add language TEXT, status report_status DEFAULT 'draft', reporting_period_start DATE, reporting_period_end DATE, style_snapshot JSONB, generated_by UUID FK, html_snapshot_r2_key TEXT, observation_ids UUID[], derivation_result_ids UUID[]. Rename html_content→html_snapshot, pdf_url→pdf_r2_key. Remove chat_session_id.
Slice: Slice 1
Risk-if-deferred: Report creation (Slice 5) will attempt to write language, status, style_snapshot, observation_ids, etc. to non-existent columns.
```

---

```
ID: B-011
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 conflict_cases] vs [Spec §11.5] vs [Migration 0005]
Symptom: Impl plan §1.4 conflict_cases is missing 4 columns vs spec and migration: conflict_group_id, match_method (exact|semantic enum), period_start, period_end. Has different column naming for resolved_at.
Impact: Semantic conflict detection (Slice 4 §4.5) creates ConflictCases with match_method='semantic' and conflict_group_id for grouping. Without these columns, semantic near-duplicate conflicts cannot be stored or queried. The conflicts API (§4.4) returns matchMethod and conflictGroupId in responses.
Fix: Add conflict_group_id UUID NOT NULL, match_method conflict_match_method NOT NULL, period_start DATE, period_end DATE to impl plan §1.4 conflict_cases. Update resolution_status column to use the conflict_resolution_status enum.
Slice: Slice 1
Risk-if-deferred: Semantic conflict detection is impossible. Conflict inbox cannot distinguish exact vs semantic matches.
```

---

```
ID: B-012
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 derivation_results] vs [Spec §2.6] vs [Migration 0005]
Symptom: Impl plan §1.4 derivation_results is missing 4 columns and has naming/type differences vs spec and migration
Impact: Missing: label TEXT, coverage JSONB (with shape constraint), stale BOOLEAN, computed_at TIMESTAMPTZ. Wrong types: result_value TEXT (should be NUMERIC), result_unit (should be 'unit'). input_hash (should be 'fingerprint_hash'). The compute_derivation MCP tool (§5.7) returns stale and coverage fields that cannot be stored.
Fix: Add label, coverage JSONB with CHECK constraint, stale BOOLEAN DEFAULT false, computed_at TIMESTAMPTZ. Change result_value to NUMERIC. Rename result_unit→unit, input_hash→fingerprint_hash.
Slice: Slice 1
Risk-if-deferred: Derivation cache invalidation (stale marking) is impossible. Coverage metadata for partial derivations cannot be stored.
```

---

```
ID: B-013
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 documents table] vs [Spec §7] vs [Migration 0002]
Symptom: Impl plan §1.4 has original_filename instead of title; missing detected_type enum and updated_at
Impact: Spec §7 and migration 0002 use 'title' as the display name. The Document entity in the spec stores detected_type for auto-detected document labels. Without updated_at, ETag/If-Modified-Since is impossible (acknowledged in data_model_migration_plan.md §1.6). The dashboard summary endpoint (§6.2) and document list API return 'title'.
Fix: Add title TEXT NOT NULL, detected_type detected_doc_type DEFAULT 'other', updated_at TIMESTAMPTZ. Keep original_filename on DocumentVersion only (where migration SQL puts it), not on Document.
Slice: Slice 1
Risk-if-deferred: Document list API will fail to return 'title'. Auto-detection labeling has no column to write to. Cache invalidation is impaired.
```

---

```
ID: B-014
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 chat_messages] vs [Spec §7] vs [Migration 0006]
Symptom: Impl plan §1.4 chat_messages has content as TEXT (not JSONB) and has tool_call JSONB nullable; is missing the type column entirely
Impact: Spec §7 and migration 0006 define content as JSONB and type as chat_message_type enum. The per-type content shapes defined in §5.13 require JSONB storage. The type column is essential for dispatching message rendering in the chat UI (§5.14). Without it, chat history replay is impossible.
Fix: Change content from TEXT to JSONB. Add type chat_message_type NOT NULL. Remove tool_call column (tool call data goes in content JSONB when type='agent_tool_call').
Slice: Slice 1
Risk-if-deferred: Chat messages stored as plain text cannot be type-dispatched. All tool_call, manual_obs_request, and report_ready messages lose their structured data.
```

---

```
ID: B-015
Severity: HIGH
Type: missing-column
Where: [Migration 0005 key_equivalence_cache] vs [Spec §7] vs [Implementation Plan §1.4]
Symptom: Migration SQL key_equivalence_cache table has no company_id column. Spec defines company_id FK. Impl plan §1.4 defines company_id FK.
Impact: Without company_id, the cache is shared across all tenants. Tenant A's key equivalence results are visible/usable by Tenant B. This breaks tenant isolation. The semantic conflict job (§4.5 step 3b) queries by company_id, which would fail or return cross-tenant results.
Fix: Add company_id UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE to migration 0005 key_equivalence_cache. Update the unique constraint to include company_id.
Slice: Slice 1
Risk-if-deferred: Cross-tenant data leakage in key equivalence results. Security violation.
```

---

```
ID: B-016
Severity: HIGH
Type: RLS-gap
Where: [Migration 0007 RLS policies] vs [Migration 0005 key_equivalence_cache]
Symptom: key_equivalence_cache is excluded from RLS policies with comment "company-agnostic — no RLS". But the spec defines it WITH company_id.
Impact: Even if company_id is added (B-015 fix), RLS is not applied. Direct DB queries without the withTenant wrapper would return cross-tenant cache entries.
Fix: After adding company_id (B-015), add key_equivalence_cache to the RLS policy loop in migration 0007.
Slice: Slice 1
Risk-if-deferred: Tenant isolation bypass on key equivalence data. A defense-in-depth gap.
```

---

```
ID: B-017
Severity: HIGH
Type: RLS-gap
Where: [Migration 0007 audit_log] vs [Spec §7]
Symptom: Migration SQL audit_log table has no company_id column. Spec defines company_id FK. RLS comment says "admin-only; enforce via application role check." The implementation plan §1.4 includes company_id on audit_log.
Impact: Without company_id, the withTenant wrapper cannot scope audit log queries. An admin from Company A could potentially read audit logs from Company B through the GET /api/audit-log endpoint (if one existed), or see cross-tenant entries when querying. The company data deletion flow (§6.11) cannot identify which audit logs belong to the company being deleted.
Fix: Add company_id UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE to audit_log in migration 0007. Consider adding RLS policy or ensure application-layer company scoping.
Slice: Slice 1
Risk-if-deferred: Cross-tenant audit log visibility. Company data deletion may leave orphaned logs or delete wrong company's logs.
```

---

```
ID: B-018
Severity: HIGH
Type: contract-mismatch
Where: [Implementation Plan §5.7 compute_derivation operations] vs [Spec §10.2 / Migration 0001]
Symptom: Impl plan §5.7 MCP tool uses operations (sum, avg, min, max, ratio). Spec §10.2 and migration enum define (sum, average, delta, ratio, count). Three operations differ: avg≠average, min/max not in spec, delta/count missing from impl.
Impact: Agent calls compute_derivation with 'avg' but DB enum rejects it. YoY delta calculations (critical for ESG reporting) have no operation. Count operations for coverage are missing.
Fix: Align impl plan §5.7 to spec operations: sum, average, delta, ratio, count. Remove min/max (not in spec). Use 'average' not 'avg'.
Slice: Slice 5
Risk-if-deferred: Hard DB constraint error on insert. Agent cannot compute YoY changes (delta) or count operations.
```

---

```
ID: B-019
Severity: HIGH
Type: schema-mismatch
Where: [Implementation Plan §1.4 document_categories] vs [Spec §2.4] vs [Migration 0002]
Symptom: Impl plan §1.4 document_categories is missing 3 columns: description TEXT, created_by UUID FK, updated_at TIMESTAMPTZ
Impact: Spec §2.4 explicitly defines description as "optional string". Migration 0002 includes all three. Category API contracts (§6.5) and category management UI require these for audit trail. Without updated_at, optimistic concurrency on category rename/move is impossible.
Fix: Add description TEXT nullable, created_by UUID FK → users ON DELETE SET NULL, updated_at TIMESTAMPTZ DEFAULT now() to impl plan §1.4 document_categories.
Slice: Slice 1
Risk-if-deferred: Category audit trail incomplete. Drizzle type inference misses these fields; optional description field cannot be stored.
```

---

```
ID: B-020
Severity: MEDIUM
Type: enum-inconsistency
Where: [Implementation Plan §1.4 notification.type] vs [Spec §7] vs [Migration 0001]
Symptom: Impl plan uses notification types (pipeline_done, conflict_detected, conflict_resolved, report_ready). Spec and migration use (pipeline_completed, pipeline_failed, conflict_detected, report_ready, manual_obs_requested). Differences: pipeline_done→pipeline_completed, missing pipeline_failed and manual_obs_requested, extra conflict_resolved.
Impact: Notification inserts from the pipeline DLQ handler use type='pipeline_failed' which doesn't exist in impl plan enum. Manual observation popup notifications (type='manual_obs_requested') can't be stored.
Fix: Update impl plan §1.4 notification.type enum to match spec/migration: pipeline_completed, pipeline_failed, conflict_detected, report_ready, manual_obs_requested. Add conflict_resolved if needed, but document it as an addition.
Slice: Slice 1
Risk-if-deferred: Pipeline failure notifications silently dropped. Manual observation request notifications cannot be created.
```

---

```
ID: B-021
Severity: MEDIUM
Type: contract-mismatch
Where: [Implementation Plan §4.4 POST /api/observations/manual] vs [Spec §16]
Symptom: Spec §16 lists the manual observation endpoint as POST /api/observations. Impl plan §4.4 defines it as POST /api/observations/manual. Different URL path.
Impact: Frontend code and any API documentation will reference different paths depending on which document is consulted. API routing will fail if the wrong path is used.
Fix: Standardize on POST /api/observations/manual (impl plan convention is more specific and avoids collision with a potential future general-purpose POST /api/observations).
Slice: Slice 4
Risk-if-deferred: Frontend-backend path mismatch; 404 on API call.
```

---

```
ID: B-022
Severity: MEDIUM
Type: contract-mismatch
Where: [Spec §16 PATCH /api/observations/{id}/approve + /reject] vs [Implementation Plan §3.4]
Symptom: Spec §16 lists separate PATCH /api/observations/{id}/approve and PATCH /api/observations/{id}/reject endpoints. Impl plan §3.4 combines them into a single PATCH /api/observations/{id}/status with { status } body.
Impact: Frontend code built against spec uses two endpoints; code built against impl plan uses one endpoint with a body field. Inconsistency in API surface.
Fix: Document the combined PATCH /api/observations/{id}/status approach as canonical (aligns with the state machine pattern and supports reconsider/superseded transitions). Update spec §16 to remove separate approve/reject endpoints.
Slice: Slice 3
Risk-if-deferred: Dual implementations; API consumers confused about which endpoint to use.
```

---

```
ID: B-023
Severity: MEDIUM
Type: contract-mismatch
Where: [Spec §16 GET /api/derivations/compute] vs [Implementation Plan §5.7]
Symptom: Spec §16 lists GET /api/derivations/compute as a REST endpoint. Implementation plan only defines compute_derivation as an MCP tool (§5.7) with no corresponding REST route handler.
Impact: If a frontend component needs to compute a derivation outside the chat context (e.g., dashboard totals), there is no REST endpoint to call.
Fix: Either add a REST endpoint GET /api/derivations/compute (or POST) that delegates to the MCP tool implementation, or document that derivations are chat-only in MVP.
Slice: Slice 5
Risk-if-deferred: No REST-accessible derivation computation. Dashboard or observation detail pages cannot show computed aggregates.
```

---

```
ID: B-024
Severity: MEDIUM
Type: contract-mismatch
Where: [Spec §16 GET /api/documents/{id}/versions] vs [Implementation Plan]
Symptom: Spec §16 lists GET /api/documents/{id}/versions to list DocumentVersions for a document. No implementation plan slice defines this endpoint or its route handler.
Impact: Frontend cannot display document version history. If a document has multiple versions (re-upload), there's no API to list them.
Fix: Add GET /api/documents/{id}/versions route handler to Slice 2. Response: paginated list of DocumentVersion records (version, pipeline_status, page_count, created_at).
Slice: Slice 2
Risk-if-deferred: Document version history is inaccessible via API.
```

---

```
ID: B-025
Severity: MEDIUM
Type: schema-mismatch
Where: [Implementation Plan §1.4 preference_memory_pointers] vs [Spec §7] vs [Migration 0006]
Symptom: Three-way divergence. Impl plan has scope enum(report_style, data_preference, general) + mem0_memory_id. Spec has mem0_memory_id + scope_key (text) + client_id + updated_at. Migration has mem0_scope_key (text) + client_id but missing mem0_memory_id and updated_at.
Impact: The scope enum in impl plan is too rigid — mem0 scoping (§8.1) uses dynamic string keys like 'user:{id}:company:{id}:client:{id}', not a fixed enum. Missing client_id in impl plan prevents per-client preference scoping. Missing mem0_memory_id in migration prevents linking to the external mem0 record.
Fix: Align all three to: pointer_id, company_id FK, user_id FK, client_id FK nullable, mem0_memory_id TEXT, mem0_scope_key TEXT, created_at, updated_at. Remove the scope enum. Add mem0_memory_id to migration. Add updated_at to migration.
Slice: Slice 1
Risk-if-deferred: Per-client preference scoping broken. mem0 record cannot be linked back to the pointer.
```

---

```
ID: B-026
Severity: MEDIUM
Type: missing-column
Where: [Implementation Plan §1.4 pending_manual_observations] vs [Spec §7] vs [Migration 0007]
Symptom: Both impl plan §1.4 and migration SQL pending_manual_observation tables are missing observation_id FK nullable. Spec defines observation_id FK nullable (set when status=confirmed).
Impact: The GET /api/manual-observations/pending/{id} response (§5.8) returns observation_id when confirmed. Without the column, there's no persistent link between the pending record and the created observation. The agent's 5-second poll for status=confirmed also needs observation_id to know which observation was created.
Fix: Add observation_id UUID REFERENCES observation(observation_id) ON DELETE SET NULL to both the impl plan §1.4 schema and migration 0007 SQL.
Slice: Slice 1
Risk-if-deferred: Agent cannot retrieve the observation_id after manual observation confirmation without a separate query. Poll response is incomplete.
```

---

```
ID: B-027
Severity: MEDIUM
Type: schema-mismatch
Where: [Implementation Plan §1.4 document_versions] vs [Spec §7] vs [Migration 0002]
Symptom: Impl plan §1.4 has different columns than spec and migration. Notably: uses 'r2_key' vs 'object_key', 'version' vs 'version_number', lacks 'file_hash', 'pipeline_status_updated_at', 'ocr_quality_warning', 'detected_type', 'company_id' (denormalized for RLS), 'created_by'. Also declares pipeline_status with wrong enum (see B-001).
Impact: Without denormalized company_id, RLS cannot be applied to document_versions directly (migration 0002 and 0007 both include company_id on document_version and apply RLS). Missing file_hash prevents duplicate detection.
Fix: Update impl plan §1.4 document_versions to match migration 0002: add company_id FK, file_hash TEXT, object_key (rename from r2_key), pipeline_status_updated_at, ocr_quality_warning, detected_type, created_by. Rename 'version' to 'version_number' or keep as 'version' but note alignment.
Slice: Slice 1
Risk-if-deferred: RLS on document_versions requires company_id. Duplicate file detection impossible without file_hash.
```

---

```
ID: B-028
Severity: MEDIUM
Type: FK-error
Where: [Implementation Plan §1.4 attestation_records.observation_id FK] vs [Spec §2.5 / Migration 0004 circular FK strategy]
Symptom: Impl plan §1.4 defines attestation_records with observation_id FK → observations.id. But spec §2.5 and migration 0004 define the FK in the OPPOSITE direction: observations.attestation_record_id FK → attestation_records.attestation_id. The migration also has a back-pointer: attestation_records.upgraded_by_observation_id FK → observations.observation_id, creating a deliberate circular FK resolved via DEFERRABLE INITIALLY DEFERRED.
Impact: The circular FK resolution strategy (data_model_migration_plan.md §1.1) cannot work with the impl plan's FK direction. Manual observation creation flow requires creating AttestationRecord FIRST, then Observation with attestation_record_id pointing to it — impossible if the FK goes observation_id → observations.
Fix: Reverse the FK direction in impl plan §1.4 to match spec and migration: Observation.attestation_record_id → AttestationRecord.attestation_id. Add AttestationRecord.upgraded_by_observation_id → Observation.observation_id (DEFERRABLE).
Slice: Slice 1
Risk-if-deferred: Circular FK insert ordering fails. Manual observation creation is broken.
```

---

```
ID: B-029
Severity: MEDIUM
Type: schema-mismatch
Where: [Implementation Plan §1.4 key_equivalence_cache] vs [Spec §7] vs [Migration 0005]
Symptom: Three-way divergence. Impl plan has (company_id, key_a, key_b, are_equivalent BOOLEAN, classifier_model). Spec has (company_id, key_a, key_b, is_equivalent BOOLEAN, checked_at, expires_at). Migration has (key_pair_hash, key_a, key_b, result ENUM(SAME_KEY, DIFFERENT_KEY), rationale, created_at) — no company_id, no boolean, uses enum instead.
Impact: No single authoritative schema. Developers will have to choose which to implement. The missing expires_at in migration means cache entries never expire (acknowledged in data_model_migration_plan.md §1.13 as post-MVP, but spec includes it).
Fix: Converge on: cache_id, company_id FK, key_pair_hash TEXT UNIQUE, key_a TEXT, key_b TEXT, is_equivalent BOOLEAN, rationale TEXT, checked_at TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ nullable. The enum is unnecessarily complex for a boolean; keep it simple.
Slice: Slice 1
Risk-if-deferred: Schema ambiguity blocks implementation. Missing company_id is a security gap (B-015).
```

---

```
ID: B-030
Severity: MEDIUM
Type: lifecycle-error
Where: [Implementation Plan §1.4 attestation_records.action enum] vs [Spec §2.5 lifecycle]
Symptom: Impl plan §1.4 defines action enum as (approved, rejected, overridden). Spec §2.5 lifecycle table shows transition actors include 'edited' action for observation field edits (label, key, value changes). The migration plan does not define an action column AT ALL on attestation_record (spec §2.5 version has no action field).
Impact: If using the spec §2.5 structure (recommended — see B-005), there is no action column. If using impl plan structure, 'edited' is missing. Either way, the attestation_records table cannot track all observation status change types.
Fix: Since spec §2.5 AttestationRecord is specifically for manual observation proof-of-attestation (not an audit log), observation status changes should be tracked in the AuditLog table instead. Remove the action enum from attestation_records.
Slice: Slice 1
Risk-if-deferred: Confusion about what attestation_records tracks — audit trail vs attestation proof.
```

---

```
ID: B-031
Severity: MEDIUM
Type: schema-mismatch
Where: [Implementation Plan §1.4 conflict_resolutions] vs [Spec §11.5] vs [Migration 0005]
Symptom: Impl plan §1.4 uses winning_observation_id; spec §11.5 and migration use chosen_observation_id. Impl plan uses 'note'; spec uses 'reason' (max 500 chars).
Impact: Column name mismatch between Drizzle schema and migration SQL. Post-migration, Drizzle ORM references will not match actual column names.
Fix: Rename winning_observation_id → chosen_observation_id, note → reason in impl plan §1.4.
Slice: Slice 1
Risk-if-deferred: Drizzle ORM queries reference non-existent column names. Runtime errors on conflict resolution.
```

---

```
ID: B-032
Severity: MEDIUM
Type: enum-inconsistency
Where: [Migration 0001 conflict_resolution_status] vs [Spec §7 / §11.5]
Symptom: Migration enum has (auto_resolved, user_reviewed, user_overridden). Spec uses the same values. BUT the implementation plan §1.4 conflict_cases table uses auto_resolved BOOLEAN + resolved_at TIMESTAMPTZ instead of the resolution_status enum.
Impact: The conflict API (§4.4) returns resolutionStatus field with enum values. Without the enum column on the table, the API response must be synthetically derived from the boolean flag, losing the user_reviewed vs user_overridden distinction.
Fix: Replace auto_resolved BOOLEAN and resolved_at in impl plan §1.4 with resolution_status conflict_resolution_status enum DEFAULT 'auto_resolved'. Keep updated_at for timestamps.
Slice: Slice 1
Risk-if-deferred: Cannot distinguish between user_reviewed and user_overridden conflict resolutions in query filters or API responses.
```

---

```
ID: B-033
Severity: MEDIUM
Type: JSONB-unvalidated
Where: [Implementation Plan §1.4 pending_manual_observations.prefilled] vs [Spec §7]
Symptom: prefilled JSONB column has no CHECK constraint or documented schema. The expected shape is { label, normalized_key, value, unit, period_start, period_end } (per §5.9 manual obs popup), but nothing enforces this at the DB level.
Impact: Malformed prefilled data could be stored, causing the manual observation popup to render incorrectly or crash.
Fix: Add a JSONB CHECK constraint on prefilled requiring at minimum the 'label' and 'normalized_key' keys: CHECK (prefilled ? 'label' AND prefilled ? 'normalized_key'). Or document that validation is application-layer only with a code comment.
Slice: Slice 5
Risk-if-deferred: Silent data corruption in prefilled payloads. Low probability but no detection mechanism.
```

---

```
ID: B-034
Severity: MEDIUM
Type: missing-index
Where: [Implementation Plan §1.4 evidence_blocks indexes] vs [Migration 0003]
Symptom: Impl plan §1.4 evidence_blocks lists only 2 indexes (HNSW on embedding, btree on company_id+document_version_id). Migration 0003 creates 6 indexes: btree on document_version_id, btree on company_id, btree on parent_block_id (partial), GIN on merged_block_ids, GIN on text (pg_trgm). The pg_trgm index is critical for BM25-style retrieval in §3.6.
Fix: Update impl plan §1.4 to list all 6 indexes from migration 0003 so Slice 1 developers include them in the Drizzle schema.
Slice: Slice 1
Risk-if-deferred: pg_trgm text search falls back to sequential scan. Hybrid retrieval in extraction (§3.5) is orders of magnitude slower on large datasets.
```

---

```
ID: B-035
Severity: MEDIUM
Type: schema-mismatch
Where: [Implementation Plan §1.4 pipeline_runs] vs [Migration 0003]
Symptom: Impl plan §1.4 pipeline_runs has stage enum(ocr, embedding, extraction) and status enum(queued, running, done, failed). Migration 0003 has no stage column and status enum is pipeline_run_status(running, completed, failed). Also migration adds company_id FK, observations_created, observations_skipped columns not in impl plan.
Impact: Stage tracking per pipeline_run is in impl plan but not migration. The impl plan's pipeline_status-check idempotency guard (§2.6) relies on the stage column. 'queued' status is in impl plan but not migration enum. 'completed' vs 'done' naming differs.
Fix: Reconcile: add stage column to migration SQL OR remove it from impl plan and track stage via pipeline_status on document_version. Add 'queued' to the migration enum if stage is kept. Add company_id, observations_created, observations_skipped to impl plan. Align status naming (completed vs done).
Slice: Slice 1
Risk-if-deferred: Drizzle schema and DB schema disagree on pipeline_run structure. Stage tracking breaks.
```

---

```
ID: B-036
Severity: LOW
Type: schema-mismatch
Where: [Implementation Plan §1.4 companies table] vs [Spec §7] vs [Migration 0001]
Symptom: Impl plan §1.4 companies table uses 'id' as PK name. Spec §7 uses 'company_id'. Migration SQL uses 'company_id'. All FK references in other tables use 'company_id'.
Impact: Naming inconsistency. If Drizzle schema declares 'id', FK references to 'companies.id' vs 'company.company_id' will not match.
Fix: Rename 'id' to 'company_id' in impl plan §1.4 companies table. Apply same convention to all tables (users.id → user_id, documents.id → document_id, etc.).
Slice: Slice 1
Risk-if-deferred: FK reference naming confusion. Drizzle ORM relation definitions may not map correctly.
```

---

```
ID: B-037
Severity: LOW
Type: schema-mismatch
Where: [Implementation Plan §1.4 all tables PK naming] vs [Spec §7] vs [Migration SQL]
Symptom: Impl plan §1.4 uses 'id' as PK for all 21 tables. Spec and migration SQL use entity-specific PK names (company_id, user_id, document_id, block_id, observation_id, etc.).
Impact: All Drizzle relation definitions, join queries, and FK mappings will use different PK column names than the actual DB, causing runtime SQL errors.
Fix: Update all impl plan §1.4 table PK columns to use spec naming: company_id, user_id, client_id, category_id, document_id, document_version_id, block_id, observation_id, attestation_id, pending_id, result_id, cache_id, conflict_id, resolution_id, report_id, pointer_id, run_id, notification_id, session_id, message_id, log_id.
Slice: Slice 1
Risk-if-deferred: Every FK reference from Drizzle schema to actual DB will use wrong column name.
```

---

```
ID: B-038
Severity: LOW
Type: missing-index
Where: [Implementation Plan §1.4] vs [Migration 0004–0007]
Symptom: Impl plan §1.4 observations table lists only 2 btree indexes. Migration 0004 creates 7 indexes: btree on (company_id, normalized_key, status), btree on (company_id, period_start, period_end), btree on source_document_version_id (partial), btree on category_id (partial), btree on attestation_record_id (partial), GIN on evidence_block_ids, GIN+trgm on normalized_key.
Fix: Update impl plan §1.4 observations index list to include all migration 0004 indexes.
Slice: Slice 1
Risk-if-deferred: Missing indexes won't cause errors but will cause slow queries on conflict detection, period overlap checks, and observation search.
```

---

```
ID: B-039
Severity: LOW
Type: JSONB-unvalidated
Where: [Implementation Plan §1.4 chat_messages.content] vs [Spec §7]
Symptom: chat_messages.content is JSONB with per-type shapes defined in §5.13, but no DB-level CHECK constraint validates the shape. Different type values require different content shapes (e.g., user_text needs {text}, report_ready needs {report_id, title, html_snapshot_url, pdf_url}).
Impact: Malformed content JSONB could be stored if application-layer validation is bypassed, causing chat history replay to crash.
Fix: Document that JSONB validation is application-layer only (Zod schemas in route handlers). Add a code comment in the Drizzle schema noting the per-type shapes. Optionally add a minimal CHECK: content ? 'text' OR content ? 'pending_id' OR content ? 'report_id' OR content ? 'message'.
Slice: Slice 5
Risk-if-deferred: Low probability but no DB-level safety net for chat message content shape.
```

---

```
ID: B-040
Severity: LOW
Type: JSONB-unvalidated
Where: [Implementation Plan §1.4 notifications.payload] vs [Spec §7 / §16.1]
Symptom: notifications.payload JSONB has no CHECK constraint. Per-type payload shapes are defined in §16.1 (pipeline_stage_changed, extraction_complete, conflict_detected, etc.) but not enforced at DB level.
Impact: Same as B-039 — malformed payloads could reach the notification bell dropdown.
Fix: Document application-layer-only validation. Optionally add minimal CHECK constraints per notification type.
Slice: Slice 4
Risk-if-deferred: Very low — notification payloads are only written by server-side code, not user input.
```

---

```
ID: B-041
Severity: LOW
Type: missing-column
Where: [Implementation Plan §1.4 pending_manual_observations] vs [Migration 0007]
Symptom: Impl plan §1.4 pending_manual_observations has no expires_at column. Migration 0007 defines expires_at as a GENERATED ALWAYS column: created_at + INTERVAL '10 minutes' STORED. Spec defines expires_at.
Impact: The agent's 10-minute timeout and the GET /api/manual-observations/pending/{id} response (§5.8) both need expires_at. Without it, timeout enforcement must be computed at application layer on every read.
Fix: Add expires_at TIMESTAMPTZ GENERATED ALWAYS AS (created_at + INTERVAL '10 minutes') STORED to impl plan §1.4. Note: Drizzle ORM may need special handling for generated columns.
Slice: Slice 1
Risk-if-deferred: Timeout enforcement is more complex without the generated column. BullMQ cleanup job has no indexed column to query.
```

---

```
ID: B-042
Severity: LOW
Type: enum-inconsistency
Where: [Implementation Plan §1.4 pending_manual_observations.status] vs [Spec §7] vs [Migration 0007]
Symptom: Impl plan §1.4 has enum (pending, confirmed, skipped) — missing 'timeout'. Migration SQL has (pending, confirmed, skipped, timed_out). Spec mentions timeout behavior but the context says 'timeout'. Migration uses 'timed_out'.
Impact: BullMQ delayed job (§5.8) sets status='timeout' or 'timed_out' — won't match enum if 'timeout'/'timed_out' is missing. Agent poll response (§5.8) returns status="timeout".
Fix: Add 'timed_out' to impl plan §1.4 pending_manual_observations.status enum. Ensure application code uses 'timed_out' (matching migration) consistently.
Slice: Slice 1
Risk-if-deferred: Timeout status cannot be persisted. Expired pending observations stay in 'pending' state forever.
```

---

## Cross-Cutting Observations

### Implementation Plan §1.4 Is the Primary Risk

The single largest source of issues is the **implementation plan §1.4 schema declaration** being drastically out of sync with both the project spec and the migration plan SQL. The migration plan appears to have been written after (and as a correction to) the implementation plan, but §1.4 was never updated to reflect the corrections. Since Slice 1 developers will use §1.4 to write the Drizzle ORM schema, they will produce code that contradicts the migration SQL and breaks Slices 2–6.

**Recommended action:** Perform a full rewrite of §1.4 to mirror the migration plan SQL exactly. Every table, every column, every enum, every FK, every index should match.

### Migration Plan SQL Is Largely Sound

The migration SQL (0001–0007) is well-structured and closely follows the spec. The 4 issues found in the migration SQL (B-006 chat_role, B-007 password_hash, B-015 key_equivalence_cache company_id, B-017 audit_log company_id) are all fixable with targeted ALTER statements.

### Later Implementation Plan Slices Self-Correct

Slices 3–6 API endpoint contracts (§3.4, §4.4, §5.7–§5.13, §6.2–§6.10) reference the CORRECT column names and enum values from the spec/migration, contradicting §1.4. This means the API layer is spec-aligned, but the ORM layer (§1.4) is not. Developers will hit type mismatches immediately when wiring route handlers to Drizzle queries.

---

## Priority Fix Order

1. **Slice 1 blockers (CRITICAL):** B-001 through B-007 — must be fixed before any Slice 1 code is written
2. **Slice 1 schema alignment (HIGH):** B-008 through B-019 — fix during Slice 1 Drizzle schema implementation
3. **Cross-slice API alignment (MEDIUM):** B-020 through B-035 — fix before each relevant slice begins
4. **Polish (LOW):** B-036 through B-042 — fix during code review
