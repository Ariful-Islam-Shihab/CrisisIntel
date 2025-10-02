from django.core.management.base import BaseCommand
from django.db import connection

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
    help = 'Verify required tables/columns exist per final_normalized_schema.sql (fails fast if mismatched).'

    def handle(self, *args, **options):
        problems = []
        with connection.cursor() as cur:
            vendor = connection.vendor
            for table, cols in REQUIRED_SCHEMA.items():
                try:
                    if vendor == 'mysql':
                        cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", [table])
                        rows = cur.fetchall(); existing_cols = {r[0] for r in rows}
                    elif vendor == 'sqlite':
                        cur.execute(f"PRAGMA table_info({table})")
                        rows = cur.fetchall(); existing_cols = {r[1] for r in rows}
                    elif vendor == 'postgresql':
                        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s", [table])
                        rows = cur.fetchall(); existing_cols = {r[0] for r in rows}
                    else:
                        cur.execute(f"SELECT * FROM {table} WHERE 1=0")
                        existing_cols = set([c[0] for c in cur.description]) if cur.description else set()
                except Exception as ex:
                    problems.append(f"Missing table: {table} ({ex})")
                    continue

                missing = [c for c in cols if c not in existing_cols]
                if missing:
                    problems.append(f"Table {table} missing columns: {', '.join(missing)}")

        if problems:
            self.stderr.write(self.style.ERROR("Schema verification failed:"))
            for p in problems:
                self.stderr.write(" - " + p)
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS("Schema OK: final schema requirements met."))
