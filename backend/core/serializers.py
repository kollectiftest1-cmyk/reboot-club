from decimal import Decimal

from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers

from .models import AuditLog, Club, ClubMessage, Deposit, Dispute, EconomicActivity, Installment, Invitation, KYCApplication, Loan, LoanFunding, Membership, Notification, OTPChallenge, PlatformSettings, Repayment, User, Withdrawal
from .services import add_months, borrower_credit_score, club_finances, money


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name", read_only=True)
    current_profile = serializers.CharField(read_only=True)
    available_profiles = serializers.ListField(child=serializers.CharField(), read_only=True)
    kyc_verified = serializers.BooleanField(source="has_valid_kyc", read_only=True)
    profile_requests = serializers.SerializerMethodField()
    credit_score = serializers.SerializerMethodField()
    kyc_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "phone", "first_name", "last_name", "name", "role", "current_profile", "available_profiles", "profile_requests", "lender_profile_status", "kyc_verified", "kyc_status", "avatar", "identity_document", "selfie", "admin_borrower_rating", "credit_score", "is_active"]
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
        if attrs.get("role") == User.Role.BORROWER and not attrs.get("club"):
            raise serializers.ValidationError({"club": "Un profil emprunteur doit obligatoirement etre relie a un club."})
        if attrs.get("role") == User.Role.LENDER and attrs.get("club"):
            raise serializers.ValidationError({"club": "Un profil preteur global ne peut pas etre associe a un club."})
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

    class Meta:
        model = Club
        fields = [
            "id", "name", "description", "zone", "currency", "leader", "leader_name", "leader_avatar", "leader_selfie", "status",
            "interest_rate", "penalty_rate", "platform_fee_rate", "min_loan", "max_loan",
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


class MembershipSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "club", "club_name", "user", "user_detail", "role", "status", "decision_reason", "invited_by", "accepted_at", "member_approved_at", "leader_approved_at", "reviewed_at", "created_at"]
        read_only_fields = ["status", "decision_reason", "invited_by", "accepted_at", "member_approved_at", "leader_approved_at", "reviewed_at"]
        validators = []

    def validate_role(self, value):
        if value == Membership.Role.LENDER:
            raise serializers.ValidationError("Un profil preteur est global et ne peut pas etre associe a un club.")
        return value


