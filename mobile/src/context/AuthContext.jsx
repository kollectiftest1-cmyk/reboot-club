import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { api, clearTokens, hasSession, saveTokens } from "@/lib/api";
import { invalidate, store } from "@/store";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const refreshUser = useCallback(async () => setUser(await api("/auth/me/")), []);
    useEffect(() => { hasSession().then(async (exists) => { if (exists)
        await refreshUser().catch(() => clearTokens()); }).finally(() => setLoading(false)); }, [refreshUser]);
    useEffect(() => {
        const subscription = AppState.addEventListener("change", state => {
            if (state === "active") hasSession().then(exists => exists && refreshUser().catch(() => {}));
        });
        return () => subscription.remove();
    }, [refreshUser]);
    const login = useCallback(async (phone, password) => {
        const tokens = await api("/auth/token/", { method: "POST", body: JSON.stringify({ phone: phone.replace(/\s/g, ""), password }) });
        await saveTokens(tokens.access, tokens.refresh);
        await refreshUser();
    }, [refreshUser]);
    const logout = useCallback(async () => { await clearTokens(); setUser(null); }, []);
    const switchProfile = useCallback(async profile => { setUser(await api("/auth/switch-profile/", { method: "POST", body: JSON.stringify({ profile }) })); store.dispatch(invalidate(["dashboard", "clubs", "loans", "members", "validations"])); }, []);
    const value = useMemo(() => ({ user, loading, login, logout, refreshUser, switchProfile }), [user, loading, login, logout, refreshUser, switchProfile]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
    const value = useContext(AuthContext);
    if (!value)
        throw new Error("useAuth must be used inside AuthProvider");
    return value;
}
