"""Reprise des donnees existantes apres le passage aux taux fixes.

- Chaque pret recoit une duree codifiee et une frequence de remboursement.
- Chaque pret existant devient un pret individuel avec une quote-part unique.
- Les echeances deja generees conservent leurs montants : seule la nouvelle
  colonne de commission du chef de club est initialisee a zero.
"""

from decimal import Decimal

from django.db import migrations

DURATION_BY_MONTHS = {
    1: "1m", 2: "2m", 3: "3m", 4: "4m", 5: "5m", 6: "6m",
    7: "12m", 8: "12m", 9: "12m", 10: "12m", 11: "12m", 12: "12m",
}


def forwards(apps, schema_editor):
    Loan = apps.get_model("core", "Loan")
    LoanBorrower = apps.get_model("core", "LoanBorrower")

    for loan in Loan.objects.all().iterator():
        months = loan.duration_months or 3
        # `update()` plutot que `save(update_fields=...)` : une ligne heritee
        # incoherente ne doit jamais interrompre la reprise complete.
        Loan.objects.filter(pk=loan.pk).update(
            duration_code=DURATION_BY_MONTHS.get(months, "12m"),
            repayment_frequency="monthly",
            installment_total=loan.installments.count() or max(months, 1),
            leader_commission_rate=loan.leader_commission_rate or Decimal("0"),
        )
        LoanBorrower.objects.get_or_create(
            loan=loan, user_id=loan.borrower_id,
            defaults={
                "share_amount": loan.amount,
                "is_primary": True,
                "status": "accepted",
                "responded_at": loan.created_at,
                "total_paid": loan.total_paid,
            },
        )


def backwards(apps, schema_editor):
    apps.get_model("core", "LoanBorrower").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0013_flat_rates_frequencies_collective_loans")]
    operations = [migrations.RunPython(forwards, backwards)]
