from django.db import migrations, models


def activate_legacy_collectors(apps, schema_editor):
    User = apps.get_model("core", "User")
    User.objects.filter(role="collector").update(collector_profile_active=True)


class Migration(migrations.Migration):
    dependencies = [("core", "0014_backfill_loan_terms_and_shares")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="collector_profile_active",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(activate_legacy_collectors, migrations.RunPython.noop),
    ]
