import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, BadgePlus, Save, ShieldAlert } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const labels = { lender: "Preteur", borrower: "Emprunteur", collector: "Mandataire d'encaissement" };

export function MemberProfileAddScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const dispatch = useDispatch();
    const member = route.params.member;
    const [clubs, setClubs] = useState();
    const [role, setRole] = useState("");
    const [clubId, setClubId] = useState("");
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState();

    useEffect(() => { api("/clubs/discover/").then(data => setClubs(data.results || [])).catch(() => setClubs([])); }, []);
    const options = useMemo(() => {
        const active = new Set(member.available_profiles || []);
        return ["lender", "borrower", "collector"].filter(item => !active.has(item)).map(item => ({ value: item, label: labels[item], note: item === "borrower" ? "Profil rattache a un club" : "Profil global" }));
    }, [member.available_profiles]);

    async function save() {
        setSaving(true);
        try {
            await api(`/users/${member.id}/add-profile/`, { method: "POST", body: JSON.stringify({ role, club: role === "borrower" ? clubId : null }) });
            dispatch(invalidate(["members", "clubs", "dashboard", "validations", "notifications"]));
            setResult({ success: true, title: "Profil ajoute", message: `Le profil ${labels[role].toLowerCase()} de ${member.name} est maintenant actif.`, detail: role === "borrower" ? "Le profil est rattache au club selectionne." : "Ce profil est global et peut etre utilise immediatement." });
        } catch (error) { setResult({ success: false, title: "Ajout impossible", message: error.message }); }
        finally { setSaving(false); }
    }

    if (!clubs) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow="Administration" title="Ajouter un profil" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.member}><Avatar user={member} size={48}/><View style={styles.copy}><Text style={styles.name}>{member.name}</Text><Text style={styles.phone}>{member.phone}</Text></View></View>
      {!member.kyc_verified ? <View style={styles.warning}><ShieldAlert size={19} color={colors.coral}/><Text style={styles.warningText}>Le KYC de ce compte doit etre valide avant l'activation d'un profil financier.</Text></View> : null}
      {options.length ? <View style={styles.form}><Select label="Profil manquant" value={role} options={options} onChange={value => { setRole(value); setClubId(""); }} placeholder="Choisir le profil a activer"/>{role === "borrower" ? <Select label="Club du profil emprunteur" value={clubId} searchable options={clubs.map(club => ({ value: club.id, label: club.name, note: club.zone }))} onChange={setClubId} placeholder="Rechercher et choisir un club"/> : null}<Button icon={Save} label="Activer ce profil" loading={saving} disabled={!member.kyc_verified || !role || (role === "borrower" && !clubId)} onPress={save}/></View> : <View style={styles.complete}><BadgePlus size={22} color={colors.mintDark}/><Text style={styles.completeText}>Tous les profils administrables sont deja actifs sur ce compte.</Text></View>}
      <OperationResultModal result={result} onClose={() => { const success = result?.success; setResult(undefined); if (success) navigation.goBack(); }}/>
    </Screen>;
}

const styles = StyleSheet.create({ member: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, copy: { flex: 1 }, name: { fontFamily: font.bold, color: colors.white, fontSize: 14 }, phone: { marginTop: 3, fontFamily: font.medium, color: colors.mint, fontSize: 10 }, form: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, warning: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft }, warningText: { flex: 1, fontFamily: font.semibold, color: colors.danger, fontSize: 10, lineHeight: 16 }, complete: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, completeText: { fontFamily: font.semibold, color: colors.forest, fontSize: 11, textAlign: "center" } });
