# Agent C — Concurrency, Retry Logic & State Machine Safety Audit

> **Auditor:** Agent C  
> **Date:** 2026-02-21  
> **Scope:** BullMQ idempotency, SSE ordering, timeout races, state machine safety, conflict concurrency, cache correctness, duplication risks  
> **Documents reviewed:** `implementation_plan.md` (§1–§6), `pipeline_plan.md`, `project_spec.md` (§1–§17), `api_audit.md`, `data_model_migration_plan.md`

---

```
ID: C-001
Severity: CRITICAL
Type: idempotency-gap
Where: [Slice 2 §2.6, step 1–2]
Symptom: OCR job gate check rejects retries of crashed-in-progress jobs, leaving documents permanently stuck in `ocr_processing`.
Impact: If the OCR job sets `pipeline_status = 'ocr_processing'` (step 2) then crashes before completing, BullMQ retries the job. The gate check says "If NOT 'pending' → skip." The retry sees 'ocr_processing', skips, and the document is stuck forever. Same bug affects embedding (§2.8 checks "If NOT 'ocr_done' → skip" — a crash after setting 'embedding' is unrecoverable) and extraction (§3.5 checks "If NOT 'embedded' → skip").
Fix: Change gate checks to "If pipeline_status IN ('ocr_done','embedded','extracting','review_ready','done') → skip" (i.e., skip only if the stage has already completed or a later stage is active). A status like 'ocr_processing' should be treated as incomplete and re-entrant. Alternatively, adopt a two-phase pattern: don't set the in-progress status until after the gate check passes, and check for "already completed" rather than "not yet started." This aligns with pipeline_plan.md R8 Stage 1 ("If already `ocr_done` or beyond, return early") which is correct, but the implementation_plan.md contradicts it.
Slice: Slice 2 (OCR + embedding jobs), Slice 3 (extraction job)
Risk-if-deferred: Any worker crash or OOM during OCR/embedding/extraction permanently orphans the document. No self-healing. Requires manual DB intervention.
```

```
ID: C-002
Severity: CRITICAL
Type: state-machine-error
Where: [Slice 1 §1.4 — observations table schema]
Symptom: The `observations.status` enum in the implementation plan's DB schema is defined as `('candidate', 'approved', 'rejected')` — missing `superseded` and `invalidated`.
Impact: The conflict detection flow (Slice 3 §3.5 step 15, Slice 4 §4.5 step 3d) sets loser observations to `status = 'superseded'`. The observation state machine (§3.8) explicitly diagrams `superseded` and `invalidated` states with valid transitions. Without these enum values in the DB, every conflict resolution will throw a Postgres enum violation error, breaking the entire conflict detection pipeline.
Fix: Change the `observations.status` enum to `('candidate', 'approved', 'rejected', 'superseded', 'invalidated')`. This matches the spec §2.5 and the data_model_migration_plan.md (migration 0001) which correctly defines `CREATE TYPE observation_status AS ENUM ('candidate', 'approved', 'rejected', 'superseded', 'invalidated')`. The implementation_plan.md §1.4 schema declaration must be updated to match.
Slice: Slice 1
Risk-if-deferred: Conflict resolution is broken at the DB level. Every auto-resolve and user override silently fails or throws.
```

```
ID: C-003
Severity: CRITICAL
Type: race-condition
Where: [Slice 5 §5.8 — PendingManualObservation lifecycle]
Symptom: The `pending_manual_observations.status` enum in §1.4 is `('pending', 'confirmed', 'skipped')` — missing `timeout`. But §5.8 defines `timeout` as a valid terminal state set by a BullMQ delayed job.
Impact: The BullMQ `pending-obs-timeout` delayed job fires after 10 minutes and attempts to set `status = 'timeout'`, which fails because the value doesn't exist in the enum. The pending observation remains stuck in `pending` state. The agent never receives a terminal state signal and continues polling indefinitely (or until it hits its 120-poll max, wasting 10 minutes of compute). The data_model_migration_plan.md correctly defines `'timed_out'` in the enum, but the implementation_plan.md §1.4 omits it.
Fix: Add `'timeout'` (or `'timed_out'` per the migration plan) to the `pending_manual_observations.status` enum. Reconcile the naming: pick one of `timeout`/`timed_out` and use it consistently across §5.8, the enum, and the agent polling code.
Slice: Slice 1 (schema), Slice 5 (timeout job)
Risk-if-deferred: Manual observation timeout is completely broken. Agent hangs for 10 minutes on every unanswered popup.
```

