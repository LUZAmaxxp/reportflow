# ReportFlow — Frontend Architecture Plan
**Agent C: Frontend Routes + Components Planner**  
Tech: Next.js 14+ App Router · shadcn/ui · Tailwind CSS · Framer Motion · Auth.js v5 · TypeScript  
Date: 2026-02-21

---

## 1. Risks & Gaps

### R1 — SSE Lifecycle Management (HIGH)
Two concurrent SSE connections can be open simultaneously: `GET /api/pipeline/events` (Dashboard + Documents pages) and `GET /api/chat/sessions/{id}/stream` (Chat page). The browser enforces a per-domain limit of **6 concurrent HTTP/1.1 connections**; two persistent SSE connections plus normal API fetches will routinely saturate this under HTTP/1.1. If the app is not served over HTTP/2, the pipeline SSE will starve API calls made during an active chat stream.

**Mitigation:** Verify HTTP/2 is enforced in the deployment (Vercel/Cloudflare default). Wrap `EventSource` instances in a singleton context provider each (`PipelineSSEProvider`, `ChatSSEProvider`) and close them on unmount — never open ad-hoc `EventSource` objects inline in components. Add a reconnection-with-backoff wrapper (1s → 2s → 4s, max 30s) since `EventSource` does not retry on 4xx/5xx. Route the pipeline stream through a `usePipelineStream` hook that deduplications subscriptions across Dashboard and Documents when both are mounted (e.g., via a tab layout).

### R2 — Chat Streaming State vs. React Reconciliation (HIGH)
The `token` SSE event fires at ≤ 30ms intervals during Grok streaming. Naively calling `setState` on each token will cause 30+ re-renders per second on a component tree that includes the full message list, sidebar, and layout. This produces visible jank and can freeze the input bar.

**Mitigation:** Buffer tokens in a `useRef` and flush to state via `requestAnimationFrame` or a 50ms debounce. Use `React.memo` on every message bubble. Render the **actively streaming message** as a separate `<StreamingBubble>` component that reads from a ref, mounted outside the message list, and only merged into the list state on `done` event. This eliminates re-renders of historical message bubbles entirely during streaming.

### R3 — Manual Observation Popup: Agent Suspension State (HIGH)
When `manual_obs_request` fires, three things must happen atomically from the user's perspective: (1) chat input is disabled, (2) a banner appears, (3) a modal opens. If the user refreshes the page mid-suspension, the `pending_id` is lost from memory. The agent polls for 10 minutes, but the frontend has no way to recover the popup state on a fresh page load.

**Mitigation:** On receiving `manual_obs_request`, persist `{ pending_id, prefilled, timestamp }` to `sessionStorage`. On `/chat` page mount, check `sessionStorage` for an active pending request and re-open the popup if found and within the 10-minute window. On `done`, `error`, or timeout (compare `timestamp` + 10min), clear the key. The chat session message history from `GET /api/chat/sessions/{id}/messages` will contain the stored `manual_obs_request` message, so the banner also reconstructs from that on page load.

### R4 — dnd-kit Reorder Race Condition (MEDIUM)
`PATCH /api/categories/reorder` is scoped to siblings under a single `parent_category_id`. dnd-kit fires drag events very quickly; if two rapid repositions are dispatched before the first response returns, the server applies them sequentially against stale state, producing an incorrect final order. The spec says the endpoint updates `sort_order` atomically, but the client can still generate race conditions.

**Mitigation:** Implement optimistic updates using `useOptimistic` (React 19 / Next.js 14 canary) or a local copy of the sorted list. Debounce the `PATCH` call by 400ms after drag end and cancel any in-flight request before dispatching the new one (use an `AbortController`). On error response, revert the optimistic state and show a destructive `Alert`. Disable drag interactions while a reorder mutation is in-flight.

### R5 — Document Split-View: SVG bbox Overlay Coordinate System (MEDIUM)
Page images are returned as signed PNGs from R2 (`{company_id}/{document_id}/pages/{page_number}.png`). `EvidenceBlock.bbox` is `[x, y, w, h]` as float ratios (0–1 of page dimensions, or absolute pixel coords — **the spec does not state the coordinate system**). The SVG overlay must scale bbox coordinates to match the rendered `<img>` dimensions, which change on window resize.

