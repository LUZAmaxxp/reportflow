# API + Contracts Audit — ReportFlow
**Auditor:** Agent A — API & Contracts  
**Date:** 2026-02-21  
**Spec version reviewed:** §1–§17 (project_spec.md) + archive/fe_audit.md

---

## 1. Risks / Gaps

The items below are genuine contract-level risks that are not fully resolved by the current spec. Each one would block a correct, safe implementation of its feature area.

---

### RISK-01 — `POST /api/uploads/complete`: page count source undefined

**Where:** §5.1 upload flow, §16 table  
**Severity:** High

The endpoint description says "validate page count (max 200)" but the Zod schema documented for `/complete` is `{ objectKey, filename }`. The page count is not in the request body. For the server to validate it, one of the following must be true: (a) the client sends it in the body, (b) the server reads it from the R2 object after the PUT (adds latency and requires a read permission), or (c) PaddleOCR reports it later in the pipeline but the upload has already been accepted. None of these paths is specified.

**Required fix:** Add `page_count: z.number().int().min(1).max(200)` to the `/complete` Zod schema. Client reads page count from the PDF/image before upload and includes it. Server re-validates against the stored object as a background check if needed.

---

### RISK-02 — `GET /api/pipeline/events?company_id={id}`: query-param `company_id` is a privilege-escalation vector

**Where:** §16 table, §16.1  
**Severity:** High

Every other endpoint derives `company_id` exclusively from the Auth.js JWT session. This SSE endpoint takes it from a query parameter. A user who knows another tenant's `company_id` (a fixed UUID — not secret) can subscribe to that tenant's real-time pipeline events. The spec says "All routes validate `auth()`" but does not explicitly state that the query-param value is validated against the session's `company_id`.

**Required fix:** Add an explicit statement: "The server validates that the `company_id` query parameter equals the `company_id` extracted from the Auth.js session. A mismatch returns `403 Forbidden`." Alternatively, remove the query param entirely and derive it always from the session.

---

### RISK-03 — Chat SSE race condition: tokens emitted before `EventSource` is open are permanently lost

**Where:** §16.2, §5.4.2 (fe_audit.md acknowledges the issue, specifies it as "remaining concern")  
**Severity:** High

`POST /api/chat/sessions/{id}/messages` immediately triggers the agent. The client must open the SSE stream (`GET /api/chat/sessions/{id}/stream`) *before or simultaneously*. If the agent produces tokens between the HTTP response to `/messages` and the `EventSource` connection being established (even a few hundred milliseconds), those tokens — and potentially critical events like `manual_obs_request` or `report_ready` — are lost with no recovery path. The spec provides no replay buffer, no `Last-Event-ID` header support, and no message catch-up mechanism.

**Required fix:** Either (a) specify that the SSE stream buffers all events for the session and supports the `Last-Event-ID` HTTP header for resumption, or (b) add a `status` field to `GET /api/chat/sessions/{id}/messages` response so clients can detect if the stream was missed and poll for the completed message content.

---

### RISK-04 — `GET /api/manual-observations/pending/{pending_id}`: response shape undefined

**Where:** §15.4, §16 table  
**Severity:** High

The agent polls this endpoint every 5 seconds for up to 10 minutes. The spec defines the endpoint's existence but provides zero contract for the response body — no status enum, no field list. The agent has no schema to deserialize, and its termination condition (`status = confirmed | skipped`) is guessed from §15.4 prose rather than formally specified.

**Required fix:** Define the response schema:
```typescript
{
  pending_id: UUID,
  status: "pending" | "confirmed" | "skipped" | "timeout",
  observation_id?: UUID,   // set when status = "confirmed"
  created_at: string,
  expires_at: string       // pending_id is valid for 10 minutes
}
```
Also specify the HTTP status when the `pending_id` does not exist or has expired (recommend `404` with code `pending_not_found`).

---

### RISK-05 — `PATCH /api/categories/reorder`: no `parent_category_id` in body creates silent tree corruption risk

**Where:** §16 table, §2.4  
**Severity:** Medium