```
ID: C-004
Severity: HIGH
Type: race-condition
Where: [Slice 4 §4.5 — semantic conflict job, concurrent approval]
Symptom: Two observations approved near-simultaneously each trigger a `semantic-conflict-job`. Both jobs run concurrently, both query candidates, and each detects the other as a conflict partner. Both attempt to insert a ConflictCase for the same pair and set the loser to `superseded`.
Impact: (1) Duplicate ConflictCase rows for the same observation pair. (2) Race on `UPDATE observations SET status = 'superseded'`: both jobs may try to supersede the other, potentially leaving both observations as `superseded` with no winner. §4.15 mentions an idempotency check ("before inserting ConflictCase, check if one already exists for the same pair") but this check is not atomic — a TOCTOU gap exists between the SELECT check and the INSERT.
Fix: Use `INSERT ... ON CONFLICT DO NOTHING` on a unique constraint `(company_id, LEAST(obs_a_id, obs_b_id), GREATEST(obs_a_id, obs_b_id))` to prevent duplicate ConflictCases atomically. For the status update, use `UPDATE observations SET status = 'superseded' WHERE id = $loser AND status = 'approved'` (conditional update) and check the affected row count — if 0, another job already handled this pair.
Slice: Slice 4
Risk-if-deferred: Duplicate conflict records in the inbox; potential for both observations in a pair to be superseded, leaving no approved winner for the normalized_key.
```

```
ID: C-005
Severity: HIGH
Type: timeout-race
Where: [Slice 5 §5.7 — render_pdf MCP tool, §5.11 — PDF worker]
Symptom: The `render_pdf` MCP tool polls `Report.pdf_r2_key` for max 60 seconds (2s interval = 30 polls). The PDF worker has a 30s per-render timeout with 1 retry (2 total attempts). Two attempts at 30s each = 60s total worker time, which exactly matches the MCP tool's polling window. With BullMQ queue latency (job scheduling, dequeue, browser pool wait), the PDF worker will regularly exceed the 60s MCP polling budget. The tool returns `{ error: "render_timeout" }` while the PDF worker is still working — and then the PDF silently becomes available later with no notification to the agent.
Fix: Either (a) increase MCP tool polling timeout to 90s to accommodate BullMQ overhead + two 30s render attempts, or (b) reduce per-render timeout to 20s (total 40s + overhead < 60s), or (c) use a Redis pub/sub notification from the PDF worker on completion instead of DB polling to eliminate latency. Also add the `report_ready` notification event emission from the PDF worker (not just the MCP tool) so the user gets notified even if the agent already timed out.
Slice: Slice 5
Risk-if-deferred: PDF renders frequently "timeout" from the agent's perspective even though they succeed. Users see "render failed" messages for PDFs that actually rendered fine. Agent falls back to HTML-only unnecessarily.
```

```
ID: C-006
Severity: HIGH
Type: race-condition
Where: [Slice 5 §5.8 — PendingManualObservation confirm vs timeout]
Symptom: User clicks "Confirm" at minute 9:59. The `POST .../confirm` handler and the BullMQ `pending-obs-timeout` delayed job both execute nearly simultaneously, both reading `status = 'pending'`. Without a row-level lock, both can succeed: the confirm handler creates the observation and sets `status = 'confirmed'`, then the timeout job overwrites to `status = 'timeout'`. The observation exists but the pending record says `timeout`, causing the agent to treat it as skipped.
Impact: User-confirmed data is silently discarded. The agent marks the section "Non renseigné" even though the user provided a value.
Fix: Both the `confirm`/`skip` route handlers and the timeout job must use `UPDATE pending_manual_observations SET status = $new WHERE id = $id AND status = 'pending' RETURNING *` (atomic CAS). If `RETURNING` yields no rows, the transition was already handled — return 409 (for HTTP handlers) or skip silently (for the timeout job). The 409 guard is mentioned in §5.8 but the implementation must be an atomic conditional update, not a read-then-write pattern.
Slice: Slice 5
Risk-if-deferred: Intermittent data loss on manual observations confirmed near the timeout boundary.
```

```
ID: C-007
Severity: HIGH
Type: idempotency-gap
Where: [Slice 2 §2.6 — OCR job, steps 6–8]
Symptom: The OCR job calls PaddleOCR per page (step 6), then bulk-inserts EvidenceBlock rows (step 8). If the job crashes after PaddleOCR succeeds but before or during the DB insert, the retry will skip the job entirely (per the broken gate check in C-001). Even if C-001 is fixed to allow re-entry on `ocr_processing`, the retry will re-call PaddleOCR for all pages (consuming API quota and time) because there is no check for "which pages already have blocks."
Impact: Wasted PaddleOCR API calls and quota on retry. For a 200-page document, this could mean re-processing the entire document unnecessarily.
Fix: Before calling PaddleOCR, check if EvidenceBlocks already exist for this document version. If the count matches the expected page count, skip OCR and proceed to status transition. For partial completion, only process pages that don't yet have blocks. This makes the OCR stage truly idempotent at the sub-task level, not just the gate level.
Slice: Slice 2
Risk-if-deferred: OCR API quota waste on retries; extended pipeline latency for retried documents.
```

