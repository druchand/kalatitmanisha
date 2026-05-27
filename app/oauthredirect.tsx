import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function OAuthRedirectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // Persist callback params in case AuthSession resolves as non-success on Android.
    (globalThis as any).__lastOAuthRedirectParams = {
      ...params,
      capturedAt: Date.now(),
    };
    const timer = setTimeout(() => {
      router.replace("/");
    }, 150);
    return () => clearTimeout(timer);
  }, [router, params]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000",
      }}
    >
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}
