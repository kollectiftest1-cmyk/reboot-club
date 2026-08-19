import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, Banknote, Calculator, CircleDollarSign, HandCoins, Landmark, Send, UserRound, WalletCards } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const modes = [
    { id: "deposit", label: "Depot", icon: WalletCards },
    { id: "withdrawal", label: "Retrait", icon: CircleDollarSign },
    { id: "loan", label: "Emprunt", icon: Banknote },
    { id: "funding", label: "Placement", icon: HandCoins },
];

export function AdminOperationsScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const dispatch = useDispatch();
    const [mode, setMode] = useState(route.params?.mode && modes.some(item => item.id === route.params.mode) ? route.params.mode : "deposit");
    const [clubs, setClubs] = useState();
    const [catalog, setCatalog] = useState({ durations: [], purposes: [] });
    const [memberships, setMemberships] = useState([]);
    const [users, setUsers] = useState([]);
    const [loans, setLoans] = useState([]);
    const [clubId, setClubId] = useState("");
    const [memberId, setMemberId] = useState("");
    const [loanId, setLoanId] = useState("");
    const [amount, setAmount] = useState("");
    const [durationCode, setDurationCode] = useState("");
    const [frequency, setFrequency] = useState("");
    const [purposeId, setPurposeId] = useState("");
    const [income, setIncome] = useState("");
    const [reference, setReference] = useState("");
    const [simulation, setSimulation] = useState();
    const [clientAvailable, setClientAvailable] = useState();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState();

    useEffect(() => {
        Promise.all([api("/clubs/"), api("/memberships/"), api("/loans/"), api("/users/"), api("/loan-catalog/")])
            .then(([clubData, membershipData, loanData, userData, catalogData]) => {
                setClubs(clubData.results);
                setMemberships(membershipData.results);
                setLoans(loanData.results);
                setUsers(userData.results);
                setCatalog(catalogData);
                setClubId(clubData.results[0]?.id || "");
            })
            .catch(error => Alert.alert("Chargement impossible", error.message));
    }, []);

    const club = useMemo(() => clubs?.find(item => item.id === clubId), [clubs, clubId]);
    const role = mode === "loan" ? "borrower" : "lender";
    // Le portefeuille preteur est global : depot et retrait ne dependent d'aucun club.
    const needsClub = mode === "loan";

    const members = useMemo(() => {
        if (role === "lender") return users.filter(item => item.lender_profile_status === "active" && item.kyc_verified).map(item => ({ id: item.id, user: item.id, user_detail: item }));
        return memberships.filter(item => item.role === role && item.status === "active" && item.user_detail.kyc_verified && item.club === clubId);
    }, [memberships, users, clubId, role]);
    const memberOptions = useMemo(() => members.map(item => ({ ...item, id: item.user })), [members]);
    const openLoans = useMemo(() => loans.filter(item => item.status === "approved" && Number(item.funding_open_amount || 0) > 0), [loans]);
    const durationOptions = useMemo(() => {
        const allowed = club?.duration_options?.length ? club.duration_options : catalog.durations || [];
        return allowed;
    }, [club, catalog]);
    const frequencyOptions = useMemo(() => durationOptions.find(item => item.code === durationCode)?.frequencies || [], [durationOptions, durationCode]);

    useEffect(() => {
        setMemberId(memberOptions[0]?.id || "");
        setLoanId(openLoans[0]?.id || "");
        setSimulation(undefined);
    }, [mode, clubId, memberships, loans, memberOptions, openLoans]);

    useEffect(() => {
        if (frequency && !frequencyOptions.some(item => item.code === frequency)) setFrequency("");
    }, [frequencyOptions, frequency]);

    useEffect(() => {
        if (mode !== "withdrawal" || !memberId) return setClientAvailable(undefined);
        let active = true;
        api(`/users/${memberId}/overview/`)
            .then(data => { if (active) setClientAvailable(data.summary.available_capital); })
            .catch(() => { if (active) setClientAvailable(undefined); });
        return () => { active = false; };
    }, [mode, memberId]);

    if (!clubs) return <LoadingScreen/>;

    function selectMode(value) {
        setMode(value);
        setAmount("");
        setSimulation(undefined);
    }

    function loanInputError() {
        const numericAmount = Number(amount);
        if (!club) return "Selectionnez un club.";
        if (!Number.isFinite(numericAmount) || numericAmount < Number(club.min_loan) || numericAmount > Number(club.max_loan))
            return `Le montant doit etre compris entre ${money(club.min_loan, club.currency)} et ${money(club.max_loan, club.currency)}.`;
        if (!durationCode) return "Choisissez la duree du pret.";
        if (!frequency) return "Choisissez la frequence de remboursement.";
        if (!purposeId) return "Choisissez l'objet du pret.";
        return "";
    }

    async function calculate() {
        if (!amount) return;
        const validationError = mode === "loan" ? loanInputError() : "";
        if (validationError) return Alert.alert("Valeurs invalides", validationError);
        setLoading(true);
        try {
            if (mode === "loan") setSimulation(await api("/loans/simulate/", { method: "POST", body: JSON.stringify({ club: clubId, amount, duration_code: durationCode, repayment_frequency: frequency }) }));
            if (mode === "funding" && loanId) setSimulation(await api(`/loans/${loanId}/funding-forecast/?amount=${amount}`));
        } catch (error) {
            Alert.alert("Calcul impossible", error.message);
        } finally {
            setLoading(false);
        }
    }

    async function submit() {
        const validationError = mode === "loan" ? loanInputError() : "";
        if (validationError) {
            setSimulation(undefined);
            return Alert.alert("Valeurs invalides", validationError);
        }
        if (mode === "withdrawal" && Number(amount) > Number(clientAvailable || 0)) {
            setResult({ success: false, title: "Retrait impossible", message: `Le maximum a retirer pour ce client est de ${money(clientAvailable || 0, "CDF")}.`, detail: "Le montant disponible tient compte de tous ses depots, placements, remboursements et retraits." });
            return;
        }
        setLoading(true);
        try {
            if (mode === "deposit") await api("/deposits/assisted/", { method: "POST", body: JSON.stringify({ lender: memberId, amount, payment_method: "cash", provider_reference: reference.trim() }) });
            if (mode === "withdrawal") await api("/withdrawals/assisted/", { method: "POST", body: JSON.stringify({ lender: memberId, amount }) });
            if (mode === "loan") await api("/loans/assisted/", { method: "POST", body: JSON.stringify({ club: clubId, borrower: memberId, amount, duration_code: durationCode, repayment_frequency: frequency, purpose_id: purposeId, estimated_income: income, guarantors: "" }) });
            if (mode === "funding") await api(`/loans/${loanId}/fund/`, { method: "POST", body: JSON.stringify({ lender: memberId, amount }) });
            dispatch(invalidate(["dashboard", "clubs", "loans", "members", "validations", "notifications"]));
            setResult({
                success: true,
                title: mode === "withdrawal" ? "Retrait effectue" : "Operation enregistree",
                message: mode === "deposit" ? "Le depot du client est valide et son fonds disponible a ete actualise."
                    : mode === "withdrawal" ? "Le retrait a ete paye. La balance et l'historique du client sont a jour."
                    : mode === "loan" ? "La demande d'emprunt a ete transmise au chef du club et a l'administrateur."
                    : "Le placement est enregistre. Validez-le depuis l'ecran Validations pour qu'il finance le pret.",
                detail: "Cette operation est conservee dans le journal d'audit.",
            });
        } catch (error) {
            setResult({ success: false, title: "Operation impossible", message: error.message, detail: "Aucun changement n'a ete applique. Verifiez les informations et recommencez." });
        } finally {
            setLoading(false);
        }
    }

    const disabled = !memberId || !amount || (needsClub && !clubId)
        || (mode === "loan" && (!purposeId || !income || !durationCode || !frequency || !simulation))
        || (mode === "funding" && (!loanId || !simulation));

    return <Screen>
      <PageHeader eyebrow="Administration assistee" title="Operations clients" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.notice}><UserRound size={20} color={colors.mintDark}/><Text style={styles.noticeText}>Agissez au nom d'un membre sans ouvrir sa session. Chaque operation conserve votre identite dans le journal d'audit.</Text></View>
      <View style={styles.tabs}>{modes.map(({ id, label, icon: Icon }) => <Pressable key={id} onPress={() => selectMode(id)} style={[styles.tab, mode === id && styles.tabActive]}><Icon size={18} color={mode === id ? colors.white : colors.forest}/><Text style={[styles.tabText, mode === id && styles.tabTextActive]}>{label}</Text></Pressable>)}</View>

      {needsClub ? <Selector title="Club" icon={Landmark} items={clubs} selected={clubId} onSelect={id => { setClubId(id); setSimulation(undefined); }} label={item => item.name}/> : null}
      {mode === "funding" ? <Selector title="Pret ouvert au financement" icon={HandCoins} items={openLoans} selected={loanId} onSelect={id => { setLoanId(id); setSimulation(undefined); }} label={item => `${item.reference} · ${item.club_name} · ${money(item.funding_open_amount, item.currency)} restant`}/> : null}
      <Selector title={mode === "loan" ? "Compte emprunteur" : "Compte preteur"} icon={UserRound} items={memberOptions} selected={memberId} onSelect={setMemberId} label={item => `${item.user_detail.name} - ${item.user_detail.phone}`} person={item => item.user_detail}/>
      {!members.length ? <Text style={styles.warning}>Aucun profil {role === "lender" ? "preteur" : "emprunteur"} actif{needsClub ? " dans ce club" : ""}.</Text> : null}
      {mode === "funding" && !openLoans.length ? <Text style={styles.warning}>Aucun pret valide n'attend de financement.</Text> : null}
      {mode === "withdrawal" && clientAvailable !== undefined ? <View style={styles.available}><View style={styles.availableCopy}><Text style={styles.availableLabel}>Maximum a retirer</Text><Text style={styles.availableValue}>{money(clientAvailable, "CDF")}</Text><Text style={styles.availableHint}>Fonds global reellement disponible</Text></View><Pressable disabled={Number(clientAvailable) <= 0} onPress={() => setAmount(String(clientAvailable))} style={({ pressed }) => [styles.maxAction, pressed && { opacity: 0.75 }]}><CircleDollarSign size={17} color={colors.forest}/><Text style={styles.maxActionText}>Utiliser le maximum</Text></Pressable></View> : null}

      <View style={styles.form}>
        <Field label={`Montant en ${club?.currency || "CDF"}`} value={amount} keyboardType="decimal-pad" onChangeText={value => { setAmount(value.replace(/[^0-9.]/g, "")); setSimulation(undefined); }}/>
        {mode === "loan" && club ? <Text style={styles.hint}>Montant autorise : {money(club.min_loan, club.currency)} a {money(club.max_loan, club.currency)}</Text> : null}
        {mode === "deposit" ? <Field label="Reference du recu (facultatif)" value={reference} onChangeText={setReference} placeholder="Numero du recu papier"/> : null}
        {mode === "loan" ? <>
          <Select label="Duree du pret" value={durationCode} placeholder="Choisir une duree" options={durationOptions.map(item => ({ value: item.code, label: item.label }))} onChange={value => { setDurationCode(value); setFrequency(""); setSimulation(undefined); }}/>
          <Select label="Frequence de remboursement" value={frequency} disabled={!durationCode} placeholder={durationCode ? "Choisir une frequence" : "Choisissez d'abord la duree"} options={frequencyOptions.map(item => ({ value: item.code, label: item.label, note: `${item.installments} echeances` }))} onChange={value => { setFrequency(value); setSimulation(undefined); }}/>
          <Select label="Objet du pret" value={purposeId} placeholder="Choisir un objet" searchable options={(catalog.purposes || []).map(item => ({ value: item.id, label: item.name }))} onChange={setPurposeId}/>
          <Field label="Revenu mensuel estime" value={income} keyboardType="decimal-pad" onChangeText={value => setIncome(value.replace(/[^0-9.]/g, ""))}/>
        </> : null}
        {["loan", "funding"].includes(mode) ? <Button icon={Calculator} label={mode === "loan" ? "Calculer l'echeancier" : "Calculer la prevision"} variant="secondary" onPress={calculate} loading={loading}/> : null}
      </View>

      {simulation ? <View style={styles.summary}>
        <Text style={styles.summaryTitle}>{mode === "loan" ? "Simulation du remboursement" : "Prevision du placement"}</Text>
        {mode === "loan" ? <>
          <Summary label={`Par echeance (${simulation.installments})`} value={money(simulation.installment_amount, simulation.currency)}/>
          <Summary label="Capital" value={money(simulation.amount, simulation.currency)}/>
          <Summary label="Interet preteur" value={money(simulation.interest, simulation.currency)}/>
          <Summary label="Commission application" value={money(simulation.platform_commission, simulation.currency)}/>
          <Summary label="Commission chef de club" value={money(simulation.leader_commission, simulation.currency)}/>
          <Summary label={`Cout vu par l'emprunteur (${simulation.charge_rate} %)`} value={money(simulation.charge, simulation.currency)}/>
          <Summary label="Total a rembourser" value={money(simulation.total_due, simulation.currency)}/>
        </> : <>
          <Summary label="Capital place" value={money(simulation.invested, simulation.currency)}/>
          <Summary label="Interet previsionnel" value={money(simulation.expected_gain, simulation.currency)}/>
          <Summary label="Total attendu" value={money(simulation.expected_total, simulation.currency)}/>
          <Summary label={`Retour par echeance (${simulation.frequency_label})`} value={money(simulation.estimated_periodic_return, simulation.currency)}/>
        </>}
      </View> : null}

      <Button icon={Send} label={mode === "deposit" ? "Enregistrer et valider le depot" : mode === "withdrawal" ? "Payer le retrait du client" : mode === "loan" ? "Soumettre pour le client" : "Enregistrer le placement"} onPress={submit} loading={loading} disabled={disabled}/>
      <OperationResultModal result={result} onClose={() => { setResult(undefined); navigation.goBack(); }}/>
    </Screen>;
}

