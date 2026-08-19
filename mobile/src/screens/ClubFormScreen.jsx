import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, Percent, Phone, Save, Search, UserRound, X } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, Chips, Field, IconButton, PageHeader, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const empty = {
    name: "", description: "", zone: "Kinshasa", currency: "CDF", status: "active",
    interest_rate: "20.00", platform_fee_rate: "10.00", leader_commission_rate: "5.00", penalty_rate: "5.00",
    min_loan: "10000", max_loan: "1000000", withdrawal_notice_days: "7", max_collective_borrowers: "3",
};

export function ClubFormScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const dispatch = useDispatch();
    const { user } = useAuth();
    const club = route.params?.club;
    const editing = Boolean(club);
    const admin = user.role === "admin";
    const [form, setForm] = useState(club ? Object.fromEntries(Object.keys(empty).map(key => [key, String(club[key] ?? empty[key])])) : empty);
    const [durations, setDurations] = useState(club?.allowed_durations || []);
    const [catalog, setCatalog] = useState([]);
    const [leader, setLeader] = useState(club?.leader ? { id: club.leader, name: club.leader_name, phone: "", avatar: club.leader_avatar, selfie: club.leader_selfie } : null);
    const [phone, setPhone] = useState("");
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api("/loan-catalog/").then(response => {
            setCatalog(response.durations || []);
            setDurations(current => current.length ? current : (response.durations || []).map(item => item.code));
        }).catch(() => setCatalog([]));
    }, []);

    // Le taux affiche a l'emprunteur est la somme des trois composantes.
    const charge = Number(form.interest_rate || 0) + Number(form.platform_fee_rate || 0) + Number(form.leader_commission_rate || 0);

    async function searchLeader() {
        setSearching(true);
        try {
            const result = await api(`/users/by-phone/?phone=${encodeURIComponent(phone)}`);
            if (result.role !== "leader") throw new Error("Ce compte ne possede pas le role Chef de club.");
            setLeader(result);
        } catch (error) {
            setLeader(null);
            Alert.alert("Chef introuvable", error.message);
        } finally {
            setSearching(false);
        }
    }

    async function save() {
        if (admin && !durations.length) return Alert.alert("Durees obligatoires", "Selectionnez au moins une duree de pret autorisee.");
        setSaving(true);
        try {
            const payload = admin ? { ...form, allowed_durations: durations, leader: leader?.id || null } : { name: form.name };
            const saved = editing
                ? await api(`/clubs/${club.id}/`, { method: "PATCH", body: JSON.stringify(payload) })
                : await api("/clubs/", { method: "POST", body: JSON.stringify({ ...form, allowed_durations: durations, leader: null }) });
            dispatch(invalidate(["clubs", "dashboard", "loans", "members"]));
            Alert.alert("Club enregistre", editing ? "Les informations du club sont a jour." : "Le club est cree. Vous pouvez maintenant l'ouvrir et lui affecter un chef.", [{ text: "Terminer", onPress: () => navigation.goBack() }]);
            return saved;
        } catch (error) {
            Alert.alert("Enregistrement impossible", error.message);
        } finally {
            setSaving(false);
        }
    }

    async function archive() {
        Alert.alert("Archiver ce club ?", "Le club ne recevra plus de nouvelles demandes. Ses prets en cours restent suivis.", [
            { text: "Annuler", style: "cancel" },
            { text: "Archiver", style: "destructive", onPress: async () => {
                try {
                    await api(`/clubs/${club.id}/`, { method: "DELETE" });
                    dispatch(invalidate(["clubs", "dashboard"]));
                    navigation.goBack();
                } catch (error) {
                    Alert.alert("Archivage impossible", error.message);
                }
            } },
        ]);
    }

    return <Screen>
      <PageHeader eyebrow={editing ? "Modification du club" : "Nouveau club"} title={editing ? club.name : "Creer un club"} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {!editing ? <View style={styles.notice}><UserRound size={20} color={colors.mintDark}/><Text style={styles.noticeText}>Creez d'abord le club. Le chef pourra etre recherche par numero et affecte lors de la modification.</Text></View> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Identite</Text>
        <Field label="Nom du club" value={form.name} onChangeText={value => setForm({ ...form, name: value })}/>
        {admin ? <>
          <Field label="Description" value={form.description} multiline onChangeText={value => setForm({ ...form, description: value })}/>
          <View style={styles.row}><View style={styles.half}><Field label="Zone" value={form.zone} onChangeText={value => setForm({ ...form, zone: value })}/></View><View style={styles.half}><Field label="Devise" value={form.currency} onChangeText={value => setForm({ ...form, currency: value.toUpperCase() })}/></View></View>
        </> : null}
      </View>

      {admin && editing ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chef du club</Text>
        {leader ? <View style={styles.leader}><Avatar user={leader} size={40}/><View style={styles.leaderCopy}><Text style={styles.leaderName}>{leader.name}</Text><Text style={styles.leaderPhone}>{leader.phone || "Chef actuellement affecte"}</Text></View><Pressable accessibilityLabel="Retirer le chef" onPress={() => setLeader(null)} style={styles.clear}><X size={17} color={colors.danger}/></Pressable></View> : <Text style={styles.emptyLeader}>Aucun chef affecte</Text>}
        <Field icon={Phone} label="Rechercher par numero" value={phone} keyboardType="phone-pad" onChangeText={setPhone} placeholder="+243..."/>
        <Button icon={Search} label="Rechercher le compte chef" variant="secondary" loading={searching} disabled={phone.replace(/\D/g, "").length < 10} onPress={searchLeader}/>
      </View> : null}

      {admin ? <View style={styles.section}>
        <View style={styles.ruleHeader}><Percent size={20} color={colors.coral}/><Text style={styles.sectionTitle}>Cout du credit</Text></View>
        <Text style={styles.ruleNote}>Chaque taux est un pourcentage FIXE du capital emprunte. La duree du pret ne change pas le cout.</Text>
        <View style={styles.row}>
          <View style={styles.half}><Field label="Interet preteur %" value={form.interest_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, interest_rate: value })}/></View>
          <View style={styles.half}><Field label="Commission app %" value={form.platform_fee_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, platform_fee_rate: value })}/></View>
        </View>
        <Field label="Commission chef de club %" value={form.leader_commission_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, leader_commission_rate: value })}/>
        <View style={styles.chargeBox}><Text style={styles.chargeLabel}>Taux unique vu par l'emprunteur</Text><Text style={styles.chargeValue}>{charge.toFixed(2)} %</Text><Text style={styles.chargeNote}>Exemple : sur 100 000 {form.currency}, l'emprunteur remboursera {(100000 * (1 + charge / 100)).toLocaleString("fr-CD")} {form.currency}.</Text></View>
        <Field label="Penalite de retard %" value={form.penalty_rate} keyboardType="decimal-pad" onChangeText={value => setForm({ ...form, penalty_rate: value })}/>
      </View> : <View style={styles.notice}><Text style={styles.noticeText}>Vous pouvez modifier uniquement le nom du club.</Text></View>}

      {admin ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>Limites et durees</Text>
        <View style={styles.row}><View style={styles.half}><Field label="Pret minimum" value={form.min_loan} keyboardType="numeric" onChangeText={value => setForm({ ...form, min_loan: value })}/></View><View style={styles.half}><Field label="Pret maximum" value={form.max_loan} keyboardType="numeric" onChangeText={value => setForm({ ...form, max_loan: value })}/></View></View>
        <Chips label="Durees de pret autorisees" options={catalog.map(item => ({ value: item.code, label: item.label }))} values={durations}
          onToggle={code => setDurations(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code])}
          hint="L'emprunteur choisit sa duree dans cette liste. Les frequences compatibles sont proposees automatiquement."/>
        <View style={styles.row}><View style={styles.half}><Field label="Preavis retrait (jours)" value={form.withdrawal_notice_days} keyboardType="numeric" onChangeText={value => setForm({ ...form, withdrawal_notice_days: value })}/></View><View style={styles.half}><Field label="Co-emprunteurs max." value={form.max_collective_borrowers} keyboardType="number-pad" onChangeText={value => setForm({ ...form, max_collective_borrowers: value.replace(/[^0-9]/g, "") })}/></View></View>
      </View> : null}

      <Button icon={Save} label={editing ? "Enregistrer les modifications" : "Creer le club"} loading={saving} disabled={!form.name || (admin && !form.zone)} onPress={save}/>
      {admin && editing ? <Button label="Archiver le club" variant="ghost" onPress={archive}/> : null}
    </Screen>;
}

const styles = StyleSheet.create({
    notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, noticeText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 },
    section: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 15 },
    row: { flexDirection: "row", gap: spacing.sm }, half: { flex: 1 }, ruleHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    ruleNote: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 15 },
    chargeBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, chargeLabel: { fontFamily: font.semibold, color: colors.mintDark, fontSize: 10 }, chargeValue: { fontFamily: font.bold, color: colors.forest, fontSize: 24, marginTop: 2 }, chargeNote: { marginTop: 4, fontFamily: font.medium, color: colors.mintDark, fontSize: 9, lineHeight: 14 },
    leader: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.mint }, leaderCopy: { flex: 1 }, leaderName: { fontFamily: font.bold, color: colors.forest, fontSize: 12 }, leaderPhone: { fontFamily: font.medium, color: colors.mintDark, fontSize: 9, marginTop: 3 },
    clear: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.white },
    emptyLeader: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paper, fontFamily: font.medium, color: colors.muted, fontSize: 11 },
});
