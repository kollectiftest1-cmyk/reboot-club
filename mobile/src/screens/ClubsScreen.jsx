import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, HandCoins, Landmark, MapPin, Plus, UsersRound } from "lucide-react-native";
import { Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { apiCached } from "@/lib/api";
import { money } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";

export function ClubsScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const [clubs, setClubs] = useState();
    const [offline, setOffline] = useState(false);
    const version = useSelector(state => state.sync.versions.clubs);
    const admin = user.role === "admin";
    const load = useCallback(async () => {
        const result = await apiCached("/clubs/", "clubs");
        setClubs(result.data.results);
        setOffline(result.offline);
    }, []);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);

    if (!clubs) return <LoadingScreen/>;

    return <Screen offline={offline}>
    <PageHeader eyebrow="Communautes" title={admin ? "Gestion des clubs" : "Mes clubs"}
      action={admin ? <IconButton icon={Plus} label="Creer un club" onPress={() => navigation.navigate("ClubForm")}/> : undefined}/>
    {admin ? <Button icon={Plus} label="Creer un nouveau club" variant="secondary" onPress={() => navigation.navigate("ClubForm")}/> : null}
    {clubs.length ? <View style={styles.list}>{clubs.map(club => <Pressable key={club.id} onPress={() => navigation.navigate("ClubDetail", { clubId: club.id })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardTop}><View style={styles.clubMark}><Landmark size={22} color={colors.white}/></View><View style={styles.clubTitle}><Text style={styles.name}>{club.name}</Text><View style={styles.location}><MapPin size={12} color={colors.muted}/><Text style={styles.zone}>{club.zone}</Text></View></View><Status value={club.status}/></View>
      <Text style={styles.description} numberOfLines={2}>{club.description}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><UsersRound size={16} color={colors.mintDark}/><View><Text style={styles.metricValue}>{club.member_count}</Text><Text style={styles.metricLabel}>Membres</Text></View></View>
        <View style={styles.metric}><HandCoins size={16} color={colors.coral}/><View><Text style={styles.metricValue}>{money(club.finances?.engaged || 0, club.currency)}</Text><Text style={styles.metricLabel}>Encours de credit</Text></View></View>
        <ChevronRight size={19} color={colors.muted}/>
      </View>
      {admin ? <View style={styles.adminRow}>
        <Text style={styles.adminRate}>Emprunteur : {club.borrower_charge_rate} %</Text>
        <Pressable onPress={() => navigation.navigate("ClubForm", { club })} style={({ pressed }) => [styles.editLink, pressed && styles.pressed]}><Text style={styles.editLinkText}>Modifier</Text></Pressable>
      </View> : null}
    </Pressable>)}</View> : <EmptyState icon={Landmark} title="Aucun club" message={admin ? "Creez un premier club pour commencer." : "Vos adhesions actives apparaitront ici."}/>}
  </Screen>;
}

const styles = StyleSheet.create({
    list: { gap: spacing.md }, card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: spacing.md }, pressed: { opacity: .72 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, clubMark: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" }, clubTitle: { flex: 1 },
    name: { fontFamily: font.bold, color: colors.ink, fontSize: 15 }, location: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }, zone: { fontFamily: font.regular, color: colors.muted, fontSize: 11 },
    description: { fontFamily: font.regular, color: colors.muted, fontSize: 12, lineHeight: 18 }, metrics: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md },
    metric: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }, metricValue: { fontFamily: font.bold, fontSize: 12, color: colors.ink }, metricLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 9 },
    adminRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
    adminRate: { fontFamily: font.semibold, color: colors.mintDark, fontSize: 10 },
    editLink: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.mint },
    editLinkText: { fontFamily: font.bold, color: colors.forest, fontSize: 10 },
});
