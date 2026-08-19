from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def migrate_lender_profiles(apps, schema_editor):
    User = apps.get_model("core", "User")
    Membership = apps.get_model("core", "Membership")
    active_user_ids = Membership.objects.filter(role="lender", status="active").values_list("user_id", flat=True)
    pending_user_ids = Membership.objects.filter(role="lender", status="pending").values_list("user_id", flat=True)
    User.objects.filter(models.Q(role="lender") | models.Q(pk__in=active_user_ids)).update(lender_profile_status="active")
    User.objects.filter(pk__in=pending_user_ids, lender_profile_status="not_requested").update(lender_profile_status="pending")
    Membership.objects.filter(role="lender").update(status="left", decision_reason="Profil preteur migre au niveau global.")


class Migration(migrations.Migration):
    dependencies = [("core", "0009_sync_approved_kyc")]

    operations = [
        migrations.AddField(model_name="user", name="lender_profile_status", field=models.CharField(choices=[("not_requested", "Non demande"), ("pending", "En attente"), ("active", "Actif"), ("rejected", "Refuse")], default="not_requested", max_length=16)),
        migrations.AddField(model_name="user", name="lender_profile_requested_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="user", name="lender_profile_reviewed_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="user", name="lender_profile_reviewed_by", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="reviewed_lender_profiles", to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name="user", name="lender_profile_decision_reason", field=models.TextField(blank=True)),
        migrations.RunPython(migrate_lender_profiles, migrations.RunPython.noop),
    ]
