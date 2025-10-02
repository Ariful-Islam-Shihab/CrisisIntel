# Project Roadmap (Backend + Frontend Integrated)

Last Updated: 2025-09-17

This roadmap defines a breadth-first completion strategy followed by depth and polish. Each phase lists backend (B) and frontend (F) tasks, mapped to FEATURE_LOG IDs where applicable. The goal: reach a fully navigable demo covering every declared domain with minimal viable functionality, then iterate on advanced workflows.

## Guiding Principles
1. Breadth before depth – ensure every advertised domain has a working UI + API surface.
2. Idempotent raw SQL migrations – additive, minimal, no destructive changes mid-phase.
3. Lean endpoints – CRUD + essential actions only in breadth phase; defer analytics & automation.
4. Deterministic seeding – seed script extended each phase for demo reproducibility.
5. Observability early – metrics + dashboard ensure visibility as complexity grows.

## Phase Overview
| Phase | Goal | Key Domains | Exit Criteria |
|-------|------|-------------|---------------|
| 0 | Baseline (DONE) | Users, Posts, Comments, Shares, Direct Requests, Messaging (unread), Fire Request candidates, Seed, Dashboard | All implemented & tested. |
| 1 | Remaining Core Entities | Campaign locations, Fire teams/inventory/staff, Doctor prefs, Food donations, User locations finalize | Tables + basic CRUD endpoints + minimal React pages/slices. |
| 2 | Events & Resources Foundation | Events, Participants, Resource commitment tables, Victims & allocations | Create/list endpoints; victims self-apply; simple event detail composition on frontend. |
| 3 | Intelligence Stubs | Hazard scan, Chatbot, Triage | Stub endpoints returning deterministic mock payloads; simple UI forms. |
| 4 | Notification Expansion & Metrics Rollup | Event participation, resource commits, victim allocation notifications; daily metrics summary | New triggers firing notifications + metrics summary endpoint & UI. |
| 5 | Dashboard & Seed Enhancement | Richer dashboard + expanded seed data | Dashboard surfaces new domain counts; seed covers events, victims, teams, resources. |
| 6 | Media & Config Polishing | Media config placeholder, minor UX consolidation | Config endpoint + frontend surfaces upload limits; unify styles. |
| 7 | Depth Iterations | Fire escalation, group messaging, advanced analytics | Prioritized by demo/user feedback. |

## Detailed Phases

### Phase 1 – Remaining Core Entities (Backend Focus IDs: 13, 14, 16, 23, 24, 41)
Backend:
- Add tables: `campaign_locations`, `fire_teams`, `fire_inventory`, `fire_staff`, `doctor_notification_prefs`, `food_donations`.
- Ensure `user_locations` endpoint (confirm create / latest retrieval) – if missing add `/api/locations/update` & `/api/locations/mine`.
- Endpoints:
  - POST/GET campaign/:id/locations
  - Fire dept: list/add teams, list/add inventory items, add/remove staff
  - Doctor: get/update notification prefs
  - Food donations: create, list (filter by status/event optional placeholder)
Frontend:
- New pages/components: Campaign Locations (embedded in Campaign placeholder), Fire Management (teams + inventory tabs), Doctor Prefs toggle, Food Donations list/create form, Location updater button.
Exit Criteria: All endpoints reachable from UI, seed adds 1 fire team + 1 inventory item + 1 food donation.

### Phase 2 – Events & Resources (IDs: 17–22, 25–26, 18)
Backend:
- Tables: event_participants, event_hospital_resources, event_blood_resources, event_fire_resources, event_social_resources, victims, victim_allocations.
- Event endpoints: create, list, add participant (request), respond (accept/decline), add each resource type, list resources by event.
- Victim endpoints: self-apply, list (admin), allocate to hospital.
Frontend:
- Events page: list + create form; drawer/modal to add participants & resources (stubbed simple forms).
- Victim page: self-apply form + admin list with allocate action (drop-down hospital selection placeholder).
Exit: Event detail view aggregates participants & resources; victim self-apply visible; seed adds 1 event & at least one resource per type.

