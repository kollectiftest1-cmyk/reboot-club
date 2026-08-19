import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, BadgeCheck, ChevronDown, ChevronRight, FileSearch, IdCard, Search, UserRoundX, XCircle } from "lucide-react-native";

import { Avatar, Button, EmptyState, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api, mediaUrl } from "@/lib/api";
import { money } from "@/lib/format";
import { invalidate } from "@/store";
import { colors, font, radius, spacing } from "@/theme";

export function IdentitiesScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const dispatch = useDispatch();
    const { user } = useAuth();
    const version = useSelector(state => state.sync.versions.members);
    const [applications, setApplications] = useState();
    const [openId, setOpenId] = useState(route.params?.applicationId);
    const [reason, setReason] = useState("");
    const [result, setResult] = useState();
    // Vue "comptes non KYC" : l'admin peut deposer le dossier a la place du membre.
    const [showMissing, setShowMissing] = useState(false);
    const [missing, setMissing] = useState();
    const [search, setSearch] = useState("");

    const admin = user.role === "admin";
    const load = useCallback(() => api("/kyc/").then(data => setApplications(data.results)), []);
    useEffect(() => { load(); }, [load, version]);

    const loadMissing = useCallback(async (query = "") => {
        try {
            const response = await api(`/kyc/missing/?search=${encodeURIComponent(query)}`);
            setMissing(response.results);
        } catch (error) {
            setMissing([]);
        }
    }, []);
    useEffect(() => { if (showMissing) loadMissing(search); }, [showMissing, loadMissing]);

    async function review(application, approve) {
        if (!approve && !reason.trim()) {
            setResult({ success: false, title: "Motif obligatoire", message: "Indiquez clairement ce que le membre doit corriger dans son dossier." });
            return;
        }
        try {
            await api(`/kyc/${application.id}/review/`, { method: "POST", body: JSON.stringify({ approve, reason: reason.trim() }) });
            dispatch(invalidate(["members", "dashboard", "validations", "notifications"]));
            setResult({ success: true, title: approve ? "KYC valide" : "KYC refuse", message: approve ? `${application.user_detail.name} peut maintenant demander un profil financier et effectuer ses operations.` : "Le membre a recu le motif et peut corriger son dossier." });
            setReason("");
            await load();
        } catch (error) {
            setResult({ success: false, title: "Decision impossible", message: error.message });
        }
    }

    if (!applications) return <LoadingScreen/>;
    const pending = applications.filter(item => ["submitted", "review"].includes(item.status));

    return <Screen>
      <PageHeader eyebrow="Conformite KYC" title="Dossiers d'identite" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {!admin ? <View style={styles.notice}><FileSearch size={20} color={colors.skyDark}/><Text style={styles.noticeText}>Vous pouvez consulter les dossiers de votre club. La decision finale reste reservee a l'administrateur.</Text></View> : null}

      {admin ? <Pressable onPress={() => setShowMissing(current => !current)} style={({ pressed }) => [styles.missingToggle, pressed && styles.pressed]}>
        <View style={styles.missingIcon}><UserRoundX size={20} color={colors.forest}/></View>
        <View style={styles.missingCopy}>
          <Text style={styles.missingTitle}>Voir les comptes non KYC</Text>
          <Text style={styles.missingNote}>Deposer un dossier a la place d'un membre qui ne peut pas le faire</Text>
        </View>
        <ChevronRight size={18} color={colors.muted}/>
      </Pressable> : null}

      {admin && showMissing ? <View style={styles.missingPanel}>
        <View style={styles.searchRow}>
          <View style={styles.searchField}><Field label="Rechercher un compte" icon={Search} value={search} onChangeText={setSearch} placeholder="Nom, telephone ou e-mail" onSubmitEditing={() => loadMissing(search)}/></View>
        </View>
        <Button label="Lancer la recherche" variant="secondary" onPress={() => loadMissing(search)}/>
        {!missing ? <Text style={styles.missingEmpty}>Chargement...</Text>
          : missing.length ? <View style={styles.missingList}>{missing.map(item => <Pressable key={item.id} onPress={() => navigation.navigate("KYCForm", { targetUser: item })} style={({ pressed }) => [styles.missingRow, pressed && styles.pressed]}>
              <Avatar user={item} size={40}/>
              <View style={styles.missingRowCopy}><Text style={styles.missingRowName}>{item.name}</Text><Text style={styles.missingRowMeta}>{item.phone}</Text></View>
              <Status value="not_submitted"/>
            </Pressable>)}</View>
          : <Text style={styles.missingEmpty}>Aucun compte sans dossier KYC.</Text>}
      </View> : null}

      {pending.length ? <View style={styles.list}>{pending.map(application => {
          const open = openId === application.id;
          return <View key={application.id} style={styles.item}>
            <Pressable onPress={() => setOpenId(open ? undefined : application.id)} style={styles.itemTop}>
              <Avatar user={{ ...application.user_detail, selfie: application.selfie }} size={46}/>
              <View style={styles.copy}><Text style={styles.name}>{application.user_detail.name}</Text><Text style={styles.meta}>{application.user_detail.phone} - {application.occupation_label || application.occupation}</Text></View>
              <Status value={application.status}/>
              <ChevronDown size={17} color={colors.muted}/>
            </Pressable>
            {open ? <View style={styles.details}>
              <Detail label="Profession" value={application.occupation_label || application.occupation}/>
              <Detail label="Activite" value={application.activity}/>
              <Detail label="Employeur / activite" value={application.employer_or_business || "Independant"}/>
              <Detail label="Revenu / chiffre d'affaire mensuel" value={money(application.monthly_income, "CDF")}/>
              <Detail label="Adresse" value={application.address}/>
              <Detail label="Document" value={`${application.document_type} - ${application.document_number}`}/>
              <Button icon={IdCard} label="Ouvrir la piece d'identite" variant="secondary" onPress={() => Linking.openURL(mediaUrl(application.identity_document))}/>
              {admin ? <>
                <Field label="Motif en cas de refus" value={reason} onChangeText={setReason} multiline placeholder="Expliquez les corrections attendues"/>
                <View style={styles.actions}><View style={styles.action}><Button icon={XCircle} label="Refuser" variant="ghost" onPress={() => review(application, false)}/></View><View style={styles.action}><Button icon={BadgeCheck} label="Valider" onPress={() => review(application, true)}/></View></View>
              </> : null}
            </View> : null}
          </View>;
      })}</View> : <EmptyState icon={BadgeCheck} title="Dossiers a jour" message="Aucun dossier KYC n'attend une validation."/>}
      <OperationResultModal result={result} onClose={() => setResult(undefined)}/>
    </Screen>;
}

