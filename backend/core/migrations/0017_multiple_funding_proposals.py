from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0016_club_rate_tiers")]

    operations = [
        migrations.RemoveConstraint(
            model_name="loanfunding",
            name="unique_loan_lender",
        ),
    ]
