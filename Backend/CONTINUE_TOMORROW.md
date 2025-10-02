# Continuation Plan (Prepared: 2025-09-17)

This file captures the exact project state at end of day and provides a concrete, ordered plan to resume work tomorrow without relying on chat history.

---
## 1. Current State Snapshot
- Backend stack: Django 5.2.x + MySQL 8, STRICT raw SQL (no ORM models for domain tables).
- Custom raw migration system: management command `apply_raw_sql` with ordered files tracked in `raw_sql_migrations` table.
- Latest migrations (all applied):
  - `schema.sql` (hash updated today)
  - `part2_migration_apply.sql`
  - `part3_schema.sql`
  - `part4_incidents_notifications_migration.sql`
  - `part5_rate_limiting.sql`
  - `part6_indexes.sql`
  - `20250917_add_donor_profiles.sql`
  - `20250917_add_blood_direct_requests.sql`
  - `20250917_add_geo_prereq.sql`
- Feature 32 (Geo capability prerequisites) COMPLETED: `user_locations` table + lat/lng indexes; endpoints:
  - `POST /api/location/update`
  - `GET /api/location/nearby?lat=&lng=&radius_km=`
- Tests: 21 passing when invoking: `python manage.py test api.tests -v 2` (explicit package needed because we added custom discovery shim).
- Test discovery shim added: `api/tests.py` + `load_tests` hook in `api/tests/__init__.py`.

## 2. Implemented Feature Overview (High-Level)
- Auth & rate limiting (login failures only)
- Users / roles
- Posts (single image), comments, shares
- Scheduling: doctor schedules + appointments
- Blood recruitment + donor applications
- Donor profiles (Feature 12)
- Direct blood requests + responses (Feature 10)
- Campaigns core
- Fire service requests
- Incidents + events + participants
- Notifications (basic emission & read)
- Geo prerequisites (Feature 32) – just completed

## 3. Known Technical Debt / Follow-Ups
| Area | Note | Priority |
|------|------|----------|
| Test Discovery | Current workaround (`tests.py` + star imports). Could replace with explicit Django `TEST_RUNNER` customization later. | Low |
| Notifications | Types unified in single table; no categorization metadata beyond `type` string. | Medium |
| Geo | No spatial index / R-Tree; using decimal + manual filtering. | Medium |
| Security | Password storage method not yet audited (ensure proper hashing if not already implemented). | High (verify) |
| Error Codes | Catalog exists; need expansion when new features add new errors. | Ongoing |

## 4. Proposed Next Feature (Feature 33): Automatic Nearest Fire Department Assignment
**Goal:** When a fire service request is created (or optionally updated with location), automatically determine and fill the nearest active fire department based on request coordinates (or user last location) using `user_locations` + department stored coordinates.

### 4.1 Schema Adjustments (Minimal)
Likely already have `fire_departments` table with lat/lng columns (indexes added in geo migration). Confirm presence; if missing, add columns via new migration:
```
ALTER TABLE fire_departments ADD COLUMN lat DECIMAL(10,7) NULL;
ALTER TABLE fire_departments ADD COLUMN lng DECIMAL(10,7) NULL;
```
(Only if not already present.)

Add an index if absent (defensive):
```
CREATE INDEX IF NOT EXISTS idx_fire_dept_lat_lng ON fire_departments(lat,lng);
```
No new tables required.

### 4.2 Data Backfill Strategy
- If existing rows have NULL lat/lng, leave them; they will be skipped for auto-assignment.
- Provide a management command later (optional) to bulk import / set coordinates.

### 4.3 Backend Logic Changes
1. On fire service request creation (existing endpoint—validate exact function tomorrow in `api/views.py`), detect if `assigned_department_id` is not manually provided.
2. If latitude/longitude provided in request payload: use them.
3. Else if requesting user has `users.last_lat/last_lng`: use those.
4. If coordinates resolved, query nearest fire department:
   - Bounding box pre-filter (like geo): 10km radius initial.
   - Haversine compute on candidate departments.
   - Pick smallest distance under a configurable max (e.g. 50km). If none within max, leave unassigned.
5. Persist chosen department, log (optionally) into a new lightweight audit field or just update the existing row.
6. Emit a notification to that department's user account (if department records link to user IDs) with type `fire_request_assigned`.

