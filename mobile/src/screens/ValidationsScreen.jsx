import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, BadgeCheck } from "lucide-react-native";

import { Avatar, Button, EmptyState, IconButton, LoadingScreen, PageHeader, Screen, Status } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";
import { useDispatch, useSelector } from "react-redux";
import { invalidate } from "@/store";
import { useAuth } from "@/context/AuthContext";

const roleLabels = {
    admin: "Administrateur",
    leader: "Chef de club",
    lender: "Preteur",
    borrower: "Emprunteur",
    mediator: "Mediateur",
    collector: "Mandataire d'encaissement",
};

function profileLabel(role) {
    return roleLabels[role] || role || "Non defini";
}

export function ValidationsScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();
    const dispatch = useDispatch();
    const version = useSelector(state => state.sync.versions.validations);
    const [items, setItems] = useState();

    const load = useCallback(async () => {
        const admin = user.role === "admin";
        // Depots, retraits et placements sont des operations de caisse : admin seul.
        const [deposits, withdrawals, loans, memberships, lenderProfiles, activities, kycApplications, placements] = await Promise.all([
            admin ? api("/deposits/") : Promise.resolve({ results: [] }),
            admin ? api("/withdrawals/") : Promise.resolve({ results: [] }),
            api("/loans/"),
            api("/memberships/"),
            admin ? api("/users/lender-profile-requests/") : Promise.resolve({ results: [] }),
            admin ? api("/economic-activities/pending/") : Promise.resolve({ results: [] }),
            admin ? api("/kyc/") : Promise.resolve({ results: [] }),
            admin ? api("/loans/pending-placements/") : Promise.resolve({ results: [] }),
        ]);

        setItems([
            ...kycApplications.results.filter(item => ["submitted", "review"].includes(item.status)).map(item => ({
                ...item,
                type: "kyc",
                operation: "Validation du dossier KYC",
                title: item.user_detail.name,
                subtitle: `${item.occupation_label || item.occupation} - ${item.activity}`,
                profileLine: `Profil actuel : ${profileLabel(item.user_detail.current_profile)}`,
                detailLabel: "Controle requis",
                value: "Identite, activite et justificatifs",
                person: { ...item.user_detail, selfie: item.selfie },
            })),
            ...memberships.results.filter(item => item.status === "pending" && (user.role === "admin" ? item.member_approved_at && item.leader_approved_at : !item.leader_approved_at && item.user !== user.id)).map(item => ({
                ...item,
                type: "membership",
                operation: user.role === "admin" ? "Validation finale d'un ajout de profil" : "Confirmation d'un ajout de profil",
                title: item.user_detail.name,
                subtitle: `Club : ${item.club_name}`,
                profileLine: `Profil actuel : ${profileLabel(item.user_detail.current_profile)}  |  Profil demande : Emprunteur`,
                detailLabel: "Etat des accords",
                value: user.role === "admin" ? "Membre et chef ont confirme" : item.member_approved_at ? "Membre deja confirme" : "Confirmation du chef attendue",
                person: item.user_detail,
            })),
            ...lenderProfiles.results.map(item => ({
                ...item,
                type: "lender_profile",
                status: "pending",
                operation: "Demande d'ajout du profil preteur",
                title: item.name,
                subtitle: "Profil global, sans rattachement a un club",
                profileLine: `Profil actuel : ${profileLabel(item.current_profile)}  |  Profil demande : Preteur`,
                detailLabel: "Circuit de validation",
                value: "Validation de l'administrateur",
                person: item,
            })),
            ...loans.results.filter(item => ["submitted", "review"].includes(item.status)).map(item => ({
                ...item,
                type: "loan",
                operation: "Validation d'une demande d'emprunt",
                title: item.borrower_name,
                subtitle: `Club : ${item.club_name || "Non renseigne"} - ${item.purpose}`,
                profileLine: "Profil concerne : Emprunteur",
                detailLabel: "Montant demande",
                value: money(item.amount, item.currency),
                person: { name: item.borrower_name, avatar: item.borrower_avatar, selfie: item.borrower_selfie },
            })),
            ...deposits.results.filter(item => item.status === "pending").map(item => ({
                ...item,
                type: "deposit",
                operation: "Validation d'un depot client",
                title: item.lender_name,
                subtitle: `Portefeuille global du preteur`,
                profileLine: "Profil concerne : Preteur",
                detailLabel: "Montant du depot",
                value: money(item.amount, item.currency),
                person: { name: item.lender_name, avatar: item.lender_avatar, selfie: item.lender_selfie },
            })),
            ...placements.results.map(item => ({
                ...item,
                type: "placement",
                status: "pending",
                operation: "Validation d'un placement",
                title: item.lender_name,
                subtitle: `Pret ${item.loan_reference} - ${item.club_name}`,
                profileLine: "Profil concerne : Preteur",
                detailLabel: "Montant a valider",
                value: money(item.pending_amount, item.currency),
                person: { name: item.lender_name },
            })),
            ...withdrawals.results.filter(item => ["submitted", "review"].includes(item.status)).map(item => ({
                ...item,
                type: "withdrawal",
                operation: "Validation d'une demande de retrait",
                title: item.lender_name,
                subtitle: `Portefeuille global du preteur`,
                profileLine: "Profil concerne : Preteur",
                detailLabel: "Montant a retirer",
                value: money(item.amount, item.currency),
                person: { name: item.lender_name, avatar: item.lender_avatar, selfie: item.lender_selfie },
            })),
            ...activities.results.map(item => ({
                ...item,
                type: "economic_activity",
                operation: "Validation d'une activite proposee",
                title: item.name,
                subtitle: `Proposee par ${item.proposed_by_detail?.name || "un membre"}`,
                profileLine: `Profil actuel : ${profileLabel(item.proposed_by_detail?.current_profile)}`,
                detailLabel: "Effet de la validation",
                value: "Ajouter a la liste commune",
                person: item.proposed_by_detail,
            })),
        ]);
    }, [user.id, user.role]);
    // eslint-disable-next-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load, version]);
    if (!items) return <LoadingScreen/>;

    async function decide(item, approve) {
        try {
            if (item.type === "lender_profile") {
                await api(`/users/${item.id}/decide-lender-profile/`, { method: "POST", body: JSON.stringify({ approve, reason: approve ? "" : "Decision motivee de l'administrateur" }) });
                dispatch(invalidate(["dashboard", "members", "validations", "notifications"]));
                await load();
                return;
            }
            if (item.type === "placement") {
                await api(`/loans/placements/${item.id}/review/`, { method: "POST", body: JSON.stringify({ approve, reason: approve ? "" : "Placement refuse par l'administrateur" }) });
                dispatch(invalidate(["dashboard", "loans", "validations", "notifications"]));
                await load();
                return;
            }
            if (item.type === "economic_activity") {
                await api(`/economic-activities/${item.id}/review/`, { method: "POST", body: JSON.stringify({ approve, reason: approve ? "" : "Activite non retenue dans le referentiel commun" }) });
                dispatch(invalidate(["dashboard", "validations", "notifications"]));
                await load();
                return;
            }
            const endpoints = { deposit: "deposits", withdrawal: "withdrawals", loan: "loans", membership: "memberships" };
            const action = item.type === "membership" && user.role !== "admin" ? "leader-decide" : "decide";
            await api(`/${endpoints[item.type]}/${item.id}/${action}/`, { method: "POST", body: JSON.stringify({ approve, reason: approve ? "" : "Decision motivee du responsable" }) });
            dispatch(invalidate(["dashboard", "clubs", "loans", "members", "validations", "notifications"]));
            await load();
        } catch (error) {
            Alert.alert("Decision impossible", error instanceof Error ? error.message : "Reessayez.");
        }
    }

    return <Screen>
      <PageHeader eyebrow="Controle" title="Validations" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.summary}><BadgeCheck size={22} color={colors.mintDark}/><View><Text style={styles.summaryValue}>{items.length}</Text><Text style={styles.summaryLabel}>decision{items.length > 1 ? "s" : ""} en attente</Text></View></View>
      {items.length ? <View style={styles.list}>{items.map(item => <ValidationItem key={`${item.type}-${item.id}`} item={item} onDecide={decide} onOpen={() => navigation.navigate("Identities", { applicationId: item.id })} admin={user.role === "admin"}/>)}</View> : <EmptyState icon={BadgeCheck} title="Tout est traite" message="Aucune decision ne demande votre intervention."/>}
    </Screen>;
}

