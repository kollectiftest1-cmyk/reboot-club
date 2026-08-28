import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, CirclePlus, Percent, Save, Trash2, X } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Button, EmptyState, Field, IconButton, LoadingScreen, PageHeader, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const blank = { min_amount: "", max_amount: "", interest_rate: "", leader_commission_rate: "", platform_fee_rate: "" };

export function ClubRateTiersScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const dispatch = useDispatch();
    const club = route.params.club;
    const [tiers, setTiers] = useState();
    const [editing, setEditing] = useState();
    const [form, setForm] = useState(blank);
    const [saving, setSaving] = useState(false);
    const load = useCallback(() => api(`/club-rate-tiers/?club=${club.id}`).then(data => setTiers(data.results || [])), [club.id]);
    useEffect(() => { load(); }, [load]);
    if (!tiers) return <LoadingScreen/>;

    function openEditor(tier) {
        setEditing(tier || { id: null });
        setForm(tier ? Object.fromEntries(Object.keys(blank).map(key => [key, String(tier[key] ?? "")])) : blank);
    }
    function closeEditor() { setEditing(undefined); setForm(blank); }
    async function save() {
        if (!form.min_amount || !form.interest_rate || !form.leader_commission_rate || !form.platform_fee_rate) return Alert.alert("Tranche incomplete", "Renseignez la borne minimale et les trois taux.");
        setSaving(true);
        try {
            const body = JSON.stringify({ club: club.id, ...form, max_amount: form.max_amount || null });
            await api(editing.id ? `/club-rate-tiers/${editing.id}/` : "/club-rate-tiers/", { method: editing.id ? "PATCH" : "POST", body });
            dispatch(invalidate(["clubs", "loans", "settings"]));
            await load(); closeEditor();
        } catch (error) { Alert.alert("Enregistrement impossible", error.message); }
        finally { setSaving(false); }
    }
    function remove(tier) {
        Alert.alert("Supprimer cette tranche ?", "Les prets deja crees conserveront leurs taux historiques.", [{ text: "Annuler", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: async () => { try { await api(`/club-rate-tiers/${tier.id}/`, { method: "DELETE" }); await load(); } catch (error) { Alert.alert("Suppression impossible", error.message); } } }]);
    }
    return <Screen>
      <PageHeader eyebrow="Regles du club" title={`Bareme de ${club.name}`} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.intro}><Percent size={22} color={colors.primary}/><View style={styles.flex}><Text style={styles.introTitle}>Tarification par montant</Text><Text style={styles.introText}>Une seule tranche doit couvrir chaque montant autorise. Le cout global est presente a l'emprunteur, sans detail de repartition.</Text></View></View>
      {!editing ? <Button icon={CirclePlus} label="Ajouter une tranche" onPress={() => openEditor()}/> : null}
      {editing ? <View style={styles.editor}><View style={styles.editorTop}><Text style={styles.editorTitle}>{editing.id ? "Modifier la tranche" : "Nouvelle tranche"}</Text><Pressable accessibilityLabel="Fermer" onPress={closeEditor} style={styles.close}><X size={18} color={colors.ink}/></Pressable></View><View style={styles.row}><View style={styles.half}><Field label="De" value={form.min_amount} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, min_amount: value.replace(/[^0-9.]/g, "") })}/></View><View style={styles.half}><Field label="A (vide = sans limite)" value={form.max_amount} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, max_amount: value.replace(/[^0-9.]/g, "") })}/></View></View><Field label="Interet preteur %" value={form.interest_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, interest_rate: value.replace(/[^0-9.]/g, "") })}/><Field label="Commission chef du club %" value={form.leader_commission_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, leader_commission_rate: value.replace(/[^0-9.]/g, "") })}/><Field label="Frais de service application %" value={form.platform_fee_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, platform_fee_rate: value.replace(/[^0-9.]/g, "") })}/><View style={styles.total}><Text style={styles.totalLabel}>Cout communautaire global</Text><Text style={styles.totalValue}>{(Number(form.interest_rate || 0) + Number(form.leader_commission_rate || 0) + Number(form.platform_fee_rate || 0)).toFixed(2)} %</Text></View><Button icon={Save} label="Enregistrer la tranche" onPress={save} loading={saving}/></View> : null}
      {tiers.length ? <View style={styles.list}>{tiers.map(tier => <Pressable key={tier.id} onPress={() => openEditor(tier)} style={({ pressed }) => [styles.tier, pressed && styles.pressed]}><View style={styles.range}><Text style={styles.rangeLabel}>Montant concerne</Text><Text style={styles.rangeValue}>{money(tier.min_amount, club.currency)} - {tier.max_amount ? money(tier.max_amount, club.currency) : "sans limite"}</Text></View><View style={styles.rates}><Rate label="Preteur" value={tier.interest_rate}/><Rate label="Chef" value={tier.leader_commission_rate}/><Rate label="Service" value={tier.platform_fee_rate}/><Rate label="Global" value={tier.total_rate} strong/></View><Pressable accessibilityLabel="Supprimer" onPress={() => remove(tier)} style={styles.delete}><Trash2 size={17} color={colors.danger}/></Pressable></Pressable>)}</View> : <EmptyState icon={Percent} title="Aucune tranche" message="Ajoutez au moins une plage couvrant les montants de pret autorises. En attendant, les anciens taux du club restent appliques."/>}
    </Screen>;
}
function Rate({ label, value, strong }) { return <View style={[styles.rate, strong && styles.rateStrong]}><Text style={styles.rateLabel}>{label}</Text><Text style={[styles.rateValue, strong && styles.rateValueStrong]}>{value} %</Text></View>; }
const styles = StyleSheet.create({ flex: { flex: 1 }, intro: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSoft }, introTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 14 }, introText: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 15 }, editor: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.primary }, editorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, editorTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 16 }, close: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.paper }, row: { flexDirection: "row", gap: spacing.sm }, half: { flex: 1 }, total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSoft }, totalLabel: { fontFamily: font.semibold, color: colors.primary, fontSize: 10 }, totalValue: { fontFamily: font.bold, color: colors.primary, fontSize: 20 }, list: { gap: spacing.sm }, tier: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, pressed: { opacity: .74 }, rangeLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 9 }, rangeValue: { marginTop: 3, fontFamily: font.bold, color: colors.ink, fontSize: 13 }, rates: { flexDirection: "row", gap: spacing.xs }, rate: { flex: 1, minHeight: 54, justifyContent: "space-between", padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.paper }, rateStrong: { backgroundColor: colors.brandSoft }, rateLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 7 }, rateValue: { fontFamily: font.bold, color: colors.ink, fontSize: 10 }, rateValueStrong: { color: colors.primary }, delete: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.dangerSoft } });
