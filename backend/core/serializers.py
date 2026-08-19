from decimal import Decimal

from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers

from .models import (
    LOAN_DURATIONS, REPAYMENT_FREQUENCIES, duration_in_months,
    AuditLog, Club, ClubMessage, Deposit, Dispute, EconomicActivity, Installment, Invitation, KYCApplication,
    Loan, LoanBorrower, LoanFunding, LoanPurpose, Membership, Notification, OTPChallenge, PlatformSettings,
    Repayment, User, Withdrawal, allowed_frequencies, installment_count,
)
from .services import add_months, borrower_credit_score, club_finances, loan_cost_breakdown, money


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name", read_only=True)
    public_name = serializers.CharField(read_only=True)
    current_profile = serializers.CharField(read_only=True)
    available_profiles = serializers.ListField(child=serializers.CharField(), read_only=True)
    kyc_verified = serializers.BooleanField(source="has_valid_kyc", read_only=True)
    profile_requests = serializers.SerializerMethodField()
    credit_score = serializers.SerializerMethodField()
    kyc_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "phone", "first_name", "last_name", "name", "public_name", "role", "current_profile", "available_profiles", "profile_requests", "lender_profile_status", "anonymous_lender", "kyc_verified", "kyc_status", "avatar", "identity_document", "selfie", "admin_borrower_rating", "credit_score", "is_active"]
        read_only_fields = ["role", "kyc_verified"]

    def get_credit_score(self, obj):
        return borrower_credit_score(obj)

    def get_kyc_status(self, obj):
        application = getattr(obj, "kyc_application", None)
        return application.status if application else "not_submitted"

    def get_profile_requests(self, obj):
        requests = []
        if obj.lender_profile_status == User.LenderProfileStatus.PENDING:
            requests.append({
                "id": str(obj.id), "club": None, "club_name": "Tous les clubs", "role": User.Role.LENDER,
                "status": "pending", "member_approved": True, "leader_approved": False, "requires_leader": False,
            })
        requests.extend({
            "id": str(membership.id),
            "club": str(membership.club_id),
            "club_name": membership.club.name,
            "role": membership.role,
            "status": membership.status,
            "member_approved": bool(membership.member_approved_at),
            "leader_approved": bool(membership.leader_approved_at),
            "requires_leader": True,
        } for membership in obj.memberships.select_related("club").filter(
            role=Membership.Role.BORROWER,
            status=Membership.Status.PENDING,
        ).order_by("-created_at"))
        return requests


class EconomicActivitySerializer(serializers.ModelSerializer):
    proposed_by_detail = UserSerializer(source="proposed_by", read_only=True)

    class Meta:
        model = EconomicActivity
        fields = ["id", "name", "status", "proposed_by", "proposed_by_detail", "decision_reason", "reviewed_at", "created_at"]
        read_only_fields = fields


class KYCApplicationSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    activity = serializers.CharField(required=False)
    activity_reference = serializers.PrimaryKeyRelatedField(read_only=True)
    activity_id = serializers.PrimaryKeyRelatedField(source="activity_reference", queryset=EconomicActivity.objects.filter(status=EconomicActivity.Status.ACTIVE), write_only=True, required=False)
    activity_other = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=180)
    occupation_label = serializers.CharField(source="get_occupation_display", read_only=True)

    class Meta:
        model = KYCApplication
        fields = ["id", "user", "user_detail", "activity", "activity_reference", "activity_id", "activity_other", "occupation", "occupation_label", "employer_or_business", "monthly_income", "address", "document_type", "document_number", "identity_document", "selfie", "status", "decision_reason", "submitted_at", "reviewed_at", "created_at", "updated_at"]
        read_only_fields = ["user", "status", "decision_reason", "submitted_at", "reviewed_at"]

    def validate(self, attrs):
        activity_reference = attrs.get("activity_reference")
        activity_other = (attrs.get("activity_other") or attrs.get("activity") or "").strip()
        if not activity_reference and not activity_other:
            raise serializers.ValidationError({"activity_id": "Selectionnez une activite ou precisez Autre."})
        if activity_reference and activity_other:
            raise serializers.ValidationError({"activity_other": "Ne precisez une activite que lorsque vous choisissez Autre."})
        document = attrs.get("identity_document")
        selfie = attrs.get("selfie")
        if document and document.size > 10 * 1024 * 1024:
            raise serializers.ValidationError({"identity_document": "Le document ne peut pas depasser 10 Mo."})
        if selfie and selfie.size > 5 * 1024 * 1024:
            raise serializers.ValidationError({"selfie": "La photo ne peut pas depasser 5 Mo."})
        if document and document.content_type not in ["image/jpeg", "image/png", "application/pdf"]:
            raise serializers.ValidationError({"identity_document": "Utilisez une image JPG, PNG ou un fichier PDF."})
        if selfie and selfie.content_type not in ["image/jpeg", "image/png"]:
            raise serializers.ValidationError({"selfie": "Utilisez une photo JPG ou PNG."})
        number = attrs.get("document_number", "").strip()
        queryset = KYCApplication.objects.filter(document_number__iexact=number).exclude(status=KYCApplication.Status.REJECTED)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError({"document_number": "Ce numero de document est deja utilise."})
        return attrs

    def _resolve_activity(self, validated_data):
        custom_name = (validated_data.pop("activity_other", "") or validated_data.pop("activity", "")).strip()
        reference = validated_data.get("activity_reference")
        if custom_name:
            user = validated_data.get("user") or getattr(self.instance, "user", None)
            reference = EconomicActivity.objects.create(name=custom_name, proposed_by=user)
            validated_data["activity_reference"] = reference
            validated_data["activity"] = custom_name
        else:
            validated_data["activity"] = reference.name
        return validated_data

    def create(self, validated_data):
        return super().create(self._resolve_activity(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._resolve_activity(validated_data))


class ManagedUserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name", read_only=True)
    password = serializers.CharField(write_only=True, validators=[validate_password])
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all(), write_only=True, required=False)
    membership_role = serializers.ChoiceField(choices=Membership.Role.choices, write_only=True, required=False)

    class Meta:
        model = User
        fields = ["id", "email", "phone", "first_name", "last_name", "name", "role", "password", "club", "membership_role", "kyc_verified", "is_active"]
        read_only_fields = ["kyc_verified", "is_active"]

    def validate(self, attrs):
        request = self.context["request"]
        if not attrs.get("first_name", "").strip() or not attrs.get("last_name", "").strip():
            raise serializers.ValidationError("Le prenom et le nom sont obligatoires.")
        if request.user.role == User.Role.LEADER:
            club = attrs.get("club")
            if not club or club.leader_id != request.user.id:
                raise serializers.ValidationError({"club": "Vous devez choisir un club que vous dirigez."})
            if attrs.get("role") not in [User.Role.LENDER, User.Role.BORROWER]:
                raise serializers.ValidationError({"role": "Un chef peut creer uniquement des preteurs et emprunteurs."})
        return attrs

    def create(self, validated_data):
        club = validated_data.pop("club", None)
        membership_role = validated_data.pop("membership_role", None)
        password = validated_data.pop("password")
        user = User.objects.create_user(password=password, **validated_data)
        if club and user.role in [User.Role.LEADER, User.Role.BORROWER]:
            defaults = {User.Role.LEADER: Membership.Role.LEADER, User.Role.BORROWER: Membership.Role.BORROWER}
            role = membership_role or defaults[user.role]
            is_leader = role == Membership.Role.LEADER
            Membership.objects.create(
                club=club, user=user, role=role,
                status=Membership.Status.ACTIVE if is_leader else Membership.Status.PENDING,
                reviewed_by=self.context["request"].user if is_leader else None,
                reviewed_at=timezone.now() if is_leader else None,
                invited_by=self.context["request"].user,
                leader_approved_at=timezone.now() if club.leader_id == self.context["request"].user.id else None,
            )
        return user


class ManagedUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["email", "phone", "first_name", "last_name", "role", "kyc_verified", "is_active"]

    def validate(self, attrs):
        if self.context["request"].user.role != User.Role.ADMIN and not self.context["request"].user.is_superuser:
            raise serializers.ValidationError("Modification reservee a l'administrateur.")
        return attrs


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    otp_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "phone", "first_name", "last_name", "password", "otp_id"]

    def validate_phone(self, value):
        normalized = value.replace(" ", "").replace("-", "")
        if not normalized.startswith("+") or not normalized[1:].isdigit() or len(normalized) < 10:
            raise serializers.ValidationError("Utilisez le format international, par exemple +243810000000.")
        return normalized

    def validate(self, attrs):
        challenge = OTPChallenge.objects.filter(
            pk=attrs["otp_id"], phone=attrs["phone"], purpose=OTPChallenge.Purpose.REGISTER,
            verified_at__isnull=False, consumed_at__isnull=True,
        ).first()
        if not challenge:
            raise serializers.ValidationError({"otp_id": "La verification OTP est invalide ou expiree."})
        attrs["otp_challenge"] = challenge
        return attrs

    def create(self, validated_data):
        challenge = validated_data.pop("otp_challenge")
        validated_data.pop("otp_id")
        validated_data["accepted_terms_at"] = timezone.now()
        user = User.objects.create_user(**validated_data)
        challenge.consumed_at = timezone.now()
        challenge.save(update_fields=["consumed_at"])
        return user