**Mitigation:** Use a `ResizeObserver` on the `<img>` element to track rendered size. Normalize bbox to a `viewBox="0 0 1 1"` SVG sized to `position: absolute` over the `<img>`. This works regardless of whether bbox values are ratios or absolute pixels (they need to be ratios for the SVG approach — **confirm with backend before implementation**). Add a `data-coordinates="ratio|absolute"` flag to the API response for `GET /api/documents/{id}/blocks` so the frontend knows how to normalize.

### R6 — iframe Report Preview: CSP and Cross-Origin Signed URLs (MEDIUM)
The report iframe loads `html_snapshot_url`, a time-limited presigned R2 URL. R2 serves from a different origin (e.g., `pub-xxx.r2.dev`). The `<iframe sandbox="allow-scripts allow-same-origin">` requires `allow-same-origin` to be safe only when the content is truly cross-origin — if the R2 bucket shares the app's origin, `sandbox="allow-scripts allow-same-origin"` reintroduces script execution in the parent's security context.

**Mitigation:** Always serve the R2 bucket from a **dedicated subdomain** (`reports.your-domain.com`) that is cross-origin relative to the app. Set the iframe's `csp` attribute: `<iframe csp="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:">` to further restrict report content. The signed URL expires in 1 hour (per §17.3); add a `useEffect` that refreshes the signed URL every 55 minutes by calling `GET /api/reports/{id}` before the link expires during a long viewing session.

### R7 — Upload Optimistic State vs. Pipeline SSE Ordering (MEDIUM)
After `POST /api/uploads/complete`, the client shows an optimistic `uploaded` status card. The pipeline SSE `pipeline_stage_changed` events should drive subsequent status transitions. However, if the SSE connection drops and reconnects, the frontend may miss intermediate transitions (e.g., `ocr_processing → ocr_done`), leaving the UI in a stale "Uploaded" state even after the document reaches `review_ready`.

**Mitigation:** On SSE reconnect (using the `EventSource` `lastEventId` header if the server supports it, or on the `open` re-fire event), invalidate and refetch the document list from `GET /api/documents`. Use SWR or TanStack Query with a `refetchOnWindowFocus` + `refetchInterval` fallback (every 30s) as a recovery net. Never rely solely on SSE for status; treat it as a real-time accelerator, not a source of truth.

### R8 — Auth.js v5 Middleware + App Router Role Guard (MEDIUM)
Next.js middleware runs on the Edge Runtime, which limits available Node.js APIs. Auth.js v5's `auth()` export works in the Edge Runtime, but JWT decoding for role claims inside middleware needs the JWKS or symmetric secret to be accessible in the Edge environment. If `NEXTAUTH_SECRET` is not properly forwarded, the middleware silently fails and all routes become publicly accessible.

**Mitigation:** Write an explicit middleware test: assert that a `GET /documents` request with no session cookie returns a `302 → /login` redirect. Assert that a valid viewer session returns `200` for read routes but `403` for `POST /api/observations/manual`. Co-locate a `lib/auth-helpers.ts` with a `requireRole(role)` server-side guard that is called at the top of every API route and Server Action, independent of middleware (defense-in-depth per §12.4).

### R9 — Notification Bell Unread Count Consistency (LOW)
The `notification` SSE event carries `unread_count` (from §16.1). However, if the user has two browser tabs open, each tab increments its own local count. The bell count drifts from the server's true unread count.

**Mitigation:** On `PATCH /api/notifications/{id}/read` success, refetch `GET /api/notifications?unread=true` to get the authoritative count rather than decrementing local state. Use a shared React context (`NotificationContext`) where all tabs that share the same session can reconcile via the SSE `notification` event's `unread_count` field (authoritative from server).

### R10 — First-Run Onboarding vs. Dashboard SSR (LOW)
The Dashboard is a Server Component rendering `GET /api/dashboard/summary`. The welcome card (first-run) should only appear if `documents_by_status` totals zero. This is straightforward, but the tooltip sequence (after first extraction, after first report) requires client-side persistence (localStorage) since it is per-user UI state, not server state.

