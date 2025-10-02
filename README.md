# CrisisIntel – Raw SQL Social Feed Platform

A full‑stack demonstration platform featuring a lightweight social feed (posts, shares, comments, search, image uploads) built with:

- **Backend:** Django 5 (no ORM usage – every DB operation is hand‑written SQL via mysqlclient)  
- **Frontend:** React (Create React App) SPA consuming JSON endpoints  
- **Database:** MySQL (compatible fallback logic for SQLite in dev if needed)  

> Faculty focus: This project intentionally avoids ORMs to showcase direct SQL craftsmanship, security controls (token + header CSRF), and clear data flow between layers.

---
## 1. High‑Level Architecture

```
Browser (React SPA)
  |  fetch (JSON + tokens + CSRF header)
  v
Django Views (api/views.py)
  |  raw SQL helpers (api/db.py)
  v
MySQL (tables: users, auth_tokens, posts, post_comments, post_shares, ...)
```

Supporting utilities in `api/utils.py` centralize: authentication, CSRF validation, password hashing (PBKDF2), rate limiting hooks (extensible), auditing & (future) push notifications.

### Data Flow (Typical Request)
1. User logs in -> backend issues (auth token, csrf token) stored client‑side (localStorage).  
2. Frontend attaches `X-Auth-Token` + `X-CSRF-Token` on mutating requests.  
3. `@api_view` decorator validates method, token, and CSRF.  
4. View composes raw SQL and calls `query` / `execute`.  
5. Result marshalled to JSON (dicts/lists) and returned.  
6. Frontend updates UI state maps (e.g., unified feed, comments cache).  

---
## 2. Core Features & Pipeline

| Stage | Feature | Key Files | Notes |
|-------|---------|-----------|-------|
| Auth | Register/Login | `api/views.py` (`register`, `login`) | PBKDF2 hashing, 7‑day token expiry via SQL expression. |
| Feed | Unified posts + shares | `news_feed` | Single UNION query returns both types with `feed_type`. |
| Posts | Create/Edit/Delete | `create_post`, `post_item` | Body + optional image URL. Edited timestamp surfaced. |
| Shares | Share + edit/delete share note | `share_post`, `share_item` | Shares are independent feed items. |
| Comments | Add/Edit/Delete/List | `create_comment`, `comment_item`, `list_comments` | Comment counts pre‑aggregated for feed. |
| Search | LIKE search across three domains | `search` | Posts / doctors / hospitals (demo extra tables). |
| Stats | User content totals | `my_stats` | Counts own posts + shares. |
| Uploads | Image upload endpoint | `upload_image` | Stores under `MEDIA_ROOT/uploads/<user_id>/`. |

### Frontend Interaction Model
- `src/api.js` centralizes all HTTP calls (adds headers, emits events for auth & errors).  
- `Feed.jsx` renders unified feed and manages many UI state dictionaries (edit/compose toggles, inline caching).  
- Lightweight components: `NavBar`, `Toast` (global error/auth events), `RequireAuth` guard, plus pages for Register, Posts (simple CRUD view), Search.

---
## 3. Database Schema (Used Tables)

Essential tables (fields abbreviated to most relevant):

- `users(id, email, password_hash, full_name, role, status, created_at)`
- `auth_tokens(id, user_id, token, csrf_token, expires_at)`
- `posts(id, author_id, body, image_url, created_at, updated_at)`
- `post_comments(id, post_id, user_id, body, created_at, updated_at)`
- `post_shares(id, post_id, user_id, comment, created_at)`
- (Optional demo/search) `doctors`, `hospitals`

A separate audit/notifications concept is scaffolded (e.g., `audit_logs`, `notifications`) though not all UI features consume them yet.

### Why Raw SQL?
- Explicit control of joins & aggregation (e.g., single UNION feed query).  
- Transparent performance characteristics (easy to EXPLAIN / optimize).  
- Pedagogical clarity: Faculty can inspect every data access path.  

---
## 4. Security Model

| Aspect | Technique | Notes |
|--------|-----------|-------|
| Auth | Random 64‑hex token in `auth_tokens` | 7‑day expiry; looked up on each request. |
| CSRF | Per‑token `csrf_token` header (`X-CSRF-Token`) | Required for POST/PUT/DELETE/PATCH (except during DEV_OPEN). |
| Passwords | PBKDF2‑HMAC‑SHA256 (310k iterations + 16B salt) | Verifier also tolerates legacy Django hash format. |
| Input Lengths | `_limit_str` helper | Prevents unbounded text size. |
| SQL Injection | Parameter binding ONLY (`%s` placeholders) | No string concatenation with user text. |
| Uploads | Extension + size checks (≤5MB) | Production hardening: MIME sniff + virus scan. |
| Dev Relaxation | `DEV_OPEN` flag (if DEBUG) | Speeds iteration; must be off in production. |

