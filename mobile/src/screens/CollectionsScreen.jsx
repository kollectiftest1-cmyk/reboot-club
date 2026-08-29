import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { ArrowLeft, CalendarClock, ChevronRight, HandCoins, UserCheck } from "lucide-react-native";

import { EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

export function CollectionsScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const version = useSelector(state => state.sync.versions.loans);
    const [loans, setLoans] = useState();
    const admin = user.role === "admin";
    const load = useCallback(async () => {
        try { const response = await api("/loans/to-collect/"); setLoans(response.results || []); }
        catch { setLoans([]); }
    }, []);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    if (!loans) return <LoadingScreen/>;

    const entries = loans.flatMap(loan => loan.is_collective
        ? (loan.borrowers || []).filter(item => item.status === "accepted" && (admin || item.can_collect)).map(debt => ({ loan, debt, installments: debt.installments || [], balance: debt.balance }))
        : [{ loan, debt: null, installments: loan.installments || [], balance: loan.balance }]);
    const dueToday = entries.filter(item => item.installments.some(installment => ["due", "late"].includes(installment.status)));

    return <Screen>
      <PageHeader eyebrow={admin ? "Caisse" : "Mandat d'encaissement"} title="Encaissements" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.summary}>
        <View style={styles.summaryCell}><HandCoins size={20} color={colors.forest}/><Text style={styles.summaryValue}>{entries.length}</Text><Text style={styles.summaryLabel}>Dettes a encaisser</Text></View>
        <View style={styles.summaryDivider}/>
        <View style={styles.summaryCell}><CalendarClock size={20} color={colors.coral}/><Text style={styles.summaryValue}>{dueToday.length}</Text><Text style={styles.summaryLabel}>Echeances dues ou en retard</Text></View>
      </View>
      <Text style={styles.note}>{admin ? "Chaque dette collective peut avoir son propre mandataire. Ouvrez le dossier pour encaisser la bonne personne ou modifier son mandat." : "Vous voyez uniquement les dettes individuelles que l'administration vous a confiees."}</Text>
      {entries.length ? <View style={styles.list}>{entries.map(({ loan, debt, installments, balance }) => {
          const next = installments.find(item => !["paid", "transferred"].includes(item.status));
          return <Pressable key={`${loan.id}-${debt?.id || "single"}`} onPress={() => navigation.navigate("LoanDetail", { loanId: loan.id })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>{debt ? debt.name : loan.purpose}</Text>
              <Text style={styles.rowMeta}>{loan.reference} - {loan.club_name}</Text>
              <Text style={styles.rowMeta}>{debt ? `Dette individuelle - ${money(debt.share_amount, loan.currency)}` : `${loan.frequency_label} - ${loan.installment_total} echeances`}</Text>
              {next ? <Text style={styles.rowNext}>Prochaine : {shortDate(next.due_date)} - {money(next.total_due, loan.currency)}</Text> : null}
              {(debt?.collection_agent_name || loan.collection_agent_name) ? <View style={styles.agent}><UserCheck size={12} color={colors.forest}/><Text style={styles.agentText}>{debt?.collection_agent_name || loan.collection_agent_name}</Text></View> : admin ? <Text style={styles.noAgent}>Aucun mandataire - encaissement administrateur</Text> : null}
            </View>
            <View style={styles.rowEnd}><Text style={styles.rowAmount}>{money(balance, loan.currency)}</Text><Status value={debt?.overdue_count ? "late" : loan.status}/></View>
            <ChevronRight size={17} color={colors.muted}/>
          </Pressable>;
      })}</View> : <EmptyState icon={HandCoins} title="Aucun encaissement" message={admin ? "Aucune dette n'est actuellement en cours de remboursement." : "Aucun mandat d'encaissement ne vous a ete confie."}/>}
    </Screen>;
}

const styles = StyleSheet.create({
    summary: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, summaryCell: { flex: 1, alignItems: "center", gap: 4 }, summaryDivider: { width: 1, height: 44, backgroundColor: colors.mintDark, opacity: 0.3 }, summaryValue: { fontFamily: font.bold, color: colors.forest, fontSize: 22 }, summaryLabel: { fontFamily: font.medium, color: colors.mintDark, fontSize: 9, textAlign: "center" },
    note: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 }, list: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, row: { minHeight: 106, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed: { backgroundColor: colors.paper }, rowCopy: { flex: 1 }, rowTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, rowMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 }, rowNext: { marginTop: 4, fontFamily: font.bold, color: colors.coral, fontSize: 9 }, agent: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 4 }, agentText: { fontFamily: font.semibold, color: colors.forest, fontSize: 9 }, noAgent: { marginTop: 4, fontFamily: font.medium, color: colors.skyDark, fontSize: 9 }, rowEnd: { alignItems: "flex-end", gap: 4 }, rowAmount: { fontFamily: font.bold, color: colors.ink, fontSize: 12 },
});
