from django.core.management.base import BaseCommand

from core.services import process_due_installments


class Command(BaseCommand):
    help = "Met a jour les echeances, penalites et rappels REBOOT CLUB."

    def handle(self, *args, **options):
        counters = process_due_installments()
        self.stdout.write(self.style.SUCCESS(f"Traitement termine: {counters}"))
