from django.core.management.base import BaseCommand
from django.db import connection

# Minimal set of critical tables/columns that views.py assumes exist.
# You can expand this list over time if you want deeper coverage.
REQUIRED_SCHEMA = {
    'users': ['id', 'email', 'password_hash', 'full_name', 'role', 'status', 'avatar_url'],
    'posts': ['id', 'author_id', 'body', 'image_url', 'created_at'],
    'post_comments': ['id', 'post_id', 'user_id', 'body', 'created_at'],
    'post_shares': ['id', 'post_id', 'user_id', 'comment', 'created_at'],
    'user_follows': ['id', 'follower_user_id', 'followee_user_id', 'created_at'],
    'hospitals': ['id', 'user_id', 'name', 'address'],
    'doctors': ['id', 'user_id', 'name', 'specialty'],
    'doctor_schedules': ['id', 'doctor_user_id', 'hospital_user_id', 'weekday', 'start_time', 'end_time', 'visit_cost', 'max_per_day'],
    'hospital_services': ['id', 'hospital_user_id', 'name', 'price', 'duration_minutes', 'available', 'max_per_day', 'window_start_time', 'window_end_time'],
    'service_bookings': ['id', 'user_id', 'hospital_user_id', 'service_id', 'scheduled_at', 'status', 'serial', 'approx_time', 'notes', 'lat', 'lng', 'crisis_id', 'hidden_by_user'],
    'appointments': ['id', 'patient_user_id', 'doctor_user_id', 'hospital_user_id', 'starts_at', 'ends_at', 'status', 'serial', 'approx_time', 'hidden_by_patient'],
    'donor_profiles': ['id', 'user_id', 'blood_type', 'availability_text', 'last_donation_date', 'notes', 'cooldown_until', 'availability_status'],
    'blood_inventory': ['id', 'bank_user_id', 'blood_type', 'quantity_units'],
    'blood_inventory_requests': ['id', 'requester_user_id', 'bank_user_id', 'blood_type', 'quantity_units', 'status'],
    'blood_donor_meeting_requests': ['id', 'requester_user_id', 'donor_user_id', 'blood_type', 'status', 'cooldown_days_after_completion'],
    'campaigns': ['id', 'owner_user_id', 'title', 'status', 'campaign_type'],
    'campaign_participants': ['id', 'campaign_id', 'user_id', 'status', 'role_label'],
    'campaign_donations': ['id', 'campaign_id', 'donor_user_id', 'amount', 'currency'],
    'campaign_expenses': ['id', 'campaign_id', 'amount', 'currency', 'category'],
    'fire_departments': ['id', 'user_id', 'name', 'lat', 'lng'],
    'fire_service_requests': ['id', 'requester_id', 'lat', 'lng', 'description', 'status', 'assigned_department_id', 'assigned_team_id', 'assigned_team_at', 'completed_at'],
    'fire_request_candidates': ['id', 'request_id', 'department_id', 'candidate_rank', 'status'],
    'fire_request_user_hides': ['id', 'user_id', 'request_id'],
    'incidents': ['id', 'creator_user_id', 'title', 'status', 'incident_type', 'severity', 'lat', 'lng'],
    'incident_participants': ['id', 'incident_id', 'user_id', 'status', 'role_label'],
    'incident_social_deployments': ['id', 'incident_id', 'org_id', 'deployed_by_user_id', 'status', 'headcount'],
    'incident_social_deployment_members': ['id', 'deployment_id', 'user_id', 'role_label'],
    'incident_hospital_resources': ['id', 'incident_id', 'hospital_user_id'],
    'incident_team_deployments': ['id', 'incident_id', 'department_id', 'team_id', 'status'],
    'crises': ['id', 'incident_id', 'admin_user_id'],
    'crisis_victims': ['id', 'crisis_id', 'user_id', 'status', 'note'],
}

class Command(BaseCommand):
    help = 'Verify critical database schema matches the expected final schema. Fails with details if mismatched.'

    def handle(self, *args, **options):
        problems = []
        with connection.cursor() as cur:
            # Detect database vendor-specific introspection for column list
            vendor = connection.vendor
            for table, cols in REQUIRED_SCHEMA.items():
                if vendor == 'mysql':
                    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", [table])
                elif vendor == 'sqlite':
                    cur.execute(f"PRAGMA table_info({table})")
                elif vendor == 'postgresql':
                    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s", [table])
                else:
                    # Fallback: try a no-row select to force error if table missing, and skip columns check
                    try:
                        cur.execute(f"SELECT * FROM {table} WHERE 1=0")
                        existing_cols = None
                    except Exception as ex:
                        problems.append(f"Missing table: {table} ({ex})")
                        continue

                rows = cur.fetchall()
                if connection.vendor == 'sqlite':
                    existing_cols = {r[1] for r in rows}  # r[1] is name
                elif rows and isinstance(rows[0], (list, tuple)):
                    existing_cols = {r[0] for r in rows}
                else:
                    existing_cols = set()

                if not existing_cols:
                    problems.append(f"Missing or unreadable table: {table}")
                    continue

                missing = [c for c in cols if c not in existing_cols]
                if missing:
                    problems.append(f"Table {table} is missing columns: {', '.join(missing)}")

        if problems:
            self.stderr.write(self.style.ERROR("Schema verification failed:"))
            for p in problems:
                self.stderr.write(" - " + p)
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS("Schema OK: required tables and columns are present."))
import json
from collections import OrderedDict
from typing import Dict, Any, Optional

