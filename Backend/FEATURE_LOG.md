# Project Feature Log

_Last updated: 2025-09-17 (later)_

This document is the authoritative snapshot of planned vs implemented functionality. Update this FIRST before implementing or dropping a feature. Each entry matches an internal backlog ID.

## Legend
- ✅ Implemented
- 🚧 Not Started / Pending
- 💤 Deferred (not in active scope)
- ❌ Dropped (explicitly will not implement now)

## Core & Accounts
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 2 | User roles & account model | ✅ | Roles: admin, regular, hospital, social_org, fire_service, blood_bank, doctor. |
| 3 | Role uniqueness & approval | ❌ | Dropped per user; no enforced single org account workflow now. |
| 4 | Doctor multi-hospital scheduling | ✅ | Schedules + association implemented. |
| 5 | Appointment booking system | ✅ | Booking + conflict detection present. |
| 40 | Hospital doctor association mgmt | ✅ | Add/remove doctor link endpoints done. |
| 41 | Doctor notification preferences | 🚧 | Phase1 breadth: basic toggle table + get/set endpoints (full notification integration later). |

## Social / Content
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 6 | Post media attachments | ✅ | Scope accepted: single image via `image_url`. Multi-attachment deferred (would require `posts_media`). |
| 7 | Post likes feature | ❌ | Dropped. |
| 8 | Post comments feature | ✅ | Basic comment CRUD present (per user confirmation). |
| 9 | Post share feature | ✅ | Share tracking implemented (per user confirmation). |

## Blood & Donor Domain
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 10 | Blood donor direct requests | ✅ | Direct requests + responses (create/list/respond/accept/decline/fulfill) implemented 2025-09-17. |
| 11 | Blood donor recruitment & applications | ✅ | Posting + applications workflow done. |
| 12 | Donor profile management | ✅ | donor_profiles table + upsert/search endpoints (Feature 12) implemented 2025-09-17. |

## Campaigns
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 13 | Campaigns multi-location support | 🚧 | Phase1 breadth: campaign_locations table + add/list endpoints. |

## Fire Service
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 14 | Fire service teams & inventory | 🚧 | Phase1 breadth: fire_teams + fire_inventory CRUD endpoints (no assignment logic yet). |
| 15 | Nearest fire dept assignment workflow | 🚧 | Candidate-based (manual acceptance) backend core in progress; initial candidate generation & accept/decline endpoints implemented 2025-09-17. Frontend + multi-candidate escalation TBD. |
| 16 | Fire service employee management | 🚧 | Phase1 breadth: fire_staff add/list/remove endpoints (role/status minimal). |

## Emergency Events & Resources
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 17 | Emergency events core | 🚧 | `events` table (type, timeframe, area, status). |
| 18 | Org participation requests | 🚧 | Invitation + status per org. |
| 19 | Event hospital resources | 🚧 | Beds, doctors allocated. |
| 20 | Event blood bank resources | 🚧 | Donors/units capacity. |
| 21 | Event fire service resources | 🚧 | Deployed teams/inventory linking. |
| 22 | Event social org resources | 🚧 | Supplies/volunteers lines. |
| 23 | Food donation tracking | 🚧 | Phase1 breadth: food_donations table + create/list endpoints. |
| 24 | User location tracking | 🚧 | `user_locations` last known record. |
| 25 | Victim management & allocation | 🚧 | `victims` + allocation mappings. |
| 26 | Victim self-application & booking | 🚧 | Flows & capacity checks. |

## Intelligence / AI / Automation
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 27 | NLP hazard detection stub | 🚧 | Background keyword scan producing suggestions. |
| 28 | User chatbot companion stub | 🚧 | Placeholder `/chatbot/message`. |
| 29 | Hospital AI triage stub | 🚧 | Rule-based specialty suggestion endpoint. |

## Notifications & Messaging
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 30 | Notification type filter | ❌ | Dropped. |
| 31 | Notification expansion design | 🚧 | Map triggers for appointments, blood, events. |
| 42 | Direct user messaging | 🚧 | `conversations`, `messages` tables + send/list endpoints. |

## Geo & Infrastructure
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 32 | Geo capability prerequisites | ✅ | Added user_locations table, lat/lng indexes, update & nearby endpoints. |
| 33 | Nearest calculations utilities | ✅ | Haversine Python helper implemented for fire request candidate generation (Feature 15 dependency) 2025-09-17. |
| 42 | Direct user messaging | 🚧 | Added inbox, direct send, full history, notifications & incremental polling endpoints (no groups / websockets). |
| 35 | Observability minimal metrics | 🚧 | api_metrics table + basic middleware logging path/method/status/duration (2025-09-17 breadth). |

