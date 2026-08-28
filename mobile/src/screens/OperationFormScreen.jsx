import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, BanknoteArrowDown, Landmark, Megaphone, Send, ShieldAlert, WalletCards } from "lucide-react-native";

import { Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";
import { useDispatch } from "react-redux";
import { invalidate } from "@/store";

const config = {
    deposit: { eyebrow: "Entraide", title: "Faire une mise", icon: WalletCards, button: "Soumettre la mise" },
    withdrawal: { eyebrow: "Fonds disponibles", title: "Demander une recuperation", icon: BanknoteArrowDown, button: "Soumettre la recuperation" },
    dispute: { eyebrow: "Assistance", title: "Ouvrir une réclamation", icon: ShieldAlert, button: "Envoyer la réclamation" },
    support: { eyebrow: "Aide", title: "Contacter le support", icon: ShieldAlert, button: "Envoyer la demande" },
    announcement: { eyebrow: "Communication", title: "Publier une annonce", icon: Megaphone, button: "Publier au club" },
};

export function OperationFormScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const { user } = useAuth();
    const dispatch = useDispatch();
    const mode = route.params?.mode || "dispute";
    const meta = config[mode];
    const [clubs, setClubs] = useState();
    const [clubId, setClubId] = useState("");
    const [amount, setAmount] = useState("");
    const [subject, setSubject] = useState("");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const [balance, setBalance] = useState();
    const [result, setResult] = useState();

    useEffect(() => { api("/clubs/").then(data => { setClubs(data.results); setClubId(data.results[0]?.id || ""); }); }, []);
    useEffect(() => { if (mode === "withdrawal") api("/balance/").then(setBalance).catch(() => {}); }, [mode]);
    if (!clubs) return <LoadingScreen/>;
    const club = clubs.find(item => item.id === clubId);

    const needsClub = mode === "announcement";
    const showClubSelector = ["announcement", "dispute", "support"].includes(mode) && clubs.length > 0;
    const isWalletOperation = ["deposit", "withdrawal"].includes(mode);

    async function submit() {
        if (needsClub && !clubId) return;
        if (mode === "deposit" && !user.kyc_verified) {
            setResult({ success: false, title: "KYC obligatoire", message: "Votre identite doit etre validee avant toute mise communautaire.", detail: "Ouvrez Mon profil puis Mon dossier KYC." });
            return;
        }
        if (mode === "withdrawal" && Number(amount) > Number(balance?.net_available || 0)) {
            setResult({ success: false, title: "Recuperation impossible", message: "Le montant depasse votre fonds disponible.", detail: `Maximum recuperable : ${money(balance?.net_available || 0, balance?.currency || "CDF")}.` });
            return;
        }
        setLoading(true);
        try {
            if (mode === "deposit") await api("/deposits/", { method: "POST", body: JSON.stringify({ lender: user.id, amount, payment_method: "mobile_money" }) });
            if (mode === "withdrawal") await api("/withdrawals/", { method: "POST", body: JSON.stringify({ amount }) });
            if (mode === "dispute") await api("/disputes/", { method: "POST", body: JSON.stringify({ club: clubId || null, operation_type: "other", subject, description }) });
            if (mode === "support") await api("/disputes/", { method: "POST", body: JSON.stringify({ club: clubId || null, operation_type: "support", subject, description }) });
            if (mode === "announcement") await api("/messages/", { method: "POST", body: JSON.stringify({ club: clubId, kind: "announcement", body: description }) });
            const domains = ["dispute", "support"].includes(mode) ? ["disputes", "dashboard"] : mode === "announcement" ? ["messages"] : ["dashboard", "validations", "clubs"];
            dispatch(invalidate(domains));
            const messages = {
                withdrawal: { title: "Demande envoyee", message: "Votre demande de recuperation est maintenant en attente de validation.", detail: `Montant demande : ${money(amount, balance?.currency || club?.currency || "CDF")}. Vous suivrez son traitement dans vos notifications.` },
                deposit: { title: "Mise envoyee", message: "Votre mise a ete transmise pour validation.", detail: "Le fonds disponible sera mis a jour apres validation." },
                dispute: { title: "Reclamation envoyee", message: "Votre dossier a bien ete transmis.", detail: "Vous recevrez une notification apres son traitement." },
                support: { title: "Demande de support envoyee", message: "L'equipe a bien recu votre question.", detail: "Vous recevrez une notification apres son traitement." },
                announcement: { title: "Annonce publiee", message: "Le message est maintenant visible dans le chat du club." },
            };
            setResult({ success: true, ...messages[mode] });
        } catch (error) {
            setResult({ success: false, title: "Operation impossible", message: error instanceof Error ? error.message : "Verifiez les informations.", detail: "Aucune modification financiere n'a ete enregistree." });
        } finally {
            setLoading(false);
        }
    }

    const requiresAmount = ["deposit", "withdrawal"].includes(mode);
    return <Screen>
      <PageHeader eyebrow={meta.eyebrow} title={meta.title} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {mode === "deposit" && !user.kyc_verified ? <View style={styles.kycBlock}><ShieldAlert size={19} color={colors.coral}/><Text style={styles.kycBlockText}>Mise bloquee jusqu'a la validation de votre dossier KYC.</Text></View> : null}
      {mode === "withdrawal" && balance ? <View style={styles.available}><View><Text style={styles.availableLabel}>Maximum recuperable</Text><Text style={styles.availableValue}>{money(balance.net_available, balance.currency)}</Text><Pressable onPress={() => setAmount(String(balance.net_available))} style={styles.maxAction}><Text style={styles.maxActionText}>Utiliser le maximum</Text></Pressable></View><WalletCards size={22} color={colors.forest}/></View> : null}
      {showClubSelector ? <View style={styles.section}><Text style={styles.sectionLabel}>{needsClub ? "Club destinataire" : "Club concerne (facultatif)"}</Text>{clubs.map(item => <Pressable key={item.id} onPress={() => setClubId(item.id === clubId && !needsClub ? "" : item.id)} style={[styles.club, item.id === clubId && styles.clubActive]}><View style={[styles.clubIcon, item.id === clubId && styles.clubIconActive]}><Landmark size={18} color={item.id === clubId ? colors.white : colors.forest}/></View><View style={styles.clubText}><Text style={styles.clubName}>{item.name}</Text><Text style={styles.clubMeta}>{item.zone || "Reference administrative"}</Text></View>{item.id === clubId ? <View style={styles.selected}/> : null}</Pressable>)}</View> : null}
      {isWalletOperation ? <View style={styles.walletNote}><Text style={styles.walletNoteText}>Votre portefeuille de preteur est global : il n'est rattache a aucun club.</Text></View> : null}
      {requiresAmount ? <View style={styles.form}><Field label="Montant" value={amount} onChangeText={value => setAmount(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder={mode === "withdrawal" && balance ? `Maximum ${money(balance.net_available, balance.currency)}` : `Montant en ${club?.currency || "CDF"}`}/>{mode === "deposit" ? <Text style={styles.note}>La mise sera disponible apres validation administrative.</Text> : <Text style={styles.note}>Le plafond correspond a votre fonds disponible total.</Text>}</View> : null}
      {["dispute", "support"].includes(mode) ? <View style={styles.form}><Field label={mode === "support" ? "Votre question" : "Objet de la reclamation"} value={subject} onChangeText={setSubject} placeholder={mode === "support" ? "Ex. comment recuperer mes fonds ?" : "Ex. paiement non comptabilise"}/><Field label="Description detaillee" value={description} onChangeText={setDescription} multiline placeholder="Decrivez les faits et les references utiles"/></View> : null}
      {mode === "announcement" ? <Field label="Message au club" value={description} onChangeText={setDescription} multiline placeholder="Rédigez une information claire pour tous les membres"/> : null}
      <Button label={meta.button} icon={Send} onPress={submit} loading={loading} disabled={(mode === "deposit" && !user.kyc_verified) || (needsClub && !clubId) || (requiresAmount ? !amount : ["dispute", "support"].includes(mode) ? !subject || !description : !description)}/>
      <OperationResultModal result={result} onClose={() => { setResult(undefined); navigation.goBack(); }}/>
    </Screen>;
}

const styles = StyleSheet.create({
    kycBlock: { minHeight: 58, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.coralSoft }, kycBlockText: { flex: 1, fontFamily: font.semibold, color: colors.danger, fontSize: 10, lineHeight: 16 }, available: { minHeight: 112, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.mint }, availableLabel: { fontFamily: font.medium, color: colors.forest, fontSize: 10 }, availableValue: { marginTop: 4, fontFamily: font.bold, color: colors.ink, fontSize: 22 }, maxAction: { alignSelf: "flex-start", marginTop: spacing.sm, paddingVertical: 5, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.white }, maxActionText: { fontFamily: font.bold, color: colors.forest, fontSize: 9 }, section: { gap: spacing.sm }, sectionLabel: { fontFamily: font.bold, color: colors.ink, fontSize: 13 },
    club: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, clubActive: { borderColor: colors.mintDark, backgroundColor: "#F0FAF5" }, clubIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, clubIconActive: { backgroundColor: colors.forest },
    clubText: { flex: 1 }, clubName: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, clubMeta: { fontFamily: font.medium, color: colors.muted, fontSize: 9, marginTop: 3 }, selected: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral },
    walletNote: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sky }, walletNoteText: { fontFamily: font.medium, color: colors.skyDark, fontSize: 10, lineHeight: 15 },
    form: { gap: spacing.md }, note: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16, paddingHorizontal: spacing.xs },
});
