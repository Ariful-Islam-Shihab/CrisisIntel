from django.core.management.base import BaseCommand
from django.db import connection
import os, glob
from api.db import query, execute
from pathlib import Path

# We historically had two locations for .sql files:
# 1. Top-level project /sql (legacy + most files)
# 2. api/sql (early apply_sql command default)
# Consolidated runner now scans both; preference given to top-level sql/ for duplicate basenames.
BASE_DIR = Path(__file__).resolve().parent.parent.parent  # .../api
TOP_SQL_DIR = BASE_DIR.parent / 'sql'                     # project-level sql
API_SQL_DIR = BASE_DIR / 'sql'                           # api/sql (old location)
SQL_DIRS = [TOP_SQL_DIR, API_SQL_DIR]

class Command(BaseCommand):
    help = (
        "Apply raw .sql migration files (idempotent). Scans project sql/ and api/sql directories. "
        "Tracks applied filenames in schema_migrations and auto-imports legacy raw_sql_migrations entries on first run."
    )

    def add_arguments(self, parser):
        parser.add_argument('--one', help='Apply only a single specified filename (basename).', default=None)
        parser.add_argument('--dry-run', action='store_true', help='List pending files without applying.')

    def handle(self, *args, **options):
        one = options.get('one')
        dry = options.get('dry_run')

        # Ensure tracking table exists
        with connection.cursor() as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS schema_migrations (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                filename VARCHAR(255) NOT NULL UNIQUE,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
            )

        # One-time import from legacy raw_sql_migrations (if present & not yet imported)
        try:
            legacy_rows = query('SELECT filename FROM raw_sql_migrations', many=True) or []
        except Exception:
            legacy_rows = []
        migrated_any = False
        for r in legacy_rows:
            fname = r['filename']
            try:
                execute('INSERT IGNORE INTO schema_migrations(filename) VALUES(%s)', [fname])
                migrated_any = True
            except Exception:
                pass
        if migrated_any:
            self.stdout.write(self.style.WARNING('Imported legacy raw_sql_migrations entries into schema_migrations.'))

        applied = {r['filename'] for r in (query('SELECT filename FROM schema_migrations', many=True) or [])}

        # Collect files from both directories
        discovered = {}
        for d in SQL_DIRS:
            if not d.exists():
                continue
            for path in sorted(d.glob('*.sql')):
                key = path.name
                # Prefer earlier directory order (TOP_SQL_DIR first) and skip duplicates.
                if key not in discovered:
                    discovered[key] = path
                else:
                    # Duplicate basename; log once.
                    self.stdout.write(self.style.WARNING(f'Duplicate migration basename ignored: {path} (using {discovered[key]})'))

        files = list(discovered.values())
        if one:
            files = [p for p in files if p.name == one]
            if not files:
                self.stderr.write(self.style.ERROR(f'File {one} not found in sql directories.'))
                return

        pending = [p for p in files if p.name not in applied]
        if not pending:
            self.stdout.write(self.style.SUCCESS('No pending SQL migrations.'))
            return
        if dry:
            for p in pending:
                self.stdout.write(f'PENDING: {p.name}')
            return

        for path in pending:
            fname = path.name
            self.stdout.write(f'Applying {fname} ...')
            sql_text = path.read_text(encoding='utf-8')
            statements = self._split_sql(sql_text)
            success = True
            for stmt in statements:
                try:
                    with connection.cursor() as cur:
                        cur.execute(stmt)
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f'Statement failed in {fname}: {e}\nSQL: {stmt[:160]}...'))
                    success = False
                    break
            if not success:
                self.stderr.write(self.style.ERROR(f'Aborting further migrations due to failure in {fname}.'))
                break
            try:
                execute('INSERT INTO schema_migrations(filename) VALUES(%s)', [fname])
                self.stdout.write(self.style.SUCCESS(f'Applied {fname}'))
            except Exception as e:
                self.stderr.write(self.style.ERROR(f'Failed to record migration {fname}: {e}'))
                break

        self.stdout.write(self.style.SUCCESS('Migration run complete.'))

    def _split_sql(self, raw: str):
        # Remove line comments and blank lines; split on semicolons.
        cleaned = []
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith('--'):
                continue
            cleaned.append(line)
        merged = '\n'.join(cleaned)
        chunks = [c.strip() for c in merged.split(';') if c.strip()]
        statements = []
        for stmt in chunks:
            if stmt.upper().startswith('USE '):
                continue
            statements.append(stmt)
        return statements