### 4.4 New Configuration (Optional Tomorrow)
Add simple constants near top of `views.py`:
```
AUTO_ASSIGN_FIRE_RADIUS_KM = 50.0
AUTO_ASSIGN_FIRE_INITIAL_BOX_KM = 10.0
```

### 4.5 Endpoints to Adjust / Add
- Modify existing fire service request creation endpoint (identify function name tomorrow; grep for `fire_service_requests`).
- Optional new endpoint: `POST /api/fire/assign/nearest` to retroactively assign an existing unassigned request (admin or dispatcher usage).

### 4.6 Tests To Add
File: `api/tests/test_fire_auto_assign.py`
Scenarios:
1. Create fire dept A (near), fire dept B (far) with coordinates; submit fire request near A → auto assigns A.
2. Submit request where no departments within max radius → remains unassigned.
3. Provide explicit `department_id` in request payload → system respects manual override (no auto-assignment).
4. Validate notification emitted to assigned department user.
5. Edge: malformed or missing coordinates → no assignment, no failure.

### 4.7 Migration Plan
- Create dated SQL migration `20250918_add_fire_dept_coords.sql` ONLY IF columns not already present.
- Append to `ORDER_PREFIXES` in `apply_raw_sql.py`.
- Update `schema.sql` accordingly.

### 4.8 Rollout Sequence (Pipeline Compliance)
1. Implement code changes guarded so they don't break if columns missing (try/except around coordinate usage).
2. Add migration file & update ordering + master schema.
3. Apply migration to real DB (`apply_raw_sql`).
4. Write tests (ensuring they bootstrap needed tables if migration not applied to test DB).
5. Run tests; fix failures.
6. Update `FEATURE_LOG.md` marking Feature 33 complete.

## 5. Commands Reference (For Resuming)
From repository root:
```powershell
# List migrations
python .\Backend\crisisintel\manage.py apply_raw_sql --list

# Apply pending migrations
python .\Backend\crisisintel\manage.py apply_raw_sql

# Run full test suite (ensures discovery shim loads)
python .\Backend\crisisintel\manage.py test api.tests -v 2
```
If virtual environment not activated:
```powershell
& .\Backend\crisisintel\myenv\Scripts\Activate.ps1
```

## 6. Future Feature Queue (After Feature 33)
1. Messaging (direct user-to-user or channel-based) – schema: `messages`, `message_threads`.
2. Notification categorization & filtering (add `category` + optional `priority`).
3. AI stubs: summarization of incident threads, similarity suggestions for resource coordination.
4. Enhanced geo: clustering, heatmaps (later; maybe need spatial engine or external service).
5. Attachment support expansion (multi-image posts) – previously deferred.

## 7. Ready-Made Checklist For Tomorrow
- [ ] Confirm fire_departments already has lat/lng
- [ ] Draft migration if needed
- [ ] Update `schema.sql` + `apply_raw_sql.py` ordering list
- [ ] Implement nearest assignment logic in creation endpoint
- [ ] (Optional) Implement retroactive assignment endpoint
- [ ] Add tests (`test_fire_auto_assign.py`)
- [ ] Apply migration to real DB
- [ ] Run tests (21 existing + new) and ensure green
- [ ] Update `FEATURE_LOG.md` (Feature 33)

## 8. Risk & Edge Considerations
| Risk | Mitigation |
|------|------------|
| Large fire_departments table → performance | Bounding box + index on (lat,lng) + LIMIT candidates |
| No departments with coordinates | Fail soft: leave unassigned |
| Floating point precision issues | Round distances to 2 decimals for output only |
| Concurrent request modifications | Single UPDATE with department_id; ignore race (low risk now) |

## 9. Quick Distance Helper (Pseudo)
```
SELECT id, lat, lng
FROM fire_departments
WHERE lat BETWEEN min_lat AND max_lat
  AND lng BETWEEN min_lng AND max_lng
LIMIT 300;
# Then Haversine in Python, choose nearest within radius.
```

## 10. Notes
- Keep raw SQL style consistent: idempotent DDL with IF NOT EXISTS where safe.
- Maintain test isolation: each new test file ensures minimal tables with `CREATE TABLE IF NOT EXISTS`.
- Avoid coupling geo logic too tightly; later we can centralize distance calculations if reused.

---
Prepared so work can restart immediately with minimal mental reload.