The request body is `{ ordered_ids: UUID[] }`. The spec says this is "scoped to siblings under the same `parent_category_id`," but the `parent_category_id` is not in the request. To validate that all `ordered_ids` are genuine siblings, the server must look up each one in the DB before executing — an expensive check that is never specified. If the client accidentally (or maliciously) mixes IDs from different parents, the server may silently apply a partial update or set inconsistent `sort_order` values across sibling groups.

**Required fix:** Add `parent_category_id: z.string().uuid().nullable()` to the Zod schema (nullable for root-level siblings). Server validates all `ordered_ids` share that parent before updating. Return `422` with `{ code: "mixed_parents" }` on violation.

---

### RISK-06 — `DELETE /api/preferences`: scope ambiguity between spec sections

**Where:** §8.6, §16 table  
**Severity:** Medium

§8.6 (Memory Architecture) documents the deletion API as `DELETE /preferences?scope={scope}`, implying a required `scope` query parameter. §16 documents the endpoint as `DELETE /api/preferences` with no query parameter. It is unclear whether this deletes *all* preferences for the user or *a specific scoped context*. Since mem0 scopes preferences per `user+company` or `user+company+client`, deleting all scopes at once may be unintended.

**Required fix:** Reconcile. Recommended: add `?scope={scope}` as an optional query param (when omitted, delete all scopes for the authenticated user). Document the enum of valid scope formats or accept a free string matching the mem0 key pattern.

---

### RISK-07 — `POST /api/reports/{id}/regenerate`: PDF readiness race with no notification path outside chat

**Where:** §16 (regenerate contract), §12.1 (performance SLAs)  
**Severity:** Medium

The regenerate response includes `pdf_url: string | null` — `null` when PDF rendering is still in progress. PDF can take up to 60 seconds (§12.1 p95). There is no follow-up polling endpoint, no webhook, and no SSE event for PDF readiness outside of the chat session stream. If a user triggers regeneration directly from the `/reports/[id]` page (not via chat), they have no way to know when the PDF becomes available.

**Required fix:** Either (a) expose `GET /api/reports/{id}` as the polling target (it already includes `pdf_url`) and document that polling until `pdf_url != null` is the expected pattern, or (b) emit a `notification` pipeline SSE event with `type: report_ready` when PDF rendering completes, reusing the existing pipeline SSE channel. Document which path is canonical.

---

### RISK-08 — MCP tool signatures include explicit `company_id` input, contradicting the "derive from session" rule

**Where:** §15 preamble, §15.1–§15.10 Input schemas  
**Severity:** Medium

The §15 preamble states: *"All tools derive `company_id` from the authenticated session (not passed by the agent)."* Yet the Input schemas for `search_observations`, `search_evidence`, `compute_derivation`, `propose_manual_observation`, `create_report`, `merge_observations`, `get_report_data`, and `get_categories` all list `company_id` as an explicit input field. If the tool runtime trusts the caller-supplied `company_id` without comparing it to the session, any agent prompt injection that substitutes a different `company_id` would bypass tenant isolation.

**Required fix:** Remove `company_id` from all tool Input schemas and add a note to each: "Derived from `session.company_id`; not accepted as agent input." The `compute_derivation` §10.3 contract block independently includes `company_id` and must be updated as well.

---

### RISK-09 — `GET /api/chat/sessions/{id}/messages`: per-type `content` schema undefined, blocking chat history replay

**Where:** §7 (ChatMessage schema), §16 table  
**Severity:** Medium

§7 defines `ChatMessage.content` as "JSON; shape varies by `type`." The REST response for the message list endpoint is documented as `ChatMessage[]` with `content: object`. Without per-type content schemas, the frontend cannot reconstruct the chat history UI (tool-call cards, manual obs cards, report-ready cards) from stored messages. This is distinct from the SSE stream — history replay uses the REST endpoint.