**Mitigation:** Use a `OnboardingProvider` client component that reads/writes `localStorage` keys (`reportflow:onboarding:extraction_seen`, `reportflow:onboarding:report_seen`). Tooltips are rendered client-side via `Tooltip` from shadcn/ui with a portal. The Dashboard Server Component passes `{ hasDocuments, hasReports }` props down to the client Onboarding wrapper.

---

## 2. Component Dependency Tree

Dependencies flow downward. Items at the same level are buildable in parallel.

```
Layer 0 — Global Infrastructure (build first)
├── AuthProvider (Auth.js v5 SessionProvider wrapper)
├── AppLayout (Sidebar + TopBar shell; no data, static nav items)
├── ThemeProvider (Tailwind dark mode)
├── QueryProvider (TanStack Query client)
├── PipelineSSEProvider (EventSource singleton for /api/pipeline/events)
├── NotificationProvider (context: unread count, notification list, bell state)
└── lib/auth-helpers.ts (requireRole guard for API routes)

Layer 1 — Primitive UI Atoms (build second, no data fetching)
├── PipelineStageBadge (Framer Motion pulse + label)
├── StatusSkeleton (matched skeletons per page shape)
├── EmptyState (illustration slot + CTA slot)
├── ErrorAlert (shadcn Alert destructive wrapper)
├── ConfirmDialog (shadcn AlertDialog wrapper; reusable)
├── PageTransition (Framer Motion AnimatePresence wrapper)
└── AvatarWithRole (Avatar + role badge)

Layer 2 — Data-Connected Atoms (require Layer 0 + Layer 1)
├── NotificationBell (reads NotificationContext; calls PATCH /read)
├── ConflictsBadge (reads unresolved_conflict_count from SSE/query)
├── CategorySelect (dropdown; fetches GET /api/categories)
└── UserMenu (session data; role display)

Layer 3 — Feature Components (require Layer 1 + Layer 2)
├── UploadFlow
│   ├── FilePickerButton (triggers file input)
│   ├── UploadProgressCard (optimistic status; presigned PUT)
│   └── UploadCompleteHandler (calls /api/uploads/complete)
│
├── DocumentSplitView (requires UploadFlow complete)
│   ├── PageImageViewer (img + SVG overlay; ResizeObserver)
│   ├── BboxHighlight (SVG rect, animated on hover)
│   ├── PageNavigator (prev/next page controls)
│   └── ObservationListPanel (right pane; links to ReviewQueue items)
│
├── ObservationCard (label, key, value, unit, status badge, evidence link)
├── ObservationEditForm (react-hook-form + Zod; all fields from §5.4.1)
│
├── ReviewQueueTabs (shadcn Tabs: Approuvé·Candidat·Rejeté·Conflit)
│   ├── ObservationReviewRow (inline approve/reject/edit)
│   └── ReconsiderButton (rejected → candidate)
│
├── ConflictCard (winning/losing side-by-side; override action)
│
├── ManualObservationPopup (shadcn Dialog; requires ObservationEditForm)
│   ├── PendingObservationBanner (chat input disable + banner text)
│   └── (uses CategorySelect from Layer 2)
│
├── ReportIframe (sandboxed iframe; signed URL refresh on 55min)
├── ReportVersionSidebar (GET /api/reports/{id}/versions)
├── RegenerateButton (POST /api/reports/{id}/regenerate)
│
├── ChatInterface (requires ManualObservationPopup + ReportIframe card)
│   ├── ChatSSEProvider (EventSource for /stream)
│   ├── ChatMessageList (ScrollArea; React.memo per bubble)
│   ├── StreamingBubble (ref-based; merged on done)
│   ├── MessageBubble (user_text, agent_text, agent_tool_call, report_ready, error)
│   ├── ToolCallCollapseCard (expandable details)
│   ├── TypingIndicator (Framer Motion dots)
│   ├── ChatInputBar (disabled during manual_obs_request)
│   └── ChatSessionSidebar (GET /api/chat/sessions)
│
└── CategoryTreeManager (requires Layer 2 CategorySelect; standalone)
    ├── CategoryTreeNode (recursive; dnd-kit draggable)
    ├── CategoryNodeForm (create/rename; shadcn Dialog)
    └── CategoryReorderHandler (PATCH /api/categories/reorder; debounced)

Layer 4 — Pages (compose Layer 3 components; RSC shells with CC islands)
├── DashboardPage (/)
├── DocumentsListPage (/documents)
├── DocumentDetailPage (/documents/[id])
├── ReviewQueuePage (/documents/[id]/review)
├── ObservationsListPage (/observations)
├── ConflictInboxPage (/conflicts)
├── ReportsListPage (/reports)
├── ReportDetailPage (/reports/[id])
├── ChatPage (/chat)
├── SettingsPage (/settings)
└── CategoryManagerPage (/settings/categories)
```