function ValidationItem({ item, onDecide, onOpen, admin }) {
    return <View style={styles.card}>
      <Text style={styles.operation}>{item.operation}</Text>
      <View style={styles.cardTop}><Avatar user={item.person} size={42}/><View style={styles.cardText}><Text style={styles.title}>{item.title}</Text><Text style={styles.subtitle}>{item.subtitle}</Text></View><Status value={item.status}/></View>
      <View style={styles.profileLine}><Text style={styles.profileLineText}>{item.profileLine}</Text></View>
      <View style={styles.decisionDetail}><Text style={styles.detailLabel}>{item.detailLabel}</Text><Text style={styles.value}>{item.value}</Text></View>
      {item.type === "membership" ? <View style={styles.steps}><Text style={[styles.step, item.member_approved_at && styles.stepDone]}>Membre {item.member_approved_at ? "confirme" : "en attente"}</Text><Text style={[styles.step, item.leader_approved_at && styles.stepDone]}>Chef {item.leader_approved_at ? "confirme" : "en attente"}</Text><Text style={styles.step}>Admin {admin ? "a decider" : "ensuite"}</Text></View> : item.type === "lender_profile" ? <View style={styles.steps}><Text style={[styles.step, styles.stepDone]}>Demande envoyee</Text><Text style={styles.step}>Admin a decider</Text></View> : item.type === "economic_activity" ? <View style={styles.steps}><Text style={[styles.step, styles.stepDone]}>Usage prive conserve</Text><Text style={styles.step}>Publication admin</Text></View> : item.type === "placement" ? <View style={styles.steps}><Text style={[styles.step, styles.stepDone]}>Capital reserve</Text><Text style={styles.step}>Validation admin</Text><Text style={styles.step}>Financement du pret</Text></View> : null}
      {item.type === "kyc" ? <Button icon={BadgeCheck} label="Examiner le dossier KYC" variant="secondary" onPress={onOpen}/> : <View style={styles.actions}><View style={styles.action}><Button label="Refuser" variant="ghost" onPress={() => onDecide(item, false)}/></View><View style={styles.action}><Button label={item.type === "membership" && !admin ? "Confirmer" : "Valider"} onPress={() => onDecide(item, true)}/></View></View>}
    </View>;
}

