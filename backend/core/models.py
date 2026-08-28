import uuid
from decimal import Decimal

from django.contrib.auth.models import AbstractUser
from django.contrib.auth.base_user import BaseUserManager
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


# ---------------------------------------------------------------------------
# Catalogue des durees de pret et des frequences de remboursement.
# Une duree est exprimee soit en semaines (durees courtes) soit en mois.
# "days" sert uniquement au calcul du nombre d'echeances pour les frequences
# courtes (jour / semaine) : un mois commercial vaut 30 jours.
# ---------------------------------------------------------------------------
LOAN_DURATIONS = {
    "1w": {"label": "1 semaine", "days": 7, "months": 0},
    "2w": {"label": "2 semaines", "days": 14, "months": 0},
    "1m": {"label": "1 mois", "days": 30, "months": 1},
    "2m": {"label": "2 mois", "days": 60, "months": 2},
    "3m": {"label": "3 mois", "days": 90, "months": 3},
    "4m": {"label": "4 mois", "days": 120, "months": 4},
    "5m": {"label": "5 mois", "days": 150, "months": 5},
    "6m": {"label": "6 mois", "days": 180, "months": 6},
    "12m": {"label": "1 annee", "days": 360, "months": 12},
}
LOAN_DURATION_CHOICES = [(code, item["label"]) for code, item in LOAN_DURATIONS.items()]

REPAYMENT_FREQUENCIES = {
    "daily": {"label": "Chaque jour", "days": 1, "months": 0},
    "weekly": {"label": "Chaque semaine", "days": 7, "months": 0},
    "monthly": {"label": "Chaque mois", "days": 30, "months": 1},
    "quarterly": {"label": "Tous les 3 mois", "days": 90, "months": 3},
    "four_monthly": {"label": "Tous les 4 mois", "days": 120, "months": 4},
    "biannual": {"label": "Tous les 6 mois", "days": 180, "months": 6},
    "annual": {"label": "Chaque annee", "days": 360, "months": 12},
}
REPAYMENT_FREQUENCY_CHOICES = [(code, item["label"]) for code, item in REPAYMENT_FREQUENCIES.items()]


def installment_count(duration_code, frequency_code):
    """Nombre d'echeances pour un couple duree / frequence.

    Retourne 0 lorsque la combinaison est incoherente (la frequence ne divise
    pas la duree) ou lorsqu'elle ne produit qu'une seule echeance : une duree
    doit toujours contenir plusieurs periodes de sa frequence.
    """
    duration = LOAN_DURATIONS.get(duration_code)
    frequency = REPAYMENT_FREQUENCIES.get(frequency_code)
    if not duration or not frequency:
        return 0
    if frequency["months"]:
        if not duration["months"] or duration["months"] % frequency["months"]:
            return 0
        count = duration["months"] // frequency["months"]
    else:
        count = duration["days"] // frequency["days"]
    return count if count > 1 else 0


def allowed_frequencies(duration_code):
    return [code for code in REPAYMENT_FREQUENCIES if installment_count(duration_code, code) > 0]


def default_durations():
    return list(LOAN_DURATIONS)


