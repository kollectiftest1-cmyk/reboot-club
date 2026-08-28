from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0015_user_collector_profile_active")]

    operations = [
        migrations.AlterField(
            model_name="dispute",
            name="club",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="disputes", to="core.club"),
        ),
        migrations.CreateModel(
            name="ClubRateTier",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("min_amount", models.DecimalField(decimal_places=2, max_digits=16, validators=[django.core.validators.MinValueValidator(0)])),
                ("max_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=16, null=True, validators=[django.core.validators.MinValueValidator(0)])),
                ("interest_rate", models.DecimalField(decimal_places=2, max_digits=5, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)])),
                ("leader_commission_rate", models.DecimalField(decimal_places=2, max_digits=5, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)])),
                ("platform_fee_rate", models.DecimalField(decimal_places=2, max_digits=5, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)])),
                ("club", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rate_tiers", to="core.club")),
            ],
            options={"ordering": ["min_amount"]},
        ),
        migrations.AddConstraint(
            model_name="clubratetier",
            constraint=models.UniqueConstraint(fields=("club", "min_amount"), name="unique_club_rate_tier_start"),
        ),
    ]
