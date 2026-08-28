import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, ChevronDown, ChevronRight, FileQuestion, Headphones, MessageSquareText, ShieldCheck } from "lucide-react-native";
import { Button, IconButton, PageHeader, Screen } from "@/components/ui";
import { colors, font, radius, spacing } from "@/theme";

const faqs = [
    ["Comment faire une mise ?", "Activez un profil preteur et validez votre KYC. Depuis Accueil, touchez Mise, saisissez le montant puis envoyez. La mise devient disponible apres validation administrative et reste conservee dans le dispositif bancaire ou d'epargne utilise par les clubs."],
    ["Comment recuperer mes fonds ?", "Depuis Accueil, choisissez Recuperation. L'ecran indique le maximum recuperable, calcule apres les montants deja engages dans les aides en cours."],
    ["Comment soutenir une demande ?", "Le profil preteur voit toutes les demandes approuvees. Ouvrez une demande, saisissez votre participation et consultez la prevision. Le montant est reserve jusqu'a la validation administrative."],
    ["Comment demander un emprunt ?", "Un profil emprunteur actif, un club et un KYC valide sont requis. Completez le formulaire, simulez les echeances puis envoyez la demande."],
    ["Quel est le cycle de validation ?", "L'emprunteur soumet. Pour un pret collectif, chaque co-emprunteur accepte. Le chef du club donne ensuite son accord, puis l'administrateur valide avant publication aux preteurs."],
    ["Comment fonctionne le remboursement ?", "Les versements sont libres avant chaque date, mais leur cumul doit couvrir l'echeance au plus tard le jour prevu. Les retours sont repartis selon les participations enregistrees."],
    ["REBOOT CLUB est-il une banque ?", "Non. REBOOT CLUB est un outil communautaire de coordination et de tracabilite. Il ne collecte pas l'argent pour son propre compte et ne promet aucun rendement. Les fonds sont gardes dans le compte bancaire ou d'epargne retenu par l'organisation des clubs."],
    ["Que faire en cas d'erreur ?", "Ouvrez une reclamation pour contester une operation precise. Pour une question d'utilisation, envoyez plutot une demande de support."],
];

export function HelpSupportScreen() {
    const navigation = useNavigation(); const [open, setOpen] = useState(0);
    return <Screen><PageHeader eyebrow="Centre d'aide" title="Aide et support" action={<IconButton icon={ArrowLeft} label="Retour" onPress={() => navigation.goBack()}/>}/>
      <View style={styles.hero}><View style={styles.heroIcon}><Headphones size={24} color={colors.white}/></View><View style={styles.flex}><Text style={styles.heroTitle}>Une question sur l'entraide ?</Text><Text style={styles.heroText}>Consultez les reponses ou transmettez une demande a l'equipe REBOOT CLUB.</Text></View></View>
      <View style={styles.actions}><Button icon={MessageSquareText} label="Contacter le support" onPress={() => navigation.navigate("OperationForm", { mode: "support" })}/><Button icon={ShieldCheck} variant="secondary" label="Ouvrir une reclamation" onPress={() => navigation.navigate("OperationForm", { mode: "dispute" })}/></View>
      <Text style={styles.sectionTitle}>Questions frequentes</Text><View style={styles.list}>{faqs.map(([question, answer], index) => <Pressable key={question} onPress={() => setOpen(open === index ? -1 : index)} style={styles.item}><View style={styles.question}><View style={styles.questionIcon}><FileQuestion size={17} color={colors.primary}/></View><Text style={styles.questionText}>{question}</Text>{open === index ? <ChevronDown size={17} color={colors.muted}/> : <ChevronRight size={17} color={colors.muted}/>}</View>{open === index ? <Text style={styles.answer}>{answer}</Text> : null}</Pressable>)}</View>
    </Screen>;
}
const styles = StyleSheet.create({ flex: { flex: 1 }, hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary }, heroIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "rgba(255,255,255,.18)" }, heroTitle: { fontFamily: font.bold, color: colors.white, fontSize: 16 }, heroText: { marginTop: 4, fontFamily: font.medium, color: colors.mint, fontSize: 10, lineHeight: 16 }, actions: { gap: spacing.sm }, sectionTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 18 }, list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.white }, item: { padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, question: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: spacing.sm }, questionIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brandSoft }, questionText: { flex: 1, fontFamily: font.semibold, color: colors.ink, fontSize: 11, lineHeight: 16 }, answer: { paddingTop: spacing.sm, paddingLeft: 44, fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 17 } });