def duration_in_months(duration_code):
    duration = LOAN_DURATIONS.get(duration_code)
    return duration["months"] if duration else 0


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, phone, email, password, **extra_fields):
        if not phone:
            raise ValueError("Le numero de telephone est obligatoire.")
        if not email:
            raise ValueError("L'adresse e-mail est obligatoire.")
        phone = phone.replace(" ", "").replace("-", "")
        email = self.normalize_email(email)
        extra_fields.setdefault("username", f"user_{phone.lstrip('+')}_{uuid.uuid4().hex[:6]}")
        if extra_fields.get("role") == "lender":
            extra_fields.setdefault("lender_profile_status", "active")
        user = self.model(phone=phone, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, phone, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(phone, email, password, **extra_fields)

    def create_superuser(self, phone, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", "admin")
        if extra_fields.get("is_staff") is not True or extra_fields.get("is_superuser") is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff=True et is_superuser=True.")
        return self._create_user(phone, email, password, **extra_fields)


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrateur"
        LEADER = "leader", "Chef de club"
        LENDER = "lender", "Preteur"
        BORROWER = "borrower", "Emprunteur"
        MEDIATOR = "mediator", "Mediateur"
        COLLECTOR = "collector", "Mandataire d'encaissement"

    class LenderProfileStatus(models.TextChoices):
        NOT_REQUESTED = "not_requested", "Non demande"
        PENDING = "pending", "En attente"
        ACTIVE = "active", "Actif"
        REJECTED = "rejected", "Refuse"

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=24, unique=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.BORROWER)
    active_profile = models.CharField(max_length=16, choices=Role.choices, blank=True)
    kyc_verified = models.BooleanField(default=False)
    accepted_terms_at = models.DateTimeField(null=True, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True)
    identity_document = models.FileField(upload_to="kyc/documents/", blank=True)
    selfie = models.ImageField(upload_to="kyc/selfies/", blank=True)
    admin_borrower_rating = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(10)])
    lender_profile_status = models.CharField(max_length=16, choices=LenderProfileStatus.choices, default=LenderProfileStatus.NOT_REQUESTED)
    lender_profile_requested_at = models.DateTimeField(null=True, blank=True)
    lender_profile_reviewed_at = models.DateTimeField(null=True, blank=True)
    lender_profile_reviewed_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_lender_profiles")
    lender_profile_decision_reason = models.TextField(blank=True)
    anonymous_lender = models.BooleanField(default=False)
    collector_profile_active = models.BooleanField(default=False)

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = ["email", "first_name", "last_name"]
    objects = UserManager()

    @property
    def display_name(self):
        return self.get_full_name() or self.phone

    @property
    def public_name(self):
        """Nom expose aux autres membres : masque lorsque le preteur est anonyme."""
        if self.anonymous_lender:
            return "Preteur anonyme"
        return self.display_name

    @property
    def current_profile(self):
        return self.active_profile or self.role

    @property
    def has_valid_kyc(self):
        application = getattr(self, "kyc_application", None)
        return self.kyc_verified or getattr(application, "status", None) == "approved"

    @property
    def available_profiles(self):
        profiles = set(self.memberships.filter(status="active", role__in=["leader", "borrower"]).values_list("role", flat=True))
        if self.lender_profile_status == self.LenderProfileStatus.ACTIVE:
            profiles.add(self.Role.LENDER)
        if self.collector_profile_active or self.role == self.Role.COLLECTOR:
            profiles.add(self.Role.COLLECTOR)
        if self.role in [self.Role.ADMIN, self.Role.LEADER, self.Role.MEDIATOR]:
            profiles.add(self.role)
        return [value for value, _ in self.Role.choices if value in profiles]


class Club(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        ACTIVE = "active", "Actif"
        SUSPENDED = "suspended", "Suspendu"
        FROZEN = "frozen", "Gele"
        ARCHIVED = "archived", "Archive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    zone = models.CharField(max_length=120)
    currency = models.CharField(max_length=3, default="CDF")
    leader = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="managed_clubs")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    # Les trois composantes du cout du credit sont des pourcentages FIXES du
    # capital emprunte : elles ne dependent pas de la duree.
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("20.00"), validators=[MinValueValidator(0), MaxValueValidator(100)], help_text="Interet du preteur en % du capital emprunte.")
    platform_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"), validators=[MinValueValidator(0), MaxValueValidator(100)], help_text="Commission de l'application en % du capital emprunte.")
    leader_commission_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("5.00"), validators=[MinValueValidator(0), MaxValueValidator(100)], help_text="Commission du chef de club en % du capital emprunte.")
    penalty_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("5.00"), validators=[MinValueValidator(0), MaxValueValidator(100)])
    min_loan = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("10000"))
    max_loan = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("1000000"))
    allowed_durations = models.JSONField(default=default_durations, blank=True)
    min_duration_months = models.PositiveSmallIntegerField(default=1)
    max_duration_months = models.PositiveSmallIntegerField(default=12)
    withdrawal_notice_days = models.PositiveSmallIntegerField(default=7)
    max_collective_borrowers = models.PositiveSmallIntegerField(default=3, validators=[MinValueValidator(1), MaxValueValidator(5)])

    @property
    def borrower_charge_rate(self):
        """Taux global affiche a l'emprunteur : il ne voit qu'un seul chiffre."""
        return self.interest_rate + self.platform_fee_rate + self.leader_commission_rate

    @property
    def duration_options(self):
        codes = [code for code in LOAN_DURATIONS if code in (self.allowed_durations or [])]
        return codes or list(LOAN_DURATIONS)

    def rates_for(self, amount):
        amount = Decimal(amount)
        tier = self.rate_tiers.filter(min_amount__lte=amount).filter(
            models.Q(max_amount__isnull=True) | models.Q(max_amount__gte=amount)
        ).order_by("-min_amount").first()
        if tier:
            return {
                "interest_rate": tier.interest_rate,
                "platform_fee_rate": tier.platform_fee_rate,
                "leader_commission_rate": tier.leader_commission_rate,
                "tier": tier,
            }
        if self.rate_tiers.exists():
            return None
        return {
            "interest_rate": self.interest_rate,
            "platform_fee_rate": self.platform_fee_rate,
            "leader_commission_rate": self.leader_commission_rate,
            "tier": None,
        }

    def __str__(self):
        return self.name

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["leader"], condition=models.Q(leader__isnull=False), name="one_club_per_leader"),
        ]


