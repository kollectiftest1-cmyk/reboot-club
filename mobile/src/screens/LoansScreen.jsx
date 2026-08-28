import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { CirclePlus, Clock3, HandCoins, PiggyBank, TrendingDown, UsersRound } from "lucide-react-native";

import { Avatar, Button, EmptyState, Field, LoadingScreen, OperationResultModal, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api, apiCached } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function LoansScreen() {
    const navigation = useNavigation();
    const dispatch = useDispatch();
    const { user } = useAuth();
    const [loans, setLoans] = useState();
    const [offline, setOffline] = useState(false);
    const [invitations, setInvitations] = useState([]);
    const [shares, setShares] = useState({});
    const [result, setResult] = useState();
    const version = useSelector(state => state.sync.versions.loans);
    const load = useCallback(async () => {
        const result = await apiCached("/loans/", "loans");
        setLoans(result.data.results);
        setOffline(result.offline);
        if (user?.current_profile === "borrower") {
            try {
                const pending = await api("/loan-invitations/pending/");
                setInvitations(pending.results || []);
                setShares(current => Object.fromEntries((pending.results || []).map(item => [item.id, current[item.id] || String(item.share_amount || "")])));
            } catch { setInvitations([]); }
        }
    }, [user?.current_profile]);
    useEffect(() => navigation.addListener("focus", load), [navigation, load]);
    useEffect(() => { load(); }, [load, version]);
    if (!loans) return <LoadingScreen/>;

    async function answer(invitation, accept) {
        try {
            await api(`/loans/${invitation.loan}/respond/`, { method: "POST", body: JSON.stringify({ accept, share_amount: accept ? shares[invitation.id] : undefined, reason: accept ? "" : "Participation refusee par le membre" }) });
            dispatch(invalidate(["loans", "dashboard", "notifications", "validations"]));
            await load();
            setResult({ success: true, title: accept ? "Participation confirmee" : "Invitation refusee", message: accept ? "Votre part est enregistree. Le dossier partira en validation apres l'accord de tous les co-emprunteurs." : "Le demandeur a ete informe et le pret collectif a ete annule." });
        } catch (error) {
            setResult({ success: false, title: "Reponse impossible", message: error.message });
        }
    }

    const lender = user?.current_profile === "lender" && user?.role !== "admin";
    return <Screen offline={offline}>
      <PageHeader eyebrow="Credit" title={lender ? "Opportunites et placements" : "Mes prets"}/>
      {user?.current_profile === "borrower" ? <Button label="Nouvelle demande" icon={CirclePlus} onPress={() => navigation.navigate("LoanRequest")}/> : null}
      {invitations.length ? <View><Text style={styles.sectionTitle}>Invitations collectives</Text><View style={styles.invitationList}>{invitations.map(item => <View key={item.id} style={styles.invitation}><View style={styles.invitationTop}><View style={styles.invitationIcon}><UsersRound size={20} color={colors.forest}/></View><View style={styles.invitationCopy}><Text style={styles.invitationTitle}>{item.purpose}</Text><Text style={styles.invitationMeta}>{item.requested_by} - {item.club_name}</Text></View><Status value="pending"/></View><View style={styles.invitationAmount}><Text style={styles.invitationAmountLabel}>Montant total du pret</Text><Text style={styles.invitationAmountValue}>{money(item.loan_amount, item.currency)}</Text></View><Field label="Votre part proposee" value={shares[item.id] || ""} onChangeText={value => setShares(current => ({ ...current, [item.id]: value.replace(/[^0-9.]/g, "") }))} keyboardType="decimal-pad"/><View style={styles.invitationActions}><View style={styles.invitationButton}><Button label="Refuser" variant="ghost" onPress={() => answer(item, false)}/></View><View style={styles.invitationButton}><Button label="Accepter" onPress={() => answer(item, true)}/></View></View></View>)}</View></View> : null}
      {loans.length ? <View style={styles.list}>{loans.map(loan => <LoanCard key={loan.id} loan={loan} lender={lender} onPress={() => navigation.navigate("LoanDetail", { loanId: loan.id })}/>)}</View> : <EmptyState icon={PiggyBank} title={lender ? "Aucun financement ouvert" : "Aucun pret"} message={lender ? "Un pret apparait ici des qu'il est valide et qu'un montant reste a financer. Les demandes soumises ou deja entierement financees ne sont pas placables." : "Votre historique de credit apparaitra ici."}/>}
      <OperationResultModal result={result} onClose={() => setResult(undefined)}/>
    </Screen>;
}

