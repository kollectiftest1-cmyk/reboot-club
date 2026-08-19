from decimal import Decimal
import base64

from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from core.models import Club, Deposit, EconomicActivity, KYCApplication, Loan, LoanBorrower, LoanFunding, LoanPurpose, Membership, User, Withdrawal, allowed_frequencies, installment_count
from django.utils import timezone
from rest_framework.test import APIClient

from core.services import (
    approve_loan, club_finances, disburse_loan, fund_loan, installment_dates, lender_available,
    lender_total_available, loan_cost_breakdown, record_repayment, review_funding, validate_deposit,
)
from core.views import financial_balance


def make_loan(club, borrower, **kwargs):
    defaults = dict(
        purpose="Commerce", estimated_income=Decimal("200000"), currency="CDF",
        duration_code="3m", repayment_frequency="monthly", installment_total=3,
        interest_rate=club.interest_rate, fee_rate=club.platform_fee_rate,
        leader_commission_rate=club.leader_commission_rate,
    )
    defaults.update(kwargs)
    loan = Loan.objects.create(club=club, borrower=borrower, **defaults)
    LoanBorrower.objects.create(loan=loan, user=borrower, is_primary=True, share_amount=loan.amount, status=LoanBorrower.Status.ACCEPTED, responded_at=timezone.now())
    return loan


class CostModelTests(TestCase):
    """Le cout du credit est un pourcentage FIXE du capital, jamais mensualise."""

    def test_three_components_are_flat_percentages_of_principal(self):
        costs = loan_cost_breakdown(Decimal("100000"), Decimal("20"), Decimal("10"), Decimal("5"))
        self.assertEqual(costs["interest"], Decimal("20000.00"))
        self.assertEqual(costs["fee"], Decimal("10000.00"))
        self.assertEqual(costs["leader_commission"], Decimal("5000.00"))
        self.assertEqual(costs["charge"], Decimal("35000.00"))
        self.assertEqual(costs["total_due"], Decimal("135000.00"))

    def test_duration_does_not_change_the_cost(self):
        short = loan_cost_breakdown(Decimal("100000"), Decimal("20"), Decimal("10"), Decimal("5"))
        self.assertEqual(short["total_due"], Decimal("135000.00"))


class DurationFrequencyTests(TestCase):
    """Coherence entre la duree du pret et la frequence de remboursement."""

    def test_one_week_only_accepts_daily(self):
        self.assertEqual(allowed_frequencies("1w"), ["daily"])

    def test_two_weeks_accepts_daily_and_weekly(self):
        self.assertEqual(allowed_frequencies("2w"), ["daily", "weekly"])

    def test_one_month_accepts_daily_and_weekly_only(self):
        self.assertEqual(allowed_frequencies("1m"), ["daily", "weekly"])

    def test_six_months_accepts_quarterly_but_not_four_monthly(self):
        frequencies = allowed_frequencies("6m")
        self.assertIn("quarterly", frequencies)
        self.assertNotIn("four_monthly", frequencies)
        self.assertNotIn("biannual", frequencies)

    def test_one_year_accepts_every_shorter_period(self):
        frequencies = allowed_frequencies("12m")
        self.assertEqual(set(frequencies), {"daily", "weekly", "monthly", "quarterly", "four_monthly", "biannual"})
        self.assertEqual(installment_count("12m", "quarterly"), 4)
        self.assertEqual(installment_count("12m", "monthly"), 12)

    def test_incoherent_combination_is_rejected(self):
        self.assertEqual(installment_count("1w", "monthly"), 0)
        self.assertEqual(installment_count("5m", "quarterly"), 0)

    def test_schedule_ends_exactly_on_the_loan_end_date(self):
        from datetime import date
        dates = installment_dates(date(2026, 1, 15), "3m", "monthly")
        self.assertEqual(len(dates), 3)
        self.assertEqual(dates[-1], date(2026, 4, 15))
        weekly = installment_dates(date(2026, 1, 15), "1m", "weekly")
        self.assertEqual(len(weekly), 4)
        self.assertEqual(weekly[-1], date(2026, 2, 15))


class FinanceWorkflowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("+243810000011", email="admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.leader = User.objects.create_user("+243810000012", email="leader@test.cd", password="Password123!", role=User.Role.LEADER)
        self.lender = User.objects.create_user("+243810000013", email="lender@test.cd", password="Password123!", role=User.Role.LENDER, kyc_verified=True)
        self.borrower = User.objects.create_user("+243810000014", email="borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.club = Club.objects.create(
            name="Test Club", zone="Kinshasa", leader=self.leader, status=Club.Status.ACTIVE,
            interest_rate=Decimal("20.00"), platform_fee_rate=Decimal("10.00"), leader_commission_rate=Decimal("5.00"),
        )
        Membership.objects.create(club=self.club, user=self.borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)

    def _fund_and_validate(self, loan, amount):
        funding = fund_loan(loan, self.lender, amount)
        return review_funding(funding, self.admin, approve=True)

    def test_complete_finance_workflow(self):
        deposit = Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        self.assertEqual(lender_total_available(self.lender), Decimal("500000.00"))

        loan = make_loan(self.club, self.borrower, amount=Decimal("300000"))
        approve_loan(loan, self.admin)
        loan.refresh_from_db()
        self.assertEqual(loan.interest_total, Decimal("60000.00"))
        self.assertEqual(loan.fee_total, Decimal("30000.00"))
        self.assertEqual(loan.leader_commission_total, Decimal("15000.00"))
        self.assertEqual(loan.charge_total, Decimal("105000.00"))
        self.assertEqual(loan.total_due, Decimal("405000.00"))

        # Un placement seul ne finance rien tant que l'admin ne l'a pas valide.
        funding = fund_loan(loan, self.lender, Decimal("300000"))
        loan.refresh_from_db()
        self.assertEqual(funding.pending_amount, Decimal("300000.00"))
        self.assertEqual(loan.funded_amount, Decimal("0"))
        self.assertIsNone(loan.funding_completed_at)
        self.assertEqual(lender_total_available(self.lender), Decimal("200000.00"))

        review_funding(funding, self.admin, approve=True)
        loan.refresh_from_db()
        self.assertEqual(loan.funding_remaining, Decimal("0"))
        self.assertIsNotNone(loan.funding_completed_at)
        self.assertEqual(lender_total_available(self.lender), Decimal("200000.00"))

        loan = disburse_loan(loan, self.admin)
        self.assertEqual(loan.installments.count(), 3)
        first = loan.installments.first()
        self.assertEqual(first.principal_due, Decimal("100000.00"))
        self.assertEqual(first.interest_due, Decimal("20000.00"))
        self.assertEqual(first.fee_due, Decimal("10000.00"))
        self.assertEqual(first.leader_commission_due, Decimal("5000.00"))
        self.assertEqual(first.total_due, Decimal("135000.00"))

        record_repayment(loan, self.admin, Decimal("135000"))
        loan.refresh_from_db()
        first.refresh_from_db()
        self.assertEqual(first.status, "paid")
        funding = loan.fundings.get(lender=self.lender)
        self.assertEqual(funding.expected_gain, Decimal("60000.00"))
        self.assertEqual(funding.principal_repaid, Decimal("100000.00"))
        self.assertEqual(funding.interest_earned, Decimal("20000.00"))
        self.assertEqual(lender_total_available(self.lender), Decimal("320000.00"))

        balance = financial_balance(self.admin)
        self.assertEqual(balance["interest_collected"], "20000.00")
        self.assertEqual(balance["commissions_collected"], "10000.00")
        self.assertEqual(balance["leader_commission_collected"], "5000.00")
        self.assertEqual(balance["net_available"], "335000.00")

    def test_only_admin_can_collect_and_disburse(self):
        deposit = Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        loan = make_loan(self.club, self.borrower, amount=Decimal("300000"))
        approve_loan(loan, self.admin)
        self._fund_and_validate(loan, Decimal("300000"))
        loan.refresh_from_db()
        with self.assertRaises(Exception):
            disburse_loan(loan, self.leader)
        loan = disburse_loan(loan, self.admin)
        with self.assertRaises(Exception):
            record_repayment(loan, self.leader, Decimal("1000"))
        with self.assertRaises(Exception):
            record_repayment(loan, self.borrower, Decimal("1000"))

    def test_collection_agent_can_collect_only_its_own_loan(self):
        agent = User.objects.create_user("+243810000040", email="agent@test.cd", password="Password123!", role=User.Role.COLLECTOR, kyc_verified=True)
        deposit = Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        loan = make_loan(self.club, self.borrower, amount=Decimal("300000"))
        approve_loan(loan, self.admin)
        self._fund_and_validate(loan, Decimal("300000"))
        loan.refresh_from_db()
        loan = disburse_loan(loan, self.admin)
        client = APIClient()
        client.force_authenticate(user=agent)
        blocked = client.post(f"/api/v1/loans/{loan.id}/record-payment/", {"amount": "10000"}, format="json")
        self.assertIn(blocked.status_code, [403, 404])
        client.force_authenticate(user=self.admin)
        assigned = client.post(f"/api/v1/loans/{loan.id}/assign-agent/", {"agent": str(agent.id)}, format="json")
        self.assertEqual(assigned.status_code, 200)
        client.force_authenticate(user=agent)
        allowed = client.post(f"/api/v1/loans/{loan.id}/record-payment/", {"amount": "10000"}, format="json")
        self.assertEqual(allowed.status_code, 201)

    def test_rejected_placement_frees_the_lender_capital(self):
        deposit = Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin)
        loan = make_loan(self.club, self.borrower, amount=Decimal("300000"))
        approve_loan(loan, self.admin)
        funding = fund_loan(loan, self.lender, Decimal("300000"))
        self.assertEqual(lender_total_available(self.lender), Decimal("200000.00"))
        review_funding(funding, self.admin, approve=False, reason="Dossier incomplet")
        self.assertEqual(lender_total_available(self.lender), Decimal("500000.00"))
        loan.refresh_from_db()
        self.assertEqual(loan.funded_amount, Decimal("0"))

    def test_rejected_deposit_does_not_increase_capital(self):
        deposit = Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF")
        validate_deposit(deposit, self.admin, approve=False, reason="Preuve invalide")
        self.assertEqual(lender_total_available(self.lender), Decimal("0.00"))

    def test_lender_capital_is_global_and_not_tied_to_a_club(self):
        second_leader = User.objects.create_user("+243810000015", email="leader2@test.cd", password="Password123!", role=User.Role.LEADER)
        Club.objects.create(name="Second Club", zone="Gombe", leader=second_leader, status=Club.Status.ACTIVE)
        for amount in [Decimal("100000"), Decimal("200000")]:
            validate_deposit(Deposit.objects.create(lender=self.lender, amount=amount, currency="CDF"), self.admin)
        loan = make_loan(self.club, self.borrower, amount=Decimal("250000"))
        approve_loan(loan, self.admin)
        self._fund_and_validate(loan, Decimal("250000"))
        self.assertEqual(lender_total_available(self.lender), Decimal("50000.00"))
        self.assertEqual(lender_available(self.club, self.lender), Decimal("50000.00"))
        withdrawal = Withdrawal.objects.create(lender=self.lender, amount=Decimal("40000"), currency="CDF")
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.post(f"/api/v1/withdrawals/{withdrawal.id}/decide/", {"approve": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(lender_total_available(self.lender), Decimal("10000.00"))

    def test_pending_withdrawal_is_visible_without_reducing_available_funds(self):
        validate_deposit(Deposit.objects.create(lender=self.lender, amount=Decimal("100000"), currency="CDF"), self.admin)
        withdrawal = Withdrawal.objects.create(lender=self.lender, amount=Decimal("25000"), currency="CDF")
        balance = financial_balance(self.lender)
        self.assertEqual(balance["net_available"], "100000.00")
        event = next(item for item in balance["activity"] if item["id"] == str(withdrawal.id))
        self.assertEqual(event["title"], "Retrait soumis")
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
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.post(f"/api/v1/memberships/{membership.id}/decide/", {"approve": True}, format="json").status_code, 400)
        client.force_authenticate(user=self.leader)
        self.assertEqual(client.post(f"/api/v1/memberships/{membership.id}/leader-decide/", {"approve": True}, format="json").status_code, 200)
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.post(f"/api/v1/memberships/{membership.id}/decide/", {"approve": True}, format="json").status_code, 200)
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
        self.assertEqual(client.post(f"/api/v1/memberships/{membership.id}/leader-decide/", {"approve": True}, format="json").status_code, 200)
        client.force_authenticate(user=candidate)
        self.assertEqual(client.post(f"/api/v1/memberships/{membership.id}/accept/", {"accept": True}, format="json").status_code, 200)
        membership.refresh_from_db()
        self.assertIsNotNone(membership.leader_approved_at)
        self.assertIsNotNone(membership.member_approved_at)

    def test_kyc_blocks_deposit_and_admin_rating_is_limited(self):
        unverified = User.objects.create_user(
            "+243810000017", email="unverified@test.cd", password="Password123!", role=User.Role.LENDER,
        )
        client = APIClient()
        client.force_authenticate(user=unverified)
        blocked = client.post("/api/v1/deposits/", {"lender": unverified.id, "amount": "10000", "payment_method": "cash"}, format="json")
        self.assertEqual(blocked.status_code, 400)
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.post(f"/api/v1/users/{self.borrower.id}/rate-borrower/", {"rating": 11}, format="json").status_code, 400)
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
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.post(f"/api/v1/kyc/{response.data['id']}/review/", {"approve": True}, format="json").status_code, 200)
        applicant.refresh_from_db()
        self.assertTrue(applicant.kyc_verified)
        self.assertEqual(client.post(f"/api/v1/economic-activities/{proposal.id}/review/", {"approve": True}, format="json").status_code, 200)

    def test_admin_can_list_and_file_kyc_for_accounts_without_a_file(self):
        applicant = User.objects.create_user(
            "+243810000041", email="nokyc@test.cd", password="Password123!", role=User.Role.BORROWER,
        )
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        client = APIClient()
        client.force_authenticate(user=self.admin)
        missing = client.get("/api/v1/kyc/missing/?search=nokyc")
        self.assertEqual(missing.status_code, 200)
        self.assertIn(str(applicant.id), {str(item["id"]) for item in missing.data["results"]})
        created = client.post("/api/v1/kyc/submit-for/", {
            "user": applicant.id, "activity": "Vente de tissus", "occupation": "trader",
            "monthly_income": "150000", "address": "Kinshasa", "document_type": "voter_card",
            "document_number": "EL-000041",
            "identity_document": SimpleUploadedFile("carte.png", png, content_type="image/png"),
            "selfie": SimpleUploadedFile("selfie.png", png, content_type="image/png"),
        }, format="multipart")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(KYCApplication.objects.get(user=applicant).status, KYCApplication.Status.SUBMITTED)

    def test_borrower_can_request_global_lender_profile_without_leader(self):
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        self.assertEqual(client.post("/api/v1/users/request-lender-profile/", {}, format="json").status_code, 201)
        self.assertFalse(Membership.objects.filter(user=self.borrower, role=Membership.Role.LENDER).exists())
        me = client.get("/api/v1/auth/me/")
        self.assertFalse(me.data["profile_requests"][0]["requires_leader"])
        client.force_authenticate(user=self.leader)
        self.assertEqual(client.post(f"/api/v1/users/{self.borrower.id}/decide-lender-profile/", {"approve": True}, format="json").status_code, 403)
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.post(f"/api/v1/users/{self.borrower.id}/decide-lender-profile/", {"approve": True}, format="json").status_code, 200)
        self.borrower.refresh_from_db()
        client.force_authenticate(user=self.borrower)
        switched = client.post("/api/v1/auth/switch-profile/", {"profile": User.Role.LENDER}, format="json")
        self.assertEqual(switched.data["current_profile"], User.Role.LENDER)

        other_leader = User.objects.create_user("+243810000030", email="other-leader@test.cd", password="Password123!", role=User.Role.LEADER)
        other_borrower = User.objects.create_user("+243810000031", email="other-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        other_club = Club.objects.create(name="Autre Club", zone="Matete", leader=other_leader, status=Club.Status.ACTIVE)
        Membership.objects.create(club=other_club, user=other_borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        other_loan = make_loan(other_club, other_borrower, amount=Decimal("20000"), duration_code="2m", installment_total=2)
        approve_loan(other_loan, self.admin)
        offers = client.get("/api/v1/loans/")
        self.assertIn(str(other_loan.id), {str(item["id"]) for item in offers.data["results"]})

    def test_approved_kyc_application_remains_authoritative_for_loan(self):
        self.borrower.kyc_verified = False
        self.borrower.save(update_fields=["kyc_verified"])
        KYCApplication.objects.create(
            user=self.borrower, activity="Commerce", occupation="trader",
            monthly_income="250000", address="Kinshasa", document_type="voter_card",
            document_number="AUTH-KYC-001", identity_document="kyc/documents/carte.png",
            selfie="kyc/selfies/selfie.png", status=KYCApplication.Status.APPROVED,
        )
        purpose = LoanPurpose.objects.create(name="Achat de stock")
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        self.assertTrue(client.get("/api/v1/auth/me/").data["kyc_verified"])
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "10000", "duration_code": "2m",
            "repayment_frequency": "monthly", "purpose_id": str(purpose.id),
            "estimated_income": "50000", "guarantors": "",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["purpose"], "Achat de stock")
        self.assertEqual(Loan.objects.get(pk=created.data["id"]).status, Loan.Status.SUBMITTED)

    def test_incoherent_frequency_is_refused_on_submission(self):
        purpose = LoanPurpose.objects.create(name="Materiel")
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        response = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "10000", "duration_code": "1w",
            "repayment_frequency": "monthly", "purpose_id": str(purpose.id), "estimated_income": "50000",
        }, format="json")
        self.assertEqual(response.status_code, 400)


class CollectiveLoanTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("+243810000051", email="a51@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.leader = User.objects.create_user("+243810000052", email="l52@test.cd", password="Password123!", role=User.Role.LEADER)
        self.club = Club.objects.create(
            name="Club collectif", zone="Kinshasa", leader=self.leader, status=Club.Status.ACTIVE,
            interest_rate=Decimal("20.00"), platform_fee_rate=Decimal("10.00"), leader_commission_rate=Decimal("5.00"),
        )
        self.a = User.objects.create_user("+243810000053", email="b53@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.b = User.objects.create_user("+243810000054", email="b54@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.c = User.objects.create_user("+243810000055", email="b55@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        for user in [self.a, self.b, self.c]:
            Membership.objects.create(club=self.club, user=user, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        self.purpose = LoanPurpose.objects.create(name="Fonds de roulement")

    def test_shares_default_to_equal_split_and_lenders_wait_for_every_answer(self):
        client = APIClient()
        client.force_authenticate(user=self.a)
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "300000", "duration_code": "3m",
            "repayment_frequency": "monthly", "purpose_id": str(self.purpose.id),
            "estimated_income": "200000", "partners": [str(self.b.id), str(self.c.id)],
        }, format="json")
        self.assertEqual(created.status_code, 201)
        loan = Loan.objects.get(pk=created.data["id"])
        self.assertTrue(loan.is_collective)
        self.assertEqual(loan.status, Loan.Status.PENDING_PARTNERS)
        self.assertEqual([row.share_amount for row in loan.borrowers.order_by("created_at")], [Decimal("100000.00")] * 3)

        # Tant que tout le monde n'a pas accepte, le pret n'est pas soumis.
        client.force_authenticate(user=self.b)
        pending = client.get("/api/v1/loan-invitations/pending/")
        self.assertEqual(len(pending.data["results"]), 1)
        self.assertEqual(client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": True, "share_amount": "150000"}, format="json").status_code, 200)
        loan.refresh_from_db()
        self.assertEqual(loan.status, Loan.Status.PENDING_PARTNERS)

        client.force_authenticate(user=self.c)
        self.assertEqual(client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": True}, format="json").status_code, 200)
        loan.refresh_from_db()
        self.assertEqual(loan.status, Loan.Status.SUBMITTED)
        shares = {str(row.user_id): row.share_amount for row in loan.borrowers.all()}
        self.assertEqual(shares[str(self.b.id)], Decimal("150000.00"))
        self.assertEqual(sum(shares.values()), Decimal("300000.00"))

    def test_a_manual_share_shrinks_the_default_shares(self):
        """Une part saisie fige le montant ; les parts par defaut absorbent le reliquat."""
        client = APIClient()
        client.force_authenticate(user=self.a)
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "300000", "duration_code": "6m",
            "repayment_frequency": "quarterly", "purpose_id": str(self.purpose.id),
            "estimated_income": "200000", "partners": [self.b.id, self.c.id],
        }, format="json")
        loan = Loan.objects.get(pk=created.data["id"])
        client.force_authenticate(user=self.b)
        self.assertEqual(client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": True, "share_amount": "200000"}, format="json").status_code, 200)
        client.force_authenticate(user=self.c)
        self.assertEqual(client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": True}, format="json").status_code, 200)
        loan.refresh_from_db()
        shares = {str(row.user_id): row.share_amount for row in loan.borrowers.all()}
        self.assertEqual(shares[str(self.b.id)], Decimal("200000.00"))
        self.assertEqual(sum(shares.values()), Decimal("300000.00"))
        # L'initiateur et le dernier co-emprunteur se partagent le reliquat.
        self.assertEqual(shares[str(self.a.id)], Decimal("50000.00"))
        self.assertEqual(shares[str(self.c.id)], Decimal("50000.00"))
        self.assertEqual(loan.status, Loan.Status.SUBMITTED)

    def test_a_share_larger_than_the_loan_is_refused(self):
        client = APIClient()
        client.force_authenticate(user=self.a)
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "200000", "duration_code": "2m",
            "repayment_frequency": "monthly", "purpose_id": str(self.purpose.id),
            "estimated_income": "200000", "partners": [self.b.id],
        }, format="json")
        loan = Loan.objects.get(pk=created.data["id"])
        client.force_authenticate(user=self.b)
        response = client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": True, "share_amount": "250000"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_a_refusal_cancels_the_collective_loan(self):
        client = APIClient()
        client.force_authenticate(user=self.a)
        created = client.post("/api/v1/loans/", {
            "club": str(self.club.id), "amount": "200000", "duration_code": "2m",
            "repayment_frequency": "monthly", "purpose_id": str(self.purpose.id),
            "estimated_income": "200000", "partners": [str(self.b.id)],
        }, format="json")
        loan = Loan.objects.get(pk=created.data["id"])
        client.force_authenticate(user=self.b)
        self.assertEqual(client.post(f"/api/v1/loans/{loan.id}/respond/", {"accept": False, "reason": "Pas disponible"}, format="json").status_code, 200)
        loan.refresh_from_db()
        self.assertEqual(loan.status, Loan.Status.CANCELLED)


class VisibilityTests(TestCase):
    """Chacun ne voit que ce que son role autorise."""

    def setUp(self):
        self.admin = User.objects.create_user("+243810000061", email="a61@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.leader = User.objects.create_user("+243810000062", email="l62@test.cd", password="Password123!", role=User.Role.LEADER)
        self.lender = User.objects.create_user("+243810000063", email="p63@test.cd", password="Password123!", role=User.Role.LENDER, kyc_verified=True)
        self.borrower = User.objects.create_user("+243810000064", email="e64@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.club = Club.objects.create(
            name="Club visible", zone="Kinshasa", leader=self.leader, status=Club.Status.ACTIVE,
            interest_rate=Decimal("20.00"), platform_fee_rate=Decimal("10.00"), leader_commission_rate=Decimal("5.00"),
        )
        Membership.objects.create(club=self.club, user=self.borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        validate_deposit(Deposit.objects.create(lender=self.lender, amount=Decimal("500000"), currency="CDF"), self.admin)
        self.loan = make_loan(self.club, self.borrower, amount=Decimal("300000"))
        approve_loan(self.loan, self.admin)
        review_funding(fund_loan(self.loan, self.lender, Decimal("300000")), self.admin, approve=True)
        self.loan.refresh_from_db()
        self.loan = disburse_loan(self.loan, self.admin)

    def test_borrower_sees_a_single_global_charge(self):
        client = APIClient()
        client.force_authenticate(user=self.borrower)
        data = client.get(f"/api/v1/loans/{self.loan.id}/").data
        self.assertEqual(data["charge_total"], "105000.00")
        self.assertEqual(data["charge_rate"], "35.00")
        self.assertIsNone(data["interest_total"])
        self.assertIsNone(data["fee_total"])
        self.assertIsNone(data["leader_commission_total"])
        self.assertEqual(data["fundings"], [])
        self.assertIsNone(data["funded_amount"])

    def test_lender_sees_only_its_own_interest(self):
        client = APIClient()
        self.lender.active_profile = User.Role.LENDER
        self.lender.save(update_fields=["active_profile"])
        client.force_authenticate(user=self.lender)
        data = client.get(f"/api/v1/loans/{self.loan.id}/").data
        self.assertEqual(data["borrower_name"], "Membre du club")
        self.assertIsNone(data["fee_total"])
        self.assertIsNone(data["leader_commission_total"])
        self.assertEqual(Decimal(data["my_funding"]["interest_earned"]), Decimal("0.00"))
        self.assertEqual(Decimal(data["my_funding"]["expected_gain"]), Decimal("60000.00"))
        self.assertEqual(len(data["fundings"]), 1)

    def test_leader_sees_only_its_own_commission_and_own_club(self):
        client = APIClient()
        self.leader.active_profile = User.Role.LEADER
        self.leader.save(update_fields=["active_profile"])
        client.force_authenticate(user=self.leader)
        data = client.get(f"/api/v1/loans/{self.loan.id}/").data
        self.assertEqual(data["leader_commission_total"], "15000.00")
        self.assertIsNone(data["interest_total"])
        self.assertIsNone(data["fee_total"])
        self.assertEqual(data["fundings"], [])

        other_leader = User.objects.create_user("+243810000065", email="l65@test.cd", password="Password123!", role=User.Role.LEADER)
        other_club = Club.objects.create(name="Club voisin", zone="Limete", leader=other_leader, status=Club.Status.ACTIVE)
        other_borrower = User.objects.create_user("+243810000066", email="e66@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        Membership.objects.create(club=other_club, user=other_borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        other_loan = make_loan(other_club, other_borrower, amount=Decimal("50000"))
        listed = client.get("/api/v1/loans/")
        self.assertNotIn(str(other_loan.id), {str(item["id"]) for item in listed.data["results"]})
        self.assertNotIn(str(other_club.id), {str(item["id"]) for item in client.get("/api/v1/clubs/").data["results"]})

    def test_anonymous_lender_name_is_hidden_in_placement_queue(self):
        self.lender.anonymous_lender = True
        self.lender.save(update_fields=["anonymous_lender"])
        self.assertEqual(self.lender.public_name, "Preteur anonyme")
        other = make_loan(self.club, self.borrower, amount=Decimal("50000"))
        approve_loan(other, self.admin)
        fund_loan(other, self.lender, Decimal("50000"))
        client = APIClient()
        client.force_authenticate(user=self.admin)
        data = client.get("/api/v1/loans/pending-placements/").data
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["lender_name"], "Preteur anonyme")
