import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useEffect, useState } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { BriefcaseBusiness, HandCoins, House, Landmark, MessageCircle, UserRound } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSelector } from "react-redux";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { ChatScreen } from "@/screens/ChatScreen";
import { AdminOperationsScreen } from "@/screens/AdminOperationsScreen";
import { BalanceScreen } from "@/screens/BalanceScreen";
import { ClubDetailScreen } from "@/screens/ClubDetailScreen";
import { ClubFormScreen } from "@/screens/ClubFormScreen";
import { ClubsScreen } from "@/screens/ClubsScreen";
import { CollectionsScreen } from "@/screens/CollectionsScreen";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { DisputesScreen } from "@/screens/DisputesScreen";
import { IdentitiesScreen } from "@/screens/IdentitiesScreen";
import { KYCFormScreen } from "@/screens/KYCFormScreen";
import { LoanPurposesScreen } from "@/screens/LoanPurposesScreen";
import { LoanRequestScreen } from "@/screens/LoanRequestScreen";
import { LoanDetailScreen } from "@/screens/LoanDetailScreen";
import { LoansScreen } from "@/screens/LoansScreen";
import { LoginScreen } from "@/screens/LoginScreen";
import { ManagementScreen } from "@/screens/ManagementScreen";
import { MembersScreen } from "@/screens/MembersScreen";
import { MemberFormScreen } from "@/screens/MemberFormScreen";
import { MemberDetailScreen } from "@/screens/MemberDetailScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { PlatformSettingsScreen } from "@/screens/PlatformSettingsScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { OperationFormScreen } from "@/screens/OperationFormScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { ValidationsScreen } from "@/screens/ValidationsScreen";
import { colors, font } from "@/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const icons = { Accueil: House, Clubs: Landmark, Chat: MessageCircle, Prets: HandCoins, Encaissements: HandCoins, Gestion: BriefcaseBusiness, Profil: UserRound };

function MainTabs() {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const admin = user.role === "admin";
    const manager = admin || user.current_profile === "leader";
    // Le preteur n'a aucun lien avec les clubs : ni onglet Clubs, ni chat de club.
    const globalLender = user.current_profile === "lender" && !admin;
    const collector = user.current_profile === "collector" && !admin;
    const versions = useSelector(state => state.sync.versions);
    const [counts, setCounts] = useState({});
    useEffect(() => { api("/activity-counts/").then(setCounts).catch(() => {}); }, [versions]);
    const badge = value => value > 0 ? Math.min(value, 99) : undefined;
    function badgeFor(name) {
        if (name === "Chat") return counts.chat;
        if (name === "Gestion") return counts.management_total;
        if (name === "Prets") return (counts.loan_offers || 0) + (counts.collective_requests || 0);
        if (name === "Encaissements") return counts.collections;
        if (name === "Accueil") return counts.membership_requests;
        return 0;
    }
    return <Tab.Navigator screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size }) => { const Icon = icons[route.name]; return <Icon color={color} size={size}/>; },
        tabBarBadge: badge(badgeFor(route.name)),
        tabBarBadgeStyle: { backgroundColor: colors.coral, color: colors.white, fontFamily: font.bold, fontSize: 9 },
        tabBarActiveTintColor: colors.coral, tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 10 }, tabBarHideOnKeyboard: true,
        tabBarStyle: { height: 62 + insets.bottom, paddingTop: 7, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.white, borderTopColor: colors.line },
    })}>
      <Tab.Screen name="Accueil" component={DashboardScreen}/>
      {!globalLender && !collector ? <Tab.Screen name="Clubs" component={ClubsScreen}/> : null}
      {!globalLender ? <Tab.Screen name="Chat" component={ChatScreen}/> : null}
      {manager ? <Tab.Screen name="Gestion" component={ManagementScreen}/>
        : collector ? <Tab.Screen name="Encaissements" component={CollectionsScreen}/>
        : <Tab.Screen name="Prets" component={LoansScreen}/>}
      <Tab.Screen name="Profil" component={ProfileScreen}/>
    </Tab.Navigator>;
}

export function AppNavigator() {
    const { user, loading } = useAuth();
    if (loading) return <LoadingScreen/>;
    return <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.paper, primary: colors.coral } }}>
      {user ? <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="Main" component={MainTabs}/>
        <Stack.Screen name="Balance" component={BalanceScreen}/>
        <Stack.Screen name="ClubDetail" component={ClubDetailScreen}/>
        <Stack.Screen name="ClubForm" component={ClubFormScreen}/>
        <Stack.Screen name="Notifications" component={NotificationsScreen}/>
        <Stack.Screen name="LoanRequest" component={LoanRequestScreen}/>
        <Stack.Screen name="LoanDetail" component={LoanDetailScreen}/>
        <Stack.Screen name="Loans" component={LoansScreen}/>
        <Stack.Screen name="Collections" component={CollectionsScreen}/>
        <Stack.Screen name="OperationForm" component={OperationFormScreen}/>
        <Stack.Screen name="AdminOperations" component={AdminOperationsScreen}/>
        <Stack.Screen name="Validations" component={ValidationsScreen}/>
        <Stack.Screen name="Members" component={MembersScreen}/>
        <Stack.Screen name="MemberForm" component={MemberFormScreen}/>
        <Stack.Screen name="MemberDetail" component={MemberDetailScreen}/>
        <Stack.Screen name="KYCForm" component={KYCFormScreen}/>
        <Stack.Screen name="Identities" component={IdentitiesScreen}/>
        <Stack.Screen name="Disputes" component={DisputesScreen}/>
        <Stack.Screen name="Settings" component={SettingsScreen}/>
        <Stack.Screen name="PlatformSettings" component={PlatformSettingsScreen}/>
        <Stack.Screen name="LoanPurposes" component={LoanPurposesScreen}/>
      </Stack.Navigator> : <LoginScreen/>}
    </NavigationContainer>;
}