**Required fix:** Define `content` shapes per `type` in §16 (or a sub-section of §7):
```typescript
// user_text | agent_text
{ text: string }

// agent_tool_call
{ tool_name: string, summary: string, details?: object }

// manual_obs_request
{ pending_id: UUID, prefilled: { label, normalized_key, value, unit, period_start, period_end } }

// report_ready
{ report_id: UUID, title: string, html_snapshot_url: string, pdf_url: string | null }

// error
{ message: string, retryable: boolean }
```

---

### RISK-10 — `POST /api/users`: invitation lifecycle undefined

**Where:** §16 table  
**Severity:** Medium

The spec documents `POST /api/users` (admin) as "invite; `{ email, role }`" but provides no response contract and no description of the user creation lifecycle. Questions unresolved: Does the user record become immediately active? Is an invite token generated and emailed? What happens if the email already belongs to an existing user in the same or another company? A `status: "pending"` field may be needed on the User entity.

**Required fix:** Add a response contract and lifecycle note. Minimum: specify whether the endpoint creates an active user immediately or creates a pending invitation (and what email flow is required). If invitation emails are out of scope for MVP, document that the user is created active with a temporary password or via OAuth.

---

### RISK-11 — `POST /api/observations/merge`: Zod schema and response contract undefined

**Where:** §16 table  
**Severity:** Medium

The MCP tool `merge_observations` (§15.8) has a full contract. The REST endpoint `POST /api/observations/merge` maps to the same action but its request body and response are not documented in §16. Only a one-line description ("merge to canonical key/label") exists.

**Required fix:** Add a Zod schema mirroring the MCP tool contract:
```typescript
z.object({
  observation_ids: z.array(z.string().uuid()).min(2),
  canonical_label: z.string().min(1).max(200),
  canonical_normalized_key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100),
})
// Response: { updated_count: number, canonical_normalized_key: string }
```

---

### RISK-12 — `PATCH /api/observations/{id}/status`: invalid state-machine transition error contract missing

**Where:** §2.5 lifecycle table, §16  
**Severity:** Low-Medium

The spec documents valid transitions and the actors allowed to make them. But no HTTP status code or error body is defined for invalid transitions (e.g., `approved → candidate`, `invalidated → approved`, `viewer` role triggering an editor-only transition). Without a defined error contract, each implementation will invent its own, breaking promise-style error handling in the frontend.

**Required fix:** Specify: invalid state transitions return `422 Unprocessable Entity` with body `{ code: "invalid_transition", from: string, to: string }`. Role violations return `403 Forbidden` (existing convention).

---

### RISK-13 — `GET /api/documents/{id}/pages/{page_number}`: page image availability timing unspecified

**Where:** §5.1 (pipeline stages), §16, §17.3 (R2 key scheme)  
**Severity:** Low-Medium

Page images are stored in R2 with key `{company_id}/{document_id}/pages/{page_number}.png` (§17.3). The spec does not state when these images are created — implicitly during the OCR stage, but this is never confirmed. If a client requests a page image while the document is still in `uploaded` or `ocr_processing` status, the behavior is undefined (404? 202 Accepted? an error code?).

**Required fix:** Add a paragraph: "Page images are generated and stored in R2 during the OCR stage (transition to `ocr_done`). Requests to `GET /api/documents/{id}/pages/{page_number}` on a document that has not yet reached `ocr_done` return `404` with `{ code: 'page_not_ready', pipeline_status: string }`."

---

### RISK-14 — `GET /api/conflicts` filter by `normalized_key` misses semantic-group conflicts

**Where:** §11.6, §16 (`GET /api/conflicts` params)  
**Severity:** Low-Medium

ConflictCases involved in semantic near-duplicate detection share a `conflict_group_id` but may have *different* `normalized_key` values (that is precisely what semantic detection is for — keys with different names that mean the same thing). Filtering by `normalized_key` will return only exact-key conflicts, silently omitting semantic matches in the same group. A user browsing conflicts for `ghg_scope1` will miss a conflict with `ghg_emissions_scope_1` even though both are grouped.

**Required fix:** Document that `?normalized_key=X` filter includes all ConflictCases in any group where at least one case has `normalized_key = X`. Alternatively, add a `?conflict_group_id=UUID` filter param as a precise lookup.