from django.core.management.base import BaseCommand, CommandError
from django.db import connection


def _current_database_name() -> str:
    with connection.cursor() as cur:
        cur.execute("SELECT DATABASE()")
        row = cur.fetchone()
    return row[0]


def collect_current_schema(include_indexes: bool = False) -> Dict[str, Any]:
    schema_name = _current_database_name()
    tables: Dict[str, Any] = OrderedDict()

    with connection.cursor() as cur:
        # Fetch table names (only BASE TABLEs, skip views for now)
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """,
            [schema_name],
        )
        table_names = [r[0] for r in cur.fetchall()]

        for table in table_names:
            # Columns
            cur.execute(
                """
                SELECT column_name, data_type, is_nullable, column_default, column_type
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                [schema_name, table],
            )
            columns = OrderedDict()
            for name, data_type, is_nullable, default, column_type in cur.fetchall():
                columns[name] = {
                    "data_type": data_type,
                    "nullable": (is_nullable == "YES"),
                    "default": default,
                    "column_type": column_type,
                }

            table_obj: Dict[str, Any] = {"columns": columns}

            if include_indexes:
                cur.execute(
                    """
                    SELECT index_name, non_unique, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
                    FROM information_schema.statistics
                    WHERE table_schema = %s AND table_name = %s
                    GROUP BY index_name, non_unique
                    ORDER BY index_name
                    """,
                    [schema_name, table],
                )
                indexes = OrderedDict()
                for index_name, non_unique, cols in cur.fetchall():
                    # Skip implicit primary if desired? We'll keep it for completeness.
                    indexes[index_name] = {
                        "columns": cols.split(",") if cols else [],
                        "unique": (non_unique == 0),
                    }
                table_obj["indexes"] = indexes

            tables[table] = table_obj

    return {"schema": schema_name, "tables": tables}