class ClubSerializer(serializers.ModelSerializer):
    leader_name = serializers.SerializerMethodField()
    leader_avatar = serializers.ImageField(source="leader.avatar", read_only=True)
    leader_selfie = serializers.ImageField(source="leader.selfie", read_only=True)
    member_count = serializers.SerializerMethodField()
    finances = serializers.SerializerMethodField()
    borrower_charge_rate = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    duration_options = serializers.SerializerMethodField()

    class Meta:
        model = Club
        fields = [
            "id", "name", "description", "zone", "currency", "leader", "leader_name", "leader_avatar", "leader_selfie", "status",
            "interest_rate", "penalty_rate", "platform_fee_rate", "leader_commission_rate", "borrower_charge_rate",
            "min_loan", "max_loan", "allowed_durations", "duration_options", "max_collective_borrowers",
            "min_duration_months", "max_duration_months", "withdrawal_notice_days",
            "member_count", "finances", "created_at",
        ]

    def get_member_count(self, obj) -> int:
        return obj.memberships.filter(status=Membership.Status.ACTIVE).values("user").distinct().count()

    def get_leader_name(self, obj) -> str:
        return obj.leader.display_name if obj.leader else "Aucun chef assigne"

    def validate_leader(self, leader):
        if leader is None:
            return leader
        queryset = Club.objects.filter(leader=leader)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("Cette personne dirige deja un autre club.")
        if leader.role != User.Role.LEADER:
            raise serializers.ValidationError("Le compte selectionne doit avoir le role Chef de club.")
        return leader

    def get_finances(self, obj) -> dict[str, str]:
        return {key: str(value) for key, value in club_finances(obj).items()}

    def get_duration_options(self, obj) -> list:
        return [{
            "code": code,
            "label": LOAN_DURATIONS[code]["label"],
            "frequencies": [{
                "code": frequency,
                "label": REPAYMENT_FREQUENCIES[frequency]["label"],
                "installments": installment_count(code, frequency),
            } for frequency in allowed_frequencies(code)],
        } for code in obj.duration_options]

    def validate_allowed_durations(self, value):
        codes = [code for code in (value or []) if code in LOAN_DURATIONS]
        if not codes:
            raise serializers.ValidationError("Selectionnez au moins une duree autorisee.")
        return codes

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False) and not (user.is_superuser or user.role == User.Role.ADMIN):
            # Le chef de club ne voit ni la commission de l'application ni l'interet du preteur.
            if user.current_profile == User.Role.LEADER:
                data["platform_fee_rate"] = None
                data["interest_rate"] = None
                finances = data.get("finances") or {}
                for key in ["deposited", "available", "withdrawn"]:
                    finances.pop(key, None)
                data["finances"] = finances
            elif user.current_profile == User.Role.BORROWER:
                data["platform_fee_rate"] = None
                data["interest_rate"] = None
                data["leader_commission_rate"] = None
                data["finances"] = {}
        return data


class MembershipSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "club", "club_name", "user", "user_detail", "role", "status", "decision_reason", "invited_by", "accepted_at", "member_approved_at", "leader_approved_at", "reviewed_at", "created_at"]
        read_only_fields = ["status", "decision_reason", "invited_by", "accepted_at", "member_approved_at", "leader_approved_at", "reviewed_at"]
        validators = []


