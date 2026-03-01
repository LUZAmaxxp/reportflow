# Frontend Integration Audit — Structured Issue List

> **Auditor note:** §16 (Data Plane REST API) resolves many items flagged in the audit prompt — document CRUD, blocks, page images, observation CRUD, conflicts, reports, preferences, and category CRUD are now defined. The 14 issues below are **genuine remaining gaps** that would block frontend implementation.

---

## FE1 — Dashboard has no aggregation or count contracts

**Sections:** §5.6 (Dashboard page map), §16 (REST API table)

`GET /api/documents` and `GET /api/conflicts` are listed in §16, but the Dashboard requires (a) a pipeline status distribution (how many docs per stage), (b) a total unresolved conflict count, and (c) paginated recent documents/reports sorted by `created_at desc`. No query parameters, sort options, or response envelope (`total`, `page`, `page_size`) are documented for any list endpoint; no aggregation endpoint exists for pipeline stage counts.

**Fix:** Add a `GET /api/dashboard/summary` endpoint returning `{ documents_by_status: Record<PipelineStatus, number>, unresolved_conflict_count: number, recent_documents: Document[], recent_reports: Report[] }`, or document the existing list endpoints with filter/sort/pagination params (minimum: `?sort=created_at:desc&limit=5&status=unresolved`).

---

## FE2 — Pipeline SSE event shape not defined (FR-37)

**Sections:** §6 FR-37, §16 (`GET /api/pipeline/events`)

`GET /api/pipeline/events?company_id={id}` is listed in §16 as an "SSE stream for real-time pipeline status updates" but no event type names or data payloads are documented. The frontend cannot parse, route, or render events without knowing which `event:` names to listen for and what fields each carries.

**Fix:** Add an SSE event shape table to §16 or a new §16.1, e.g.:
```
event: pipeline_stage_changed  data: { document_id, document_title, pipeline_status, updated_at }
event: extraction_complete      data: { document_id, observations_created, observations_skipped }
event: pipeline_failed          data: { document_id, reason }
```

---

## FE3 — Chat REST API entirely absent from §16

**Sections:** §5.4.2 (Chat interface design), §16 (REST API table)

§5.4.2 describes persistent server-side `ChatSession` / `ChatMessage` tables, a "New chat" button, and a session history sidebar — all requiring REST calls. §16 defines zero chat endpoints. The entire `/chat` page (`/api/chat/sessions`, `/api/chat/sessions/{id}/messages`) has no backing API contract.

**Fix:** Add to §16: `POST /api/chat/sessions` (create session), `GET /api/chat/sessions` (list sessions for user), `DELETE /api/chat/sessions/{id}` (optional), and `POST /api/chat/sessions/{id}/messages` (send user message, triggers agent).

---

## FE4 — Chat agent SSE streaming contract not defined

**Sections:** §5.4.2 ("streams token-by-token via SSE"), §16

§5.4.2 states the agent streams token-by-token via SSE and enumerates message types (`user_text`, `agent_text`, `agent_tool_call`, `manual_obs_request`, `report_ready`, `error`). No SSE endpoint URL, no event type names, and no per-event payload structure are defined anywhere. The frontend cannot implement the streaming chat renderer, typing indicator, or tool-call collapse cards.

**Fix:** Define `GET /api/chat/sessions/{id}/stream` (or equivalent) in §16 with an event shape table:
```
event: token              data: { delta: string }
event: tool_call          data: { tool_name: string, summary: string, details?: object }
event: manual_obs_request data: { pending_id: UUID, prefilled: { label, normalized_key, value, unit, period_start, period_end } }
event: report_ready       data: { report_id: UUID, title: string, html_snapshot_url: string, pdf_url: string | null }
event: error              data: { message: string, retryable: boolean }
event: done               data: {}
```

---

## FE5 — `pending_id` propagation path from MCP tool to frontend is undefined

**Sections:** §15.4 (`propose_manual_observation`), §5.4.2 (`manual_obs_request` message type), §5.4.1 (popup)

