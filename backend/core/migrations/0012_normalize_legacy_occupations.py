from django.db import migrations


OCCUPATION_MAP = {
    "commercant": "trader",
    "commercante": "trader",
    "commerce": "trader",
    "entrepreneur": "entrepreneur",
    "artisan": "artisan",
    "agriculteur": "farmer",
    "eleveur": "breeder",
    "pecheur": "fisher",
    "chauffeur": "driver",
    "mecanicien": "mechanic",
    "enseignant": "teacher",
    "agent public": "public_servant",
    "employe": "private_employee",
    "coiffeur": "hairdresser",
    "couturier": "tailor",
    "restaurateur": "restaurateur",
    "etudiant": "student",
}


def normalize_occupations(apps, schema_editor):
    KYCApplication = apps.get_model("core", "KYCApplication")
    valid = {"trader", "entrepreneur", "artisan", "farmer", "breeder", "fisher", "driver", "mechanic", "teacher", "public_servant", "private_employee", "health_worker", "hairdresser", "tailor", "restaurateur", "student", "other"}
    for application in KYCApplication.objects.all().only("id", "occupation"):
        current = (application.occupation or "").strip()
        normalized = current.lower()
        value = current if current in valid else OCCUPATION_MAP.get(normalized, "other")
        if value != current:
            KYCApplication.objects.filter(pk=application.pk).update(occupation=value)


class Migration(migrations.Migration):
    dependencies = [("core", "0011_economic_activities")]

    operations = [migrations.RunPython(normalize_occupations, migrations.RunPython.noop)]
