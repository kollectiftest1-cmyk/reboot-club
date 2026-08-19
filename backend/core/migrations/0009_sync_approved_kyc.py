from django.db import migrations


def sync_approved_kyc(apps, schema_editor):
    User = apps.get_model("core", "User")
    KYCApplication = apps.get_model("core", "KYCApplication")
    approved_user_ids = KYCApplication.objects.filter(status="approved").values_list("user_id", flat=True)
    User.objects.filter(pk__in=approved_user_ids, kyc_verified=False).update(kyc_verified=True)


class Migration(migrations.Migration):
    dependencies = [("core", "0008_membership_leader_approved_at_and_more")]

    operations = [migrations.RunPython(sync_approved_kyc, migrations.RunPython.noop)]
