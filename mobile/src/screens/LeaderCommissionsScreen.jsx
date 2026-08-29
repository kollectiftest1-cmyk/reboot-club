import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch } from "react-redux";
import { ArrowLeft, ArrowUpRight, HandCoins, Landmark, WalletCards } from "lucide-react-native";

import { Button, EmptyState, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Status } from "@/components/ui";
import { api } from "@/lib/api";
import { money, shortDateTime } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, shadow, spacing } from "@/theme";

export function LeaderCommissionsScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const [club, setClub] = useState();
    const [data, setData] = useState();
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState();

    const load = useCallback(async () => {
        const clubs = await api("/clubs/");
        const current = (clubs.results || [])[0];
        setClub(current);
        if (current) setData(await api(`/clubs/${current.id}/leader-commissions/`));
        else setData({ empty: true });
    }, []);
    useEffect(() => { load().catch(error => setResult({ success: false, title: "Chargement impossible", message: error.message })); }, [load]);

    async function submit(operation) {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric <= 0 || numeric > Number(data.available)) {
            return setResult({ success: false, title: "Montant invalide", message: `Le maximum disponible est ${money(data.available, data.currency)}.` });
        }
        setLoading(true);
        try {
            const response = await api(`/clubs/${club.id}/leader-commission-operation/`, {
                method: "POST", body: JSON.stringify({ operation, amount }),
            });
            setAmount("");
            dispatch(invalidate(["dashboard", "clubs", "validations", "notifications"]));
            await load();
            setResult({ success: true, title: operation === "withdraw" ? "Demande envoyee" : "Transfert effectue", message: response.message });
        } catch (error) {
            setResult({ success: false, title: "Operation impossible", message: error.message });
        } finally {
            setLoading(false);
        }
    }

    if (!data) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow="Direction du club" title="Mes commissions" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {data.empty ? <EmptyState icon={Landmark} title="Aucun club dirige" message="Le portefeuille de commissions apparait apres votre nomination comme chef de club."/> : <>
        <View style={styles.hero}>
          <View style={styles.heroTop}><View><Text style={styles.heroClub}>{data.club_name}</Text><Text style={styles.heroLabel}>Commission disponible</Text></View><View style={styles.heroIcon}><HandCoins size={21} color={colors.forest}/></View></View>
          <Text style={styles.heroValue}>{money(data.available, data.currency)}</Text>
          <View style={styles.heroFoot}><Text style={styles.heroMeta}>Encaissee {money(data.collected, data.currency)}</Text><Text style={styles.heroMeta}>Recuperee {money(data.paid, data.currency)}</Text></View>
        </View>

        <View style={styles.tool}>
          <Text style={styles.sectionTitle}>Utiliser mes gains</Text>
          <Text style={styles.note}>Une recuperation attend la validation administrative. Le transfert devient immediatement du fonds disponible sur votre profil preteur.</Text>
          <Field label="Montant" value={amount} onChangeText={value => setAmount(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder={`Maximum ${money(data.available, data.currency)}`}/>
          <View style={styles.actions}><View style={styles.action}><Button label="Recuperer" icon={ArrowUpRight} variant="secondary" loading={loading} onPress={() => submit("withdraw")}/></View><View style={styles.action}><Button label="Vers compte preteur" icon={WalletCards} loading={loading} onPress={() => submit("transfer_to_lender")}/></View></View>
        </View>

        <View><Text style={styles.sectionTitle}>Gains par emprunt</Text><View style={styles.list}>
          {(data.by_loan || []).map(item => <Pressable key={item.loan} onPress={() => navigation.navigate("LoanDetail", { loanId: item.loan })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.purpose}</Text><Text style={styles.rowMeta}>{item.reference}</Text><Status value={item.status}/></View><View style={styles.rowEnd}><Text style={styles.collected}>{money(item.collected, item.currency)}</Text><Text style={styles.expected}>sur {money(item.expected, item.currency)}</Text></View></Pressable>)}
        </View></View>

        {(data.operations || []).length ? <View><Text style={styles.sectionTitle}>Mouvements</Text><View style={styles.list}>{data.operations.map(item => <View key={item.id} style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.status === "paid" ? "Commission sortie" : "Recuperation demandee"}</Text><Text style={styles.rowMeta}>{shortDateTime(item.created_at)}</Text><Status value={item.status}/></View><Text style={styles.operationAmount}>{money(item.amount, item.currency)}</Text></View>)}</View></View> : null}
      </>}
      <OperationResultModal result={result} onClose={() => setResult(undefined)}/>
    </Screen>;
}

const styles = StyleSheet.create({
    hero: { minHeight: 190, padding: spacing.lg, justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.forest, ...shadow },
    heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, heroClub: { fontFamily: font.bold, color: colors.white, fontSize: 16 }, heroLabel: { marginTop: 4, fontFamily: font.medium, color: colors.mint, fontSize: 10 },
    heroIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.mint }, heroValue: { fontFamily: font.bold, color: colors.white, fontSize: 32 }, heroFoot: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }, heroMeta: { fontFamily: font.medium, color: colors.mint, fontSize: 9 },
    tool: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white }, sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 18 }, note: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 17 },
    actions: { flexDirection: "row", gap: spacing.sm }, action: { flex: 1 }, list: { marginTop: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white }, row: { minHeight: 78, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed: { backgroundColor: colors.paper }, rowCopy: { flex: 1, alignItems: "flex-start", gap: 4 }, rowTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, rowMeta: { fontFamily: font.medium, color: colors.muted, fontSize: 9 }, rowEnd: { alignItems: "flex-end" }, collected: { fontFamily: font.bold, color: colors.forest, fontSize: 12 }, expected: { marginTop: 4, fontFamily: font.medium, color: colors.muted, fontSize: 8 }, operationAmount: { fontFamily: font.bold, color: colors.coral, fontSize: 12 },
});
