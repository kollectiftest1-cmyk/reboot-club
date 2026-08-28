import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, Banknote, Calculator, CircleDollarSign, HandCoins, Search, Send, UserRound, WalletCards, X } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const modes = [
    { id: "deposit", label: "Mise", icon: WalletCards },
    { id: "withdrawal", label: "Recuperation", icon: CircleDollarSign },
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
    const [guarantors, setGuarantors] = useState("");
    const [collective, setCollective] = useState(false);
    const [partnerPhone, setPartnerPhone] = useState("");
    const [partners, setPartners] = useState([]);
    const [partnerProfiles, setPartnerProfiles] = useState([]);
    const [searchingPartner, setSearchingPartner] = useState(false);
    const [loanStep, setLoanStep] = useState(1);
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
    const selectedLoan = useMemo(() => openLoans.find(item => item.id === loanId), [openLoans, loanId]);
    const durationOptions = useMemo(() => {
        const allowed = club?.duration_options?.length ? club.duration_options : catalog.durations || [];
        return allowed;
    }, [club, catalog]);
    const frequencyOptions = useMemo(() => durationOptions.find(item => item.code === durationCode)?.frequencies || [], [durationOptions, durationCode]);

    useEffect(() => {
        setMemberId(memberOptions[0]?.id || "");
        setLoanId(openLoans[0]?.id || "");
        setPartners([]);
        setPartnerProfiles([]);
        setPartnerPhone("");
        setSimulation(undefined);
    }, [mode, clubId, memberships, loans, memberOptions, openLoans]);

    useEffect(() => {
        if (frequency && !frequencyOptions.some(item => item.code === frequency)) setFrequency("");
    }, [frequencyOptions, frequency]);

    useEffect(() => {
        if (!["withdrawal", "funding"].includes(mode) || !memberId) return setClientAvailable(undefined);
        let active = true;
        api(`/users/${memberId}/overview/`)
            .then(data => { if (active) setClientAvailable(data.summary.available_capital); })
            .catch(() => { if (active) setClientAvailable(undefined); });
        return () => { active = false; };
    }, [mode, memberId]);

    const placementMaximum = mode === "funding" ? Math.min(Number(clientAvailable || 0), Number(selectedLoan?.funding_open_amount || 0)) : Number(clientAvailable || 0);

    if (!clubs) return <LoadingScreen/>;

    function selectMode(value) {
        setMode(value);
        setAmount("");
        setCollective(false);
        setPartners([]);
        setPartnerProfiles([]);
        setPartnerPhone("");
        setLoanStep(1);
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

    async function searchPartner() {
        const phone = partnerPhone.trim();
        if (!phone) return Alert.alert("Numero requis", "Saisissez le numero international complet du co-emprunteur.");
        if (partners.length >= Number(club?.max_collective_borrowers || 1) - 1) return Alert.alert("Limite atteinte", "Le nombre maximal de participants est atteint.");
        setSearchingPartner(true);
        try {
            const profile = await api(`/users/co-borrower-by-phone/?phone=${encodeURIComponent(phone)}`);
            if (profile.id === memberId) return Alert.alert("Profil principal", "Ce membre est deja l'emprunteur principal.");
            if (partners.includes(profile.id)) return Alert.alert("Deja ajoute", "Ce co-emprunteur participe deja a cette demande.");
            setPartners(current => [...current, profile.id]);
            setPartnerProfiles(current => [...current, profile]);
            setPartnerPhone("");
            setSimulation(undefined);
        } catch (error) {
            Alert.alert("Co-emprunteur introuvable", error.message);
        } finally {
            setSearchingPartner(false);
        }
    }

    async function calculate() {
        if (!amount) return;
        const validationError = mode === "loan" ? loanInputError() : "";
        if (validationError) return Alert.alert("Valeurs invalides", validationError);
        if (mode === "funding" && Number(amount) > placementMaximum) return Alert.alert("Montant trop eleve", `Le maximum placable maintenant est de ${money(placementMaximum, selectedLoan?.currency || "CDF")}.`);
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
            setResult({ success: false, title: "Recuperation impossible", message: `Le maximum recuperable pour ce client est de ${money(clientAvailable || 0, "CDF")}.`, detail: "Le montant disponible tient compte de toutes ses mises, participations, remboursements et recuperations." });
            return;
        }
        setLoading(true);
        try {
            if (mode === "deposit") await api("/deposits/assisted/", { method: "POST", body: JSON.stringify({ lender: memberId, amount, payment_method: "cash", provider_reference: reference.trim() }) });
            if (mode === "withdrawal") await api("/withdrawals/assisted/", { method: "POST", body: JSON.stringify({ lender: memberId, amount }) });
            if (mode === "loan") await api("/loans/assisted/", { method: "POST", body: JSON.stringify({ club: clubId, borrower: memberId, amount, duration_code: durationCode, repayment_frequency: frequency, purpose_id: purposeId, estimated_income: income, guarantors: guarantors.trim(), partners: collective ? partners : [] }) });
            if (mode === "funding") await api(`/loans/${loanId}/fund/`, { method: "POST", body: JSON.stringify({ lender: memberId, amount }) });
            dispatch(invalidate(["dashboard", "clubs", "loans", "members", "validations", "notifications"]));
            setResult({
                success: true,
                title: mode === "withdrawal" ? "Recuperation effectuee" : "Operation enregistree",
                message: mode === "deposit" ? "La mise du client est validee et son fonds disponible a ete actualise."
                    : mode === "withdrawal" ? "La recuperation a ete payee. La balance et l'historique du client sont a jour."
                    : mode === "loan" ? collective ? "Le pret collectif attend maintenant l'accord des co-emprunteurs." : "La demande d'emprunt a ete transmise au chef du club et a l'administrateur."
                    : "Le placement assiste a ete valide et finance immediatement le pret.",
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
        || (mode === "loan" && collective && !partners.length)
        || (mode === "funding" && (!loanId || !simulation || Number(amount) > placementMaximum));

    return <Screen>
      <PageHeader eyebrow="Administration assistee" title="Operations clients" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.notice}><UserRound size={20} color={colors.mintDark}/><Text style={styles.noticeText}>Agissez au nom d'un membre sans ouvrir sa session. Chaque operation conserve votre identite dans le journal d'audit.</Text></View>
      <View style={styles.tabs}>{modes.map(({ id, label, icon: Icon }) => <Pressable key={id} onPress={() => selectMode(id)} style={[styles.tab, mode === id && styles.tabActive]}><Icon size={18} color={mode === id ? colors.white : colors.forest}/><Text style={[styles.tabText, mode === id && styles.tabTextActive]}>{label}</Text></Pressable>)}</View>

      {needsClub ? <Select label="Club" value={clubId} searchable options={clubs.map(item => ({ value: item.id, label: item.name, note: item.zone }))} onChange={id => { setClubId(id); setPartners([]); setPartnerProfiles([]); setSimulation(undefined); }}/> : null}
      {mode === "funding" ? <Select label="Pret ouvert au financement" value={loanId} searchable options={openLoans.map(item => ({ value: item.id, label: `${item.reference} - ${item.club_name}`, note: `${money(item.funding_open_amount, item.currency)} encore ouvert` }))} onChange={id => { setLoanId(id); setSimulation(undefined); }}/> : null}
      <Select label={mode === "loan" ? "Compte emprunteur" : "Compte preteur"} value={memberId} searchable placeholder="Rechercher par nom ou numero" options={memberOptions.map(item => ({ value: item.id, label: `${item.user_detail.name} - ${item.user_detail.phone}`, note: "KYC valide" }))} onChange={id => { setMemberId(id); setPartners([]); setPartnerProfiles([]); setSimulation(undefined); }}/>
      {!members.length ? <Text style={styles.warning}>Aucun profil {role === "lender" ? "preteur" : "emprunteur"} actif{needsClub ? " dans ce club" : ""}.</Text> : null}
      {mode === "funding" && !openLoans.length ? <Text style={styles.warning}>Aucun pret valide n'attend de financement.</Text> : null}
      {mode === "withdrawal" && clientAvailable !== undefined ? <View style={styles.available}><View style={styles.availableCopy}><Text style={styles.availableLabel}>Maximum a retirer</Text><Text style={styles.availableValue}>{money(clientAvailable, "CDF")}</Text><Text style={styles.availableHint}>Fonds global reellement disponible</Text></View><Pressable disabled={Number(clientAvailable) <= 0} onPress={() => setAmount(String(clientAvailable))} style={({ pressed }) => [styles.maxAction, pressed && { opacity: 0.75 }]}><CircleDollarSign size={17} color={colors.forest}/><Text style={styles.maxActionText}>Utiliser le maximum</Text></Pressable></View> : null}
      {mode === "funding" && clientAvailable !== undefined ? <View style={styles.available}><View style={styles.availableCopy}><Text style={styles.availableLabel}>Maximum placable maintenant</Text><Text style={styles.availableValue}>{money(placementMaximum, selectedLoan?.currency || "CDF")}</Text><Text style={styles.availableHint}>Fonds client limite au besoin encore ouvert</Text></View><Pressable disabled={placementMaximum <= 0} onPress={() => { setAmount(String(placementMaximum)); setSimulation(undefined); }} style={({ pressed }) => [styles.maxAction, pressed && { opacity: 0.75 }]}><HandCoins size={17} color={colors.forest}/><Text style={styles.maxActionText}>Placer le maximum</Text></Pressable></View> : null}

      <View style={styles.form}>
        {mode !== "loan" || loanStep === 1 ? <Field label={`Montant en ${mode === "funding" ? selectedLoan?.currency || "CDF" : club?.currency || "CDF"}`} value={amount} keyboardType="decimal-pad" onChangeText={value => { setAmount(value.replace(/[^0-9.]/g, "")); setSimulation(undefined); }}/> : null}
        {mode === "loan" && loanStep === 1 && club ? <Text style={styles.hint}>Montant autorise : {money(club.min_loan, club.currency)} a {money(club.max_loan, club.currency)}</Text> : null}
        {mode === "deposit" ? <Field label="Reference du recu (facultatif)" value={reference} onChangeText={setReference} placeholder="Numero du recu papier"/> : null}
        {mode === "loan" && loanStep === 1 ? <>
          <View style={styles.loanType}><Pressable onPress={() => { setCollective(false); setPartners([]); setPartnerProfiles([]); setPartnerPhone(""); }} style={[styles.loanTypeOption, !collective && styles.loanTypeActive]}><Text style={[styles.loanTypeText, !collective && styles.loanTypeTextActive]}>Pret individuel</Text></Pressable><Pressable onPress={() => setCollective(true)} style={[styles.loanTypeOption, collective && styles.loanTypeActive]}><Text style={[styles.loanTypeText, collective && styles.loanTypeTextActive]}>Pret collectif</Text></Pressable></View>
          {collective ? <View style={styles.collective}><Text style={styles.selectorTitle}>Co-emprunteurs</Text><Text style={styles.hint}>Ils peuvent appartenir a d'autres clubs. Saisissez leur numero international complet.</Text><Field label="Numero du co-emprunteur" value={partnerPhone} onChangeText={setPartnerPhone} keyboardType="phone-pad" placeholder="+243..."/><Button icon={Search} label="Rechercher et ajouter" variant="secondary" disabled={!partnerPhone.trim() || partners.length >= Number(club?.max_collective_borrowers || 1) - 1} loading={searchingPartner} onPress={searchPartner}/>{partnerProfiles.map(profile => <View key={profile.id} style={styles.partner}><Avatar user={profile} size={36}/><View style={styles.partnerCopy}><Text style={styles.partnerName}>{profile.name}</Text><Text style={styles.partnerPhone}>{profile.phone} - KYC valide</Text></View><Pressable onPress={() => { setPartners(current => current.filter(id => id !== profile.id)); setPartnerProfiles(current => current.filter(item => item.id !== profile.id)); }} style={styles.remove}><X size={16} color={colors.danger}/></Pressable></View>)}</View> : null}
          <Button label="Continuer vers les modalites" onPress={() => { const numericAmount = Number(amount); const error = !club ? "Selectionnez un club." : !Number.isFinite(numericAmount) || numericAmount < Number(club.min_loan) || numericAmount > Number(club.max_loan) ? `Le montant doit etre compris entre ${money(club.min_loan, club.currency)} et ${money(club.max_loan, club.currency)}.` : ""; if (!memberId || error || (collective && !partners.length)) return Alert.alert("Etape incomplete", error || "Selectionnez le client et au moins un co-emprunteur."); setLoanStep(2); }}/>
        </> : null}
        {mode === "loan" && loanStep === 2 ? <>
          <Select label="Duree du pret" value={durationCode} placeholder="Choisir une duree" options={durationOptions.map(item => ({ value: item.code, label: item.label }))} onChange={value => { setDurationCode(value); setFrequency(""); setSimulation(undefined); }}/>
          <Select label="Frequence de remboursement" value={frequency} disabled={!durationCode} placeholder={durationCode ? "Choisir une frequence" : "Choisissez d'abord la duree"} options={frequencyOptions.map(item => ({ value: item.code, label: item.label, note: `${item.installments} echeances` }))} onChange={value => { setFrequency(value); setSimulation(undefined); }}/>
          <Select label="Objet du pret" value={purposeId} placeholder="Choisir un objet" searchable options={(catalog.purposes || []).map(item => ({ value: item.id, label: item.name }))} onChange={setPurposeId}/>
          <Field label="Revenu / chiffre d'affaire estime" value={income} keyboardType="decimal-pad" onChangeText={value => setIncome(value.replace(/[^0-9.]/g, ""))}/>
          <Field label="Garant ou reference (facultatif)" value={guarantors} multiline onChangeText={setGuarantors}/>
          <Button label="Modifier les participants" variant="ghost" onPress={() => { setLoanStep(1); setSimulation(undefined); }}/>
        </> : null}
        {(mode === "funding" || (mode === "loan" && loanStep === 2)) ? <Button icon={Calculator} label={mode === "loan" ? "Calculer l'echeancier" : "Calculer la prevision"} variant="secondary" onPress={calculate} loading={loading}/> : null}
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

      {mode !== "loan" || loanStep === 2 ? <Button icon={Send} label={mode === "deposit" ? "Enregistrer et valider la mise" : mode === "withdrawal" ? "Payer la recuperation du client" : mode === "loan" ? "Soumettre pour le client" : "Enregistrer la participation"} onPress={submit} loading={loading} disabled={disabled}/> : null}
      <OperationResultModal result={result} onClose={() => { setResult(undefined); navigation.goBack(); }}/>
    </Screen>;
}

function Summary({ label, value }) { return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
    notice: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, noticeText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 },
    tabs: { flexDirection: "row", gap: spacing.sm }, tab: { flex: 1, minHeight: 62, alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, tabActive: { backgroundColor: colors.forest, borderColor: colors.forest }, tabText: { fontFamily: font.bold, color: colors.forest, fontSize: 10 }, tabTextActive: { color: colors.white },
    selector: { gap: spacing.sm }, selectorTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, option: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, optionActive: { borderColor: colors.mintDark, backgroundColor: "#F0FAF5" }, optionIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.mint }, optionText: { flex: 1, fontFamily: font.semibold, color: colors.ink, fontSize: 11, lineHeight: 16 }, selected: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral },
    available: { minHeight: 104, padding: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, availableCopy: { flex: 1 }, availableLabel: { fontFamily: font.medium, color: colors.forest, fontSize: 10 }, availableValue: { marginTop: 4, fontFamily: font.bold, color: colors.ink, fontSize: 22 }, availableHint: { marginTop: 3, fontFamily: font.medium, color: colors.mintDark, fontSize: 8 }, maxAction: { minHeight: 42, maxWidth: 132, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.white }, maxActionText: { flexShrink: 1, fontFamily: font.bold, color: colors.forest, fontSize: 9, textAlign: "center" },
    form: { gap: spacing.md }, hint: { marginTop: -spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 15 }, warning: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft, fontFamily: font.semibold, color: colors.danger, fontSize: 10, lineHeight: 16 },
    loanType: { flexDirection: "row", gap: spacing.sm }, loanTypeOption: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }, loanTypeActive: { borderColor: colors.forest, backgroundColor: colors.forest }, loanTypeText: { fontFamily: font.bold, color: colors.muted, fontSize: 10 }, loanTypeTextActive: { color: colors.white },
    collective: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paper }, partner: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.mint }, partnerCopy: { flex: 1 }, partnerName: { fontFamily: font.bold, color: colors.forest, fontSize: 11 }, partnerPhone: { marginTop: 2, fontFamily: font.medium, color: colors.mintDark, fontSize: 9 }, remove: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.white },
    summary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, summaryTitle: { fontFamily: font.bold, color: colors.white, fontSize: 16, marginBottom: spacing.xs }, summaryRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, summaryLabel: { flex: 1, fontFamily: font.medium, color: colors.mint, fontSize: 10 }, summaryValue: { fontFamily: font.bold, color: colors.yellow, fontSize: 11 },
});