```
ID: C-008
Severity: HIGH
Type: duplicate-risk
Where: [Slice 3 §3.5 — extraction job, step 13]
Symptom: The extraction job bulk-inserts observation candidates (step 13). If the job crashes after inserting observations but before setting `pipeline_status = 'review_ready'`, and if C-001 is fixed to allow re-entry, the retry will re-run Grok extraction and insert a second batch of identical candidate observations for the same document version.
Impact: Duplicate candidate observations in the review queue. User sees the same extracted facts twice. Approving both creates spurious conflicts.
Fix: Before inserting observations, delete any existing `candidate` observations for this `(document_version_id, extraction_run_id)` pair as a cleanup step. Alternatively, wrap the observation insert in a transaction that also sets `pipeline_status = 'review_ready'` atomically — if the status is already `review_ready`, skip the insert. Another option: check observation count for this extraction run before re-inserting.
Slice: Slice 3
Risk-if-deferred: Duplicate observations pollute the review queue on job retries.
```

```
ID: C-009
Severity: HIGH
Type: race-condition
Where: [Slice 5 §5.12 — Report regeneration]
Symptom: The regeneration guard returns `409 if source report already has in-progress regeneration`. But there is no explicit mechanism to track "in-progress" status. The Report entity has `status: 'draft' | 'final'` — neither value means "regenerating." Without an atomic lock, two concurrent `POST /reports/{id}/regenerate` requests can both pass the guard and create two new report versions simultaneously.
Impact: Duplicate report versions with the same `version` number (or sequential numbers from concurrent increments). Two parallel agent loops generating HTML/PDF for the same source report.
Fix: Add a `regeneration_lock` column (nullable UUID, set to a unique job/process ID during regeneration) or use a Redis distributed lock keyed by `report_id`. The guard should be an atomic `UPDATE reports SET regeneration_lock = $lockId WHERE id = $sourceId AND regeneration_lock IS NULL RETURNING *` — if no rows returned, another regeneration is in progress → 409.
Slice: Slice 5
Risk-if-deferred: Duplicate report versions; wasted Grok API calls for parallel generation.
```

```
ID: C-010
Severity: HIGH
Type: cache-inconsistency
Where: [Slice 5 §5.7, Spec §10.4 — DerivationResult cache]
Symptom: The `derivation_results` table in §1.4 has no `stale` boolean column. The spec §2.6 defines `stale: boolean` and §10.4 describes lazy invalidation ("when an Observation changes status, all DerivationResults referencing it are marked stale = true"). The implementation plan's schema omits this field entirely. The `compute_derivation` MCP tool (§5.7) returns `{ stale: boolean }` in its output, but there's no column to read it from.
Impact: Derivation cache invalidation cannot work. Stale derivations (computed from now-superseded observations) are served as fresh. Reports generated from stale derivations contain incorrect computed values.
Fix: Add `stale BOOLEAN NOT NULL DEFAULT false` to the `derivation_results` table schema. Implement stale-marking: when `PATCH /api/observations/{id}/status` changes an observation's status, run `UPDATE derivation_results SET stale = true WHERE $obsId = ANY(input_observation_ids)` in the same transaction. The `compute_derivation` tool should check `stale` on cache hit and recompute if true.
Slice: Slice 1 (schema), Slice 4 (stale-marking on conflict resolution), Slice 5 (tool reads stale flag)
Risk-if-deferred: Reports contain silently outdated derivation values after conflict resolutions or observation status changes.
```

```
ID: C-011
Severity: HIGH
Type: race-condition
Where: [Slice 4 §4.6 — KeyEquivalenceCache concurrent insert]
Symptom: Two concurrent `semantic-conflict-job`s for the same key pair both check the cache, both miss, both call the Grok equivalence classifier, and both attempt to INSERT into `key_equivalence_cache` with the same `(company_id, key_a, key_b)`. The unique constraint causes one INSERT to fail with a constraint violation error, which propagates as an unhandled exception and fails the entire job.
Impact: One of the two semantic conflict jobs fails on a constraint violation even though the result is valid. The conflict for the affected pair is never recorded.
Fix: Use `INSERT ... ON CONFLICT (company_id, key_a, key_b) DO NOTHING` (or `DO UPDATE SET checked_at = now()` to refresh the entry). After the insert-or-skip, SELECT the cached result to determine equivalence regardless of which job won the insert race.
Slice: Slice 4
Risk-if-deferred: Intermittent semantic-conflict-job failures when two observations with similar keys are approved in quick succession.
```

