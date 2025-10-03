# CrisisIntel Backend

## Quick Start

### 1. Environment
Requires: Python 3.10+, MySQL 8.

Create / activate a virtual environment (example PowerShell):
```
python -m venv myenv
myenv\Scripts\Activate.ps1
```

Install dependencies:
```
pip install -r requirements.txt
```

### 2. Database
Create a MySQL database (or let schema.sql create it):
```
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS crisisintel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3. Apply SQL Migrations (use apply_sql)
The legacy `apply_raw_sql` command is deprecated. Use `apply_sql`, which scans `Backend/crisisintel/sql/` and records applied files in `schema_migrations`.

Basic run (applies all pending .sql files in safe order):
```
python manage.py apply_sql
```

Apply a single SQL file by name (useful for the finalized schema or seed data):
```
python manage.py apply_sql --one final_normalized_schema.sql
python manage.py apply_sql --one seed_data.sql
```

Optional: Preview without applying
```
python manage.py apply_sql --dry-run
```

### 4. Run Development Server
```
python manage.py runserver
```

### 5. Seed Demo Data (optional)
```
python manage.py seed_demo
```
Creates sample users (admin, two regular users, fire service), posts, a conversation with messages, a blood direct request, and a fire service request with a candidate.

### 5b. Finalized Schema + Final Seed (recommended for the production-like dataset)
If you want the final normalized schema and the final seed set (instead of the small demo dataset above), run the following from `Backend/crisisintel`:

1) Create/upgrade to the finalized normalized schema
```
python manage.py apply_sql --one final_normalized_schema.sql
```

2) Seed the final data
```
python manage.py apply_sql --one seed_data.sql
```

Notes
- These commands are idempotent: each SQL file is recorded in `schema_migrations` and won’t be re-applied unless you remove its entry.
- If you need a clean rebuild, you can reset the database and then re-apply the final schema and seed:
  - Make sure you’re okay with losing existing data.
  - Drop all tables (optional helper file provided):
    ```
    python manage.py apply_sql --one 20251001_drop_all_tables.sql
    ```
  - Re-apply the finalized schema and seed as shown above.
- Alternative (MySQL CLI):
  - Apply schema
    ```
    mysql -u root -p crisisintel < Backend/crisisintel/sql/final_normalized_schema.sql
    ```
  - Seed data
    ```
    mysql -u root -p crisisintel < Backend/crisisintel/sql/seed_data.sql
    ```

### 6. Run Tests
```
python manage.py test api.tests.test_fire_auto_assign api.tests.test_messaging_events api.tests.test_inbox api.tests.test_realtime_messaging
```

## Key Endpoints (Snapshot)
Auth: `POST /api/register`, `POST /api/login`
Feed & Content: `/api/news_feed`, `/api/posts`, `/api/posts/<id>`
Blood Direct Requests: `/api/blood/direct` (create), `/api/blood/direct/list`
Donor Profiles: `/api/donor/profile/upsert`, `/api/donor/profiles/search`
Fire Requests: `/api/fire/requests`, candidate accept/decline, nearest assignment
Messaging: `/api/messages/direct`, `/api/inbox`, `/api/inbox/updates`, `/api/conversations/<id>/messages/all`, `/api/conversations/<id>/messages/since`
Dashboard: `/api/dashboard` (summary metrics)

## Demo Workflow
1. Apply migrations & seed.
2. Login as `alice@example.com` (password placeholder) once auth hashing integrated; currently seed sets 'demo' hashes only for display.
3. View feed & create a post.
4. Create a fire request (auto candidate) then accept as fire service user.
5. Send direct message and poll `/api/inbox/updates` for near real-time.
6. Call `/api/dashboard` for counts snapshot.

## Notes
- Raw SQL migration order controlled by `apply_raw_sql.py` ORDER_PREFIXES.
- Messaging currently polling + notifications only (no websockets).
- Password hashes for seed users are placeholder text (`demo`) and not secure.

## Next Steps (Suggested)
- Frontend wiring for messaging & fire request candidate actions.
- Group messaging, unread counts.
- Escalation for fire request candidates.
- Metrics aggregation & admin dashboard expansion.
# CrisisIntel Platform

Unified crisis coordination prototype: roles (admin, hospital, fire service, blood bank, social org, doctor, regular), appointments & scheduling, social posting (single-image), blood recruitment/apps, notifications baseline. Raw SQL (no ORM models) with Django endpoints + React frontend (Create React App) in `Frontend/crisisintel`.

## Stack
- Backend: Django 5 + raw MySQL queries (no Django ORM usage for feature tables)
- DB: MySQL 8.x (schema managed manually via `crisisintel/sql/schema.sql`)
- Frontend: React 18 (CRA) with simple token-based auth
- Auth: Custom auth_tokens table (bearer token + per-request CSRF header)
- Media: Single image per post stored on filesystem under `media/uploads/<user_id>/`

## Repository Layout
```
Backend/
  crisisintel/
    manage.py
    crisisintel/
      settings.py
      urls.py
    sql/
      schema.sql   # Master schema (idempotent-ish; safe re-run for existing env)