---
## 5. Notable Queries

### Unified Feed (Excerpt)
```sql
SELECT * FROM (
  SELECT p.id post_id, NULL share_id, 'post' feed_type, p.created_at item_time,
         u.full_name actor_name, NULL share_comment, p.body, p.image_url,
         u.full_name original_author_name, p.created_at original_created_at,
         p.author_id post_author_id, p.updated_at post_updated_at,
         COALESCE(cc.comment_count,0) comment_count, NULL AS share_user_id
  FROM posts p
  JOIN users u ON u.id=p.author_id
  LEFT JOIN (SELECT post_id, COUNT(*) comment_count FROM post_comments GROUP BY post_id) cc ON cc.post_id=p.id
  UNION ALL
  SELECT p.id, s.id, 'share', s.created_at, su.full_name, s.comment, p.body, p.image_url,
         au.full_name, p.created_at, p.author_id, p.updated_at,
         COALESCE(cc.comment_count,0), s.user_id
  FROM post_shares s
  JOIN users su ON su.id=s.user_id
  JOIN posts p ON p.id=s.post_id
  JOIN users au ON au.id=p.author_id
  LEFT JOIN (SELECT post_id, COUNT(*) comment_count FROM post_comments GROUP BY post_id) cc ON cc.post_id=p.id
) t
ORDER BY t.item_time DESC
LIMIT 100;
```

### Token Insert
```sql
INSERT INTO auth_tokens(user_id, token, csrf_token, expires_at)
VALUES (%s, %s, %s, DATE_ADD(NOW(), INTERVAL 7 DAY));
```

---
## 6. Backend Layer Responsibilities

| File | Responsibility |
|------|----------------|
| `api/db.py` | Thin wrappers `query` + `execute` returning dict rows / lastrowid. |
| `api/utils.py` | Auth, CSRF, password hashing, rate limiting scaffold, auditing, push stubs. |
| `api/views.py` | All endpoint logic (no serializers / forms). |
| `api/urls.py` | Route mapping. |
| `settings.py` | Media config for uploads, optional `DEV_OPEN`. |

---
## 7. Frontend Structure

| File | Purpose |
|------|---------|
| `src/api.js` | Central fetch helper (headers, error events). |
| `pages/Feed.jsx` | Unified feed + complex state maps for editing/sharing/commenting. |
| `pages/Posts.jsx` | Simple CRUD interface for user's posts. |
| `pages/Register.jsx` | Account creation form. |
| `pages/Search.jsx` | Cross-entity LIKE search. |
| `components/NavBar.jsx` | Top navigation (hidden on unauth root path). |
| `components/Toast.jsx` | Global error/auth toast via CustomEvents. |
| `components/RequireAuth.jsx` | Route guard. |

---
## 8. Local Development Setup

### Prerequisites
- Python 3.10+
- MySQL server (or adjust ENGINE for SQLite test)
- Node.js 16+

### Backend
```bash
# (Windows PowerShell adapt as needed)
cd Backend/crisisintel
python -m venv venv
venv/Scripts/activate
pip install -r requirements.txt
# Configure database credentials in settings or env vars
python manage.py migrate  # (If using existing tables skip; else create minimal structure)
python manage.py runserver 8000
```
API base will be available at `http://localhost:8000/api/` (assuming project `urls.py` includes the api namespace).

### Frontend
```bash
cd Frontend/crisisintel
npm install
npm start
```
Runs on `http://localhost:3000` and proxies (if configured) or directly calls `/api/*` (adjust dev proxy or CORS as needed).

---
## 9. Endpoint Reference (Summary)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register/` | Create account (email, password, full_name, role). |
| POST | `/api/login/` | Authenticate, returns token + csrf_token + user. |
| GET | `/api/news_feed/` | Unified posts + shares feed (max 100). |
| POST | `/api/posts/` | Create post. |
| PUT/DELETE | `/api/posts/<id>/` | Update or delete own post. |
| POST | `/api/posts/<id>/share/` | Share post with optional note. |
| POST | `/api/posts/<id>/comments/` | Add comment to post. |
| GET | `/api/posts/<id>/comments/list/` | List comments. |
| GET | `/api/posts/<id>/shares/` | List shares for a post. |
| PUT/DELETE | `/api/shares/<id>/` | Edit/delete share note. |
| PUT/DELETE | `/api/comments/<id>/` | Edit/delete comment. |
| GET | `/api/search/?q=term` | Search posts/doctors/hospitals. |
| GET | `/api/my_stats/` | User post/share counts. |
| POST | `/api/upload_image/` | Authenticated image upload. |

