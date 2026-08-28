import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import (
    AuditLog,
    Deposit,
    Installment,
    Loan,
    LoanBorrower,
    LoanFunding,
    Notification,
    REPAYMENT_FREQUENCIES,
    Repayment,
    User,
    Withdrawal,
    installment_count,
)

CENT = Decimal("0.01")
ACTIVE_LOAN_STATUSES = [Loan.Status.APPROVED, Loan.Status.DISBURSED, Loan.Status.CURRENT, Loan.Status.LATE, Loan.Status.DISPUTED]
# Statuts pour lesquels le capital d'un preteur reste immobilise.
ENGAGED_LOAN_STATUSES = ACTIVE_LOAN_STATUSES


def money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def add_months(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def loan_end_date(start, duration_code):
    from .models import LOAN_DURATIONS

    duration = LOAN_DURATIONS.get(duration_code) or LOAN_DURATIONS["3m"]
    if duration["months"]:
        return add_months(start, duration["months"])
    return start + timedelta(days=duration["days"])


def installment_dates(start, duration_code, frequency_code):
    """Dates d'echeance reparties sur la duree selon la frequence choisie.

    La derniere echeance tombe toujours a la date de fin du pret, ce qui garantit
    la coherence entre la duree annoncee et l'echeancier reellement genere.
    """
    count = installment_count(duration_code, frequency_code)
    if count <= 0:
        raise ValidationError("La frequence de remboursement ne correspond pas a la duree du pret.")
    frequency = REPAYMENT_FREQUENCIES[frequency_code]
    end = loan_end_date(start, duration_code)
    dates = []
    for number in range(1, count + 1):
        if number == count:
            dates.append(end)
            break
        if frequency["months"]:
            due = add_months(start, number * frequency["months"])
        else:
            due = start + timedelta(days=number * frequency["days"])
        dates.append(min(due, end))
    for index in range(1, len(dates)):
        if dates[index] <= dates[index - 1]:
            dates[index] = dates[index - 1] + timedelta(days=1)
    if dates[-1] < end:
        dates[-1] = end
    return dates


def split_amount(total, parts):
    """Repartit un montant en `parts` tranches egales, le reliquat sur la derniere."""
    total = money(total)
    if parts <= 0:
        return []
    base = money(total / parts)
    values = [base] * (parts - 1)
    values.append(money(total - base * (parts - 1)))
    return values


def loan_cost_breakdown(amount, interest_rate, fee_rate, leader_rate):
    """Les trois composantes du cout du credit, en % FIXE du capital emprunte."""
    amount = money(amount)
    interest = money(amount * Decimal(interest_rate) / 100)
    fee = money(amount * Decimal(fee_rate) / 100)
    leader = money(amount * Decimal(leader_rate) / 100)
    charge = interest + fee + leader
    return {
        "amount": amount,
        "interest": interest,
        "fee": fee,
        "leader_commission": leader,
        "charge": charge,
        "total_due": amount + charge,
    }


def audit(actor, action, instance, old=None, new=None):
    AuditLog.objects.create(
        actor=actor,
        action=action,
        object_type=instance.__class__.__name__,
        object_id=str(instance.pk),
        club=getattr(instance, "club", None) or getattr(getattr(instance, "loan", None), "club", None),
        old_values=old or {},
        new_values=new or {},
    )


def notify(user, title, message, kind="info", data=None):
    Notification.objects.create(recipient=user, title=title, message=message, kind=kind, data=data or {})


def platform_admins():
    return User.objects.filter(role=User.Role.ADMIN, is_active=True)


def is_platform_admin(user):
    return bool(getattr(user, "is_authenticated", False) and (user.is_superuser or user.role == User.Role.ADMIN))


def can_collect(user, loan):
    """Encaissement : administrateur, ou mandataire designe sur ce pret precis."""
    if is_platform_admin(user):
        return True
    return bool(loan.collection_agent_id and loan.collection_agent_id == user.id)


def club_finances(club):
    """Situation financiere d'un club.

    Le portefeuille preteur est desormais global (aucun rattachement a un club) :
    un club porte donc ses encours de credit et la commission de son chef.
    """
    active_loans = club.loans.filter(status__in=ACTIVE_LOAN_STATUSES)
    outstanding_principal = Decimal("0")
    for loan in active_loans:
        principal_repaid = loan.repayments.filter(status=Repayment.Status.VALIDATED).aggregate(total=Sum("principal_paid"))["total"] or Decimal("0")
        outstanding_principal += max(loan.amount - principal_repaid, Decimal("0"))
    settled = ACTIVE_LOAN_STATUSES + [Loan.Status.REPAID]
    borrowed = club.loans.filter(status__in=settled).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    repaid = club.loans.aggregate(total=Sum("total_paid"))["total"] or Decimal("0")
    leader_commission = Repayment.objects.filter(loan__club=club, status=Repayment.Status.VALIDATED).aggregate(total=Sum("leader_commission_paid"))["total"] or Decimal("0")
    leader_expected = club.loans.filter(status__in=settled).aggregate(total=Sum("leader_commission_total"))["total"] or Decimal("0")
    return {
        "borrowed": money(borrowed),
        "engaged": money(outstanding_principal),
        "repaid": money(repaid),
        "leader_commission_collected": money(leader_commission),
        "leader_commission_expected": money(leader_expected),
        # Cles conservees pour la compatibilite des ecrans deja livres.
        "deposited": money(borrowed),
        "available": money(max(borrowed - outstanding_principal, Decimal("0"))),
        "withdrawn": money(repaid),
    }


def borrower_credit_score(user):
    loans = list(user.loans.prefetch_related("installments").all())
    if not loans:
        return {"score": 50, "level": "Nouveau", "breakdown": [{"label": "Score initial", "points": 50}], "loans_analyzed": 0}
    repaid_loans = sum(loan.status == Loan.Status.REPAID for loan in loans)
    late_loans = sum(loan.status in [Loan.Status.LATE, Loan.Status.DISPUTED] for loan in loans)
    installments = [installment for loan in loans for installment in loan.installments.all()]
    paid = [item for item in installments if item.status == Installment.Status.PAID]
    on_time = [item for item in paid if item.updated_at.date() <= item.due_date]
    overdue = [item for item in installments if item.status == Installment.Status.LATE]
    due_count = sum(item.due_date <= timezone.localdate() for item in installments)
    consistency = round(len(paid) / due_count * 15) if due_count else 0
    parts = [
        {"label": "Base de confiance", "points": 50},
        {"label": "Emprunts totalement rembourses", "points": min(repaid_loans * 8, 24)},
        {"label": "Echeances payees a temps", "points": min(len(on_time) * 2, 20)},
        {"label": "Regularite des paiements", "points": min(consistency, 15)},
        {"label": "Echeances en retard", "points": -min(len(overdue) * 5, 30)},
        {"label": "Prets en retard ou litige", "points": -min(late_loans * 15, 30)},
    ]
    score = max(0, min(100, sum(item["points"] for item in parts)))
    level = "Excellent" if score >= 85 else "Bon" if score >= 70 else "Moyen" if score >= 50 else "Risque"
    return {"score": score, "level": level, "breakdown": parts, "loans_analyzed": len(loans)}


@transaction.atomic
def validate_deposit(deposit, actor, approve=True, reason=""):
    """Encaissement d'un depot : reserve a l'administrateur."""
    if not is_platform_admin(actor):
        raise ValidationError("Seul l'administrateur peut encaisser un depot.")
    deposit = Deposit.objects.select_for_update().get(pk=deposit.pk)
    if deposit.status != Deposit.Status.PENDING:
        raise ValidationError("Seul un depot en attente peut etre traite.")
    if not approve and not reason:
        raise ValidationError("Le motif de refus est obligatoire.")
    if approve and not deposit.lender.has_valid_kyc:
        raise ValidationError("Le KYC du preteur doit etre valide avant de valider ce depot.")
    old = {"status": deposit.status}
    deposit.status = Deposit.Status.VALIDATED if approve else Deposit.Status.REJECTED
    deposit.validated_by = actor
    deposit.validated_at = timezone.now()
    deposit.decision_reason = reason
    deposit.save(update_fields=["status", "validated_by", "validated_at", "decision_reason", "updated_at"])
    audit(actor, "deposit.validated" if approve else "deposit.rejected", deposit, old, {"status": deposit.status})
    notify(deposit.lender, "Depot traite", f"Votre depot {deposit.reference} est {deposit.get_status_display().lower()}.", "deposit")
    return deposit


def sync_collective_shares(loan, shares=None):
    """Repartit le capital entre co-emprunteurs.

    Les parts saisies explicitement sont conservees telles quelles ; le reliquat
    est divise a parts egales entre ceux qui n'ont rien saisi, y compris
    l'initiateur de la demande.
    """
    rows = list(loan.borrowers.select_related("user"))
    if not rows:
        return
    provided = {str(key): money(value) for key, value in (shares or {}).items() if value not in (None, "")}
    for row in rows:
        if str(row.user_id) in provided:
            row.share_amount = provided[str(row.user_id)]
            row.share_is_manual = True
    fixed_rows = [row for row in rows if row.share_is_manual]
    free_rows = [row for row in rows if not row.share_is_manual]
    fixed_total = sum((row.share_amount for row in fixed_rows), Decimal("0"))
    if fixed_total > loan.amount:
        raise ValidationError("La somme des parts saisies depasse le montant du pret.")
    if free_rows:
        for row, value in zip(free_rows, split_amount(loan.amount - fixed_total, len(free_rows))):
            row.share_amount = value
    elif money(fixed_total) != money(loan.amount):
        raise ValidationError("La repartition doit couvrir exactement le montant du pret.")
    for row in rows:
        row.save(update_fields=["share_amount", "share_is_manual", "updated_at"])


def collective_is_ready(loan):
    rows = list(loan.borrowers.all())
    if not rows:
        return False
    if any(row.status != LoanBorrower.Status.ACCEPTED for row in rows):
        return False
    return money(sum((row.share_amount for row in rows), Decimal("0"))) == money(loan.amount)


@transaction.atomic
def submit_loan(loan, actor):
    """Passe un pret en `submitted` et le transmet d'abord au chef du club."""
    loan.status = Loan.Status.SUBMITTED
    loan.save(update_fields=["status", "updated_at"])
    audit(actor, "loan.submitted", loan, new={"amount": str(loan.amount), "collective": loan.is_collective})
    if loan.club.leader:
        notify(loan.club.leader, "Nouvelle demande de pret", f"{loan.borrower.display_name} demande {loan.amount} {loan.currency} dans {loan.club.name}.", "loan_review", {"loan": str(loan.id)})
    return loan


@transaction.atomic
def approve_loan(loan, actor, approve=True, reason="", admin_as_leader=False):
    loan = Loan.objects.select_for_update().select_related("club", "borrower").get(pk=loan.pk)
    if loan.status not in [Loan.Status.SUBMITTED, Loan.Status.REVIEW]:
        raise ValidationError("Cette demande ne peut plus etre traitee.")
    admin_decision = is_platform_admin(actor)
    leader_decision = bool(
        (loan.club.leader_id == actor.id and actor.current_profile == User.Role.LEADER) or
        (admin_as_leader and admin_decision)
    )
    if loan.status == Loan.Status.SUBMITTED and not leader_decision:
        raise ValidationError("Le chef du club doit valider cette demande avant l'administrateur.")
    if loan.status == Loan.Status.REVIEW and not admin_decision:
        raise ValidationError("La validation finale de cette demande est reservee a l'administrateur.")
    if not approve and not reason:
        raise ValidationError("Le motif de refus est obligatoire.")
    if approve and not loan.borrower.has_valid_kyc:
        raise ValidationError("Le KYC de l'emprunteur doit etre valide avant d'approuver ce pret.")
    if approve:
        if loan.club.status != loan.club.Status.ACTIVE:
            raise ValidationError("Le club doit etre actif.")
        if not loan.club.min_loan <= loan.amount <= loan.club.max_loan:
            raise ValidationError("Le montant ne respecte pas les limites du club.")
        if loan.duration_code not in loan.club.duration_options:
            raise ValidationError("La duree ne fait pas partie des durees autorisees par le club.")
        count = installment_count(loan.duration_code, loan.repayment_frequency)
        if count <= 0:
            raise ValidationError("La frequence de remboursement ne correspond pas a la duree du pret.")
        if loan.is_collective and not collective_is_ready(loan):
            raise ValidationError("Tous les co-emprunteurs doivent avoir accepte et le capital doit etre entierement reparti.")
        if loan.status == Loan.Status.SUBMITTED:
            loan.status = Loan.Status.REVIEW
            loan.decision_reason = ""
            loan.save(update_fields=["status", "decision_reason", "updated_at"])
            action = "loan.leader_approved_by_admin" if admin_as_leader else "loan.leader_approved"
            audit(actor, action, loan, new={"status": loan.status, "delegated": admin_as_leader})
            recipients = {row.user for row in loan.borrowers.select_related("user")} or {loan.borrower}
            for recipient in recipients:
                title = "Etape du chef validee par l'administration" if admin_as_leader else "Accord du chef de club"
                notify(recipient, title, f"La demande {loan.reference} attend maintenant la validation finale de l'administrateur.", "loan", {"loan": str(loan.id)})
            for admin in platform_admins():
                source = "L'administration a valide l'etape du chef pour" if admin_as_leader else f"Le chef de {loan.club.name} a valide"
                notify(admin, "Pret a valider", f"{source} le pret {loan.reference}.", "loan_review", {"loan": str(loan.id)})
            return loan
        costs = loan_cost_breakdown(loan.amount, loan.interest_rate, loan.fee_rate, loan.leader_commission_rate)
        loan.interest_total = costs["interest"]
        loan.fee_total = costs["fee"]
        loan.leader_commission_total = costs["leader_commission"]
        loan.total_due = costs["total_due"]
        loan.installment_total = count
        loan.status = Loan.Status.APPROVED
        loan.approved_by = actor
        loan.approved_at = timezone.now()
    else:
        loan.status = Loan.Status.REJECTED
    loan.decision_reason = reason
    loan.save()
    audit(actor, f"loan.{loan.status}", loan, new={"status": loan.status, "total_due": str(loan.total_due)})
    recipients = {row.user for row in loan.borrowers.select_related("user")} or {loan.borrower}
    for recipient in recipients:
        notify(recipient, "Decision sur le pret", f"La demande {loan.reference} est {loan.get_status_display().lower()}.", "loan", {"loan": str(loan.id)})
    if approve:
        for lender in User.objects.filter(lender_profile_status=User.LenderProfileStatus.ACTIVE, is_active=True):
            notify(lender, "Nouveau pret a financer", f"Le pret {loan.reference} recherche {loan.amount} {loan.currency}.", "funding", {"loan": str(loan.id)})
    return loan


def lender_engaged_capital(lender):
    """Capital immobilise : placements valides non rembourses + placements en attente."""
    engaged = Decimal("0")
    for funding in LoanFunding.objects.filter(lender=lender).select_related("loan"):
        if funding.loan.status in ENGAGED_LOAN_STATUSES:
            engaged += max(funding.amount - funding.principal_repaid, Decimal("0"))
        engaged += funding.pending_amount
    return engaged


def lender_total_available(lender):
    """Capital libre d'un preteur : portefeuille global, hors club."""
    deposits = Deposit.objects.filter(lender=lender, status=Deposit.Status.VALIDATED).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    withdrawals = Withdrawal.objects.filter(lender=lender, status=Withdrawal.Status.PAID).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    earned_interest = LoanFunding.objects.filter(lender=lender).aggregate(total=Sum("interest_earned"))["total"] or Decimal("0")
    return money(max(deposits + earned_interest - withdrawals - lender_engaged_capital(lender), Decimal("0")))


def lender_available(club, lender):
    """Conserve pour compatibilite : le portefeuille preteur est global."""
    return lender_total_available(lender)


@transaction.atomic
def fund_loan(loan, lender, amount, actor=None):
    """Soumet un placement. Il reste en attente jusqu'a validation administrateur."""
    actor = actor or lender
    loan = Loan.objects.select_for_update().select_related("club", "borrower", "club__leader").get(pk=loan.pk)
    if not lender.has_valid_kyc:
        raise ValidationError("Le KYC du preteur doit etre valide avant un placement.")
    if loan.status != Loan.Status.APPROVED:
        raise ValidationError("Ce pret n'est pas ouvert au financement.")
    if lender.lender_profile_status != User.LenderProfileStatus.ACTIVE:
        raise ValidationError("Un profil preteur global actif est obligatoire.")
    amount = money(amount)
    if amount <= 0 or amount > loan.amount:
        raise ValidationError("Le montant doit etre positif et ne pas depasser le montant total du pret.")
    if amount > lender_total_available(lender):
        raise ValidationError("Votre capital libre est insuffisant.")
    funding = LoanFunding.objects.create(
        loan=loan, lender=lender, amount=Decimal("0"), pending_amount=amount,
        submitted_at=timezone.now(), decision_reason="",
    )
    audit(actor, "funding.submitted", funding, new={
        "amount": str(amount), "pending_total": str(amount),
        "lender": str(lender.id), "assisted": actor.id != lender.id,
    })
    for admin in platform_admins():
        notify(admin, "Placement a valider", f"{lender.public_name} propose {amount} {loan.currency} sur le pret {loan.reference}.", "funding_review", {"loan": str(loan.id), "funding": str(funding.id)})
    notify(lender, "Placement enregistre", f"Votre placement de {amount} {loan.currency} attend la validation de l'administrateur.", "funding", {"loan": str(loan.id)})
    return funding


@transaction.atomic
def review_funding(funding, actor, approve=True, reason=""):
    """Validation administrateur d'un placement : sans elle le pret n'est pas finance."""
    if not is_platform_admin(actor):
        raise ValidationError("La validation des placements est reservee a l'administrateur.")
    funding = LoanFunding.objects.select_for_update().select_related("loan", "lender", "loan__club").get(pk=funding.pk)
    loan = Loan.objects.select_for_update().get(pk=funding.loan_id)
    if funding.pending_amount <= 0:
        raise ValidationError("Ce placement n'est plus en attente de validation.")
    if not approve and not reason:
        raise ValidationError("Le motif de refus est obligatoire.")
    pending = funding.pending_amount
    if approve:
        if loan.status != Loan.Status.APPROVED:
            raise ValidationError("Ce pret n'est plus ouvert au financement.")
        if pending > loan.funding_remaining:
            approve = False
            reason = f"Placement annule automatiquement : seulement {loan.funding_remaining} {loan.currency} reste disponible."
        else:
            funding.amount += pending
            funding.expected_gain += money(loan.interest_total * pending / loan.amount) if loan.amount else Decimal("0")
    funding.pending_amount = Decimal("0")
    funding.reviewed_by = actor
    funding.reviewed_at = timezone.now()
    funding.decision_reason = reason
    funding.save(update_fields=["amount", "expected_gain", "pending_amount", "reviewed_by", "reviewed_at", "decision_reason", "updated_at"])
    audit(actor, "funding.validated" if approve else "funding.rejected", funding, new={"amount": str(pending), "total": str(funding.amount), "reason": reason})
    notify(
        funding.lender, "Placement traite",
        f"Votre placement de {pending} {loan.currency} sur {loan.reference} est {'valide' if approve else 'refuse'}." + (f" Motif: {reason}" if reason else ""),
        "funding", {"loan": str(loan.id)},
    )
    loan.refresh_from_db()
    if approve:
        remaining = loan.funding_remaining
        oversized = LoanFunding.objects.select_for_update().filter(
            loan=loan, pending_amount__gt=remaining,
        ).exclude(pk=funding.pk).select_related("lender")
        for proposal in oversized:
            cancelled_amount = proposal.pending_amount
            cancellation_reason = f"Placement annule automatiquement : seulement {remaining} {loan.currency} reste disponible."
            proposal.pending_amount = Decimal("0")
            proposal.reviewed_by = actor
            proposal.reviewed_at = timezone.now()
            proposal.decision_reason = cancellation_reason
            proposal.save(update_fields=["pending_amount", "reviewed_by", "reviewed_at", "decision_reason", "updated_at"])
            audit(actor, "funding.auto_cancelled", proposal, new={"amount": str(cancelled_amount), "remaining": str(remaining), "reason": cancellation_reason})
            notify(proposal.lender, "Placement annule", f"Votre placement de {cancelled_amount} {loan.currency} sur {loan.reference} est annule. {cancellation_reason}", "funding", {"loan": str(loan.id)})
    if approve and loan.funding_remaining == 0 and not loan.funding_completed_at:
        loan.funding_completed_at = timezone.now()
        loan.scheduled_disbursement_date = timezone.localdate() + timedelta(days=1)
        loan.save(update_fields=["funding_completed_at", "scheduled_disbursement_date", "updated_at"])
        for recipient in {item for item in {loan.borrower, loan.club.leader, *platform_admins()} if item}:
            notify(recipient, "Financement complet", f"Le pret {loan.reference} est finance. Decaissement prevu le {loan.scheduled_disbursement_date:%d/%m/%Y}.", "funding_complete", {"loan": str(loan.id)})
    return funding


@transaction.atomic
def disburse_loan(loan, actor):
    """Decaissement : reserve a l'administrateur."""
    if not is_platform_admin(actor):
        raise ValidationError("Seul l'administrateur peut decaisser un pret.")
    loan = Loan.objects.select_for_update().select_related("club", "borrower").get(pk=loan.pk)
    if not loan.borrower.has_valid_kyc:
        raise ValidationError("Le KYC de l'emprunteur doit rester valide avant le decaissement.")
    if loan.status != Loan.Status.APPROVED:
        raise ValidationError("Seul un pret valide peut etre decaisse.")
    if loan.funding_remaining > 0:
        raise ValidationError("Le financement doit atteindre 100 % avant le decaissement.")
    disbursed_at = timezone.now()
    today = timezone.localdate(disbursed_at)
    dates = installment_dates(today, loan.duration_code, loan.repayment_frequency)
    count = len(dates)
    principals = split_amount(loan.amount, count)
    interests = split_amount(loan.interest_total, count)
    fees = split_amount(loan.fee_total, count)
    leader_fees = split_amount(loan.leader_commission_total, count)
    loan.installments.all().delete()
    for index, due_date in enumerate(dates):
        Installment.objects.create(
            loan=loan, number=index + 1, due_date=due_date,
            principal_due=principals[index], interest_due=interests[index],
            fee_due=fees[index], leader_commission_due=leader_fees[index],
        )
    loan.installment_total = count
    loan.status = Loan.Status.CURRENT
    loan.disbursed_at = disbursed_at
    loan.scheduled_disbursement_date = today
    loan.save(update_fields=["status", "installment_total", "disbursed_at", "scheduled_disbursement_date", "updated_at"])
    audit(actor, "loan.disbursed", loan, new={"status": loan.status, "installments": count, "disbursed_at": disbursed_at.isoformat()})
    shares = list(loan.borrowers.select_related("user"))
    if shares:
        for row in shares:
            notify(row.user, "Pret decaisse", f"Votre part de {row.share_amount} {loan.currency} a ete decaissee.", "loan", {"loan": str(loan.id)})
    else:
        notify(loan.borrower, "Pret decaisse", f"{loan.amount} {loan.currency} ont ete decaisses maintenant.", "loan", {"loan": str(loan.id)})
    for funding in loan.fundings.select_related("lender"):
        if funding.amount > 0:
            notify(funding.lender, "Pret finance", f"{funding.amount} {loan.currency} affectes au pret {loan.reference}.", "funding", {"loan": str(loan.id)})
    return loan


@transaction.atomic
def record_repayment(loan, actor, amount, payment_method="cash", borrower=None):
    """Encaissement d'une echeance : administrateur ou mandataire designe."""
    loan = Loan.objects.select_for_update().select_related("club", "borrower", "club__leader").get(pk=loan.pk)
    if not can_collect(actor, loan):
        raise ValidationError("Seul l'administrateur ou le mandataire designe peut encaisser ce pret.")
    if loan.status not in ACTIVE_LOAN_STATUSES:
        raise ValidationError("Ce pret n'accepte pas de remboursement.")
    amount = money(amount)
    if amount <= 0 or amount > loan.balance:
        raise ValidationError("Le montant doit etre positif et ne pas depasser le solde.")
    share = None
    if borrower is not None:
        share = loan.borrowers.select_for_update().filter(user=borrower).first()
        if share is None:
            raise ValidationError("Cette personne n'est pas co-emprunteur de ce pret.")
        share_due = money(share.share_amount * loan.total_due / loan.amount) if loan.amount else Decimal("0")
        if amount > money(share_due - share.total_paid):
            raise ValidationError("Le montant depasse la quote-part restante de ce co-emprunteur.")
    payer = borrower or loan.borrower
    repayment = Repayment.objects.create(
        loan=loan, payer=payer, recorded_by=actor, amount=amount,
        currency=loan.currency, payment_method=payment_method,
    )
    remaining = amount
    totals = {"principal": Decimal("0"), "interest": Decimal("0"), "fee": Decimal("0"), "leader_commission": Decimal("0"), "penalty": Decimal("0")}
    for installment in loan.installments.exclude(status=Installment.Status.PAID).select_for_update():
        components = [
            ("penalty", installment.penalty_due),
            ("fee", installment.fee_due),
            ("leader_commission", installment.leader_commission_due),
            ("interest", installment.interest_due),
            ("principal", installment.principal_due),
        ]
        component_cursor = installment.paid_amount
        for key, component_due in components:
            paid_here = min(component_cursor, component_due)
            component_cursor -= paid_here
            allocation = min(remaining, component_due - paid_here)
            totals[key] += allocation
            remaining -= allocation
            installment.paid_amount += allocation
            if remaining <= 0:
                break
        installment.status = Installment.Status.PAID if installment.paid_amount >= installment.total_due else Installment.Status.PARTIAL
        installment.save(update_fields=["paid_amount", "status", "updated_at"])
        if remaining <= 0:
            break
    repayment.principal_paid = totals["principal"]
    repayment.interest_paid = totals["interest"]
    repayment.fee_paid = totals["fee"]
    repayment.leader_commission_paid = totals["leader_commission"]
    repayment.penalty_paid = totals["penalty"]
    repayment.save()
    for funding in loan.fundings.select_for_update():
        if funding.amount <= 0 or not loan.amount:
            continue
        ratio = funding.amount / loan.amount
        principal_return = money(totals["principal"] * ratio)
        interest_return = money(totals["interest"] * ratio)
        funding.principal_repaid += principal_return
        funding.interest_earned += interest_return
        funding.save(update_fields=["principal_repaid", "interest_earned", "updated_at"])
        if principal_return + interest_return > 0:
            notify(
                funding.lender, "Retour sur placement",
                f"{principal_return + interest_return} {loan.currency} recus sur le pret {loan.reference}.",
                "funding_return", {"loan": str(loan.id)},
            )
    if share is not None:
        share.total_paid += amount
        share.principal_repaid += totals["principal"]
        share.save(update_fields=["total_paid", "principal_repaid", "updated_at"])
    if loan.club.leader_id and totals["leader_commission"] > 0:
        notify(
            loan.club.leader, "Commission chef de club",
            f"{totals['leader_commission']} {loan.currency} de commission encaissee sur {loan.reference}.",
            "leader_commission", {"loan": str(loan.id)},
        )
    loan.total_paid += amount
    if loan.total_paid >= loan.total_due:
        loan.status = Loan.Status.REPAID
    elif loan.status == Loan.Status.LATE and not loan.installments.filter(status=Installment.Status.LATE).exists():
        loan.status = Loan.Status.CURRENT
    loan.save(update_fields=["total_paid", "status", "updated_at"])
    audit(actor, "repayment.recorded", repayment, new={"amount": str(amount), "loan": str(loan.pk), "payer": str(payer.id)})
    notify(payer, "Paiement recu", f"Paiement de {amount} {loan.currency}. Solde du pret: {loan.balance} {loan.currency}.", "repayment", {"loan": str(loan.id)})
    return repayment


@transaction.atomic
def process_due_installments(today=None):
    today = today or timezone.localdate()
    counters = {"due": 0, "late": 0, "reminders": 0}
    installments = Installment.objects.select_for_update().select_related("loan", "loan__club", "loan__borrower").filter(
        status__in=[Installment.Status.UPCOMING, Installment.Status.DUE, Installment.Status.PARTIAL, Installment.Status.LATE]
    )
    for installment in installments:
        loan = installment.loan
        if loan.status not in ACTIVE_LOAN_STATUSES:
            continue
        if installment.due_date < today:
            was_late = installment.status == Installment.Status.LATE
            outstanding = max(installment.total_due - installment.paid_amount, Decimal("0"))
            if outstanding > 0 and installment.penalty_due == 0:
                installment.penalty_due = money(outstanding * loan.club.penalty_rate / 100)
            installment.status = Installment.Status.LATE
            installment.save(update_fields=["penalty_due", "status", "updated_at"])
            if loan.status != Loan.Status.DISPUTED:
                loan.status = Loan.Status.LATE
                loan.save(update_fields=["status", "updated_at"])
            if not was_late:
                counters["late"] += 1
                notify(loan.borrower, "Echeance en retard", f"L'echeance {installment.number} du pret {loan.reference} est en retard.", "late", {"installment": str(installment.id)})
                if loan.collection_agent_id:
                    notify(loan.collection_agent, "Encaissement en retard", f"L'echeance {installment.number} du pret {loan.reference} est en retard.", "collection", {"loan": str(loan.id)})
        elif installment.due_date == today and installment.status == Installment.Status.UPCOMING:
            installment.status = Installment.Status.DUE
            installment.save(update_fields=["status", "updated_at"])
            counters["due"] += 1
            if loan.collection_agent_id:
                notify(loan.collection_agent, "Encaissement du jour", f"L'echeance {installment.number} du pret {loan.reference} est due aujourd'hui.", "collection", {"loan": str(loan.id)})
        elif 0 < (installment.due_date - today).days <= 3:
            already_sent = Notification.objects.filter(recipient=loan.borrower, kind="due_reminder", data__installment=str(installment.id)).exists()
            if not already_sent:
                notify(loan.borrower, "Echeance prochaine", f"Votre paiement de {installment.total_due} {loan.currency} arrive le {installment.due_date:%d/%m/%Y}.", "due_reminder", {"installment": str(installment.id)})
                counters["reminders"] += 1
    return counters
