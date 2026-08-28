import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Calculator, Check, ChevronLeft, ChevronRight, Search, Send, UsersRound, X } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Select } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const steps = ["Montant", "Modalites", "Verification"];

export function LoanRequestScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const { user, refreshUser } = useAuth();
    const [data, setData] = useState();
    const [step, setStep] = useState(1);
    const [collective, setCollective] = useState(false);
    const [clubId, setClubId] = useState("");
    const [amount, setAmount] = useState("");
    const [durationCode, setDurationCode] = useState("");
    const [frequency, setFrequency] = useState("");
    const [purposeId, setPurposeId] = useState("");
    const [income, setIncome] = useState("");
    const [guarantors, setGuarantors] = useState("");
    const [partnerPhone, setPartnerPhone] = useState("");
    const [partners, setPartners] = useState([]);
    const [partnerProfiles, setPartnerProfiles] = useState([]);
    const [searchingPartner, setSearchingPartner] = useState(false);
    const [simulation, setSimulation] = useState();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState();

    useEffect(() => {
        Promise.all([api("/clubs/"), api("/loan-catalog/")])
            .then(([clubs, catalog]) => {
                setData({ clubs: clubs.results, catalog });
                setClubId(clubs.results[0]?.id || "");
            })
            .catch(error => Alert.alert("Chargement impossible", error.message));
    }, []);
    useEffect(() => navigation.addListener("focus", () => refreshUser().catch(() => {})), [navigation, refreshUser]);

    const club = useMemo(() => data?.clubs.find(item => item.id === clubId), [data, clubId]);
    const durations = useMemo(() => club?.duration_options?.length ? club.duration_options : data?.catalog.durations || [], [club, data]);
    const frequencies = useMemo(() => durations.find(item => item.code === durationCode)?.frequencies || [], [durations, durationCode]);
    const maximumPartners = Math.max(0, Number(club?.max_collective_borrowers || 1) - 1);

    if (!data) return <LoadingScreen/>;

    function resetSimulation() { setSimulation(undefined); }

    function validateAmountStep() {
        const numericAmount = Number(amount);
        if (!club) return "Selectionnez un club.";
        if (!Number.isFinite(numericAmount) || numericAmount < Number(club.min_loan) || numericAmount > Number(club.max_loan))
            return `Le montant doit etre compris entre ${money(club.min_loan, club.currency)} et ${money(club.max_loan, club.currency)}.`;
        return "";
    }

    function validateTermsStep() {
        if (!durationCode) return "Choisissez la duree du pret.";
        if (!frequency) return "Choisissez la frequence de remboursement.";
        if (!purposeId) return "Choisissez l'objet du pret.";
        if (!income || Number(income) < 0) return "Renseignez votre revenu ou chiffre d'affaire estime.";
        return "";
    }

    function next() {
        const error = step === 1 ? validateAmountStep() : validateTermsStep();
        if (error) return Alert.alert("Etape incomplete", error);
        setStep(current => Math.min(3, current + 1));
    }

    async function searchPartner() {
        const phone = partnerPhone.trim();
        if (!phone) return Alert.alert("Numero requis", "Saisissez le numero international complet du co-emprunteur.");
        if (partners.length >= maximumPartners) return Alert.alert("Limite atteinte", `Ce club autorise au maximum ${club.max_collective_borrowers} emprunteurs sur un meme pret.`);
        setSearchingPartner(true);
        try {
            const profile = await api(`/users/co-borrower-by-phone/?phone=${encodeURIComponent(phone)}`);
            if (partners.includes(profile.id)) return Alert.alert("Deja ajoute", "Ce co-emprunteur participe deja a cette demande.");
            setPartners(current => [...current, profile.id]);
            setPartnerProfiles(current => [...current, profile]);
            setPartnerPhone("");
            resetSimulation();
        } catch (error) {
            Alert.alert("Co-emprunteur introuvable", error.message);
        } finally {
            setSearchingPartner(false);
        }
    }

    async function simulate() {
        const error = validateAmountStep() || validateTermsStep();
        if (error) return Alert.alert("Dossier incomplet", error);
        if (collective && !partners.length) return Alert.alert("Co-emprunteur requis", "Ajoutez au moins un autre emprunteur pour creer un pret collectif.");
        setLoading(true);
        try {
            setSimulation(await api("/loans/simulate/", { method: "POST", body: JSON.stringify({ club: clubId, amount, duration_code: durationCode, repayment_frequency: frequency }) }));
        } catch (error) {
            Alert.alert("Simulation impossible", error.message);
        } finally {
            setLoading(false);
        }
    }

    async function submit() {
        if (!user.kyc_verified) return setResult({ success: false, title: "KYC obligatoire", message: "Votre identite doit etre validee avant une demande d'emprunt.", detail: "Completez votre dossier depuis Mon profil." });
        if (!simulation) return Alert.alert("Simulation requise", "Calculez et verifiez l'echeancier avant l'envoi.");
        setLoading(true);
        try {
            const loan = await api("/loans/", { method: "POST", body: JSON.stringify({
                club: clubId, amount, duration_code: durationCode, repayment_frequency: frequency,
                purpose_id: purposeId, estimated_income: income, guarantors: guarantors.trim(),
                partners: collective ? partners : [],
            }) });
            dispatch(invalidate(["loans", "dashboard", "validations", "notifications"]));
            setResult({ success: true, title: collective ? "Invitation envoyee" : "Demande envoyee", message: collective ? "Les co-emprunteurs doivent accepter leur participation avant la validation du pret." : "Votre demande a ete transmise au chef du club et a l'administrateur.", detail: `Dossier ${loan.reference}. Vous serez notifie a chaque etape.` });
        } catch (error) {
            setResult({ success: false, title: "Envoi impossible", message: error.message, detail: "Aucune demande n'a ete creee." });
        } finally {
            setLoading(false);
        }
    }

    return <Screen>
      <PageHeader eyebrow="Demande de credit" title="Nouveau pret" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.stepper}>{steps.map((label, index) => { const number = index + 1; const active = number === step; const done = number < step; return <View key={label} style={styles.stepItem}><View style={[styles.stepNumber, (active || done) && styles.stepNumberActive]}>{done ? <Check size={14} color={colors.white}/> : <Text style={[styles.stepNumberText, active && styles.stepNumberTextActive]}>{number}</Text>}</View><Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text></View>; })}</View>
      {!user.kyc_verified ? <View style={styles.warning}><Text style={styles.warningTitle}>Demande bloquee</Text><Text style={styles.warningText}>Votre KYC doit etre valide avant de soumettre un emprunt.</Text></View> : null}

      {step === 1 ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quel pret souhaitez-vous ?</Text>
        <View style={styles.typeRow}>{[{ value: false, label: "Individuel", note: "Vous remboursez seul" }, { value: true, label: "Collectif", note: "Avec des co-emprunteurs" }].map(option => <Pressable key={option.label} onPress={() => { setCollective(option.value); if (!option.value) { setPartners([]); setPartnerProfiles([]); setPartnerPhone(""); } resetSimulation(); }} style={[styles.typeCard, collective === option.value && styles.typeCardActive]}><UsersRound size={20} color={collective === option.value ? colors.white : colors.forest}/><Text style={[styles.typeTitle, collective === option.value && styles.typeTitleActive]}>{option.label}</Text><Text style={[styles.typeNote, collective === option.value && styles.typeNoteActive]}>{option.note}</Text></Pressable>)}</View>
        <Select label="Club emprunteur" value={clubId} searchable options={data.clubs.map(item => ({ value: item.id, label: item.name, note: item.zone }))} onChange={value => { setClubId(value); setDurationCode(""); setFrequency(""); setPartners([]); setPartnerProfiles([]); resetSimulation(); }}/>
        <Field label={`Montant demande en ${club?.currency || "CDF"}`} value={amount} onChangeText={value => { setAmount(value.replace(/[^0-9.]/g, "")); resetSimulation(); }} keyboardType="decimal-pad" placeholder="0"/>
        {club ? <Text style={styles.hint}>Autorise : {money(club.min_loan, club.currency)} a {money(club.max_loan, club.currency)}</Text> : null}
      </View> : null}

      {step === 2 ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>Modalites du remboursement</Text>
        <Select label="Duree du pret" value={durationCode} options={durations.map(item => ({ value: item.code, label: item.label }))} onChange={value => { setDurationCode(value); setFrequency(""); resetSimulation(); }}/>
        <Select label="Frequence de remboursement" value={frequency} disabled={!durationCode} placeholder={durationCode ? "Choisir une frequence" : "Choisissez d'abord la duree"} options={frequencies.map(item => ({ value: item.code, label: item.label, note: `${item.installments} echeances` }))} onChange={value => { setFrequency(value); resetSimulation(); }}/>
        <Select label="Objet du pret" value={purposeId} searchable options={(data.catalog.purposes || []).map(item => ({ value: item.id, label: item.name, note: item.description }))} onChange={value => { setPurposeId(value); resetSimulation(); }}/>
        <Field label="Revenu / chiffre d'affaire estime" value={income} onChangeText={value => setIncome(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="0"/>
        <Field label="Garant ou reference (facultatif)" value={guarantors} onChangeText={setGuarantors} multiline placeholder="Nom, telephone et relation avec le garant"/>
      </View> : null}

      {step === 3 ? <>
        {collective ? <View style={styles.section}>
          <Text style={styles.sectionTitle}>Co-emprunteurs</Text>
          <Text style={styles.sectionNote}>Le co-emprunteur peut appartenir a un autre club. Pour proteger les membres, la recherche exige son numero international complet.</Text>
          <Field label="Numero du co-emprunteur" value={partnerPhone} onChangeText={setPartnerPhone} keyboardType="phone-pad" placeholder="+243..."/>
          <Button icon={Search} label="Rechercher et ajouter" variant="secondary" disabled={!partnerPhone.trim() || partners.length >= maximumPartners} loading={searchingPartner} onPress={searchPartner}/>
          {partnerProfiles.map(profile => <View key={profile.id} style={styles.partner}><Avatar user={profile} size={38}/><View style={styles.partnerCopy}><Text style={styles.partnerName}>{profile.name}</Text><Text style={styles.partnerPhone}>{profile.phone} - KYC valide</Text></View><Pressable accessibilityLabel="Retirer" onPress={() => { setPartners(current => current.filter(id => id !== profile.id)); setPartnerProfiles(current => current.filter(item => item.id !== profile.id)); resetSimulation(); }} style={styles.remove}><X size={17} color={colors.danger}/></Pressable></View>)}
          <Text style={styles.hint}>{partners.length + 1} sur {club?.max_collective_borrowers || 1} emprunteurs maximum</Text>
        </View> : <View style={styles.notice}><UsersRound size={20} color={colors.forest}/><View style={styles.noticeCopy}><Text style={styles.noticeTitle}>Pret individuel</Text><Text style={styles.noticeText}>Vous etes seul responsable du remboursement de ce dossier.</Text></View></View>}
        <View style={styles.review}><Review label="Club" value={club?.name}/><Review label="Montant" value={money(amount, club?.currency)}/><Review label="Duree" value={durations.find(item => item.code === durationCode)?.label}/><Review label="Frequence" value={frequencies.find(item => item.code === frequency)?.label}/></View>
        <Button icon={Calculator} label={simulation ? "Recalculer l'echeancier" : "Calculer l'echeancier"} variant="secondary" onPress={simulate} loading={loading}/>
        {simulation ? <View style={styles.summary}><Text style={styles.summaryLabel}>Total a rembourser</Text><Text style={styles.summaryValue}>{money(simulation.total_due, simulation.currency)}</Text><Review light label={`Par echeance (${simulation.installments})`} value={money(simulation.installment_amount, simulation.currency)}/><Review light label="Cout global du credit" value={money(simulation.charge, simulation.currency)}/><Review light label="Premiere echeance" value={shortDate(simulation.first_due_date)}/><Review light label="Derniere echeance" value={shortDate(simulation.last_due_date)}/></View> : null}
      </> : null}

      <View style={styles.navigation}>
        {step > 1 ? <View style={styles.navButton}><Button icon={ChevronLeft} label="Precedent" variant="ghost" onPress={() => setStep(current => current - 1)}/></View> : null}
        <View style={styles.navButton}>{step < 3 ? <Button icon={ChevronRight} label="Continuer" onPress={next}/> : <Button icon={Send} label="Envoyer la demande" onPress={submit} loading={loading} disabled={!user.kyc_verified || !simulation}/>}</View>
      </View>
      <OperationResultModal result={result} onClose={() => { const success = result?.success; setResult(undefined); if (success) navigation.goBack(); }}/>
    </Screen>;
}

function Review({ label, value, light }) {
    return <View style={styles.reviewRow}><Text style={[styles.reviewLabel, light && styles.reviewLabelLight]}>{label}</Text><Text style={[styles.reviewValue, light && styles.reviewValueLight]}>{value || "-"}</Text></View>;
}

const styles = StyleSheet.create({
    stepper: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs }, stepItem: { flex: 1, alignItems: "center", gap: 5 }, stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, stepNumberActive: { borderColor: colors.forest, backgroundColor: colors.forest }, stepNumberText: { fontFamily: font.bold, color: colors.muted, fontSize: 10 }, stepNumberTextActive: { color: colors.white }, stepLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 8 }, stepLabelActive: { fontFamily: font.bold, color: colors.forest },
    warning: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft }, warningTitle: { fontFamily: font.bold, color: colors.danger, fontSize: 12 }, warningText: { marginTop: 3, fontFamily: font.medium, color: colors.danger, fontSize: 9, lineHeight: 15 },
    section: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 17 }, sectionNote: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 }, hint: { marginTop: -spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14 },
    typeRow: { flexDirection: "row", gap: spacing.sm }, typeCard: { flex: 1, minHeight: 112, padding: spacing.md, justifyContent: "space-between", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }, typeCardActive: { borderColor: colors.forest, backgroundColor: colors.forest }, typeTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, typeTitleActive: { color: colors.white }, typeNote: { fontFamily: font.medium, color: colors.muted, fontSize: 8, lineHeight: 13 }, typeNoteActive: { color: colors.mint },
    partner: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.mint }, partnerCopy: { flex: 1 }, partnerName: { fontFamily: font.bold, color: colors.forest, fontSize: 11 }, partnerPhone: { marginTop: 2, fontFamily: font.medium, color: colors.mintDark, fontSize: 9 }, remove: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.white },
    notice: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, noticeCopy: { flex: 1 }, noticeTitle: { fontFamily: font.bold, color: colors.forest, fontSize: 12 }, noticeText: { marginTop: 3, fontFamily: font.medium, color: colors.mintDark, fontSize: 9 },
    review: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, reviewRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, reviewLabel: { flex: 1, fontFamily: font.medium, color: colors.muted, fontSize: 10 }, reviewValue: { maxWidth: "58%", fontFamily: font.bold, color: colors.ink, fontSize: 11, textAlign: "right" }, reviewLabelLight: { color: colors.mint }, reviewValueLight: { color: colors.white },
    summary: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, summaryLabel: { fontFamily: font.medium, color: colors.mint, fontSize: 10 }, summaryValue: { marginBottom: spacing.sm, fontFamily: font.bold, color: colors.white, fontSize: 27 }, navigation: { flexDirection: "row", gap: spacing.sm }, navButton: { flex: 1 },
});
