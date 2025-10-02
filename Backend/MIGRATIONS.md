# Raw SQL Migration Workflow

This backend uses raw SQL files (not Django ORM migrations) to manage schema evolution. A single canonical management command now handles all migration application:

```
python manage.py apply_sql
```

## Directories Scanned
- `sql/` (top-level project directory) – primary location
- `api/sql/` (legacy location; supported for backward compatibility)

If two files share the same basename, the one in the top-level `sql/` directory wins and the duplicate in `api/sql/` is ignored with a warning.

## Tracking Table
Applied filenames are recorded in `schema_migrations`:
```
CREATE TABLE schema_migrations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
A one‑time import of legacy rows from `raw_sql_migrations` occurs automatically if that table exists. The old command `apply_raw_sql` is deprecated and now only prints a warning.

## Adding a New Migration (Pipeline)
1. Feature design / ticket → decide required schema changes.
2. Create a new SQL file in `sql/` named using a sortable pattern:
   - `YYYYMMDDHHMM__short_description.sql` (double underscore between timestamp and description) or keep existing date-prefixed style (`YYYYMMDD_description.sql`).
3. Write idempotent SQL:
   - Use `CREATE TABLE IF NOT EXISTS ...`
   - Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (MySQL 8+ supports this; if unsupported, guard with `information_schema` checks).
   - Avoid destructive changes; if needed, create a follow-up safe migration.
4. Avoid database selection statements (`USE dbname;`) and keep statements terminated with `;`.
5. Run:
   ```
   python manage.py apply_sql --dry-run   # inspect
   python manage.py apply_sql             # apply
   ```
6. Add / update tests validating the new schema is functional (e.g., insert + query round trip, endpoint tests).
7. Update `FEATURE_LOG.md` (or domain-specific docs) to record the addition.
8. Commit with message referencing ticket/feature.

## Checking Status
```
python manage.py apply_sql --dry-run
```
Outputs either `No pending SQL migrations.` or lists `PENDING:` filenames.

## Writing Safe / Idempotent Migrations
Guidelines:
- Prefer additive changes.
- For computed indexes, wrap in `CREATE INDEX IF NOT EXISTS` (MySQL variant: emulate by checking `information_schema.statistics`).
- Never assume empty tables; avoid bulk destructive transforms inline. Create new tables then backfill if needed.
- Keep each logical change in its own file—small, reversible units.

## Rollbacks
There is no automatic rollback. If a migration is faulty:
1. Author a corrective forward migration (preferred), or
2. Manually apply a revert SQL script (also tracked with a new filename) if truly necessary.

## Legacy Command Deprecation
`python manage.py apply_raw_sql` now only emits:
> apply_raw_sql is deprecated. Use: python manage.py apply_sql

Do not rely on hash tracking anymore; filename order + timestamp naming provides deterministic sequencing.

## Troubleshooting
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Statement failure halts run | Syntax error or dependency ordering issue | Fix SQL, re-run `apply_sql` (already-applied files are skipped) |
| A file not picked up | Wrong extension or placed in incorrect directory | Ensure `.sql` suffix and file inside top-level `sql/` |
| Duplicate basename warning | Same filename in both directories | Remove or rename the legacy copy |

## Example Minimal Migration File
```
-- 202509171130__add_example_table.sql
CREATE TABLE IF NOT EXISTS example_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload JSON NULL
);
```

## Test Pattern Snippet (Django TestCase)
```
from django.test import TestCase
from api.db import query, execute

class ExampleSchemaTest(TestCase):
    def test_example_records_insert(self):
        execute("INSERT INTO example_records(payload) VALUES('{\"ok\":true}')")
        row = query('SELECT COUNT(*) AS c FROM example_records')
        self.assertGreaterEqual(row['c'], 1)
```

## Future Hardening (Optional Backlog)
- Add `sha256` column to `schema_migrations` for tamper detection
- Add a `validate_sql` management command (parse + EXPLAIN dry run)
- Introduce structured metadata table for migration author / description

---
Maintainer Note: All contributors should run `python manage.py apply_sql` after pulling new changes to stay up to date.
