from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Club, Deposit, Loan, LoanBorrower, LoanPurpose, Membership, PlatformSettings, User
from core.services import approve_loan, disburse_loan, fund_loan, review_funding, validate_deposit

PURPOSES = [
    ("Achat de stock", "Reapprovisionnement d'un commerce"),
    ("Materiel et outillage", "Achat d'equipement professionnel"),
    ("Agriculture et elevage", "Semences, intrants, betail"),
    ("Transport", "Achat ou reparation d'un vehicule"),
    ("Frais scolaires", "Scolarite et fournitures"),
    ("Sante", "Frais medicaux"),
    ("Loyer et habitat", "Loyer, travaux, amenagement"),
    ("Fonds de roulement", "Tresorerie courante de l'activite"),
    ("Autre projet", "Tout autre besoin justifie"),
]


class Command(BaseCommand):
    help = "Cree un jeu de donnees REBOOT CLUB pour la demonstration."

    def handle(self, *args, **options):
        password = "Reboot2026!"
        settings_row = PlatformSettings.load()
        settings_row.default_interest_rate = Decimal("20.00")
        settings_row.default_commission_rate = Decimal("10.00")
        settings_row.default_leader_commission_rate = Decimal("5.00")
        settings_row.save()

        for position, (name, description) in enumerate(PURPOSES):
            LoanPurpose.objects.get_or_create(name=name, defaults={"description": description, "position": position})

        users = {}
        profiles = [
            ("admin", "+243810000001", "admin@reboot.club", User.Role.ADMIN, "Amina", "Kabeya"),
            ("chef", "+243810000002", "chef@reboot.club", User.Role.LEADER, "Patrick", "Ilunga"),
            ("preteur", "+243810000003", "preteur@reboot.club", User.Role.LENDER, "Sarah", "Mbuyi"),
            ("emprunteur", "+243810000004", "emprunteur@reboot.club", User.Role.BORROWER, "David", "Kasongo"),
            ("associe", "+243810000005", "associe@reboot.club", User.Role.BORROWER, "Grace", "Mutombo"),
            ("mandataire", "+243810000006", "mandataire@reboot.club", User.Role.COLLECTOR, "Jean", "Lokwa"),
        ]
        for username, phone, email, role, first_name, last_name in profiles:
            user, _ = User.objects.get_or_create(phone=phone, defaults={"username": username, "email": email, "role": role, "first_name": first_name, "last_name": last_name})
            user.username, user.email, user.role = username, email, role
            user.first_name, user.last_name = first_name, last_name
            user.kyc_verified = True
            if role == User.Role.LENDER:
                user.lender_profile_status = User.LenderProfileStatus.ACTIVE
            user.set_password(password)
            user.save()
            users[username] = user

        club, _ = Club.objects.get_or_create(
            name="Reboot Kinshasa Centre",
            defaults={
                "description": "Un club solidaire pour financer les projets locaux.", "zone": "Gombe, Kinshasa",
                "currency": "CDF", "leader": users["chef"], "status": Club.Status.ACTIVE,
                # Cout du credit : 20 % preteur + 10 % application + 5 % chef = 35 % du capital.
                "interest_rate": Decimal("20.00"), "platform_fee_rate": Decimal("10.00"),
                "leader_commission_rate": Decimal("5.00"), "penalty_rate": Decimal("5.00"),
                "min_loan": Decimal("50000"), "max_loan": Decimal("2000000"),
            },
        )
        for username, role in [("chef", Membership.Role.LEADER), ("emprunteur", Membership.Role.BORROWER), ("associe", Membership.Role.BORROWER)]:
            Membership.objects.get_or_create(club=club, user=users[username], role=role, defaults={"status": Membership.Status.ACTIVE})

        if not Deposit.objects.filter(lender=users["preteur"]).exists():
            deposit = Deposit.objects.create(lender=users["preteur"], amount=Decimal("1500000"), currency="CDF", payment_method="mobile_money")
            validate_deposit(deposit, users["admin"])

        if not club.loans.exists():
            purpose = LoanPurpose.objects.get(name="Achat de stock")
            loan = Loan.objects.create(
                club=club, borrower=users["emprunteur"], purpose=purpose.name, purpose_reference=purpose,
                estimated_income=Decimal("450000"), guarantors="Membre garant #001", amount=Decimal("600000"),
                currency="CDF", duration_code="3m", repayment_frequency="monthly", installment_total=3,
                duration_months=3, interest_rate=club.interest_rate, fee_rate=club.platform_fee_rate,
                leader_commission_rate=club.leader_commission_rate,
            )
            LoanBorrower.objects.create(loan=loan, user=users["emprunteur"], is_primary=True, share_amount=loan.amount, status=LoanBorrower.Status.ACCEPTED, responded_at=timezone.now())
            approve_loan(loan, users["chef"])
            approve_loan(loan, users["admin"])
            review_funding(fund_loan(loan, users["preteur"], Decimal("600000")), users["admin"], approve=True)
            loan.refresh_from_db()
            loan = disburse_loan(loan, users["admin"])
            loan.collection_agent = users["mandataire"]
            loan.collection_agent_assigned_at = timezone.now()
            loan.save(update_fields=["collection_agent", "collection_agent_assigned_at"])

        self.stdout.write(self.style.SUCCESS(f"Demo prete. Mot de passe commun: {password}. Admin: +243810000001"))
