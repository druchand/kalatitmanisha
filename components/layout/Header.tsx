import React from 'react';
import { Image, Pressable, View, Text, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthModalContext';
import AppIcon from '../AppIcon';
import { APP_LOGO_IMAGE } from '../../utils/logoAssets';

type HeaderProps = {
  onLanguagePress?: () => void;
  languagePanelOpen?: boolean;
  onLoginPress?: () => void;
};

const Header = ({ onLanguagePress, languagePanelOpen = false, onLoginPress }: HeaderProps) => {
  const auth = useAuth();
  const emailPrefix = String(auth.user?.email || "").split("@")[0]?.trim() || "";
  const emailDerivedName = emailPrefix.replace(/[._-]+/g, " ").trim() || emailPrefix;
  const hasProviderName = Boolean(auth.user?.firstName || auth.user?.name || auth.user?.nickname);
  const baseDisplayName =
    auth.user?.firstName ||
    auth.user?.name ||
    auth.user?.nickname ||
    emailDerivedName ||
    "";
  const displayName = !hasProviderName && baseDisplayName.length > 14 ? `${baseDisplayName.slice(0, 14)}...` : baseDisplayName;
  const initials = displayName ? displayName[0].toUpperCase() : "G";
  const avatarUri = auth.user?.avatarUrl;
  const router = useRouter();
  return (
    <View
      className="h-16 shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 flex-row items-center justify-between"
      style={{ zIndex: 200, elevation: 200 }}
      pointerEvents="auto"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3 pr-3">
        <Pressable
          className="flex-row items-center gap-3 min-w-0"
          onPress={() => router.push('/home')}
        >
          <View
            style={{
              width: Platform.OS === "web" ? 56 : 50,
              height: Platform.OS === "web" ? 56 : 50,
              borderRadius: 999,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(148,163,184,0.35)",
              backgroundColor: "#f8fafc",
            }}
          >
            <Image
              source={APP_LOGO_IMAGE}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          </View>
          <View className="min-w-0">
            <Text className="text-lg font-semibold text-slate-900">
              Kalatit Manisha
            </Text>
            <Text className="text-sm font-semibold text-slate-900">
              Bhagavad Gita Companion
            </Text>
          </View>
        </Pressable>
      </View>
      <View className="ml-2 flex-shrink-0 flex-row items-center justify-end">
        <Pressable
          className={`mr-2 h-9 w-9 items-center justify-center rounded-full border ${
            languagePanelOpen ? "border-sky-300" : "border-slate-200"
          }`}
          style={{
            backgroundColor: languagePanelOpen ? "rgba(14,165,233,0.12)" : "#f8fafc",
            borderColor: languagePanelOpen ? "#7dd3fc" : "#cbd5e1",
          }}
          onPress={onLanguagePress}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#ffffff",
              borderWidth: 1,
              borderColor: "#e2e8f0",
            }}
          >
            <AppIcon family="feather" name="globe" size={14} color="#0f172a" />
          </View>
        </Pressable>
        {onLoginPress && (
          <Pressable
            className="min-w-[96px] flex-row items-center gap-2 rounded-full border border-slate-200 px-3 py-1"
            onPress={onLoginPress}
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                className="h-6 w-6 rounded-full bg-slate-100"
              />
            ) : (
              <View className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
                <Text className="text-xs font-bold text-slate-600">{initials}</Text>
              </View>
            )}
            <Text
              className="max-w-[140px] text-sm font-semibold text-slate-600"
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {auth.user ? displayName || "Member" : "Sign In"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

export default Header;