function Selector({ title, icon: Icon, items, selected, onSelect, label, person }) {
    return <View style={styles.selector}><Text style={styles.selectorTitle}>{title}</Text>{items.map(item => <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.option, selected === item.id && styles.optionActive]}>{person ? <Avatar user={person(item)} size={38}/> : <View style={styles.optionIcon}><Icon size={16} color={colors.forest}/></View>}<Text style={styles.optionText} numberOfLines={2}>{label(item)}</Text>{selected === item.id ? <View style={styles.selected}/> : null}</Pressable>)}</View>;
}
function Summary({ label, value }) { return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
    notice: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, noticeText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 },
    tabs: { flexDirection: "row", gap: spacing.sm }, tab: { flex: 1, minHeight: 62, alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, tabActive: { backgroundColor: colors.forest, borderColor: colors.forest }, tabText: { fontFamily: font.bold, color: colors.forest, fontSize: 10 }, tabTextActive: { color: colors.white },
    selector: { gap: spacing.sm }, selectorTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, option: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, optionActive: { borderColor: colors.mintDark, backgroundColor: "#F0FAF5" }, optionIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.mint }, optionText: { flex: 1, fontFamily: font.semibold, color: colors.ink, fontSize: 11, lineHeight: 16 }, selected: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral },
    available: { minHeight: 104, padding: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, availableCopy: { flex: 1 }, availableLabel: { fontFamily: font.medium, color: colors.forest, fontSize: 10 }, availableValue: { marginTop: 4, fontFamily: font.bold, color: colors.ink, fontSize: 22 }, availableHint: { marginTop: 3, fontFamily: font.medium, color: colors.mintDark, fontSize: 8 }, maxAction: { minHeight: 42, maxWidth: 132, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.white }, maxActionText: { flexShrink: 1, fontFamily: font.bold, color: colors.forest, fontSize: 9, textAlign: "center" },
    form: { gap: spacing.md }, hint: { marginTop: -spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 15 }, warning: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft, fontFamily: font.semibold, color: colors.danger, fontSize: 10, lineHeight: 16 },
    summary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, summaryTitle: { fontFamily: font.bold, color: colors.white, fontSize: 16, marginBottom: spacing.xs }, summaryRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, summaryLabel: { flex: 1, fontFamily: font.medium, color: colors.mint, fontSize: 10 }, summaryValue: { fontFamily: font.bold, color: colors.yellow, fontSize: 11 },
});
