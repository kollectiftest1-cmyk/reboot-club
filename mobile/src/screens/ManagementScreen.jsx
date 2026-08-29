import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { BadgeCheck, ChevronRight, CircleGauge, HandCoins, Landmark, MessageSquareWarning, Settings2, UsersRound, WalletCards } from "lucide-react-native";
import { PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { colors, font, radius, spacing } from "@/theme";

export function ManagementScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const versions = useSelector(state => state.sync.versions);
    const [counts, setCounts] = useState({ validations: {} });
    useEffect(() => { const load = () => api("/activity-counts/").then(setCounts).catch(() => {}); load(); const unsubscribe = navigation.addListener("focus", load); return unsubscribe; }, [navigation, versions]);
    const items = [
        { title: "Comptes et Profils", note: "Ouvrir un compte pour voir ses profils et ses operations", icon: UsersRound, screen: "Members" },
        { title: "Identites", note: "Controler les dossiers KYC et servir les comptes non KYC", icon: BadgeCheck, screen: "Identities", count: counts.identities },
        { title: "Reclamations", note: "Consulter, arbitrer et cloturer les dossiers", icon: MessageSquareWarning, screen: "Disputes", count: counts.disputes },
        { title: user.role === "admin" ? "Gestion des clubs" : "Identite du club", note: user.role === "admin" ? "CRUD, commissions, taux, limites et delais" : "Consulter les regles et modifier uniquement le nom", icon: Landmark, screen: "Settings" },
        { title: "Validations", note: "Adhesions, prets, mises, recuperations et participations", icon: CircleGauge, screen: "Validations", count: counts.validations?.total },
    ];
    if (user.role === "admin") items.unshift({ title: "Operations clients", note: "Mises, recuperations, emprunts et participations assistees", icon: WalletCards, screen: "AdminOperations" });
    if (user.role === "admin") items.splice(1, 0, { title: "Validations par compte", note: "Selectionner un utilisateur et examiner tous ses dossiers", icon: BadgeCheck, screen: "AccountValidations", count: counts.validations?.loans });
    if (user.role === "admin") items.push({ title: "Encaissements", note: "Encaisser les echeances et designer les mandataires", icon: HandCoins, screen: "Collections", count: counts.collections });
    if (user.role === "admin") items.push({ title: "Configuration admin", note: "Taux, objets de pret et securite plateforme", icon: Settings2, screen: "PlatformSettings" });
    if (user.current_profile === "leader" && user.role !== "admin") items.unshift({ title: "Mes commissions", note: "Solde, gains par emprunt, recuperation ou transfert vers le compte preteur", icon: HandCoins, screen: "LeaderCommissions" });
    return <Screen><PageHeader eyebrow={user.role === "admin" ? "Administration plateforme" : "Direction du club"} title="Centre de gestion"/>
      <View style={styles.intro}><Text style={styles.introTitle}>Pilotage operationnel</Text><Text style={styles.introText}>Toutes les decisions sensibles restent tracees dans le journal d'audit.</Text></View>
      <View style={styles.list}>{items.map(({ title, note, icon: Icon, screen, count }) => <Pressable key={screen} onPress={() => navigation.navigate(screen)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}><View style={styles.icon}><Icon size={21} color={colors.forest}/>{count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text></View> : null}</View><View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.note}>{note}</Text></View><ChevronRight size={18} color={colors.muted}/></Pressable>)}</View>
    </Screen>;
}

const styles = StyleSheet.create({
    intro: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, introTitle: { fontFamily: font.bold, color: colors.white, fontSize: 18 }, introText: { fontFamily: font.medium, color: colors.mint, fontSize: 11, lineHeight: 18, marginTop: spacing.xs },
    list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.white }, item: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, icon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }, badge: { position: "absolute", top: -7, right: -7, minWidth: 21, height: 21, paddingHorizontal: 5, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.white }, badgeText: { fontFamily: font.bold, color: colors.white, fontSize: 8 }, copy: { flex: 1 }, title: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, note: { fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 }, pressed: { backgroundColor: colors.paper },
});