---

### RISK-15 — `html_snapshot_url` in `GET /api/reports` list response expires in 1 hour, no refresh mechanism specified

**Where:** §16 (`GET /api/reports`) table note, §17.3  
**Severity:** Low

The report list response includes `html_snapshot_url` (a presigned R2 URL, 1-hour expiry). If the frontend caches or stores this URL (e.g., in React state or local storage), it will expire without the user realizing. The spec does not specify whether clients should re-fetch the report or the URL, or whether these presigned URLs should be excluded from the list response and only returned by `GET /api/reports/{id}`.

**Required fix:** Exclude `html_snapshot_url` from the `GET /api/reports` list response. Only `GET /api/reports/{id}` should return a freshly-generated presigned URL. In the list, return only stable fields (`report_id`, `version`, `status`, `generated_at`, `language`, `client_id`).

---

## 2. Slice Suggestions

The following grouping maximizes end-to-end value at each boundary. Each slice can be independently deployed and tested. Dependencies flow strictly downward (later slices depend on earlier ones).

---

### Slice 1 — Upload & Pipeline Core

*Goal: a document goes in and reaches `review_ready` status; real-time pipeline progress is visible.*

**Endpoints:**
- `POST /api/uploads/init`
- `POST /api/uploads/complete`
- `GET /api/documents` (basic list, no advanced filters yet)
- `GET /api/documents/{id}`
- `GET /api/documents/{id}/status`
- `GET /api/pipeline/events` (SSE) — events: `pipeline_stage_changed`, `pipeline_failed`, `extraction_complete`

**Notes:** RISK-01 (page count in `/complete`) and RISK-02 (company_id validation on SSE) must be resolved before this slice ships.

---

### Slice 2 — Evidence Viewer & Review Queue

*Goal: extracted observations are visible, reviewable, and approvable. Evidence block proof UX fully works.*

**Endpoints (new in this slice):**
- `GET /api/documents/{id}/blocks`
- `GET /api/documents/{id}/pages/{page_number}`
- `GET /api/documents/{id}/observations`
- `GET /api/observations` (filters: `status`, `category_id`, `q`, `sort`)
- `GET /api/observations/{id}`
- `PATCH /api/observations/{id}` (edit label/key/unit/period)
- `PATCH /api/observations/{id}/status` (approve / reject / reconsider)

**Notes:** RISK-12 (invalid transition error contract) and RISK-13 (page image timing) must be resolved before this slice ships.

---

### Slice 3 — Categories & Conflicts

*Goal: users can organize documents into nested folders; conflicts are detected and resolvable; the conflict badge is accurate.*

**Endpoints (new in this slice):**
- `GET /api/categories`
- `POST /api/categories`
- `PATCH /api/categories/{id}`
- `DELETE /api/categories/{id}`
- `PATCH /api/categories/reorder`
- `PATCH /api/documents/{id}/category`
- `GET /api/conflicts` (filters: `resolution_status`, `normalized_key`)
- `POST /api/conflicts/{id}/resolve`
- Pipeline SSE event: `conflict_detected` (extends Slice 1 SSE stream)

**Notes:** RISK-05 (reorder sibling validation) and RISK-14 (semantic conflict filter) must be resolved before this slice ships.

---

### Slice 4 — Dashboard & Notifications

*Goal: dashboard shows real aggregated numbers; notification bell has a live count and a readable list.*

**Endpoints (new in this slice):**
- `GET /api/dashboard/summary`
- `GET /api/notifications` (filter: `?unread=true`)
- `PATCH /api/notifications/{id}/read`
- Pipeline SSE event: `notification` (extends Slice 1 SSE stream)

**Notes:** No new critical risks here beyond RISK-02 (already flagged for Slice 1). The dashboard endpoint is a pure aggregation query with no new contract ambiguities once pagination conventions are applied.

---

### Slice 5 — Chat & Manual Observations

*Goal: the full agent interaction loop works end-to-end: user sends a message, agent streams back, manual observation popup wires correctly, agent resumes.*

