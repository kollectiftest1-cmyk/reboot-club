import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, CheckCircle2, ChevronDown, Search, WifiOff, X, XCircle } from "lucide-react-native";
import { useState } from "react";

import { statusLabels } from "@/lib/format";
import { mediaUrl } from "@/lib/api";
import { colors, font, radius, shadow, spacing } from "@/theme";

export function Screen({ children, scroll = true, offline = false, style, keyboardOffset = 0 }) {
    const content = <View style={[styles.screenContent, style]}>
      {offline ? <View style={styles.offline}><WifiOff size={15} color={colors.forest}/><Text style={styles.offlineText}>Données enregistrées hors ligne</Text></View> : null}
      {children}
    </View>;
    return <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={keyboardOffset}>
        {scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>{content}</ScrollView> : content}
      </KeyboardAvoidingView>
    </SafeAreaView>;
}

export function Reveal({ children, delay = 0, style }) {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(12)).current;
    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 360, delay, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 420, delay, useNativeDriver: true }),
        ]).start();
    }, [delay, opacity, translateY]);
    return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

export function PageHeader({ eyebrow, title, action }) {
    return <View style={styles.header}><View style={styles.headerText}><View style={styles.brandLine}><View style={styles.brandMark}/><Text style={styles.brandName}>REBOOT CLUB</Text></View>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit>{title}</Text></View>{action ? <View style={styles.headerAction}>{action}</View> : null}</View>;
}

export function Avatar({ user, size = 44, onPress }) {
    const source = mediaUrl(user?.avatar || user?.selfie);
    const name = user?.name || `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || user?.phone || "RC";
    const initials = name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
    const frame = { width: size, height: size, borderRadius: size / 2 };
    const content = source ? <Image source={{ uri: source }} style={[styles.avatarImage, frame]}/> : <View style={[styles.avatarFallback, frame]}><Text style={[styles.avatarInitials, { fontSize: Math.max(11, size * 0.34) }]}>{initials}</Text></View>;
    if (!onPress) return content;
    return <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Agrandir la photo de ${name}`} onPress={onPress} style={({ pressed }) => pressed && styles.avatarPressed}>{content}</Pressable>;
}

