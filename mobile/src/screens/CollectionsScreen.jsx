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
        try {
            const response = await api("/loans/to-collect/");
            setLoans(response.results || []);
        } catch (error) {
            setLoans([]);
        }
    }, []);
    useEffect(() => { load(); }, [load, version]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);

    if (!loans) return <LoadingScreen/>;

    const dueToday = loans.filter(loan => (loan.installments || []).some(item => ["due", "late"].includes(item.status)));

    return <Screen>
      <PageHeader eyebrow={admin ? "Caisse" : "Mandat d'encaissement"} title="Encaissements" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.summary}>
        <View style={styles.summaryCell}><HandCoins size={20} color={colors.forest}/><Text style={styles.summaryValue}>{loans.length}</Text><Text style={styles.summaryLabel}>Prets a encaisser</Text></View>
        <View style={styles.summaryDivider}/>
        <View style={styles.summaryCell}><CalendarClock size={20} color={colors.coral}/><Text style={styles.summaryValue}>{dueToday.length}</Text><Text style={styles.summaryLabel}>Echeances dues ou en retard</Text></View>
      </View>
      <Text style={styles.note}>{admin
        ? "Vous encaissez tous les prets. Ouvrez un pret pour designer un mandataire qui encaissera a votre place selon la frequence du pret."
        : "Vous encaissez uniquement les prets pour lesquels l'administrateur vous a designe mandataire."}</Text>

      {loans.length ? <View style={styles.list}>{loans.map(loan => {
          const next = (loan.installments || []).find(item => item.status !== "paid");
          return <Pressable key={loan.id} onPress={() => navigation.navigate("LoanDetail", { loanId: loan.id })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>{loan.purpose}</Text>
              <Text style={styles.rowMeta}>{loan.reference} · {loan.club_name}</Text>
              <Text style={styles.rowMeta}>{loan.frequency_label} · {loan.installment_total} echeances</Text>
              {next ? <Text style={styles.rowNext}>Prochaine : {shortDate(next.due_date)} — {money(next.total_due, loan.currency)}</Text> : null}
              {loan.collection_agent_name ? <View style={styles.agent}><UserCheck size={12} color={colors.forest}/><Text style={styles.agentText}>{loan.collection_agent_name}</Text></View> : admin ? <Text style={styles.noAgent}>Aucun mandataire — encaissement administrateur</Text> : null}
            </View>
            <View style={styles.rowEnd}><Text style={styles.rowAmount}>{money(loan.balance, loan.currency)}</Text><Status value={loan.status}/></View>
            <ChevronRight size={17} color={colors.muted}/>
          </Pressable>;
      })}</View> : <EmptyState icon={HandCoins} title="Aucun encaissement" message={admin ? "Aucun pret n'est actuellement en cours de remboursement." : "Aucun mandat d'encaissement ne vous a ete confie."}/>}
    </Screen>;
}

const styles = StyleSheet.create({
    summary: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint },
    summaryCell: { flex: 1, alignItems: "center", gap: 4 }, summaryDivider: { width: 1, height: 44, backgroundColor: colors.mintDark, opacity: 0.3 },
    summaryValue: { fontFamily: font.bold, color: colors.forest, fontSize: 22 }, summaryLabel: { fontFamily: font.medium, color: colors.mintDark, fontSize: 9, textAlign: "center" },
    note: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 },
    list: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    row: { minHeight: 96, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    pressed: { backgroundColor: colors.paper },
    rowCopy: { flex: 1 }, rowTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 },
    rowMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 },
    rowNext: { marginTop: 4, fontFamily: font.bold, color: colors.coral, fontSize: 9 },
    agent: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 4 }, agentText: { fontFamily: font.semibold, color: colors.forest, fontSize: 9 },
    noAgent: { marginTop: 4, fontFamily: font.medium, color: colors.skyDark, fontSize: 9 },
    rowEnd: { alignItems: "flex-end", gap: 4 }, rowAmount: { fontFamily: font.bold, color: colors.ink, fontSize: 12 },
});
