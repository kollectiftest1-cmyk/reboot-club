import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, BadgeCheck, CircleDollarSign, HandCoins, Landmark, PiggyBank, UserRoundCheck, UsersRound, WalletCards } from "lucide-react-native";
import { useDispatch } from "react-redux";

import { Avatar, Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Select, Status } from "@/components/ui";
import { api } from "@/lib/api";
import { money, shortDateTime } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

const profileLabels = { admin: "Administrateur", leader: "Chef de club", lender: "Preteur", borrower: "Emprunteur", mediator: "Mediateur", collector: "Mandataire" };

export function AccountValidationsScreen() {
    const navigation = useNavigation(); const dispatch = useDispatch();
    const [users, setUsers] = useState(); const [userId, setUserId] = useState(""); const [data, setData] = useState(); const [loading, setLoading] = useState(false);
    useEffect(() => { api("/users/").then(response => setUsers(response.results || [])).catch(error => Alert.alert("Chargement impossible", error.message)); }, []);
    async function load(id = userId) { if (!id) return setData(undefined); setLoading(true); try { setData(await api(`/users/${id}/validations/`)); } catch (error) { Alert.alert("Chargement impossible", error.message); } finally { setLoading(false); } }
    useEffect(() => { load(userId); }, [userId]);

    const items = useMemo(() => !data ? [] : [
        ...data.kyc_applications.map(item => ({ ...item, type: "kyc", title: "Validation du dossier KYC", name: item.user_detail.name, detail: `Soumis le ${shortDateTime(item.submitted_at || item.created_at)}` })),
        ...data.lender_profiles.map(item => ({ ...item, type: "lender", title: "Validation d'un profil preteur", name: item.name, detail: "Profil global sans rattachement a un club", status: "pending" })),
        ...data.memberships.map(item => ({ ...item, type: "membership", title: "Validation d'un profil emprunteur", name: item.user_detail.name, detail: `${item.club_name} - membre ${item.member_approved_at ? "confirme" : "en attente"}, chef ${item.leader_approved_at ? "confirme" : "en attente"}` })),
        ...data.loans.map(item => ({ ...item, type: "loan", title: data.validator_kind === "admin" ? "Validation finale d'un emprunt" : "Accord du chef sur un emprunt", name: item.borrower_name, detail: `${item.club_name} - ${money(item.amount, item.currency)}` })),
        ...data.deposits.map(item => ({ ...item, type: "deposit", title: "Validation d'une mise", name: item.lender_name, detail: money(item.amount, item.currency) })),
        ...data.withdrawals.map(item => ({ ...item, type: "withdrawal", title: "Validation d'une recuperation", name: item.lender_name, detail: money(item.amount, item.currency) })),
        ...data.placements.map(item => ({ ...item, type: "placement", title: "Validation d'un placement", name: item.lender_name, detail: `${item.loan_reference} - ${money(item.pending_amount, item.currency)}`, status: "pending" })),
        ...data.activities.map(item => ({ ...item, type: "activity", title: "Validation d'une activite", name: item.name, detail: `Proposee par ${item.proposed_by_detail?.name || "un membre"}` })),
        ...data.collective_requests.map(item => ({ ...item, type: "collective", title: "Accord de co-emprunteur", name: item.user_detail.name, detail: `${item.loan} - ${money(item.share_amount, "CDF")}` })),
    ], [data]);

    async function decide(item, approve) {
        setLoading(true);
        try {
            const reason = approve ? "" : "Decision motivee de l'administration";
            if (item.type === "loan") await api(`/loans/${item.id}/${data.validator_kind === "admin" ? "decide" : "admin-leader-decide"}/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            if (item.type === "membership") { const action = item.required_action === "admin" ? "decide" : "leader-decide"; await api(`/memberships/${item.id}/${action}/`, { method: "POST", body: JSON.stringify({ approve, reason }) }); }
            if (item.type === "lender") await api(`/users/${item.id}/decide-lender-profile/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            if (item.type === "deposit") await api(`/deposits/${item.id}/decide/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            if (item.type === "withdrawal") await api(`/withdrawals/${item.id}/decide/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            if (item.type === "placement") await api(`/loans/placements/${item.id}/review/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            if (item.type === "activity") await api(`/economic-activities/${item.id}/review/`, { method: "POST", body: JSON.stringify({ approve, reason }) });
            dispatch(invalidate(["dashboard", "clubs", "loans", "members", "validations", "notifications"])); await load();
        } catch (error) { Alert.alert("Decision impossible", error.message); } finally { setLoading(false); }
    }

    if (!users) return <LoadingScreen/>;
    return <Screen>
      <PageHeader eyebrow="Controle par decideur" title="Validations des utilisateurs" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <Select label="Compte qui doit valider" value={userId} searchable placeholder="Nom ou numero de telephone" options={users.map(item => ({ value: item.id, label: `${item.name} - ${item.phone}`, note: profileLabels[item.current_profile] || profileLabels[item.role] }))} onChange={setUserId}/>
      {loading && !data ? <LoadingScreen/> : null}
      {data ? <><View style={styles.person}><Avatar user={data.user} size={48}/><View style={styles.flex}><Text style={styles.name}>{data.user.name}</Text><Text style={styles.phone}>{data.user.phone}</Text><Text style={styles.profiles}>Decideur : {data.validator_kind === "admin" ? "Administration" : data.validator_kind === "leader" ? "Chef de club" : "Membre concerne"}</Text></View><View style={styles.pending}><Text style={styles.pendingValue}>{items.length}</Text><Text style={styles.pendingLabel}>a traiter</Text></View></View><Text style={styles.explanation}>Cette liste contient uniquement les decisions attendues de ce compte. Une demande emise ici mais validee ailleurs apparait chez l'autre decideur.</Text>{items.length ? <View style={styles.list}>{items.map(item => <ValidationRow key={`${item.type}-${item.id}`} item={item} loading={loading} onOpen={() => navigation.navigate("Identities", { applicationId: item.id })} onDecide={decide}/>)}</View> : <EmptyState icon={BadgeCheck} title="Aucune validation assignee" message="Ce compte n'a actuellement aucune decision a prendre."/>}</> : <EmptyState icon={UsersRound} title="Selectionnez un decideur" message="Vous verrez les operations qui attendent reellement sa validation."/>}
    </Screen>;
}

function ValidationRow({ item, loading, onOpen, onDecide }) {
    const icons = { kyc: BadgeCheck, lender: UserRoundCheck, membership: Landmark, loan: PiggyBank, deposit: WalletCards, withdrawal: CircleDollarSign, placement: HandCoins, activity: BadgeCheck, collective: UsersRound }; const Icon = icons[item.type] || BadgeCheck;
    const personal = item.type === "collective" || (item.type === "membership" && item.required_action === "member");
    return <View style={styles.row}><View style={styles.icon}><Icon size={18} color={colors.forest}/></View><View style={styles.flex}><Text style={styles.rowOperation}>{item.title}</Text><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowSubtitle}>{item.detail}</Text><Status value={item.status}/>{personal ? <Text style={styles.personal}>Confirmation personnelle requise dans le compte du membre.</Text> : null}</View><View style={styles.rowAction}>{item.type === "kyc" ? <Button label="Examiner" variant="secondary" onPress={onOpen}/> : personal ? null : <DecisionActions loading={loading} onApprove={() => onDecide(item, true)} onReject={() => onDecide(item, false)}/>}</View></View>;
}
function DecisionActions({ onApprove, onReject, loading }) { return <View style={styles.decisions}><Button label="Refuser" variant="ghost" onPress={onReject} loading={loading}/><Button label="Valider" onPress={onApprove} loading={loading}/></View>; }
const styles = StyleSheet.create({ flex: { flex: 1 }, person: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, name: { fontFamily: font.bold, color: colors.white, fontSize: 14 }, phone: { marginTop: 3, fontFamily: font.medium, color: colors.mint, fontSize: 10 }, profiles: { marginTop: 3, fontFamily: font.medium, color: colors.yellow, fontSize: 8 }, pending: { alignItems: "center" }, pendingValue: { fontFamily: font.bold, color: colors.white, fontSize: 22 }, pendingLabel: { fontFamily: font.medium, color: colors.mint, fontSize: 8 }, explanation: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSoft, fontFamily: font.medium, color: colors.forest, fontSize: 10, lineHeight: 16 }, list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.white }, row: { minHeight: 98, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, icon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.mint }, rowOperation: { fontFamily: font.bold, color: colors.coral, fontSize: 8, textTransform: "uppercase" }, rowTitle: { marginTop: 3, fontFamily: font.bold, color: colors.ink, fontSize: 11 }, rowSubtitle: { marginVertical: 4, fontFamily: font.medium, color: colors.muted, fontSize: 8, lineHeight: 13 }, personal: { marginTop: 5, fontFamily: font.semibold, color: colors.skyDark, fontSize: 8, lineHeight: 13 }, rowAction: { width: 116 }, decisions: { gap: spacing.xs } });
