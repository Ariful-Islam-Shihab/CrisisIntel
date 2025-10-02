import random
from django.core.management.base import BaseCommand
from api.views import execute, query


class Command(BaseCommand):
    help = "Fill missing lat/lng for fire_departments with random plausible values (e.g. around Dhaka)."

    def add_arguments(self, parser):
        parser.add_argument('--overwrite', action='store_true', help='Also overwrite existing coordinates (defaults to only NULL).')
        parser.add_argument('--count', type=int, default=0, help='Limit how many rows to update (0 = no limit).')
        parser.add_argument('--center-lat', type=float, default=23.7616700)
        parser.add_argument('--center-lng', type=float, default=90.4395190)
        parser.add_argument('--delta', type=float, default=0.15, help='Max absolute degree offset from center.')

    def handle(self, *args, **opts):
        overwrite = opts['overwrite']
        count_limit = opts['count']
        center_lat = opts['center_lat']
        center_lng = opts['center_lng']
        delta = max(0.0001, opts['delta'])

        where = '' if overwrite else 'WHERE lat IS NULL OR lng IS NULL'
        rows = query(f"SELECT id,name,lat,lng FROM fire_departments {where} ORDER BY id ASC", [], many=True) or []
        if count_limit > 0:
            rows = rows[:count_limit]
        if not rows:
            self.stdout.write(self.style.WARNING('No fire_departments matched criteria.'))
            return
        updated = 0
        for r in rows:
            lat = round(random.uniform(center_lat - delta, center_lat + delta), 6)
            lng = round(random.uniform(center_lng - delta, center_lng + delta), 6)
            try:
                execute("UPDATE fire_departments SET lat=%s,lng=%s WHERE id=%s", [lat, lng, r['id']])
                updated += 1
                self.stdout.write(f"Updated dept {r['id']} -> {lat},{lng}")
            except Exception as e:
                self.stderr.write(f"Failed to update dept {r['id']}: {e}")
        self.stdout.write(self.style.SUCCESS(f"Done. Updated {updated} fire_departments."))