export function AvatarViewer({ user, visible, onClose }) {
    const source = mediaUrl(user?.avatar || user?.selfie);
    const name = user?.name || `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || user?.phone || "Membre";
    return <Modal visible={Boolean(visible)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fermer la photo" onPress={onClose} style={styles.avatarViewerBackdrop}>
        <Pressable onPress={event => event.stopPropagation()} style={styles.avatarViewerContent}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={styles.avatarViewerClose}><X size={22} color={colors.white}/></Pressable>
          {source ? <Image source={{ uri: source }} resizeMode="contain" style={styles.avatarViewerImage}/> : <View style={styles.avatarViewerFallback}><Text style={styles.avatarViewerInitials}>{name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</Text></View>}
          <Text style={styles.avatarViewerName}>{name}</Text>
          <Text style={styles.avatarViewerHint}>Photo du profil client</Text>
        </Pressable>
      </Pressable>
    </Modal>;
}

export function Button({ label, icon: Icon, onPress, variant = "primary", loading = false, disabled = false }) {
    const dark = variant !== "primary";
    return <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, styles[`button_${variant}`], variant === "primary" && shadow, pressed && styles.buttonPressed, (disabled || loading) && styles.disabled]}>
      {loading ? <ActivityIndicator color={dark ? colors.forest : colors.white}/> : <>{Icon ? <Icon size={18} strokeWidth={2.2} color={dark ? colors.forest : colors.white}/> : null}<Text style={[styles.buttonText, dark && styles.buttonTextDark]}>{label}</Text></>}
    </Pressable>;
}

export function IconButton({ icon: Icon, onPress, label, badge }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}>
      <Icon size={20} strokeWidth={2.1} color={colors.forest}/>{badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text></View> : null}
    </Pressable>;
}

export function Field({ label, error, icon: Icon, multiline, ...props }) {
    return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={[styles.inputShell, multiline && styles.inputShellMultiline, error && styles.inputError]}>{Icon ? <Icon size={18} color={colors.muted}/>: null}<TextInput placeholderTextColor={colors.muted} style={[styles.input, multiline && styles.inputMultiline]} multiline={multiline} textAlignVertical={multiline ? "top" : "center"} {...props}/></View>{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
}


export function Select({ label, value, options, onChange, placeholder = "Selectionner", error, hint, disabled = false, searchable = false }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = options.find(option => String(option.value) === String(value));
    const filtered = useMemo(() => {
        if (!searchable || !query.trim()) return options;
        const needle = query.trim().toLowerCase();
        return options.filter(option => String(option.label).toLowerCase().includes(needle));
    }, [options, query, searchable]);
    return <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setOpen(true)} style={[styles.inputShell, styles.selectShell, error && styles.inputError, disabled && styles.disabled]}>
        <Text numberOfLines={1} style={[styles.selectValue, !selected && styles.selectPlaceholder]}>{selected ? selected.label : placeholder}</Text>
        <ChevronDown size={18} color={colors.muted}/>
      </Pressable>
      {hint ? <Text style={styles.selectHint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setOpen(false)} style={styles.selectBackdrop}>
          <Pressable onPress={event => event.stopPropagation()} style={styles.selectSheet}>
            <View style={styles.selectHeader}><Text style={styles.selectTitle}>{label || placeholder}</Text><Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setOpen(false)}><X size={20} color={colors.ink}/></Pressable></View>
            {searchable ? <View style={[styles.inputShell, styles.selectSearch]}><Search size={17} color={colors.muted}/><TextInput value={query} onChangeText={setQuery} placeholder="Rechercher" placeholderTextColor={colors.muted} style={styles.input}/></View> : null}
            <ScrollView style={styles.selectList} keyboardShouldPersistTaps="handled">
              {filtered.length ? filtered.map(option => {
                  const active = String(option.value) === String(value);
                  return <Pressable key={String(option.value)} onPress={() => { onChange(option.value, option); setOpen(false); setQuery(""); }} style={({ pressed }) => [styles.selectOption, active && styles.selectOptionActive, pressed && styles.selectOptionPressed]}>
                    <View style={styles.selectOptionCopy}>
                      <Text style={[styles.selectOptionLabel, active && styles.selectOptionLabelActive]}>{option.label}</Text>
                      {option.note ? <Text style={styles.selectOptionNote}>{option.note}</Text> : null}
                    </View>
                    {active ? <Check size={17} color={colors.forest}/> : null}
                  </Pressable>;
              }) : <Text style={styles.selectEmpty}>Aucun element disponible.</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>;
}

export function Chips({ label, options, values, onToggle, hint }) {
    return <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chipRow}>{options.map(option => {
          const active = values.includes(option.value);
          return <Pressable key={String(option.value)} onPress={() => onToggle(option.value)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>;
      })}</View>
      {hint ? <Text style={styles.selectHint}>{hint}</Text> : null}
    </View>;
}

export function Status({ value }) {
    const danger = ["late", "rejected", "blocked", "not_submitted"].includes(value);
    const warning = ["pending", "submitted", "review", "due", "open"].includes(value);
    return <View style={[styles.status, danger ? styles.statusDanger : warning ? styles.statusWarning : styles.statusSuccess]}><Text style={[styles.statusText, danger && styles.statusTextDanger]}>{statusLabels[value] || value}</Text></View>;
}

export function EmptyState({ icon: Icon, title, message }) {
    return <View style={styles.empty}><View style={styles.emptyIcon}><Icon size={25} color={colors.mintDark}/></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyMessage}>{message}</Text></View>;
}

export function LoadingScreen() {
    return <View style={styles.loader}><View style={styles.loaderMark}><ActivityIndicator size="small" color={colors.white}/></View><Text style={styles.loaderText}>REBOOT CLUB</Text></View>;
}

export function OperationResultModal({ result, onClose }) {
    if (!result) return null;
    const success = result.success;
    const Icon = success ? CheckCircle2 : XCircle;
    return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.resultOverlay}>
        <View style={styles.resultSheet}>
          <View style={[styles.resultHero, !success && styles.resultHeroError]}>
            <View style={styles.resultIcon}><Icon size={30} color={success ? colors.forest : colors.danger}/></View>
            <Text style={styles.resultBrand}>REBOOT CLUB</Text>
            <Text style={styles.resultTitle}>{result.title || (success ? "Operation reussie" : "Operation impossible")}</Text>
          </View>
          <View style={styles.resultBody}>
            <Text style={styles.resultMessage}>{result.message}</Text>
            {result.detail ? <Text style={styles.resultDetail}>{result.detail}</Text> : null}
            <Button label="Terminer" onPress={onClose}/>
          </View>
        </View>
      </View>
    </Modal>;
}

const styles = StyleSheet.create({
    selectShell: { justifyContent: "space-between" },
    selectValue: { flex: 1, fontFamily: font.medium, color: colors.ink, fontSize: 13 },
    selectPlaceholder: { color: colors.muted },
    selectHint: { marginTop: 5, fontFamily: font.medium, color: colors.muted, fontSize: 9, lineHeight: 14 },
    selectBackdrop: { flex: 1, backgroundColor: "rgba(9,37,31,0.55)", justifyContent: "flex-end" },
    selectSheet: { maxHeight: "78%", backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.md, gap: spacing.sm },
    selectHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.sm },
    selectTitle: { fontFamily: font.bold, fontSize: 15, color: colors.ink },
    selectSearch: { marginBottom: spacing.xs },
    selectList: { maxHeight: 360 },
    selectOption: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    selectOptionActive: { backgroundColor: colors.mint },
    selectOptionPressed: { backgroundColor: colors.paper },
    selectOptionCopy: { flex: 1, paddingVertical: spacing.xs },
    selectOptionLabel: { fontFamily: font.medium, color: colors.ink, fontSize: 13 },
    selectOptionLabelActive: { fontFamily: font.bold, color: colors.forest },
    selectOptionNote: { marginTop: 2, fontFamily: font.regular, color: colors.muted, fontSize: 9 },
    selectEmpty: { padding: spacing.md, fontFamily: font.medium, color: colors.muted, fontSize: 11, textAlign: "center" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    chip: { minHeight: 34, paddingHorizontal: spacing.sm, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
    chipActive: { backgroundColor: colors.mint, borderColor: colors.mintDark },
    chipText: { fontFamily: font.medium, color: colors.muted, fontSize: 11 },
    chipTextActive: { fontFamily: font.bold, color: colors.forest },
    flex: { flex: 1 }, safe: { flex: 1, backgroundColor: colors.forest }, scroll: { flexGrow: 1, backgroundColor: colors.paper },
    screenContent: { paddingHorizontal: spacing.lg, paddingBottom: 104, gap: spacing.lg, backgroundColor: colors.paper },
    offline: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.mint, paddingHorizontal: spacing.md, borderRadius: radius.md },
    offlineText: { fontFamily: font.semibold, fontSize: 11, color: colors.forest },
    header: { minHeight: 166, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", backgroundColor: colors.forest, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, ...shadow },
    headerText: { flex: 1, paddingRight: spacing.md }, headerAction: { alignSelf: "center", marginTop: spacing.sm }, brandLine: { marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: 7 }, brandMark: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.coral }, brandName: { fontFamily: font.bold, fontSize: 9, color: colors.mint }, eyebrow: { fontFamily: font.bold, fontSize: 9, color: colors.coral, textTransform: "uppercase", marginBottom: 5 },
    title: { fontFamily: font.bold, fontSize: 30, lineHeight: 36, color: colors.white, letterSpacing: 0 },
    button: { minHeight: 52, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
    button_primary: { backgroundColor: colors.forest }, button_secondary: { backgroundColor: colors.mint }, button_ghost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    buttonPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] }, buttonText: { fontFamily: font.bold, color: colors.white, fontSize: 14 }, buttonTextDark: { color: colors.forest }, disabled: { opacity: 0.45 },
    iconButton: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" }, iconPressed: { opacity: 0.7, transform: [{ scale: 0.94 }] },
    badge: { position: "absolute", top: -5, right: -5, minWidth: 19, height: 19, paddingHorizontal: 4, borderRadius: 10, backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.paper, alignItems: "center", justifyContent: "center" }, badgeText: { fontFamily: font.bold, fontSize: 8, color: colors.white },
    field: { gap: spacing.xs }, label: { fontFamily: font.semibold, color: colors.ink, fontSize: 12 },
    inputShell: { minHeight: 54, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
    inputShellMultiline: { minHeight: 104, alignItems: "flex-start", paddingTop: spacing.md }, input: { flex: 1, minHeight: 52, fontFamily: font.medium, color: colors.ink, fontSize: 15, outlineStyle: "none" }, inputMultiline: { minHeight: 80 }, inputError: { borderColor: colors.danger }, error: { fontFamily: font.medium, color: colors.danger, fontSize: 11, lineHeight: 16 },
    status: { alignSelf: "flex-start", paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.sm }, statusWarning: { backgroundColor: "#FFF0C5" }, statusDanger: { backgroundColor: colors.coralSoft }, statusSuccess: { backgroundColor: colors.mint }, statusText: { fontFamily: font.bold, fontSize: 9, color: colors.forest, textTransform: "uppercase" }, statusTextDanger: { color: colors.danger },
    empty: { alignItems: "center", paddingVertical: 58, paddingHorizontal: spacing.xl }, emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center", marginBottom: spacing.md }, emptyTitle: { fontFamily: font.bold, fontSize: 17, color: colors.ink }, emptyMessage: { fontFamily: font.regular, textAlign: "center", color: colors.muted, marginTop: spacing.xs, lineHeight: 20 },
    loader: { flex: 1, gap: spacing.sm, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" }, loaderMark: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, loaderText: { fontFamily: font.bold, fontSize: 12, color: colors.white },
    avatarImage: { backgroundColor: colors.mint }, avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, avatarInitials: { fontFamily: font.bold, color: colors.white }, avatarPressed: { opacity: 0.78, transform: [{ scale: 0.96 }] }, avatarViewerBackdrop: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(4,20,17,0.94)" }, avatarViewerContent: { width: "100%", maxWidth: 520, alignItems: "center" }, avatarViewerClose: { position: "absolute", zIndex: 2, top: -10, right: 0, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" }, avatarViewerImage: { width: "100%", height: 430, borderRadius: radius.md }, avatarViewerFallback: { width: 220, height: 220, borderRadius: 110, alignItems: "center", justifyContent: "center", backgroundColor: colors.coral }, avatarViewerInitials: { fontFamily: font.bold, color: colors.white, fontSize: 68 }, avatarViewerName: { marginTop: spacing.lg, fontFamily: font.bold, color: colors.white, fontSize: 20, textAlign: "center" }, avatarViewerHint: { marginTop: 4, fontFamily: font.medium, color: colors.mint, fontSize: 10 },
    resultOverlay: { flex: 1, padding: spacing.lg, justifyContent: "center", backgroundColor: "rgba(8,43,37,0.72)" }, resultSheet: { overflow: "hidden", borderRadius: 16, backgroundColor: colors.paper, ...shadow }, resultHero: { minHeight: 190, padding: spacing.lg, justifyContent: "flex-end", backgroundColor: colors.forest }, resultHeroError: { backgroundColor: colors.forestDark }, resultIcon: { width: 54, height: 54, marginBottom: spacing.lg, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, resultBrand: { fontFamily: font.bold, color: colors.coral, fontSize: 9 }, resultTitle: { marginTop: 5, fontFamily: font.bold, color: colors.white, fontSize: 26, lineHeight: 32 }, resultBody: { gap: spacing.md, padding: spacing.lg }, resultMessage: { fontFamily: font.semibold, color: colors.ink, fontSize: 14, lineHeight: 21 }, resultDetail: { fontFamily: font.medium, color: colors.muted, fontSize: 10, lineHeight: 16 },
});
