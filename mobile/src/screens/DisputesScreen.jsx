import { useEffect, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, CheckCircle2, MessageSquareWarning } from "lucide-react-native";

import { Avatar, Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function DisputesScreen() {
    const navigation = useNavigation(); const dispatch = useDispatch(); const version = useSelector(state => state.sync.versions.disputes); const [items, setItems] = useState();
    useEffect(() => { api("/disputes/").then(data => setItems(data.results)); }, [version]);
    function resolve(item) { if (Platform.OS === "ios") return Alert.prompt("Decision motivee", "Indiquez la solution communiquee au membre.", async decision => { if (!decision?.trim()) return; try { await api(`/disputes/${item.id}/resolve/`, { method: "POST", body: JSON.stringify({ decision, status: "resolved" }) }); dispatch(invalidate(["disputes", "dashboard", "notifications"])); } catch (error) { Alert.alert("Traitement impossible", error.message); } }); Alert.alert("Traiter la reclamation", "Confirmez la resolution du dossier. La decision sera tracee.", [{ text: "Annuler", style: "cancel" }, { text: "Marquer resolue", onPress: async () => { try { await api(`/disputes/${item.id}/resolve/`, { method: "POST", body: JSON.stringify({ decision: "Dossier controle et resolu par le responsable.", status: "resolved" }) }); dispatch(invalidate(["disputes", "dashboard"])); } catch (error) { Alert.alert("Traitement impossible", error.message); } } }]); }
    if (!items) return <LoadingScreen/>;
    return <Screen><PageHeader eyebrow="Assistance et mediation" title="Reclamations" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>{items.length ? <View style={styles.list}>{items.map(item => <View key={item.id} style={styles.item}><View style={styles.header}><Avatar user={{ name: item.opened_by_name, avatar: item.opened_by_avatar, selfie: item.opened_by_selfie }} size={42}/><View style={styles.copy}><Text style={styles.subject}>{item.subject}</Text><Text style={styles.meta}>{item.opened_by_name} - {shortDate(item.created_at)}</Text></View><Status value={item.status}/></View><Text style={styles.description}>{item.description}</Text>{item.decision ? <View style={styles.decision}><Text style={styles.decisionText}>{item.decision}</Text></View> : <Button icon={CheckCircle2} variant="secondary" label="Traiter" onPress={() => resolve(item)}/>}</View>)}</View> : <EmptyState icon={MessageSquareWarning} title="Aucune reclamation" message="Les dossiers ouverts par les membres seront centralises ici."/>}</Screen>;
}

const styles = StyleSheet.create({ list: { gap: spacing.md }, item: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, header: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, copy: { flex: 1 }, subject: { fontFamily: font.bold, color: colors.ink, fontSize: 14 }, meta: { fontFamily: font.medium, color: colors.muted, fontSize: 9, marginTop: 4 }, description: { fontFamily: font.regular, color: colors.ink, fontSize: 11, lineHeight: 18 }, decision: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.mint }, decisionText: { fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 } });
