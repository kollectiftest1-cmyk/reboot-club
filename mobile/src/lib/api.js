import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

function resolveApiUrl() {
    const configured = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
    if (configured) return configured;
    if (Platform.OS === "web") return "http://127.0.0.1:8000/api/v1";
    const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoClient?.hostUri;
    const host = hostUri?.split(":")[0];
    return host ? `http://${host}:8000/api/v1` : "http://192.168.183.253:8000/api/v1";
}

export const API_URL = resolveApiUrl();
export const API_ORIGIN = API_URL.replace(/\/api\/v1$/, "");
export const mediaUrl = value => !value ? undefined : value.startsWith("http") ? value : `${API_ORIGIN}${value.startsWith("/") ? value : `/${value}`}`;
const ACCESS_KEY = "reboot_access_token";
const REFRESH_KEY = "reboot_refresh_token";
const tokenStore = {
    get: key => Platform.OS === "web" ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key),
    set: (key, value) => Platform.OS === "web" ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value),
    remove: key => Platform.OS === "web" ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key),
};

export class ApiError extends Error {
    constructor(message, status = 0, errors) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

async function request(path, options, token) {
    try {
        const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
        const transport = isFormData ? expoFetch : fetch;
        return await transport(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
            ...options,
            headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
        });
    } catch {
        throw new ApiError(`Serveur inaccessible sur ${API_URL}. Vérifiez que le téléphone et le PC utilisent le même Wi-Fi.`, 0);
    }
}

async function refreshAccess() {
    const refresh = await tokenStore.get(REFRESH_KEY);
    if (!refresh) return null;
    const response = await request("/auth/token/refresh/", { method: "POST", body: JSON.stringify({ refresh }) });
    if (!response.ok) return null;
    const data = await response.json();
    await tokenStore.set(ACCESS_KEY, data.access);
    if (data.refresh) await tokenStore.set(REFRESH_KEY, data.refresh);
    return data.access;
}

export async function api(path, options = {}, retry = true) {
    const token = await tokenStore.get(ACCESS_KEY);
    const response = await request(path, options, token);
    if (response.status === 401 && retry && await refreshAccess()) return api(path, options, false);
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const fieldLabels = { identity_document: "Piece d'identite", selfie: "Photo selfie", document_number: "Numero du document" };
        const firstError = Object.entries(payload).find(([key]) => !["message", "detail", "errors"].includes(key));
        const fieldMessage = firstError ? `${fieldLabels[firstError[0]] || firstError[0]} : ${Array.isArray(firstError[1]) ? firstError[1].join(" ") : firstError[1]}` : undefined;
        const message = payload.message || payload.detail || fieldMessage || "La requete a echoue.";
        throw new ApiError(String(message), response.status, payload.errors || payload);
    }
    if (response.status === 204) return undefined;
    return response.json();
}

export async function apiCached(path, cacheKey) {
    try {
        const data = await api(path);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(data));
        return { data, offline: false };
    } catch (error) {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) return { data: JSON.parse(cached), offline: true };
        throw error;
    }
}

export async function saveTokens(access, refresh) {
    await Promise.all([tokenStore.set(ACCESS_KEY, access), tokenStore.set(REFRESH_KEY, refresh)]);
}

export async function clearTokens() {
    await Promise.all([tokenStore.remove(ACCESS_KEY), tokenStore.remove(REFRESH_KEY)]);
}

export const hasSession = () => tokenStore.get(REFRESH_KEY).then(Boolean);
