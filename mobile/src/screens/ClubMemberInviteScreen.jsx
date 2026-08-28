import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, Phone, Send, UserRoundPlus } from "lucide-react-native";
import { useDispatch } from "react-redux";
import { Button, Field, IconButton, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function ClubMemberInviteScreen() {
    const navigation = useNavigation(); const route = useRoute(); const dispatch = useDispatch();
    const { user } = useAuth();
    const admin = user.role === "admin";
    const { clubId, clubName } = route.params; const [phone, setPhone] = useState("+243"); const [saving, setSaving] = useState(false);
    async function submit() {
        setSaving(true);
        try {
            const found = await api(`/users/by-phone/?phone=${encodeURIComponent(phone)}`);
            await api("/memberships/invite/", { method: "POST", body: JSON.stringify({ club: clubId, phone: found.phone, role: "borrower" }) });
            dispatch(invalidate(["members", "validations", "notifications", "clubs"]));
            Alert.alert(admin ? "Membre ajoute" : "Invitation envoyee", admin ? `${found.name} est maintenant emprunteur actif dans ce club. Aucune confirmation du membre n'est requise.` : `${found.name} doit confirmer l'invitation. L'administrateur effectuera ensuite la validation finale.`, [{ text: "Terminer", onPress: () => navigation.goBack() }]);
        } catch (error) { Alert.alert("Invitation impossible", error.message); }
        finally { setSaving(false); }
    }
    return <Screen>
      <PageHeader eyebrow="Adhesion controlee" title={`Ajouter a ${clubName}`} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.flow}>{(admin ? ["Recherchez le compte par son numero.", "L'ajout administratif active directement le profil.", "Le membre est notifie de la modification."] : ["Le chef envoie la demande.", "Le membre accepte depuis son accueil.", "L'administrateur valide l'adhesion."]).map((text, index) => <View key={text} style={styles.step}><Text style={styles.number}>{index + 1}</Text><Text style={styles.stepText}>{text}</Text></View>)}</View>
    <View style={styles.form}><UserRoundPlus size={24} color={colors.mintDark}/><Field icon={Phone} label="Numero du compte existant" value={phone} keyboardType="phone-pad" onChangeText={setPhone} placeholder="+243..."/><Text style={styles.label}>Profil dans le club</Text><Text style={styles.borrowerOnly}>Emprunteur uniquement. Le profil preteur est global et ne rejoint aucun club.</Text></View>
      <Button icon={Send} label={admin ? "Ajouter directement au club" : "Envoyer la demande"} loading={saving} disabled={phone.replace(/\D/g, "").length < 10} onPress={submit}/>
    </Screen>;
}
const styles = StyleSheet.create({ flow: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, step: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.sm }, number: { width: 26, height: 26, lineHeight: 26, borderRadius: 13, textAlign: "center", fontFamily: font.bold, color: colors.forest, backgroundColor: colors.mint }, stepText: { flex: 1, fontFamily: font.medium, color: colors.white, fontSize: 10 }, form: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, label: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, borrowerOnly: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 } });