All mutating calls must supply `X-Auth-Token` and `X-CSRF-Token` headers.

---
## 10. Frontend State Strategy (Feed)

Feeds often cause prop drilling and excessive renders. This implementation uses **flat keyed objects** for quick toggles and local optimistic edits:
- Example: `editPost[post_id]` presence = edit mode; clearing key exits mode.
- Avoids creating multiple component instances that retain stale closures.

---
## 11. Performance / Scalability Considerations

Area | Current | Future Improvement
-----|---------|-------------------
Feed Query | Single UNION + subselect counts | Add pagination (cursor by time / id). 
Comments | Loaded on demand per post | Preload count only (already done) + incremental fetch (infinite scroll). 
Images | Stored on filesystem | Move to object storage (S3/GCS) + signed URLs. 
Auth Tokens | Table lookup each request | Add in‑memory cache (Redis) + token revocation list. 
Search | LIKE scans | Add FULLTEXT or external search engine (Meilisearch/Elastic). 
Rate Limiting | In‑memory deque | Redis token bucket for multi‑process deployment. 

---
## 12. Testing Strategy (Recommended Additions)
(Outline – to be implemented if extended)
- Unit: password hashing/verification, feed query shape.
- Integration: login flow, create/edit/delete post -> reflected in feed.
- Frontend: component tests for Feed editing flows; msw to mock API.

---
## 13. Deployment Notes
- Serve Django via ASGI (uvicorn/daphne) behind Nginx; static/media via Nginx.  
- Configure environment variables for DB creds, DEBUG=False, DEV_OPEN=False.  
- Add CORS headers or same-origin configuration for SPA hosting.  
- Use process manager (systemd / supervisor) or containerize (Dockerfile multi-stage).  

---
## 14. Limitations / Known Trade‑offs
- No pagination (feed limited to 100 items).  
- No user relationships (follow graph) – everyone sees global feed.  
- No websocket real-time updates wired yet (notify stubs exist).  
- Minimal validation (could enforce richer constraints).  
- No explicit migration scripts here (assumes pre‑existing schema or manual init).  

---
## 15. Future Enhancements
1. Real-time feed updates via Channels groups.  
2. Likes/Reactions table and aggregation.  
3. Content moderation workflow (flags, audit UI).  
4. Rich text / markdown with sanitized rendering.  
5. Background tasks (Celery) for image processing / notifications.  
6. Structured logging + metrics (OpenTelemetry).  
7. Full test suite + CI pipeline.  

---
## 16. Faculty Presentation Cheat Sheet
- Emphasize explicit SQL (show `news_feed` UNION query).  
- Highlight security pairing: token auth + per-request header CSRF.  
- Point out modular separation: `api/utils.py` (cross-cutting) vs `api/views.py` (pure endpoint logic).  
- Show frontend `api.js` -> consistent error & auth event model (decouples UI).  
- Discuss state dictionaries in `Feed.jsx` as a pragmatic alternative to complex component trees.  
- Explain extensibility roadmap (pagination, real-time, caching).  

---
## 17. License / Attribution
Internal academic demo – no external license declared.

---
## 18. Quick Start (TL;DR)
```bash
# Backend
cd Backend/crisisintel
python -m venv venv
venv/Scripts/activate
pip install -r requirements.txt
python manage.py runserver 8000

# Frontend (separate shell)
cd Frontend/crisisintel
npm install
npm start
```
Login -> create/share/comment -> view unified feed.

---
**End of README**

---
## Phase 2 Extension: Blood Requests & Donor Recruitment

### Purpose
Enables hospitals to publish blood requests and social organizations / blood banks to recruit donors. Regular users apply as potential donors; owners manage application statuses. All implemented with raw SQL (no ORM) consistent with project standards.

### New Tables (part2_schema.sql)
| Table | Key Fields | Notes |
|-------|-----------|-------|
| `blood_requests` | hospital_user_id, blood_type, quantity_units, needed_by, status | Created by hospital accounts. |
| `blood_donor_recruit_posts` | owner_user_id, (optional) blood_request_id, target_blood_type, scheduled_at, status | Created by social_org or blood_bank. |
| `blood_donor_applications` | recruit_post_id, donor_user_id, availability_at, status | Enforces single application per donor per post. |