```
ID: C-012
Severity: HIGH
Type: ordering-violation
Where: [Slice 5 §5.4 — Chat SSE replay buffer]
Symptom: The in-memory replay buffer is per-process. If Next.js is horizontally scaled to 2+ instances, the `POST /messages` handler may run on Instance A (triggering the agent loop there), but the client's `EventSource` connects to Instance B. Instance B has no replay buffer for this session and streams nothing. The `Last-Event-ID` resume finds no buffered events. The client receives a silent empty stream.
Impact: Complete loss of agent response streaming for chat sessions when the app is horizontally scaled. The user sees an empty chat with no response.
Fix: Replace the per-process in-memory buffer with a Redis-backed replay buffer (e.g., Redis Stream or Redis List with TTL). The agent loop publishes events to `chat:session:{id}` in Redis; the SSE handler subscribes. This mirrors the pattern already used for pipeline SSE (Redis pub/sub). Alternatively, ensure sticky sessions at the load balancer level so `POST /messages` and `GET /stream` always hit the same instance — but this degrades horizontal scalability.
Slice: Slice 5
Risk-if-deferred: Chat is broken under horizontal scaling. Works only in single-instance dev mode.
```

```
ID: C-013
Severity: MEDIUM
Type: race-condition
Where: [Slice 3 §3.5 step 14–15 — exact-match conflict on new candidates]
Symptom: The extraction job detects exact-match conflicts against existing `approved` observations and sets the loser to `superseded`. But the new observations are still `candidate` status — they haven't been approved yet. Setting an existing approved observation to `superseded` based on a candidate that hasn't been user-reviewed violates the invariant that candidates cannot affect approved observation states.
Impact: An approved observation is silently superseded by an unapproved candidate. The observation disappears from derivations and reports before the user has reviewed the candidate.
Fix: During extraction, exact-match conflicts should only create ConflictCase records alerting the user — they should NOT auto-resolve by superseding existing approved observations. Auto-resolution (latest-wins) should only trigger when the conflicting observation itself is approved (which is what the spec §11.1 says: "A conflict exists when two or more **approved** observations share…"). Move the auto-resolve step to the approval action (Slice 3 §3.4 — `PATCH /api/observations/{id}/status` transitions to `approved`), not to the extraction job.
Slice: Slice 3
Risk-if-deferred: Pipeline extraction can silently demote existing approved observations, breaking in-use derivations and reports.
```

```
ID: C-014
Severity: MEDIUM
Type: cache-inconsistency
Where: [Slice 4 §4.6 — KeyEquivalenceCache expiry]
Symptom: The KeyEquivalenceCache has no `expires_at` column in the implementation plan's schema (§1.4), no TTL, and no cleanup mechanism. The context notes this as unspecified. §4.6 says "Cache entries are permanent." If a user renames an observation's `normalized_key`, old cache entries for the old key pair remain. New conflict detection with the renamed key creates a new cache entry, but the old entry is never invalidated. A future observation with the old key name could match against the stale cache entry.
Impact: Low probability but possible: stale equivalence results cause incorrect conflict grouping (false negatives or false positives on semantic equivalence) after key renames.
Fix: Add `expires_at TIMESTAMPTZ` and `checked_at TIMESTAMPTZ` columns to `key_equivalence_cache`. Set `expires_at = checked_at + INTERVAL '30 days'`. Before using a cached result, check `expires_at > now()`. Add a periodic BullMQ cron job (daily) to `DELETE FROM key_equivalence_cache WHERE expires_at < now()`. This matches the data_model_migration_plan.md §1.13 recommendation.
Slice: Slice 1 (schema), Slice 4 (cache lookup + cleanup job)
Risk-if-deferred: Increasingly stale equivalence cache over time; incorrect conflict detection after key renames.
```

```
ID: C-015
Severity: MEDIUM
Type: idempotency-gap
Where: [Slice 2 §2.8 — embedding job partial batch failure]
Symptom: The embedding job processes blocks in batches of 512. On retry (after C-001 fix), the job re-queries `WHERE embedding IS NULL` (step 4), which correctly skips already-embedded blocks. However, the embedding API call for a batch that partially succeeded before a crash may re-embed blocks that already have embeddings in the OpenAI response but whose DB update was never committed. This wastes OpenAI API tokens but is functionally correct because vectors are deterministic for the same input text.
Impact: Minor: wasted embedding API tokens on partial-batch retries. No data corruption because re-embedding the same text yields the same vector. But the cost scales with document size.
Fix: Accept as a known cost inefficiency for MVP. Document that embedding retries may re-embed already-completed blocks within a failed batch. For post-MVP: track per-batch completion status in a `pipeline_run_metadata` JSONB field to enable fine-grained batch resumption.
Slice: Slice 2
Risk-if-deferred: Minor cost inefficiency on embedding retries. No functional impact.
```

