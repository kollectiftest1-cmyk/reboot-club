from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AuditLog, Club, ClubMessage, Deposit, Dispute, EconomicActivity, Installment, Invitation, KYCApplication, Loan, LoanBorrower, LoanFunding, LoanPurpose, Membership, Notification, OTPChallenge, PlatformSettings, Repayment, User, Withdrawal


@admin.register(User)
class RebootUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("REBOOT CLUB", {"fields": ("phone", "role", "kyc_verified", "anonymous_lender", "lender_profile_status", "accepted_terms_at", "avatar")}),)
    list_display = ("phone", "first_name", "last_name", "email", "role", "kyc_verified", "is_active")
    list_filter = ("role", "kyc_verified", "is_active")
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("phone", "email", "first_name", "last_name", "password1", "password2", "role", "is_staff", "is_superuser")}),)


@admin.register(Club)
class ClubAdmin(admin.ModelAdmin):
    list_display = ("name", "zone", "currency", "leader", "status", "created_at")
    list_filter = ("status", "currency", "zone")
    search_fields = ("name", "leader__username", "leader__email")


@admin.register(Deposit, Loan, Repayment, Withdrawal)
class FinancialAdmin(admin.ModelAdmin):
    list_display = ("reference", "amount", "currency", "status", "created_at")
    list_filter = ("status", "currency")
    search_fields = ("reference",)
    readonly_fields = ("reference", "created_at", "updated_at")


admin.site.register(Membership)
admin.site.register(Installment)
admin.site.register(LoanFunding)
admin.site.register(Notification)
admin.site.register(AuditLog)
admin.site.register(ClubMessage)
admin.site.register(Dispute)
admin.site.register(OTPChallenge)
admin.site.register(Invitation)
admin.site.register(PlatformSettings)
admin.site.register(KYCApplication)
admin.site.register(EconomicActivity)
admin.site.register(LoanPurpose)
admin.site.register(LoanBorrower)
admin.site.site_header = "REBOOT CLUB - Administration"
admin.site.site_title = "REBOOT CLUB"
