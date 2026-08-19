import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Banknote, HandCoins, Landmark, ReceiptText, Scale, TrendingUp, WalletCards } from "lucide-react-native";

import { IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { colors, font, radius, shadow, spacing } from "@/theme";

export function BalanceScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const [data, setData] = useState();
    const version = useSelector(state => state.sync.versions.dashboard);
    const load = useCallback(() => api("/balance/").then(setData), []);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    if (!data) return <LoadingScreen/>;
    const admin = user.role === "admin";

    return <Screen>
      <PageHeader eyebrow="Situation financiere" title="Balance nette" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Scale size={22} color={colors.white}/></View>
        <Text style={styles.heroLabel}>{admin ? "Fonds net en caisse" : "Capital disponible"}</Text>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{money(data.net_available, data.currency)}</Text>
        <Text style={styles.heroNote}>{admin ? "Apres retraits, principal decaisse restant et frais encaisses." : "Disponible maintenant pour un placement ou un retrait."}</Text>
      </View>

      {admin ? <View style={styles.availableBand}>
        <View><Text style={styles.bandLabel}>Fonds libres apres engagements</Text><Text style={styles.bandValue}>{money(data.free_after_commitments, data.currency)}</Text></View>
        <WalletCards size={24} color={colors.forest}/>
      </View> : null}

      <View>
        <Text style={styles.sectionTitle}>Calcul du net</Text>
        <View style={styles.equation}>
          <EquationRow label="Total des depots" value={data.total_deposits} currency={data.currency} positive/>
          <EquationRow label="Total des retraits" value={data.total_withdrawals} currency={data.currency}/>
          <EquationRow label={admin ? "Principal encore decaisse" : "Capital encore place"} value={data.principal_outstanding} currency={data.currency}/>
          <EquationRow label={admin ? "Commissions, frais et interets encaisses" : "Gains deja encaisses"} value={data.earnings_collected} currency={data.currency} positive/>
        </View>
        {admin && Number(data.reserved_capital) > 0 ? <Text style={styles.commitmentNote}>Engagements finances non decaisses : {money(data.reserved_capital, data.currency)}. Ils sont deduits du fonds libre affiche plus haut.</Text> : null}
      </View>

      <View>
        <Text style={styles.sectionTitle}>Cycle des placements</Text>
        <View style={styles.grid}>
          <Metric icon={HandCoins} label="Placements en cours" value={money(data.ongoing_placements, data.currency)} detail={`${data.ongoing_count} placement(s)`} tone="mint"/>
          <Metric icon={TrendingUp} label="Placements termines" value={money(data.completed_placements, data.currency)} detail={`${data.completed_count} recupere(s)`} tone="sky"/>
          <Metric icon={Banknote} label="Capital deja recupere" value={money(data.recovered_capital, data.currency)} detail="Principal retourne" tone="yellow"/>
          <Metric icon={ReceiptText} label={admin ? "Revenus financiers encaisses" : "Gains encaisses"} value={money(data.earnings_collected, data.currency)} detail={admin ? `Commissions ${money(data.commissions_collected, data.currency)} - Interets ${money(data.interest_collected, data.currency)}` : `Prevu ${money(data.earnings_expected, data.currency)}`} tone="coral"/>
        </View>
      </View>

      <View>
        <Text style={styles.sectionTitle}>Mouvements recents</Text>
        {data.activity.length ? <View style={styles.activity}>{data.activity.map(item => <Pressable key={`${item.kind}-${item.id}`} disabled={!item.loan} onPress={() => item.loan && navigation.navigate("LoanDetail", { loanId: item.loan })} style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={[styles.activityIcon, item.direction === "in" ? styles.activityIn : item.direction === "out" ? styles.activityOut : styles.activityNeutral]}>{item.direction === "in" ? <ArrowDownLeft size={17} color={colors.forest}/> : <ArrowUpRight size={17} color={item.direction === "out" ? colors.danger : colors.forest}/>}</View>
          <View style={styles.activityCopy}><Text style={styles.activityTitle}>{item.title}</Text><Text style={styles.activityMeta}>{item.club} - {shortDate(item.date)}</Text>{item.status ? <View style={styles.activityStatus}><Status value={item.status}/></View> : null}</View>
          <Text style={[styles.activityAmount, item.direction === "in" && styles.amountIn, item.direction === "out" && styles.amountOut]}>{item.direction === "in" ? "+" : item.direction === "out" ? "-" : ""}{money(item.amount, data.currency)}</Text>
        </Pressable>)}</View> : <View style={styles.empty}><Landmark size={21} color={colors.mintDark}/><Text style={styles.emptyText}>Aucun mouvement financier enregistre.</Text></View>}
      </View>
    </Screen>;
}