```
ID: C-016
Severity: MEDIUM
Type: ordering-violation
Where: [Slice 2 §2.10 — Pipeline SSE replay buffer]
Symptom: The pipeline SSE replay buffer (§2.10) is described as "lives in the publishing process — only useful for single-instance dev; production relies on Redis pub/sub." But Redis pub/sub is fire-and-forget: if no subscriber is connected when an event is published, the event is permanently lost. If a client disconnects and reconnects, the `Last-Event-ID` replay can only serve events from the in-memory buffer on the specific instance the client reconnects to. Under horizontal scaling, reconnection to a different instance loses all buffered events.
Impact: Pipeline status events missed during client reconnection under horizontal scaling. The Documents page shows stale status badges until the user manually refreshes.
Fix: Use Redis Streams instead of Redis pub/sub for pipeline events. Redis Streams persist messages and support consumer groups with `XREAD` from a specific ID, providing durable replay across instances. Alternatively, accept this limitation for MVP and add a `GET /api/documents/{id}/status` polling fallback that the client uses when the SSE stream reconnects and `Last-Event-ID` replay returns no events.
Slice: Slice 2
Risk-if-deferred: Pipeline status badges become stale after network drops in multi-instance deployments. Functional but poor UX.
```

```
ID: C-017
Severity: MEDIUM
Type: timeout-race
Where: [Slice 5 §5.5, §5.8 — agent loop suspend for manual observation]
Symptom: The agent loop suspends and polls `GET /pending/{id}` every 5 seconds for max 10 minutes. The BullMQ delayed job fires after exactly 10 minutes. The agent's 120th poll (at t=10:00) and the timeout job can race. If the agent polls at t=9:59, gets `status: pending`, then the timeout fires at t=10:00, the agent's next poll at t=10:04 sees `timeout`. But the agent has already wasted 5 seconds waiting. More critically: if the agent uses a wall-clock 10-minute cutoff rather than poll counting, and the timeout job has network latency, the agent might exit its polling loop before the timeout job runs, leaving the pending observation in `pending` state with no consumer.
Impact: Edge case: pending observation stuck in `pending` if both the agent and the timeout job fail to transition it (agent exits loop, timeout job delayed by queue backlog).
Fix: The agent should treat its own 10-minute wall-clock expiry as authoritative: if 10 minutes pass without a terminal state, the agent should call `POST .../skip` itself before exiting the polling loop, rather than relying solely on the BullMQ delayed job. This creates a belt-and-suspenders approach. The skip endpoint's 409 guard handles the case where the timeout job already fired.
Slice: Slice 5
Risk-if-deferred: Rare: pending observation stuck in `pending` with no resolution path if BullMQ delayed job execution is delayed.
```

```
ID: C-018
Severity: MEDIUM
Type: race-condition
Where: [Slice 3 §3.15 — concurrent observation approval]
Symptom: Concurrent `PATCH /api/observations/{id}/status` requests for the same observation. §3.15 says "Use a DB transaction with `SELECT FOR UPDATE` on the observation row" to prevent double-approval. However, `SELECT FOR UPDATE` is mentioned only in the edge cases section, not in the handler specification (§3.4). It's easy to miss during implementation.
Impact: Without `SELECT FOR UPDATE`, two concurrent approve requests for the same candidate could both succeed, creating two AttestationRecords and enqueueing two `semantic-conflict-job`s for the same observation.
Fix: Explicitly mandate `SELECT FOR UPDATE` in the `PATCH /api/observations/{id}/status` route handler specification (§3.4), not just in the edge cases table. The handler should: (1) BEGIN transaction, (2) SELECT observation FOR UPDATE, (3) validate transition, (4) UPDATE status, (5) INSERT attestation, (6) COMMIT. The second concurrent request blocks on row lock and then sees the updated status, returning 422 for the now-invalid transition.
Slice: Slice 3
Risk-if-deferred: Duplicate attestation records and redundant semantic-conflict-jobs on concurrent approval clicks (e.g., user double-clicks "Approve").
```

```
ID: C-019
Severity: MEDIUM
Type: state-machine-error
Where: [Slice 3 §3.8, Spec §2.5 — observation state machine]
Symptom: The spec §2.5 defines `approved → invalidated` as a valid transition triggered by "DocumentVersion re-processed; old EvidenceBlocks replaced." The implementation plan's state machine (§3.8) diagrams this transition but the `isValidTransition` table in §3.4 does not include it. There is no handler for pipeline re-processing triggering invalidation of existing observations.
Impact: If a document is re-uploaded and re-processed, old observations from the previous version remain `approved` and coexist with new candidates. There is no mechanism to invalidate them, violating the spec's data integrity guarantee.
Fix: Add `approved → invalidated` to the `isValidTransition` function with trigger = `system` (pipeline re-processing). When a new DocumentVersion is created for an existing document, the pipeline should invalidate all observations linked to the previous version's `source_document_version_id` by setting `status = 'invalidated'`. Add this step to the `POST /api/uploads/complete` handler or the OCR job.
Slice: Slice 2 (upload flow), Slice 3 (state machine)
Risk-if-deferred: Stale observations from old document versions persist as approved, creating phantom data in reports and derivations.
```

