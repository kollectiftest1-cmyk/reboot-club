from datetime import timedelta
from decimal import Decimal
import secrets
import csv

from django.db import transaction
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from .models import (
    LOAN_DURATIONS, REPAYMENT_FREQUENCIES,
    AuditLog, Club, ClubMessage, Deposit, Dispute, EconomicActivity, Installment, Invitation, KYCApplication,
    Loan, LoanBorrower, LoanFunding, LoanPurpose, Membership, Notification, OTPChallenge, PlatformSettings,
    Repayment, User, Withdrawal, allowed_frequencies, duration_in_months, installment_count,
)
from .permissions import IsPlatformAdmin
from .serializers import (
    AssistedDepositSerializer, AssistedFundingSerializer, AssistedLoanSerializer, AssistedWithdrawalSerializer, AuditLogSerializer,
    ClubMessageSerializer, ClubSerializer, CollectionAgentSerializer, CollectiveResponseSerializer, DepositSerializer, DisputeSerializer,
    FundingContributionSerializer, FundingReviewSerializer, KYCApplicationSerializer, LoanBorrowerSerializer, LoanFundingSerializer,
    LoanPurposeSerializer, LoanSerializer, LoanSimulationSerializer, MembershipSerializer,
    EconomicActivitySerializer, InvitationSerializer, ManagedUserSerializer, ManagedUserUpdateSerializer, NotificationSerializer,
    OTPRequestSerializer, OTPVerifySerializer, PlatformSettingsSerializer,
    RegisterSerializer, RepaymentSerializer, UserSerializer, WithdrawalSerializer,
)
from .services import (
    add_months, approve_loan, audit, can_collect, club_finances, collective_is_ready, disburse_loan, fund_loan,
    installment_dates, is_platform_admin, lender_total_available, loan_cost_breakdown, money, notify,
    platform_admins, record_repayment, review_funding, submit_loan, sync_collective_shares, validate_deposit,
)


def accessible_clubs(user):
    if not getattr(user, "is_authenticated", False):
        return Club.objects.none()
    if user.is_superuser or user.role == User.Role.ADMIN:
        return Club.objects.all()
    profile = user.current_profile
    if profile == User.Role.LEADER:
        return Club.objects.filter(leader=user)
    if profile == User.Role.LENDER:
        # Le preteur n'a aucun lien avec les clubs : son portefeuille est global.
        return Club.objects.none()
    membership_role = Membership.Role.BORROWER if profile == User.Role.BORROWER else profile
    return Club.objects.filter(memberships__user=user, memberships__role=membership_role, memberships__status=Membership.Status.ACTIVE).distinct()


def communication_clubs(user):
    if user.is_superuser or user.role == User.Role.ADMIN:
        return Club.objects.all()
    if user.current_profile == User.Role.LENDER:
        return Club.objects.none()
    return accessible_clubs(user)


def financial_balance(user):
    clubs = accessible_clubs(user)
    is_admin = user.role == User.Role.ADMIN or user.is_superuser
    if is_admin:
        # Le portefeuille preteur est global : les depots et retraits ne sont plus
        # filtres par club.
        deposits = Deposit.objects.filter(status=Deposit.Status.VALIDATED).select_related("club", "lender")
        withdrawal_history = Withdrawal.objects.all().select_related("club", "lender")
        fundings = LoanFunding.objects.all().select_related("loan", "loan__club", "lender")
        repayments = Repayment.objects.filter(status=Repayment.Status.VALIDATED).select_related("loan", "loan__club")
    else:
        deposits = Deposit.objects.filter(lender=user, status=Deposit.Status.VALIDATED).select_related("club", "lender")
        withdrawal_history = Withdrawal.objects.filter(lender=user).select_related("club", "lender")
        fundings = LoanFunding.objects.filter(lender=user).select_related("loan", "loan__club", "lender")
        repayments = Repayment.objects.none()

    withdrawals = withdrawal_history.filter(status=Withdrawal.Status.PAID)
    total_deposits = deposits.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    total_withdrawals = withdrawals.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    funding_rows = list(fundings)
    active_statuses = {Loan.Status.APPROVED, Loan.Status.DISBURSED, Loan.Status.CURRENT, Loan.Status.LATE, Loan.Status.DISPUTED}
    ongoing = [funding for funding in funding_rows if funding.loan.status in active_statuses and funding.principal_repaid < funding.amount]
    completed = [funding for funding in funding_rows if funding.principal_repaid >= funding.amount or funding.loan.status == Loan.Status.REPAID]
    ongoing_capital = sum((max(funding.amount - funding.principal_repaid, Decimal("0")) for funding in ongoing), Decimal("0"))
    completed_capital = sum((funding.amount for funding in completed), Decimal("0"))
    recovered_capital = sum((funding.principal_repaid for funding in funding_rows), Decimal("0"))
    expected_gains = sum((funding.expected_gain for funding in funding_rows), Decimal("0"))

    if is_admin:
        disbursed_loans = Loan.objects.filter(
            status__in=[Loan.Status.DISBURSED, Loan.Status.CURRENT, Loan.Status.LATE, Loan.Status.DISPUTED],
        )
        principal_outstanding = Decimal("0")
        for loan in disbursed_loans:
            principal_paid = loan.repayments.filter(status=Repayment.Status.VALIDATED).aggregate(total=Sum("principal_paid"))["total"] or Decimal("0")
            principal_outstanding += max(loan.amount - principal_paid, Decimal("0"))
        reserved_capital = sum((max(funding.amount - funding.principal_repaid, Decimal("0")) for funding in ongoing if funding.loan.status == Loan.Status.APPROVED), Decimal("0"))
        pending_capital = sum((funding.pending_amount for funding in funding_rows), Decimal("0"))
        totals_paid = repayments.aggregate(
            fee=Sum("fee_paid"), penalty=Sum("penalty_paid"),
            interest=Sum("interest_paid"), leader=Sum("leader_commission_paid"),
        )
        fee_collected = totals_paid["fee"] or Decimal("0")
        penalty_collected = totals_paid["penalty"] or Decimal("0")
        interest_collected = totals_paid["interest"] or Decimal("0")
        leader_collected = totals_paid["leader"] or Decimal("0")
        commissions_collected = fee_collected + penalty_collected
        earnings_collected = commissions_collected + interest_collected + leader_collected
        loan_totals = Loan.objects.all().aggregate(fees=Sum("fee_total"), interest=Sum("interest_total"), leader=Sum("leader_commission_total"))
        billed_fees = (loan_totals["fees"] or Decimal("0")) + (loan_totals["interest"] or Decimal("0")) + (loan_totals["leader"] or Decimal("0"))
        net_available = max(total_deposits - total_withdrawals - principal_outstanding + earnings_collected, Decimal("0"))
        free_after_commitments = max(net_available - reserved_capital - pending_capital, Decimal("0"))
    else:
        principal_outstanding = ongoing_capital
        reserved_capital = sum((max(funding.amount - funding.principal_repaid, Decimal("0")) for funding in ongoing if funding.loan.status == Loan.Status.APPROVED), Decimal("0"))
        pending_capital = sum((funding.pending_amount for funding in funding_rows), Decimal("0"))
        earnings_collected = sum((funding.interest_earned for funding in funding_rows), Decimal("0"))
        interest_collected = earnings_collected
        leader_collected = Decimal("0")
        commissions_collected = Decimal("0")
        billed_fees = expected_gains
        net_available = lender_total_available(user)
        free_after_commitments = net_available

    events = []
    for deposit in deposits.order_by("-created_at")[:8]:
        events.append({"id": str(deposit.id), "kind": "deposit", "title": "Depot valide", "club": deposit.club.name if deposit.club else "Portefeuille global", "amount": str(deposit.amount), "direction": "in", "date": deposit.validated_at or deposit.created_at})
    withdrawal_titles = {
        Withdrawal.Status.SUBMITTED: "Retrait soumis",
        Withdrawal.Status.REVIEW: "Retrait en verification",
        Withdrawal.Status.APPROVED: "Retrait approuve",
        Withdrawal.Status.REJECTED: "Retrait refuse",
        Withdrawal.Status.PAID: "Retrait paye",
    }
    for withdrawal in withdrawal_history.order_by("-created_at")[:8]:
        events.append({
            "id": str(withdrawal.id), "kind": "withdrawal",
            "title": withdrawal_titles.get(withdrawal.status, "Demande de retrait"),
            "club": withdrawal.club.name if withdrawal.club else "Portefeuille global", "amount": str(withdrawal.amount),
            "direction": "out" if withdrawal.status == Withdrawal.Status.PAID else "neutral",
            "status": withdrawal.status, "date": withdrawal.updated_at,
        })
    for funding in sorted(funding_rows, key=lambda item: item.created_at, reverse=True)[:8]:
        events.append({"id": str(funding.id), "kind": "funding", "title": "Placement dans un pret", "club": funding.loan.club.name, "amount": str(funding.amount), "direction": "out" if not is_admin else "neutral", "date": funding.created_at, "loan": str(funding.loan_id)})
        returned = funding.principal_repaid + funding.interest_earned
        if returned > 0:
            events.append({"id": f"return-{funding.id}", "kind": "return", "title": "Capital et gain recuperes", "club": funding.loan.club.name, "amount": str(returned), "direction": "in", "date": funding.updated_at, "loan": str(funding.loan_id)})
    events.sort(key=lambda item: item["date"], reverse=True)
    currency = clubs.values_list("currency", flat=True).first() or PlatformSettings.load().default_currency
    return {
        "currency": currency,
        "total_deposits": str(money(total_deposits)), "total_withdrawals": str(money(total_withdrawals)),
        "net_available": str(money(net_available)), "free_after_commitments": str(money(free_after_commitments)),
        "principal_outstanding": str(money(principal_outstanding)), "reserved_capital": str(money(reserved_capital)),
        "ongoing_placements": str(money(ongoing_capital)), "ongoing_count": len(ongoing),
        "completed_placements": str(money(completed_capital)), "completed_count": len(completed),
        "recovered_capital": str(money(recovered_capital)), "earnings_collected": str(money(earnings_collected)),
        "commissions_collected": str(money(commissions_collected)), "interest_collected": str(money(interest_collected)),
        "leader_commission_collected": str(money(leader_collected)),
        "pending_placements": str(money(pending_capital)),
        "earnings_expected": str(money(billed_fees)), "activity": events[:20],
    }


def can_manage_club(user, club):
    return user.is_superuser or user.role == User.Role.ADMIN or (club.leader_id == user.id and user.current_profile == User.Role.LEADER)


def deny(message, status_code=403):
    return Response({"detail": message}, status=status_code)


@extend_schema(request=RegisterSerializer, responses={201: OpenApiTypes.OBJECT})
@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    refresh = RefreshToken.for_user(user)
    return Response({"user": UserSerializer(user).data, "access": str(refresh.access_token), "refresh": str(refresh)}, status=status.HTTP_201_CREATED)


@extend_schema(request=UserSerializer, responses=UserSerializer)
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request):
    if request.method == "PATCH":
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(UserSerializer(request.user).data)


