import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import {
    ArrowLeft, BadgeCheck, BanknoteArrowDown, CalendarClock, CheckCircle2,
    CircleDollarSign, HandCoins, ReceiptText, TrendingUp, WalletCards,
    UserMinus, UsersRound,
} from "lucide-react-native";

import { Avatar, Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Select, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money, shortDate, shortDateTime, statusLabels } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const activeStatuses = ["current", "late", "disbursed"];
const collectiveManagementStatuses = ["pending_partners", "submitted", "review", ...activeStatuses];

export function LoanDetailScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const { user } = useAuth();
    const dispatch = useDispatch();
    const version = useSelector(state => state.sync.versions.loans);
    const loanId = route.params.loanId;
    const [loan, setLoan] = useState();
    const [payment, setPayment] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentBorrower, setPaymentBorrower] = useState("");
    const [fundingAmount, setFundingAmount] = useState("");
    const [forecast, setForecast] = useState();
    const [scheduleDate, setScheduleDate] = useState("");
    const [agents, setAgents] = useState([]);
    const [agentId, setAgentId] = useState("");
    const [shareAgents, setShareAgents] = useState({});
    const [replacementShare, setReplacementShare] = useState("");
    const [replacementPhone, setReplacementPhone] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState();

    const load = useCallback(() => api(`/loans/${loanId}/`).then(value => {
        setLoan(value);
        setAgentId(value.collection_agent ? String(value.collection_agent) : "");
        setShareAgents(Object.fromEntries((value.borrowers || []).map(item => [item.id, item.collection_agent ? String(item.collection_agent) : ""])));
        const collectible = (value.borrowers || []).filter(item => item.status === "accepted" && item.can_collect);
        setPaymentBorrower(current => current || (collectible.length === 1 ? String(collectible[0].user) : ""));
    }), [loanId]);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => { if (user.role === "admin") api("/users/collectors/").then(response => setAgents(response.results || [])).catch(() => setAgents([])); }, [user.role]);

    const nextInstallment = useMemo(
        () => loan?.installments.find(item => item.status !== "paid"),
        [loan],
    );
    if (!loan) return <LoadingScreen/>;

    const isLender = user.current_profile === "lender" && user.role !== "admin";
    const isAdmin = user.role === "admin";
    const canManage = user.role === "admin" || user.current_profile === "leader";
    const canReviewLoan = (user.current_profile === "leader" && loan.status === "submitted") || (isAdmin && loan.status === "review");
    const canRecordPayment = activeStatuses.includes(loan.status) && loan.can_collect;
    const activeDebts = (loan.borrowers || []).filter(item => item.status === "accepted");
    const activeBorrowerIds = new Set(activeDebts.map(item => String(item.user)));
    const eligibleAgents = agents.filter(item => !activeBorrowerIds.has(String(item.id)));
    const replaceableParticipants = (loan.borrowers || []).filter(item => !item.is_primary && (loan.disbursed_at ? item.status === "accepted" : ["accepted", "pending"].includes(item.status)));
    const collectibleDebts = activeDebts.filter(item => isAdmin || item.can_collect);
    const selectedDebt = activeDebts.find(item => String(item.user) === String(paymentBorrower));
    const isInitiator = String(user.id) === String(loan.borrower);
    const canFund = isLender && loan.can_fund && loan.status === "approved" && Number(loan.funding_open_amount) > 0;
    const fundingBlockMessage = !isLender || canFund ? ""
        : loan.status !== "approved" ? "Ce pret n'est pas ouvert au financement."
        : Number(loan.funding_open_amount || 0) <= 0 ? "Le besoin de financement est deja entierement couvert."
        : !user.kyc_verified ? "Votre KYC doit etre valide avant tout placement."
        : user.lender_profile_status !== "active" ? "Votre profil preteur global doit etre actif."
        : Number(loan.my_available_capital || 0) <= 0 ? "Votre fonds disponible est insuffisant. Effectuez d'abord une mise validee."
        : "Votre profil ne remplit pas encore les conditions de placement.";
    const myFunding = loan.my_funding;
    const visibleSchedule = isLender ? (myFunding?.schedule || []) : loan.installments;
    const heroBalance = isLender && myFunding ? myFunding.remaining_return : loan.balance;

    async function command(path, body, successMessage) {
        setLoading(true);
        try {
            const result = await api(`/loans/${loan.id}/${path}/`, { method: "POST", body: JSON.stringify(body || {}) });
            if (path === "disburse") setLoan(result);
            dispatch(invalidate(["loans", "dashboard", "validations", "clubs", "notifications", "members"]));
            if (path !== "disburse") await load();
            Alert.alert("Operation reussie", successMessage);
        } catch (error) {
            Alert.alert("Operation impossible", error.message);
        } finally {
            setLoading(false);
        }
    }

    function approve() {
        Alert.alert("Valider ce pret ?", `Montant demande : ${money(loan.amount, loan.currency)}.`, [
            { text: "Annuler", style: "cancel" },
            { text: "Valider", onPress: () => command("decide", { approve: true }, isAdmin ? "Le pret est maintenant ouvert a tous les preteurs." : "Votre accord est enregistre. Le pret attend la validation finale de l'administrateur.") },
        ]);
    }

    async function pay() {
        const amount = Number(payment);
        const maximum = loan.is_collective ? Number(selectedDebt?.balance || 0) : Number(loan.balance);
        if (loan.is_collective && !selectedDebt) return Alert.alert("Co-emprunteur requis", "Selectionnez la dette qui recoit ce paiement.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
            Alert.alert("Montant invalide", `Saisissez un montant entre 1 et ${money(maximum, loan.currency)}.`);
            return;
        }
        const label = loan.can_collect ? "Le remboursement a ete encaisse et affecte aux echeances." : "Votre versement a ete affecte aux echeances les plus proches.";
        await command("record-payment", { amount: payment, payment_method: paymentMethod, ...(loan.is_collective ? { borrower: paymentBorrower } : {}) }, label);
        setPayment("");
    }

    async function assignShareAgent(share) {
        await command("assign-borrower-agent", { loan_borrower: share.id, agent: shareAgents[share.id] || null }, "Le mandat individuel a ete mis a jour.");
    }

    async function disburseNow() {
        setLoading(true);
        try {
            const body = loan.is_collective
                ? { borrower_agents: activeDebts.map(share => ({ loan_borrower: share.id, agent: shareAgents[share.id] || null })) }
                : { agent: agentId || null };
            const updated = await api(`/loans/${loan.id}/disburse/`, { method: "POST", body: JSON.stringify(body) });
            setLoan(updated);
            dispatch(invalidate(["loans", "dashboard", "validations", "clubs", "notifications", "collections"]));
            setResult({
                success: true,
                title: "Pret decaisse",
                message: loan.is_collective ? "Les dettes individuelles et leurs mandats d'encaissement sont maintenant actifs." : "Le pret et son echeancier sont maintenant actifs.",
                detail: `Decaissement enregistre immediatement pour ${money(loan.amount, loan.currency)}.`,
            });
        } catch (error) {
            await load().catch(() => {});
            setResult({ success: false, title: "Decaissement impossible", message: error.message, detail: "Aucun decaissement ni mandat n'a ete enregistre." });
        } finally {
            setLoading(false);
        }
    }

    async function replaceBorrower() {
        const normalizedPhone = replacementPhone.replace(/\D/g, "");
        if (!replacementShare || normalizedPhone.length < 9) return Alert.alert("Informations incompletes", "Selectionnez un participant et saisissez le numero de son remplacant.");
        const existingParticipant = (loan.borrowers || []).find(item => String(item.user_detail?.phone || "").replace(/\D/g, "").endsWith(normalizedPhone.slice(-9)));
        if (existingParticipant) return Alert.alert("Participant deja present", `${existingParticipant.name} figure deja dans cet emprunt collectif. Choisissez une autre personne.`);
        setLoading(true);
        try {
            const response = await api(`/loans/${loan.id}/replace-borrower/`, { method: "POST", body: JSON.stringify({ loan_borrower: replacementShare, phone: replacementPhone }) });
            setLoan(response.loan);
            setReplacementShare(""); setReplacementPhone("");
            dispatch(invalidate(["loans", "dashboard", "notifications", "validations"]));
            setResult({
                success: true,
                title: "Remplacement propose",
                message: loan.disbursed_at
                    ? "L'ancien participant est notifie et reste responsable de son solde jusqu'a l'acceptation du remplacant."
                    : "L'ancien participant et le nouveau ont ete notifies. La demande reprendra son cycle de validation apres l'acceptation du remplacant.",
            });
        } catch (error) {
            setResult({ success: false, title: "Remplacement impossible", message: error.message });
        } finally { setLoading(false); }
    }

    async function simulateFunding() {
        const numericAmount = Number(fundingAmount);
        const maximum = Math.min(Number(loan.funding_open_amount || 0), Number(loan.my_available_capital || 0));
        if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > maximum) {
            return Alert.alert("Montant invalide", `Le maximum placable maintenant est de ${money(maximum, loan.currency)}.`);
        }
        try {
            setForecast(await api(`/loans/${loan.id}/funding-forecast/?amount=${fundingAmount}`));
        } catch (error) {
            Alert.alert("Simulation impossible", error.message);
        }
    }

    async function fund() {
        if (!forecast) return;
        setLoading(true);
        try {
            const response = await api(`/loans/${loan.id}/fund/`, { method: "POST", body: JSON.stringify({ amount: fundingAmount }) });
            setLoan(response.loan);
            dispatch(invalidate(["loans", "dashboard", "validations", "notifications"]));
            setFundingAmount("");
            setForecast(undefined);
            setResult({ success: true, title: "Placement reserve", message: response.message, detail: "Le montant est deja retire de votre fonds disponible. Il financera le pret apres validation administrative." });
        } catch (error) {
            setResult({ success: false, title: "Placement impossible", message: error.message, detail: "Aucun montant n'a ete reserve." });
        } finally {
            setLoading(false);
        }
    }

    return <Screen>
      <PageHeader eyebrow={loan.reference} title={loan.purpose} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>

      <View style={styles.hero}>
        <View style={styles.heroTop}><Text style={styles.heroLabel}>{isLender && myFunding ? "Mon retour restant" : "Solde restant"}</Text><Status value={loan.status}/></View>
        <Text style={styles.heroValue}>{money(heroBalance, loan.currency)}</Text>
        <View style={styles.heroMeta}>
          <Text style={styles.heroMetaText}>{isLender && myFunding ? `Place ${money(myFunding.amount, loan.currency)}` : `Emprunte ${money(loan.amount, loan.currency)}`}</Text>
          <Text style={styles.heroMetaText}>{loan.duration_months} mois</Text>
        </View>
      </View>
      {canManage && loan.borrower_credit_score ? <View style={styles.creditBand}><Avatar user={{ name: loan.borrower_name, avatar: loan.borrower_avatar, selfie: loan.borrower_selfie }} size={48}/><View style={styles.creditCopy}><Text style={styles.creditName}>{loan.borrower_name}</Text><Text style={styles.creditLabel}>Risque emprunteur</Text><Text style={styles.creditValue}>{loan.borrower_credit_score.score}/100</Text><Text style={styles.creditLevel}>{loan.borrower_credit_score.level}</Text></View><View style={styles.creditAdmin}><Text style={styles.creditLabel}>Note admin</Text><Text style={styles.creditAdminValue}>{loan.borrower_admin_rating || "-"}/10</Text></View></View> : null}

      {isLender ? <View style={styles.metrics}>
        <Metric label="Capital disponible" value={money(loan.my_available_capital || 0, loan.currency)} icon={WalletCards}/>
        <Metric label="Deja place ici" value={money(myFunding?.amount || 0, loan.currency)} icon={HandCoins}/>
      </View> : null}

      {loan.status === "approved" && loan.funded_amount !== null ? <View style={styles.fundingProgress}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Financement collectif</Text><Text style={styles.progressValue}>{Math.round(Number(loan.funded_amount) / Math.max(Number(loan.amount), 1) * 100)} %</Text></View>
        <Progress value={Number(loan.funded_amount)} total={Number(loan.amount)}/>
        <Text style={styles.progressMeta}>{money(loan.funded_amount, loan.currency)} reunis - {money(loan.funding_remaining, loan.currency)} restants</Text>
        {loan.scheduled_disbursement_date ? <Text style={styles.scheduleText}>Decaissement prevu le {shortDate(loan.scheduled_disbursement_date)}</Text> : null}
      </View> : null}

      {canReviewLoan ? <Button label={isAdmin ? "Valider et ouvrir au financement" : "Donner mon accord de chef"} icon={BadgeCheck} onPress={approve} loading={loading}/> : null}

      {isAdmin && loan.status === "approved" && Number(loan.funding_remaining) === 0 ? <View style={styles.tool}>
        <Text style={styles.sectionTitle}>Decaissement</Text>
        <Text style={styles.note}>Le financement est complet. Le decaissement enregistre immediatement la date et l'heure actuelles, puis active les modalites et l'echeancier.</Text>
        {loan.is_collective ? <View style={styles.disbursementAgents}>
          <Text style={styles.assignmentTitle}>Mandataires par co-emprunteur</Text>
          <Text style={styles.note}>Choisissez la personne qui encaissera chaque dette. Sans mandataire, l'administration reste responsable de l'encaissement.</Text>
          {activeDebts.map(share => <View key={share.id} style={styles.assignmentRow}><View style={styles.assignmentPerson}><Avatar user={share.user_detail || { name: share.name }} size={38}/><View style={styles.assignmentCopy}><Text style={styles.debtName}>{share.name}</Text><Text style={styles.debtMeta}>Part {money(share.share_amount, loan.currency)}</Text></View></View><Select label="Mandataire" value={shareAgents[share.id] || ""} searchable options={[{ value: "", label: "Administration" }, ...eligibleAgents.map(item => ({ value: item.id, label: `${item.name} - ${item.phone}` }))]} onChange={value => setShareAgents(current => ({ ...current, [share.id]: value }))}/></View>)}
        </View> : <Select label="Mandataire d'encaissement (facultatif)" value={agentId} searchable options={[{ value: "", label: "Aucun - encaissement par l'admin" }, ...eligibleAgents.filter(item => String(item.id) !== String(loan.borrower)).map(item => ({ value: item.id, label: `${item.name} - ${item.phone}` }))]} onChange={setAgentId}/>}
        <Field label="Date programmee AAAA-MM-JJ" value={scheduleDate} onChangeText={setScheduleDate} placeholder="2026-08-15"/>
        <Button label="Programmer la date" icon={CalendarClock} variant="secondary" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)} onPress={() => command("schedule", { date: scheduleDate }, "La date est communiquee aux parties.")}/>
        <Button label="Decaisser maintenant" icon={BanknoteArrowDown} onPress={disburseNow} loading={loading}/>
      </View> : null}

      {loan.disbursed_at ? <View style={styles.disbursementBand}><View style={styles.disbursementIcon}><BanknoteArrowDown size={20} color={colors.white}/></View><View style={styles.disbursementCopy}><Text style={styles.disbursementLabel}>Decaissement effectue</Text><Text style={styles.disbursementDate}>{shortDateTime(loan.disbursed_at)} (heure de Kinshasa)</Text><Text style={styles.disbursementHint}>Les echeances sont actives a partir de cette date.</Text></View></View> : null}
      {loan.is_collective && (isAdmin || canManage || isInitiator) ? <View style={styles.debts}>
        <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>{loan.disbursed_at ? "Dettes individuelles" : "Gestion des participants"}</Text><Text style={styles.debtSubtitle}>{loan.disbursed_at ? "Chaque personne paie son propre solde et suit ses propres echeances." : "Suivez les accords, les parts proposees et remplacez un participant avant la validation."}</Text></View><UsersRound size={21} color={colors.forest}/></View>
        {(loan.borrowers || []).map(share => {
            const next = (share.installments || []).find(item => !["paid", "transferred"].includes(item.status));
            return <View key={share.id} style={[styles.debtCard, share.status === "removed" && styles.debtRemoved]}>
              <View style={styles.debtTop}><Avatar user={share.user_detail || { name: share.name }} size={42}/><View style={styles.debtCopy}><Text style={styles.debtName}>{share.name}{share.is_primary ? " - Initiateur" : ""}</Text><Text style={styles.debtMeta}>{share.status === "removed" ? "Part entierement transferee" : `Part ${money(share.share_amount, loan.currency)}`}</Text><Status value={share.status}/></View><View style={styles.debtEnd}><Text style={styles.debtBalance}>{money(share.status === "removed" ? 0 : loan.disbursed_at ? share.balance : share.share_amount, loan.currency)}</Text><Text style={styles.debtMeta}>{share.status === "removed" ? "aucun montant actif" : loan.disbursed_at ? "reste a payer" : "part attribuee"}</Text></View></View>
              {loan.disbursed_at ? <><Progress value={Number(share.total_paid)} total={Number(share.total_due)}/><View style={styles.debtFoot}><Text style={styles.debtFootText}>{share.overdue_count ? `${share.overdue_count} echeance(s) en retard` : next ? `Prochaine le ${shortDate(next.due_date)}` : "Dette soldee"}</Text><Text style={styles.debtFootText}>{share.collection_agent_name || "Encaissement admin"}</Text></View></> : <Text style={styles.participantHint}>{share.status === "pending" ? "En attente de la reponse de ce participant." : share.status === "accepted" ? "Participation confirmee." : share.status === "removed" ? "Ce participant a ete remplace et conserve son historique." : "Participation refusee."}</Text>}
              {isAdmin && loan.disbursed_at && share.status === "accepted" ? <View style={styles.debtAgent}><Select label={`Mandataire de ${share.name}`} value={shareAgents[share.id] || ""} searchable options={[{ value: "", label: "Administration" }, ...agents.map(item => ({ value: item.id, label: `${item.name} - ${item.phone}` }))]} onChange={value => setShareAgents(current => ({ ...current, [share.id]: value }))}/><Button label="Enregistrer ce mandat" variant="secondary" icon={BadgeCheck} onPress={() => assignShareAgent(share)}/></View> : null}
            </View>;
        })}
        {isInitiator && collectiveManagementStatuses.includes(loan.status) && replaceableParticipants.length ? <View style={styles.replaceTool}><Text style={styles.debtName}>Changer un participant</Text><Text style={styles.note}>{loan.disbursed_at ? "Le solde et les prochaines echeances seront transferes seulement apres l'accord du nouveau participant. Les paiements deja effectues restent dans l'historique du sortant." : "L'ancien participant sera informe immediatement. Il reste rattache a la demande jusqu'a ce que le nouveau participant accepte sa part."}</Text><Select label="Participant a remplacer" value={replacementShare} searchable options={replaceableParticipants.map(item => ({ value: item.id, label: `${item.name} - part ${money(item.share_amount, loan.currency)}` }))} onChange={setReplacementShare}/><Field label="Numero du nouveau participant" value={replacementPhone} onChangeText={setReplacementPhone} keyboardType="phone-pad" placeholder="+243..."/><Button label="Envoyer la demande de remplacement" icon={UserMinus} loading={loading} onPress={replaceBorrower}/></View> : null}
      </View> : null}
      {isAdmin && !loan.is_collective && loan.disbursed_at && activeStatuses.includes(loan.status) ? <View style={styles.tool}><Text style={styles.sectionTitle}>Mandataire d'encaissement</Text><Text style={styles.note}>{loan.collection_agent_name ? `${loan.collection_agent_name} peut encaisser ce pret.` : "Aucun mandataire: les encaissements restent reserves a l'administration."}</Text><Select label="Compte mandataire" value={agentId} searchable options={[{ value: "", label: "Aucun - administration" }, ...agents.map(item => ({ value: item.id, label: `${item.name} - ${item.phone}` }))]} onChange={setAgentId}/><Button label="Enregistrer le mandat" icon={BadgeCheck} variant="secondary" onPress={() => command("assign-agent", { agent: agentId || null }, agentId ? "Le mandataire a ete notifie." : "Le mandat a ete retire.")}/></View> : null}

      {myFunding ? <View style={styles.position}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Mon placement</Text><TrendingUp size={20} color={colors.mintDark}/></View>
        <DataRow label="Capital place" value={money(myFunding.amount, loan.currency)}/>
        {Number(myFunding.pending_amount) > 0 ? <DataRow label="En attente de validation" value={money(myFunding.pending_amount, loan.currency)} strong/> : null}
        <DataRow label="Gain prevu" value={money(myFunding.expected_gain, loan.currency)}/>
        <DataRow label="Total attendu" value={money(myFunding.expected_total, loan.currency)} strong/>
        <DataRow label="Deja recu" value={money(myFunding.total_received, loan.currency)}/>
      </View> : null}

      {canFund ? <View style={styles.tool}>
        <Text style={styles.sectionTitle}>{myFunding ? "Augmenter mon placement" : "Participer au financement"}</Text>
        <Text style={styles.note}>Le montant confirme est immediatement reserve et retire de votre capital disponible.</Text>
        <Field label="Montant de ma participation" value={fundingAmount} onChangeText={value => { setFundingAmount(value.replace(/[^0-9.]/g, "")); setForecast(undefined); }} keyboardType="decimal-pad" placeholder={`Maximum ouvert ${money(Math.min(Number(loan.funding_open_amount), Number(loan.my_available_capital || 0)), loan.currency)}`}/>
        <Button label="Calculer ma prevision" icon={TrendingUp} variant="secondary" onPress={simulateFunding}/>
        {forecast ? <View style={styles.forecast}>
          <DataRow label="Montant apporte" value={money(forecast.invested, forecast.currency)}/>
          <DataRow label="Gain estime" value={money(forecast.expected_gain, forecast.currency)}/>
          <DataRow label="Total attendu" value={money(forecast.expected_total, forecast.currency)} strong/>
          <DataRow label={`Retour par echeance (${forecast.frequency_label})`} value={money(forecast.estimated_periodic_return, forecast.currency)}/>
          <DataRow label="Premiere echeance" value={shortDate(forecast.first_due_date)}/>
          <DataRow label="Derniere echeance" value={shortDate(forecast.last_due_date)}/>
          <Button label="Confirmer ma participation" icon={HandCoins} onPress={fund} loading={loading}/>
        </View> : null}
      </View> : null}
      {fundingBlockMessage ? <View style={styles.fundingBlocked}><Text style={styles.fundingBlockedTitle}>Placement indisponible</Text><Text style={styles.fundingBlockedText}>{fundingBlockMessage}</Text></View> : null}

      {activeStatuses.includes(loan.status) || loan.status === "repaid" ? <View style={styles.terms}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Modalites de remboursement</Text><ReceiptText size={20} color={colors.forest}/></View>
        <Text style={styles.termsText}>Les versements sont libres : quotidiens, hebdomadaires ou ponctuels. Le cumul verse doit atteindre le montant de chaque echeance au plus tard a sa date.</Text>
        {!isLender && nextInstallment ? <>
          <DataRow label="Prochaine date" value={shortDate(nextInstallment.due_date)}/>
          <DataRow label="Exige pour cette echeance" value={money(nextInstallment.total_due, loan.currency)}/>
          <DataRow label="Deja verse" value={money(nextInstallment.paid_amount, loan.currency)}/>
          <Progress value={Number(nextInstallment.paid_amount)} total={Number(nextInstallment.total_due)}/>
        </> : null}
      </View> : null}

      {canRecordPayment ? <View style={styles.tool}>
        <Text style={styles.sectionTitle}>{loan.can_collect ? "Encaisser un remboursement" : "Effectuer un remboursement"}</Text>
        <Text style={styles.note}>Le montant sera impute automatiquement sur l'echeance la plus proche, puis sur les suivantes si elle est deja couverte.</Text>
        {loan.is_collective ? <Select label="Dette a encaisser" value={paymentBorrower} searchable options={collectibleDebts.map(item => ({ value: String(item.user), label: `${item.name} - solde ${money(item.balance, loan.currency)}` }))} onChange={setPaymentBorrower}/> : null}
        <View style={styles.methods}>{[{ id: "cash", label: "Especes" }, { id: "mobile_money", label: "Mobile Money" }].map(item => <Pressable key={item.id} onPress={() => setPaymentMethod(item.id)} style={[styles.method, paymentMethod === item.id && styles.methodActive]}><Text style={[styles.methodText, paymentMethod === item.id && styles.methodTextActive]}>{item.label}</Text></Pressable>)}</View>
        <Field label="Montant recu" value={payment} onChangeText={value => setPayment(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder={`Maximum ${money(loan.is_collective ? selectedDebt?.balance || 0 : loan.balance, loan.currency)}`}/>
        <Button label={loan.can_collect ? "Encaisser le retour" : "Payer maintenant"} icon={CircleDollarSign} onPress={pay} loading={loading}/>
      </View> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{isLender ? "Mon calendrier de retour" : "Echeancier"}</Text>
        <Text style={styles.sectionMeta}>{visibleSchedule.length} echeance{visibleSchedule.length > 1 ? "s" : ""}</Text>
      </View>
      {visibleSchedule.length ? <View style={styles.installments}>{visibleSchedule.map(item => <InstallmentRow key={`${item.id || "mine"}-${item.number}`} item={item} currency={loan.currency} lender={isLender}/>)}</View> : <View style={styles.pending}><CalendarClock size={21} color={colors.mintDark}/><Text style={styles.pendingText}>L'echeancier final sera genere au decaissement.</Text></View>}

      {!isLender && loan.repayments?.length ? <View style={styles.history}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Paiements encaisses</Text><Text style={styles.sectionMeta}>{loan.repayments.length}</Text></View>
        {loan.repayments.map(item => <View key={item.id} style={styles.historyRow}><View><Text style={styles.historyAmount}>{money(item.amount, loan.currency)}</Text><Text style={styles.historyMeta}>{shortDate(item.created_at)} - {item.payment_method === "cash" ? "Especes" : "Mobile Money"}</Text></View><CheckCircle2 size={19} color={colors.mintDark}/></View>)}
      </View> : null}
      <OperationResultModal result={result} onClose={() => setResult(undefined)}/>
    </Screen>;
}

function Metric({ label, value, icon: Icon }) {
    return <View style={styles.metric}><Icon size={18} color={colors.mintDark}/><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function DataRow({ label, value, strong }) {
    return <View style={styles.dataRow}><Text style={styles.dataLabel}>{label}</Text><Text style={[styles.dataValue, strong && styles.dataStrong]}>{value}</Text></View>;
}

function Progress({ value, total }) {
    const percent = Math.min(100, Math.max(0, value / Math.max(total, 1) * 100));
    return <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]}/></View>;
}

function InstallmentRow({ item, currency, lender }) {
    const total = lender ? item.expected : item.total_due;
    const paid = lender ? item.received : item.paid_amount;
    const remaining = lender ? item.remaining : item.remaining_due;
    return <View style={styles.installment}>
      <View style={[styles.number, item.status === "paid" && styles.numberPaid]}>{item.status === "paid" ? <CheckCircle2 size={17} color={colors.forest}/> : <Text style={styles.numberText}>{item.number}</Text>}</View>
      <View style={styles.installmentText}><Text style={styles.installmentDate}>{shortDate(item.due_date)}</Text><Text style={styles.installmentStatus}>{statusLabels[item.status] || item.status}</Text><Text style={styles.installmentProgress}>{money(paid, currency)} recu - {money(remaining, currency)} restant</Text></View>
      <Text style={styles.installmentAmount}>{money(total, currency)}</Text>
    </View>;
}

const styles = StyleSheet.create({
    hero: { minHeight: 150, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest, justifyContent: "space-between" },
    heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, heroLabel: { fontFamily: font.medium, color: colors.mint, fontSize: 11 }, heroValue: { fontFamily: font.bold, color: colors.white, fontSize: 30 },
    heroMeta: { flexDirection: "row", justifyContent: "space-between" }, heroMetaText: { fontFamily: font.medium, color: colors.mint, fontSize: 10 },
    creditBand: { minHeight: 96, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.sky }, creditCopy: { flex: 1 }, creditName: { marginBottom: 4, fontFamily: font.bold, color: colors.ink, fontSize: 11 }, creditLabel: { fontFamily: font.medium, color: colors.skyDark, fontSize: 9 }, creditValue: { marginTop: 3, fontFamily: font.bold, color: colors.ink, fontSize: 22 }, creditLevel: { marginTop: 2, fontFamily: font.semibold, color: colors.forest, fontSize: 9 }, creditAdmin: { alignItems: "flex-end" }, creditAdminValue: { marginTop: 4, fontFamily: font.bold, color: colors.coral, fontSize: 17 }, metrics: { flexDirection: "row", gap: spacing.sm }, metric: { flex: 1, minHeight: 104, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, justifyContent: "space-between" }, metricLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 9 }, metricValue: { fontFamily: font.bold, color: colors.ink, fontSize: 14 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }, sectionTitle: { flexShrink: 1, fontFamily: font.bold, color: colors.ink, fontSize: 17 }, sectionMeta: { fontFamily: font.medium, color: colors.muted, fontSize: 11 },
    tool: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, note: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 },
    disbursementAgents: { gap: spacing.md }, assignmentTitle: { fontFamily: font.bold, color: colors.forest, fontSize: 13 }, assignmentRow: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.paper }, assignmentPerson: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, assignmentCopy: { flex: 1 },
    disbursementBand: { minHeight: 86, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, disbursementIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, disbursementCopy: { flex: 1 }, disbursementLabel: { fontFamily: font.bold, color: colors.white, fontSize: 12 }, disbursementDate: { marginTop: 3, fontFamily: font.bold, color: colors.mint, fontSize: 11 }, disbursementHint: { marginTop: 3, fontFamily: font.medium, color: colors.mint, fontSize: 9 },
    debts: { gap: spacing.md }, debtSubtitle: { marginTop: 3, maxWidth: 285, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14 }, debtCard: { gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white }, debtRemoved: { opacity: 0.62, backgroundColor: colors.paper }, debtTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, debtCopy: { flex: 1, alignItems: "flex-start", gap: 4 }, debtName: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, debtMeta: { fontFamily: font.medium, color: colors.muted, fontSize: 8 }, debtEnd: { alignItems: "flex-end" }, debtBalance: { fontFamily: font.bold, color: colors.coral, fontSize: 13 }, participantHint: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, fontFamily: font.medium, color: colors.forest, fontSize: 9, lineHeight: 15 }, debtFoot: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, debtFootText: { flex: 1, fontFamily: font.semibold, color: colors.forest, fontSize: 8 }, debtAgent: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }, replaceTool: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint },
    fundingProgress: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sky }, progressValue: { fontFamily: font.bold, color: colors.skyDark, fontSize: 14 }, progressTrack: { height: 9, borderRadius: 5, overflow: "hidden", backgroundColor: colors.line }, progressFill: { height: 9, backgroundColor: colors.coral }, progressMeta: { fontFamily: font.medium, color: colors.skyDark, fontSize: 10 }, scheduleText: { fontFamily: font.bold, color: colors.forest, fontSize: 10 },
    position: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.mint }, forecast: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint },
    fundingBlocked: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.coral, backgroundColor: colors.coralSoft }, fundingBlockedTitle: { fontFamily: font.bold, color: colors.danger, fontSize: 12 }, fundingBlockedText: { fontFamily: font.medium, color: colors.danger, fontSize: 10, lineHeight: 16 },
    dataRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, dataLabel: { flex: 1, fontFamily: font.medium, color: colors.muted, fontSize: 10 }, dataValue: { fontFamily: font.bold, color: colors.ink, fontSize: 11, textAlign: "right" }, dataStrong: { color: colors.forest, fontSize: 13 },
    terms: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.mint }, termsText: { fontFamily: font.medium, color: colors.forest, fontSize: 11, lineHeight: 18 },
    methods: { flexDirection: "row", gap: spacing.sm }, method: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }, methodActive: { borderColor: colors.forest, backgroundColor: colors.mint }, methodText: { fontFamily: font.semibold, color: colors.muted, fontSize: 11 }, methodTextActive: { fontFamily: font.bold, color: colors.forest },
    installments: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, overflow: "hidden" }, installment: { minHeight: 82, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, number: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }, numberPaid: { backgroundColor: colors.mint }, numberText: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, installmentText: { flex: 1 }, installmentDate: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, installmentStatus: { fontFamily: font.medium, color: colors.muted, fontSize: 8, marginTop: 2, textTransform: "uppercase" }, installmentProgress: { fontFamily: font.medium, color: colors.mintDark, fontSize: 8, marginTop: 3 }, installmentAmount: { maxWidth: 100, fontFamily: font.bold, color: colors.ink, fontSize: 11, textAlign: "right" },
    pending: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, pendingText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 11, lineHeight: 17 },
    history: { gap: spacing.sm }, historyRow: { minHeight: 58, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, historyAmount: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, historyMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 },
});