---

## 3. Slice Suggestions

Slices are ordered to deliver testable end-to-end value as early as possible. Each slice is independently deployable.

---

### Slice 1 — Shell, Auth & Navigation
**Delivers:** A logged-in user can navigate all routes; access control works; global layout renders.

**Scope:**
- Auth.js v5 setup: `auth()`, `SessionProvider`, JWT claims (`user_id`, `company_id`, `role`)
- Next.js middleware redirecting unauthenticated → `/login`
- Login page (email/password or OAuth per Auth.js provider)
- `AppLayout`: collapsible Sidebar (all nav items, static labels in French), TopBar (company name placeholder, `AvatarWithRole`, `NotificationBell` skeleton), `PageTransition`
- `lib/auth-helpers.ts`: `requireRole()` guard
- Role-based nav item visibility: hide Chat, Settings links for `viewer`
- All 11 routes as empty page shells with correct titles
- `ThemeProvider`, `QueryProvider`

---

### Slice 2 — Document Upload & Pipeline Status
**Delivers:** A user can upload a PDF, see its status progress in real-time on both Dashboard and Documents list.

**Scope:**
- `UploadFlow` (FilePickerButton → presigned PUT chain → UploadCompleteHandler)
- `PipelineSSEProvider` + `usePipelineStream` hook (singleton; reconnect backoff)
- `PipelineStageBadge` (animated Framer Motion pulse per pipeline_status)
- `DocumentsListPage`: list with `StatusSkeleton` on load, `EmptyState` (« Importez votre premier document »), upload button, category sidebar filter (static tree from `GET /api/categories`)
- `DashboardPage`: `GET /api/dashboard/summary` → recent documents list + `documents_by_status` counts; first-run welcome card; `OnboardingProvider`
- `NotificationProvider`: handles `notification` SSE event → `NotificationBell` unread count; handles `pipeline_stage_changed` events → updates document card status optimistically
- Sonner toast on `extraction_complete`, `pipeline_failed`
- `CategorySelect` (Layer 2) for document category assignment on upload

---

### Slice 3 — Document Detail, Review Queue & Observation Approval
**Delivers:** An editor can view extracted observations with page-level evidence, approve/reject candidates, and reconsider rejected ones.

**Scope:**
- `DocumentDetailPage`: `DocumentSplitView` (PageImageViewer with SVG bbox overlay from `GET /api/documents/{id}/blocks` + `GET /api/documents/{id}/pages/{page}`, ObservationListPanel)
- `BboxHighlight`: hover interaction on observation row highlights corresponding bbox on page image
- `ReviewQueuePage`: `ReviewQueueTabs` (Approuvé · Candidat · Rejeté · Conflit tabs), `ObservationReviewRow` (inline approve → `PATCH /api/observations/{id}/status`, reject, `ReconsiderButton`)
- `ObservationEditForm` (react-hook-form + Zod, all fields, `CategorySelect`, date pickers for period)
- Pagination on each tab (shadcn Pagination; `?page&limit` params)
- `ConflictsBadge` in sidebar increments on `conflict_detected` SSE event
- `ObservationsListPage`: full-company browser with filter panel (status, category, key, period, q); `ObservationCard` rows; `EmptyState`

---

### Slice 4 — Conflict Inbox & Manual Observation (Standalone)
**Delivers:** An editor can resolve conflicts and create manual observations outside of chat.