```
ID: C-020
Severity: MEDIUM
Type: duplicate-risk
Where: [Slice 2 §2.6 — OCR job, §2.4 — POST /api/uploads/complete]
Symptom: `POST /api/uploads/complete` creates a DocumentVersion and enqueues `ocr-job` with `jobId = documentVersionId`. BullMQ deduplicates by `jobId` within a configurable window. However, if the same `POST /api/uploads/complete` is called twice (e.g., client retry on network timeout after a successful server response), the handler creates a second DocumentVersion row (different UUID) and enqueues a second OCR job with a different `jobId`. The `409` guard checks for duplicate `objectKey` but two calls with the same `objectKey` would hit different code paths depending on whether the first call's transaction committed.
Impact: Duplicate DocumentVersion rows and duplicate OCR processing for the same uploaded file.
Fix: Make `POST /api/uploads/complete` idempotent by adding a unique constraint on `(document_id, r2_key)` or checking for an existing DocumentVersion with the same `r2_key` before inserting. Return the existing record if found (idempotent 201).
Slice: Slice 2
Risk-if-deferred: Duplicate documents and wasted pipeline processing on client-side retries.
```

```
ID: C-021
Severity: MEDIUM
Type: cache-inconsistency
Where: [Slice 5 §5.7 — compute_derivation cache]
Symptom: The derivation cache key is defined inconsistently. Spec §10.4 says `SHA256(sorted(observation_ids) | operation)` without company_id. Implementation plan §5.7 says `SHA256(sorted observation_ids[] + operation + companyId)`. The DB unique constraint (§1.4) is `(company_id, input_hash)`. If `company_id` is included in the hash, the unique constraint on `(company_id, input_hash)` adds redundant scoping. If company_id is NOT in the hash, two companies with observations sharing the same UUIDs (impossible with UUIDv7 but theoretically possible) could collide. More practically: if the hash formula changes between implementations, cache hits fail silently and derivations are always recomputed.
Impact: Ambiguity about the cache key formula could lead to implementation bugs causing either unnecessary recomputation (performance) or cross-tenant cache collisions (security, extremely unlikely with UUIDv7).
Fix: Canonicalize: use `SHA256(sorted(observation_ids) + '|' + operation)` without company_id (since UUIDv7 is globally unique, and the DB unique constraint already scopes by company_id). Document this as the single source of truth in `src/lib/constants.ts` or the `compute_derivation` tool implementation.
Slice: Slice 5
Risk-if-deferred: Low risk: cache miss waste or theoretical cross-tenant collision (practically impossible with UUIDv7).
```

```
ID: C-022
Severity: MEDIUM
Type: race-condition
Where: [Slice 4 §4.5 — conflict resolution stale-marking atomicity]
Symptom: `POST /api/conflicts/{id}/resolve` (§4.4) updates observation statuses, inserts ConflictResolution, and marks DerivationResults as stale — all "in one DB transaction" per §4.4. But §4.15 says "Redis publish does NOT happen (publish call is outside the transaction — add it only on commit success)." If the transaction commits but the Redis publish fails (Redis down), the conflict is resolved in the DB but no SSE notification is sent. The user sees no notification; the conflicts badge doesn't update.
Impact: Silent conflict resolution — users don't know a conflict was resolved. Notification bell and conflicts badge show stale counts.
Fix: This is actually the correct pattern (publish after commit). The issue is: what if Redis is temporarily down? Add a retry (1 attempt, 2s backoff) for the Redis publish. If still failing, the DB state is authoritative — the notification row is already inserted (step 6 of §4.4 is inside the transaction), so the next `GET /api/notifications` call will show it. Document that SSE notification delivery is best-effort; the DB notification row is the durable record.
Slice: Slice 4
Risk-if-deferred: Missed real-time SSE notifications when Redis is briefly unavailable. Functional but degraded UX.
```

