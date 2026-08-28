import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { Archive, ArrowLeft, ChevronRight, CirclePlus, Edit3, Landmark, MapPin, Percent } from "lucide-react-native";

import { Avatar, Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function SettingsScreen() {
    const navigation = useNavigation(); const dispatch = useDispatch(); const { user } = useAuth(); const admin = user.role === "admin";
    const version = useSelector(state => state.sync.versions.clubs); const [clubs, setClubs] = useState();
    const load = useCallback(() => api("/clubs/").then(data => setClubs(data.results)), []);
    useEffect(() => { load(); }, [load, version]); useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    function archive(club) { Alert.alert("Archiver ce club ?", "Les donnees seront conservees.", [{ text: "Annuler", style: "cancel" }, { text: "Archiver", style: "destructive", onPress: async () => { try { await api(`/clubs/${club.id}/`, { method: "DELETE" }); dispatch(invalidate(["clubs", "dashboard"])); } catch (error) { Alert.alert("Action impossible", error.message); } } }]); }
    if (!clubs) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow={admin ? "Administration" : "Direction"} title={admin ? "Gestion des clubs" : "Mon club"} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {admin ? <Button icon={CirclePlus} label="Creer un club" onPress={() => navigation.navigate("ClubForm")}/> : null}
      <View style={styles.intro}><Landmark size={22} color={colors.white}/><View><Text style={styles.introTitle}>{clubs.length} club{clubs.length > 1 ? "s" : ""}</Text><Text style={styles.introText}>L'identite du club et son bareme financier sont configures dans des espaces separes.</Text></View></View>
      {clubs.length ? <View style={styles.list}>{clubs.map(club => <View key={club.id} style={styles.club}><Avatar user={{ name: club.leader_name, avatar: club.leader_avatar, selfie: club.leader_selfie }} size={44}/><View style={styles.copy}><View style={styles.titleRow}><Text style={styles.name}>{club.name}</Text><Status value={club.status}/></View><View style={styles.meta}><MapPin size={12} color={colors.muted}/><Text style={styles.metaText}>{club.zone}</Text></View><Text style={styles.metaText}>Chef: {club.leader_name}</Text></View>{admin ? <Pressable accessibilityLabel={`Bareme de ${club.name}`} onPress={() => navigation.navigate("ClubRateTiers", { club })} style={styles.action}><Percent size={17} color={colors.primary}/></Pressable> : null}<Pressable accessibilityLabel={`Modifier ${club.name}`} onPress={() => navigation.navigate("ClubForm", { club })} style={styles.action}><Edit3 size={17} color={colors.forest}/></Pressable>{admin ? <Pressable accessibilityLabel={`Archiver ${club.name}`} onPress={() => archive(club)} style={styles.action}><Archive size={17} color={colors.danger}/></Pressable> : null}<ChevronRight size={16} color={colors.muted}/></View>)}</View> : <EmptyState icon={Landmark} title="Aucun club" message="Creez le premier club, puis affectez son chef."/>}
    </Screen>;
}

const styles = StyleSheet.create({
    intro: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, introTitle: { fontFamily: font.bold, color: colors.white, fontSize: 16 }, introText: { fontFamily: font.medium, color: colors.mint, fontSize: 9, marginTop: 3, maxWidth: 260 }, list: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.white }, club: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, mark: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.mint }, copy: { flex: 1 }, titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, name: { flex: 1, fontFamily: font.bold, color: colors.ink, fontSize: 13 }, meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 }, metaText: { fontFamily: font.medium, color: colors.muted, fontSize: 9 }, action: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.paper },
});
