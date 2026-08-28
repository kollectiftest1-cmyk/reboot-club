import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { ArrowLeft, Camera, Check, ChevronDown, FileBadge, Send, ShieldCheck, X } from "lucide-react-native";

import { Button, Field, IconButton, LoadingScreen, OperationResultModal, PageHeader, Screen, Status } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { colors, font, radius, spacing } from "@/theme";

const documentTypes = [
    { id: "voter_card", label: "Carte d'electeur" },
    { id: "national_id", label: "Carte nationale" },
    { id: "passport", label: "Passeport" },
];
const professions = [
    { id: "trader", label: "Commercant(e)" }, { id: "entrepreneur", label: "Entrepreneur(e)" },
    { id: "artisan", label: "Artisan(e)" }, { id: "farmer", label: "Agriculteur(trice)" },
    { id: "breeder", label: "Eleveur(se)" }, { id: "fisher", label: "Pecheur(se)" },
    { id: "driver", label: "Chauffeur / conducteur" }, { id: "mechanic", label: "Mecanicien(ne)" },
    { id: "teacher", label: "Enseignant(e)" }, { id: "public_servant", label: "Agent public" },
    { id: "private_employee", label: "Employe(e) du prive" }, { id: "health_worker", label: "Professionnel(le) de sante" },
    { id: "hairdresser", label: "Coiffeur(se) / estheticien(ne)" }, { id: "tailor", label: "Couturier(ere)" },
    { id: "restaurateur", label: "Restaurateur(trice)" }, { id: "student", label: "Etudiant(e)" },
    { id: "other", label: "Autre profession" },
];