```
ID: C-023
Severity: MEDIUM
Type: ordering-violation
Where: [Slice 5 §5.4 — Chat SSE event replay on reconnect]
Symptom: The replay buffer uses monotonic `id` fields and `Last-Event-ID` support. But if the buffer has been evicted (200 events reached) during a long agent turn, early events (e.g., the first tool_call events) are gone. The client reconnects with `Last-Event-ID: 5` but events 1–5 were evicted. The buffer replays from event 6 onward, but events 1–5 are permanently lost. The client shows a partially broken chat — missing tool call cards, potentially missing the `manual_obs_request` event.
Impact: On long agent turns (many tool calls + tokens > 200 events), early events are lost on reconnect. If `manual_obs_request` is among the evicted events, the user never sees the popup and the agent waits 10 minutes for a response that never comes.
Fix: Increase the buffer size to 1000 events (a single agent turn rarely exceeds this). Additionally, critical events like `manual_obs_request` should be persisted to the `ChatMessage` table immediately (not just on `done`), so the `GET /sessions/{id}/messages` fallback endpoint can reconstruct the popup trigger even if the SSE buffer is lost.
Slice: Slice 5
Risk-if-deferred: Lost manual observation popups on reconnect during long agent turns; user has no way to see the popup.
```

```
ID: C-024
Severity: MEDIUM
Type: timeout-race
Where: [Slice 3 §3.5, Pipeline plan R11 — Grok extraction retry timeout]
Symptom: Pipeline plan R11 identifies this: "If Grok API takes >30s, BullMQ may retry while first attempt still running." The extraction job has a 120s Grok timeout, 1 retry on schema-invalid output, and a 260s total job timeout. But BullMQ's retry mechanism triggers on job failure, not on timeout. If the Grok call takes 119s (just under timeout) and returns invalid schema, the retry call takes another 119s = 238s. The 260s job timeout fires at 260s, killing the job while the second Grok call is at 238s — only 22s into the second call. The second call never completes.
Impact: Extraction retries for slow Grok responses are killed by the job timeout before the retry call can finish. Extraction fails even though the data is valid.
Fix: Set the job timeout to `2 × Grok_timeout + buffer` = `2 × 120s + 30s` = 270s (not 260s). Or better: track elapsed time within the job handler and skip the retry if remaining time is < 120s, proceeding directly to failure. This prevents starting a Grok call that can't finish.
Slice: Slice 3
Risk-if-deferred: Extraction fails on documents where Grok is slow on the first call, even if the second call would succeed.
```

```
ID: C-025
Severity: LOW
Type: idempotency-gap
Where: [Slice 2 §2.6 — OCR job, R2 page PNG upload]
Symptom: OCR job step 6d uploads page PNGs to R2 concurrently. Step 8 bulk-inserts EvidenceBlocks. These are not in a single atomic operation. If the job crashes between R2 uploads and DB insert, page PNGs exist in R2 but EvidenceBlocks don't exist in the DB. On retry (if C-001 is fixed), the job re-uploads PNGs (R2 PUT is idempotent — overwrites are fine) and re-inserts blocks. No data corruption, but orphaned R2 objects may accumulate if the document is later deleted without cleaning R2.
Impact: Orphaned R2 objects (page PNGs without corresponding DB records). Minor storage cost.
Fix: Accept for MVP. Add a periodic R2 cleanup job post-MVP that identifies orphaned objects by cross-referencing R2 keys with DB records.
Slice: Slice 2
Risk-if-deferred: Minor storage leak. No functional impact.
```

```
ID: C-026
Severity: LOW
Type: race-condition
Where: [Slice 5 §5.4 — Chat SSE buffer TTL after done]
Symptom: The buffer TTL is 60 seconds after the `done` event. If the client disconnects for exactly 61 seconds (e.g., laptop sleep), the buffer is cleared. The client reconnects and finds no buffered events. It falls back to `GET /sessions/{id}/messages`, which returns the stored ChatMessage rows. But ChatMessage rows are written only on `done` (the full accumulated agent text is stored as one row). Intermediate `tool_call` events are stored as separate ChatMessage rows only if the agent loop writes them — the plan says "each emit call writes to the in-memory session buffer AND sends to any currently-connected SSE clients" but doesn't say it writes to the DB immediately.
Impact: On reconnect after >60s, tool_call cards and manual_obs_request events may be missing from the reconstructed chat history if they weren't persisted to ChatMessage rows during the agent turn.
Fix: Write critical SSE events (`tool_call`, `manual_obs_request`, `error`) to the ChatMessage table immediately when they occur, not just at `done`. The `agent_text` type can still be accumulated and written once at `done`. This ensures the `GET /messages` fallback always has the complete interaction history.
Slice: Slice 5
Risk-if-deferred: Incomplete chat history reconstruction after laptop-sleep disconnects. Missing tool call history.
```

