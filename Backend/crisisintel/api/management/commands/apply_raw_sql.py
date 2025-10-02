from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = "Deprecated: use apply_sql instead. This command no longer applies migrations."

    def handle(self, *args, **options):
        self.stderr.write(self.style.WARNING(
            'apply_raw_sql is deprecated. Use: python manage.py apply_sql  (scans sql/ directories automatically)'
        ))
        self.stdout.write('No action taken.')
