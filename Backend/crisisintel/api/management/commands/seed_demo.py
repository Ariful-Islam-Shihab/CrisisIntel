from django.core.management.base import BaseCommand
from api.db import query, execute
from django.db import transaction, connection
import random, time

class Command(BaseCommand):
    help = "Populate a minimal demo dataset (idempotent). Creates users, a fire department, posts, a conversation, messages, blood & fire requests."

    def handle(self, *args, **options):
        def col_exists(table: str, col: str) -> bool:
            sql = ("SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS "
                   "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s")
            row = query(sql, [table, col])
            return bool(row and row.get('c'))

        has_last_lat = col_exists('users', 'last_lat') and col_exists('users', 'last_lng')

        with transaction.atomic():
            # Users
            existing = query("SELECT id FROM users LIMIT 1")
            if not existing:
                base_cols = "email,password_hash,full_name,role,status"
                admin_id = execute(f"INSERT INTO users({base_cols}) VALUES('admin@example.com','demo','Admin User','admin','active')")
                user1_id = execute(f"INSERT INTO users({base_cols}) VALUES('alice@example.com','demo','Alice Regular','regular','active')")
                user2_id = execute(f"INSERT INTO users({base_cols}) VALUES('bob@example.com','demo','Bob Regular','regular','active')")
                if has_last_lat:
                    fire_id = execute("INSERT INTO users(email,password_hash,full_name,role,status,last_lat,last_lng) VALUES('firedept@example.com','demo','Central Fire','fire_service','active',40.0,-70.0)")
                else:
                    fire_id = execute(f"INSERT INTO users({base_cols}) VALUES('firedept@example.com','demo','Central Fire','fire_service','active')")
            else:
                # Try to locate needed roles
                admin_id = (query("SELECT id FROM users WHERE role='admin' LIMIT 1") or {}).get('id') or execute("INSERT INTO users(email,password_hash,full_name,role,status) VALUES('admin@example.com','demo','Admin User','admin','active')")
                user1_id = (query("SELECT id FROM users WHERE email='alice@example.com'") or {}).get('id') or execute("INSERT INTO users(email,password_hash,full_name,role,status) VALUES('alice@example.com','demo','Alice Regular','regular','active')")
                user2_id = (query("SELECT id FROM users WHERE email='bob@example.com'") or {}).get('id') or execute("INSERT INTO users(email,password_hash,full_name,role,status) VALUES('bob@example.com','demo','Bob Regular','regular','active')")
                fire_row = query("SELECT id FROM users WHERE role='fire_service' LIMIT 1")
                if fire_row:
                    fire_id = fire_row['id']
                else:
                    if has_last_lat:
                        fire_id = execute("INSERT INTO users(email,password_hash,full_name,role,status,last_lat,last_lng) VALUES('firedept@example.com','demo','Central Fire','fire_service','active',40.0,-70.0)")
                    else:
                        fire_id = execute("INSERT INTO users(email,password_hash,full_name,role,status) VALUES('firedept@example.com','demo','Central Fire','fire_service','active')")

            # Fire department
            if not query("SELECT id FROM fire_departments WHERE user_id=%s", [fire_id]):
                execute("INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)", [fire_id, 'Central FD', 40.0, -70.0])
            # Fire team + inventory + staff (breadth demo)
            dept = query("SELECT id FROM fire_departments WHERE user_id=%s", [fire_id])
            if dept and not query("SELECT id FROM fire_teams WHERE department_id=%s", [dept['id']]):
                execute("INSERT INTO fire_teams(department_id,name,status) VALUES(%s,%s,%s)", [dept['id'], 'Alpha Team', 'available'])
            if dept and not query("SELECT id FROM fire_inventory WHERE department_id=%s", [dept['id']]):
                execute("INSERT INTO fire_inventory(department_id,item_name,quantity) VALUES(%s,%s,%s)", [dept['id'], 'Hose Kit', 3])
            if dept and not query("SELECT id FROM fire_staff WHERE department_id=%s", [dept['id']]):
                execute("INSERT INTO fire_staff(department_id,user_id,role) VALUES(%s,%s,%s)", [dept['id'], fire_id, 'Chief'])

            # Posts (idempotent basic check)
            if not query("SELECT id FROM posts LIMIT 1"):
                for uid, body in [(user1_id, 'Hello world'), (user2_id, 'Emergency preparedness tips'), (user1_id, 'Need volunteers for drill')]:
                    execute("INSERT INTO posts(author_id,body) VALUES(%s,%s)", [uid, body])

            # Conversation & messages
            conv = query("""SELECT c.id FROM conversations c
                              JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.user_id=%s
                              JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.user_id=%s
                              WHERE c.is_group=0 LIMIT 1""", [user1_id, user2_id])
            if not conv:
                cid = execute("INSERT INTO conversations(is_group,created_by_user_id) VALUES(0,%s)", [user1_id])
                execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, user1_id])
                execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, user2_id])
                execute("INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)", [cid, user1_id, 'Hi Bob – welcome to the platform'])
                execute("INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)", [cid, user2_id, 'Thanks Alice!'])

            # Blood direct request
            if not query("SELECT id FROM blood_direct_requests LIMIT 1"):
                bdr_id = execute("INSERT INTO blood_direct_requests(requester_user_id,target_blood_type,quantity_units,notes,status) VALUES(%s,'O+',2,'Urgent need','open')", [user1_id])
            # Food donation sample
            if not query("SELECT id FROM food_donations LIMIT 1"):
                execute("INSERT INTO food_donations(donor_user_id,item,quantity,status) VALUES(%s,%s,%s,'offered')", [user1_id, 'Bottled Water Cases', 10])

            # Fire service request + candidate (only if none exist)
            if not query("SELECT id FROM fire_service_requests LIMIT 1"):
                fsr_id = execute("INSERT INTO fire_service_requests(requester_id,lat,lng,description,status) VALUES(%s,%s,%s,%s,'pending')", [user2_id, 40.001, -70.002, 'Small brush fire'])
                # Generate nearest candidate (reuse simple logic)
                dept = query("SELECT id FROM fire_departments LIMIT 1")
                if dept:
                    execute("INSERT INTO fire_request_candidates(request_id,department_id,candidate_rank,status) VALUES(%s,%s,1,'pending')", [fsr_id, dept['id']])

        self.stdout.write(self.style.SUCCESS('Demo seed complete.'))