const styles = StyleSheet.create({
    summary: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint },
    summaryValue: { fontFamily: font.bold, color: colors.forest, fontSize: 20 },
    summaryLabel: { fontFamily: font.medium, color: colors.mintDark, fontSize: 10 },
    list: { gap: spacing.md },
    card: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
    operation: { fontFamily: font.bold, color: colors.coral, fontSize: 9, textTransform: "uppercase" },
    cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    cardText: { flex: 1 },
    title: { fontFamily: font.bold, color: colors.ink, fontSize: 13 },
    subtitle: { fontFamily: font.medium, color: colors.muted, fontSize: 10, marginTop: 2, lineHeight: 15 },
    profileLine: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.paper },
    profileLineText: { fontFamily: font.semibold, color: colors.ink, fontSize: 9, lineHeight: 14 },
    decisionDetail: { gap: 3 },
    detailLabel: { fontFamily: font.semibold, color: colors.muted, fontSize: 9 },
    value: { fontFamily: font.bold, color: colors.ink, fontSize: 15 },
    steps: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    step: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.paper, fontFamily: font.semibold, color: colors.muted, fontSize: 8 },
    stepDone: { backgroundColor: colors.mint, color: colors.forest },
    actions: { flexDirection: "row", gap: spacing.sm },
    action: { flex: 1 },
});
