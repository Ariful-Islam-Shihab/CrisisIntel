from django.core.management.base import BaseCommand
from django.db import transaction
from api.db import query, execute
from api.utils import _hash_password, _verify_password  # reuse existing hashing format

# Updated role targets: 20 normal 'regular' users, and 5 for each organization type.
ROLE_TARGETS = {
    'admin': 1,              # Keep a single admin (optional)
    'regular': 20,           # 20 normal users
    'fire_service': 5,       # 5 fire service accounts
    'hospital': 5,           # 5 hospital accounts
    'social_service': 5,     # 5 social service accounts
    'blood_bank': 5,         # 5 blood bank accounts
    'ngo': 5,                # 5 NGO accounts
}

DEMO_PASSWORD = '1234'  # Shared demo plaintext password
# We'll hash per-user on insert so login works with DEMO_PASSWORD.

# Realistic sample names (kept deterministic for idempotency)
FIRST_NAMES = [
    'Ava','Liam','Noah','Emma','Olivia','Elijah','Isabella','Mason','Sophia','Lucas',
    'Mia','Ethan','Amelia','Harper','Logan','Aria','Benjamin','Evelyn','Henry','Charlotte',
]
LAST_NAMES = [
    'Anderson','Brown','Clark','Davis','Edwards','Foster','Garcia','Harris','Iverson','Johnson',
    'Khan','Lopez','Miller','Nguyen','Owens','Patel','Quinn','Roberts','Singh','Turner',
]

ROLE_DOMAINS = {
    'regular': 'users.example.com',
    'admin': 'admin.example.com',
    'fire_service': 'fire.example.com',
    'hospital': 'hospital.example.com',
    'social_service': 'social.example.com',
    'blood_bank': 'blood.example.com',
    'ngo': 'ngo.example.com',
}

def build_name(role_index: int):
    first = FIRST_NAMES[role_index % len(FIRST_NAMES)]
    last = LAST_NAMES[role_index % len(LAST_NAMES)]
    return first, last

def sanitize_email_fragment(s: str) -> str:
    return ''.join(ch for ch in s.lower() if ch.isalnum() or ch in ['.','-','_'])

