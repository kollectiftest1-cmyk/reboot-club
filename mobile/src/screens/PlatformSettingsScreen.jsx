import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, ChevronRight, ListChecks, Save, Settings2 } from "lucide-react-native";
import { Button, Field, IconButton, LoadingScreen, PageHeader, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function PlatformSettingsScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const version = useSelector(state => state.sync.versions.settings);
    const [form, setForm] = useState();
    const [saving, setSaving] = useState(false);
    useEffect(() => { api("/configuration/").then(setForm); }, [version]);

    async function save() {
        setSaving(true);
        try {
            const payload = { ...form };
            delete payload.default_borrower_charge_rate;
            delete payload.updated_at;
            await api("/configuration/", { method: "PATCH", body: JSON.stringify(payload) });
            dispatch(invalidate(["settings", "dashboard", "clubs"]));
            Alert.alert("Configuration enregistree");
        } catch (error) {
            Alert.alert("Enregistrement impossible", error.message);
        } finally {
            setSaving(false);
        }
    }

    if (!form) return <LoadingScreen/>;
    const charge = Number(form.default_interest_rate || 0) + Number(form.default_commission_rate || 0) + Number(form.default_leader_commission_rate || 0);

    return <Screen>
      <PageHeader eyebrow="Administration" title="Configuration globale" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.hero}><Settings2 size={24} color={colors.mint}/><View style={styles.heroCopy}><Text style={styles.heroTitle}>Parametres de la plateforme</Text><Text style={styles.heroText}>Ces valeurs servent de politique par defaut pour les nouveaux clubs.</Text></View></View>

      <Pressable onPress={() => navigation.navigate("LoanPurposes")} style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}>
        <View style={styles.linkIcon}><ListChecks size={20} color={colors.forest}/></View>
        <View style={styles.linkCopy}><Text style={styles.linkTitle}>Objets de pret</Text><Text style={styles.linkNote}>Creer et gerer la liste deroulante proposee aux emprunteurs</Text></View>
        <ChevronRight size={18} color={colors.muted}/>
      </Pressable>

      <View style={styles.form}>
        <View style={styles.row}>
          <View style={styles.half}><Field label="Devise" value={form.default_currency} onChangeText={value => setForm({ ...form, default_currency: value.toUpperCase() })}/></View>
          <View style={styles.half}><Field label="Telephone support" value={form.support_phone} keyboardType="phone-pad" onChangeText={value => setForm({ ...form, support_phone: value })}/></View>
        </View>

        <Text style={styles.groupTitle}>Cout du credit (% fixe du capital emprunte)</Text>
        <View style={styles.row}>
          <View style={styles.half}><Field label="Interet preteur %" value={String(form.default_interest_rate)} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, default_interest_rate: value })}/></View>
          <View style={styles.half}><Field label="Commission application %" value={String(form.default_commission_rate)} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, default_commission_rate: value })}/></View>
        </View>
        <Field label="Commission chef de club %" value={String(form.default_leader_commission_rate)} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, default_leader_commission_rate: value })}/>
        <View style={styles.chargeBox}>
          <Text style={styles.chargeLabel}>Taux unique vu par l'emprunteur</Text>
          <Text style={styles.chargeValue}>{charge.toFixed(2)} %</Text>
          <Text style={styles.chargeNote}>L'emprunteur ne voit que ce total. La repartition entre application, preteur et chef de club lui reste invisible.</Text>
        </View>

        <Field label="Penalite de retard %" value={String(form.default_penalty_rate)} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, default_penalty_rate: value })}/>
        <Field label="Plafond global de pret" value={String(form.max_loan)} keyboardType="numeric" onChangeText={value => setForm({ ...form, max_loan: value })}/>
        <Field label="Co-emprunteurs maximum par pret" value={String(form.default_collective_borrowers)} keyboardType="number-pad" onChangeText={value => setForm({ ...form, default_collective_borrowers: value.replace(/[^0-9]/g, "") })}/>
        <Toggle label="KYC obligatoire" value={form.kyc_required} onValueChange={value => setForm({ ...form, kyc_required: value })}/>
        <Toggle label="Double validation" value={form.require_double_validation} onValueChange={value => setForm({ ...form, require_double_validation: value })}/>
        <Toggle label="Mode maintenance" value={form.maintenance_mode} onValueChange={value => setForm({ ...form, maintenance_mode: value })}/>
        <Button icon={Save} label="Enregistrer la configuration" loading={saving} onPress={save}/>
      </View>
    </Screen>;
}

function Toggle({ label, value, onValueChange }) { return <View style={styles.toggle}><Text style={styles.toggleLabel}>{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.line, true: colors.mint }} thumbColor={value ? colors.forest : colors.white}/></View>; }

const styles = StyleSheet.create({
    hero: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, heroCopy: { flex: 1 }, heroTitle: { fontFamily: font.bold, color: colors.white, fontSize: 16 }, heroText: { fontFamily: font.medium, color: colors.mint, fontSize: 10, lineHeight: 16, marginTop: 4 },
    link: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, linkPressed: { backgroundColor: colors.paper }, linkIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }, linkCopy: { flex: 1 }, linkTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, linkNote: { fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
    form: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    groupTitle: { fontFamily: font.bold, color: colors.forest, fontSize: 12, marginTop: spacing.xs },
    chargeBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, chargeLabel: { fontFamily: font.semibold, color: colors.mintDark, fontSize: 10 }, chargeValue: { fontFamily: font.bold, color: colors.forest, fontSize: 24, marginTop: 2 }, chargeNote: { marginTop: 4, fontFamily: font.medium, color: colors.mintDark, fontSize: 9, lineHeight: 14 },
    row: { flexDirection: "row", gap: spacing.sm }, half: { flex: 1 },
    toggle: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, toggleLabel: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 },
});