Blood types validated against fixed set: A+/A-/B+/B-/O+/O-/AB+/AB-.

### Status Lifecycle
| Entity | Status Values |
|--------|---------------|
| blood_requests | open, fulfilled, cancelled |
| recruit_posts | active, closed |
| donor_applications | pending, accepted, rejected, attended |

### Endpoints (Phase 2)
| Method | Path | Role / Access | Description |
|--------|------|--------------|-------------|
| POST | `/api/blood/requests` | hospital | Create blood request. |
| GET | `/api/blood/requests/list` | public | List (filters: blood_type, status, hospital_id). |
| GET | `/api/blood/requests/<id>` | public | Detail. |
| PUT | `/api/blood/requests/<id>/update` | owning hospital | Update fields/status (also see status endpoint). |
| POST | `/api/blood/requests/<id>/status` | owning hospital | Set status (open/fulfilled/cancelled). |
| POST | `/api/blood/recruit` | social_org / blood_bank | Create recruit post. |
| GET | `/api/blood/recruit/list` | public | List recruit posts (filters: blood_type, status). |
| GET | `/api/blood/recruit/<id>` | public | Detail. |
| PUT | `/api/blood/recruit/<id>/update` | owner | Update post fields/status. |
| POST | `/api/blood/recruit/<id>/close` | owner | Close post (sets status=closed). |
| POST | `/api/blood/recruit/<id>/apply` | regular user | Apply as donor (unique). |
| GET | `/api/blood/recruit/<id>/applications` | owner | List donor applications. |
| POST | `/api/blood/applications/<id>/status` | owner | Change application status. |
| GET | `/api/blood/my-applications` | donor user | List own applications. |
| GET | `/api/blood/overview` | public | Aggregate open requests by blood type. |

### Notifications
| Event | Trigger | Payload |
|-------|---------|---------|
| donor_applied | Donor applies to recruit post | application_id, post_id |
| application_status | Owner updates application | application_id, status |

### Future Enhancements (Deferred)
1. Link accepted donor -> decrement outstanding quantity on related `blood_requests`.
2. Geolocation & proximity filtering.
3. Donor eligibility checks (cooldown period, health screening flags).
4. Audit / analytics (avg fulfillment time by blood type). 
5. Soft delete & archival of fulfilled/closed entities.


---
## Phase 3 Extension: Campaigns (Mobilization & Resource Coordination)

### Purpose
Provides a generic, extensible mechanism for organizational users (hospital, social_org, fire_service, blood_bank, admin) to launch multi‑participant initiatives: e.g. blood drives, relief distribution, volunteer training, fundraising, or joint emergency response preparations.

### Tables (part3_schema.sql)
| Table | Key Fields | Notes |
|-------|-----------|-------|
| `campaigns` | owner_user_id, title, description, campaign_type, status, starts_at, ends_at, target_metric, target_value, current_value | Status workflow with life‑cycle transitions. |
| `campaign_participants` | campaign_id, user_id, role_label, status, joined_at | Unique (campaign_id, user_id); status/role managed by owner. |

Status Workflow (campaigns.status): `draft -> active -> (completed | cancelled)`
| From | Allowed Transitions |
|------|--------------------|
| draft | active, cancelled |
| active | completed, cancelled |
| completed | (none) |
| cancelled | (none) |

Participants (campaign_participants.status): accepted, rejected, withdrawn (initial join is auto `accepted`; owners may later modify). Rejected / withdrawn participants remain for auditing.

