from decimal import Decimal
import base64

from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from core.models import Club, Deposit, EconomicActivity, KYCApplication, Loan, Membership, User, Withdrawal
from django.utils import timezone
from rest_framework.test import APIClient

from core.services import approve_loan, club_finances, disburse_loan, fund_loan, lender_available, lender_total_available, record_repayment, validate_deposit
from core.views import financial_balance


class FinanceWorkflowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("+243810000011", email="admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.leader = User.objects.create_user("+243810000012", email="leader@test.cd", password="Password123!", role=User.Role.LEADER)
        self.lender = User.objects.create_user("+243810000013", email="lender@test.cd", password="Password123!", role=User.Role.LENDER, kyc_verified=True)
        self.borrower = User.objects.create_user("+243810000014", email="borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.club = Club.objects.create(name="Test Club", zone="Kinshasa", leader=self.leader, status=Club.Status.ACTIVE, interest_rate=Decimal("2.00"), platform_fee_rate=Decimal("1.00"))
        Membership.objects.create(club=self.club, user=self.lender, role=Membership.Role.LENDER, status=Membership.Status.ACTIVE)
        Membership.objects.create(club=self.club, user=self.borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)

    def test_complete_finance_workflow(self):
        deposit = Deposit.objects.create(club=self.club, lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        self.assertEqual(club_finances(self.club)["available"], Decimal("500000.00"))

        loan = Loan.objects.create(
            club=self.club, borrower=self.borrower, purpose="Commerce", estimated_income=Decimal("200000"),
            amount=Decimal("300000"), currency="CDF", duration_months=3,
            interest_rate=self.club.interest_rate, fee_rate=self.club.platform_fee_rate,
        )
        approve_loan(loan, self.admin)
        fund_loan(loan, self.lender, Decimal("300000"))
        loan.refresh_from_db()
        self.assertEqual(loan.funding_remaining, Decimal("0"))
        self.assertEqual(lender_available(self.club, self.lender), Decimal("200000.00"))
        self.assertEqual(lender_total_available(self.lender), Decimal("200000.00"))
        self.assertEqual(financial_balance(self.admin)["net_available"], "500000.00")
        self.assertEqual(financial_balance(self.admin)["free_after_commitments"], "200000.00")
        self.assertIsNotNone(loan.funding_completed_at)
        self.assertIsNotNone(loan.scheduled_disbursement_date)
        loan = disburse_loan(loan, self.admin)
        self.assertEqual(loan.scheduled_disbursement_date, timezone.localdate())
        self.assertLess(abs((timezone.now() - loan.disbursed_at).total_seconds()), 5)
        self.assertEqual(loan.installments.count(), 3)
        self.assertEqual(loan.total_due, Decimal("321000.00"))
        self.assertEqual(club_finances(self.club)["engaged"], Decimal("300000.00"))

        record_repayment(loan, self.admin, Decimal("40000"), "mobile_money")
        loan.refresh_from_db()
        self.assertEqual(loan.installments.first().status, "partial")
        self.assertEqual(loan.installments.first().paid_amount, Decimal("40000.00"))
        record_repayment(loan, self.admin, Decimal("67000"), "mobile_money")
        loan.refresh_from_db()
        funding = loan.fundings.get(lender=self.lender)
        self.assertEqual(loan.total_paid, Decimal("107000.00"))
        self.assertEqual(loan.installments.first().status, "paid")
        self.assertEqual(club_finances(self.club)["engaged"], Decimal("200000.00"))
        self.assertEqual(club_finances(self.club)["available"], Decimal("300000.00"))
        self.assertEqual(funding.expected_gain, Decimal("18000.00"))
        self.assertEqual(funding.interest_earned, Decimal("6000.00"))
        self.assertEqual(lender_available(self.club, self.lender), Decimal("306000.00"))
        self.assertEqual(lender_total_available(self.lender), Decimal("306000.00"))
        self.assertEqual(financial_balance(self.admin)["net_available"], "307000.00")
        self.assertEqual(financial_balance(self.admin)["commissions_collected"], "1000.00")
        self.assertEqual(financial_balance(self.admin)["interest_collected"], "6000.00")
        self.assertEqual(financial_balance(self.admin)["earnings_collected"], "7000.00")
        client = APIClient()
        client.force_authenticate(user=self.lender)
        lender_dashboard = client.get("/api/v1/dashboard/")
        self.assertEqual(lender_dashboard.status_code, 200)
        self.assertEqual(lender_dashboard.data["gain_history"][-1]["amount"], "6000.00")
        client.force_authenticate(user=self.admin)
        admin_dashboard = client.get("/api/v1/dashboard/")
        self.assertEqual(admin_dashboard.data["gain_history"][-1]["amount"], "7000.00")

    def test_only_admin_can_record_repayment(self):
        deposit = Deposit.objects.create(club=self.club, lender=self.lender, amount=Decimal("10000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        loan = Loan.objects.create(
            club=self.club, borrower=self.borrower, purpose="Stock", estimated_income=Decimal("200000"),
            amount=Decimal("10000"), currency="CDF", duration_months=2,
            interest_rate=self.club.interest_rate, fee_rate=self.club.platform_fee_rate,
        )
        approve_loan(loan, self.admin)
        fund_loan(loan, self.lender, Decimal("10000"))
        disburse_loan(loan, self.admin)
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        response = client.post(f"/api/v1/loans/{loan.id}/record-payment/", {"amount": "1000"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_rejected_deposit_does_not_increase_capital(self):
        deposit = Deposit.objects.create(club=self.club, lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin, approve=False, reason="Preuve invalide")
        self.assertEqual(club_finances(self.club)["available"], Decimal("0.00"))

    def test_lender_capital_is_global_across_clubs(self):
        second_leader = User.objects.create_user("+243810000015", email="leader2@test.cd", password="Password123!", role=User.Role.LEADER)
        second_club = Club.objects.create(name="Second Club", zone="Gombe", leader=second_leader, status=Club.Status.ACTIVE)
        Membership.objects.create(club=second_club, user=self.lender, role=Membership.Role.LENDER, status=Membership.Status.ACTIVE)
        first_deposit = Deposit.objects.create(club=self.club, lender=self.lender, amount=Decimal("100000"), currency="CDF")
        second_deposit = Deposit.objects.create(club=second_club, lender=self.lender, amount=Decimal("200000"), currency="CDF")
        validate_deposit(first_deposit, self.admin)
        validate_deposit(second_deposit, self.admin)
        loan = Loan.objects.create(
            club=self.club, borrower=self.borrower, purpose="Stock", estimated_income=Decimal("200000"),
            amount=Decimal("250000"), currency="CDF", duration_months=3,
            interest_rate=self.club.interest_rate, fee_rate=self.club.platform_fee_rate,
        )
        approve_loan(loan, self.admin)
        fund_loan(loan, self.lender, Decimal("250000"))
        self.assertEqual(lender_available(self.club, self.lender), Decimal("0.00"))
        self.assertEqual(lender_total_available(self.lender), Decimal("50000.00"))
        withdrawal = Withdrawal.objects.create(club=self.club, lender=self.lender, amount=Decimal("40000"), currency="CDF")
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.post(f"/api/v1/withdrawals/{withdrawal.id}/decide/", {"approve": True}, format="json")
        self.assertEqual(response.status_code, 200)
        withdrawal.refresh_from_db()
        self.assertEqual(withdrawal.status, Withdrawal.Status.PAID)
        self.assertEqual(lender_total_available(self.lender), Decimal("10000.00"))

    def test_pending_withdrawal_is_visible_without_reducing_available_funds(self):
        deposit = Deposit.objects.create(club=self.club, lender=self.lender, amount=Decimal("100000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        withdrawal = Withdrawal.objects.create(club=self.club, lender=self.lender, amount=Decimal("25000"), currency="CDF")

        balance = financial_balance(self.lender)

        self.assertEqual(balance["net_available"], "100000.00")
        event = next(item for item in balance["activity"] if item["id"] == str(withdrawal.id))
        self.assertEqual(event["title"], "Retrait soumis")
        self.assertEqual(event["status"], Withdrawal.Status.SUBMITTED)
        self.assertEqual(event["direction"], "neutral")

    def test_membership_requires_member_and_leader_before_admin(self):
        candidate = User.objects.create_user(
            "+243810000016", email="candidate@test.cd", password="Password123!",
            role=User.Role.BORROWER, kyc_verified=True,
        )
        client = APIClient()
        client.force_authenticate(user=candidate)
        requested = client.post("/api/v1/memberships/", {"club": str(self.club.id), "user": candidate.id, "role": Membership.Role.BORROWER}, format="json")
        self.assertEqual(requested.status_code, 201)
        membership = Membership.objects.get(pk=requested.data["id"])
        self.assertIsNotNone(membership.member_approved_at)
        self.assertIsNone(membership.leader_approved_at)

        client.force_authenticate(user=self.admin)
        premature = client.post(f"/api/v1/memberships/{membership.id}/decide/", {"approve": True}, format="json")
        self.assertEqual(premature.status_code, 400)
        client.force_authenticate(user=self.leader)
        leader_decision = client.post(f"/api/v1/memberships/{membership.id}/leader-decide/", {"approve": True}, format="json")
        self.assertEqual(leader_decision.status_code, 200)
        client.force_authenticate(user=self.admin)
        final_decision = client.post(f"/api/v1/memberships/{membership.id}/decide/", {"approve": True}, format="json")
        self.assertEqual(final_decision.status_code, 200)
        membership.refresh_from_db()
        self.assertEqual(membership.status, Membership.Status.ACTIVE)

    def test_borrower_membership_may_be_confirmed_in_reverse_order(self):
        candidate = User.objects.create_user(
            "+243810000019", email="reverse@test.cd", password="Password123!",
            role=User.Role.BORROWER, kyc_verified=True,
        )
        membership = Membership.objects.create(
            club=self.club, user=candidate, role=Membership.Role.BORROWER,
            status=Membership.Status.PENDING, invited_by=self.admin,
        )
        client = APIClient()
        client.force_authenticate(user=self.leader)
        leader_first = client.post(f"/api/v1/memberships/{membership.id}/leader-decide/", {"approve": True}, format="json")
        self.assertEqual(leader_first.status_code, 200)
        client.force_authenticate(user=candidate)
        member_second = client.post(f"/api/v1/memberships/{membership.id}/accept/", {"accept": True}, format="json")
        self.assertEqual(member_second.status_code, 200)
        membership.refresh_from_db()
        self.assertIsNotNone(membership.leader_approved_at)
        self.assertIsNotNone(membership.member_approved_at)

    def test_kyc_blocks_deposit_and_admin_rating_is_limited(self):
        unverified = User.objects.create_user(
            "+243810000017", email="unverified@test.cd", password="Password123!",
            role=User.Role.LENDER,
        )
        Membership.objects.create(club=self.club, user=unverified, role=Membership.Role.LENDER, status=Membership.Status.ACTIVE)
        client = APIClient()
        client.force_authenticate(user=unverified)
        blocked = client.post("/api/v1/deposits/", {"club": str(self.club.id), "lender": unverified.id, "amount": "10000", "payment_method": "cash"}, format="json")
        self.assertEqual(blocked.status_code, 400)
        client.force_authenticate(user=self.admin)
        invalid_rating = client.post(f"/api/v1/users/{self.borrower.id}/rate-borrower/", {"rating": 11}, format="json")
        self.assertEqual(invalid_rating.status_code, 400)
        rating = client.post(f"/api/v1/users/{self.borrower.id}/rate-borrower/", {"rating": 8}, format="json")
        self.assertEqual(rating.status_code, 200)
        self.assertEqual(rating.data["admin_borrower_rating"], 8)

    def test_member_can_submit_kyc_for_admin_review(self):
        applicant = User.objects.create_user(
            "+243810000018", email="kyc@test.cd", password="Password123!", role=User.Role.BORROWER,
        )
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        client = APIClient()
        client.force_authenticate(user=applicant)
        response = client.post("/api/v1/kyc/submit/", {
            "activity": "Commerce local personnalise", "occupation": "trader", "employer_or_business": "Boutique",
            "monthly_income": "250000", "address": "Kinshasa, Gombe", "document_type": "voter_card",
            "document_number": "EL-000018",
            "identity_document": SimpleUploadedFile("carte.png", png, content_type="image/png"),
            "selfie": SimpleUploadedFile("selfie.png", png, content_type="image/png"),
        }, format="multipart")
        self.assertEqual(response.status_code, 201)
        proposal = EconomicActivity.objects.get(name="Commerce local personnalise")
        self.assertEqual(proposal.status, EconomicActivity.Status.PENDING)
        self.assertFalse(applicant.kyc_verified)
        client.force_authenticate(user=self.admin)
        reviewed = client.post(f"/api/v1/kyc/{response.data['id']}/review/", {"approve": True}, format="json")
        self.assertEqual(reviewed.status_code, 200)
        applicant.refresh_from_db()
        self.assertTrue(applicant.kyc_verified)
        activity_review = client.post(f"/api/v1/economic-activities/{proposal.id}/review/", {"approve": True}, format="json")
        self.assertEqual(activity_review.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, EconomicActivity.Status.ACTIVE)

    def test_borrower_can_request_global_lender_profile_without_leader(self):
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        requested = client.post("/api/v1/users/request-lender-profile/", {}, format="json")
        self.assertEqual(requested.status_code, 201)
        self.assertFalse(Membership.objects.filter(user=self.borrower, role=Membership.Role.LENDER).exists())
        me = client.get("/api/v1/auth/me/")
        self.assertEqual(me.data["profile_requests"][0]["role"], Membership.Role.LENDER)
        self.assertFalse(me.data["profile_requests"][0]["requires_leader"])

        client.force_authenticate(user=self.leader)
        leader_decision = client.post(f"/api/v1/users/{self.borrower.id}/decide-lender-profile/", {"approve": True}, format="json")
        self.assertEqual(leader_decision.status_code, 403)
        client.force_authenticate(user=self.admin)
        admin_decision = client.post(f"/api/v1/users/{self.borrower.id}/decide-lender-profile/", {"approve": True}, format="json")
        self.assertEqual(admin_decision.status_code, 200)

        self.borrower.refresh_from_db()
        client.force_authenticate(user=self.borrower)
        switched = client.post("/api/v1/auth/switch-profile/", {"profile": User.Role.LENDER}, format="json")
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(switched.data["current_profile"], User.Role.LENDER)

        other_leader = User.objects.create_user("+243810000030", email="other-leader@test.cd", password="Password123!", role=User.Role.LEADER)
        other_borrower = User.objects.create_user("+243810000031", email="other-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        other_club = Club.objects.create(name="Autre Club", zone="Matete", leader=other_leader, status=Club.Status.ACTIVE)
        Membership.objects.create(club=other_club, user=other_borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        other_loan = Loan.objects.create(club=other_club, borrower=other_borrower, purpose="Atelier", estimated_income="90000", amount="20000", currency="CDF", duration_months=2, interest_rate="2", fee_rate="1")
        approve_loan(other_loan, self.admin)
        offers = client.get("/api/v1/loans/")
        self.assertEqual(offers.status_code, 200)
        self.assertIn(str(other_loan.id), {str(item["id"]) for item in offers.data["results"]})

    def test_approved_kyc_application_remains_authoritative_for_loan(self):
        self.borrower.kyc_verified = False
        self.borrower.save(update_fields=["kyc_verified"])
        KYCApplication.objects.create(
            user=self.borrower, activity="Commerce", occupation="Commercant",
            monthly_income="250000", address="Kinshasa", document_type="voter_card",
            document_number="AUTH-KYC-001", identity_document="kyc/documents/carte.png",
            selfie="kyc/selfies/selfie.png", status=KYCApplication.Status.APPROVED,
        )
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        me = client.get("/api/v1/auth/me/")
        self.assertTrue(me.data["kyc_verified"])
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "10000", "duration_months": 2,
            "purpose": "Stock", "estimated_income": "50000", "guarantors": "",
        }, format="json")
        self.assertEqual(created.status_code, 201)