function LoanCard({ loan, lender, onPress }) {
    const mine = lender ? loan.my_funding : null;
    const pendingMine = Number(mine?.pending_amount || 0) > 0;
    const mainLabel = pendingMine ? "Placement en validation" : mine ? "Mon retour restant" : lender ? "Besoin restant" : "Reste a payer";
    const mainValue = pendingMine ? mine.pending_amount : mine ? mine.remaining_return : lender ? loan.funding_open_amount : loan.balance;
    const secondaryLabel = pendingMine ? "Capital deja valide" : mine ? "Total attendu" : "Montant initial";
    const secondaryValue = pendingMine ? mine.amount : mine ? mine.expected_total : loan.amount;
    const progressValue = mine ? Number(mine.total_received) : lender ? Number(loan.funded_amount) : Number(loan.total_paid);
    const progressTotal = mine ? Number(mine.expected_total) : lender ? Number(loan.amount) : Number(loan.total_due);
    return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}><Avatar user={{ name: loan.borrower_name, avatar: loan.borrower_avatar, selfie: loan.borrower_selfie }} size={42}/><View style={styles.titleCopy}><Text style={styles.reference}>{loan.reference}</Text><Text style={styles.purpose} numberOfLines={1}>{loan.purpose}</Text><Text style={styles.borrower} numberOfLines={1}>{loan.borrower_name}</Text></View><Status value={loan.status}/></View>
      {mine ? <View style={styles.placement}><HandCoins size={15} color={colors.forest}/><Text style={styles.placementText}>{pendingMine ? `${money(mine.pending_amount, loan.currency)} reserves, validation administrative en attente` : `Vous avez place ${money(mine.amount, loan.currency)} - gain prevu ${money(mine.expected_gain, loan.currency)}`}</Text></View> : null}
      <View style={styles.amountRow}><View><Text style={styles.amountLabel}>{mainLabel}</Text><Text style={styles.amount}>{money(mainValue, loan.currency)}</Text></View><View style={styles.alignRight}><Text style={styles.amountLabel}>{secondaryLabel}</Text><Text style={styles.initial}>{money(secondaryValue, loan.currency)}</Text></View></View>
      <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, progressValue / Math.max(progressTotal, 1) * 100)}%` }]}/></View>
      <View style={styles.footer}><View style={styles.footerItem}><Clock3 size={14} color={colors.muted}/><Text style={styles.footerText}>{loan.duration_label}{loan.frequency_label ? ` · ${loan.frequency_label.toLowerCase()}` : ""}</Text></View><View style={styles.footerItem}><TrendingDown size={14} color={colors.muted}/><Text style={styles.footerText}>Cree le {shortDate(loan.created_at)}</Text></View></View>
    </Pressable>;
}

const styles = StyleSheet.create({
    sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 17, marginBottom: spacing.md }, invitationList: { gap: spacing.md }, invitation: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.coral, backgroundColor: colors.white }, invitationTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, invitationIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, invitationCopy: { flex: 1 }, invitationTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, invitationMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 }, invitationAmount: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.paper }, invitationAmountLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 9 }, invitationAmountValue: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, invitationActions: { flexDirection: "row", gap: spacing.sm }, invitationButton: { flex: 1 },
    list: { gap: spacing.md }, card: { padding: spacing.md, gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, pressed: { opacity: .72 },
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, titleCopy: { flex: 1 }, reference: { fontFamily: font.bold, fontSize: 10, color: colors.coral }, purpose: { fontFamily: font.semibold, fontSize: 14, color: colors.ink, marginTop: 3 }, borrower: { marginTop: 3, fontFamily: font.medium, fontSize: 9, color: colors.muted },
    placement: { minHeight: 36, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.mint }, placementText: { flex: 1, fontFamily: font.semibold, color: colors.forest, fontSize: 9 },
    amountRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, alignRight: { alignItems: "flex-end" }, amountLabel: { fontFamily: font.medium, fontSize: 10, color: colors.muted }, amount: { fontFamily: font.bold, fontSize: 21, color: colors.ink, marginTop: 3 }, initial: { fontFamily: font.bold, fontSize: 13, color: colors.muted, marginTop: 5 },
    progress: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }, progressFill: { height: 6, backgroundColor: colors.coral }, footer: { flexDirection: "row", gap: spacing.lg }, footerItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, footerText: { fontFamily: font.medium, fontSize: 10, color: colors.muted },
});