function EquationRow({ label, value, currency, positive }) {
    return <View style={styles.equationRow}><Text style={styles.equationLabel}>{label}</Text><Text style={[styles.equationValue, positive && styles.positive]}>{positive ? "+ " : "- "}{money(value, currency)}</Text></View>;
}

function Metric({ icon: Icon, label, value, detail, tone }) {
    return <View style={[styles.metric, styles[`metric_${tone}`]]}><Icon size={19} color={colors.forest}/><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
    hero: { minHeight: 210, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.forest, justifyContent: "space-between", ...shadow }, heroIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, heroLabel: { marginTop: spacing.lg, fontFamily: font.medium, color: colors.mint, fontSize: 11 }, heroValue: { fontFamily: font.bold, color: colors.white, fontSize: 34 }, heroNote: { maxWidth: 310, fontFamily: font.medium, color: colors.mint, fontSize: 10, lineHeight: 16 },
    availableBand: { minHeight: 82, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.mint }, bandLabel: { fontFamily: font.medium, color: colors.forest, fontSize: 10 }, bandValue: { marginTop: 4, fontFamily: font.bold, color: colors.ink, fontSize: 21 },
    sectionTitle: { marginBottom: spacing.md, fontFamily: font.bold, color: colors.ink, fontSize: 18 }, equation: { borderTopWidth: 1, borderTopColor: colors.line }, equationRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, equationLabel: { flex: 1, fontFamily: font.medium, color: colors.muted, fontSize: 11 }, equationValue: { fontFamily: font.bold, color: colors.danger, fontSize: 12, textAlign: "right" }, positive: { color: colors.forest }, commitmentNote: { marginTop: spacing.sm, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 15 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, metric: { width: "48%", minHeight: 142, padding: spacing.md, borderRadius: radius.md, justifyContent: "space-between" }, metric_mint: { backgroundColor: colors.mint }, metric_sky: { backgroundColor: colors.sky }, metric_yellow: { backgroundColor: "#FFF0C5" }, metric_coral: { backgroundColor: colors.coralSoft }, metricLabel: { fontFamily: font.semibold, color: colors.muted, fontSize: 9, lineHeight: 14 }, metricValue: { fontFamily: font.bold, color: colors.ink, fontSize: 16 }, metricDetail: { fontFamily: font.medium, color: colors.muted, fontSize: 8 },
    activity: { borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, activityRow: { minHeight: 68, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed: { backgroundColor: colors.paper }, activityIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" }, activityIn: { backgroundColor: colors.mint }, activityOut: { backgroundColor: colors.coralSoft }, activityNeutral: { backgroundColor: colors.sky }, activityCopy: { flex: 1 }, activityTitle: { fontFamily: font.semibold, color: colors.ink, fontSize: 11 }, activityMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 8 }, activityStatus: { marginTop: 6 }, activityAmount: { maxWidth: 120, fontFamily: font.bold, color: colors.ink, fontSize: 10, textAlign: "right" }, amountIn: { color: colors.forest }, amountOut: { color: colors.danger }, empty: { minHeight: 84, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, emptyText: { flex: 1, fontFamily: font.medium, color: colors.forest, fontSize: 11 },
});