**Scope:**
- `ConflictInboxPage`: paginated `ConflictCard` list (winning/losing side-by-side, field label, period, source docs, timestamps), override action → `POST /api/conflicts/{id}/resolve` → optimistic re-sort + Sonner toast
- `ManualObservationPopup` (standalone trigger from ObservationsListPage « + Ajouter manuellement » button → `POST /api/observations/manual`)
- `ConfirmDialog` reuse for destructive override confirmation
- `ErrorAlert` on resolve failure; `EmptyState` when no unresolved conflicts (« Aucun conflit non résolu »)

---

### Slice 5 — Chat Interface & Report Generation
**Delivers:** An editor can start a chat, trigger report generation, respond to manual observation popups from the agent, and view the finished report.

**Scope:**
- `ChatPage`: `ChatSessionSidebar` (GET /api/chat/sessions), `ChatInterface` (full composition)
- `ChatSSEProvider`: EventSource on `/api/chat/sessions/{id}/stream`; handles all 6 event types
- `ChatMessageList` + `StreamingBubble` (ref-buffered; 50ms RAF flush)
- `TypingIndicator` (Framer Motion dots during tool_call events)
- `ToolCallCollapseCard` (tool_name + summary; expandable `details` JSON)
- `ManualObservationPopup` wired to `manual_obs_request` SSE event: `pending_id` → sessionStorage; `PendingObservationBanner`; chat input disabled; `POST confirm/skip` endpoints
- `report_ready` SSE event → renders `ReportReadyCard` in chat (title, « Voir le rapport » / « Télécharger PDF »)
- `ReportsListPage`: paginated list, filter by client/date/status, « Nouveau rapport » CTA → navigate to `/chat`
- `ReportDetailPage`: `ReportIframe` (sandboxed; 55-min signed URL refresh), PDF download button, `ReportVersionSidebar` (GET /api/reports/{id}/versions), `RegenerateButton`
- Empty suggestion cards on new chat (3 suggested prompts in French)

---

### Slice 6 — Settings, Category Manager & User Management
**Delivers:** An admin can manage company settings, invite/remove users, and reorder the document category tree.

**Scope:**
- `SettingsPage`: company name edit (`PATCH /api/companies/{id}`), preferences section (`GET/DELETE /api/preferences`)
- User management table (admin only): `GET /api/users`, invite form (`POST /api/users`), role select (`PATCH /api/users/{id}`), remove (`DELETE /api/users/{id}`) with `ConfirmDialog`
- `CategoryManagerPage`: `CategoryTreeManager` with dnd-kit (draggable nodes; debounced `PATCH /api/categories/reorder`; optimistic reorder), `CategoryNodeForm` create/rename dialog, delete with child-reassignment prompt
- Role-guard: Settings nav item hidden for `editor`/`viewer`; category manager accessible to `editor+`
- `EmptyState` for empty user list and empty category tree

---

### Slice 7 — Polish, Empty States & Onboarding Tooltips
**Delivers:** All pages have complete French-language empty states, loading skeletons, error alerts, and the three-step onboarding tooltip sequence.

**Scope:**
- Audit every page for missing `StatusSkeleton` (loading), `EmptyState` (empty), `ErrorAlert` (error) states
- `OnboardingProvider`: three-step tooltip sequence (welcome → review queue highlight → style suggestion); localStorage persistence per-user
- Full French copy pass: all labels, toasts, empty state messages, aria-labels, form validation errors
- Framer Motion `AnimatePresence` page transitions confirmed working on all routes
- Responsive sidebar: confirm collapse to icon-only on < lg breakpoint (MVP; full bottom tab bar is post-MVP)
- Accessibility pass: keyboard navigation on ReviewQueueTabs, dialog focus trap on ManualObservationPopup, ARIA live region on NotificationBell count

---

## 4. Acceptance Criteria

### Slice 1 — Shell, Auth & Navigation

| # | Check |
|---|-------|
| AC1.1 | Navigating to `/documents` without a session cookie redirects to `/login` with a `callbackUrl` query param. |
| AC1.2 | After login as `viewer`, the sidebar renders « Tableau de bord, Documents, Observations, Rapports, Paramètres » but does **not** render « Chat » or « Conflits ». |
| AC1.3 | After login as `editor`, the sidebar renders all items including « Chat » and « Conflits ». |
| AC1.4 | Navigating between two routes produces a Framer Motion fade/slide transition visible for ≥ 150ms; no layout shift. |
| AC1.5 | `GET /api/observations/manual` with a `viewer` session returns `403`; the same request with an `editor` session returns `200` (or `405` if body is missing). |