class Command(BaseCommand):
    help = 'Seed users: 20 regular + 5 of each organization role (password: 1234). Idempotent.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Show what would be created without inserting.')
        parser.add_argument('--rehash-existing', action='store_true', help='Re-hash any existing users whose password_hash looks like plaintext.')

    def handle(self, *args, **options):
        dry = options.get('dry_run')
        rehash_existing = options.get('rehash_existing')
        created = []
        role_summaries = []

        # Optional: re-hash any existing plaintext passwords before proceeding (idempotent)
        if rehash_existing and not dry:
            # Fetch candidates whose stored hash is not recognized by _verify_password for either DEMO_PASSWORD or itself
            from django.db import connection
            with connection.cursor() as cur:
                cur.execute("SELECT id, password_hash FROM users")
                rows = cur.fetchall()
            updated = 0
            for uid, stored in rows:
                # Heuristic: if stored contains neither ':' nor 'pbkdf2_sha256$' treat as plaintext
                if (':' not in stored) and (not stored.startswith('pbkdf2_sha256$')):
                    # Re-hash the existing plaintext (keeping the same visible password value for that user)
                    new_hash = _hash_password(stored)
                    execute("UPDATE users SET password_hash=%s WHERE id=%s", [new_hash, uid])
                    updated += 1
            if updated:
                self.stdout.write(self.style.SUCCESS(f"Re-hashed {updated} existing plaintext password(s)."))
            else:
                self.stdout.write("No existing plaintext passwords needed rehashing.")
        # Check existence of both geo columns explicitly (queries return single row)
        lat_row = query("""SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'""")
        lng_row = query("""SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lng'""")
        has_geo = bool(lat_row and lat_row.get('c') == 1 and lng_row and lng_row.get('c') == 1)

        with transaction.atomic():
            for role, target in ROLE_TARGETS.items():
                existing_row = query("SELECT COUNT(1) AS c FROM users WHERE role=%s", [role]) or {'c': 0}
                existing_count = existing_row['c']
                need = max(0, target - existing_count)
                role_summaries.append({
                    'role': role,
                    'existing': existing_count,
                    'target': target,
                    'to_create': need
                })
                domain = ROLE_DOMAINS.get(role, 'example.com')
                for i in range(need):
                    name_index = existing_count + i
                    first, last = build_name(name_index)
                    first_clean = sanitize_email_fragment(first)
                    last_clean = sanitize_email_fragment(last)
                    base_email = f"{first_clean}.{last_clean}@{domain}".lower()
                    email = base_email
                    suffix = 1
                    while query("SELECT id FROM users WHERE email=%s", [email]):
                        suffix += 1
                        email = f"{first_clean}.{last_clean}{suffix}@{domain}".lower()
                    full_name = f"{first} {last}"
                    cols = "email,password_hash,full_name,role,status"
                    # Hash the demo password for each new account
                    params = [email, _hash_password(DEMO_PASSWORD), full_name, role, 'active']
                    if has_geo:
                        try:
                            cols += ",last_lat,last_lng"
                            role_hash_offset = (abs(hash(role)) % 1000) / 10000.0
                            params.extend([
                                40.0 + role_hash_offset + (i * 0.0007),
                                -70.0 - role_hash_offset - (i * 0.0007)
                            ])
                        except Exception:
                            has_geo = False
                    if not dry:
                        uid = execute(
                            f"INSERT INTO users({cols}) VALUES({','.join(['%s']*len(params))})",
                            params
                        )
                        created.append({'id': uid, 'email': email, 'role': role, 'name': full_name})
                    else:
                        created.append({'id': None, 'email': email, 'role': role, 'name': full_name})

        total_new = len([c for c in created if c['id']])
        total_dry = len([c for c in created if c['id'] is None])
        if dry:
            self.stdout.write(self.style.NOTICE(f"[Dry-Run] Would create {total_dry} users."))
        self.stdout.write(self.style.SUCCESS(f"Created {total_new} new users."))

        self.stdout.write("\nRole Summary:")
        for rs in role_summaries:
            status_note = "(satisfied)" if rs['to_create'] == 0 else ""
            self.stdout.write(
                f" - {rs['role']:<15} existing {rs['existing']:<3} target {rs['target']:<3} to_create {rs['to_create']:<3} {status_note}".rstrip()
            )

        if created:
            self.stdout.write("\nUser Accounts:")
            for row in created:
                status = 'NEW' if row['id'] else 'DRY'
                self.stdout.write(f" - [{status}] {row['role']:<15} {row.get('name',''):<22} {row['email']}")

        # Export all accounts to a plain text file (root account.txt) if not dry-run
        if not dry:
            try:
                # Fetch all users (email, full_name, role) for export
                all_users = []
                # Raw query helper returns a single dict for selects in current codebase;
                # implement simple manual fetch for multiple rows using low-level cursor.
                from django.db import connection
                with connection.cursor() as cur:
                    cur.execute("SELECT email, full_name, role FROM users ORDER BY role, email")
                    for r in cur.fetchall():
                        all_users.append({'email': r[0], 'full_name': r[1] or '', 'role': r[2]})
                # Build export text: grouped header per role
                lines = []
                current_role = None
                for u in all_users:
                    if u['role'] != current_role:
                        current_role = u['role']
                        lines.append(f"# Role: {current_role}")
                    # Each block: email, full name, password placeholder (1234)
                    lines.extend([
                        u['email'],
                        u['full_name'],
                        DEMO_PASSWORD,
                        ''
                    ])
                export_text = "\n".join(lines).rstrip() + "\n"
                # account.txt is at project root (two levels up from this command file)
                import os
                root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
                out_path = os.path.join(root_dir, 'account.txt')
                with open(out_path, 'w', encoding='utf-8') as f:
                    f.write(export_text)
                self.stdout.write(self.style.SUCCESS(f"Exported {len(all_users)} accounts to account.txt"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Failed to export accounts: {e}"))