@extend_schema(request=OpenApiTypes.OBJECT, responses=UserSerializer)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def switch_profile(request):
    profile = request.data.get("profile")
    if profile not in request.user.available_profiles:
        return Response({"profile": "Ce profil n'est pas encore actif ou valide."}, status=400)
    request.user.active_profile = profile
    request.user.save(update_fields=["active_profile"])
    audit(request.user, "profile.switched", request.user, new={"profile": profile})
    return Response(UserSerializer(request.user).data)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def loan_catalog(request):
    """Durees, frequences compatibles et objets de pret, pour alimenter les selects."""
    return Response({
        "durations": [{
            "code": code, "label": item["label"],
            "frequencies": [{
                "code": frequency, "label": REPAYMENT_FREQUENCIES[frequency]["label"],
                "installments": installment_count(code, frequency),
            } for frequency in allowed_frequencies(code)],
        } for code, item in LOAN_DURATIONS.items()],
        "frequencies": [{"code": code, "label": item["label"]} for code, item in REPAYMENT_FREQUENCIES.items()],
        "purposes": LoanPurposeSerializer(LoanPurpose.objects.filter(is_active=True), many=True).data,
    })


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "REBOOT CLUB API"})


@extend_schema(request=PlatformSettingsSerializer, responses=PlatformSettingsSerializer)
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def platform_configuration(request):
    configuration = PlatformSettings.load()
    if request.method == "PATCH":
        if not (request.user.is_superuser or request.user.role == User.Role.ADMIN):
            return Response({"detail": "Configuration reservee a l'administrateur."}, status=403)
        serializer = PlatformSettingsSerializer(configuration, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        audit(request.user, "configuration.updated", configuration, new={key: str(value) if isinstance(value, Decimal) else value for key, value in serializer.validated_data.items()})
    return Response(PlatformSettingsSerializer(configuration).data)


@extend_schema(request=OTPRequestSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([AllowAny])
def request_otp(request):
    serializer = OTPRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    phone = serializer.validated_data["phone"]
    purpose = serializer.validated_data["purpose"]
    if purpose == OTPChallenge.Purpose.REGISTER and User.objects.filter(phone=phone).exists():
        return Response({"phone": "Un compte utilise deja ce numero."}, status=400)
    OTPChallenge.objects.filter(phone=phone, purpose=purpose, verified_at__isnull=True).delete()
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = OTPChallenge.objects.create(
        phone=phone, purpose=purpose, code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    payload = {"challenge_id": str(challenge.pk), "expires_in": 300, "message": "Le code a ete envoye par SMS."}
    from django.conf import settings
    if settings.DEBUG:
        payload["debug_code"] = code
    return Response(payload, status=201)


@extend_schema(request=OTPVerifySerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([AllowAny])
@transaction.atomic
def verify_otp(request):
    serializer = OTPVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    challenge = OTPChallenge.objects.select_for_update().filter(pk=serializer.validated_data["challenge_id"]).first()
    if not challenge or challenge.consumed_at or challenge.verified_at:
        return Response({"code": "Ce code ne peut plus etre utilise."}, status=400)
    if challenge.expires_at <= timezone.now() or challenge.attempts >= 5:
        return Response({"code": "Ce code a expire."}, status=400)
    challenge.attempts += 1
    if not check_password(serializer.validated_data["code"], challenge.code_hash):
        challenge.save(update_fields=["attempts"])
        return Response({"code": "Code incorrect."}, status=400)
    challenge.verified_at = timezone.now()
    challenge.save(update_fields=["attempts", "verified_at"])
    return Response({"verified": True, "challenge_id": str(challenge.pk), "phone": challenge.phone})


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def dashboard(request):
    clubs = accessible_clubs(request.user)
    is_admin = request.user.role == User.Role.ADMIN or request.user.is_superuser
    profile = request.user.current_profile
    loans = Loan.objects.all() if is_admin else Loan.objects.filter(club__in=clubs)
    deposits = Deposit.objects.filter(status=Deposit.Status.VALIDATED) if is_admin else Deposit.objects.none()
    balance = financial_balance(request.user) if profile == User.Role.LENDER or is_admin else None
    if profile == User.Role.LENDER and not is_admin:
        # Le preteur est hors club : son perimetre est son portefeuille global.
        deposits = Deposit.objects.filter(lender=request.user, status=Deposit.Status.VALIDATED)
        loans = Loan.objects.filter(fundings__lender=request.user).distinct()
    elif profile == User.Role.BORROWER:
        loans = loans.filter(Q(borrower=request.user) | Q(borrowers__user=request.user)).distinct()
    total_deposits = deposits.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    total_due = loans.aggregate(total=Sum("total_due"))["total"] or Decimal("0")
    total_paid = loans.aggregate(total=Sum("total_paid"))["total"] or Decimal("0")
    interest_earned = request.user.loan_fundings.aggregate(total=Sum("interest_earned"))["total"] or Decimal("0") if profile == User.Role.LENDER else Decimal("0")
    lender_placed = request.user.loan_fundings.aggregate(total=Sum("amount"))["total"] or Decimal("0") if profile == User.Role.LENDER else Decimal("0")
    lender_free = lender_total_available(request.user) if profile == User.Role.LENDER else Decimal("0")
    membership_invitations = Membership.objects.filter(
        user=request.user, status=Membership.Status.PENDING,
        member_approved_at__isnull=True,
    ).select_related("club", "user", "invited_by").order_by("-created_at")
    month_starts = [add_months(timezone.localdate().replace(day=1), offset) for offset in range(-5, 1)]
    gain_map = {month.strftime("%Y-%m"): Decimal("0") for month in month_starts}
    gain_repayments = Repayment.objects.filter(status=Repayment.Status.VALIDATED, created_at__date__gte=month_starts[0])
    if request.user.role == User.Role.ADMIN or request.user.is_superuser:
        pass
        for repayment in gain_repayments:
            key = repayment.created_at.strftime("%Y-%m")
            if key in gain_map:
                gain_map[key] += repayment.interest_paid + repayment.fee_paid + repayment.leader_commission_paid + repayment.penalty_paid
    elif profile == User.Role.LENDER:
        lender_fundings = {funding.loan_id: funding for funding in LoanFunding.objects.filter(lender=request.user).select_related("loan")}
        gain_repayments = gain_repayments.filter(loan_id__in=lender_fundings).select_related("loan")
        for repayment in gain_repayments:
            key = repayment.created_at.strftime("%Y-%m")
            funding = lender_fundings.get(repayment.loan_id)
            if key in gain_map and funding and repayment.loan.amount:
                gain_map[key] += money(repayment.interest_paid * funding.amount / repayment.loan.amount)
    gain_history = [{
        "key": month.strftime("%Y-%m"), "label": month.strftime("%m/%y"),
        "amount": str(money(gain_map[month.strftime("%Y-%m")])),
    } for month in month_starts]
    admin_overview = None
    if request.user.role == User.Role.ADMIN or request.user.is_superuser:
        platform_loans = Loan.objects.all().exclude(status__in=[Loan.Status.REJECTED, Loan.Status.CANCELLED])
        platform_deposits = Deposit.objects.filter(status=Deposit.Status.VALIDATED)
        deposit_rows = platform_deposits.filter(created_at__date__gte=month_starts[0]).annotate(month=TruncMonth("created_at")).values("month").annotate(total=Sum("amount"))
        loan_rows = platform_loans.filter(created_at__date__gte=month_starts[0]).annotate(month=TruncMonth("created_at")).values("month").annotate(total=Sum("amount"))
        deposit_map = {row["month"].strftime("%Y-%m"): row["total"] for row in deposit_rows}
        loan_map = {row["month"].strftime("%Y-%m"): row["total"] for row in loan_rows}
        expected = platform_loans.aggregate(fees=Sum("fee_total"), interest=Sum("interest_total"), leader=Sum("leader_commission_total"))
        admin_overview = {
            "total_deposited": str(money(platform_deposits.aggregate(total=Sum("amount"))["total"] or 0)),
            "total_borrowed": str(money(platform_loans.aggregate(total=Sum("amount"))["total"] or 0)),
            "total_placed": str(money(LoanFunding.objects.aggregate(total=Sum("amount"))["total"] or 0)),
            "total_repaid": str(money(Repayment.objects.filter(status=Repayment.Status.VALIDATED).aggregate(total=Sum("amount"))["total"] or 0)),
            "open_funding": platform_loans.filter(status=Loan.Status.APPROVED).count(),
            "late_loans": platform_loans.filter(status=Loan.Status.LATE).count(),
            "active_loans": platform_loans.filter(status__in=[Loan.Status.CURRENT, Loan.Status.LATE]).count(),
            "total_clubs": clubs.count(),
            "active_clubs": clubs.filter(status=Club.Status.ACTIVE).count(),
            "active_members": Membership.objects.filter(club__in=clubs, status=Membership.Status.ACTIVE).values("user").distinct().count(),
            "borrower_members": Membership.objects.filter(club__in=clubs, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE).values("user").distinct().count(),
            "lender_members": User.objects.filter(lender_profile_status=User.LenderProfileStatus.ACTIVE, is_active=True).count(),
            "platform_commission_collected": str(money(Repayment.objects.filter(status=Repayment.Status.VALIDATED).aggregate(total=Sum("fee_paid"))["total"] or 0)),
            "platform_commission_expected": str(money(expected["fees"] or 0)),
            "lender_interest_collected": balance["interest_collected"],
            "lender_interest_expected": str(money(expected["interest"] or 0)),
            "leader_commission_collected": balance["leader_commission_collected"],
            "leader_commission_expected": str(money(expected["leader"] or 0)),
            "pending_placements": balance["pending_placements"],
            "total_withdrawn": balance["total_withdrawals"],
            "net_available": balance["net_available"],
            "free_after_commitments": balance["free_after_commitments"],
            "ongoing_placements": balance["ongoing_placements"],
            "ongoing_placements_count": balance["ongoing_count"],
            "completed_placements": balance["completed_placements"],
            "completed_placements_count": balance["completed_count"],
            "commissions_collected": balance["commissions_collected"],
            "interest_collected": balance["interest_collected"],
            "financial_income_collected": balance["earnings_collected"],
            "monthly": [{
                "key": month.strftime("%Y-%m"), "label": month.strftime("%m/%y"),
                "deposits": str(money(deposit_map.get(month.strftime("%Y-%m"), 0))),
                "loans": str(money(loan_map.get(month.strftime("%Y-%m"), 0))),
            } for month in month_starts],
        }
    return Response({
        "user": UserSerializer(request.user).data,
        "stats": {
            "clubs": clubs.count(), "members": Membership.objects.filter(club__in=clubs, status=Membership.Status.ACTIVE).values("user").distinct().count(),
            "deposits": balance["total_deposits"] if profile == User.Role.LENDER and balance else str(money(total_deposits)), "loaned": str(money(total_due)), "repaid": str(money(total_paid)),
            "interest_earned": str(money(interest_earned)), "placed": str(money(lender_placed)), "available_capital": str(money(lender_free)),
            "withdrawals": balance["total_withdrawals"] if balance else "0.00",
            "ongoing_placements": balance["ongoing_placements"] if balance else "0.00",
            "ongoing_placements_count": balance["ongoing_count"] if balance else 0,
            "completed_placements": balance["completed_placements"] if balance else "0.00",
            "completed_placements_count": balance["completed_count"] if balance else 0,
            "active_loans": loans.filter(status__in=[Loan.Status.CURRENT, Loan.Status.LATE]).count(),
            "pending_actions": (Deposit.objects.filter(status=Deposit.Status.PENDING).count() + Withdrawal.objects.filter(status__in=[Withdrawal.Status.SUBMITTED, Withdrawal.Status.REVIEW]).count() + LoanFunding.objects.filter(pending_amount__gt=0).count() if is_admin else 0) + loans.filter(status=Loan.Status.SUBMITTED).count(),
        },
        "recent_loans": LoanSerializer(loans.order_by("-created_at")[:4], many=True, context={"request": request}).data,
        "membership_invitations": MembershipSerializer(membership_invitations, many=True).data,
        "admin_overview": admin_overview,
        "gain_history": gain_history,
        "unread_notifications": request.user.notifications.filter(read_at__isnull=True).count(),
    })


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def balance_summary(request):
    if request.user.role != User.Role.ADMIN and request.user.current_profile != User.Role.LENDER and not request.user.is_superuser:
        return Response({"detail": "La balance est reservee a l'administration et aux preteurs."}, status=403)
    return Response(financial_balance(request.user))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def activity_counts(request):
    clubs = accessible_clubs(request.user)
    visible_messages = ClubMessage.objects.filter(club__in=communication_clubs(request.user)).filter(
        Q(kind__in=[ClubMessage.Kind.TEXT, ClubMessage.Kind.ANNOUNCEMENT]) |
        Q(sender=request.user) | Q(recipient=request.user)
    )
    unread_chat = visible_messages.exclude(sender=request.user).exclude(read_by=request.user).count()
    admin = request.user.role == User.Role.ADMIN or request.user.is_superuser
    manager = admin or request.user.current_profile == User.Role.LEADER
    validations = {"deposits": 0, "withdrawals": 0, "loans": 0, "memberships": 0, "lender_profiles": 0, "activities": 0, "kyc": 0, "placements": 0, "total": 0}
    disputes = identities = invitations = activities = 0
    if manager:
        # Depots, retraits et placements sont des operations de caisse : admin seul.
        if admin:
            validations["deposits"] = Deposit.objects.filter(status=Deposit.Status.PENDING).count()
            validations["withdrawals"] = Withdrawal.objects.filter(status__in=[Withdrawal.Status.SUBMITTED, Withdrawal.Status.REVIEW]).count()
            validations["placements"] = LoanFunding.objects.filter(pending_amount__gt=0).count()
        validations["loans"] = Loan.objects.filter(club__in=clubs, status__in=[Loan.Status.SUBMITTED, Loan.Status.REVIEW]).count()
        pending_memberships = Membership.objects.filter(club__in=clubs, status=Membership.Status.PENDING)
        if request.user.role == User.Role.ADMIN:
            pending_memberships = pending_memberships.filter(member_approved_at__isnull=False, leader_approved_at__isnull=False)
            validations["lender_profiles"] = User.objects.filter(lender_profile_status=User.LenderProfileStatus.PENDING, is_active=True).count()
            validations["activities"] = EconomicActivity.objects.filter(status=EconomicActivity.Status.PENDING).count()
            validations["kyc"] = KYCApplication.objects.filter(status__in=[KYCApplication.Status.SUBMITTED, KYCApplication.Status.REVIEW]).count()
        else:
            pending_memberships = pending_memberships.filter(leader_approved_at__isnull=True).exclude(user=request.user)
        validations["memberships"] = pending_memberships.count()
        validations["total"] = sum(value for key, value in validations.items() if key != "total")
        disputes = Dispute.objects.filter(club__in=clubs, status__in=[Dispute.Status.OPEN, Dispute.Status.REVIEW]).count()
        if request.user.role == User.Role.ADMIN or request.user.is_superuser:
            identities = KYCApplication.objects.filter(status__in=[KYCApplication.Status.SUBMITTED, KYCApplication.Status.REVIEW]).count()
            activities = EconomicActivity.objects.filter(status=EconomicActivity.Status.PENDING).count()
            invitations = 0
        else:
            identities = KYCApplication.objects.filter(user__memberships__club__in=clubs, status__in=[KYCApplication.Status.SUBMITTED, KYCApplication.Status.REVIEW]).distinct().count()
            invitations = 0
    else:
        disputes = Dispute.objects.filter(opened_by=request.user, status__in=[Dispute.Status.OPEN, Dispute.Status.REVIEW]).count()
    membership_requests = Membership.objects.filter(
        user=request.user, status=Membership.Status.PENDING, member_approved_at__isnull=True,
    ).count()
    loan_offers = 0
    collections = 0
    if request.user.current_profile == User.Role.LENDER:
        loan_offers = Loan.objects.filter(status=Loan.Status.APPROVED, funding_completed_at__isnull=True, club__status=Club.Status.ACTIVE).exclude(fundings__lender=request.user).count()
    collective_requests = LoanBorrower.objects.filter(user=request.user, status=LoanBorrower.Status.PENDING, loan__status=Loan.Status.PENDING_PARTNERS).count()
    if not admin:
        collections = Loan.objects.filter(collection_agent=request.user, status__in=[Loan.Status.CURRENT, Loan.Status.LATE]).count()
    notifications = request.user.notifications.filter(read_at__isnull=True).count()
    return Response({
        "chat": unread_chat, "notifications": notifications, "membership_requests": membership_requests,
        "loan_offers": loan_offers, "validations": validations, "disputes": disputes,
        "identities": identities, "invitations": invitations, "activities": activities,
        "collective_requests": collective_requests, "collections": collections,
        "management_total": validations["total"] + disputes + invitations + max(identities - validations["kyc"], 0),
    })


def report_data(user):
    clubs = accessible_clubs(user)
    rows = []
    for club in clubs:
        finances = club_finances(club)
        loans = club.loans.all()
        rows.append({
            "club_id": str(club.id), "club": club.name, "currency": club.currency,
            "members": club.memberships.filter(status=Membership.Status.ACTIVE).count(),
            "deposited": str(finances["deposited"]), "available": str(finances["available"]), "engaged": str(finances["engaged"]),
            "loans": loans.count(), "active_loans": loans.filter(status__in=[Loan.Status.CURRENT, Loan.Status.LATE]).count(),
            "late_loans": loans.filter(status=Loan.Status.LATE).count(),
            "interest_generated": str(money(loans.aggregate(total=Sum("interest_total"))["total"] or 0)),
            "repaid": str(money(loans.aggregate(total=Sum("total_paid"))["total"] or 0)),
        })
    return rows


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def report_summary(request):
    return Response({"results": report_data(request.user), "generated_at": timezone.now()})


@extend_schema(responses={(200, "text/csv"): OpenApiTypes.BINARY})
@api_view(["GET"])
def report_export_csv(request):
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="reboot-club-report.csv"'
    rows = report_data(request.user)
    fields = ["club", "currency", "members", "deposited", "available", "engaged", "loans", "active_loans", "late_loans", "interest_generated", "repaid"]
    writer = csv.DictWriter(response, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return response


class ClubViewSet(viewsets.ModelViewSet):
    queryset = Club.objects.all()
    serializer_class = ClubSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "zone"]

    def get_queryset(self):
        return accessible_clubs(self.request.user).select_related("leader").order_by("name")

    def perform_create(self, serializer):
        if not (self.request.user.is_superuser or self.request.user.role == User.Role.ADMIN):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Seul l'administrateur peut creer un club.")
        leader = serializer.validated_data.get("leader")
        club = serializer.save(status=serializer.validated_data.get("status", Club.Status.DRAFT) if leader else Club.Status.DRAFT)
        if club.leader:
            Membership.objects.get_or_create(club=club, user=club.leader, role=Membership.Role.LEADER, defaults={"status": Membership.Status.ACTIVE})
        audit(self.request.user, "club.created", club, new={"name": club.name, "status": club.status})

    def update(self, request, *args, **kwargs):
        club = self.get_object()
        previous_leader = club.leader
        if not can_manage_club(request.user, club):
            return Response({"detail": "Permission refusee."}, status=403)
        data = request.data.copy()
        if request.user.role == User.Role.LEADER and not request.user.is_superuser:
            allowed = {"name"}
            data = {key: value for key, value in data.items() if key in allowed}
        serializer = self.get_serializer(club, data=data, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if not previous_leader and club.leader and club.status == Club.Status.DRAFT:
            club.status = Club.Status.ACTIVE
            club.save(update_fields=["status", "updated_at"])
        elif previous_leader and not club.leader:
            club.status = Club.Status.DRAFT
            club.save(update_fields=["status", "updated_at"])
        if previous_leader and previous_leader != club.leader:
            Membership.objects.filter(club=club, user=previous_leader, role=Membership.Role.LEADER).update(status=Membership.Status.LEFT)
        if club.leader:
            Membership.objects.update_or_create(club=club, user=club.leader, role=Membership.Role.LEADER, defaults={"status": Membership.Status.ACTIVE, "reviewed_by": request.user, "reviewed_at": timezone.now()})
        audit(request.user, "club.updated", club, new=data)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        club = self.get_object()
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Suppression reservee a l'administrateur."}, status=403)
        club.status = Club.Status.ARCHIVED
        club.save(update_fields=["status", "updated_at"])
        audit(request.user, "club.archived", club, new={"status": club.status})
        return Response(status=204)

    @action(detail=False, methods=["get"])
    def discover(self, request):
        clubs = Club.objects.filter(status=Club.Status.ACTIVE).select_related("leader").order_by("name")
        return Response({"results": ClubSerializer(clubs, many=True, context={"request": request}).data})

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        club = self.get_object()
        memberships = Membership.objects.filter(club=club).exclude(role=Membership.Role.LENDER).select_related("user").order_by("user__first_name")
        loans = Loan.objects.filter(club=club).select_related("borrower").order_by("-created_at")
        manager = can_manage_club(request.user, club)
        profile = request.user.current_profile
        visible_memberships = memberships if manager else memberships.none()
        if not manager and profile == User.Role.LENDER:
            loans = loans.filter(Q(status=Loan.Status.APPROVED) | Q(fundings__lender=request.user)).distinct()
        elif not manager and profile == User.Role.BORROWER:
            loans = loans.filter(borrower=request.user)
        loan_data = LoanSerializer(loans, many=True).data
        if not manager and profile == User.Role.LENDER:
            for item in loan_data:
                item["borrower_name"] = "Membre du club"
                item["estimated_income"] = None
                item["guarantors"] = ""
        return Response({
            "club": ClubSerializer(club).data,
            "memberships": MembershipSerializer(visible_memberships, many=True).data,
            "loans": loan_data,
            "counts": {
                "members": memberships.filter(status=Membership.Status.ACTIVE).values("user").distinct().count(),
                "lenders": LoanFunding.objects.filter(loan__club=club).values("lender").distinct().count(),
                "borrowers": memberships.filter(status=Membership.Status.ACTIVE, role=Membership.Role.BORROWER).count(),
                "active_loans": loans.filter(status__in=[Loan.Status.CURRENT, Loan.Status.LATE]).count(),
                "pending_loans": loans.filter(status__in=[Loan.Status.SUBMITTED, Loan.Status.REVIEW, Loan.Status.APPROVED]).count(),
            },
        })


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return ManagedUserSerializer
        if self.action in ["update", "partial_update"]:
            return ManagedUserUpdateSerializer
        return UserSerializer

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or user.role == User.Role.ADMIN:
            return User.objects.all().order_by("first_name", "last_name", "phone")
        if user.current_profile == User.Role.LEADER:
            return User.objects.filter(memberships__club__leader=user).distinct().order_by("first_name", "last_name", "phone")
        return User.objects.filter(pk=user.pk)

    def perform_create(self, serializer):
        if self.request.user.role != User.Role.ADMIN and self.request.user.current_profile != User.Role.LEADER and not self.request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Permission refusee.")
        user = serializer.save()
        audit(self.request.user, "user.created", user, new={"phone": user.phone, "role": user.role})

    @action(detail=False, methods=["post"], url_path="avatar", parser_classes=[MultiPartParser, FormParser])
    def upload_avatar(self, request):
        avatar = request.FILES.get("avatar")
        if not avatar:
            return Response({"avatar": "Selectionnez une image JPG ou PNG."}, status=400)
        if avatar.size > 5 * 1024 * 1024:
            return Response({"avatar": "La photo ne peut pas depasser 5 Mo."}, status=400)
        if avatar.content_type not in ["image/jpeg", "image/png", "image/webp"]:
            return Response({"avatar": "Utilisez une image JPG, PNG ou WebP."}, status=400)
        request.user.avatar = avatar
        request.user.save(update_fields=["avatar"])
        audit(request.user, "user.avatar_updated", request.user)
        return Response(UserSerializer(request.user, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="request-lender-profile")
    def request_lender_profile(self, request):
        if not request.user.has_valid_kyc:
            return Response({"detail": "Votre KYC doit etre valide avant de demander le profil preteur."}, status=400)
        if request.user.lender_profile_status == User.LenderProfileStatus.ACTIVE:
            return Response({"detail": "Votre profil preteur global est deja actif."}, status=400)
        request.user.lender_profile_status = User.LenderProfileStatus.PENDING
        request.user.lender_profile_requested_at = timezone.now()
        request.user.lender_profile_reviewed_at = None
        request.user.lender_profile_reviewed_by = None
        request.user.lender_profile_decision_reason = ""
        request.user.save(update_fields=["lender_profile_status", "lender_profile_requested_at", "lender_profile_reviewed_at", "lender_profile_reviewed_by", "lender_profile_decision_reason"])
        audit(request.user, "lender_profile.requested", request.user)
        for admin in User.objects.filter(role=User.Role.ADMIN, is_active=True):
            notify(admin, "Nouveau profil preteur", f"{request.user.display_name} demande un profil preteur global.", "lender_profile_review", {"user": str(request.user.id)})
        return Response(UserSerializer(request.user, context={"request": request}).data, status=201)

    @action(detail=False, methods=["get"], url_path="lender-profile-requests")
    def lender_profile_requests(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Consultation reservee a l'administrateur."}, status=403)
        users = User.objects.filter(lender_profile_status=User.LenderProfileStatus.PENDING, is_active=True).order_by("lender_profile_requested_at")
        return Response({"results": UserSerializer(users, many=True, context={"request": request}).data})

    @action(detail=True, methods=["post"], url_path="decide-lender-profile")
    def decide_lender_profile(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Validation reservee a l'administrateur."}, status=403)
        member = self.get_object()
        if member.lender_profile_status != User.LenderProfileStatus.PENDING:
            return Response({"detail": "Cette demande de profil preteur n'est plus en attente."}, status=400)
        approve = bool(request.data.get("approve", True))
        reason = str(request.data.get("reason", "")).strip()
        if not approve and not reason:
            return Response({"reason": "Le motif de refus est obligatoire."}, status=400)
        member.lender_profile_status = User.LenderProfileStatus.ACTIVE if approve else User.LenderProfileStatus.REJECTED
        member.lender_profile_reviewed_at = timezone.now()
        member.lender_profile_reviewed_by = request.user
        member.lender_profile_decision_reason = reason
        member.save(update_fields=["lender_profile_status", "lender_profile_reviewed_at", "lender_profile_reviewed_by", "lender_profile_decision_reason"])
        audit(request.user, "lender_profile.approved" if approve else "lender_profile.rejected", member, new={"status": member.lender_profile_status})
        notify(member, "Profil preteur traite", "Votre profil preteur global est actif." if approve else f"Votre demande de profil preteur est refusee: {reason}", "lender_profile")
        return Response(UserSerializer(member, context={"request": request}).data)

    def update(self, request, *args, **kwargs):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Modification reservee a l'administrateur."}, status=403)
        response = super().update(request, *args, **kwargs)
        user = self.get_object()
        if user.active_profile and user.active_profile not in user.available_profiles:
            user.active_profile = user.role
            user.save(update_fields=["active_profile"])
        return Response(UserSerializer(user).data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Suppression reservee a l'administrateur."}, status=403)
        user = self.get_object()
        if user == request.user:
            return Response({"detail": "Vous ne pouvez pas desactiver votre propre compte."}, status=400)
        user.is_active = False
        user.save(update_fields=["is_active"])
        audit(request.user, "user.deactivated", user, new={"is_active": False})
        return Response(status=204)

    @action(detail=False, methods=["get"], url_path="by-phone")
    def by_phone(self, request):
        if request.user.role != User.Role.ADMIN and request.user.current_profile != User.Role.LEADER and not request.user.is_superuser:
            return Response({"detail": "Permission refusee."}, status=403)
        phone = request.query_params.get("phone", "").replace(" ", "").replace("-", "")
        if len(phone) < 10:
            return Response({"phone": "Saisissez un numero international complet."}, status=400)
        user = User.objects.filter(phone=phone, is_active=True).first()
        if not user:
            return Response({"detail": "Aucun compte actif avec ce numero."}, status=404)
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        member = self.get_object()
        clubs = accessible_clubs(request.user)
        memberships = Membership.objects.filter(user=member, club__in=clubs).exclude(role=Membership.Role.LENDER).select_related("club", "user", "invited_by").order_by("club__name", "role")
        deposits = Deposit.objects.filter(lender=member, club__in=clubs).select_related("club", "lender").order_by("-created_at")
        loans = Loan.objects.filter(borrower=member, club__in=clubs).select_related("club", "borrower").prefetch_related("installments", "fundings__lender").order_by("-created_at")
        fundings = LoanFunding.objects.filter(lender=member, loan__club__in=clubs).select_related("loan", "loan__club").order_by("-created_at")
        withdrawals = Withdrawal.objects.filter(lender=member, club__in=clubs).select_related("club", "lender").order_by("-created_at")
        validated_deposits = deposits.filter(status=Deposit.Status.VALIDATED)
        available_capital = lender_total_available(member)
        return Response({
            "user": UserSerializer(member).data,
            "memberships": MembershipSerializer(memberships, many=True).data,
            "summary": {
                "deposited": str(money(validated_deposits.aggregate(total=Sum("amount"))["total"] or 0)),
                "available_capital": str(money(available_capital)),
                "placed": str(money(fundings.aggregate(total=Sum("amount"))["total"] or 0)),
                "expected_gain": str(money(fundings.aggregate(total=Sum("expected_gain"))["total"] or 0)),
                "interest_earned": str(money(fundings.aggregate(total=Sum("interest_earned"))["total"] or 0)),
                "borrowed": str(money(loans.aggregate(total=Sum("amount"))["total"] or 0)),
                "total_due": str(money(loans.aggregate(total=Sum("total_due"))["total"] or 0)),
                "repaid": str(money(loans.aggregate(total=Sum("total_paid"))["total"] or 0)),
                "balance": str(money(sum((loan.balance for loan in loans), Decimal("0")))),
            },
            "deposits": DepositSerializer(deposits[:20], many=True, context={"request": request}).data,
            "loans": LoanSerializer(loans[:20], many=True, context={"request": request}).data,
            "fundings": [{
                "loan": str(funding.loan_id), "reference": funding.loan.reference, "club_name": funding.loan.club.name,
                "amount": str(funding.amount), "expected_gain": str(funding.expected_gain),
                "principal_repaid": str(funding.principal_repaid), "interest_earned": str(funding.interest_earned),
                "status": funding.loan.status, "created_at": funding.created_at,
            } for funding in fundings[:20]],
            "withdrawals": WithdrawalSerializer(withdrawals[:20], many=True, context={"request": request}).data,
        })

    @action(detail=True, methods=["post"], url_path="verify-identity")
    def verify_identity(self, request, pk=None):
        return Response({"detail": "Utilisez le dossier KYC structure et son action de controle."}, status=410)

    @action(detail=True, methods=["post"], url_path="rate-borrower")
    def rate_borrower(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Notation reservee a l'administrateur."}, status=403)
        user = self.get_object()
        try:
            rating = int(request.data.get("rating"))
        except (TypeError, ValueError):
            return Response({"rating": "Saisissez une note entiere de 1 a 10."}, status=400)
        if rating < 1 or rating > 10:
            return Response({"rating": "La note doit etre comprise entre 1 et 10."}, status=400)
        user.admin_borrower_rating = rating
        user.save(update_fields=["admin_borrower_rating"])
        audit(request.user, "borrower.rated", user, new={"rating": rating})
        notify(user, "Evaluation mise a jour", f"Votre evaluation administrative est de {rating}/10.", "credit_score")
        return Response(UserSerializer(user, context={"request": request}).data)


class KYCApplicationViewSet(viewsets.ModelViewSet):
    queryset = KYCApplication.objects.all()
    serializer_class = KYCApplicationSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        queryset = KYCApplication.objects.select_related("user", "reviewed_by")
        if user.role == User.Role.ADMIN or user.is_superuser:
            return queryset.order_by("-submitted_at", "-created_at")
        if user.current_profile == User.Role.LEADER:
            return queryset.filter(user__memberships__club__leader=user).distinct().order_by("-submitted_at", "-created_at")
        return queryset.filter(user=user)

    @action(detail=False, methods=["get"], url_path="missing")
    def missing(self, request):
        """Comptes sans dossier KYC : l'admin peut deposer le dossier pour eux."""
        if not is_platform_admin(request.user):
            return deny("Consultation reservee a l'administrateur.")
        queryset = User.objects.filter(is_active=True, kyc_application__isnull=True).exclude(role=User.Role.ADMIN)
        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) | Q(last_name__icontains=search) |
                Q(phone__icontains=search) | Q(email__icontains=search)
            )
        queryset = queryset.order_by("first_name", "last_name", "phone")[:100]
        return Response({"results": UserSerializer(queryset, many=True, context={"request": request}).data})

    @action(detail=False, methods=["post"], url_path="submit-for")
    @transaction.atomic
    def submit_for(self, request):
        """Depot d'un dossier KYC par l'administrateur au nom d'un membre."""
        if not is_platform_admin(request.user):
            return deny("Operation reservee a l'administrateur.")
        member = User.objects.filter(pk=request.data.get("user"), is_active=True).first()
        if not member:
            return Response({"user": "Selectionnez un compte actif."}, status=400)
        instance = KYCApplication.objects.filter(user=member).first()
        if instance and instance.status in [KYCApplication.Status.SUBMITTED, KYCApplication.Status.REVIEW, KYCApplication.Status.APPROVED]:
            return Response({"detail": "Ce membre possede deja un dossier en controle ou valide."}, status=400)
        serializer = self.get_serializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        application = serializer.save(
            user=member, status=KYCApplication.Status.SUBMITTED,
            submitted_at=timezone.now(), reviewed_at=None, reviewed_by=None, decision_reason="",
        )
        member.kyc_verified = False
        member.save(update_fields=["kyc_verified"])
        audit(request.user, "kyc.assisted_submitted", application, new={"user": str(member.id), "document_type": application.document_type})
        notify(member, "Dossier KYC depose", "L'administration a depose votre dossier d'identite pour controle.", "kyc")
        return Response(self.get_serializer(application).data, status=201)

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def submit(self, request):
        instance = KYCApplication.objects.filter(user=request.user).first()
        if instance and instance.status in [KYCApplication.Status.SUBMITTED, KYCApplication.Status.REVIEW, KYCApplication.Status.APPROVED]:
            return Response({"detail": "Ce dossier est deja en controle ou valide. Attendez la decision administrative."}, status=400)
        serializer = self.get_serializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        application = serializer.save(
            user=request.user, status=KYCApplication.Status.SUBMITTED,
            submitted_at=timezone.now(), reviewed_at=None, reviewed_by=None, decision_reason="",
        )
        request.user.kyc_verified = False
        request.user.save(update_fields=["kyc_verified"])
        audit(request.user, "kyc.submitted", application, new={"document_type": application.document_type})
        for admin in User.objects.filter(role=User.Role.ADMIN, is_active=True):
            notify(admin, "Nouveau dossier KYC", f"{request.user.display_name} a soumis ses informations et ses pieces.", "kyc_review", {"kyc": str(application.id)})
            if application.activity_reference and application.activity_reference.status == EconomicActivity.Status.PENDING:
                notify(admin, "Nouvelle activite proposee", f"{request.user.display_name} propose l'activite: {application.activity}.", "activity_review", {"activity": str(application.activity_reference_id)})
        return Response(self.get_serializer(application).data, status=201)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def review(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "La validation finale KYC est reservee a l'administrateur."}, status=403)
        application = self.get_object()
        approve = bool(request.data.get("approve", True))
        reason = str(request.data.get("reason", "")).strip()
        if not approve and not reason:
            return Response({"reason": "Le motif de refus est obligatoire."}, status=400)
        application.status = KYCApplication.Status.APPROVED if approve else KYCApplication.Status.REJECTED
        application.decision_reason = reason
        application.reviewed_by = request.user
        application.reviewed_at = timezone.now()
        application.save(update_fields=["status", "decision_reason", "reviewed_by", "reviewed_at", "updated_at"])
        application.user.kyc_verified = approve
        if approve:
            application.user.identity_document.name = application.identity_document.name
            application.user.selfie.name = application.selfie.name
        application.user.save(update_fields=["kyc_verified", "identity_document", "selfie"])
        audit(request.user, "kyc.approved" if approve else "kyc.rejected", application, new={"status": application.status, "reason": reason})
        notify(application.user, "Dossier KYC traite", "Votre identite est validee." if approve else f"Votre dossier KYC est refuse: {reason}", "kyc")
        return Response(self.get_serializer(application).data)


class EconomicActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = EconomicActivity.objects.all()
    serializer_class = EconomicActivitySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if self.action in ["pending", "review"] and (self.request.user.role == User.Role.ADMIN or self.request.user.is_superuser):
            return EconomicActivity.objects.all().select_related("proposed_by", "reviewed_by").order_by("name")
        return EconomicActivity.objects.filter(status=EconomicActivity.Status.ACTIVE).order_by("name")

    @action(detail=False, methods=["get"])
    def pending(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Consultation reservee a l'administrateur."}, status=403)
        queryset = self.get_queryset().filter(status=EconomicActivity.Status.PENDING)
        return Response({"results": self.get_serializer(queryset, many=True).data})

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Validation reservee a l'administrateur."}, status=403)
        activity = self.get_object()
        if activity.status != EconomicActivity.Status.PENDING:
            return Response({"detail": "Cette proposition n'est plus en attente."}, status=400)
        approve = bool(request.data.get("approve", True))
        reason = str(request.data.get("reason", "")).strip()
        if approve and EconomicActivity.objects.filter(status=EconomicActivity.Status.ACTIVE, name__iexact=activity.name).exclude(pk=activity.pk).exists():
            return Response({"detail": "Cette activite existe deja dans la liste publique."}, status=400)
        if not approve and not reason:
            return Response({"reason": "Le motif de refus est obligatoire."}, status=400)
        activity.status = EconomicActivity.Status.ACTIVE if approve else EconomicActivity.Status.REJECTED
        activity.reviewed_by = request.user
        activity.reviewed_at = timezone.now()
        activity.decision_reason = reason
        activity.save(update_fields=["status", "reviewed_by", "reviewed_at", "decision_reason", "updated_at"])
        audit(request.user, "activity.approved" if approve else "activity.rejected", activity, new={"status": activity.status})
        if activity.proposed_by:
            notify(activity.proposed_by, "Activite examinee", f"Votre proposition '{activity.name}' est maintenant {activity.get_status_display().lower()}.", "activity")
        return Response(self.get_serializer(activity).data)



class LoanPurposeViewSet(viewsets.ModelViewSet):
    """Objets de pret proposes en liste deroulante. CRUD reserve a l'administrateur."""

    queryset = LoanPurpose.objects.all()
    serializer_class = LoanPurposeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if is_platform_admin(self.request.user):
            return LoanPurpose.objects.all().order_by("position", "name")
        return LoanPurpose.objects.filter(is_active=True).order_by("position", "name")

    def _guard(self):
        if not is_platform_admin(self.request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("La gestion des objets de pret est reservee a l'administrateur.")

    def perform_create(self, serializer):
        self._guard()
        purpose = serializer.save(created_by=self.request.user)
        audit(self.request.user, "loan_purpose.created", purpose, new={"name": purpose.name})

    def perform_update(self, serializer):
        self._guard()
        purpose = serializer.save()
        audit(self.request.user, "loan_purpose.updated", purpose, new={"name": purpose.name, "is_active": purpose.is_active})

    def destroy(self, request, *args, **kwargs):
        self._guard()
        purpose = self.get_object()
        purpose.is_active = False
        purpose.save(update_fields=["is_active", "updated_at"])
        audit(request.user, "loan_purpose.archived", purpose, new={"is_active": False})
        return Response(status=204)


class LoanBorrowerViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Invitations de prets collectifs recues par l'utilisateur connecte."""

    queryset = LoanBorrower.objects.all()
    serializer_class = LoanBorrowerSerializer

    def get_queryset(self):
        return LoanBorrower.objects.filter(user=self.request.user).select_related("loan", "loan__club", "user").order_by("-created_at")

    @action(detail=False, methods=["get"])
    def pending(self, request):
        queryset = self.get_queryset().filter(status=LoanBorrower.Status.PENDING, loan__status=Loan.Status.PENDING_PARTNERS)
        return Response({"results": [{
            **LoanBorrowerSerializer(row).data,
            "loan": str(row.loan_id),
            "loan_reference": row.loan.reference,
            "loan_amount": str(row.loan.amount),
            "club_name": row.loan.club.name,
            "currency": row.loan.currency,
            "purpose": row.loan.purpose,
            "requested_by": row.loan.borrower.display_name,
        } for row in queryset]})


class InvitationViewSet(viewsets.ModelViewSet):
    queryset = Invitation.objects.all()
    serializer_class = InvitationSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if self.request.user.role == User.Role.ADMIN or self.request.user.is_superuser:
            return Invitation.objects.all().select_related("club", "created_by").order_by("-created_at")
        if self.request.user.current_profile == User.Role.LEADER:
            return Invitation.objects.filter(club__leader=self.request.user).select_related("club", "created_by").order_by("-created_at")
        return Invitation.objects.none()

    def perform_create(self, serializer):
        if self.request.user.role != User.Role.ADMIN and self.request.user.current_profile != User.Role.LEADER and not self.request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Permission refusee.")
        invitation = serializer.save(created_by=self.request.user, expires_at=timezone.now() + timedelta(days=7))
        audit(self.request.user, "invitation.created", invitation, new={"phone": invitation.phone, "role": invitation.role})

    def create(self, request, *args, **kwargs):
        return Response({"detail": "Les liens d'invitation sont desactives. Chaque membre demande lui-meme son adhesion depuis son profil."}, status=410)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invitation = self.get_object()
        invitation.status = Invitation.Status.CANCELLED
        invitation.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(invitation).data)


class MembershipViewSet(viewsets.ModelViewSet):
    queryset = Membership.objects.all()
    serializer_class = MembershipSerializer

    def get_queryset(self):
        return Membership.objects.filter(Q(club__in=accessible_clubs(self.request.user)) | Q(user=self.request.user)).exclude(role=Membership.Role.LENDER).distinct().select_related("club", "user", "reviewed_by", "invited_by")

    def perform_create(self, serializer):
        club = serializer.validated_data["club"]
        requested_user = serializer.validated_data["user"]
        requested_role = serializer.validated_data["role"]
        if club.status != Club.Status.ACTIVE or not club.leader_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Ce club n'accepte pas encore de demandes d'adhesion.")
        if requested_user != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Vous ne pouvez demander une adhesion que pour vous-meme.")
        if requested_role != Membership.Role.BORROWER:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le profil preteur est global et doit etre demande sans choisir de club.")
        if not requested_user.has_valid_kyc:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Votre KYC doit etre valide avant de demander un profil preteur ou emprunteur.")
        now = timezone.now()
        membership = Membership.objects.filter(club=club, user=requested_user, role=requested_role).first()
        if membership and membership.status == Membership.Status.ACTIVE:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Ce profil est deja actif dans ce club.")
        if membership:
            membership.status = Membership.Status.PENDING
            membership.invited_by = requested_user
            membership.accepted_at = now
            membership.member_approved_at = now
            membership.leader_approved_at = now if club.leader_id == requested_user.id else None
            membership.reviewed_by = None
            membership.reviewed_at = None
            membership.decision_reason = ""
            membership.save()
            serializer.instance = membership
        else:
            membership = serializer.save(
                status=Membership.Status.PENDING, invited_by=requested_user,
                accepted_at=now, member_approved_at=now,
                leader_approved_at=now if club.leader_id == requested_user.id else None,
            )
        audit(self.request.user, "membership.requested", membership, new={"role": membership.role})
        if club.leader and club.leader_id != requested_user.id:
            notify(club.leader, "Nouvelle demande d'adhesion", f"{requested_user.display_name} souhaite rejoindre {club.name} comme {membership.get_role_display()}.", "membership_leader_review", {"membership": str(membership.id)})
        else:
            for admin in User.objects.filter(role=User.Role.ADMIN, is_active=True):
                notify(admin, "Adhesion prete pour validation", f"{requested_user.display_name} et le chef ont confirme l'adhesion a {club.name}.", "membership_review", {"membership": str(membership.id)})

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def invite(self, request):
        return Response({"detail": "Les adhesions sont maintenant demandees directement par les membres depuis leur profil."}, status=410)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        membership = self.get_object()
        if membership.user_id != request.user.id:
            return Response({"detail": "Cette demande ne vous appartient pas."}, status=403)
        if membership.status != Membership.Status.PENDING:
            return Response({"detail": "Cette invitation ne peut plus etre traitee."}, status=400)
        accepted = bool(request.data.get("accept", True))
        if accepted:
            if not membership.user.has_valid_kyc:
                return Response({"detail": "Votre KYC doit etre valide avant de confirmer cette adhesion."}, status=400)
            membership.accepted_at = timezone.now()
            membership.member_approved_at = membership.accepted_at
            membership.save(update_fields=["accepted_at", "member_approved_at", "updated_at"])
            if membership.leader_approved_at:
                for admin in User.objects.filter(role=User.Role.ADMIN, is_active=True):
                    notify(admin, "Adhesion prete pour validation", f"Le membre et le chef ont confirme l'adhesion a {membership.club.name}.", "membership_review", {"membership": str(membership.id)})
            elif membership.club.leader:
                notify(membership.club.leader, "Adhesion confirmee par le membre", f"{membership.user.display_name} attend votre confirmation pour {membership.club.name}.", "membership_leader_review", {"membership": str(membership.id)})
        else:
            membership.status = Membership.Status.LEFT
            membership.decision_reason = "Invitation refusee par le membre"
            membership.save(update_fields=["status", "decision_reason", "updated_at"])
        audit(request.user, "membership.accepted" if accepted else "membership.declined", membership, new={"accepted": accepted})
        return Response(self.get_serializer(membership).data)

    @action(detail=True, methods=["post"], url_path="leader-decide")
    def leader_decide(self, request, pk=None):
        membership = self.get_object()
        if membership.club.leader_id != request.user.id or request.user.current_profile != User.Role.LEADER:
            return Response({"detail": "Seul le chef de ce club peut confirmer cette adhesion."}, status=403)
        if membership.status != Membership.Status.PENDING:
            return Response({"detail": "Cette demande ne peut plus etre traitee."}, status=400)
        approve = bool(request.data.get("approve", True))
        reason = str(request.data.get("reason", "")).strip()
        if not approve:
            if not reason:
                return Response({"reason": "Le motif de refus est obligatoire."}, status=400)
            membership.status = Membership.Status.BLOCKED
            membership.decision_reason = reason
            membership.save(update_fields=["status", "decision_reason", "updated_at"])
            notify(membership.user, "Adhesion refusee par le chef", reason, "membership")
        else:
            membership.leader_approved_at = timezone.now()
            membership.save(update_fields=["leader_approved_at", "updated_at"])
            if membership.member_approved_at:
                for admin in User.objects.filter(role=User.Role.ADMIN, is_active=True):
                    notify(admin, "Adhesion prete pour validation", f"Le membre et le chef ont confirme l'adhesion a {membership.club.name}.", "membership_review", {"membership": str(membership.id)})
            else:
                notify(membership.user, "Adhesion confirmee par le chef", f"Confirmez maintenant votre adhesion a {membership.club.name}.", "club_invitation", {"membership": str(membership.id)})
        audit(request.user, "membership.leader_approved" if approve else "membership.leader_rejected", membership, new={"approve": approve})
        return Response(self.get_serializer(membership).data)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        membership = self.get_object()
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "La validation finale est reservee a l'administrateur."}, status=403)
        if not membership.member_approved_at or not membership.leader_approved_at:
            return Response({"detail": "Le membre et le chef du club doivent tous les deux confirmer avant la validation admin."}, status=400)
        if not membership.user.has_valid_kyc:
            return Response({"detail": "Le KYC du membre doit etre valide avant l'activation de son profil."}, status=400)
        approve = request.data.get("approve", True)
        reason = request.data.get("reason", "")
        if not approve and not reason:
            return Response({"reason": "Le motif est obligatoire."}, status=400)
        membership.status = Membership.Status.ACTIVE if approve else Membership.Status.BLOCKED
        membership.reviewed_by = request.user
        membership.reviewed_at = timezone.now()
        membership.decision_reason = reason
        membership.save()
        audit(request.user, "membership.decided", membership, new={"status": membership.status})
        notify(membership.user, "Adhesion traitee", f"Votre adhesion a {membership.club.name} est {membership.get_status_display().lower()}.", "membership")
        return Response(self.get_serializer(membership).data)


class DepositViewSet(viewsets.ModelViewSet):
    queryset = Deposit.objects.all()
    serializer_class = DepositSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        # Les depots alimentent un portefeuille preteur global : seuls
        # l'administrateur et le preteur concerne y ont acces.
        if is_platform_admin(self.request.user):
            queryset = Deposit.objects.all()
        else:
            queryset = Deposit.objects.filter(lender=self.request.user)
        return queryset.select_related("club", "lender").order_by("-created_at")

    def perform_create(self, serializer):
        club = serializer.validated_data.get("club")
        lender = serializer.validated_data.get("lender")
        if self.request.user.current_profile == User.Role.LENDER:
            lender = self.request.user
        if not lender or not lender.has_valid_kyc:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le KYC du preteur doit etre valide avant tout depot.")
        if lender.lender_profile_status != User.LenderProfileStatus.ACTIVE:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le profil preteur global doit etre valide par l'administrateur.")
        if not is_platform_admin(self.request.user) and lender != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Vous ne pouvez creer que vos propres depots.")
        currency = club.currency if club else PlatformSettings.load().default_currency
        deposit = serializer.save(lender=lender, currency=club.currency if club else currency)
        audit(self.request.user, "deposit.created", deposit, new={"amount": str(deposit.amount)})

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def assisted(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Operation reservee a l'administrateur."}, status=403)
        serializer = AssistedDepositSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        club = data.get("club")
        deposit = Deposit.objects.create(
            club=club, lender=data["lender"], amount=data["amount"],
            currency=club.currency if club else PlatformSettings.load().default_currency,
            payment_method=data["payment_method"],
            provider_reference=data.get("provider_reference", ""),
        )
        audit(request.user, "deposit.assisted_created", deposit, new={
            "amount": str(deposit.amount), "lender": str(deposit.lender_id), "payment_method": deposit.payment_method,
        })
        deposit = validate_deposit(deposit, request.user)
        return Response(self.get_serializer(deposit).data, status=201)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """Encaissement d'un depot : administrateur uniquement."""
        if not is_platform_admin(request.user):
            return deny("L'encaissement des depots est reserve a l'administrateur.")
        deposit = self.get_object()
        deposit = validate_deposit(deposit, request.user, request.data.get("approve", True), request.data.get("reason", ""))
        return Response(self.get_serializer(deposit).data)


class LoanViewSet(viewsets.ModelViewSet):
    queryset = Loan.objects.all()
    serializer_class = LoanSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        profile = user.current_profile
        if is_platform_admin(user):
            queryset = Loan.objects.all()
        elif profile == User.Role.LENDER:
            # Le preteur voit le marche des prets valides, sans lien avec les clubs.
            queryset = Loan.objects.filter(club__status=Club.Status.ACTIVE)
        elif profile == User.Role.COLLECTOR:
            queryset = Loan.objects.filter(collection_agent=user)
        else:
            queryset = Loan.objects.filter(club__in=accessible_clubs(user))
        queryset = queryset.select_related("club", "borrower", "collection_agent", "purpose_reference").prefetch_related("installments", "fundings__lender", "repayments__payer", "borrowers__user")
        if profile == User.Role.BORROWER and not is_platform_admin(user):
            queryset = queryset.filter(Q(borrower=user) | Q(borrowers__user=user)).distinct()
        elif profile == User.Role.LENDER and not is_platform_admin(user):
            queryset = queryset.filter(
                Q(status=Loan.Status.APPROVED, funding_completed_at__isnull=True) |
                Q(fundings__lender=user)
            ).distinct()
        elif profile == User.Role.LEADER and not is_platform_admin(user):
            # Un chef ne voit jamais les prets d'un autre club.
            queryset = queryset.exclude(status=Loan.Status.PENDING_PARTNERS).filter(club__leader=user)
        return queryset.order_by("-created_at")

    def perform_create(self, serializer):
        loan = serializer.save()
        if loan.status == Loan.Status.PENDING_PARTNERS:
            audit(self.request.user, "loan.collective_started", loan, new={"amount": str(loan.amount)})
            for row in loan.borrowers.exclude(user=self.request.user).select_related("user"):
                notify(
                    row.user, "Invitation a un pret collectif",
                    f"{loan.borrower.display_name} vous propose de partager un pret de {loan.amount} {loan.currency}. Votre part proposee: {row.share_amount} {loan.currency}.",
                    "collective_request", {"loan": str(loan.id)},
                )
        else:
            submit_loan(loan, self.request.user)

    # ------------------------------------------------------------- catalogues
    @action(detail=False, methods=["get"])
    def catalog(self, request):
        """Durees, frequences compatibles et objets de pret disponibles."""
        return Response({
            "durations": [{
                "code": code, "label": item["label"],
                "frequencies": [{
                    "code": frequency, "label": REPAYMENT_FREQUENCIES[frequency]["label"],
                    "installments": installment_count(code, frequency),
                } for frequency in allowed_frequencies(code)],
            } for code, item in LOAN_DURATIONS.items()],
            "purposes": LoanPurposeSerializer(LoanPurpose.objects.filter(is_active=True), many=True).data,
        })

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def assisted(self, request):
        if not is_platform_admin(request.user):
            return deny("Operation reservee a l'administrateur.")
        serializer = AssistedLoanSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        club = data.pop("club")
        borrower = data.pop("borrower")
        partners = data.pop("partners", [])
        shares = data.pop("shares", {})
        purpose_reference = data.pop("purpose_id", None)
        purpose = purpose_reference.name if purpose_reference else data.pop("purpose", "")
        data.pop("purpose", None)
        partner_users = list(User.objects.filter(id__in=partners, is_active=True).exclude(pk=borrower.pk)) if partners else []
        loan = Loan.objects.create(
            club=club, borrower=borrower, currency=club.currency, purpose=purpose,
            purpose_reference=purpose_reference,
            interest_rate=club.interest_rate, fee_rate=club.platform_fee_rate,
            leader_commission_rate=club.leader_commission_rate,
            duration_months=duration_in_months(data["duration_code"]),
            is_collective=bool(partner_users),
            status=Loan.Status.PENDING_PARTNERS if partner_users else Loan.Status.SUBMITTED,
            **data,
        )
        LoanBorrower.objects.create(loan=loan, user=borrower, is_primary=True, status=LoanBorrower.Status.ACCEPTED, responded_at=timezone.now())
        for partner in partner_users:
            LoanBorrower.objects.create(loan=loan, user=partner, status=LoanBorrower.Status.PENDING)
        sync_collective_shares(loan, shares)
        audit(request.user, "loan.assisted_submitted", loan, new={"amount": str(loan.amount), "borrower": str(borrower.id)})
        if loan.status == Loan.Status.SUBMITTED:
            for recipient in {item for item in {club.leader, *platform_admins()} if item}:
                notify(recipient, "Nouvelle demande de pret assistee", f"{borrower.display_name} demande {loan.amount} {loan.currency} dans {club.name}.", "loan_review", {"loan": str(loan.id)})
        else:
            for row in loan.borrowers.exclude(user=borrower).select_related("user"):
                notify(row.user, "Invitation a un pret collectif", f"{borrower.display_name} vous propose de partager un pret de {loan.amount} {loan.currency}.", "collective_request", {"loan": str(loan.id)})
        notify(borrower, "Demande enregistree", f"La demande {loan.reference} a ete enregistree en votre nom par l'administration.", "loan", {"loan": str(loan.id)})
        return Response(self.get_serializer(loan).data, status=201)

    @action(detail=False, methods=["post"])
    def simulate(self, request):
        serializer = LoanSimulationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        club = data["club"]
        if not is_platform_admin(request.user) and club not in accessible_clubs(request.user):
            return deny("Club inaccessible.")
        amount = money(data["amount"])
        duration_code = data["duration_code"]
        frequency = data["repayment_frequency"]
        if not club.min_loan <= amount <= club.max_loan:
            return Response({"detail": f"Le montant doit etre compris entre {club.min_loan:.0f} et {club.max_loan:.0f} {club.currency}."}, status=400)
        if duration_code not in club.duration_options:
            return Response({"duration_code": "Cette duree n'est pas proposee par le club."}, status=400)
        count = installment_count(duration_code, frequency)
        if count <= 0:
            allowed = ", ".join(REPAYMENT_FREQUENCIES[code]["label"] for code in allowed_frequencies(duration_code))
            return Response({"repayment_frequency": f"Frequence incompatible avec la duree. Frequences possibles : {allowed}."}, status=400)
        costs = loan_cost_breakdown(amount, club.interest_rate, club.platform_fee_rate, club.leader_commission_rate)
        dates = installment_dates(timezone.localdate(), duration_code, frequency)
        payload = {
            "amount": str(costs["amount"]),
            # Vu de l'emprunteur : un seul cout global.
            "charge": str(costs["charge"]),
            "charge_rate": str(club.borrower_charge_rate),
            "total_due": str(costs["total_due"]),
            "installments": count,
            "installment_amount": str(money(costs["total_due"] / count)),
            "duration_label": LOAN_DURATIONS[duration_code]["label"],
            "frequency_label": REPAYMENT_FREQUENCIES[frequency]["label"],
            "first_due_date": dates[0],
            "last_due_date": dates[-1],
            "currency": club.currency,
        }
        if is_platform_admin(request.user):
            payload.update({
                "interest": str(costs["interest"]),
                "platform_commission": str(costs["fee"]),
                "leader_commission": str(costs["leader_commission"]),
            })
        elif request.user.current_profile == User.Role.LEADER:
            payload["leader_commission"] = str(costs["leader_commission"])
        return Response(payload)

    # --------------------------------------------------------- pret collectif
    @action(detail=True, methods=["post"], url_path="respond")
    @transaction.atomic
    def respond(self, request, pk=None):
        """Reponse d'un co-emprunteur invite sur un pret collectif."""
        loan = self.get_object()
        row = loan.borrowers.filter(user=request.user).first()
        if not row or row.is_primary:
            return deny("Vous n'etes pas invite sur ce pret collectif.")
        if loan.status != Loan.Status.PENDING_PARTNERS or row.status != LoanBorrower.Status.PENDING:
            return deny("Cette invitation ne peut plus etre traitee.", 400)
        serializer = CollectiveResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data["accept"]:
            row.status = LoanBorrower.Status.DECLINED
            row.responded_at = timezone.now()
            row.decision_reason = data.get("reason", "")
            row.save(update_fields=["status", "responded_at", "decision_reason", "updated_at"])
            loan.status = Loan.Status.CANCELLED
            loan.decision_reason = f"{request.user.display_name} a refuse de participer."
            loan.save(update_fields=["status", "decision_reason", "updated_at"])
            audit(request.user, "loan.collective_declined", loan, new={"user": str(request.user.id)})
            notify(loan.borrower, "Pret collectif annule", f"{request.user.display_name} a refuse de participer au pret {loan.reference}.", "collective", {"loan": str(loan.id)})
            return Response(self.get_serializer(loan).data)
        share = data.get("share_amount")
        if share is not None:
            if share <= 0:
                return Response({"share_amount": "La part doit etre positive."}, status=400)
            # Seules les parts SAISIES par les autres sont figees : les parts par
            # defaut (dont celle de l'initiateur) absorbent le reliquat.
            fixed_by_others = LoanBorrower.objects.filter(loan=loan, share_is_manual=True).exclude(pk=row.pk).aggregate(total=Sum("share_amount"))["total"] or Decimal("0")
            if money(share) + fixed_by_others > loan.amount:
                return Response({"share_amount": "La part demandee depasse le capital restant a repartir."}, status=400)
            row.share_amount = money(share)
            row.share_is_manual = True
        row.status = LoanBorrower.Status.ACCEPTED
        row.responded_at = timezone.now()
        row.save(update_fields=["share_amount", "share_is_manual", "status", "responded_at", "updated_at"])
        # Redistribution du reliquat entre les parts non saisies.
        sync_collective_shares(loan)
        audit(request.user, "loan.collective_accepted", loan, new={"user": str(request.user.id), "share": str(row.share_amount)})
        loan.refresh_from_db()
        if collective_is_ready(loan):
            submit_loan(loan, request.user)
            for item in loan.borrowers.select_related("user"):
                notify(item.user, "Pret collectif transmis", f"Le pret {loan.reference} est complet et transmis pour validation.", "collective", {"loan": str(loan.id)})
        else:
            notify(loan.borrower, "Co-emprunteur confirme", f"{request.user.display_name} a accepte une part de {row.share_amount} {loan.currency}.", "collective", {"loan": str(loan.id)})
        return Response(self.get_serializer(loan).data)

    # ------------------------------------------------------------- decisions
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        loan = self.get_object()
        if not can_manage_club(request.user, loan.club):
            return deny("Permission refusee.")
        loan = approve_loan(loan, request.user, request.data.get("approve", True), request.data.get("reason", ""))
        return Response(self.get_serializer(loan).data)

    @action(detail=True, methods=["post"])
    def disburse(self, request, pk=None):
        """Decaissement : administrateur uniquement."""
        if not is_platform_admin(request.user):
            return deny("Le decaissement est reserve a l'administrateur.")
        loan = self.get_object()
        return Response(self.get_serializer(disburse_loan(loan, request.user)).data)

    @action(detail=True, methods=["post"], url_path="assign-agent")
    def assign_agent(self, request, pk=None):
        """Designation du mandataire d'encaissement pour ce pret."""
        if not is_platform_admin(request.user):
            return deny("La designation d'un mandataire est reservee a l'administrateur.")
        loan = self.get_object()
        serializer = CollectionAgentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        agent = serializer.validated_data.get("agent")
        if agent and agent.id in {loan.borrower_id, *loan.borrowers.values_list("user_id", flat=True)}:
            return Response({"agent": "Un emprunteur du pret ne peut pas en etre le mandataire."}, status=400)
        previous = loan.collection_agent
        loan.collection_agent = agent
        loan.collection_agent_assigned_at = timezone.now() if agent else None
        loan.save(update_fields=["collection_agent", "collection_agent_assigned_at", "updated_at"])
        audit(request.user, "loan.agent_assigned" if agent else "loan.agent_cleared", loan, old={"agent": str(previous.id) if previous else None}, new={"agent": str(agent.id) if agent else None})
        if agent:
            notify(agent, "Mandat d'encaissement", f"Vous encaissez desormais les echeances du pret {loan.reference} ({loan.frequency_label.lower()}).", "collection", {"loan": str(loan.id)})
        if previous and previous != agent:
            notify(previous, "Mandat retire", f"Vous n'encaissez plus le pret {loan.reference}.", "collection", {"loan": str(loan.id)})
        return Response(self.get_serializer(loan).data)

    # -------------------------------------------------------------- placement
    @action(detail=True, methods=["post"])
    def fund(self, request, pk=None):
        loan = self.get_object()
        admin = is_platform_admin(request.user)
        serializer_class = AssistedFundingSerializer if admin and request.data.get("lender") else FundingContributionSerializer
        serializer = serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        lender = serializer.validated_data.get("lender", request.user)
        funding = fund_loan(loan, lender, serializer.validated_data["amount"], actor=request.user)
        loan.refresh_from_db()
        return Response({
            "funding": LoanFundingSerializer(funding).data,
            "loan": self.get_serializer(loan).data,
            "forecast": self._funding_forecast(loan, funding.pending_amount or funding.amount),
            "message": "Votre placement est enregistre et attend la validation de l'administrateur.",
        }, status=201)

    @action(detail=False, methods=["get"], url_path="pending-placements")
    def pending_placements(self, request):
        if not is_platform_admin(request.user):
            return deny("Consultation reservee a l'administrateur.")
        queryset = LoanFunding.objects.filter(pending_amount__gt=0).select_related("loan", "loan__club", "lender").order_by("submitted_at")
        return Response({"results": LoanFundingSerializer(queryset, many=True).data})

    @action(detail=False, methods=["post"], url_path="placements/(?P<funding_id>[^/.]+)/review")
    def review_placement(self, request, funding_id=None):
        if not is_platform_admin(request.user):
            return deny("La validation des placements est reservee a l'administrateur.")
        funding = LoanFunding.objects.filter(pk=funding_id).first()
        if not funding:
            return deny("Placement introuvable.", 404)
        serializer = FundingReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        funding = review_funding(funding, request.user, serializer.validated_data["approve"], serializer.validated_data.get("reason", ""))
        return Response(LoanFundingSerializer(funding).data)

    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        if not is_platform_admin(request.user):
            return deny("La programmation du decaissement est reservee a l'administrateur.")
        loan = self.get_object()
        if loan.funding_remaining > 0:
            return Response({"detail": "Le financement n'est pas complet."}, status=400)
        from datetime import date
        try:
            scheduled = date.fromisoformat(request.data.get("date", ""))
        except ValueError:
            return Response({"date": "Date invalide au format AAAA-MM-JJ."}, status=400)
        if scheduled < timezone.localdate():
            return Response({"date": "La date ne peut pas etre dans le passe."}, status=400)
        loan.scheduled_disbursement_date = scheduled
        loan.save(update_fields=["scheduled_disbursement_date", "updated_at"])
        for recipient in {item for item in {loan.borrower, loan.club.leader, *[funding.lender for funding in loan.fundings.select_related("lender")]} if item}:
            notify(recipient, "Decaissement programme", f"Le pret {loan.reference} sera decaisse le {scheduled:%d/%m/%Y}.", "disbursement", {"loan": str(loan.id)})
        return Response(self.get_serializer(loan).data)

    @action(detail=True, methods=["get"], url_path="funding-forecast")
    def funding_forecast(self, request, pk=None):
        loan = self.get_object()
        amount = money(request.query_params.get("amount", 0))
        if amount <= 0 or amount > loan.funding_open_amount:
            return Response({"amount": "Montant invalide."}, status=400)
        return Response(self._funding_forecast(loan, amount))

    def _funding_forecast(self, loan, amount):
        """Projection du preteur : uniquement SON capital et SON interet."""
        ratio = amount / loan.amount if loan.amount else Decimal("0")
        gain = money(loan.interest_total * ratio)
        count = loan.installment_total or installment_count(loan.duration_code, loan.repayment_frequency) or 1
        start = loan.scheduled_disbursement_date or (timezone.localdate() + timedelta(days=1))
        dates = installment_dates(start, loan.duration_code, loan.repayment_frequency)
        return {
            "invested": str(amount), "expected_gain": str(gain), "expected_total": str(amount + gain),
            "first_due_date": dates[0], "last_due_date": dates[-1],
            "installments": count, "estimated_periodic_return": str(money((amount + gain) / count)),
            "frequency_label": loan.frequency_label, "duration_label": loan.duration_label,
            "currency": loan.currency,
        }

    # ------------------------------------------------------------ encaissement
    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        """Encaissement : administrateur ou mandataire designe sur ce pret."""
        loan = self.get_object()
        if not can_collect(request.user, loan):
            return deny("Seul l'administrateur ou le mandataire designe peut encaisser ce pret.")
        borrower = None
        borrower_id = request.data.get("borrower")
        if borrower_id:
            borrower = User.objects.filter(pk=borrower_id).first()
            if not borrower:
                return Response({"borrower": "Co-emprunteur introuvable."}, status=400)
        repayment = record_repayment(
            loan, request.user, request.data.get("amount", 0),
            request.data.get("payment_method", "cash"), borrower=borrower,
        )
        return Response(RepaymentSerializer(repayment).data, status=201)

    @action(detail=False, methods=["get"], url_path="to-collect")
    def to_collect(self, request):
        """Prets a encaisser par l'utilisateur connecte (admin ou mandataire)."""
        queryset = Loan.objects.filter(status__in=[Loan.Status.CURRENT, Loan.Status.LATE])
        if not is_platform_admin(request.user):
            queryset = queryset.filter(collection_agent=request.user)
        queryset = queryset.select_related("club", "borrower").prefetch_related("installments", "borrowers__user").order_by("-created_at")
        return Response({"results": self.get_serializer(queryset, many=True).data})


class WithdrawalViewSet(viewsets.ModelViewSet):
    queryset = Withdrawal.objects.all()
    serializer_class = WithdrawalSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if is_platform_admin(self.request.user):
            queryset = Withdrawal.objects.all()
        else:
            queryset = Withdrawal.objects.filter(lender=self.request.user)
        return queryset.select_related("club", "lender").order_by("-created_at")

    def perform_create(self, serializer):
        if self.request.user.lender_profile_status != User.LenderProfileStatus.ACTIVE:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le profil preteur global doit etre actif avant un retrait.")
        if not self.request.user.has_valid_kyc:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le KYC du preteur doit etre valide avant un retrait.")
        if lender_total_available(self.request.user) < serializer.validated_data["amount"]:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le capital libre est insuffisant.")
        withdrawal = serializer.save()
        audit(self.request.user, "withdrawal.submitted", withdrawal, new={"amount": str(withdrawal.amount)})

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def assisted(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Operation reservee a l'administrateur."}, status=403)
        serializer = AssistedWithdrawalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if lender_total_available(data["lender"]) < data["amount"]:
            return Response({"amount": "Le capital disponible du client est insuffisant."}, status=400)
        club = data.get("club")
        withdrawal = Withdrawal.objects.create(
            club=club, lender=data["lender"], amount=data["amount"],
            currency=club.currency if club else PlatformSettings.load().default_currency,
            status=Withdrawal.Status.PAID,
            reviewed_by=request.user, decision_reason="Retrait assiste paye par l'administration.",
        )
        audit(request.user, "withdrawal.assisted_paid", withdrawal, new={
            "amount": str(withdrawal.amount), "lender": str(withdrawal.lender_id), "status": withdrawal.status,
        })
        notify(
            withdrawal.lender,
            "Retrait effectue",
            f"Un retrait de {withdrawal.amount} {withdrawal.currency} a ete effectue par l'administration.",
            "withdrawal",
            {"withdrawal": str(withdrawal.id)},
        )
        return Response(self.get_serializer(withdrawal).data, status=201)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def decide(self, request, pk=None):
        if not is_platform_admin(request.user):
            return deny("Le decaissement des retraits est reserve a l'administrateur.")
        withdrawal = Withdrawal.objects.select_for_update().get(pk=self.get_object().pk)
        approve = request.data.get("approve", True)
        reason = request.data.get("reason", "")
        if not approve and not reason:
            return Response({"reason": "Le motif est obligatoire."}, status=400)
        if approve and lender_total_available(withdrawal.lender) < withdrawal.amount:
            return Response({"detail": "Le capital libre est insuffisant."}, status=400)
        withdrawal.status = Withdrawal.Status.PAID if approve else Withdrawal.Status.REJECTED
        withdrawal.reviewed_by = request.user
        withdrawal.decision_reason = reason
        withdrawal.save()
        audit(request.user, "withdrawal.decided", withdrawal, new={"status": withdrawal.status})
        notify(
            withdrawal.lender,
            "Retrait traite",
            f"Votre retrait de {withdrawal.amount} {withdrawal.currency} est {withdrawal.get_status_display().lower()}.",
            "withdrawal",
            {"withdrawal": str(withdrawal.id)},
        )
        return Response(self.get_serializer(withdrawal).data)


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return self.request.user.notifications.all().order_by("-created_at")

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        notification.read_at = timezone.now()
        notification.save(update_fields=["read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=204)


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        return AuditLog.objects.filter(Q(actor=self.request.user) | Q(club__in=accessible_clubs(self.request.user))).distinct()


class ClubMessageViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = ClubMessage.objects.all()
    serializer_class = ClubMessageSerializer

    def get_queryset(self):
        queryset = ClubMessage.objects.filter(club__in=communication_clubs(self.request.user)).select_related("club", "sender", "recipient")
        club_id = self.request.query_params.get("club")
        if club_id:
            queryset = queryset.filter(club_id=club_id)
        return queryset.filter(Q(kind__in=[ClubMessage.Kind.TEXT, ClubMessage.Kind.ANNOUNCEMENT]) | Q(sender=self.request.user) | Q(recipient=self.request.user)).order_by("-created_at")

    def perform_create(self, serializer):
        club = serializer.validated_data["club"]
        kind = serializer.validated_data.get("kind", ClubMessage.Kind.TEXT)
        is_member = Membership.objects.filter(club=club, user=self.request.user, status=Membership.Status.ACTIVE).exists()
        if not is_member and not can_manage_club(self.request.user, club):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Vous devez etre membre actif de ce club.")
        if kind == ClubMessage.Kind.ANNOUNCEMENT and not can_manage_club(self.request.user, club):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Seul un responsable peut publier une annonce.")
        recipient = serializer.validated_data.get("recipient")
        if recipient and not Membership.objects.filter(club=club, user=recipient, status=Membership.Status.ACTIVE).exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Le destinataire n'est pas membre actif du club.")
        message = serializer.save(sender=self.request.user)
        message.read_by.add(self.request.user)
        audit(self.request.user, "message.sent", message, new={"kind": message.kind})

    @action(detail=False, methods=["get"])
    def conversations(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({"detail": "Vue reservee a l'administrateur."}, status=403)
        results = []
        for club in accessible_clubs(request.user).order_by("name"):
            last = club.messages.select_related("sender").order_by("-created_at").first()
            results.append({
                "club": str(club.id), "club_name": club.name, "member_count": club.memberships.filter(status=Membership.Status.ACTIVE).count(),
                "last_message": ClubMessageSerializer(last).data if last else None,
                "unread": club.messages.exclude(read_by=request.user).count(),
            })
        return Response({"results": results})

    @action(detail=False, methods=["post"], url_path="mark-read")
    def mark_read(self, request):
        ids = request.data.get("ids", [])
        messages = self.get_queryset().filter(id__in=ids).exclude(sender=request.user).exclude(read_by=request.user)
        for message in messages:
            message.read_by.add(request.user)
        return Response({"read": messages.count()})


class DisputeViewSet(viewsets.ModelViewSet):
    queryset = Dispute.objects.all()
    serializer_class = DisputeSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Dispute.objects.filter(club__in=accessible_clubs(self.request.user)).select_related("club", "opened_by", "assigned_to")
        if self.request.user.role != User.Role.ADMIN and self.request.user.current_profile not in [User.Role.LEADER, User.Role.MEDIATOR]:
            queryset = queryset.filter(opened_by=self.request.user)
        return queryset.order_by("-created_at")

    def perform_create(self, serializer):
        club = serializer.validated_data["club"]
        if club not in accessible_clubs(self.request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Club inaccessible.")
        dispute = serializer.save(opened_by=self.request.user)
        audit(self.request.user, "dispute.opened", dispute, new={"subject": dispute.subject})
        if club.leader:
            notify(club.leader, "Nouvelle reclamation", dispute.subject, "dispute", {"id": str(dispute.id)})

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        dispute = self.get_object()
        if not can_manage_club(request.user, dispute.club) and request.user != dispute.assigned_to:
            return Response({"detail": "Permission refusee."}, status=403)
        decision = request.data.get("decision", "").strip()
        if not decision:
            return Response({"decision": "La decision motivee est obligatoire."}, status=400)
        dispute.status = request.data.get("status", Dispute.Status.RESOLVED)
        dispute.decision = decision
        dispute.frozen = bool(request.data.get("frozen", False))
        dispute.closed_at = timezone.now() if dispute.status in [Dispute.Status.RESOLVED, Dispute.Status.REJECTED, Dispute.Status.CLOSED] else None
        dispute.save()
        audit(request.user, "dispute.resolved", dispute, new={"status": dispute.status, "decision": decision})
        notify(dispute.opened_by, "Reclamation traitee", decision, "dispute", {"id": str(dispute.id)})
        return Response(self.get_serializer(dispute).data)