export function KYCFormScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const { refreshUser } = useAuth();
    // Mode assiste : l'administrateur remplit le dossier a la place d'un membre non KYC.
    const targetUser = route.params?.targetUser;
    const assisted = Boolean(targetUser);
    const [existing, setExisting] = useState();
    const [loaded, setLoaded] = useState(false);
    const [form, setForm] = useState({ activity_id: "", activity_other: "", occupation: "trader", employer_or_business: "", monthly_income: "", address: "", document_type: "voter_card", document_number: "" });
    const [activities, setActivities] = useState([]);
    const [document, setDocument] = useState();
    const [selfie, setSelfie] = useState();
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState();

    useEffect(() => {
        Promise.all([assisted ? Promise.resolve({ results: [] }) : api("/kyc/"), api("/economic-activities/")]).then(([data, activityData]) => {
            setActivities(activityData.results || activityData);
            const application = data.results?.[0];
            setExisting(application);
            if (application) setForm(current => ({ ...current, activity_id: application.activity_reference || "other", activity_other: application.activity_reference ? "" : application.activity, occupation: application.occupation, employer_or_business: application.employer_or_business, monthly_income: String(application.monthly_income), address: application.address, document_type: application.document_type, document_number: application.document_number }));
        }).finally(() => setLoaded(true));
    }, [assisted]);

    async function chooseDocument() {
        const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "application/pdf"], copyToCacheDirectory: true });
        if (!picked.canceled) setDocument(picked.assets[0]);
    }

    async function takeSelfie() {
        // En mode assiste la photo du membre est deja prise : on l'importe depuis la galerie.
        if (assisted) {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                setResult({ success: false, title: "Photos inaccessibles", message: "Autorisez REBOOT CLUB a acceder aux photos pour joindre le portrait du membre." });
                return;
            }
            const chosen = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.78 });
            if (!chosen.canceled) setSelfie(chosen.assets[0]);
            return;
        }
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            setResult({ success: false, title: "Camera inaccessible", message: "Autorisez REBOOT CLUB a utiliser la camera pour prendre votre photo KYC." });
            return;
        }
        const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.78 });
        if (!picked.canceled) setSelfie(picked.assets[0]);
    }

    async function submit() {
        const missing = !form.activity_id || (form.activity_id === "other" && !form.activity_other.trim()) || !form.occupation || !form.monthly_income || !form.address.trim() || !form.document_number.trim() || !document || !selfie;
        if (missing) {
            setResult({ success: false, title: "Dossier incomplet", message: "Renseignez votre activite, vos revenus, votre adresse et joignez les deux pieces demandees." });
            return;
        }
        setSaving(true);
        try {
            const identityFile = document.file || new File(document);
            const selfieFile = selfie.file || new File(selfie.uri);
            if (("exists" in identityFile && !identityFile.exists) || ("exists" in selfieFile && !selfieFile.exists)) throw new Error("Une piece selectionnee n'est plus accessible. Selectionnez-la de nouveau.");
            if (!identityFile.size || !selfieFile.size) throw new Error("Une piece selectionnee est vide. Selectionnez un autre fichier.");
            const payload = new FormData();
            Object.entries(form).forEach(([key, value]) => { if (key !== "activity_id" || value !== "other") payload.append(key, value); });
            payload.append("identity_document", identityFile);
            payload.append("selfie", selfieFile);
            if (assisted) {
                payload.append("user", String(targetUser.id));
                await api("/kyc/submit-for/", { method: "POST", body: payload });
                setResult({ success: true, title: "Dossier depose", message: `Le dossier de ${targetUser.name} est enregistre et attend votre validation.`, detail: "Vous pouvez le valider depuis l'ecran Identites." });
            } else {
                await api("/kyc/submit/", { method: "POST", body: payload });
                await refreshUser();
                setResult({ success: true, title: "Dossier KYC envoye", message: "Vos informations et vos pieces sont maintenant en attente de controle administratif.", detail: "Les profils financiers resteront bloques jusqu'a la validation finale." });
            }
        } catch (error) {
            setResult({ success: false, title: "Envoi impossible", message: error.message, detail: "Aucune validation n'a ete appliquee." });
        } finally {
            setSaving(false);
        }
    }

    if (!loaded) return <LoadingScreen/>;
    if (!assisted && existing && ["submitted", "review", "approved"].includes(existing.status)) return <Screen>
      <PageHeader eyebrow="Conformite et identite" title="Mon dossier KYC" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.locked}><View style={styles.lockedIcon}><ShieldCheck size={28} color={colors.white}/></View><Status value={existing.status}/><Text style={styles.lockedTitle}>{existing.status === "approved" ? "Identite validee" : "Controle en cours"}</Text><Text style={styles.lockedText}>{existing.status === "approved" ? "Votre dossier est valide. Vous pouvez demander vos profils preteur ou emprunteur et acceder aux operations autorisees." : "Vos informations et vos pieces ont bien ete recues. Vous recevrez une notification apres la decision administrative."}</Text></View>
      <Button label="Retour au profil" variant="secondary" onPress={() => navigation.goBack()}/>
    </Screen>;
    return <Screen>
      <PageHeader eyebrow={assisted ? "Dossier assiste" : "Conformite et identite"} title={assisted ? `Dossier de ${targetUser.name}` : "Mon dossier KYC"} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      {assisted ? <View style={styles.assisted}><Text style={styles.assistedTitle}>Vous remplissez ce dossier pour {targetUser.name}</Text><Text style={styles.assistedText}>{targetUser.phone} - le membre sera notifie de l'envoi puis de la decision.</Text></View> : null}
      {!assisted && existing ? <View style={styles.statusBand}><View><Text style={styles.statusTitle}>Dernier dossier</Text><Text style={styles.statusDate}>{existing.status === "rejected" ? existing.decision_reason : "Votre dossier est conserve de maniere securisee."}</Text></View><Status value={existing.status}/></View> : null}
      <View style={styles.intro}><ShieldCheck size={23} color={colors.mintDark}/><View style={styles.introCopy}><Text style={styles.introTitle}>Informations professionnelles</Text><Text style={styles.introText}>Ces donnees permettent d'evaluer votre capacite et de securiser les operations du club.</Text></View></View>
      <View style={styles.form}>
        <Dropdown label="Profession ou fonction" value={form.occupation} options={professions} onChange={value => setForm({ ...form, occupation: value })}/>
        <Dropdown label="Activite economique principale" value={form.activity_id} options={[...activities.map(item => ({ id: item.id, label: item.name })), { id: "other", label: "Autre activite (preciser)" }]} placeholder="Selectionner une activite" onChange={value => setForm({ ...form, activity_id: value, activity_other: value === "other" ? form.activity_other : "" })}/>
        {form.activity_id === "other" ? <Field label="Precisez votre activite" value={form.activity_other} onChangeText={value => setForm({ ...form, activity_other: value })} placeholder="Ex. vente locale ou service exerce"/> : null}
        <Field label="Employeur ou nom de l'activite (facultatif)" value={form.employer_or_business} onChangeText={value => setForm({ ...form, employer_or_business: value })}/>
        <Field label="Revenu / chiffre d'affaire mensuel estime" value={form.monthly_income} onChangeText={value => setForm({ ...form, monthly_income: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad"/>
        <Field label="Adresse complete" value={form.address} onChangeText={value => setForm({ ...form, address: value })} multiline/>
      </View>
      <View><Text style={styles.sectionTitle}>Document d'identite</Text><View style={styles.types}>{documentTypes.map(item => <Pressable key={item.id} onPress={() => setForm({ ...form, document_type: item.id })} style={[styles.type, form.document_type === item.id && styles.typeActive]}><Text style={[styles.typeText, form.document_type === item.id && styles.typeTextActive]}>{item.label}</Text></Pressable>)}</View></View>
      <Field label="Numero du document" value={form.document_number} onChangeText={value => setForm({ ...form, document_number: value })}/>
      <View style={styles.files}><FileAction icon={FileBadge} title="Piece d'identite" detail={document?.name || "JPG, PNG ou PDF, 10 Mo maximum"} selected={Boolean(document)} onPress={chooseDocument}/><FileAction icon={Camera} title="Photo portrait" detail={selfie ? "Photo prete" : assisted ? "Importer la photo du membre" : "Prendre une photo avec la camera"} selected={Boolean(selfie)} onPress={takeSelfie}/></View>
      <Button icon={Send} label={assisted ? "Deposer le dossier pour ce membre" : existing?.status === "rejected" ? "Corriger et renvoyer" : "Envoyer pour validation"} onPress={submit} loading={saving}/>
      <OperationResultModal result={result} onClose={() => { const success = result?.success; setResult(undefined); if (success) navigation.goBack(); }}/>
    </Screen>;
}

function FileAction({ icon: Icon, title, detail, selected, onPress }) { return <Pressable onPress={onPress} style={[styles.file, selected && styles.fileSelected]}><View style={styles.fileIcon}><Icon size={20} color={colors.forest}/></View><View style={styles.fileCopy}><Text style={styles.fileTitle}>{title}</Text><Text style={styles.fileDetail} numberOfLines={2}>{detail}</Text></View><Text style={styles.fileAction}>{selected ? "Changer" : "Ajouter"}</Text></Pressable>; }

function Dropdown({ label, value, options, onChange, placeholder = "Selectionner" }) {
    const [open, setOpen] = useState(false);
    const selected = options.find(item => String(item.id) === String(value));
    return <View style={styles.dropdownField}><Text style={styles.dropdownLabel}>{label}</Text><Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.dropdownButton}><Text style={[styles.dropdownValue, !selected && styles.dropdownPlaceholder]} numberOfLines={1}>{selected?.label || placeholder}</Text><ChevronDown size={18} color={colors.muted}/></Pressable><Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}><SafeAreaView edges={["top", "bottom", "left", "right"]} style={styles.dropdownSafe}><View style={styles.dropdownOverlay}><View style={styles.dropdownSheet}><View style={styles.dropdownHeader}><Text style={styles.dropdownTitle}>{label}</Text><Pressable accessibilityLabel="Fermer" onPress={() => setOpen(false)} style={styles.dropdownClose}><X size={20} color={colors.forest}/></Pressable></View><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.dropdownList}>{options.map(item => { const active = String(item.id) === String(value); return <Pressable key={item.id} onPress={() => { onChange(item.id); setOpen(false); }} style={[styles.dropdownOption, active && styles.dropdownOptionActive]}><Text style={[styles.dropdownOptionText, active && styles.dropdownOptionTextActive]}>{item.label}</Text>{active ? <Check size={17} color={colors.forest}/> : null}</Pressable>; })}</ScrollView></View></View></SafeAreaView></Modal></View>;
}