---

### Slice 2 — Document Upload & Pipeline Status

| # | Check |
|---|-------|
| AC2.1 | Selecting a 51 MB file in the upload picker shows an inline error « Fichier trop volumineux (max 50 Mo) » without calling `/api/uploads/init`. |
| AC2.2 | Uploading a valid PDF creates a document card in the Documents list immediately (optimistic) with status badge « Importé » before the SSE event fires. |
| AC2.3 | When `pipeline_stage_changed` SSE delivers `pipeline_status: "ocr_processing"`, the document card badge updates to « OCR en cours… » with an animated pulse within 200ms without a page reload. |
| AC2.4 | When `extraction_complete` SSE fires, a Sonner toast appears: « Document "[title]" traité — [n] observations extraites » and auto-dismisses after 5 seconds. |
| AC2.5 | The Dashboard `documents_by_status` bar renders correct counts for each stage; refreshing the page shows the same counts (server-rendered). |

---

### Slice 3 — Document Detail, Review Queue & Observation Approval

| # | Check |
|---|-------|
| AC3.1 | Opening `/documents/[id]` shows the first page image in the left pane and the observation list in the right pane; hovering an observation row highlights the corresponding bbox with a colored SVG rect on the page image. |
| AC3.2 | Clicking « Page suivante » loads the next page image and displays only the evidence blocks for that page in the overlay. |
| AC3.3 | In the Review Queue « Candidat » tab, clicking « Approuver » on a row calls `PATCH /api/observations/{id}/status` with `{ status: "approved" }`, optimistically moves the row to the « Approuvé » tab, and shows a success toast. |
| AC3.4 | In the « Rejeté » tab, clicking « Reconsidérer » calls `PATCH /api/observations/{id}/status` with `{ status: "candidate" }` and moves the row to the « Candidat » tab. |
| AC3.5 | The Observations list page filters by `?status=approved` correctly; changing the status filter updates the URL query param and re-fetches without a full page reload. |

---

### Slice 4 — Conflict Inbox & Manual Observation (Standalone)

| # | Check |
|---|-------|
| AC4.1 | The Conflict inbox lists each `ConflictCase` with the winning value (green border) and losing value (red border) displayed side-by-side, showing the source document title and `uploaded_at` for each. |
| AC4.2 | Clicking « Remplacer par cette valeur » on the losing observation shows a `ConfirmDialog`; confirming calls `POST /api/conflicts/{id}/resolve` and moves the conflict out of the unresolved list. |
| AC4.3 | When all conflicts are resolved, the page displays `EmptyState` with « Aucun conflit non résolu » and the `ConflictsBadge` in the sidebar disappears. |
| AC4.4 | The « + Ajouter manuellement » button on the Observations page opens `ManualObservationPopup`; submitting a valid form with `time_behavior = periodic` calls `POST /api/observations/manual` and the new observation appears in the list. |
| AC4.5 | Submitting the manual observation form with an empty `label` field shows the Zod validation error « Le libellé est requis » inline under the field without calling the API. |

---

### Slice 5 — Chat Interface & Report Generation

| # | Check |
|---|-------|
| AC5.1 | Sending a message in `/chat` shows a typing indicator (animated 3 dots via Framer Motion) while the SSE stream is open and the indicator disappears on `done` event. |
| AC5.2 | SSE `token` events stream the agent reply character-by-character into the active bubble without causing visible re-renders on previously sent messages (verify with React DevTools Profiler: historical bubbles show 0 renders during streaming). |
| AC5.3 | When `manual_obs_request` SSE fires: the chat input bar becomes disabled, a banner « En attente de votre saisie pour [label]… » appears, and `ManualObservationPopup` opens pre-filled with the `prefilled` payload. Refreshing the page within 10 minutes re-opens the popup (recovered from `sessionStorage`). |
| AC5.4 | When `report_ready` SSE fires, a card appears in the chat with the report title and « Voir le rapport » button; clicking it navigates to `/reports/[id]` and renders the report HTML in the sandboxed iframe without triggering a CSP violation in the browser console. |
| AC5.5 | On `/reports/[id]`, clicking « Regénérer » calls `POST /api/reports/{id}/regenerate` and the version history sidebar gains a new entry with an incremented version number; the iframe refreshes to the new report. |