class ClubRateTier(TimeStampedModel):
    club = models.ForeignKey(Club, on_delete=models.CASCADE, related_name="rate_tiers")
    min_amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(0)])
    max_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)])
    leader_commission_rate = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)])
    platform_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)])

    class Meta:
        ordering = ["min_amount"]
        constraints = [models.UniqueConstraint(fields=["club", "min_amount"], name="unique_club_rate_tier_start")]


class Membership(TimeStampedModel):
    class Role(models.TextChoices):
        LEADER = "leader", "Chef"
        LENDER = "lender", "Preteur"
        BORROWER = "borrower", "Emprunteur"

    class Status(models.TextChoices):
        PENDING = "pending", "En attente"
        ACTIVE = "active", "Actif"
        BLOCKED = "blocked", "Bloque"
        SUSPENDED = "suspended", "Suspendu"
        LEFT = "left", "Sorti"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_memberships")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    invited_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="sent_membership_invitations")
    accepted_at = models.DateTimeField(null=True, blank=True)
    member_approved_at = models.DateTimeField(null=True, blank=True)
    leader_approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["club", "user", "role"], name="unique_club_user_role")]


class EconomicActivity(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "En attente"
        ACTIVE = "active", "Active"
        REJECTED = "rejected", "Refusee"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=180)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    proposed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="proposed_activities")
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_activities")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)

    def __str__(self):
        return self.name