class DepositSerializer(serializers.ModelSerializer):
    lender_name = serializers.CharField(source="lender.display_name", read_only=True)
    lender_avatar = serializers.ImageField(source="lender.avatar", read_only=True)
    lender_selfie = serializers.ImageField(source="lender.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)

    class Meta:
        model = Deposit
        fields = [
            "id", "reference", "club", "club_name", "lender", "lender_name", "lender_avatar", "lender_selfie", "amount", "currency",
            "payment_method", "provider_reference", "proof", "status", "decision_reason", "validated_at", "created_at",
        ]
        read_only_fields = ["reference", "status", "decision_reason", "validated_at"]


class InstallmentSerializer(serializers.ModelSerializer):
    total_due = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    remaining_due = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Installment
        fields = ["id", "number", "due_date", "principal_due", "interest_due", "fee_due", "penalty_due", "total_due", "paid_amount", "remaining_due", "progress_percent", "status"]

    def get_remaining_due(self, obj):
        return max(obj.total_due - obj.paid_amount, Decimal("0"))

    def get_progress_percent(self, obj):
        if not obj.total_due:
            return 100
        return min(100, round(obj.paid_amount / obj.total_due * 100))


class LoanFundingSerializer(serializers.ModelSerializer):
    lender_name = serializers.CharField(source="lender.display_name", read_only=True)

    class Meta:
        model = LoanFunding
        fields = ["lender", "lender_name", "amount", "expected_gain", "principal_repaid", "interest_earned"]


class LoanSerializer(serializers.ModelSerializer):
    borrower_name = serializers.CharField(source="borrower.display_name", read_only=True)
    borrower_avatar = serializers.ImageField(source="borrower.avatar", read_only=True)
    borrower_selfie = serializers.ImageField(source="borrower.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)
    balance = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    installments = InstallmentSerializer(many=True, read_only=True)
    fundings = LoanFundingSerializer(many=True, read_only=True)
    funded_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    funding_remaining = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    can_fund = serializers.SerializerMethodField()
    my_funding = serializers.SerializerMethodField()
    my_available_capital = serializers.SerializerMethodField()
    repayments = serializers.SerializerMethodField()
    borrower_credit_score = serializers.SerializerMethodField()
    borrower_admin_rating = serializers.IntegerField(source="borrower.admin_borrower_rating", read_only=True)

    class Meta:
        model = Loan
        fields = [
            "id", "reference", "club", "club_name", "borrower", "borrower_name", "borrower_avatar", "borrower_selfie", "purpose", "estimated_income",
            "guarantors", "amount", "currency", "duration_months", "interest_rate", "fee_rate", "interest_total",
            "fee_total", "total_due", "total_paid", "balance", "status", "decision_reason", "approved_at",
            "disbursed_at", "funding_completed_at", "scheduled_disbursement_date", "funded_amount", "funding_remaining", "can_fund", "my_funding", "my_available_capital", "borrower_credit_score", "borrower_admin_rating", "installments", "fundings", "repayments", "created_at",
        ]
        read_only_fields = [
            "reference", "borrower", "currency", "interest_rate", "fee_rate", "interest_total", "fee_total",
            "total_due", "total_paid", "status", "decision_reason", "approved_at", "disbursed_at",
            "funding_completed_at", "scheduled_disbursement_date",
        ]

    def get_can_fund(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if request.user.role == User.Role.ADMIN or request.user.is_superuser:
            return True
        return request.user.lender_profile_status == User.LenderProfileStatus.ACTIVE

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
        for installment in installments:
            ratio = funding.amount / obj.amount
            expected = (installment.principal_due + installment.interest_due) * ratio
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
        if not installments and obj.duration_months:
            start = obj.scheduled_disbursement_date or timezone.localdate()
            regular_return = money(expected_total / obj.duration_months)
            return_left = expected_total
            for number in range(1, obj.duration_months + 1):
                expected = return_left if number == obj.duration_months else regular_return
                return_left -= expected
                schedule.append({
                    "number": number,
                    "due_date": add_months(start, number),
                    "expected": expected,
                    "received": Decimal("0"),
                    "remaining": expected,
                    "status": "upcoming",
                })
        return {
            "amount": funding.amount,
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
            "amount": repayment.amount,
            "payment_method": repayment.payment_method,
            "principal_paid": repayment.principal_paid,
            "interest_paid": repayment.interest_paid,
            "fee_paid": repayment.fee_paid,
            "penalty_paid": repayment.penalty_paid,
            "created_at": repayment.created_at,
        } for repayment in obj.repayments.all()]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        is_borrower = request and request.user.current_profile == User.Role.BORROWER and instance.borrower_id == request.user.id
        if is_borrower:
            data.pop("interest_rate", None)
            data.pop("fee_rate", None)
            data.pop("interest_total", None)
            data.pop("fee_total", None)
            data["installments"] = [
                {key: value for key, value in item.items() if key not in ["principal_due", "interest_due", "fee_due", "penalty_due"]}
                for item in data["installments"]
            ]
            data["repayments"] = [
                {key: value for key, value in item.items() if key not in ["principal_paid", "interest_paid", "fee_paid", "penalty_paid"]}
                for item in data["repayments"]
            ]
        if request and request.user.current_profile == User.Role.LENDER and request.user.role != User.Role.ADMIN:
            data["borrower_name"] = "Membre du club"
            data["borrower_avatar"] = None
            data["borrower_selfie"] = None
            data["estimated_income"] = None
            data["guarantors"] = ""
            data["fundings"] = [item for item in data["fundings"] if str(item["lender"]) == str(request.user.id)]
            data["repayments"] = []
            data["borrower_credit_score"] = None
            data["borrower_admin_rating"] = None
        return data
    def validate(self, attrs):
        club = attrs["club"]
        amount = attrs["amount"]
        duration = attrs["duration_months"]
        if not club.min_loan <= amount <= club.max_loan:
            raise serializers.ValidationError({"amount": "Montant hors des limites du club."})
        if not club.min_duration_months <= duration <= club.max_duration_months:
            raise serializers.ValidationError({"duration_months": "Duree hors des limites du club."})
        request = self.context.get("request")
        if request and not request.user.has_valid_kyc:
            raise serializers.ValidationError({"detail": "Votre KYC doit etre valide avant toute demande d'emprunt."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        club = validated_data["club"]
        if not Membership.objects.filter(club=club, user=request.user, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE).exists():
            raise serializers.ValidationError("Vous devez etre un emprunteur actif de ce club.")
        return Loan.objects.create(
            borrower=request.user, currency=club.currency, interest_rate=club.interest_rate,
            fee_rate=club.platform_fee_rate, **validated_data,
        )


class FundingContributionSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))


class AssistedDepositSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.filter(status=Club.Status.ACTIVE))
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
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.filter(status=Club.Status.ACTIVE))
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
    duration_months = serializers.IntegerField(min_value=1)
    purpose = serializers.CharField(max_length=240)
    estimated_income = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0"))
    guarantors = serializers.CharField(required=False, allow_blank=True)

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
        if not club.min_duration_months <= attrs["duration_months"] <= club.max_duration_months:
            raise serializers.ValidationError({"duration_months": "Duree hors des limites du club."})
        return attrs


class AssistedFundingSerializer(FundingContributionSerializer):
    lender = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))


class RepaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Repayment
        fields = [
            "id", "reference", "loan", "payer", "amount", "currency", "payment_method", "status",
            "principal_paid", "interest_paid", "fee_paid", "penalty_paid", "created_at",
        ]
        read_only_fields = fields


class WithdrawalSerializer(serializers.ModelSerializer):
    lender_name = serializers.CharField(source="lender.display_name", read_only=True)
    lender_avatar = serializers.ImageField(source="lender.avatar", read_only=True)
    lender_selfie = serializers.ImageField(source="lender.selfie", read_only=True)
    club_name = serializers.CharField(source="club.name", read_only=True)

    class Meta:
        model = Withdrawal
        fields = ["id", "reference", "club", "club_name", "lender", "lender_name", "lender_avatar", "lender_selfie", "amount", "currency", "status", "decision_reason", "created_at"]
        read_only_fields = ["reference", "lender", "currency", "status", "decision_reason"]

    def create(self, validated_data):
        club = validated_data["club"]
        return Withdrawal.objects.create(lender=self.context["request"].user, currency=club.currency, **validated_data)


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
    class Meta:
        model = PlatformSettings
        fields = ["platform_name", "default_currency", "default_interest_rate", "default_penalty_rate", "default_commission_rate", "max_loan", "require_double_validation", "kyc_required", "maintenance_mode", "support_phone", "updated_at"]
        read_only_fields = ["updated_at"]
