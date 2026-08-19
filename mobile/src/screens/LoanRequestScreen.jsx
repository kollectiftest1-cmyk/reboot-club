import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Calculator, Check, Send } from "lucide-react-native";
import { Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";
import { useDispatch } from "react-redux";
import { invalidate } from "@/store";
import { useAuth } from "@/context/AuthContext";
export function LoanRequestScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const { user, refreshUser } = useAuth();
    const [clubs, setClubs] = useState();
    const [clubId, setClubId] = useState("");
    const [amount, setAmount] = useState("");
    const [months, setMonths] = useState("3");
    const [purpose, setPurpose] = useState("");
    const [income, setIncome] = useState("");
    const [simulation, setSimulation] = useState();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState();
    useEffect(() => { api("/clubs/").then(result => { setClubs(result.results); setClubId(result.results[0]?.id || ""); }); }, []);
    useEffect(() => navigation.addListener("focus", () => refreshUser().catch(() => {})), [navigation, refreshUser]);
    const club = useMemo(() => clubs?.find(item => item.id === clubId), [clubs, clubId]);
    if (!clubs)
        return <LoadingScreen />;
    function inputError() {
        const numericAmount = Number(amount);
        const numericMonths = Number(months);
        if (!club || !Number.isFinite(numericAmount) || numericAmount < Number(club.min_loan) || numericAmount > Number(club.max_loan))
            return club ? `Le montant doit etre compris entre ${money(club.min_loan, club.currency)} et ${money(club.max_loan, club.currency)}.` : "Selectionnez un club.";
        if (!Number.isInteger(numericMonths) || numericMonths < club.min_duration_months || numericMonths > club.max_duration_months)
            return `La duree doit etre comprise entre ${club.min_duration_months} et ${club.max_duration_months} mois.`;
        return "";
    }
    async function simulate() {
        if (!clubId || !amount || !months)
            return;
        const validationError = inputError();
        if (validationError) {
            Alert.alert("Valeurs invalides", validationError);
            return;
        }
        setLoading(true);
        try {
            setSimulation(await api("/loans/simulate/", { method: "POST", body: JSON.stringify({ club: clubId, amount, duration_months: months }) }));
        }
        catch (error) {
            Alert.alert("Simulation impossible", error instanceof Error ? error.message : "Vérifiez les valeurs.");
        }
        finally {
            setLoading(false);
        }
    }
    async function submit() {
        if (!user.kyc_verified) {
            setResult({ success: false, title: "KYC obligatoire", message: "Votre identite doit etre validee avant une demande d'emprunt.", detail: "Completez votre dossier depuis Mon profil." });
            return;
        }
        if (!simulation || !purpose.trim() || !income) {
            Alert.alert("Dossier incomplet", "Simulez le prêt et renseignez le motif ainsi que votre revenu estimé.");
            return;
        }
        const validationError = inputError();
        if (validationError) {
            setSimulation(undefined);
            Alert.alert("Valeurs invalides", validationError);
            return;
        }
        setLoading(true);
        try {
            await api("/loans/", { method: "POST", body: JSON.stringify({ club: clubId, amount, duration_months: months, purpose: purpose.trim(), estimated_income: income, guarantors: "" }) });
            dispatch(invalidate(["loans", "dashboard", "validations"]));
            setResult({ success: true, title: "Demande envoyee", message: "Votre demande a ete transmise au chef du club et a l'administrateur pour validation.", detail: "Vous serez notifie a chaque nouvelle etape du financement." });
        }
        catch (error) {
            setResult({ success: false, title: "Envoi impossible", message: error instanceof Error ? error.message : "Verifiez les informations et reessayez.", detail: "Aucune demande n'a ete creee." });
        }
        finally {
            setLoading(false);
        }
    }
    return <Screen>
    <PageHeader eyebrow="Simulation" title="Nouveau prêt" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
    {!user.kyc_verified ? <View style={styles.kycBlock}><Text style={styles.kycBlockTitle}>Demande bloquee</Text><Text style={styles.kycBlockText}>Votre KYC doit etre valide avant de soumettre un emprunt.</Text></View> : null}
    <View style={styles.section}><Text style={styles.sectionTitle}>1. Conditions</Text>
      <Text style={styles.label}>Club</Text><View style={styles.clubSelector}>{clubs.map(item => <Pressable key={item.id} onPress={() => { setClubId(item.id); setSimulation(undefined); }} style={[styles.clubOption, item.id === clubId && styles.clubOptionActive]}><Text style={[styles.clubText, item.id === clubId && styles.clubTextActive]}>{item.name}</Text>{item.id === clubId && <Check size={16} color={colors.forest}/>}</Pressable>)}</View>
      <Field label="Montant" value={amount} onChangeText={value => { setAmount(value.replace(/[^0-9.]/g, "")); setSimulation(undefined); }} keyboardType="decimal-pad" placeholder={club ? `De ${money(club.min_loan, club.currency)}` : "Montant"}/>
      {club ? <Text style={styles.hint}>Entre {money(club.min_loan, club.currency)} et {money(club.max_loan, club.currency)}</Text> : null}
      <Field label="Durée en mois" value={months} onChangeText={value => { setMonths(value.replace(/[^0-9]/g, "")); setSimulation(undefined); }} keyboardType="number-pad" placeholder="3"/>
      {club ? <Text style={styles.hint}>Entre {club.min_duration_months} et {club.max_duration_months} mois</Text> : null}
      <Button label="Calculer l’échéancier" icon={Calculator} variant="secondary" onPress={simulate} loading={loading}/>
    </View>
    {simulation && <View style={styles.summary}><Text style={styles.summaryLabel}>Montant total a rembourser</Text><Text style={styles.summaryValue}>{money(simulation.total_due, simulation.currency)}</Text><View style={styles.summaryRows}><Summary label="Echeance mensuelle estimee" value={money(simulation.monthly_payment, simulation.currency)} strong/></View></View>}
    <View style={styles.section}><Text style={styles.sectionTitle}>2. Votre dossier</Text><Field label="Motif du prêt" value={purpose} onChangeText={setPurpose} placeholder="Ex. achat de stock"/><Field label="Revenu mensuel estimé" value={income} onChangeText={value => setIncome(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="Montant"/><Button label="Soumettre la demande" icon={Send} onPress={submit} loading={loading} disabled={!user.kyc_verified}/></View>
    <OperationResultModal result={result} onClose={() => { setResult(undefined); navigation.goBack(); }}/>
  </Screen>;
}
function Summary({ label, value, strong }) { return <View style={styles.summaryRow}><Text style={[styles.summaryRowLabel, strong && styles.strong]}>{label}</Text><Text style={[styles.summaryRowValue, strong && styles.strong]}>{value}</Text></View>; }
const styles = StyleSheet.create({
    kycBlock: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft }, kycBlockTitle: { fontFamily: font.bold, color: colors.danger, fontSize: 12 }, kycBlockText: { marginTop: 3, fontFamily: font.medium, color: colors.danger, fontSize: 9, lineHeight: 15 }, section: { gap: spacing.md }, sectionTitle: { fontFamily: font.bold, fontSize: 17, color: colors.ink }, label: { fontFamily: font.semibold, fontSize: 13, color: colors.ink, marginBottom: -8 }, hint: { marginTop: -spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 15 },
    clubSelector: { gap: spacing.sm }, clubOption: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, clubOptionActive: { backgroundColor: colors.mint, borderColor: colors.mintDark }, clubText: { fontFamily: font.medium, color: colors.ink, fontSize: 13 }, clubTextActive: { fontFamily: font.bold, color: colors.forest },
    summary: { borderRadius: radius.md, backgroundColor: colors.forest, padding: spacing.lg }, summaryLabel: { fontFamily: font.medium, fontSize: 11, color: colors.mint }, summaryValue: { fontFamily: font.bold, fontSize: 28, color: colors.white, marginVertical: spacing.xs }, summaryRows: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: "#35675C", paddingTop: spacing.sm }, summaryRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, summaryRowLabel: { fontFamily: font.regular, color: colors.mint, fontSize: 11 }, summaryRowValue: { fontFamily: font.semibold, color: colors.white, fontSize: 11 }, strong: { fontFamily: font.bold, color: colors.yellow },
});