const styles = StyleSheet.create({
    dropdownSafe: { flex: 1, backgroundColor: "transparent" },
    assisted: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.coralSoft }, assistedTitle: { fontFamily: font.bold, color: colors.danger, fontSize: 12 }, assistedText: { marginTop: 3, fontFamily: font.medium, color: colors.danger, fontSize: 9, lineHeight: 14 },
    dropdownField: { gap: spacing.xs }, dropdownLabel: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 }, dropdownButton: { minHeight: 54, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white }, dropdownValue: { flex: 1, fontFamily: font.medium, color: colors.ink, fontSize: 14 }, dropdownPlaceholder: { color: colors.muted }, dropdownOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(8,43,37,0.68)" }, dropdownSheet: { maxHeight: "78%", padding: spacing.lg, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: colors.paper }, dropdownHeader: { marginBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, dropdownTitle: { flex: 1, fontFamily: font.bold, color: colors.ink, fontSize: 18 }, dropdownClose: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.white }, dropdownList: { gap: spacing.xs, paddingBottom: spacing.xl }, dropdownOption: { minHeight: 50, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, dropdownOptionActive: { borderColor: colors.mintDark, backgroundColor: colors.mint }, dropdownOptionText: { flex: 1, fontFamily: font.medium, color: colors.ink, fontSize: 12 }, dropdownOptionTextActive: { fontFamily: font.bold, color: colors.forest },
    locked: { minHeight: 290, padding: spacing.xl, justifyContent: "center", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.forest }, lockedIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, lockedTitle: { fontFamily: font.bold, color: colors.white, fontSize: 24 }, lockedText: { maxWidth: 310, fontFamily: font.medium, color: colors.mint, fontSize: 11, lineHeight: 18, textAlign: "center" },
    statusBand: { minHeight: 72, padding: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, statusTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 12 }, statusDate: { maxWidth: 230, marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 8, lineHeight: 13 },
    intro: { padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.mint }, introCopy: { flex: 1 }, introTitle: { fontFamily: font.bold, color: colors.forest, fontSize: 13 }, introText: { marginTop: 3, fontFamily: font.medium, color: colors.mintDark, fontSize: 9, lineHeight: 15 }, form: { gap: spacing.md }, sectionTitle: { marginBottom: spacing.sm, fontFamily: font.bold, color: colors.ink, fontSize: 15 },
    types: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, type: { minHeight: 42, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, typeActive: { backgroundColor: colors.forest, borderColor: colors.forest }, typeText: { fontFamily: font.semibold, color: colors.muted, fontSize: 9 }, typeTextActive: { color: colors.white }, files: { gap: spacing.sm }, file: { minHeight: 76, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, fileSelected: { borderColor: colors.mintDark, backgroundColor: "#F0FAF5" }, fileIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, fileCopy: { flex: 1 }, fileTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 11 }, fileDetail: { marginTop: 3, fontFamily: font.medium, color: colors.muted, fontSize: 8, lineHeight: 13 }, fileAction: { fontFamily: font.bold, color: colors.coral, fontSize: 9 },
});
