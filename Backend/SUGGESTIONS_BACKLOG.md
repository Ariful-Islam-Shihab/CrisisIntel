# Project Backlog & Suggestions

A living, categorized backlog capturing future enhancements, technical debt, polishing tasks, and strategic expansions. Update this file whenever new ideas surface so nothing is lost.

---
## Prioritized Next Candidates (Top 5)
1. Geo capabilities: store & query lat/lng with radius or bounding-box filters for fire requests, incidents, campaigns.
2. Extend rate limiting coverage (now that login implemented): apply to create_post, share_post, create_comment, incident mutations; add config constants.
3. Index & performance tuning pass (add suggested covering indexes, verify query plans).
4. Notification filtering & preferences (type filter, mute table) + websocket replay.
5. Cursor pagination mode (since_id / before_id unification) for high-churn feeds (notifications, incident_events) backed by composite indexes.

---
## Functional Enhancements
- Fire Service:
  - Add evidence/photos upload for resolved fire requests (reuse image upload logic, new table `fire_request_media`).
  - Add filtering by `assigned_department_id` and time range.
  - SLA timers: track time to assignment & resolution metrics.
- Blood Coordination:
  - Matching suggestions: donors who applied before with compatible blood type.
  - Automatic status transition to `fulfilled` when linked recruit post reaches threshold (if target metric defined).
- Campaigns:
  - Audit trail of status transitions (new `campaign_status_history`).
  - Soft delete or archive mechanism.
  - Metric auto-increment hooks (e.g., participant accepted increments `current_value` when metric is volunteers).
- Appointments:
  - Cancellation & reschedule endpoints with conflict validation.
  - Doctor unavailability exceptions (vacations / blackout dates table).
- Social Feed:
  - Post search relevance scoring (term frequency) with simple ranking.
  - Content moderation flags and queue.

---
## Cross-Cutting Domains
- Unified Incident Model (CORE DELIVERED):
  - (DONE) `incidents`, `incident_events`, `incident_participants` tables + endpoints (create/list/get/status/note/join/withdraw/events/participants).
  - (NEXT) Link fire requests & future EMS into incidents via referencing (add `source_table`, `source_id` or dedicated mapping table).
  - (NEXT) Add soft close summary & metrics snapshot row.
- Notification System Expansion:
  - (DONE) Basic list + mark read / mark all endpoints + `is_read` migration.
  - (NEXT) Add query param `type=` and compound filter unread+type.
  - (NEXT) Add push batching / digest for high volume.
  - (NEXT) Per-type mute / preference table `notification_prefs`.
  - (NEXT) Websocket reconnection replay (since_id param).
- User Roles & Permissions:
  - Role delegation: allow admin to grant temporary sub-permissions.
  - Role-based rate limits.

---
## API Quality & Consistency
- Standardized error codes catalog (central enum mapping).
- (DONE) Consistent pagination pattern: `?page=` and `?page_size=` with max cap across core list endpoints.
- Introduce cursor pagination option for large or frequently updated feeds.
- Introduce optimistic concurrency (updated_at check) for mutable heavy objects (campaigns, requests).
- Input validation layer abstraction to reduce boilerplate (mini schema validator).

---
## Testing & Tooling
- Expand end-to-end tests: add negative cases (permission denial, invalid transitions).
- Add smoke test for image upload path.
- Introduce load test scripts (locust or k6) targeting high-churn endpoints.
- Test notification fan-out: mock Channels layer or add direct DB assertions on `notifications` table.

---
## Performance
- Add covering indexes for frequent filters: `(status, created_at)` on `fire_service_requests`, `(blood_type, status)` on `blood_requests`, `(campaign_id, status)` on participants.
- Introduce simple caching (in-memory) for `list_fire_departments` and campaign listings.
- Batch inserts for notification floods (grouped writes).

---
## Observability
- Lightweight request metrics: duration & count per endpoint (simple middleware writing to `api_metrics` table).
- Error log aggregation table with structured context (path, error_code, trace snippet hash).

---
## Security & Hardening
- (PARTIAL DONE) Brute force guard for login using `_rate_limited` + DB-backed `rate_limits` table (basic fixed window) implemented; future: exponential backoff.
- Enforce password strength server-side (length & character class heuristic).
- Add API key support for trusted machine-to-machine clients (separate table `api_clients`).
- CSRF audit headers: return `X-CSRF-Expected: true` when mutation attempted without token.

---
## Data Lifecycle & Integrity
- Purge or archive old resolved fire requests beyond retention window.
- Add soft delete (status column) rather than hard delete for posts & comments.
- Implement data export endpoint for user (account portability / compliance readiness).

---
## Developer Experience
- Generate a consolidated OpenAPI-ish JSON (hand-built) for frontend reference.
- Add `make`-like PowerShell script with common tasks (reset DB, run tests, load sample data).
- Pre-commit lint hooks (even if minimal sanity checks, e.g., trailing whitespace cleanup or JSON schema validation for config snippets).

---
## Frontend Alignment (Future Considerations)
- Provide lightweight `/api/me` endpoint for session bootstrap (cache user state, roles).
- Add websocket event examples / subscription documentation for notifications.

---
## Migration & Schema Strategy
 - (DONE) Management command `apply_raw_sql` to apply ordered raw SQL migrations with hash tracking.
 - (DONE) Versioned raw SQL migration directory using partX_* naming (schema.sql base + incremental parts).
 - Add integrator script to diff current DB vs expected for CI alerting.
 - Future: Add `--since <filename>` and `--verify` modes plus checksum drift alert.

---
## Long-Term Strategic Ideas
- Add EMS / Medical emergency requests similar to fire (shared incident core).
- Volunteer credentialing / verification workflow.
- Resource inventory management (beds, vehicles, equipment) linked to campaigns/incidents.
- Analytics dashboards (materialized summary tables refreshed periodically).

---
## Backlog Management Guidelines
- Keep each new item atomic & tagged (domain, type: feature/tech-debt/perf/security).
- Promote items into the "Prioritized Next" section only when ready for execution.
- Prune or merge stale ideas quarterly.

---
_Last updated: 2025-09-16 (after adding login rate limiting, part5 migration & raw SQL migration automation command)_