class LoanPurpose(TimeStampedModel):
    """Objet d'emprunt propose en liste deroulante et gere par l'administrateur."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=160, unique=True)
    description = models.CharField(max_length=240, blank=True)
    is_active = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_loan_purposes")

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return self.name


class KYCApplication(TimeStampedModel):
    class Occupation(models.TextChoices):
        TRADER = "trader", "Commercant(e)"
        ENTREPRENEUR = "entrepreneur", "Entrepreneur(e)"
        ARTISAN = "artisan", "Artisan(e)"
        FARMER = "farmer", "Agriculteur(trice)"
        BREEDER = "breeder", "Eleveur(se)"
        FISHER = "fisher", "Pecheur(se)"
        DRIVER = "driver", "Chauffeur / conducteur"
        MECHANIC = "mechanic", "Mecanicien(ne)"
        TEACHER = "teacher", "Enseignant(e)"
        PUBLIC_SERVANT = "public_servant", "Agent public"
        PRIVATE_EMPLOYEE = "private_employee", "Employe(e) du prive"
        HEALTH_WORKER = "health_worker", "Professionnel(le) de sante"
        HAIRDRESSER = "hairdresser", "Coiffeur(se) / estheticien(ne)"
        TAILOR = "tailor", "Couturier(ere)"
        RESTAURATEUR = "restaurateur", "Restaurateur(trice)"
        STUDENT = "student", "Etudiant(e)"
        OTHER = "other", "Autre"

    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        SUBMITTED = "submitted", "Soumis"
        REVIEW = "review", "En verification"
        APPROVED = "approved", "Valide"
        REJECTED = "rejected", "Refuse"

    class DocumentType(models.TextChoices):
        VOTER_CARD = "voter_card", "Carte d'electeur"
        NATIONAL_ID = "national_id", "Carte nationale"
        PASSPORT = "passport", "Passeport"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="kyc_application")
    activity = models.CharField(max_length=180)
    occupation = models.CharField(max_length=32, choices=Occupation.choices)
    activity_reference = models.ForeignKey(EconomicActivity, null=True, blank=True, on_delete=models.SET_NULL, related_name="kyc_applications")
    employer_or_business = models.CharField(max_length=180, blank=True)
    monthly_income = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    address = models.CharField(max_length=240)
    document_type = models.CharField(max_length=24, choices=DocumentType.choices, default=DocumentType.VOTER_CARD)
    document_number = models.CharField(max_length=80)
    identity_document = models.FileField(upload_to="kyc/documents/")
    selfie = models.ImageField(upload_to="kyc/selfies/")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    decision_reason = models.TextField(blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_kyc_applications")


class FinancialModel(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    currency = models.CharField(max_length=3, default="CDF")
    reference = models.CharField(max_length=32, unique=True, editable=False)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self.reference:
            prefix = self.__class__.__name__[:3].upper()
            self.reference = f"{prefix}-{uuid.uuid4().hex[:12].upper()}"
        super().save(*args, **kwargs)


class Deposit(FinancialModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        PENDING = "pending", "En attente"
        VALIDATED = "validated", "Valide"
        REJECTED = "rejected", "Refuse"
        CANCELLED = "cancelled", "Annule"

    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="deposits")
    lender = models.ForeignKey(User, on_delete=models.PROTECT, related_name="deposits")
    payment_method = models.CharField(max_length=40, default="cash")
    provider_reference = models.CharField(max_length=100, blank=True)
    proof = models.ImageField(upload_to="deposit-proofs/", blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    validated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="validated_deposits")
    validated_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)


class Loan(FinancialModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        PENDING_PARTNERS = "pending_partners", "En attente des co-emprunteurs"
        SUBMITTED = "submitted", "Soumis"
        REVIEW = "review", "En etude"
        APPROVED = "approved", "Valide"
        REJECTED = "rejected", "Refuse"
        DISBURSED = "disbursed", "Decaisse"
        CURRENT = "current", "En cours"
        LATE = "late", "En retard"
        REPAID = "repaid", "Rembourse"
        DISPUTED = "disputed", "Litigieux"
        CANCELLED = "cancelled", "Annule"

    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="loans")
    borrower = models.ForeignKey(User, on_delete=models.PROTECT, related_name="loans")
    purpose = models.CharField(max_length=240)
    purpose_reference = models.ForeignKey(LoanPurpose, null=True, blank=True, on_delete=models.PROTECT, related_name="loans")
    estimated_income = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    guarantors = models.TextField(blank=True)
    duration_code = models.CharField(max_length=8, choices=LOAN_DURATION_CHOICES, default="3m")
    repayment_frequency = models.CharField(max_length=16, choices=REPAYMENT_FREQUENCY_CHOICES, default="monthly")
    installment_total = models.PositiveSmallIntegerField(default=1)
    duration_months = models.PositiveSmallIntegerField(default=0)
    is_collective = models.BooleanField(default=False)
    collection_agent = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="collected_loans")
    collection_agent_assigned_at = models.DateTimeField(null=True, blank=True)
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2, help_text="Interet du preteur en % du capital.")
    fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0, help_text="Commission de l'application en % du capital.")
    leader_commission_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0, help_text="Commission du chef de club en % du capital.")
    interest_total = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    fee_total = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    leader_commission_total = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    total_due = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    total_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    decision_reason = models.TextField(blank=True)
    approved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="approved_loans")
    approved_at = models.DateTimeField(null=True, blank=True)
    disbursed_at = models.DateTimeField(null=True, blank=True)
    funding_completed_at = models.DateTimeField(null=True, blank=True)
    scheduled_disbursement_date = models.DateField(null=True, blank=True)

    @property
    def balance(self):
        return max(self.total_due - self.total_paid, Decimal("0"))

    @property
    def charge_total(self):
        """Cout total du credit vu par l'emprunteur (interet + les 2 commissions)."""
        return self.interest_total + self.fee_total + self.leader_commission_total

    @property
    def charge_rate(self):
        return self.interest_rate + self.fee_rate + self.leader_commission_rate

    @property
    def duration_label(self):
        return LOAN_DURATIONS.get(self.duration_code, {}).get("label", self.duration_code)

    @property
    def frequency_label(self):
        return REPAYMENT_FREQUENCIES.get(self.repayment_frequency, {}).get("label", self.repayment_frequency)

    @property
    def funded_amount(self):
        """Capital reellement engage : seuls les placements valides comptent."""
        return self.fundings.aggregate(total=models.Sum("amount"))["total"] or Decimal("0")

    @property
    def pending_funding_amount(self):
        return self.fundings.aggregate(total=models.Sum("pending_amount"))["total"] or Decimal("0")

    @property
    def funding_remaining(self):
        return max(self.amount - self.funded_amount, Decimal("0"))

    @property
    def funding_open_amount(self):
        """Montant encore ouvert; les propositions en attente ne bloquent pas les autres."""
        return self.funding_remaining