function Detail({ label, value }) { return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
    notice: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sky }, noticeText: { flex: 1, fontFamily: font.medium, color: colors.skyDark, fontSize: 10, lineHeight: 16 },
    missingToggle: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.coral, backgroundColor: colors.white },
    missingIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.coralSoft, alignItems: "center", justifyContent: "center" },
    missingCopy: { flex: 1 }, missingTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, missingNote: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14 },
    missingPanel: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    searchRow: { flexDirection: "row", gap: spacing.sm }, searchField: { flex: 1 },
    missingList: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
    missingRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    missingRowCopy: { flex: 1 }, missingRowName: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, missingRowMeta: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 9 },
    missingEmpty: { fontFamily: font.medium, color: colors.muted, fontSize: 10, textAlign: "center", paddingVertical: spacing.sm },
    pressed: { backgroundColor: colors.paper },
    list: { gap: spacing.sm }, item: { overflow: "hidden", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    itemTop: { minHeight: 78, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm }, copy: { flex: 1 },
    name: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, meta: { fontFamily: font.medium, color: colors.muted, fontSize: 9, marginTop: 4 },
    details: { gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
    detail: { gap: 3 }, detailLabel: { fontFamily: font.medium, color: colors.muted, fontSize: 8, textTransform: "uppercase" }, detailValue: { fontFamily: font.semibold, color: colors.ink, fontSize: 11, lineHeight: 16 },
    actions: { flexDirection: "row", gap: spacing.sm }, action: { flex: 1 },
});