```
ID: C-027
Severity: LOW
Type: cache-inconsistency
Where: [Slice 5 §5.7 — compute_derivation recomputation on stale]
Symptom: When `compute_derivation` finds a cached result with `stale = true`, it should recompute. But the plan doesn't specify whether the stale result is deleted and replaced, or updated in-place. If a new result is inserted with the same fingerprint hash, the unique constraint `(company_id, input_hash)` will conflict. If the existing row is updated, the `result_id` stays the same but `computed_at` changes — this may break reports that reference the old `derivation_result_id`.
Impact: Reports referencing a `derivation_result_id` may get updated values unexpectedly if the row is updated in-place, or the insert may fail if a new row is attempted.
Fix: Update in-place: `UPDATE derivation_results SET result_value = $new, stale = false, computed_at = now() WHERE company_id = $cid AND input_hash = $hash`. The `result_id` stays the same, which is correct — reports reference the derivation result, and the result should reflect the latest computation. Document this as intentional: derivation_result_ids are stable references that always reflect current approved observation values.
Slice: Slice 5
Risk-if-deferred: Ambiguity in implementation could cause unique constraint violations or unexpected value changes in referenced reports.
```

```
ID: C-028
Severity: LOW
Type: state-machine-error
Where: [Slice 3 §3.4 — observation state machine transitions]
Symptom: The `isValidTransition` table allows `rejected → candidate` (reconsider) but does not create an AttestationRecord for this transition. Every other transition creates an attestation record. The reconsider action has no audit trail — there is no record of who reconsidered the rejection or when.
Impact: Audit gap: no record of reconsideration decisions. Minor for MVP but problematic for compliance.
Fix: Create an AttestationRecord with `action = 'reconsidered'` on the `rejected → candidate` transition. Add 'reconsidered' to the AttestationRecord action enum.
Slice: Slice 3
Risk-if-deferred: Missing audit trail for reconsideration actions.
```

```
ID: C-029
Severity: LOW
Type: ordering-violation  
Where: [Slice 2 §2.10 — Pipeline SSE event ID monotonicity]
Symptom: Pipeline SSE events use a monotonic `id` for Last-Event-ID tracking. But the IDs are generated in-memory per-process. Under horizontal scaling, two instances generate independent monotonic sequences. A client connected to Instance A sees IDs 1, 2, 3. On reconnect to Instance B, it sends `Last-Event-ID: 3`, but Instance B's buffer has its own sequence (possibly also IDs 1, 2, 3 but for different events). The replay replays Instance B's events 4+, skipping Instance B's events 1–3 and missing them entirely.
Impact: Under horizontal scaling, `Last-Event-ID` replay delivers wrong events on cross-instance reconnection.
Fix: Use a globally unique, time-ordered event ID (e.g., UUIDv7 or a Redis INCR counter) instead of per-process monotonic counters. If using Redis Streams (per recommendation in C-016), the stream entry ID serves this purpose automatically.
Slice: Slice 2
Risk-if-deferred: Pipeline SSE replay is unreliable under horizontal scaling. Combined with C-016, this means pipeline SSE reconnection is effectively broken in production.
```

```
ID: C-030
Severity: LOW
Type: duplicate-risk
Where: [Slice 4 §4.5 — semantic-conflict-job, observation key edit trigger]
Symptom: §3.4 says "normalizedKey changes on an approved observation trigger a re-check for exact-match conflicts (enqueue semantic-conflict-job with reason: 'key_changed')." This enqueues a new semantic-conflict-job for the same observation that was already processed on approval. If the key didn't actually change semantically (e.g., `ghg_scope1` → `ghg_scope_1`), the job may find the same conflicts again and create duplicate ConflictCase rows (unless the idempotency check from C-004 fix is in place).
Impact: Redundant Grok API calls and potential duplicate ConflictCase rows on key edits.
Fix: The semantic-conflict-job should check for existing ConflictCases involving this observation before inserting new ones (deduplicate against existing records). Additionally, the key-edit trigger should compare old and new keys — skip the job if `old_key === new_key` or if `similarity(old_key, new_key) > 0.9` (the rename is just a formatting change, not a semantic change).
Slice: Slice 3 (edit trigger), Slice 4 (job handler)
Risk-if-deferred: Wasted Grok calls and duplicate conflict records on trivial key renames.
```

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 3 | C-001, C-002, C-003 |
| HIGH | 8 | C-004, C-005, C-006, C-007, C-008, C-009, C-010, C-011, C-012 |
| MEDIUM | 10 | C-013, C-014, C-015, C-016, C-017, C-018, C-019, C-020, C-021, C-022, C-023, C-024 |
| LOW | 6 | C-025, C-026, C-027, C-028, C-029, C-030 |
| **Total** | **30** | |

### Top 5 Must-Fix Before Implementation

1. **C-001** (CRITICAL): Gate check logic inverted — fix before any pipeline job code is written
2. **C-002** (CRITICAL): Missing enum values — fix in Slice 1 schema before any conflict code
3. **C-003** (CRITICAL): Missing timeout enum — fix in Slice 1 schema before manual obs flow
4. **C-012** (HIGH): Chat SSE in-memory buffer breaks horizontal scaling — architectural decision needed before Slice 5
5. **C-010** (HIGH): Missing `stale` column — fix in Slice 1 schema before derivation cache code