class DepositSerializer(serializers.ModelSerializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all(), required=False, allow_null=True)
    lender_name = serializers.CharField(source="lender.display_name", read_only=True)
    lender_avatar = serializers.ImageField(source="lender.avatar", read_only=True)
    lender_selfie = serializers.ImageField(source="lender.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True, default="Portefeuille global")

    class Meta:
        model = Deposit
        fields = [
            "id", "reference", "club", "club_name", "lender", "lender_name", "lender_avatar", "lender_selfie", "amount", "currency",
            "payment_method", "provider_reference", "proof", "status", "decision_reason", "validated_at", "created_at",
        ]
        read_only_fields = ["reference", "status", "decision_reason", "validated_at"]


class InstallmentSerializer(serializers.ModelSerializer):
    total_due = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    charge_due = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    remaining_due = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Installment
        fields = ["id", "number", "due_date", "principal_due", "interest_due", "fee_due", "leader_commission_due", "charge_due", "penalty_due", "total_due", "paid_amount", "remaining_due", "progress_percent", "status"]

    def get_remaining_due(self, obj):
        return max(obj.total_due - obj.paid_amount, Decimal("0"))

    def get_progress_percent(self, obj):
        if not obj.total_due:
            return 100
        return min(100, round(obj.paid_amount / obj.total_due * 100))


class LoanPurposeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoanPurpose
        fields = ["id", "name", "description", "is_active", "position", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value):
        name = value.strip()
        queryset = LoanPurpose.objects.filter(name__iexact=name)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("Cet objet de pret existe deja.")
        return name


class LoanFundingSerializer(serializers.ModelSerializer):
    lender_name = serializers.CharField(source="lender.public_name", read_only=True)
    review_status = serializers.CharField(read_only=True)
    loan_reference = serializers.CharField(source="loan.reference", read_only=True)
    club_name = serializers.CharField(source="loan.club.name", read_only=True)
    currency = serializers.CharField(source="loan.currency", read_only=True)

    class Meta:
        model = LoanFunding
        fields = [
            "id", "loan", "loan_reference", "club_name", "currency", "lender", "lender_name", "amount",
            "pending_amount", "review_status", "submitted_at", "reviewed_at", "decision_reason",
            "expected_gain", "principal_repaid", "interest_earned", "created_at",
        ]
        read_only_fields = fields


class LoanBorrowerSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    name = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = LoanBorrower
        fields = ["id", "user", "name", "user_detail", "share_amount", "is_primary", "status", "responded_at", "decision_reason", "principal_repaid", "total_paid"]
        read_only_fields = fields


class LoanSerializer(serializers.ModelSerializer):
    borrower_name = serializers.CharField(source="borrower.display_name", read_only=True)
    borrower_avatar = serializers.ImageField(source="borrower.avatar", read_only=True)
    borrower_selfie = serializers.ImageField(source="borrower.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)
    balance = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    installments = InstallmentSerializer(many=True, read_only=True)
    fundings = LoanFundingSerializer(many=True, read_only=True)
    borrowers = LoanBorrowerSerializer(many=True, read_only=True)
    funded_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    funding_remaining = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    funding_open_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    pending_funding_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    charge_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    charge_rate = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    duration_label = serializers.CharField(read_only=True)
    frequency_label = serializers.CharField(read_only=True)
    collection_agent_name = serializers.CharField(source="collection_agent.display_name", read_only=True)
    purpose = serializers.CharField(max_length=240, required=False, allow_blank=True)
    purpose_id = serializers.PrimaryKeyRelatedField(source="purpose_reference", queryset=LoanPurpose.objects.filter(is_active=True), write_only=True, required=False, allow_null=True)
    partners = serializers.ListField(child=serializers.IntegerField(), write_only=True, required=False)
    shares = serializers.DictField(child=serializers.DecimalField(max_digits=16, decimal_places=2), write_only=True, required=False)
    can_fund = serializers.SerializerMethodField()
    can_collect = serializers.SerializerMethodField()
    my_funding = serializers.SerializerMethodField()
    my_share = serializers.SerializerMethodField()
    my_available_capital = serializers.SerializerMethodField()
    repayments = serializers.SerializerMethodField()
    borrower_credit_score = serializers.SerializerMethodField()
    borrower_admin_rating = serializers.IntegerField(source="borrower.admin_borrower_rating", read_only=True)

    class Meta:
        model = Loan
        fields = [
            "id", "reference", "club", "club_name", "borrower", "borrower_name", "borrower_avatar", "borrower_selfie",
            "purpose", "purpose_reference", "purpose_id", "estimated_income", "guarantors", "amount", "currency",
            "duration_code", "duration_label", "repayment_frequency", "frequency_label", "installment_total",
            "duration_months", "is_collective", "partners", "shares", "borrowers", "my_share",
            "collection_agent", "collection_agent_name", "can_collect",
            "interest_rate", "fee_rate", "leader_commission_rate", "charge_rate",
            "interest_total", "fee_total", "leader_commission_total", "charge_total",
            "total_due", "total_paid", "balance", "status", "decision_reason", "approved_at",
            "disbursed_at", "funding_completed_at", "scheduled_disbursement_date", "funded_amount",
            "funding_remaining", "funding_open_amount", "pending_funding_amount", "can_fund", "my_funding",
            "my_available_capital", "borrower_credit_score", "borrower_admin_rating", "installments",
            "fundings", "repayments", "created_at",
        ]
        read_only_fields = [
            "reference", "borrower", "currency", "interest_rate", "fee_rate", "leader_commission_rate",
            "interest_total", "fee_total", "leader_commission_total", "installment_total", "duration_months",
            "is_collective", "collection_agent", "purpose_reference",
            "total_due", "total_paid", "status", "decision_reason", "approved_at", "disbursed_at",
            "funding_completed_at", "scheduled_disbursement_date",
        ]

    # ------------------------------------------------------------------ lecture
    def get_can_fund(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if request.user.role == User.Role.ADMIN or request.user.is_superuser:
            return True
        return request.user.lender_profile_status == User.LenderProfileStatus.ACTIVE

    def get_can_collect(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if request.user.role == User.Role.ADMIN or request.user.is_superuser:
            return True
        return bool(obj.collection_agent_id and obj.collection_agent_id == request.user.id)

    def get_borrower_credit_score(self, obj):
        return borrower_credit_score(obj.borrower)

    def get_my_available_capital(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated or request.user.current_profile != User.Role.LENDER:
            return None
        if not hasattr(request, "_lender_total_available"):
            from .services import lender_total_available
            request._lender_total_available = lender_total_available(request.user)
        return request._lender_total_available

    def get_my_share(self, obj):
        """Quote-part du co-emprunteur connecte dans un pret collectif."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        row = next((item for item in obj.borrowers.all() if item.user_id == request.user.id), None)
        if not row:
            return None
        ratio = row.share_amount / obj.amount if obj.amount else Decimal("0")
        share_due = money(obj.total_due * ratio)
        return {
            "id": str(row.id),
            "share_amount": row.share_amount,
            "share_percent": round(float(ratio) * 100, 2),
            "status": row.status,
            "is_primary": row.is_primary,
            "total_due": share_due,
            "total_paid": row.total_paid,
            "balance": max(share_due - row.total_paid, Decimal("0")),
            "charge_total": money(obj.charge_total * ratio),
        }

    def get_my_funding(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        funding = next((item for item in obj.fundings.all() if item.lender_id == request.user.id), None)
        if not funding:
            return None
        received = funding.principal_repaid + funding.interest_earned
        expected_total = funding.amount + funding.expected_gain
        received_cursor = received
        schedule = []
        installments = list(obj.installments.all())
        ratio = funding.amount / obj.amount if obj.amount else Decimal("0")
        for installment in installments:
            # Le preteur ne voit que SA quote-part de capital et SON interet :
            # ni la commission de l'application ni celle du chef de club.
            expected = money((installment.principal_due + installment.interest_due) * ratio)
            received_here = min(received_cursor, expected)
            received_cursor -= received_here
            schedule.append({
                "number": installment.number,
                "due_date": installment.due_date,
                "expected": expected,
                "received": received_here,
                "remaining": max(expected - received_here, Decimal("0")),
                "status": "paid" if received_here >= expected else installment.status,
            })
        if not installments and obj.installment_total:
            start = obj.scheduled_disbursement_date or timezone.localdate()
            from .services import installment_dates
            try:
                dates = installment_dates(start, obj.duration_code, obj.repayment_frequency)
            except Exception:
                dates = []
            values = []
            if dates:
                regular = money(expected_total / len(dates))
                left = expected_total
                for index in range(len(dates)):
                    value = left if index == len(dates) - 1 else regular
                    left -= value
                    values.append(value)
            for index, due_date in enumerate(dates):
                schedule.append({
                    "number": index + 1, "due_date": due_date, "expected": values[index],
                    "received": Decimal("0"), "remaining": values[index], "status": "upcoming",
                })
        return {
            "amount": funding.amount,
            "pending_amount": funding.pending_amount,
            "review_status": funding.review_status,
            "expected_gain": funding.expected_gain,
            "expected_total": expected_total,
            "principal_repaid": funding.principal_repaid,
            "interest_earned": funding.interest_earned,
            "total_received": received,
            "remaining_return": max(expected_total - received, Decimal("0")),
            "schedule": schedule,
        }

    def get_repayments(self, obj):
        return [{
            "id": repayment.id,
            "reference": repayment.reference,
            "payer": str(repayment.payer_id),
            "payer_name": repayment.payer.display_name,
            "amount": repayment.amount,
            "payment_method": repayment.payment_method,
            "principal_paid": repayment.principal_paid,
            "interest_paid": repayment.interest_paid,
            "fee_paid": repayment.fee_paid,
            "leader_commission_paid": repayment.leader_commission_paid,
            "penalty_paid": repayment.penalty_paid,
            "created_at": repayment.created_at,
        } for repayment in obj.repayments.all()]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return data
        is_admin = user.role == User.Role.ADMIN or user.is_superuser
        if is_admin:
            return data
        profile = user.current_profile
        if profile == User.Role.LENDER:
            # Le preteur ignore l'identite de l'emprunteur, ne voit que SON placement
            # et jamais la ventilation des commissions.
            data["borrower_name"] = "Membre du club"
            data["borrower_avatar"] = None
            data["borrower_selfie"] = None
            data["estimated_income"] = None
            data["guarantors"] = ""
            data["borrowers"] = []
            data["fundings"] = [item for item in data["fundings"] if str(item["lender"]) == str(user.id)]
            data["repayments"] = []
            data["borrower_credit_score"] = None
            data["borrower_admin_rating"] = None
            for field in ["fee_rate", "fee_total", "leader_commission_rate", "leader_commission_total", "charge_rate", "charge_total", "installments"]:
                data[field] = None if field != "installments" else []
            data["collection_agent"] = None
            data["collection_agent_name"] = None
        elif profile == User.Role.BORROWER:
            # L'emprunteur ne voit qu'un seul cout global et aucun preteur.
            for field in ["interest_rate", "fee_rate", "leader_commission_rate", "interest_total", "fee_total", "leader_commission_total"]:
                data[field] = None
            data["fundings"] = []
            data["funded_amount"] = None
            data["funding_remaining"] = None
            data["funding_open_amount"] = None
            data["pending_funding_amount"] = None
            data["my_funding"] = None
            for item in data.get("installments") or []:
                for field in ["interest_due", "fee_due", "leader_commission_due"]:
                    item[field] = None
            for item in data.get("repayments") or []:
                for field in ["interest_paid", "fee_paid", "leader_commission_paid"]:
                    item[field] = None
        elif profile == User.Role.LEADER:
            # Le chef de club ne voit que SA commission.
            for field in ["interest_rate", "fee_rate", "interest_total", "fee_total"]:
                data[field] = None
            data["fundings"] = []
            data["my_funding"] = None
            for item in data.get("installments") or []:
                for field in ["interest_due", "fee_due"]:
                    item[field] = None
            for item in data.get("repayments") or []:
                for field in ["interest_paid", "fee_paid"]:
                    item[field] = None
        return data

    # ------------------------------------------------------------- validation
    def validate(self, attrs):
        club = attrs["club"]
        amount = attrs["amount"]
        duration_code = attrs.get("duration_code") or "3m"
        frequency = attrs.get("repayment_frequency") or "monthly"
        if not club.min_loan <= amount <= club.max_loan:
            raise serializers.ValidationError({"amount": "Montant hors des limites du club."})
        if duration_code not in club.duration_options:
            raise serializers.ValidationError({"duration_code": "Cette duree n'est pas proposee par le club."})
        count = installment_count(duration_code, frequency)
        if count <= 0:
            allowed = ", ".join(REPAYMENT_FREQUENCIES[code]["label"] for code in allowed_frequencies(duration_code))
            raise serializers.ValidationError({"repayment_frequency": f"Frequence incompatible avec la duree choisie. Frequences possibles : {allowed}."})
        if not attrs.get("purpose_reference") and not (attrs.get("purpose") or "").strip():
            raise serializers.ValidationError({"purpose_id": "Selectionnez l'objet du pret."})
        request = self.context.get("request")
        if request and not request.user.has_valid_kyc:
            raise serializers.ValidationError({"detail": "Votre KYC doit etre valide avant toute demande d'emprunt."})
        partners = attrs.get("partners") or []
        if len(partners) + 1 > club.max_collective_borrowers:
            raise serializers.ValidationError({"partners": f"Un pret collectif accepte au maximum {club.max_collective_borrowers} emprunteurs."})
        attrs["installment_total"] = count
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        club = validated_data["club"]
        partners = validated_data.pop("partners", [])
        shares = validated_data.pop("shares", {})
        if not Membership.objects.filter(club=club, user=request.user, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE).exists():
            raise serializers.ValidationError("Vous devez etre un emprunteur actif de ce club.")
        purpose_reference = validated_data.get("purpose_reference")
        if purpose_reference:
            validated_data["purpose"] = purpose_reference.name
        partner_users = []
        if partners:
            partner_users = list(User.objects.filter(id__in=partners, is_active=True).exclude(pk=request.user.pk))
            if len(partner_users) != len(set(str(item) for item in partners) - {str(request.user.id)}):
                raise serializers.ValidationError({"partners": "Un ou plusieurs co-emprunteurs sont introuvables."})
            for partner in partner_users:
                if not Membership.objects.filter(club=club, user=partner, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE).exists():
                    raise serializers.ValidationError({"partners": f"{partner.display_name} n'est pas emprunteur actif de ce club."})
                if not partner.has_valid_kyc:
                    raise serializers.ValidationError({"partners": f"Le KYC de {partner.display_name} n'est pas valide."})
        loan = Loan.objects.create(
            borrower=request.user, currency=club.currency, interest_rate=club.interest_rate,
            fee_rate=club.platform_fee_rate, leader_commission_rate=club.leader_commission_rate,
            duration_months=duration_in_months(validated_data.get("duration_code") or "3m"),
            is_collective=bool(partner_users),
            status=Loan.Status.PENDING_PARTNERS if partner_users else Loan.Status.SUBMITTED,
            **validated_data,
        )
        LoanBorrower.objects.create(loan=loan, user=request.user, is_primary=True, status=LoanBorrower.Status.ACCEPTED, responded_at=timezone.now())
        for partner in partner_users:
            LoanBorrower.objects.create(loan=loan, user=partner, status=LoanBorrower.Status.PENDING)
        from .services import sync_collective_shares
        sync_collective_shares(loan, shares)
        return loan


class FundingContributionSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))


class AssistedDepositSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.filter(status=Club.Status.ACTIVE), required=False, allow_null=True)
    lender = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    payment_method = serializers.CharField(max_length=40, default="cash")
    provider_reference = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate(self, attrs):
        if not attrs["lender"].has_valid_kyc:
            raise serializers.ValidationError({"lender": "Le KYC du preteur doit etre valide avant un depot."})
        if attrs["lender"].lender_profile_status != User.LenderProfileStatus.ACTIVE:
            raise serializers.ValidationError({"lender": "Ce membre ne possede pas de profil preteur global actif."})
        return attrs


class AssistedWithdrawalSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.filter(status=Club.Status.ACTIVE), required=False, allow_null=True)
    lender = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))

    def validate(self, attrs):
        if attrs["lender"].lender_profile_status != User.LenderProfileStatus.ACTIVE:
            raise serializers.ValidationError({"lender": "Ce membre ne possede pas de profil preteur global actif."})
        return attrs


class AssistedLoanSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.filter(status=Club.Status.ACTIVE))
    borrower = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    duration_code = serializers.ChoiceField(choices=list(LOAN_DURATIONS))
    repayment_frequency = serializers.ChoiceField(choices=list(REPAYMENT_FREQUENCIES))
    purpose_id = serializers.PrimaryKeyRelatedField(queryset=LoanPurpose.objects.filter(is_active=True), required=False, allow_null=True)
    purpose = serializers.CharField(max_length=240, required=False, allow_blank=True)
    estimated_income = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0"))
    guarantors = serializers.CharField(required=False, allow_blank=True)
    partners = serializers.ListField(child=serializers.IntegerField(), required=False)
    shares = serializers.DictField(child=serializers.DecimalField(max_digits=16, decimal_places=2), required=False)

    def validate(self, attrs):
        club = attrs["club"]
        if not attrs["borrower"].has_valid_kyc:
            raise serializers.ValidationError({"borrower": "Le KYC de l'emprunteur doit etre valide avant une demande de pret."})
        has_borrower_membership = Membership.objects.filter(
            club=club, user=attrs["borrower"], role=Membership.Role.BORROWER,
            status=Membership.Status.ACTIVE,
        ).exists()
        if not has_borrower_membership:
            raise serializers.ValidationError({"borrower": "Ce client doit disposer d'un profil emprunteur actif dans ce club."})
        if not club.min_loan <= attrs["amount"] <= club.max_loan:
            raise serializers.ValidationError({"amount": "Montant hors des limites du club."})
        if attrs["duration_code"] not in club.duration_options:
            raise serializers.ValidationError({"duration_code": "Cette duree n'est pas proposee par le club."})
        count = installment_count(attrs["duration_code"], attrs["repayment_frequency"])
        if count <= 0:
            allowed = ", ".join(REPAYMENT_FREQUENCIES[code]["label"] for code in allowed_frequencies(attrs["duration_code"]))
            raise serializers.ValidationError({"repayment_frequency": f"Frequence incompatible avec la duree. Frequences possibles : {allowed}."})
        if not attrs.get("purpose_id") and not (attrs.get("purpose") or "").strip():
            raise serializers.ValidationError({"purpose_id": "Selectionnez l'objet du pret."})
        attrs["installment_total"] = count
        return attrs


class LoanSimulationSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all())
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    duration_code = serializers.ChoiceField(choices=list(LOAN_DURATIONS))
    repayment_frequency = serializers.ChoiceField(choices=list(REPAYMENT_FREQUENCIES))


class FundingReviewSerializer(serializers.Serializer):
    approve = serializers.BooleanField(default=True)
    reason = serializers.CharField(required=False, allow_blank=True)


class CollectionAgentSerializer(serializers.Serializer):
    agent = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False, allow_null=True)


class CollectiveResponseSerializer(serializers.Serializer):
    accept = serializers.BooleanField(default=True)
    share_amount = serializers.DecimalField(max_digits=16, decimal_places=2, required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True)


class AssistedFundingSerializer(FundingContributionSerializer):
    lender = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))


class RepaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Repayment
        fields = [
            "id", "reference", "loan", "payer", "amount", "currency", "payment_method", "status",
            "principal_paid", "interest_paid", "fee_paid", "leader_commission_paid", "penalty_paid", "created_at",
        ]
        read_only_fields = fields


class WithdrawalSerializer(serializers.ModelSerializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all(), required=False, allow_null=True)
    lender_name = serializers.CharField(source="lender.display_name", read_only=True)
    lender_avatar = serializers.ImageField(source="lender.avatar", read_only=True)
    lender_selfie = serializers.ImageField(source="lender.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)

    class Meta:
        model = Withdrawal
        fields = ["id", "reference", "club", "club_name", "lender", "lender_name", "lender_avatar", "lender_selfie", "amount", "currency", "status", "decision_reason", "created_at"]
        read_only_fields = ["reference", "lender", "currency", "status", "decision_reason"]

    def create(self, validated_data):
        club = validated_data.get("club")
        currency = club.currency if club else PlatformSettings.load().default_currency
        return Withdrawal.objects.create(lender=self.context["request"].user, currency=currency, **validated_data)


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "title", "message", "kind", "read_at", "data", "created_at"]


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "actor_name", "action", "object_type", "object_id", "club", "old_values", "new_values", "created_at"]


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)
    purpose = serializers.ChoiceField(choices=OTPChallenge.Purpose.choices)

    def validate_phone(self, value):
        normalized = value.replace(" ", "").replace("-", "")
        if not normalized.startswith("+") or not normalized[1:].isdigit() or len(normalized) < 10:
            raise serializers.ValidationError("Numero international invalide.")
        return normalized


class OTPVerifySerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(min_length=6, max_length=6)


class ClubMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.display_name", read_only=True)
    sender_id = serializers.IntegerField(source="sender.id", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)
    sender_avatar = serializers.ImageField(source="sender.avatar", read_only=True)
    sender_selfie = serializers.ImageField(source="sender.selfie", read_only=True)

    class Meta:
        model = ClubMessage
        fields = ["id", "club", "club_name", "sender_id", "sender_name", "sender_avatar", "sender_selfie", "recipient", "kind", "body", "created_at", "updated_at"]
        read_only_fields = ["sender_id", "sender_name", "created_at", "updated_at"]

    def validate(self, attrs):
        kind = attrs.get("kind", ClubMessage.Kind.TEXT)
        if kind == ClubMessage.Kind.PRIVATE and not attrs.get("recipient"):
            raise serializers.ValidationError({"recipient": "Le destinataire est obligatoire."})
        return attrs


class DisputeSerializer(serializers.ModelSerializer):
    opened_by_name = serializers.CharField(source="opened_by.display_name", read_only=True)
    opened_by_avatar = serializers.ImageField(source="opened_by.avatar", read_only=True)
    opened_by_selfie = serializers.ImageField(source="opened_by.selfie", read_only=True)
    assigned_to_name = serializers.CharField(source="assigned_to.display_name", read_only=True)

    class Meta:
        model = Dispute
        fields = ["id", "club", "opened_by", "opened_by_name", "opened_by_avatar", "opened_by_selfie", "assigned_to", "assigned_to_name", "operation_type", "operation_id", "subject", "description", "status", "frozen", "decision", "closed_at", "created_at"]
        read_only_fields = ["opened_by", "status", "frozen", "decision", "closed_at"]


class InvitationSerializer(serializers.ModelSerializer):
    club_name = serializers.CharField(source="club.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.display_name", read_only=True)

    class Meta:
        model = Invitation
        fields = ["id", "token", "club", "club_name", "phone", "email", "role", "membership_role", "status", "created_by_name", "expires_at", "created_at"]
        read_only_fields = ["token", "status", "created_by_name", "expires_at", "created_at"]

    def validate(self, attrs):
        request = self.context["request"]
        if request.user.role == User.Role.LEADER:
            club = attrs.get("club")
            if not club or club.leader_id != request.user.id:
                raise serializers.ValidationError({"club": "Club inaccessible."})
            if attrs.get("role") not in [User.Role.LENDER, User.Role.BORROWER]:
                raise serializers.ValidationError({"role": "Role non autorise pour un chef de club."})
        return attrs


class PlatformSettingsSerializer(serializers.ModelSerializer):
    default_borrower_charge_rate = serializers.SerializerMethodField()

    def get_default_borrower_charge_rate(self, obj) -> str:
        """Taux unique affiche a l'emprunteur : somme des trois composantes."""
        return str(obj.default_interest_rate + obj.default_commission_rate + obj.default_leader_commission_rate)

    class Meta:
        model = PlatformSettings
        fields = ["default_currency", "default_interest_rate", "default_commission_rate", "default_leader_commission_rate", "default_penalty_rate", "default_borrower_charge_rate", "max_loan", "default_collective_borrowers", "require_double_validation", "kyc_required", "maintenance_mode", "support_phone", "updated_at"]
        read_only_fields = ["updated_at", "default_borrower_charge_rate"]