### Phase 3 – Intelligence Stubs (IDs: 27–29)
Backend:
- `/api/hazard/scan` POST {text} -> returns static keywords + risk score.
- `/api/chatbot/message` POST {message} -> returns canned reply + next_suggestions.
- `/api/triage/assess` POST {symptoms} -> returns triage_level + suggested_specialty.
Frontend:
- Intelligence page with three panels/forms invoking above.
Exit: All three stubs callable; responses rendered nicely.

### Phase 4 – Notifications & Metrics (IDs: 31, 35)
Backend:
- Extend notification triggers: on participant request, resource commit, victim allocation.
- Daily metrics rollup table `api_metrics_daily` (date, path, count, avg_ms, p95_ms) + nightly aggregation fallback endpoint `/api/metrics/summary` building on demand if missing.
Frontend:
- Notifications center badge increments; metrics page charts (simplified tables initially).
Exit: Trigger actions create notifications; metrics summary returns aggregated rows.

### Phase 5 – Dashboard & Seed Enhancement (IDs: 37, 38, 39 augment)
Backend:
- Dashboard additional fields: events_open, victims_pending, donations_open, participants_pending.
- Seed script: populate event, participants, victims, resource entries, doctor prefs sample.
Frontend:
- Dashboard cards updated; quick links to drill-down pages.
Exit: Fresh seed gives immediately rich dashboard snapshot.

### Phase 6 – Media & Config (ID: 36)
Backend: `/api/media/config` -> { max_image_mb, allowed_types }.
Frontend: Settings / Upload component reads config.
Exit: Media config endpoint documented & consumed.

### Phase 7 – Depth Iterations (Post-Breadth)
Candidates: Fire escalation logic, group chat, unread per-conversation stream optimization (websocket later), AI refinement, resource capacity analytics.

## Cross-Cutting Concerns
- Auth: Existing token scheme reused; add lightweight hook in frontend `api/client.js`.
- Error Model: Continue `{ error: code }` pattern; add `detail` only for debugging (avoid leaking internals).
- Notifications: Future improvement to batch/paginate; keep simple triggers now.
- Testing: Each phase adds at least one integration test per new domain.

## Recommended Immediate Start
Proceed with Phase 1 (Remaining Core Entities). Rationale: unlocks visible breadth (fire management, campaign geo, preferences) with low complexity and minimal coupling, setting stage for events/resources.

## Acceptance Criteria Summary
| Feature ID | Breadth Acceptance (Done When) |
|------------|--------------------------------|
| 13 | Can add/list campaign locations via API + basic UI list. |
| 14 | Fire dept can add/list teams & inventory items. |
| 16 | Fire dept can add/remove staff entry. |
| 23 | Food donation created & appears in list with status open. |
| 24 | User can update location; latest retrieval returns record. |
| 41 | Doctor toggles appointment notifications (stored). |
| 17–22 | Event detail aggregates participants & each resource list. |
| 25–26 | Victim self-apply creates record; admin can allocate to hospital. |
| 27–29 | Each stub returns deterministic payload; UI renders result. |
| 31 | Notifications appear for at least 3 new trigger types. |
| 35 | Metrics summary shows aggregated count & latency stats. |
| 36 | Media config endpoint returns allowed types & displayed in UI. |
| 37 | Dashboard exposes all domain counts. |
| 38 | Seed populates at least one instance of every breadth table. |
| 39 | README documents all pages & endpoints mapping. |
| 42 | (Breadth complete) Direct messaging with unread counts & read marker. |

## Risk & Mitigation
- Schema Drift: Keep each migration additive and idempotent (IF NOT EXISTS guards). Maintain ordering in raw migration runner.
- Test Flakiness (polling): For messaging & notifications, allow small waits or query loops capped to avoid timing false negatives.
- Scope Creep: Any enhancement beyond table + simple CRUD defers to Phase 7 unless it unblocks another phase.

## Metrics to Watch (Post Phase 4)
- P95 message send -> inbox update latency (manual manual for now).
- Event participation pending count.
- Victim allocation turnaround (time from creation to allocation).

---
Next Action (pending approval): Implement Phase 1 migrations + endpoints + minimal React components scaffold.
