import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import {
    ArrowLeft, BadgeCheck, BanknoteArrowDown, CalendarClock, CheckCircle2,
    CircleDollarSign, HandCoins, ReceiptText, TrendingUp, WalletCards,
} from "lucide-react-native";

import { Avatar, Button, Field, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money, shortDate, shortDateTime, statusLabels } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const activeStatuses = ["current", "late", "disbursed"];

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
    const [fundingAmount, setFundingAmount] = useState("");
    const [forecast, setForecast] = useState();
    const [scheduleDate, setScheduleDate] = useState("");
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => api(`/loans/${loanId}/`).then(setLoan), [loanId]);
    useEffect(() => { load(); }, [load, version]);

    const nextInstallment = useMemo(
        () => loan?.installments.find(item => item.status !== "paid"),
        [loan],
    );
    if (!loan) return <LoadingScreen/>;

    const isLender = user.current_profile === "lender" && user.role !== "admin";
    const isBorrower = user.current_profile === "borrower" && loan.borrower === user.id;
    const canManage = user.role === "admin" || user.current_profile === "leader";
    const canRecordPayment = activeStatuses.includes(loan.status) && user.role === "admin";
    const canFund = isLender && loan.can_fund && loan.status === "approved" && Number(loan.funding_remaining) > 0;
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
            { text: "Valider", onPress: () => command("decide", { approve: true }, "Le pret est ouvert aux preteurs du club.") },
        ]);
    }

    async function pay() {
        const amount = Number(payment);
        if (!Number.isFinite(amount) || amount <= 0 || amount > Number(loan.balance)) {
            Alert.alert("Montant invalide", `Saisissez un montant entre 1 et ${money(loan.balance, loan.currency)}.`);
            return;
        }
        const label = canManage ? "Le remboursement a ete encaisse et affecte aux echeances." : "Votre versement a ete affecte aux echeances les plus proches.";
        await command("record-payment", { amount: payment, payment_method: paymentMethod }, label);
        setPayment("");
    }

    async function simulateFunding() {
        if (!fundingAmount) return;
        try {
            setForecast(await api(`/loans/${loan.id}/funding-forecast/?amount=${fundingAmount}`));
        } catch (error) {
            Alert.alert("Simulation impossible", error.message);
        }
    }

    async function fund() {
        if (!forecast) return;
        await command("fund", { amount: fundingAmount }, "Votre capital disponible et votre prevision ont ete mis a jour.");
        setFundingAmount("");
        setForecast(undefined);
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

      {loan.status === "approved" ? <View style={styles.fundingProgress}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Financement collectif</Text><Text style={styles.progressValue}>{Math.round(Number(loan.funded_amount) / Math.max(Number(loan.amount), 1) * 100)} %</Text></View>
        <Progress value={Number(loan.funded_amount)} total={Number(loan.amount)}/>
        <Text style={styles.progressMeta}>{money(loan.funded_amount, loan.currency)} reunis - {money(loan.funding_remaining, loan.currency)} restants</Text>
        {loan.scheduled_disbursement_date ? <Text style={styles.scheduleText}>Decaissement prevu le {shortDate(loan.scheduled_disbursement_date)}</Text> : null}
      </View> : null}

      {canManage && ["submitted", "review"].includes(loan.status) ? <Button label="Valider et ouvrir au financement" icon={BadgeCheck} onPress={approve} loading={loading}/> : null}

      {canManage && loan.status === "approved" && Number(loan.funding_remaining) === 0 ? <View style={styles.tool}>
        <Text style={styles.sectionTitle}>Decaissement</Text>
        <Text style={styles.note}>Le financement est complet. « Decaisser maintenant » enregistre immediatement la date et l'heure actuelles, puis active les modalites et l'echeancier.</Text>
        <Field label="Date programmee AAAA-MM-JJ" value={scheduleDate} onChangeText={setScheduleDate} placeholder="2026-08-15"/>
        <Button label="Programmer la date" icon={CalendarClock} variant="secondary" onPress={() => command("schedule", { date: scheduleDate }, "La date est communiquee aux parties.")}/>
        <Button label="Decaisser maintenant" icon={BanknoteArrowDown} onPress={() => command("disburse", {}, "Le pret est decaisse et l'echeancier est cree.")} loading={loading}/>
      </View> : null}

      {loan.disbursed_at ? <View style={styles.disbursementBand}><View style={styles.disbursementIcon}><BanknoteArrowDown size={20} color={colors.white}/></View><View style={styles.disbursementCopy}><Text style={styles.disbursementLabel}>Decaissement effectue</Text><Text style={styles.disbursementDate}>{shortDateTime(loan.disbursed_at)} (heure de Kinshasa)</Text><Text style={styles.disbursementHint}>Les echeances sont actives a partir de cette date.</Text></View></View> : null}

      {myFunding ? <View style={styles.position}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Mon placement</Text><TrendingUp size={20} color={colors.mintDark}/></View>
        <DataRow label="Capital place" value={money(myFunding.amount, loan.currency)}/>
        <DataRow label="Gain prevu" value={money(myFunding.expected_gain, loan.currency)}/>
        <DataRow label="Total attendu" value={money(myFunding.expected_total, loan.currency)} strong/>
        <DataRow label="Deja recu" value={money(myFunding.total_received, loan.currency)}/>
      </View> : null}

      {canFund ? <View style={styles.tool}>
        <Text style={styles.sectionTitle}>{myFunding ? "Augmenter mon placement" : "Participer au financement"}</Text>
        <Text style={styles.note}>Le montant confirme est immediatement reserve et retire de votre capital disponible.</Text>
        <Field label="Montant a investir" value={fundingAmount} onChangeText={value => { setFundingAmount(value.replace(/[^0-9.]/g, "")); setForecast(undefined); }} keyboardType="decimal-pad" placeholder={`Besoin restant ${money(loan.funding_remaining, loan.currency)}`}/>
        <Button label="Calculer ma prevision" icon={TrendingUp} variant="secondary" onPress={simulateFunding}/>
        {forecast ? <View style={styles.forecast}>
          <DataRow label="Capital investi" value={money(forecast.invested, forecast.currency)}/>
          <DataRow label="Gain estime" value={money(forecast.expected_gain, forecast.currency)}/>
          <DataRow label="Total attendu" value={money(forecast.expected_total, forecast.currency)} strong/>
          <DataRow label="Retour mensuel estime" value={money(forecast.estimated_monthly_return, forecast.currency)}/>
          <DataRow label="Premiere echeance" value={shortDate(forecast.first_due_date)}/>
          <DataRow label="Derniere echeance" value={shortDate(forecast.last_due_date)}/>
          <Button label="Confirmer ma participation" icon={HandCoins} onPress={fund} loading={loading}/>
        </View> : null}
      </View> : null}

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
        <Text style={styles.sectionTitle}>{canManage ? "Encaisser un remboursement" : "Effectuer un remboursement"}</Text>
        <Text style={styles.note}>Le montant sera impute automatiquement sur l'echeance la plus proche, puis sur les suivantes si elle est deja couverte.</Text>
        <View style={styles.methods}>{[{ id: "cash", label: "Especes" }, { id: "mobile_money", label: "Mobile Money" }].map(item => <Pressable key={item.id} onPress={() => setPaymentMethod(item.id)} style={[styles.method, paymentMethod === item.id && styles.methodActive]}><Text style={[styles.methodText, paymentMethod === item.id && styles.methodTextActive]}>{item.label}</Text></Pressable>)}</View>
        <Field label="Montant recu" value={payment} onChangeText={value => setPayment(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder={`Maximum ${money(loan.balance, loan.currency)}`}/>
        <Button label={canManage ? "Encaisser le retour" : "Payer maintenant"} icon={CircleDollarSign} onPress={pay} loading={loading}/>
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
    disbursementBand: { minHeight: 86, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, disbursementIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, disbursementCopy: { flex: 1 }, disbursementLabel: { fontFamily: font.bold, color: colors.white, fontSize: 12 }, disbursementDate: { marginTop: 3, fontFamily: font.bold, color: colors.mint, fontSize: 11 }, disbursementHint: { marginTop: 3, fontFamily: font.medium, color: colors.mint, fontSize: 9 },
    fundingProgress: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sky }, progressValue: { fontFamily: font.bold, color: colors.skyDark, fontSize: 14 }, progressTrack: { height: 9, borderRadius: 5, overflow: "hidden", backgroundColor: colors.line }, progressFill: { height: 9, backgroundColor: colors.coral }, progressMeta: { fontFamily: font.medium, color: colors.skyDark, fontSize: 10 }, scheduleText: { fontFamily: font.bold, color: colors.forest, fontSize: 10 },
    position: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.mint }, forecast: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint },
    dataRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, dataLabel: { flex: 1, fontFamily: font.medium, color: colors.muted, fontSize: 10 }, dataValue: { fontFamily: font.bold, color: colors.ink, fontSize: 11, textAlign: "right" }, dataStrong: { color: colors.forest, fontSize: 13 },
    terms: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.mint }, termsText: { fontFamily: font.medium, color: colors.forest, fontSize: 11, lineHeight: 18 },
    methods: { flexDirection: "row", gap: spacing.sm }, method: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }, methodActive: { borderColor: colors.forest, backgroundColor: colors.mint }, methodText: { fontFamily: font.semibold, color: colors.muted, fontSize: 11 }, methodTextActive: { fontFamily: font.bold, color: colors.forest },
    installments: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, overflow: "hidden" }, installment: { minHeight: 82, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, number: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }, numberPaid: { backgroundColor: colors.mint }, numberText: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, installmentText: { flex: 1 }, installmentDate: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, installmentStatus: { fontFamily: font.medium, color: colors.muted, fontSize: 8, marginTop: 2, textTransform: "uppercase" }, installmentProgress: { fontFamily: font.medium, color: colors.mintDark, fontSize: 8, marginTop: 3 }, installmentAmount: { maxWidth: 100, fontFamily: font.bold, color: colors.ink, fontSize: 11, textAlign: "right" },
    pending: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, pendingText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 11, lineHeight: 17 },
    history: { gap: spacing.sm }, historyRow: { minHeight: 58, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, historyAmount: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, historyMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 },
});
