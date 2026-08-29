from django.db import migrations


def clear_removed_borrower_shares(apps, schema_editor):
    LoanBorrower = apps.get_model("core", "LoanBorrower")
    LoanBorrower.objects.filter(status="removed").exclude(share_amount=0).update(share_amount=0)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_withdrawal_destination"),
    ]

    operations = [
        migrations.RunPython(clear_removed_borrower_shares, migrations.RunPython.noop),
    ]
