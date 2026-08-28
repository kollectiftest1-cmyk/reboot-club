from decimal import Decimal
from rest_framework.test import APITestCase
from django.test import override_settings

from core.models import AuditLog, Club, ClubRateTier, Deposit, Invitation, Loan, LoanFunding, Membership, User
from core.services import approve_loan


class PermissionTests(APITestCase):
    def setUp(self):
        self.leader_a = User.objects.create_user("+243810000021", email="a@test.cd", password="Password123!", role=User.Role.LEADER, kyc_verified=True)
        self.leader_b = User.objects.create_user("+243810000022", email="b@test.cd", password="Password123!", role=User.Role.LEADER, kyc_verified=True)
        self.club_a = Club.objects.create(name="Club A", zone="A", leader=self.leader_a, status=Club.Status.ACTIVE)
        self.club_b = Club.objects.create(name="Club B", zone="B", leader=self.leader_b, status=Club.Status.ACTIVE)
        Membership.objects.create(club=self.club_a, user=self.leader_a, role=Membership.Role.LEADER, status=Membership.Status.ACTIVE)

    def test_leader_cannot_see_other_club(self):
        self.client.force_authenticate(self.leader_a)
        response = self.client.get("/api/v1/clubs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "Club A")

    def test_phone_login_and_club_chat(self):
        response = self.client.post("/api/v1/auth/token/", {"phone": "+243810000021", "password": "Password123!"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.leader_a)
        response = self.client.post("/api/v1/messages/", {"club": str(self.club_a.id), "kind": "announcement", "body": "Reunion samedi"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender_name"], self.leader_a.display_name)

    @override_settings(DEBUG=True)
    def test_otp_registration_flow(self):
        request_response = self.client.post("/api/v1/auth/otp/request/", {"phone": "+243810009999", "purpose": "register"}, format="json")
        self.assertEqual(request_response.status_code, 201)
        verify_response = self.client.post("/api/v1/auth/otp/verify/", {"challenge_id": request_response.data["challenge_id"], "code": request_response.data["debug_code"]}, format="json")
        self.assertEqual(verify_response.status_code, 200)
        register_response = self.client.post("/api/v1/auth/register/", {
            "phone": "+243810009999", "email": "new@test.cd", "first_name": "Nouveau", "last_name": "Membre",
            "password": "StrongPassword2026!", "otp_id": request_response.data["challenge_id"],
        }, format="json")
        self.assertEqual(register_response.status_code, 201)
        self.assertEqual(register_response.data["user"]["phone"], "+243810009999")

    def test_admin_governance_endpoints(self):
        admin = User.objects.create_user("+243810000099", email="admin@test.cd", password="Password123!", role=User.Role.ADMIN, first_name="Amina", last_name="Admin")
        self.client.force_authenticate(admin)
        create_response = self.client.post("/api/v1/users/", {
            "phone": "+243810000098", "email": "newleader@test.cd", "first_name": "Chef", "last_name": "Test",
            "password": "StrongPassword2026!", "role": "leader", "club": str(self.club_a.id),
        }, format="json")
        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["name"], "Chef Test")
        without_email = self.client.post("/api/v1/users/", {
            "phone": "+243810000095", "first_name": "Membre", "last_name": "Sans Email",
            "password": "StrongPassword2026!", "role": "borrower", "club": str(self.club_a.id),
        }, format="json")
        self.assertEqual(without_email.status_code, 201)
        self.assertTrue(User.objects.get(pk=without_email.data["id"]).email.endswith("@users.reboot.local"))
        invitation = self.client.post("/api/v1/invitations/", {"phone": "+243810000097", "role": "borrower", "club": str(self.club_a.id)}, format="json")
        self.assertEqual(invitation.status_code, 410)
        self.assertFalse(Invitation.objects.filter(phone="+243810000097").exists())
        configuration = self.client.patch("/api/v1/configuration/", {"default_commission_rate": "2.50"}, format="json")
        self.assertEqual(configuration.status_code, 200)
        self.assertEqual(configuration.data["default_commission_rate"], "2.50")

    def test_leader_cannot_create_admin_or_validate_identity(self):
        self.client.force_authenticate(self.leader_a)
        create_response = self.client.post("/api/v1/users/", {
            "phone": "+243810000096", "email": "blocked@test.cd", "first_name": "Faux", "last_name": "Admin",
            "password": "StrongPassword2026!", "role": "admin", "club": str(self.club_a.id),
        }, format="json")
        self.assertEqual(create_response.status_code, 400)
        verify_response = self.client.post(f"/api/v1/users/{self.leader_a.id}/verify-identity/", {"verified": True}, format="json")
        self.assertEqual(verify_response.status_code, 410)

    def test_extra_profile_requires_validation_before_switch(self):
        self.client.force_authenticate(self.leader_a)
        request_profile = self.client.post("/api/v1/memberships/", {
            "club": str(self.club_a.id), "user": self.leader_a.id, "role": "borrower",
        }, format="json")
        self.assertEqual(request_profile.status_code, 201)
        blocked_switch = self.client.post("/api/v1/auth/switch-profile/", {"profile": "borrower"}, format="json")
        self.assertEqual(blocked_switch.status_code, 400)
        self_approval = self.client.post(f"/api/v1/memberships/{request_profile.data['id']}/decide/", {"approve": True}, format="json")
        self.assertEqual(self_approval.status_code, 403)
        admin = User.objects.create_user("+243810000095", email="profiles@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.client.force_authenticate(admin)
        decision = self.client.post(f"/api/v1/memberships/{request_profile.data['id']}/decide/", {"approve": True}, format="json")
        self.assertEqual(decision.status_code, 200)
        self.client.force_authenticate(self.leader_a)
        switched = self.client.post("/api/v1/auth/switch-profile/", {"profile": "borrower"}, format="json")
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(switched.data["current_profile"], "borrower")

    def test_leader_can_rename_but_cannot_change_financial_rules(self):
        self.client.force_authenticate(self.leader_a)
        response = self.client.patch(f"/api/v1/clubs/{self.club_a.id}/", {"name": "Club Renomme", "interest_rate": "99.00"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.club_a.refresh_from_db()
        self.assertEqual(self.club_a.name, "Club Renomme")
        self.assertEqual(str(self.club_a.interest_rate), "20.00")

    def test_admin_configures_non_overlapping_rate_tiers_used_by_new_loans(self):
        admin = User.objects.create_user("+243810000087", email="tiers-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        borrower = User.objects.create_user("+243810000088", email="tiers-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        Membership.objects.create(club=self.club_a, user=borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        self.client.force_authenticate(admin)
        first = self.client.post("/api/v1/club-rate-tiers/", {
            "club": str(self.club_a.id), "min_amount": "0", "max_amount": "100000",
            "interest_rate": "10", "leader_commission_rate": "2", "platform_fee_rate": "13",
        }, format="json")
        self.assertEqual(first.status_code, 201)
        second = self.client.post("/api/v1/club-rate-tiers/", {
            "club": str(self.club_a.id), "min_amount": "100001", "max_amount": "500000",
            "interest_rate": "5", "leader_commission_rate": "1", "platform_fee_rate": "10",
        }, format="json")
        self.assertEqual(second.status_code, 201)
        overlap = self.client.post("/api/v1/club-rate-tiers/", {
            "club": str(self.club_a.id), "min_amount": "90000", "max_amount": "120000",
            "interest_rate": "1", "leader_commission_rate": "1", "platform_fee_rate": "1",
        }, format="json")
        self.assertEqual(overlap.status_code, 400)
        created = self.client.post("/api/v1/loans/assisted/", {
            "club": str(self.club_a.id), "borrower": borrower.id, "amount": "200000",
            "duration_code": "3m", "repayment_frequency": "monthly", "purpose": "Stock",
            "estimated_income": "400000",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        loan = Loan.objects.get(pk=created.data["id"])
        self.assertEqual(loan.interest_rate, Decimal("5.00"))
        self.assertEqual(loan.leader_commission_rate, Decimal("1.00"))
        self.assertEqual(loan.fee_rate, Decimal("10.00"))
        self.assertEqual(ClubRateTier.objects.filter(club=self.club_a).count(), 2)

    def test_admin_can_handle_leader_stages_from_user_validations(self):
        admin = User.objects.create_user("+243810000089", email="delegated-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        borrower = User.objects.create_user("+243810000090", email="delegated-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        membership = Membership.objects.create(
            club=self.club_a, user=borrower, role=Membership.Role.BORROWER,
            status=Membership.Status.PENDING, member_approved_at=None,
        )
        self.client.force_authenticate(admin)
        delegated_membership = self.client.post(
            f"/api/v1/memberships/{membership.id}/leader-decide/", {"approve": True}, format="json",
        )
        self.assertEqual(delegated_membership.status_code, 200)
        membership.refresh_from_db()
        self.assertIsNotNone(membership.leader_approved_at)
        self.assertEqual(membership.status, Membership.Status.PENDING)

        membership.member_approved_at = membership.created_at
        membership.accepted_at = membership.created_at
        membership.save(update_fields=["member_approved_at", "accepted_at"])
        final_membership = self.client.post(f"/api/v1/memberships/{membership.id}/decide/", {"approve": True}, format="json")
        self.assertEqual(final_membership.status_code, 200)
        self.assertEqual(final_membership.data["status"], Membership.Status.ACTIVE)

        loan_created = self.client.post("/api/v1/loans/assisted/", {
            "club": str(self.club_a.id), "borrower": borrower.id, "amount": "100000",
            "duration_code": "3m", "repayment_frequency": "monthly", "purpose": "Stock",
            "estimated_income": "200000",
        }, format="json")
        self.assertEqual(loan_created.status_code, 201)
        loan_id = loan_created.data["id"]
        delegated_loan = self.client.post(f"/api/v1/loans/{loan_id}/admin-leader-decide/", {"approve": True}, format="json")
        self.assertEqual(delegated_loan.status_code, 200)
        self.assertEqual(delegated_loan.data["status"], Loan.Status.REVIEW)
        final_loan = self.client.post(f"/api/v1/loans/{loan_id}/decide/", {"approve": True}, format="json")
        self.assertEqual(final_loan.status_code, 200)
        self.assertEqual(final_loan.data["status"], Loan.Status.APPROVED)
        self.assertTrue(AuditLog.objects.filter(action="loan.leader_approved_by_admin", object_id=str(loan_id)).exists())

    def test_account_validations_are_listed_for_the_expected_decider(self):
        admin = User.objects.create_user("+243810000031", email="owner-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        borrower = User.objects.create_user("+243810000032", email="owner-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        Membership.objects.create(club=self.club_a, user=borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        self.client.force_authenticate(admin)
        created = self.client.post("/api/v1/loans/assisted/", {
            "club": str(self.club_a.id), "borrower": borrower.id, "amount": "100000",
            "duration_code": "3m", "repayment_frequency": "monthly", "purpose": "Stock",
            "estimated_income": "200000",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        loan_id = str(created.data["id"])

        emitter = self.client.get(f"/api/v1/users/{borrower.id}/validations/")
        leader = self.client.get(f"/api/v1/users/{self.leader_a.id}/validations/")
        administrator = self.client.get(f"/api/v1/users/{admin.id}/validations/")
        self.assertNotIn(loan_id, {str(item["id"]) for item in emitter.data["loans"]})
        self.assertIn(loan_id, {str(item["id"]) for item in leader.data["loans"]})
        self.assertNotIn(loan_id, {str(item["id"]) for item in administrator.data["loans"]})

        self.client.post(f"/api/v1/loans/{loan_id}/admin-leader-decide/", {"approve": True}, format="json")
        administrator = self.client.get(f"/api/v1/users/{admin.id}/validations/")
        self.assertIn(loan_id, {str(item["id"]) for item in administrator.data["loans"]})

    def test_admin_adds_missing_lender_borrower_and_collector_profiles(self):
        admin = User.objects.create_user("+243810000033", email="profile-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        lender = User.objects.create_user("+243810000034", email="profile-lender@test.cd", password="Password123!", role=User.Role.LENDER, kyc_verified=True)
        borrower = User.objects.create_user("+243810000035", email="profile-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.client.force_authenticate(admin)

        borrower_profile = self.client.post(f"/api/v1/users/{lender.id}/add-profile/", {"role": "borrower", "club": str(self.club_a.id)}, format="json")
        self.assertEqual(borrower_profile.status_code, 201)
        self.assertTrue(Membership.objects.filter(club=self.club_a, user=lender, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE).exists())

        lender_profile = self.client.post(f"/api/v1/users/{borrower.id}/add-profile/", {"role": "lender"}, format="json")
        self.assertEqual(lender_profile.status_code, 201)
        borrower.refresh_from_db()
        self.assertEqual(borrower.lender_profile_status, User.LenderProfileStatus.ACTIVE)

        collector_profile = self.client.post(f"/api/v1/users/{borrower.id}/add-profile/", {"role": "collector"}, format="json")
        self.assertEqual(collector_profile.status_code, 201)
        borrower.refresh_from_db()
        self.assertTrue(borrower.collector_profile_active)

    def test_admin_conversation_inbox_and_user_crud(self):
        admin = User.objects.create_user("+243810000094", email="crud@test.cd", password="Password123!", role=User.Role.ADMIN)
        self.client.force_authenticate(self.leader_a)
        self.client.post("/api/v1/messages/", {"club": str(self.club_a.id), "kind": "text", "body": "Rapport du jour"}, format="json")
        self.client.force_authenticate(admin)
        inbox = self.client.get("/api/v1/messages/conversations/")
        self.assertEqual(inbox.status_code, 200)
        self.assertEqual(inbox.data["results"][0]["club_name"], "Club A")
        update = self.client.patch(f"/api/v1/users/{self.leader_b.id}/", {"first_name": "Patrick"}, format="json")
        self.assertEqual(update.status_code, 200)
        delete = self.client.delete(f"/api/v1/users/{self.leader_b.id}/")
        self.assertEqual(delete.status_code, 204)
        self.leader_b.refresh_from_db()
        self.assertFalse(self.leader_b.is_active)

    def test_admin_can_operate_for_offline_clients(self):
        admin = User.objects.create_user("+243810000091", email="operations@test.cd", password="Password123!", role=User.Role.ADMIN)
        lender = User.objects.create_user("+243810000092", email="offline-lender@test.cd", password="Password123!", role=User.Role.LENDER, first_name="Paul", kyc_verified=True)
        borrower = User.objects.create_user("+243810000093", email="offline-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, first_name="Sarah", kyc_verified=True)
        Membership.objects.create(club=self.club_a, user=lender, role=Membership.Role.LENDER, status=Membership.Status.ACTIVE)
        Membership.objects.create(club=self.club_a, user=borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)
        self.client.force_authenticate(admin)

        deposit_response = self.client.post("/api/v1/deposits/assisted/", {
            "club": str(self.club_a.id), "lender": lender.id, "amount": "250000",
            "payment_method": "cash", "provider_reference": "RECU-42",
        }, format="json")
        self.assertEqual(deposit_response.status_code, 201)
        deposit = Deposit.objects.get(pk=deposit_response.data["id"])
        self.assertEqual(deposit.status, Deposit.Status.VALIDATED)
        self.assertEqual(deposit.validated_by, admin)

        loan_response = self.client.post("/api/v1/loans/assisted/", {
            "club": str(self.club_a.id), "borrower": borrower.id, "amount": "100000",
            "duration_code": "3m", "repayment_frequency": "monthly", "purpose": "Stock",
            "estimated_income": "80000",
        }, format="json")
        self.assertEqual(loan_response.status_code, 201)
        loan = Loan.objects.get(pk=loan_response.data["id"])
        self.assertEqual(loan.borrower, borrower)
        approve_loan(loan, self.leader_a)
        approve_loan(loan, admin)

        funding_response = self.client.post(f"/api/v1/loans/{loan.id}/fund/", {
            "lender": lender.id, "amount": "100000",
        }, format="json")
        self.assertEqual(funding_response.status_code, 201)
        # L'admin est deja l'autorite de validation : l'operation assistee finance immediatement le pret.
        funding = LoanFunding.objects.get(loan=loan, lender=lender)
        self.assertEqual(funding.pending_amount, Decimal("0.00"))
        self.assertEqual(funding.amount, Decimal("100000.00"))
        audit = AuditLog.objects.filter(action="funding.submitted", object_id=str(funding.pk)).latest("created_at")
        self.assertEqual(audit.actor, admin)
        self.assertTrue(audit.new_values["assisted"])
        self.assertEqual(funding_response.data["message"], "Le placement assiste est valide et finance le pret.")

    def test_loan_requires_leader_then_admin_before_lender_visibility(self):
        admin = User.objects.create_user("+243810000081", email="workflow-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        lender = User.objects.create_user("+243810000082", email="workflow-lender@test.cd", password="Password123!", role=User.Role.LENDER, kyc_verified=True)
        borrower = User.objects.create_user("+243810000083", email="workflow-borrower@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        Membership.objects.create(club=self.club_a, user=borrower, role=Membership.Role.BORROWER, status=Membership.Status.ACTIVE)

        self.client.force_authenticate(admin)
        created = self.client.post("/api/v1/loans/assisted/", {
            "club": str(self.club_a.id), "borrower": borrower.id, "amount": "100000",
            "duration_code": "3m", "repayment_frequency": "monthly", "purpose": "Stock",
            "estimated_income": "200000",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        loan_id = created.data["id"]
        self.assertEqual(self.client.post(f"/api/v1/loans/{loan_id}/decide/", {"approve": True}, format="json").status_code, 400)

        self.client.force_authenticate(self.leader_a)
        leader_response = self.client.post(f"/api/v1/loans/{loan_id}/decide/", {"approve": True}, format="json")
        self.assertEqual(leader_response.status_code, 200)
        self.assertEqual(leader_response.data["status"], Loan.Status.REVIEW)

        self.client.force_authenticate(lender)
        lender_ids = {str(item["id"]) for item in self.client.get("/api/v1/loans/").data["results"]}
        self.assertNotIn(str(loan_id), lender_ids)

        self.client.force_authenticate(admin)
        admin_response = self.client.post(f"/api/v1/loans/{loan_id}/decide/", {"approve": True}, format="json")
        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(admin_response.data["status"], Loan.Status.APPROVED)

        self.client.force_authenticate(lender)
        lender_ids = {str(item["id"]) for item in self.client.get("/api/v1/loans/").data["results"]}
        self.assertIn(str(loan_id), lender_ids)

    def test_leader_cannot_use_admin_assisted_operations(self):
        self.client.force_authenticate(self.leader_a)
        response = self.client.post("/api/v1/deposits/assisted/", {
            "club": str(self.club_a.id), "lender": self.leader_a.id, "amount": "10000",
        }, format="json")
        self.assertEqual(response.status_code, 403)

    def test_admin_adds_borrower_without_member_confirmation_and_can_name_collector(self):
        admin = User.objects.create_user("+243810000084", email="profiles-admin@test.cd", password="Password123!", role=User.Role.ADMIN)
        member = User.objects.create_user("+243810000085", email="profiles-member@test.cd", password="Password123!", role=User.Role.BORROWER, kyc_verified=True)
        self.client.force_authenticate(admin)

        added = self.client.post("/api/v1/memberships/invite/", {
            "club": str(self.club_a.id), "phone": member.phone, "role": "borrower",
        }, format="json")
        self.assertEqual(added.status_code, 201)
        membership = Membership.objects.get(club=self.club_a, user=member, role=Membership.Role.BORROWER)
        self.assertEqual(membership.status, Membership.Status.ACTIVE)
        self.assertIsNotNone(membership.member_approved_at)
        self.assertEqual(membership.reviewed_by, admin)

        appointed = self.client.post(f"/api/v1/users/{member.id}/set-collector-profile/", {"active": True}, format="json")
        self.assertEqual(appointed.status_code, 200)
        self.assertTrue(appointed.data["collector_profile_active"])
        self.assertIn(User.Role.COLLECTOR, appointed.data["available_profiles"])
