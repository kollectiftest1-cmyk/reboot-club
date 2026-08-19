import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { CirclePlus, Clock3, HandCoins, PiggyBank, TrendingDown } from "lucide-react-native";

import { Avatar, Button, EmptyState, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiCached } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

export function LoansScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const [loans, setLoans] = useState();
    const [offline, setOffline] = useState(false);
    const version = useSelector(state => state.sync.versions.loans);
    const load = useCallback(async () => {
        const result = await apiCached("/loans/", "loans");
        setLoans(result.data.results);
        setOffline(result.offline);
    }, []);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    useEffect(() => { load(); }, [load, version]);
    if (!loans) return <LoadingScreen/>;

    const lender = user?.current_profile === "lender" && user?.role !== "admin";
    return <Screen offline={offline}>
      <PageHeader eyebrow="Credit" title={lender ? "Opportunites et placements" : "Mes prets"}/>
      {user?.current_profile === "borrower" ? <Button label="Nouvelle demande" icon={CirclePlus} onPress={() => navigation.navigate("LoanRequest")}/> : null}
      {loans.length ? <View style={styles.list}>{loans.map(loan => <LoanCard key={loan.id} loan={loan} lender={lender} onPress={() => navigation.navigate("LoanDetail", { loanId: loan.id })}/>)}</View> : <EmptyState icon={PiggyBank} title="Aucun pret" message={lender ? "Les nouvelles opportunites et vos placements apparaitront ici." : "Votre historique de credit apparaitra ici."}/>} 
    </Screen>;
}

function LoanCard({ loan, lender, onPress }) {
    const mine = lender ? loan.my_funding : null;
    const mainLabel = mine ? "Mon retour restant" : lender ? "Besoin restant" : "Reste a payer";
    const mainValue = mine ? mine.remaining_return : lender ? loan.funding_remaining : loan.balance;
    const secondaryLabel = mine ? "Total attendu" : "Montant initial";
    const secondaryValue = mine ? mine.expected_total : loan.amount;
    const progressValue = mine ? Number(mine.total_received) : lender ? Number(loan.funded_amount) : Number(loan.total_paid);
    const progressTotal = mine ? Number(mine.expected_total) : lender ? Number(loan.amount) : Number(loan.total_due);
    return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}><Avatar user={{ name: loan.borrower_name, avatar: loan.borrower_avatar, selfie: loan.borrower_selfie }} size={42}/><View style={styles.titleCopy}><Text style={styles.reference}>{loan.reference}</Text><Text style={styles.purpose} numberOfLines={1}>{loan.purpose}</Text><Text style={styles.borrower} numberOfLines={1}>{loan.borrower_name}</Text></View><Status value={loan.status}/></View>
      {mine ? <View style={styles.placement}><HandCoins size={15} color={colors.forest}/><Text style={styles.placementText}>Vous avez place {money(mine.amount, loan.currency)} - gain prevu {money(mine.expected_gain, loan.currency)}</Text></View> : null}
      <View style={styles.amountRow}><View><Text style={styles.amountLabel}>{mainLabel}</Text><Text style={styles.amount}>{money(mainValue, loan.currency)}</Text></View><View style={styles.alignRight}><Text style={styles.amountLabel}>{secondaryLabel}</Text><Text style={styles.initial}>{money(secondaryValue, loan.currency)}</Text></View></View>
      <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, progressValue / Math.max(progressTotal, 1) * 100)}%` }]}/></View>
      <View style={styles.footer}><View style={styles.footerItem}><Clock3 size={14} color={colors.muted}/><Text style={styles.footerText}>{loan.duration_label}{loan.frequency_label ? ` · ${loan.frequency_label.toLowerCase()}` : ""}</Text></View><View style={styles.footerItem}><TrendingDown size={14} color={colors.muted}/><Text style={styles.footerText}>Cree le {shortDate(loan.created_at)}</Text></View></View>
    </Pressable>;
}

const styles = StyleSheet.create({
    list: { gap: spacing.md }, card: { padding: spacing.md, gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, pressed: { opacity: .72 },
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, titleCopy: { flex: 1 }, reference: { fontFamily: font.bold, fontSize: 10, color: colors.coral }, purpose: { fontFamily: font.semibold, fontSize: 14, color: colors.ink, marginTop: 3 }, borrower: { marginTop: 3, fontFamily: font.medium, fontSize: 9, color: colors.muted },
    placement: { minHeight: 36, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.mint }, placementText: { flex: 1, fontFamily: font.semibold, color: colors.forest, fontSize: 9 },
    amountRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, alignRight: { alignItems: "flex-end" }, amountLabel: { fontFamily: font.medium, fontSize: 10, color: colors.muted }, amount: { fontFamily: font.bold, fontSize: 21, color: colors.ink, marginTop: 3 }, initial: { fontFamily: font.bold, fontSize: 13, color: colors.muted, marginTop: 5 },
    progress: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }, progressFill: { height: 6, backgroundColor: colors.coral }, footer: { flexDirection: "row", gap: spacing.lg }, footerItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, footerText: { fontFamily: font.medium, fontSize: 10, color: colors.muted },
});