`propose_manual_observation` is an in-process MCP function (§15.4) that returns `pending_id`. The frontend popup (§5.4.1) uses `pending_id` to call `POST /api/manual-observations/pending/{pending_id}/confirm`. The spec names the chat message type `manual_obs_request` (§5.4.2) but never defines its payload — specifically whether and how `pending_id` and prefill data travel through the chat stream to the frontend. Without this, the frontend cannot wire the popup correctly.

**Fix:** Explicitly define the `manual_obs_request` SSE event payload (see FE4 fix above) and add a sentence to §5.4.1: "The `pending_id` is received by the frontend from the `manual_obs_request` event on the chat stream and passed directly to the confirm/skip endpoints."

---

## FE6 — Notification bell has no schema, no REST endpoints, and no real-time delivery contract

**Sections:** §5.6 (top bar), §6 FR-38, §16

FR-38 states "Events are stored in a `Notification` table and marked read on click," but no `Notification` entity schema is defined in §7, no `GET /api/notifications` or `PATCH /api/notifications/{id}/read` endpoints appear in §16, and no SSE or WebSocket contract for live count updates is specified. The notification bell icon in the global layout has no data source.

**Fix:** Add `Notification` schema to §7 (`notification_id`, `company_id`, `user_id`, `type`, `payload` JSON, `read`, `created_at`). Add `GET /api/notifications?unread=true` and `PATCH /api/notifications/{id}/read` to §16. Specify whether live count is pushed via the existing pipeline SSE stream (adding a `notification` event type) or a separate channel.

---

## FE7 — Report version history has no version-chain FK and no list-versions endpoint

**Sections:** §5.5 (Report correction loop), §5.6 (`/reports/[id]` version history sidebar), §7 (Report schema), §16

§5.5 says "Store new Report version alongside previous" and §5.6 shows a version history sidebar. `POST /api/reports/{id}/regenerate` (§16) creates a brand-new `report_id` — but the `Report` schema (§7) has no `source_report_id` or `lineage_id` FK to link versions together. There is also no `GET /api/reports/{id}/versions` endpoint, so the frontend has no way to enumerate all versions of a report.

**Fix:** Add `source_report_id` (nullable FK → Report) to the `Report` schema in §7, and add `GET /api/reports/{id}/versions` to §16 returning `{ versions: { report_id, version, generated_at, status }[] }`.

---

## FE8 — "Regenerate" flow contradicts between §5.6 page map and §16 REST API

**Sections:** §5.6 (`/reports/[id]` purpose column), §16 (`POST /api/reports/{id}/regenerate`)

The page map in §5.6 describes "Regenerate → opens chat," implying the user is redirected to `/chat` with context pre-loaded. §16 separately defines `POST /api/reports/{id}/regenerate` as a self-contained REST action with a full request/response contract. These are two incompatible flows; the frontend cannot implement both without knowing which is authoritative.

**Fix:** Remove "→ opens chat" from the §5.6 `reports/[id]` description and replace with "→ calls `POST /api/reports/{id}/regenerate`." If inline style overrides via chat are still desired, clarify that as a separate post-regeneration flow.

---

## FE9 — User management and company settings have no backing API endpoints

**Sections:** §5.6 (`/settings` purpose), §16

The Settings page description (§5.6) includes "user management (admin)" and "company settings." No user CRUD endpoints (`GET/POST/PATCH/DELETE /api/users`) and no company update endpoint (`PATCH /api/companies/{id}`) appear in §16. The settings page has no data source or mutation target.

**Fix:** Add to §16: `GET /api/users` (admin, list users for company), `POST /api/users` (admin, invite user), `PATCH /api/users/{id}` (admin, update role), `DELETE /api/users/{id}` (admin, remove user), and `PATCH /api/companies/{id}` (admin, update company name/settings).

---

## FE10 — Category drag-and-drop reorder has no `sort_order` field and no reorder endpoint

