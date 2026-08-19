import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight, LockKeyhole, Phone } from "lucide-react-native";

import { Button, Field, Reveal } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { colors, font, radius, shadow, spacing } from "@/theme";

export function LoginScreen() {
    const { login } = useAuth();
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit() {
        if (!phone.trim() || !password) {
            setError("Renseignez votre numéro et votre mot de passe.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            await login(phone.trim(), password);
        } catch (exception) {
            setError(exception instanceof ApiError ? exception.message : "Connexion impossible.");
        } finally {
            setLoading(false);
        }
    }

    return <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Reveal>
              <View style={styles.brand}><Image source={require("../../assets/icon.png")} style={styles.logo}/><View><Text style={styles.brandName}>REBOOT CLUB</Text><Text style={styles.brandMeta}>Épargne et crédit communautaire</Text></View></View>
              <Text style={styles.title}>L’argent du club, en toute confiance.</Text>
              <Text style={styles.subtitle}>Suivez chaque dépôt, décision et remboursement depuis un espace sécurisé.</Text>
            </Reveal>
          </View>
          <Reveal delay={100} style={styles.panel}>
            <View><Text style={styles.panelTitle}>Heureux de vous revoir</Text><Text style={styles.panelSubtitle}>Connectez-vous avec votre numéro de téléphone.</Text></View>
            <Field label="Numéro de téléphone" icon={Phone} keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} placeholder="+243 810 000 000"/>
            <Field label="Mot de passe" icon={LockKeyhole} secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} placeholder="Votre mot de passe" error={error}/>
            <Button label="Se connecter" icon={ArrowRight} onPress={submit} loading={loading}/>
            <Text style={styles.legal}>En continuant, vous acceptez les conditions d’utilisation et la politique de confidentialité.</Text>
          </Reveal>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.forest }, flex: { flex: 1 }, content: { flexGrow: 1, backgroundColor: colors.paper },
    hero: { minHeight: 330, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl, backgroundColor: colors.forest, justifyContent: "space-between" },
    brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 54 }, logo: { width: 48, height: 48, borderRadius: radius.md },
    brandName: { fontFamily: font.bold, fontSize: 14, color: colors.white }, brandMeta: { fontFamily: font.medium, fontSize: 9, color: colors.mint, marginTop: 2 },
    title: { fontFamily: font.bold, fontSize: 38, lineHeight: 44, letterSpacing: 0, color: colors.white, maxWidth: 350 }, subtitle: { fontFamily: font.regular, fontSize: 14, lineHeight: 22, color: colors.mint, maxWidth: 330, marginTop: spacing.md },
    panel: { flex: 1, marginTop: -16, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md, backgroundColor: colors.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, ...shadow },
    panelTitle: { fontFamily: font.bold, color: colors.ink, fontSize: 21 }, panelSubtitle: { fontFamily: font.regular, color: colors.muted, fontSize: 12, marginTop: 4 },
    legal: { fontFamily: font.regular, color: colors.muted, fontSize: 9, lineHeight: 14, textAlign: "center", paddingHorizontal: spacing.lg, marginTop: spacing.xs },
});
