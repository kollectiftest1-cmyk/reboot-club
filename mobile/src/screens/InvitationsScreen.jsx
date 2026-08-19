import { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { ArrowLeft, Link2, UserPlus } from "lucide-react-native";
import { Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

const labels = { admin: "Administrateur", leader: "Chef de club", lender: "Preteur", borrower: "Emprunteur" };
export function InvitationsScreen() {
    const navigation = useNavigation(); const version = useSelector(state => state.sync.versions.members); const [items, setItems] = useState();
    const load = useCallback(() => api("/invitations/").then(data => setItems(data.results)), []);
    useEffect(() => { load(); }, [load, version]); useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    if (!items) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow="Acces controle" title="Invitations" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <Button icon={UserPlus} label="Nouvelle invitation" onPress={() => navigation.navigate("InvitationForm")}/>
      <Text style={styles.heading}>Invitations recentes</Text>
      {items.length ? <View style={styles.list}>{items.map(item => <Pressable key={item.id} onPress={() => Share.share({ message: `REBOOT CLUB: invitation ${labels[item.role]} pour ${item.club_name || "la plateforme"}. Code: ${item.token}` })} style={styles.item}><View style={styles.icon}><Link2 size={18} color={colors.forest}/></View><View style={styles.copy}><Text style={styles.phone}>{item.phone}</Text><Text style={styles.meta}>{item.club_name || "Plateforme"} - expire {shortDate(item.expires_at)}</Text></View><Status value={item.status}/></Pressable>)}</View> : <EmptyState icon={UserPlus} title="Aucune invitation" message="Creez une invitation pour ajouter un responsable ou un membre."/>}
    </Screen>;
}
const styles = StyleSheet.create({ heading: { fontFamily: font.bold, color: colors.ink, fontSize: 16 }, list: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.white }, item: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.sky, alignItems: "center", justifyContent: "center" }, copy: { flex: 1 }, phone: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, meta: { fontFamily: font.medium, color: colors.muted, fontSize: 9, marginTop: 3 } });