**Endpoints (new in this slice):**
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `DELETE /api/chat/sessions/{id}`
- `POST /api/chat/sessions/{id}/messages`
- `GET /api/chat/sessions/{id}/messages`
- `GET /api/chat/sessions/{id}/stream` (SSE) — all event types
- `POST /api/observations/manual`
- `GET /api/manual-observations/pending/{pending_id}`
- `POST /api/manual-observations/pending/{pending_id}/confirm`
- `POST /api/manual-observations/pending/{pending_id}/skip`

**Notes:** RISK-03 (SSE race condition), RISK-04 (pending response schema), RISK-08 (MCP company_id), and RISK-09 (message content shapes) must all be resolved before this slice ships. This is the highest-risk slice.

---

### Slice 6 — Reports & Preferences

*Goal: agent can generate and regenerate HTML+PDF reports; version lineage is navigable; preferences persist.*

**Endpoints (new in this slice):**
- `GET /api/reports`
- `GET /api/reports/{id}`
- `GET /api/reports/{id}/versions`
- `POST /api/reports/{id}/regenerate`
- `GET /api/preferences`
- `DELETE /api/preferences`

**Notes:** RISK-07 (PDF readiness race), RISK-06 (preferences scope ambiguity), and RISK-15 (html_snapshot_url in list) must be resolved before this slice ships.

---

### Slice 7 — Admin, Merge & Data Management

*Goal: admin users can manage team members and company settings; editors can merge semantically duplicate observations; company data can be deleted.*

