import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, KeyRound, Phone, Save, ShieldCheck } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Button, Field, IconButton, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const labels = { admin: "Administrateur", leader: "Chef de club", lender: "Preteur", borrower: "Emprunteur", mediator: "Mediateur", collector: "Mandataire d'encaissement" };
const blank = { first_name: "", last_name: "", phone: "+243", password: "", role: "borrower", club: "" };

export function MemberFormScreen() {
    const navigation = useNavigation(); const route = useRoute(); const dispatch = useDispatch(); const { user } = useAuth();
    const member = route.params?.member; const editing = Boolean(member); const admin = user.role === "admin";
    const [clubs, setClubs] = useState([]); const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(member ? { first_name: member.first_name, last_name: member.last_name, phone: member.phone, password: "", role: member.role, club: "" } : { ...blank, role: "borrower" });
    useEffect(() => { api("/clubs/").then(data => { setClubs(data.results); setForm(current => ({ ...current, club: current.club || data.results[0]?.id || "" })); }); }, []);
    const roles = admin ? ["admin", "leader", "lender", "borrower", "mediator", "collector"] : ["borrower"];
    const needsClub = !editing && form.role === "borrower";

    async function save() {
        const normalizedPhone = form.phone.replace(/[\s\-().]/g, "");
        if (!/^\+\d{9,}$/.test(normalizedPhone)) return Alert.alert("Telephone invalide", "Utilisez le format international, par exemple +243810000000.");
        if (!editing && (form.password.length < 8 || /^\d+$/.test(form.password))) return Alert.alert("Mot de passe invalide", "Utilisez au moins 8 caracteres avec des lettres et des chiffres. Le mot de passe ne peut pas etre uniquement numerique.");
        setSaving(true);
        try {
            if (editing) { const { password, club, ...payload } = form; await api(`/users/${member.id}/`, { method: "PATCH", body: JSON.stringify({ ...payload, phone: normalizedPhone }) }); }
            else await api("/users/", { method: "POST", body: JSON.stringify({ ...form, phone: normalizedPhone, club: needsClub ? form.club : undefined }) });
            dispatch(invalidate(["members", "dashboard", "validations"]));
            Alert.alert("Compte enregistre", form.role === "collector" ? "Le compte et son profil mandataire sont actifs. Il apparait maintenant dans les listes de mandataires." : "Les informations du membre sont a jour.", [{ text: "Terminer", onPress: () => navigation.goBack() }]);
        } catch (error) { Alert.alert("Enregistrement impossible", error.message); }
        finally { setSaving(false); }
    }

    return <Screen>
      <PageHeader eyebrow={editing ? "Modification" : "Nouveau compte"} title={editing ? member.name : "Creer un membre"} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.identity}><ShieldCheck size={23} color={colors.mintDark}/><View><Text style={styles.identityTitle}>Identite du membre</Text><Text style={styles.identityText}>Le numero de telephone sera son identifiant de connexion.</Text></View></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Informations personnelles</Text><View style={styles.row}><View style={styles.half}><Field label="Prenom" value={form.first_name} onChangeText={value => setForm({ ...form, first_name: value })}/></View><View style={styles.half}><Field label="Nom" value={form.last_name} onChangeText={value => setForm({ ...form, last_name: value })}/></View></View><Field icon={Phone} label="Telephone" value={form.phone} keyboardType="phone-pad" onChangeText={value => setForm({ ...form, phone: value })}/>{!editing ? <><Field icon={KeyRound} label="Mot de passe temporaire" value={form.password} secureTextEntry onChangeText={value => setForm({ ...form, password: value })}/><Text style={styles.hint}>Au moins 8 caracteres, avec des lettres et des chiffres.</Text></> : null}</View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Role principal</Text><View style={styles.options}>{roles.map(role => <Pressable key={role} onPress={() => setForm({ ...form, role })} style={[styles.option, form.role === role && styles.active]}><Text style={[styles.optionText, form.role === role && styles.activeText]}>{labels[role]}</Text></Pressable>)}</View>{form.role === "collector" ? <Text style={styles.profileNote}>Ce profil sera actif immediatement et pourra recevoir des mandats sur les prets individuels et collectifs.</Text> : null}{needsClub ? <><Text style={styles.sectionTitle}>Club initial</Text><View style={styles.clubOptions}>{clubs.map(club => <Pressable key={club.id} onPress={() => setForm({ ...form, club: club.id })} style={[styles.club, form.club === club.id && styles.clubActive]}><Text style={[styles.clubText, form.club === club.id && styles.clubTextActive]}>{club.name}</Text></Pressable>)}</View></> : null}</View>
      <Button icon={Save} label={editing ? "Enregistrer les modifications" : "Creer le compte"} loading={saving} disabled={!form.first_name || !form.last_name || !form.phone || (!editing && !form.password) || (needsClub && !form.club)} onPress={save}/>
    </Screen>;
}

const styles = StyleSheet.create({
    identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, identityTitle: { fontFamily: font.bold, color: colors.forest, fontSize: 13 }, identityText: { fontFamily: font.medium, color: colors.mintDark, fontSize: 9, marginTop: 3 }, section: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 15 }, hint: { marginTop: -spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14 }, profileNote: { padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.mint, fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 }, row: { flexDirection: "row", gap: spacing.sm }, half: { flex: 1 }, options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, option: { minHeight: 42, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }, active: { backgroundColor: colors.forest, borderColor: colors.forest }, optionText: { fontFamily: font.semibold, color: colors.muted, fontSize: 10 }, activeText: { color: colors.white }, clubOptions: { gap: spacing.sm }, club: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }, clubActive: { backgroundColor: colors.mint, borderColor: colors.mintDark }, clubText: { fontFamily: font.semibold, color: colors.ink, fontSize: 11 }, clubTextActive: { color: colors.forest },
});