---

### Slice 6 — Settings, Category Manager & User Management

| # | Check |
|---|-------|
| AC6.1 | Navigating to `/settings` as a `viewer` redirects to `/` with a toast « Accès non autorisé ». |
| AC6.2 | An `admin` user can invite a new user via `POST /api/users`; the user appears immediately in the table (optimistic); a server error rolls back the optimistic entry and shows `ErrorAlert`. |
| AC6.3 | Dragging a category node to a new sibling position in the tree updates the visual order immediately (optimistic); after 400ms debounce, `PATCH /api/categories/reorder` is called exactly once with the correct `ordered_ids` array. |
| AC6.4 | Creating a nested category 5 levels deep succeeds; attempting to create a 6th level shows an inline error « Profondeur maximale atteinte (5 niveaux) » without calling the API. |
| AC6.5 | Deleting a category that has children shows a modal prompting the user to reassign or delete children first; the delete call is not made until the user confirms a valid reassignment. |

---

### Slice 7 — Polish, Empty States & Onboarding

| # | Check |
|---|-------|
| AC7.1 | All 11 page routes display a `StatusSkeleton` matching the page's content shape during the loading state (verifiable by throttling the network in DevTools to Slow 3G and navigating to each page). |
| AC7.2 | On first login with no documents, the Dashboard shows the welcome card « Commencez par importer votre premier document » with an upload CTA; after uploading one document the card is replaced by the pipeline status summary. |
| AC7.3 | After the first successful extraction, a shadcn `Tooltip` attached to the sidebar « Conflits » link appears once with the text « Vérifiez et approuvez vos observations extraites. » and does not re-appear on subsequent logins (localStorage flag set). |
| AC7.4 | All visible user-facing strings are in French (spot-check: empty state texts, toast messages, form labels, navigation items, dialog CTAs); zero English strings appear in the UI during normal operation. |
| AC7.5 | The `ManualObservationPopup` is keyboard-navigable: Tab moves focus through all fields in order, Enter submits the form, Escape closes the dialog and calls `POST /api/manual-observations/pending/{pending_id}/skip`. |

---

## Appendix — Route → Component Map (Quick Reference)

| Route | RSC Shell fetches | Key Client Components |
|-------|-------------------|-----------------------|
| `/` | `GET /api/dashboard/summary` | `PipelineStageBadge`, `OnboardingProvider`, `NotificationBell` |
| `/documents` | `GET /api/documents`, `GET /api/categories` | `UploadFlow`, `PipelineSSEProvider`, `PipelineStageBadge`, `CategorySelect` |
| `/documents/[id]` | `GET /api/documents/{id}`, `GET /api/documents/{id}/blocks`, `GET /api/documents/{id}/observations` | `DocumentSplitView`, `PageImageViewer`, `BboxHighlight` |
| `/documents/[id]/review` | `GET /api/documents/{id}/observations` (per tab status) | `ReviewQueueTabs`, `ObservationReviewRow`, `ObservationEditForm`, `ManualObservationPopup` (standalone) |
| `/observations` | `GET /api/observations` | `ObservationCard`, `ObservationEditForm`, filter panel |
| `/conflicts` | `GET /api/conflicts` | `ConflictCard`, `ConfirmDialog` |
| `/reports` | `GET /api/reports` | filter bar, `PipelineStageBadge` (report status) |
| `/reports/[id]` | `GET /api/reports/{id}`, `GET /api/reports/{id}/versions` | `ReportIframe`, `ReportVersionSidebar`, `RegenerateButton` |
| `/chat` | `GET /api/chat/sessions` | `ChatInterface`, `ChatSSEProvider`, `ManualObservationPopup`, `ChatSessionSidebar` |
| `/settings` | `GET /api/users`, `GET /api/preferences` | user table, `ConfirmDialog` |
| `/settings/categories` | `GET /api/categories` | `CategoryTreeManager`, dnd-kit, `CategoryNodeForm` |