### Endpoints (Phase 3)
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/campaigns` | org roles | Create campaign (status=draft). |
| GET | `/api/campaigns/list` | public | List campaigns (drafts only visible to owner). Filters: status, campaign_type, owner, q. |
| GET | `/api/campaigns/<id>` | public/owner | Detail (draft restricted to owner). |
| PUT | `/api/campaigns/<id>/update` | owner | Update mutable fields (not allowed once completed/cancelled). |
| POST | `/api/campaigns/<id>/status` | owner | Change status respecting transition rules. |
| POST | `/api/campaigns/<id>/join` | any user | Join active campaign (owner cannot rejoin themselves). |
| POST | `/api/campaigns/<id>/withdraw` | participant | Withdraw from campaign. |
| GET | `/api/campaigns/<id>/participants` | owner/ public | Owner sees all; public sees only accepted. Draft restricted. |
| POST | `/api/campaigns/<id>/participants/<participant_id>/status` | owner | Update participant status (accepted/rejected/withdrawn). |
| GET | `/api/campaigns/mine` | owner | List campaigns created by current user. |
| GET | `/api/campaigns/my-participations` | participant | List campaigns the user has joined (with participation status). |

### Design Notes
1. No foreign key constraints (consistent with earlier phases) to maintain rapid iterative flexibility. Add later for integrity.
2. Draft privacy: enforced in both list and detail queries.
3. Re‑join logic: If a user previously withdrew, a fresh join reactivates them (status back to accepted).
4. Target tracking: `current_value` can be incremented via future specialized endpoints (e.g., recording donations, volunteer hours). Present update path allows owner to adjust manually.
5. Indexing: status, owner, type, created_at for list performance; participant lookups by campaign and user.

### Example Creation Payload
```json
{
  "title": "City Center Blood Drive",
  "description": "Collecting O+ and A+ units for regional shortage.",
  "campaign_type": "blood_drive",
  "starts_at": "2025-09-20T09:00:00",
  "ends_at": "2025-09-20T16:00:00",
  "location_text": "Community Hall",
  "target_metric": "units",
  "target_value": 120
}
```

### Future Enhancements (Campaigns)
1. Progress auto-calculation from domain events (e.g., accepted donors -> increment units).
2. Soft delete & archival window (history browsing / analytics).
3. Rich role taxonomy (lead, logistics, medic) with permission differentiation.
4. Timeline / activity log (joins, status changes) for transparency.
5. Public share tokens enabling external volunteer sign-up forms.
6. Geo-tag & bounding box filter for regional coordination.


---
## Phase 1 Extension: Organizational Roles & Appointments

This phase introduces preliminary multi-role healthcare coordination primitives while preserving the original social feed core. All additions continue using raw SQL only.

### New / Adjusted Concepts
| Concept | Description |
|---------|-------------|
| Organization Roles | `hospital`, `social_org`, `fire_service`, `blood_bank`, `admin` (single global account each). |
| Registration Flow | Org role registrations (except first `admin`) start with `status='pending'` requiring admin approval. |
| Doctors | Not a separate role; any active user can be linked as a doctor to one or more hospitals via membership table. |
| Membership | `hospital_doctors(hospital_user_id, doctor_user_id, created_at)` defines doctor presence per hospital. |
| Schedules | `doctor_schedules(doctor_user_id, hospital_user_id, weekday, start_time, end_time)` defines weekly availability blocks. |
| Appointments | `appointments(patient_user_id, doctor_user_id, hospital_user_id, starts_at, ends_at, status)`; basic booking + conflict prevention. |
| Notifications | `_notify` hook invoked on appointment creation (stub for future real-time push). |

### New Tables (part1_schema.sql)
Simplified (foreign keys may be commented for portability):
```
hospital_doctors(hospital_user_id, doctor_user_id, created_at)
doctor_schedules(id, doctor_user_id, hospital_user_id, weekday TINYINT, start_time TIME, end_time TIME, created_at)
appointments(id, patient_user_id, doctor_user_id, hospital_user_id, starts_at DATETIME, ends_at DATETIME, status VARCHAR, created_at)
```

### Updated Registration Behavior
- Multiple organization accounts ARE allowed for: `hospital`, `social_org`, `fire_service`, `blood_bank`, `admin` (all auto `active`).
- Submitting `role='doctor'` is normalized to `regular` (doctors are defined by membership, not intrinsic role).

### Phase 1 Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/hospitals/<hospital_id>/doctors/add` | Add doctor membership (hospital self or admin). |
| POST | `/api/hospitals/<hospital_id>/doctors/remove` | Remove doctor membership. |
| GET | `/api/hospitals/<hospital_id>/doctors` | Public list of hospital doctors. |
| POST | `/api/hospitals/<hospital_id>/schedule/add` | Add doctor schedule block. |
| GET | `/api/doctors/<doctor_id>/schedule` | List doctor schedule blocks across hospitals. |
| POST | `/api/appointments/book` | Patient books appointment (validates membership & conflicts). |
| GET | `/api/appointments/mine` | Current user's booked appointments. |
| GET | `/api/appointments/doctor` | Doctor (any user with membership) views their appointments. |

### Booking Conflict Logic
Simple overlap detection rejects booking if any existing appointment for the doctor overlaps the requested window: `(starts_at < new.ends_at AND ends_at > new.starts_at)`.

### Next Planned Phase (Preview)
Blood requests & inventory coordination building atop organizational roles; richer notifications and activity streams.

---
