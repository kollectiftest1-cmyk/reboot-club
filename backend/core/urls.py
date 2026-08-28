from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import (
    AuditLogViewSet, ClubMessageViewSet, ClubRateTierViewSet, ClubViewSet, DepositViewSet, DisputeViewSet, EconomicActivityViewSet,
    InvitationViewSet, KYCApplicationViewSet, LoanBorrowerViewSet, LoanPurposeViewSet, LoanViewSet,
    MembershipViewSet, NotificationViewSet, UserViewSet, WithdrawalViewSet,
    activity_counts, balance_summary, dashboard, health, loan_catalog, me, platform_configuration, register,
    report_export_csv, report_summary, request_otp, switch_profile, verify_otp,
)

router = DefaultRouter()
router.register("clubs", ClubViewSet, basename="club")
router.register("club-rate-tiers", ClubRateTierViewSet, basename="club-rate-tier")
router.register("memberships", MembershipViewSet, basename="membership")
router.register("deposits", DepositViewSet, basename="deposit")
router.register("loans", LoanViewSet, basename="loan")
router.register("withdrawals", WithdrawalViewSet, basename="withdrawal")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("audit-logs", AuditLogViewSet, basename="audit-log")
router.register("messages", ClubMessageViewSet, basename="message")
router.register("disputes", DisputeViewSet, basename="dispute")
router.register("users", UserViewSet, basename="user")
router.register("invitations", InvitationViewSet, basename="invitation")
router.register("kyc", KYCApplicationViewSet, basename="kyc")
router.register("economic-activities", EconomicActivityViewSet, basename="economic-activity")
router.register("loan-purposes", LoanPurposeViewSet, basename="loan-purpose")
router.register("loan-invitations", LoanBorrowerViewSet, basename="loan-invitation")

urlpatterns = [
    path("health/", health),
    path("auth/register/", register),
    path("auth/otp/request/", request_otp),
    path("auth/otp/verify/", verify_otp),
    path("auth/token/", TokenObtainPairView.as_view(), name="token-obtain"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/me/", me),
    path("auth/switch-profile/", switch_profile),
    path("dashboard/", dashboard),
    path("balance/", balance_summary),
    path("activity-counts/", activity_counts),
    path("configuration/", platform_configuration),
    path("loan-catalog/", loan_catalog),
    path("reports/summary/", report_summary),
    path("reports/export.csv", report_export_csv),
    path("", include(router.urls)),
]