## Platform & Ops
| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| 34 | Extended rate limiting | ❌ | Dropped. Login limiter only. |
| 35 | Observability minimal metrics | 🚧 | `api_metrics` + middleware. |
| 36 | Media storage backend | 🚧 | Decide path vs object storage stub. |
| 37 | Admin dashboard endpoints | 🚧 | Aggregated stats & pending approvals. |
| 38 | Demo seed script | 🚧 | Management command scaffolding. |
| 39 | README & run guide | 🚧 | Provide setup + migration instructions. |

## Implementation Ordering Recommendation (Current)
1. README & run guide (39) – provides onboarding clarity.
2. Donor profile management (12) + Blood donor direct requests (10).
3. Geo prerequisites (32) + Nearest utilities (33) then Nearest fire dept auto-assignment (15).
4. Direct user messaging (42).
5. Emergency events core (17) and incremental resource modules (19–23,25–26,18).
6. Notification expansion (31) to wire new triggers (after events foundations exist).
7. Remaining fire service & inventory (14,16,21).
8. Media storage backend (36) – revisit for scalability/security (single-image already working).
9. Observability metrics (35) and Admin dashboard (37).
10. AI / NLP stubs (27–29) for demo polish.
11. Demo seed script (38) final.

## Frontend Coverage Snapshot (Early React App Status)
| Domain / Feature | Backend Status | Frontend Status | Notes |
|------------------|----------------|-----------------|-------|
| Auth & Roles (2) | ✅ | ✅ | Basic login/register & token handling present. |
| Feed (posts list) | ✅ | ✅ | Consumes news feed endpoint. |
| Create/Update/Delete Post (6) | ✅ | ✅ | Single image upload supported; edit/delete present. |
| Comments (8) | ✅ | ✅ | Basic comment form & list. |
| Shares (9) | ✅ | ✅ | Share action wired. |
| Appointments (5) | ✅ | ❌ | No UI yet for booking / viewing schedules. |
| Doctor Scheduling (4) | ✅ | ❌ | No calendar/slot management UI. |
| Blood Recruitment & Applications (11) | ✅ | ❌ | Missing list/apply/approve components. |
| Donor Profiles (12) | ✅ | ❌ | Backend implemented; UI form & viewer pending. |
| Blood Direct Requests (10) | ✅ | ❌ | Backend implemented; UI pending. |
| Notifications (basic) | ✅ | ❌ | Need notifications center & mark-read. |
| Geo / Nearest (32/33/15) | 🚧 | ❌ | Not started. |
| Fire Service Requests / Teams (14–16) | 🚧 | ❌ | Not started. |
| Emergency Events (17–23,25–26,18) | 🚧 | ❌ | Not started. |
| Messaging (42) | 🚧 | ❌ | No backend yet; plan chat UI scaffold later. |
| Media Storage Enhancement (36) | 🚧 | ❌ | Current UI fine for single file; future multi-upload component deferred. |
| Observability / Admin (35,37) | 🚧 | ❌ | Admin dashboards not present. |
| AI / NLP Stubs (27–29) | 🚧 | ❌ | Future placeholder components. |
| README Guidance (39) | 🚧 | ❌ | Frontend onboarding doc incomplete. |

Frontend priorities should parallel reordered implementation list: first add donor profile & blood flows, then appointments UI, then notifications center, followed by messaging scaffold.

## Change Log
- 2025-09-16: Initial FEATURE_LOG.md created; features categorized; drops recorded (IDs 3,7,30,34).
- 2025-09-17: Marked Feature 6 implemented under single-image scope; reordered implementation list removing now-complete item; added Frontend Coverage Snapshot section.
- 2025-09-17: Implemented Donor Profile Management (Feature 12) with donor_profiles table & endpoints.
- 2025-09-17: Implemented Blood Donor Direct Requests (Feature 10) with tables blood_direct_requests & blood_direct_request_responses and related endpoints.
- 2025-09-17: Added fire_request_candidates table + candidate generation & accept/decline endpoints (Feature 15 partial, utilizing Feature 33 utilities). Marked Feature 33 utilities complete; Feature 15 now a candidate workflow (manual acceptance) awaiting escalation & frontend.
- 2025-09-17: Breadth stubs added: messaging (conversations, participants, messages) and metrics middleware (api_metrics) plus simple events create/list endpoints (Features 42, 35, 17 partial).
- 2025-09-17: Added seed_demo management command (Feature 38 partial) and basic /api/dashboard endpoint (Feature 37 partial) for summary metrics.
- 2025-09-17: Unread messaging support added (Feature 42 extension) with last_read_message_id, unread counts in inbox & updates, mark-read endpoint, dashboard messages_unread.
- 2025-09-17: Phase1 breadth endpoints added (Features 13,14,16,41,23 partial) – campaign locations, fire teams/inventory/staff, doctor prefs, food donations.

---
Maintain this file with each feature change (add a dated bullet under Change Log).
