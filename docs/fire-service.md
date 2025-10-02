# Fire Service Dispatch (Feature)

This document summarizes the Fire Service feature: data model, API endpoints, auth rules, and how to run locally.

## Roles and ownership
- Role `fire_service` represents a fire department owner.
- A `fire_departments` row is auto-created when:
  - registering with role `fire_service` (register endpoint), or
  - logging in as a `fire_service` user without an existing department (backfill), or
  - upgrading via `POST /api/users/upgrade/fire-service`.
- Only the owner (department's `user_id`) or an admin can manage that department.

## Status values
- Fire requests: `pending`, `assigned`, `resolved`, `cancelled` (+ `completed` supported where schema allows; otherwise fallbacks to `resolved`).

## Endpoints (base path `/api`)

Auth basics: unless marked Public, endpoints require an `Authorization: Bearer <token>` header and `X-CSRF-Token` for mutating calls.

- Departments
  - `POST /fire/departments` — Create department (owner-only or admin)
    - Body: `{ name, lat?, lng? }`
    - Returns: `{ id }`
  - `POST /fire/departments/{department_id}/update` — Update name/lat/lng (owner/admin)
  - `GET /fire/departments/list` — List all departments (public)

- Requests
  - `GET /fire/requests` — Public list; filters: `status`, `mine=1` (only own), `all=1` (fire_service can bypass scoping)
    - Result items include `assigned_department_name` and `assigned_team_name` when set.
    - When `mine=1`, includes `candidate_departments` (name + status) and lazily creates a nearest candidate if missing and coordinates are present.
  - `POST /fire/requests` — Create request (auth)
    - Body: `{ description, lat?, lng? }`
    - Returns: `{ id, candidate_id? }` (nearest candidate may be generated)
  - `POST /fire/requests/{id}/assign` — Assign request to a department (fire_service/admin)
    - Body: `{ department_id }`
  - `POST /fire/requests/{id}/assign/nearest` — Generate next nearest candidate (fire_service/admin)
    - Body: `{ force?: bool }`
    - Returns: `{ candidate_id, rank, distance_km }`
  - `POST /fire/requests/{id}/candidate/accept` — Department accepts its pending candidacy; request becomes assigned
  - `POST /fire/requests/{id}/candidate/decline` — Department declines its candidacy
  - `POST /fire/requests/{id}/deploy/team` — Owner deploys a specific team to the request; marks status `assigned`
    - Body: `{ team_id }` (team must belong to the owner’s department)
  - `POST /fire/requests/{id}/complete` — Owner marks as completed; attempts `completed` status, falls back to `resolved`
  - `POST /fire/requests/{id}/cancel` — Requester (or admin) cancels if still `pending` and unassigned
  - `POST /fire/requests/{id}/status` — Generic status change with guard rails
  - `GET /fire/activities` — Owner’s department activity; returns `{ current, past }`

- Department Teams & Staff (owner/admin only)
  - `POST /fire/departments/{dept_id}/teams/add` — Add team
  - `GET /fire/departments/{dept_id}/teams/list` — List teams with member counts
  - `POST|DELETE /fire/departments/{dept_id}/teams/{team_id}` — Update name/status or delete team (delete also removes memberships)
  - `GET /fire/departments/{dept_id}/teams/{team_id}/members/list` — List members
  - `POST /fire/departments/{dept_id}/teams/{team_id}/members/add` — Add staff to team
  - `DELETE /fire/departments/{dept_id}/teams/{team_id}/members/{member_id}/remove` — Remove membership
  - `POST /fire/departments/{dept_id}/staff/add` — Add staff user to department
  - `GET /fire/departments/{dept_id}/staff/list` — List staff
  - `DELETE /fire/departments/{dept_id}/staff/{user_id}/remove` — Remove staff
  - `POST /fire/departments/{dept_id}/staff/{user_id}/update` — Update staff role/status/display_name
  - `POST /fire/departments/{dept_id}/inventory/add` — Add inventory item
  - `GET /fire/departments/{dept_id}/inventory/list` — List inventory

## Frontend (owner-only UX)
- `FireTeams` component shows only the owner’s department (removed multi-department selector for non-admins).
- Actions available:
  - Create/edit/delete teams; view members
  - Add staff to department and teams
  - View department inventory (add/list)
- Fire request UI shows which department received the request; requester can cancel pending unassigned requests.

## Notes and safeguards
- Schema guards create missing tables/columns on the fly for dev resilience.
- Candidate generation uses a 50km radius + bounding box heuristic and Haversine distance.
- Privacy: reading staff/teams/inventory is owner-only; public cannot view.

## Run locally (Windows PowerShell)
Backend (from `Backend/crisisintel`):
```powershell
# Activate venv
. .\myenv\Scripts\Activate.ps1
# Run server
python manage.py runserver 0.0.0.0:8000
```
Frontend (from `Frontend/crisisintel`):
```powershell
npm install
npm start
```

Environment variables: see `Backend/crisisintel/crisisintel/settings.py` for DB settings. Use MySQL-compatible DB; SQLite is partially supported for dev but some SQL uses MySQL functions.

## Optional next steps
- Admin-only UI to browse all departments safely.
- Show candidate distances and response timelines.
- Background job to audit geo coverage and precompute nearest departments.