**Sections:** §5.6 (`/settings/categories`), §7 (`DocumentCategory` schema), §16

The category manager specifies "drag-and-drop reordering" (§5.6), but the `DocumentCategory` schema (§7) has no `sort_order` or `position` field, and §16 contains no reorder endpoint (e.g., `PATCH /api/categories/reorder`). There is no way to persist a drag-and-drop change server-side.

**Fix:** Add `sort_order` (integer) to the `DocumentCategory` schema in §7, and add `PATCH /api/categories/reorder` to §16 with request body `{ ordered_ids: UUID[] }` scoped to siblings under the same `parent_category_id`.

---

## FE11 — §16 REST endpoints lack response contracts, query parameters, and pagination

**Sections:** §16 (all GET list endpoints)

Every GET list endpoint in §16 (`/api/documents`, `/api/observations`, `/api/reports`, `/api/conflicts`, `/api/categories`, etc.) has only a one-line description. No query parameters (filters, sort), no pagination envelope (`total`, `page`, `page_size`), and no response field lists are defined. The filterable/searchable pages in §5.6 (`/observations`, `/documents`, `/reports`) cannot be implemented without knowing valid filter param names.

**Fix:** For each list endpoint, document at minimum: (a) supported `?filter` query params, (b) pagination (`?page`, `?limit`), (c) response envelope shape (`{ data: T[], total: number, page: number, page_size: number }`). A minimal OpenAPI YAML block per endpoint would satisfy this.

---

## FE12 — HTML report preview rendering strategy is unspecified

**Sections:** §5.6 (`/reports/[id]` purpose), §7 (Report schema `html_snapshot` / `html_snapshot_url`), §12.4 (Security)

The Report detail page shows an HTML preview. `html_snapshot` is stored as raw HTML text; `html_snapshot_url` is a presigned R2 URL. Neither §5.6 nor §12.4 specifies how the frontend should render this HTML (sandboxed `<iframe>`, `dangerouslySetInnerHTML` with DOMPurify, etc.). Agent-generated HTML may contain arbitrary inline styles; the CSP policy implications are unaddressed.

**Fix:** Add a rendering note to §5.6 (report detail) specifying the approach, e.g.: "Render `html_snapshot_url` in a sandboxed `<iframe sandbox='allow-scripts'>` to prevent script execution and XSS. The frontend must not use `dangerouslySetInnerHTML` for report HTML."

---

## FE13 — Category `path` auto-computation timing is undefined

**Sections:** §7 (`DocumentCategory` schema `path` field), §16 (`POST /api/categories`, `PATCH /api/categories/{id}`)

`DocumentCategory.path` is described as "auto-computed" (e.g., `"2026 / Finance / Energy Bills"`) in §7, but no spec detail clarifies whether it is computed synchronously on `POST`/`PATCH` and returned in the response body, or computed asynchronously. On drag-and-drop reorder or parent reassignment, the frontend needs to know whether to read `path` from the response immediately or refetch the full tree.

**Fix:** Add to §7: "The `path` field is computed synchronously on the server on every `POST /api/categories` and `PATCH /api/categories/{id}` call and returned in the response body. All descendant paths are also recomputed in the same transaction."

---

## FE14 — `rejected → candidate` ("Reconsider") transition absent from status lifecycle table

**Sections:** §2.5 (Observation Status Lifecycle table), §5.6 (`/documents/[id]/review` Review Queue)

The Review Queue (§5.6) shows a "Rejeté" tab with an implied "Reconsider" action to move an observation back to `candidate`. The `PATCH /api/observations/{id}/status` endpoint (§16) exists, but the status lifecycle table in §2.5 does not include a `rejected → candidate` transition. The backend may reject this call as an invalid transition, leaving the frontend action with no defined behaviour.

**Fix:** Add a row to the §2.5 lifecycle table: `rejected → candidate | "Reconsider" action by user | User (editor/admin)` and confirm this transition is accepted by `PATCH /api/observations/{id}/status`.