Frontend/
  crisisintel/
    package.json
    src/
```

## Prerequisites
- Python 3.10+
- MySQL Server running locally (default: `root` / password `1234`, adjust via env)
- Node.js 18+

## Environment Variables (Backend)
Create `Backend/.env` (optional) or set OS env vars:
```
CRISISINTEL_SECRET_KEY=change-me
CRISISINTEL_ALLOW_UNAUTH=0          # Development-only shortcut (leave 0 normally)
DB_NAME=crisisintel                 # (currently hardcoded in settings.py; future)
DB_USER=root
DB_PASSWORD=1234
DB_HOST=localhost
DB_PORT=3306
```
(Current `settings.py` still uses literal DB config; refactor later to read variables.)

## Initial Database Setup
1. Ensure MySQL is running and you can connect as configured.
2. Load schema (will create DB if absent):
```sql
SOURCE Backend/crisisintel/sql/schema.sql;
```
From CLI:
```bash
mysql -u root -p < Backend/crisisintel/sql/schema.sql
```

## Python Virtual Environment
From `Backend/`:
```bash
python -m venv venv
venv/Scripts/activate  # Windows PowerShell: .\venv\Scripts\Activate.ps1
pip install -r crisisintel/requirements.txt
```

## Running the Backend
From `Backend/crisisintel/` (where `manage.py` lives one directory up):
```bash
cd Backend/crisisintel
python ../manage.py runserver 8000
```
If inside the root `Backend/` already:
```bash
python crisisintel/manage.py runserver 8000
```

## Running the Frontend
```bash
cd Frontend/crisisintel
npm install
npm start
```
The CRA dev server proxies API calls to `http://localhost:8000` (see `package.json` proxy field).

## Auth Flow Summary
1. Register -> returns auth credentials (token + csrf token)
2. Subsequent requests: `Authorization: Bearer <token>` and `X-CSRF-Token: <csrf>`
3. Token expiry handled by backend (see `auth_tokens` table)

## Implemented Features (Backend)
- Roles & accounts
- Doctor multi-hospital scheduling & appointment booking
- Posts: create/update/delete + single image upload
- Comments & shares
- Blood recruitment posts + donor applications
- Basic notifications storage

## Pending / High Priority Next
Refer to `FEATURE_LOG.md` for authoritative status. Early focus (reordered):
1. Donor profiles & direct requests
2. Geo foundation + nearest fire department auto-assignment
3. Direct messaging
4. Emergency events core + resources
5. Notification expansion

## Frontend Status Snapshot
Implemented: Auth, feed, create/edit post (single image), comments, shares.
Missing (planned): Appointments UI, blood recruitment flow UI, notifications center, donor profile editor, messaging, events, fire service, admin dashboards.
See the Frontend Coverage section in `FEATURE_LOG.md`.

## Testing (Manual for Now)
- Exercise endpoints using curl or Postman with auth headers.
- Schema is idempotent for core objects; re-run after pulling updates.

## Media Handling
Uploaded images stored under `media/`. **Not production ready** (no validation, no size quota). Future improvement: object storage & signed URLs.

## Contributing Workflow
1. Update `FEATURE_LOG.md` (status + date) BEFORE coding a feature.
2. Create or extend raw SQL in `sql/` (additive migration file or adjust schema.sql if still early).
3. Implement endpoint(s) using raw SQL helpers.
4. Update README if setup or process changes.

## Future Enhancements (See `SUGGESTIONS.md`)
- Multi-image posts (deferred)
- Structured metrics (api_metrics table + dashboard)
- WebSocket/Channels for live messaging & notifications
- AI/NLP enrichment stubs

## License
Internal prototype; no license declared yet.

---
Generated initial README on 2025-09-17.
