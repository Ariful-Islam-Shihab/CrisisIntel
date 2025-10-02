from datetime import datetime, timedelta, timezone
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = (
        "Prune old rows from rate_limits table based on an age threshold (default 2 days). "
        "Safe to run frequently; uses a bounded DELETE with optional batching."
    )

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=2, help='Retain at most this many days of windows (default 2).')
        parser.add_argument('--batch-size', type=int, default=5000, help='Maximum rows to delete per loop iteration (default 5000).')
        parser.add_argument('--dry-run', action='store_true', help='Show how many rows would be deleted without deleting.')

    def handle(self, *args, **options):
        days = options['days']
        batch_size = options['batch_size']
        dry_run = options['dry_run']

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_naive = cutoff.replace(tzinfo=None)

        with connection.cursor() as cur:
            # Count candidates
            cur.execute("SELECT COUNT(1) FROM rate_limits WHERE window_started_at < %s", [cutoff_naive])
            total_candidates = cur.fetchone()[0]

        if total_candidates == 0:
            self.stdout.write(self.style.SUCCESS("No stale rate limit rows to prune."))
            return

        self.stdout.write(f"Found {total_candidates} stale rows older than {days} day(s).")

        if dry_run:
            self.stdout.write("Dry run complete; no deletions performed.")
            return

        deleted = 0
        with connection.cursor() as cur:
            while True:
                cur.execute(
                    "DELETE FROM rate_limits WHERE window_started_at < %s LIMIT %s",
                    [cutoff_naive, batch_size],
                )
                batch_deleted = cur.rowcount
                deleted += batch_deleted
                if batch_deleted == 0:
                    break
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} stale rate limit row(s)."))
