import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Bell, CheckCheck } from "lucide-react-native";
import { useDispatch } from "react-redux";
import { Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { shortDate } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

export function NotificationsScreen() {
    const navigation = useNavigation(); const dispatch = useDispatch(); const [items, setItems] = useState();
    const load = useCallback(() => api("/notifications/").then(data => setItems(data.results)), []);
    useEffect(() => { load(); }, [load]);
    if (!items) return <LoadingScreen/>;
    async function read(item) { if (!item.read_at) { await api(`/notifications/${item.id}/read/`, { method: "POST" }); dispatch(invalidate(["notifications"])); } }
    async function readAll() { await api("/notifications/read-all/", { method: "POST" }); dispatch(invalidate(["notifications"])); load(); }
    async function answer(item, accept) {
        try {
            await api(`/memberships/${item.data.membership}/accept/`, { method: "POST", body: JSON.stringify({ accept }) });
            await read(item); await load();
            Alert.alert(accept ? "Invitation acceptee" : "Invitation refusee", accept ? "L'administrateur doit maintenant valider votre adhesion." : "La demande a ete fermee.");
        } catch (error) { Alert.alert("Action impossible", error.message); }
    }
    return <Screen>
      <PageHeader eyebrow="Centre d'activite" title="Notifications" action={<View style={styles.headerActions}><IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/><IconButton icon={CheckCheck} label="Tout marquer comme lu" onPress={readAll}/></View>}/>
      {items.length ? <View style={styles.list}>{items.map(item => <View key={item.id} style={[styles.item, !item.read_at && styles.unread]}><Pressable onPress={async () => { await read(item); load(); }} style={styles.itemMain}><View style={[styles.icon, !item.read_at && styles.iconUnread]}><Bell size={18} color={colors.forest}/></View><View style={styles.text}><Text style={styles.title}>{item.title}</Text><Text style={styles.message}>{item.message}</Text><Text style={styles.date}>{shortDate(item.created_at)}</Text></View>{!item.read_at ? <View style={styles.dot}/> : null}</Pressable>{item.kind === "club_invitation" && !item.read_at ? <View style={styles.inviteActions}><View style={styles.inviteButton}><Button label="Refuser" variant="ghost" onPress={() => answer(item, false)}/></View><View style={styles.inviteButton}><Button label="Accepter" onPress={() => answer(item, true)}/></View></View> : null}</View>)}</View> : <EmptyState icon={Bell} title="Tout est a jour" message="Vos confirmations, alertes et rappels apparaitront ici."/>}
    </Screen>;
}
const styles = StyleSheet.create({ headerActions: { flexDirection: "row", gap: spacing.sm }, list: { borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line }, item: { minHeight: 100, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, itemMain: { flexDirection: "row", gap: spacing.sm }, unread: { backgroundColor: "#F0FAF5" }, icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" }, iconUnread: { backgroundColor: colors.mint }, text: { flex: 1, gap: 3 }, title: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, message: { fontFamily: font.regular, color: colors.muted, fontSize: 11, lineHeight: 17 }, date: { fontFamily: font.medium, color: colors.muted, fontSize: 9, marginTop: 2 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.coral, marginTop: 6 }, inviteActions: { flexDirection: "row", gap: spacing.sm, paddingLeft: 48 }, inviteButton: { flex: 1 } });