**Endpoints (new in this slice):**
- `POST /api/observations/merge`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/{id}`
- `DELETE /api/users/{id}`
- `PATCH /api/companies/{id}`
- `DELETE /api/companies/{id}/data`

**Notes:** RISK-10 (user invite lifecycle) and RISK-11 (merge Zod schema) must be resolved before this slice ships.

---

## 3. Acceptance Criteria by Slice

All AC statements are verifiable at the HTTP/contract layer (request in → response out). No UI behaviour is described here.

---

### Slice 1 — Upload & Pipeline Core

**AC-1.1** `POST /api/uploads/init` with a valid JWT session, `{ filename: "energy.pdf", fileSize: 1048576, mimeType: "application/pdf" }` returns HTTP 200 with a body containing `{ uploadUrl: string (https, non-empty), objectKey: string (matches pattern `<company_id>/<uuid>/original.pdf`) }`. Presigned URL is valid for at least 14 minutes.

**AC-1.2** `POST /api/uploads/init` with an unsupported MIME type (e.g., `"text/plain"`) returns HTTP 422 with `{ code: "unsupported_mime_type" }`. With `fileSize` exceeding 52428800 bytes returns HTTP 422 with `{ code: "file_too_large" }`.

**AC-1.3** `POST /api/uploads/complete` with `{ objectKey, filename, page_count: 201 }` returns HTTP 422 with `{ code: "page_count_exceeded", max: 200 }`. With `page_count ≤ 200` returns HTTP 201 with `{ document_id: UUID, document_version_id: UUID, pipeline_status: "uploaded" }`.

**AC-1.4** After `POST /api/uploads/complete`, `GET /api/documents/{id}/status` returns `{ pipeline_status: string }` advancing through `uploaded → ocr_processing → ocr_done` within 5 minutes for a 50-page document (p95).

**AC-1.5** A client subscribed to `GET /api/pipeline/events?company_id={session_company_id}` receives a `pipeline_stage_changed` event for each status transition of a document belonging to that company. Subscribing with a `company_id` that differs from the session token's `company_id` returns HTTP 403 immediately (connection refused).

---

### Slice 2 — Evidence Viewer & Review Queue

**AC-2.1** `GET /api/documents/{id}/pages/{page_number}` for a document with `pipeline_status = review_ready` returns HTTP 200 with `{ page_image_url: string }` where the URL is a valid presigned R2 GET URL. For a document still in `ocr_processing` it returns HTTP 404 with `{ code: "page_not_ready", pipeline_status: "ocr_processing" }`.

**AC-2.2** `GET /api/observations/{id}` for a document-provenance observation returns a body that includes the `evidence_block_ids[]` array (non-empty) and each referenced block's `page_number`, `bbox`, and `text` fields.

**AC-2.3** `PATCH /api/observations/{id}/status` with `{ status: "approved" }` on a `candidate` observation returns HTTP 200. The same call on an `invalidated` observation returns HTTP 422 with `{ code: "invalid_transition", from: "invalidated", to: "approved" }`.

**AC-2.4** `GET /api/observations` with `?status=candidate&sort=confidence_score:desc` returns a paginated envelope `{ data, total, page, page_size }` where all items have `status = "candidate"` and items are sorted by `confidence_score` descending.

**AC-2.5** A `viewer`-role session calling `PATCH /api/observations/{id}/status` returns HTTP 403 with `{ code: "forbidden" }`.

---

### Slice 3 — Categories & Conflicts

**AC-3.1** `POST /api/categories` with `{ name: "2026", parent_category_id: null }` returns HTTP 201 with `{ category_id: UUID, path: "2026" }`. A subsequent `POST /api/categories` with `{ name: "Finance", parent_category_id: <above id> }` returns `{ path: "2026 / Finance" }` and all descendant `path` values are synchronously correct on the same response.

**AC-3.2** `PATCH /api/categories/reorder` with `{ ordered_ids: [id_A, id_B, id_C], parent_category_id: <uuid> }` where all IDs are verified siblings returns HTTP 200 and subsequent `GET /api/categories` reflects the new `sort_order`. Sending `ordered_ids` containing IDs from mixed parents returns HTTP 422 with `{ code: "mixed_parents" }`.

**AC-3.3** `DELETE /api/categories/{id}` for a category that has child categories returns HTTP 409 with `{ code: "has_children" }`. After those children are deleted, the same call returns HTTP 204.

**AC-3.4** `GET /api/conflicts` with `?resolution_status=auto_resolved` returns only `ConflictCase` records with `resolution_status = "auto_resolved"`. Items include `winning_observation_id`, `observation_ids[]`, `normalized_key`, `period_start`, and `period_end` fields.

**AC-3.5** `POST /api/conflicts/{id}/resolve` (call by editor or admin) with `{ chosen_observation_id: <a superseded observation id> }` returns HTTP 200, the chosen observation's status becomes `approved`, all other overlapping approved observations become `superseded`, and a `ConflictResolution` record is created with `resolved_by` matching the session user.

---

### Slice 4 — Dashboard & Notifications

**AC-4.1** `GET /api/dashboard/summary` returns HTTP 200 with `{ documents_by_status: { uploaded: number, ocr_processing: number, ..., review_ready: number, failed: number }, unresolved_conflict_count: number, recent_documents: Document[], recent_reports: Report[] }`. All `PipelineStatus` keys are present in `documents_by_status` (value is `0` when none exist for that status).

**AC-4.2** `GET /api/notifications?unread=true` returns only notifications with `read = false` for the authenticated user. The response is a paginated envelope. Items include `notification_id`, `type`, `payload`, `read`, and `created_at`.

**AC-4.3** `PATCH /api/notifications/{id}/read` returns HTTP 200 with `{ notification_id: UUID, read: true }`. A subsequent `GET /api/notifications?unread=true` no longer includes that notification.

**AC-4.4** When a pipeline event creates a `Notification` record, a `notification` SSE event is emitted on the pipeline events stream within 2 seconds. The event data includes `{ notification_id, type, payload, unread_count }` where `unread_count` reflects the total unread count for the company.

---

### Slice 5 — Chat & Manual Observations

**AC-5.1** `POST /api/chat/sessions` returns HTTP 201 with `{ session_id: UUID, created_at: string }`. A subsequent `GET /api/chat/sessions` for the same user includes this session in the paginated list with `message_count: 0`.

**AC-5.2** `POST /api/chat/sessions/{id}/messages` with `{ content: "Hello" }` returns HTTP 202 with `{ message_id: UUID }`. Within 30 seconds, a client subscribed to `GET /api/chat/sessions/{id}/stream` receives at least one `token` event and eventually a `done` event. The `token` events concatenated form a non-empty string.

**AC-5.3** When the agent calls `propose_manual_observation`, the chat SSE stream emits a `manual_obs_request` event with payload `{ pending_id: UUID, prefilled: { label, normalized_key, value, unit, period_start, period_end } }`. `GET /api/manual-observations/pending/{pending_id}` immediately after returns `{ pending_id, status: "pending", expires_at: string }`.

**AC-5.4** `POST /api/manual-observations/pending/{pending_id}/confirm` with a valid Zod payload returns HTTP 201 with `{ observation_id: UUID, status: "approved" }`. A subsequent `GET /api/manual-observations/pending/{pending_id}` returns `{ status: "confirmed", observation_id: UUID }`. Calling `/confirm` again on the same `pending_id` returns HTTP 409 with `{ code: "already_confirmed" }`.

**AC-5.5** `GET /api/chat/sessions/{id}/messages` returns a paginated list where each item includes `message_id`, `role`, `type`, and a `content` object. For a message with `type = "agent_tool_call"`, `content` contains `tool_name: string` and `summary: string`. For `type = "report_ready"`, `content` contains `report_id: UUID` and `html_snapshot_url: string`.

---

### Slice 6 — Reports & Preferences

**AC-6.1** `GET /api/reports` (paginated list) returns items that do **not** include an `html_snapshot` or `html_snapshot_url` field. Each item includes `report_id`, `version`, `status`, `generated_at`, `language`, and `client_id`.

**AC-6.2** `GET /api/reports/{id}` returns the full report object including a freshly-generated `html_snapshot_url` (valid presigned R2 URL, expiry ≥ 59 minutes). The `html_snapshot` field is present and non-empty.

**AC-6.3** `GET /api/reports/{id}/versions` returns `{ versions: [{ report_id, version, source_report_id, generated_at, status }] }` where the first version has `source_report_id: null` and each subsequent version's `source_report_id` points to the preceding `report_id`.

**AC-6.4** `POST /api/reports/{id}/regenerate` with `{ style_instruction: "Use bullet points" }` returns HTTP 202 with `{ report_id: UUID (new), version: N+1, html_snapshot_url: string, pdf_url: string | null }`. The original report's `report_id` is unchanged and `GET /api/reports/{original_id}` still returns the original content.

**AC-6.5** `DELETE /api/preferences?scope=user:{user_id}:company:{company_id}` returns HTTP 204. A subsequent `GET /api/preferences` for the same scope returns an empty preferences object `{}`.

---

### Slice 7 — Admin, Merge & Data Management

**AC-7.1** `POST /api/observations/merge` with `{ observation_ids: [id1, id2], canonical_label: "GHG Scope 1", canonical_normalized_key: "ghg_scope1" }` returns HTTP 200 with `{ updated_count: 2, canonical_normalized_key: "ghg_scope1" }`. `GET /api/observations/{id1}` and `GET /api/observations/{id2}` both reflect `normalized_key: "ghg_scope1"` and `label: "GHG Scope 1"`.

**AC-7.2** `POST /api/users` (admin session) with `{ email: "new@example.com", role: "editor" }` returns HTTP 201. `GET /api/users` subsequently includes a user with that email and role. A non-admin session calling this endpoint returns HTTP 403.

**AC-7.3** `PATCH /api/users/{id}` (admin session) with `{ role: "viewer" }` returns HTTP 200 with the updated user object reflecting `role: "viewer"`.

**AC-7.4** `DELETE /api/companies/{id}/data` (admin session matching that company) returns HTTP 202. After completion, `GET /api/documents`, `GET /api/observations`, and `GET /api/reports` all return empty `data: []` arrays for that company. Audit logs for the deletion event remain and are readable by an admin.

**AC-7.5** `PATCH /api/companies/{id}` (admin session) with `{ name: "Acme Corp updated" }` returns HTTP 200 with `{ company_id, name: "Acme Corp updated" }`. A non-admin session returns HTTP 403.
