import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, BadgeCheck, ChevronRight, Edit3, Eye, Trash2, UserPlus, UsersRound } from "lucide-react-native";

import { Avatar, Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const labels = { admin: "Administrateur", leader: "Chef de club", lender: "Preteur", borrower: "Emprunteur", mediator: "Mediateur", collector: "Mandataire d'encaissement" };

export function MembersScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const { user } = useAuth();
    const admin = user.role === "admin";
    const version = useSelector(state => state.sync.versions.members);
    const [members, setMembers] = useState();
    const [memberships, setMemberships] = useState([]);
    const load = useCallback(() => Promise.all([api("/users/"), api("/memberships/")]).then(([users, links]) => { setMembers(users.results); setMemberships(links.results || []); }), []);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);

    function deactivate(member) {
        Alert.alert("Desactiver ce compte ?", `${member.name} ne pourra plus se connecter.`, [
            { text: "Annuler", style: "cancel" },
            { text: "Desactiver", style: "destructive", onPress: async () => {
                try { await api(`/users/${member.id}/`, { method: "DELETE" }); dispatch(invalidate(["members", "dashboard"])); }
                catch (error) { Alert.alert("Action impossible", error.message); }
            } },
        ]);
    }

    if (!members) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow="Gouvernance" title="Comptes et Profils" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.toolbar}><View><Text style={styles.count}>{members.length}</Text><Text style={styles.countLabel}>comptes visibles</Text></View><View style={styles.add}><Button icon={UserPlus} label="Nouveau" onPress={() => navigation.navigate("MemberForm")}/></View></View>
      {members.length ? <View style={styles.list}>{members.map(member => { const links = memberships.filter(item => item.user === member.id && item.status === "active"); const profileLines = []; if (member.role === "admin") profileLines.push("Administrateur de la plateforme"); if (member.lender_profile_status === "active") profileLines.push("Preteur - Tous les clubs"); links.filter(item => item.role === "leader").forEach(item => profileLines.push(`Chef de club - ${item.club_name}`)); links.filter(item => item.role === "borrower").forEach(item => profileLines.push(`Emprunteur - ${item.club_name}`)); if (!profileLines.length) profileLines.push(labels[member.role] || "Profil non defini"); return <View key={member.id} style={styles.member}>
        <Avatar user={member} size={42}/>
        <Pressable accessibilityLabel={`Ouvrir la situation de ${member.name}`} onPress={() => navigation.navigate("MemberDetail", { memberId: member.id })} style={styles.copy}><View style={styles.nameRow}><Text style={styles.name}>{member.name}</Text>{member.kyc_verified ? <BadgeCheck size={16} color={colors.mintDark}/> : null}</View><Text style={styles.phone}>{member.phone}</Text>{profileLines.map(line => <Text key={line} style={styles.role}>{line}</Text>)}{!member.is_active ? <Text style={styles.disabledText}>Compte desactive</Text> : null}</Pressable>
        <Pressable accessibilityLabel={`Ouvrir ${member.name}`} onPress={() => navigation.navigate("MemberDetail", { memberId: member.id })} style={styles.action}><Eye size={17} color={colors.forest}/></Pressable>
        {admin ? <Pressable accessibilityLabel={`Modifier ${member.name}`} onPress={() => navigation.navigate("MemberForm", { member })} style={styles.action}><Edit3 size={17} color={colors.forest}/></Pressable> : null}
        {admin ? <Pressable accessibilityLabel={`Desactiver ${member.name}`} onPress={() => deactivate(member)} style={styles.action}><Trash2 size={17} color={colors.danger}/></Pressable> : null}
        <ChevronRight size={16} color={colors.muted}/>
      </View>; })}</View> : <EmptyState icon={UsersRound} title="Aucun membre" message="Les comptes crees apparaitront ici."/>}
    </Screen>;
}

const styles = StyleSheet.create({
    toolbar: { minHeight: 86, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, count: { fontFamily: font.bold, color: colors.white, fontSize: 25 }, countLabel: { fontFamily: font.medium, color: colors.mint, fontSize: 10 }, add: { width: 132 },
    list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.white }, member: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, initial: { fontFamily: font.bold, color: colors.forest, fontSize: 16 }, copy: { flex: 1 }, nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, name: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, phone: { fontFamily: font.medium, color: colors.ink, fontSize: 10, marginTop: 3 }, role: { fontFamily: font.medium, color: colors.muted, fontSize: 8, marginTop: 2 }, disabledText: { fontFamily: font.bold, color: colors.danger, fontSize: 8, marginTop: 3 }, action: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.paper },
});
