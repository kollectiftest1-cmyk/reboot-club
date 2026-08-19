import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Provider } from "react-redux";
import { LoadingScreen } from "@/components/ui";
import { AuthProvider } from "@/context/AuthContext";
import { AppNavigator } from "@/navigation/AppNavigator";
import { colors } from "@/theme";
import { store } from "@/store";
export default function App() {
    const [loaded] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
    useEffect(() => {
        if (Platform.OS === "android") NavigationBar.setStyle("dark");
    }, []);
    if (!loaded)
        return <LoadingScreen />;
    return <Provider store={store}><GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><StatusBar style="dark" backgroundColor={colors.paper}/><AuthProvider><AppNavigator /></AuthProvider></SafeAreaProvider></GestureHandlerRootView></Provider>;
}
