import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, Building2, FileLock2, Handshake, Scale, ShieldCheck } from "lucide-react-native";
import { IconButton, PageHeader, Screen } from "@/components/ui";
import { colors, font, radius, spacing } from "@/theme";

const terms = [
    [Handshake, "Nature du service", "REBOOT CLUB est un outil numerique communautaire qui facilite l'entraide entre personnes organisees en clubs. Il coordonne les demandes d'emprunt, les participations des preteurs, les validations et les remboursements. Ce n'est ni une banque, ni une caisse d'epargne, ni un centre d'investissement."],
    [Building2, "Conservation des fonds", "Les sommes mises a disposition entre les clubs sont conservees dans le compte bancaire, compte d'epargne ou dispositif financier formel choisi par l'organisation responsable des clubs. REBOOT CLUB affiche et trace les mouvements sans transformer ces sommes en depots bancaires aupres de l'application."],
    [Scale, "Aides, couts et risques", "Chaque aide est soumise aux conditions affichees avant confirmation: montant, echeances, interet du preteur et frais communautaires. Aucun gain n'est garanti. Les participants doivent verifier leur capacite, respecter les decisions de gouvernance et signaler toute anomalie."],
    [ShieldCheck, "Validation et responsabilite", "Le KYC est obligatoire pour les operations financieres. Une demande d'emprunt passe par le chef du club puis l'administrateur. L'utilisateur reste responsable de l'exactitude de ses informations, de la securite de son telephone et du respect de ses engagements."],
];
const privacy = [
    [FileLock2, "Donnees collectees", "Nous traitons les informations de compte, numero de telephone, identite, activite, justificatifs KYC, clubs, demandes, validations, messages et historique des operations necessaires au fonctionnement communautaire."],
    [ShieldCheck, "Acces limite", "Les donnees sont accessibles selon les roles. Un emprunteur ne voit que son club et ses dossiers. Un preteur voit les offres approuvees et sa propre participation. Les chefs voient leur club. L'administration accede aux informations requises pour controler, assister et auditer."],
    [Building2, "Utilisation et conservation", "Les donnees servent a securiser les comptes, verifier l'identite, executer le circuit de validation, calculer les echeances, traiter le support et prevenir les abus. Elles sont conservees pendant la duree necessaire au suivi legal et communautaire."],
    [Scale, "Vos droits", "Vous pouvez demander la correction de vos informations, consulter votre situation et ouvrir une reclamation. Certaines traces financieres et d'audit ne peuvent pas etre effacees lorsqu'elles sont necessaires a la preuve des operations."],
];

export function LegalScreen() {
    const navigation = useNavigation(); const route = useRoute(); const type = route.params?.type || "terms"; const sections = type === "privacy" ? privacy : terms;
    return <Screen><PageHeader eyebrow="REBOOT CLUB" title={type === "privacy" ? "Confidentialite" : "Conditions d'utilisation"} action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/><View style={styles.notice}><Text style={styles.noticeText}>{type === "privacy" ? "Protection des informations dans un cadre communautaire controle." : "Ensemble pour nous soutenir en toute confiance."}</Text></View>{sections.map(([Icon, title, body]) => <View key={title} style={styles.section}><View style={styles.icon}><Icon size={20} color={colors.primary}/></View><View style={styles.flex}><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View></View>)}<Text style={styles.updated}>Version applicable au 28 aout 2026</Text></Screen>;
}
const styles = StyleSheet.create({ flex: { flex: 1 }, notice: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary }, noticeText: { fontFamily: font.bold, color: colors.white, fontSize: 17, lineHeight: 24 }, section: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, icon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.brandSoft }, title: { fontFamily: font.bold, color: colors.ink, fontSize: 13 }, body: { marginTop: 5, fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 18 }, updated: { fontFamily: font.medium, color: colors.muted, fontSize: 9, textAlign: "center" } });