class LoanBorrower(TimeStampedModel):
    """Quote-part d'un co-emprunteur dans un pret collectif."""

    class Status(models.TextChoices):
        ACCEPTED = "accepted", "Acceptee"
        PENDING = "pending", "En attente"
        DECLINED = "declined", "Refusee"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="borrowers")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="loan_shares")
    share_amount = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    # True lorsque la personne a saisi elle-meme sa part. Les parts non saisies
    # se partagent le reliquat a parts egales.
    share_is_manual = models.BooleanField(default=False)
    is_primary = models.BooleanField(default=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    responded_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    principal_repaid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    total_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)

    class Meta:
        ordering = ["-is_primary", "created_at"]
        constraints = [models.UniqueConstraint(fields=["loan", "user"], name="unique_loan_borrower")]

    @property
    def share_ratio(self):
        if not self.loan.amount:
            return Decimal("0")
        return self.share_amount / self.loan.amount


class LoanFunding(TimeStampedModel):
    """Placement d'un preteur sur un pret.

    ``amount`` = capital valide par l'administrateur (seul montant qui finance
    reellement le pret). ``pending_amount`` = montant soumis en attente de
    validation : il est deja reserve sur le capital libre du preteur mais ne
    finance pas encore le pret.
    """

    loan = models.ForeignKey(Loan, on_delete=models.PROTECT, related_name="fundings")
    lender = models.ForeignKey(User, on_delete=models.PROTECT, related_name="loan_fundings")
    amount = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    pending_amount = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_fundings")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    expected_gain = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    principal_repaid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    interest_earned = models.DecimalField(max_digits=16, decimal_places=2, default=0)

    @property
    def review_status(self):
        if self.pending_amount > 0:
            return "pending"
        if self.amount > 0:
            return "validated"
        return "rejected"


class Installment(TimeStampedModel):
    class Status(models.TextChoices):
        UPCOMING = "upcoming", "A venir"
        DUE = "due", "Due"
        PARTIAL = "partial", "Partielle"
        PAID = "paid", "Payee"
        LATE = "late", "En retard"
        CANCELLED = "cancelled", "Annulee"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    loan = models.ForeignKey(Loan, on_delete=models.PROTECT, related_name="installments")
    number = models.PositiveSmallIntegerField()
    due_date = models.DateField()
    principal_due = models.DecimalField(max_digits=16, decimal_places=2)
    interest_due = models.DecimalField(max_digits=16, decimal_places=2)
    fee_due = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    leader_commission_due = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    penalty_due = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.UPCOMING)

    class Meta:
        ordering = ["due_date", "number"]
        constraints = [models.UniqueConstraint(fields=["loan", "number"], name="unique_loan_installment")]

    @property
    def total_due(self):
        return self.principal_due + self.interest_due + self.fee_due + self.leader_commission_due + self.penalty_due

    @property
    def charge_due(self):
        """Part "interets" affichee a l'emprunteur : les trois composantes reunies."""
        return self.interest_due + self.fee_due + self.leader_commission_due


