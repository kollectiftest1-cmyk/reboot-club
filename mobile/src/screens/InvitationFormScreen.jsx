import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Phone, Send, UserPlus } from "lucide-react-native";
import { useDispatch } from "react-redux";
import { Button, Field, IconButton, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const labels = { admin: "Administrateur", leader: "Chef de club", lender: "Preteur", borrower: "Emprunteur" };
export function InvitationFormScreen() {
    const navigation = useNavigation(); const dispatch = useDispatch(); const { user } = useAuth();
    const [clubs, setClubs] = useState([]); const [saving, setSaving] = useState(false); const [form, setForm] = useState({ phone: "+243", email: "", role: user.role === "leader" ? "borrower" : "leader", club: "" });
    useEffect(() => { api("/clubs/").then(data => { setClubs(data.results); setForm(current => ({ ...current, club: data.results[0]?.id || "" })); }); }, []);
    const roles = user.role === "admin" ? ["admin", "leader", "borrower"] : ["borrower"];
    async function submit() { setSaving(true); try { await api("/invitations/", { method: "POST", body: JSON.stringify(form) }); dispatch(invalidate(["members"])); Alert.alert("Invitation creee", "Le lien securise est maintenant disponible dans la liste.", [{ text: "Terminer", onPress: () => navigation.goBack() }]); } catch (error) { Alert.alert("Invitation impossible", error.message); } finally { setSaving(false); } }
    return <Screen>
      <PageHeader eyebrow="Nouvel acces" title="Creer une invitation" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.hero}><UserPlus size={23} color={colors.mint}/><Text style={styles.heroText}>Definissez le compte et le club avant de generer le lien securise.</Text></View>
      <View style={styles.form}><Field icon={Phone} label="Telephone" value={form.phone} keyboardType="phone-pad" onChangeText={phone => setForm({ ...form, phone })}/><Field label="E-mail facultatif" value={form.email} keyboardType="email-address" autoCapitalize="none" onChangeText={email => setForm({ ...form, email })}/><Text style={styles.label}>Role propose</Text><View style={styles.options}>{roles.map(role => <Pressable key={role} onPress={() => setForm({ ...form, role })} style={[styles.option, form.role === role && styles.active]}><Text style={[styles.optionText, form.role === role && styles.activeText]}>{labels[role]}</Text></Pressable>)}</View><Text style={styles.label}>Club</Text><View style={styles.clubList}>{clubs.map(club => <Pressable key={club.id} onPress={() => setForm({ ...form, club: club.id })} style={[styles.club, form.club === club.id && styles.clubActive]}><Text style={[styles.clubText, form.club === club.id && styles.clubTextActive]}>{club.name}</Text></Pressable>)}</View></View>
      <Button icon={Send} label="Creer l'invitation" loading={saving} disabled={!form.phone || !form.club} onPress={submit}/>
    </Screen>;
}
const styles = StyleSheet.create({ hero: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, heroText: { flex: 1, fontFamily: font.medium, color: colors.white, fontSize: 10, lineHeight: 16 }, form: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, label: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, option: { minHeight: 42, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }, active: { backgroundColor: colors.forest, borderColor: colors.forest }, optionText: { fontFamily: font.semibold, color: colors.muted, fontSize: 10 }, activeText: { color: colors.white }, clubList: { gap: spacing.sm }, club: { minHeight: 46, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }, clubActive: { backgroundColor: colors.mint, borderColor: colors.mintDark }, clubText: { fontFamily: font.semibold, color: colors.ink, fontSize: 11 }, clubTextActive: { color: colors.forest } });
