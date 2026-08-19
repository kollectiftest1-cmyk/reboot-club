import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


ACTIVITIES = [
    "Cabine de recharge et Mobile Money",
    "Vente de beignets et patisserie",
    "Petit commerce et boutique",
    "Vente de produits alimentaires",
    "Maraichage et agriculture",
    "Elevage",
    "Peche et poissonnerie",
    "Transport moto, taxi ou bus",
    "Atelier mecanique",
    "Couture et retouche",
    "Coiffure et soins esthetiques",
    "Restaurant, malewa et alimentation",
    "Boulangerie",
    "Vente de charbon et bois de chauffe",
    "Quincaillerie",
    "Materiaux de construction",
    "Pharmacie et produits de sante",
    "Informatique, impression et photocopie",
    "Nettoyage et entretien",
    "Location de chaises, tentes et materiel",
    "Vente de friperie et habillement",
    "Fabrication de savon et produits menagers",
    "Menuiserie",
    "Soudure et construction metallique",
    "Briqueterie et fabrication de blocs",
    "Artisanat local",
]


def seed_activities(apps, schema_editor):
    EconomicActivity = apps.get_model("core", "EconomicActivity")
    EconomicActivity.objects.bulk_create([EconomicActivity(name=name, status="active") for name in ACTIVITIES])


class Migration(migrations.Migration):
    dependencies = [("core", "0010_global_lender_profile")]

    operations = [
        migrations.CreateModel(
            name="EconomicActivity",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=180)),
                ("status", models.CharField(choices=[("pending", "En attente"), ("active", "Active"), ("rejected", "Refusee")], default="pending", max_length=16)),
                ("decision_reason", models.TextField(blank=True)),
                ("proposed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="proposed_activities", to=settings.AUTH_USER_MODEL)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("reviewed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="reviewed_activities", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AlterField(
            model_name="kycapplication",
            name="occupation",
            field=models.CharField(choices=[("trader", "Commercant(e)"), ("entrepreneur", "Entrepreneur(e)"), ("artisan", "Artisan(e)"), ("farmer", "Agriculteur(trice)"), ("breeder", "Eleveur(se)"), ("fisher", "Pecheur(se)"), ("driver", "Chauffeur / conducteur"), ("mechanic", "Mecanicien(ne)"), ("teacher", "Enseignant(e)"), ("public_servant", "Agent public"), ("private_employee", "Employe(e) du prive"), ("health_worker", "Professionnel(le) de sante"), ("hairdresser", "Coiffeur(se) / estheticien(ne)"), ("tailor", "Couturier(ere)"), ("restaurateur", "Restaurateur(trice)"), ("student", "Etudiant(e)"), ("other", "Autre")], max_length=32),
        ),
        migrations.AddField(
            model_name="kycapplication",
            name="activity_reference",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="kyc_applications", to="core.economicactivity"),
        ),
        migrations.RunPython(seed_activities, migrations.RunPython.noop),
    ]
