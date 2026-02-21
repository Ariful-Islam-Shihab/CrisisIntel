# CrisisIntel

CrisisIntel is a full-stack crisis coordination prototype that brings multiple emergency-response workflows into a single platform. It models multiple role-based experiences (admin, hospital, fire service, blood bank, social organizations, doctors, and regular users) and provides a unified API + UI for communication and resource coordination.

## What the project includes

### Core product areas

The platform is organized around several integrated workflows:

- **Crisis & incident management**
	- Create and browse crisis records, view details, and track progress/status.
	- Invite participants, manage participation requests, and allow users to join/leave.
	- Track crisis-related activity such as notes/events, basic finance (donations/expenses), and “who is involved”.
	- Support crisis-adjacent data like victim enrollment/status and overall summaries.

- **Campaigns & volunteering**
	- Create campaigns, manage participants and their status, and attach locations.
	- Track campaign finance (donations/expenses) with summary views.
	- Support volunteer coordination patterns used by social organizations.

- **Healthcare access (hospitals, doctors, appointments, services)**
	- Hospital profiles and service catalogs.
	- Doctor profiles and schedules.
	- Appointment booking flows and lifecycle actions (confirm, cancel requests, hide).
	- Service booking flows with hospital-side confirmation and cancellation approvals.

- **Blood ecosystem (requests, recruitment, donors, inventory)**
	- Direct blood requests and response/status management.
	- Recruitment posts with applications and application status updates.
	- Donor profiles, availability, and donor searching for matching needs.
	- Blood bank org operations: staff management, donor lists, inventory tracking, and inventory issuance.
	- Crisis-linked blood coordination: donor assignment lists and allocation tracking.

- **Fire service dispatch & operations**
	- Fire department profiles with managed teams, staff, and inventory.
	- Fire request lifecycle management (create, assign, candidate accept/decline, deploy, complete/cancel).
	- Nearest-assignment logic and activity tracking.
	- Deployments that can be associated with a broader incident context.

- **Social organizations & relief operations**
	- Social organization profiles and internal volunteer rosters.
	- Volunteer application and volunteer status management.
	- Support for social volunteer deployments under incident scopes.
	- Food donations (prototype): basic list/create flows used as an example of adding an entity end-to-end.

- **Communication & awareness**
	- Social feed with posts, comments, and post sharing.
	- Search across users/content (prototype-level).
	- Notifications for key events and basic “mark read” flows.
	- Direct messaging with an inbox/conversation model and polling-based updates.

- **Geo / proximity features**
	- Location updates and “nearby” discovery patterns (users/crises) to support regional coordination.

- **AI assistant (optional integration)**
	- A lightweight assistant experience intended for in-app help and symptom-to-specialty guidance.
	- Integrates with a local Ollama model when available, with a safe heuristic fallback when not.

### Roles (conceptual)

The system is designed around role-based experiences. In the prototype these roles broadly include:

- Admin users who oversee and manage platform-level views
- Hospitals and doctors who manage services, schedules, and bookings
- Fire service departments who manage teams/staff and handle dispatch requests
- Blood bank users who manage donors, staff, inventory, and blood request flows
- Social organizations who manage volunteers and relief operations
- Regular users who participate in crises/campaigns, request services, donate, and communicate

### Non-goals / boundaries

- This codebase intentionally emphasizes “prototype integration” over production hardening.
- Real-time communication uses **polling** (no websockets).
- Many features are implemented via **raw SQL** rather than Django ORM models.

## Architecture

### Backend (Django + raw MySQL)

- Django project lives under `Backend/crisisintel/`.
- Feature tables are accessed through **explicit SQL queries** (see `Backend/crisisintel/api/db.py`, `Backend/crisisintel/api/views.py`).
- Database schema is managed via **versioned `.sql` files** under `Backend/crisisintel/sql/`.
- A custom migration runner (`manage.py apply_sql`) applies SQL files and records them in a `schema_migrations` table.

### Frontend (React)

- React app lives under `Frontend/crisisintel/` (Create React App).
- API calls are centralized in `Frontend/crisisintel/src/api/client.js`.
- Pages live under `Frontend/crisisintel/src/pages/` and reusable views under `Frontend/crisisintel/src/components/`.

### Auth model (high level)

- The API uses a custom token approach (auth token header + CSRF header pattern).
- Backend contains a development-only switch to relax auth when `DEBUG` is true.

### Media

- Post images are stored on the backend filesystem under `Backend/crisisintel/media/` (served via Django media configuration in development).

## Repository layout

```
Backend/
	README.md
	crisisintel/
		manage.py
		crisisintel/
			settings.py
			urls.py
		api/
			views.py
			db.py
			urls.py
			utils.py
			metrics_middleware.py
		sql/
			final_normalized_schema.sql
			seed_data.sql
			...
Frontend/
	crisisintel/
		README.md
		package.json
		src/
			api/
			pages/
			components/
FeatureCodeMap.md
```

## Tech stack

- **Backend:** Django 5.x
- **Database:** MySQL 8.x
- **Frontend:** React 18 (Create React App)

## Documentation map

- Backend deep dive + SQL migration workflow: [Backend/README.md](Backend/README.md)
- Frontend notes + app-specific extensions: [Frontend/crisisintel/README.md](Frontend/crisisintel/README.md)
- SQL query catalog / reference: [Backend/crisisintel/docs/SQLQueriesCatalog.md](Backend/crisisintel/docs/SQLQueriesCatalog.md)
- Feature-to-code map: [FeatureCodeMap.md](FeatureCodeMap.md)