class Repayment(FinancialModel):
    class Status(models.TextChoices):
        PENDING = "pending", "En attente"
        VALIDATED = "validated", "Valide"
        REJECTED = "rejected", "Refuse"
        REVERSED = "reversed", "Contrepasse"

    loan = models.ForeignKey(Loan, on_delete=models.PROTECT, related_name="repayments")
    payer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="repayments")
    payment_method = models.CharField(max_length=40, default="cash")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VALIDATED)
    principal_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    interest_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    fee_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    leader_commission_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    penalty_paid = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="recorded_repayments")


class Withdrawal(FinancialModel):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Soumise"
        REVIEW = "review", "En etude"
        APPROVED = "approved", "Validee"
        REJECTED = "rejected", "Refusee"
        PAID = "paid", "Payee"
        CANCELLED = "cancelled", "Annulee"

    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="withdrawals")
    lender = models.ForeignKey(User, on_delete=models.PROTECT, related_name="withdrawals")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    decision_reason = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_withdrawals")


class Notification(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=120)
    message = models.TextField()
    kind = models.CharField(max_length=40, default="info")
    read_at = models.DateTimeField(null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)


class OTPChallenge(models.Model):
    class Purpose(models.TextChoices):
        REGISTER = "register", "Inscription"
        LOGIN = "login", "Connexion"
        RECOVERY = "recovery", "Recuperation"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=24, db_index=True)
    code_hash = models.CharField(max_length=160)
    purpose = models.CharField(max_length=16, choices=Purpose.choices)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    verified_at = models.DateTimeField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ClubMessage(TimeStampedModel):
    class Kind(models.TextChoices):
        TEXT = "text", "Message"
        ANNOUNCEMENT = "announcement", "Annonce"
        PRIVATE = "private", "Prive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="messages")
    sender = models.ForeignKey(User, on_delete=models.PROTECT, related_name="sent_club_messages")
    recipient = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="received_club_messages")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.TEXT)
    body = models.TextField(max_length=2000)
    read_by = models.ManyToManyField(User, related_name="read_club_messages", blank=True)

    class Meta:
        ordering = ["created_at"]


class Dispute(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Ouvert"
        REVIEW = "review", "En analyse"
        RESOLVED = "resolved", "Resolu"
        REJECTED = "rejected", "Rejete"
        CLOSED = "closed", "Clos"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="disputes")
    opened_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="opened_disputes")
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="assigned_disputes")
    operation_type = models.CharField(max_length=32)
    operation_id = models.CharField(max_length=64, blank=True)
    subject = models.CharField(max_length=160)
    description = models.TextField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    frozen = models.BooleanField(default=False)
    decision = models.TextField(blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)


class Invitation(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "En attente"
        ACCEPTED = "accepted", "Acceptee"
        CANCELLED = "cancelled", "Annulee"
        EXPIRED = "expired", "Expiree"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.CASCADE, related_name="invitations")
    phone = models.CharField(max_length=24)
    email = models.EmailField(blank=True)
    role = models.CharField(max_length=16, choices=User.Role.choices)
    membership_role = models.CharField(max_length=16, choices=Membership.Role.choices, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="created_invitations")
    accepted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="accepted_invitations")
    expires_at = models.DateTimeField()


class PlatformSettings(TimeStampedModel):
    platform_name = models.CharField(max_length=80, default="REBOOT CLUB")
    default_currency = models.CharField(max_length=3, default="CDF")
    default_interest_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("20.00"), help_text="Interet du preteur en % du capital emprunte.")
    default_commission_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"), help_text="Commission de l'application en % du capital emprunte.")
    default_leader_commission_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("5.00"), help_text="Commission du chef de club en % du capital emprunte.")
    default_penalty_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("5.00"))
    max_loan = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("1000000"))
    default_collective_borrowers = models.PositiveSmallIntegerField(default=3)
    require_double_validation = models.BooleanField(default=True)
    kyc_required = models.BooleanField(default=True)
    maintenance_mode = models.BooleanField(default=False)
    support_phone = models.CharField(max_length=24, blank=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="audit_logs")
    action = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80)
    object_id = models.CharField(max_length=64)
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="audit_logs")
    old_values = models.JSONField(default=dict, blank=True)
    new_values = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
