from django.core.management.base import BaseCommand
from api.db import query

class Command(BaseCommand):
    help = "Show column definitions for given table names (raw SHOW COLUMNS)."

    def add_arguments(self, parser):
        parser.add_argument('tables', nargs='+', help='One or more table names')

    def handle(self, *args, **options):
        tables = options['tables']
        for t in tables:
            self.stdout.write(self.style.NOTICE(f"Table: {t}"))
            try:
                cols = query(f"SHOW COLUMNS FROM {t}", [], many=True) or []
            except Exception as e:
                self.stderr.write(self.style.ERROR(f"  Error: {e}"))
                continue
            for c in cols:
                self.stdout.write("  {Field:<25} {Type:<20} Null={Null} Key={Key} Default={Default} Extra={Extra}".format(**{k:(v if v is not None else '') for k,v in c.items()}))
            self.stdout.write('')