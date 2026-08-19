import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch } from "react-redux";
import { ArrowLeft, ListChecks, Plus, Trash2 } from "lucide-react-native";
import { Button, EmptyState, Field, IconButton, LoadingScreen, PageHeader, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function LoanPurposesScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const [items, setItems] = useState();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const response = await api("/loan-purposes/");
        setItems(response.results || response);
    }, []);
    useEffect(() => { load().catch(() => setItems([])); }, [load]);

    async function create() {
        if (!name.trim()) return Alert.alert("Nom obligatoire", "Saisissez le libelle de l'objet de pret.");
        setSaving(true);
        try {
            await api("/loan-purposes/", { method: "POST", body: JSON.stringify({ name: name.trim(), description: description.trim(), position: (items?.length || 0) }) });
            setName("");
            setDescription("");
            dispatch(invalidate(["settings", "loans"]));
            await load();
        } catch (error) {
            Alert.alert("Creation impossible", error.message);
        } finally {
            setSaving(false);
        }
    }

    async function toggle(item) {
        try {
            await api(`/loan-purposes/${item.id}/`, { method: "PATCH", body: JSON.stringify({ name: item.name, is_active: !item.is_active }) });
            dispatch(invalidate(["settings", "loans"]));
            await load();
        } catch (error) {
            Alert.alert("Modification impossible", error.message);
        }
    }

    async function archive(item) {
        Alert.alert("Retirer cet objet ?", `« ${item.name} » ne sera plus propose aux emprunteurs. Les prets existants gardent leur objet.`, [
            { text: "Annuler", style: "cancel" },
            { text: "Retirer", style: "destructive", onPress: async () => {
                try {
                    await api(`/loan-purposes/${item.id}/`, { method: "DELETE" });
                    dispatch(invalidate(["settings", "loans"]));
                    await load();
                } catch (error) {
                    Alert.alert("Suppression impossible", error.message);
                }
            } },
        ]);
    }

    if (!items) return <LoadingScreen/>;

    return <Screen>
      <PageHeader eyebrow="Configuration" title="Objets de pret" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.hero}><ListChecks size={22} color={colors.mint}/><View style={styles.heroCopy}><Text style={styles.heroTitle}>Liste deroulante des emprunts</Text><Text style={styles.heroText}>L'emprunteur choisit l'objet de son pret dans cette liste : il ne peut plus le saisir librement.</Text></View></View>

      <View style={styles.form}>
        <Field label="Nouvel objet" value={name} onChangeText={setName} placeholder="Ex. Achat de stock"/>
        <Field label="Description (facultatif)" value={description} onChangeText={setDescription} placeholder="Precision affichee sous le libelle"/>
        <Button icon={Plus} label="Ajouter l'objet" loading={saving} onPress={create}/>
      </View>

      {items.length ? <View style={styles.list}>{items.map(item => <View key={item.id} style={styles.item}>
        <View style={styles.itemCopy}>
          <Text style={[styles.itemName, !item.is_active && styles.itemInactive]}>{item.name}</Text>
          {item.description ? <Text style={styles.itemNote}>{item.description}</Text> : null}
        </View>
        <Switch value={item.is_active} onValueChange={() => toggle(item)} trackColor={{ false: colors.line, true: colors.mint }} thumbColor={item.is_active ? colors.forest : colors.white}/>
        <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${item.name}`} onPress={() => archive(item)} style={styles.trash}><Trash2 size={17} color={colors.danger}/></Pressable>
      </View>)}</View> : <EmptyState icon={ListChecks} title="Aucun objet" message="Ajoutez au moins un objet pour que les emprunteurs puissent soumettre une demande."/>}
    </Screen>;
}

const styles = StyleSheet.create({
    hero: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest }, heroCopy: { flex: 1 }, heroTitle: { fontFamily: font.bold, color: colors.white, fontSize: 15 }, heroText: { fontFamily: font.medium, color: colors.mint, fontSize: 10, lineHeight: 16, marginTop: 4 },
    form: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    list: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    item: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    itemCopy: { flex: 1 }, itemName: { fontFamily: font.semibold, color: colors.ink, fontSize: 13 }, itemInactive: { color: colors.muted, textDecorationLine: "line-through" }, itemNote: { marginTop: 3, fontFamily: font.regular, color: colors.muted, fontSize: 9 },
    trash: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.coralSoft },
});