def load_expected_spec(spec_file: Optional[str]) -> Optional[Dict[str, Any]]:
    if not spec_file:
        return None
    try:
        with open(spec_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise CommandError(f"Spec file not found: {spec_file}")


def diff_schema(current: Dict[str, Any], expected: Dict[str, Any], include_indexes: bool = False) -> Dict[str, Any]:
    current_tables = current.get("tables", {})
    expected_tables = expected.get("tables", {})

    missing_tables = [t for t in expected_tables.keys() if t not in current_tables]
    unexpected_tables = [t for t in current_tables.keys() if t not in expected_tables]

    column_differences = {}
    index_differences = {}

    for table, exp_def in expected_tables.items():
        cur_def = current_tables.get(table)
        if not cur_def:
            continue
        exp_cols = exp_def.get("columns", {})
        cur_cols = cur_def.get("columns", {})

        missing_cols = [c for c in exp_cols.keys() if c not in cur_cols]
        unexpected_cols = [c for c in cur_cols.keys() if c not in exp_cols]
        changed_cols = {}
        for col, exp_meta in exp_cols.items():
            cur_meta = cur_cols.get(col)
            if not cur_meta:
                continue
            # Compare subset of attributes to avoid noise
            for attr in ("data_type", "nullable"):
                if str(cur_meta.get(attr)) != str(exp_meta.get(attr)):
                    changed_cols.setdefault(col, {})[attr] = {
                        "current": cur_meta.get(attr),
                        "expected": exp_meta.get(attr),
                    }
        if missing_cols or unexpected_cols or changed_cols:
            column_differences[table] = {
                "missing": missing_cols,
                "unexpected": unexpected_cols,
                "changed": changed_cols,
            }

        if include_indexes:
            exp_indexes = exp_def.get("indexes", {})
            cur_indexes = cur_def.get("indexes", {})
            missing_idx = [i for i in exp_indexes.keys() if i not in cur_indexes]
            unexpected_idx = [i for i in cur_indexes.keys() if i not in exp_indexes]
            changed_idx = {}
            for idx_name, exp_idx in exp_indexes.items():
                cur_idx = cur_indexes.get(idx_name)
                if not cur_idx:
                    continue
                for attr in ("columns", "unique"):
                    if cur_idx.get(attr) != exp_idx.get(attr):
                        changed_idx.setdefault(idx_name, {})[attr] = {
                            "current": cur_idx.get(attr),
                            "expected": exp_idx.get(attr),
                        }
            if missing_idx or unexpected_idx or changed_idx:
                index_differences[table] = {
                    "missing": missing_idx,
                    "unexpected": unexpected_idx,
                    "changed": changed_idx,
                }

    return {
        "missing_tables": missing_tables,
        "unexpected_tables": unexpected_tables,
        "column_differences": column_differences,
        "index_differences": index_differences if include_indexes else {},
    }


class Command(BaseCommand):
    help = (
        "Inspect and optionally verify the current MySQL schema. "
        "Can dump schema, compare to a spec file, and emit JSON suitable for CI." 
    )

    def add_arguments(self, parser):
        parser.add_argument("--dump-current", action="store_true", help="Print the current schema (human friendly if not --json)")
        parser.add_argument("--json", action="store_true", help="Emit JSON output")
        parser.add_argument("--spec-file", help="Path to schema spec JSON to compare against", default=None)
        parser.add_argument("--fail-on-missing", action="store_true", help="Exit with code 1 if differences detected")
        parser.add_argument("--include-indexes", action="store_true", help="Include index metadata in dump & diff")
        parser.add_argument("--write-spec", help="Write the current schema to the given file path (JSON)")

    def handle(self, *args, **options):
        include_indexes = options["include_indexes"]
        current = collect_current_schema(include_indexes=include_indexes)
        spec_file = options.get("spec_file")
        expected = load_expected_spec(spec_file) if spec_file else None

        diff = None
        if expected:
            diff = diff_schema(current, expected, include_indexes=include_indexes)

        write_spec = options.get("write_spec")
        if write_spec:
            with open(write_spec, "w", encoding="utf-8") as f:
                json.dump(current, f, indent=2, sort_keys=False)
            self.stdout.write(self.style.SUCCESS(f"Wrote current schema to {write_spec}"))

        output_obj: Dict[str, Any] = {}
        if options["dump_current"]:
            output_obj["current"] = current
        if diff is not None:
            output_obj["diff"] = diff

        if options["json"]:
            # If user only wants diff we still output minimal object
            if not output_obj:
                output_obj = {"current": current}
            self.stdout.write(json.dumps(output_obj, indent=2))
        else:
            # Human readable formatting
            self.stdout.write(self.style.MIGRATE_HEADING(f"Database: {current['schema']}"))
            if options["dump_current"]:
                for table, meta in current["tables"].items():
                    self.stdout.write(self.style.HTTP_INFO(f"Table: {table}"))
                    for col, cmeta in meta["columns"].items():
                        self.stdout.write(
                            f"  - {col}: {cmeta['column_type']}" + (" NULL" if cmeta['nullable'] else " NOT NULL")
                        )
                    if include_indexes and meta.get("indexes"):
                        self.stdout.write("  Indexes:")
                        for idx_name, imeta in meta["indexes"].items():
                            cols = ",".join(imeta["columns"]) if imeta.get("columns") else ""
                            self.stdout.write(
                                f"    * {idx_name} ({cols})" + (" UNIQUE" if imeta.get("unique") else "")
                            )
            if diff is not None:
                self.stdout.write(self.style.MIGRATE_LABEL("Differences:"))
                if not any([
                    diff["missing_tables"],
                    diff["unexpected_tables"],
                    diff["column_differences"],
                    diff.get("index_differences"),
                ]):
                    self.stdout.write("  (none)")
                else:
                    if diff["missing_tables"]:
                        self.stdout.write("  Missing tables: " + ", ".join(diff["missing_tables"]))
                    if diff["unexpected_tables"]:
                        self.stdout.write("  Unexpected tables: " + ", ".join(diff["unexpected_tables"]))
                    for t, cdiff in diff["column_differences"].items():
                        self.stdout.write(f"  Table {t} column differences:")
                        if cdiff["missing"]:
                            self.stdout.write("    Missing cols: " + ", ".join(cdiff["missing"]))
                        if cdiff["unexpected"]:
                            self.stdout.write("    Unexpected cols: " + ", ".join(cdiff["unexpected"]))
                        if cdiff["changed"]:
                            for col, ch in cdiff["changed"].items():
                                for attr, vals in ch.items():
                                    self.stdout.write(
                                        f"    Changed {col}.{attr}: current={vals['current']} expected={vals['expected']}"
                                    )
                    if include_indexes:
                        for t, idiff in diff.get("index_differences", {}).items():
                            self.stdout.write(f"  Table {t} index differences:")
                            if idiff["missing"]:
                                self.stdout.write("    Missing idx: " + ", ".join(idiff["missing"]))
                            if idiff["unexpected"]:
                                self.stdout.write("    Unexpected idx: " + ", ".join(idiff["unexpected"]))
                            if idiff["changed"]:
                                for idx, ch in idiff["changed"].items():
                                    for attr, vals in ch.items():
                                        self.stdout.write(
                                            f"    Changed {idx}.{attr}: current={vals['current']} expected={vals['expected']}"
                                        )

        if options["fail_on_missing"] and diff is not None:
            any_diff = any([
                diff["missing_tables"],
                diff["unexpected_tables"],
                diff["column_differences"],
                diff.get("index_differences"),
            ])
            if any_diff:
                raise CommandError("Schema differences detected")

        # Return nothing explicit (success)
