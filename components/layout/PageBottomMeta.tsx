import React from "react";
import { View, Text, TouchableOpacity, Linking, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useLanguage } from "../../context/LanguageContext";
import AppIcon from "../AppIcon";

type PageBottomMetaProps = {
  shareUrl?: string;
  shareTitle?: string;
  shareDescription?: string;
  shareImageUrl?: string;
  shareImageUrlByPlatform?: {
    default?: string;
    whatsapp?: string;
    facebook?: string;
    x?: string;
    telegram?: string;
  };
};

export default function PageBottomMeta({
  shareUrl = "https://app.kalatitmanisha.com/home",
  shareTitle = "Explore Kalatit Manisha",
  shareDescription = "Timeless wisdom from the Bhagavad Gita.",
  shareImageUrl = "https://static.wixstatic.com/media/3ba4a1_d98196f7f4a649b3b66d88cabf059986~mv2.png",
  shareImageUrlByPlatform = {},
}: PageBottomMetaProps): React.ReactElement {
  const router = useRouter();
  const { t } = useLanguage();
  const imageDefault = String(shareImageUrlByPlatform.default || shareImageUrl || "").trim();
  const imageForWhatsApp = String(shareImageUrlByPlatform.whatsapp || imageDefault).trim();
  const imageForFacebook = String(shareImageUrlByPlatform.facebook || imageDefault).trim();
  const imageForX = String(shareImageUrlByPlatform.x || imageDefault).trim();
  const imageForTelegram = String(shareImageUrlByPlatform.telegram || imageDefault).trim();
  const socialTextBase = `${shareTitle}\n\n${shareDescription}\n\n${shareUrl}`;
  const socialTextFor = (imageUrl: string) => (imageUrl ? `${socialTextBase}\n\n${imageUrl}` : socialTextBase);

  const openExternal = React.useCallback(async (url: string) => {
    try {
      const browser = (globalThis as { open?: (url?: string, target?: string, features?: string) => void }) || {};
      if (Platform.OS === "web" && typeof browser.open === "function") {
        browser.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      await Linking.openURL(url);
    } catch {
      // no-op
    }
  }, []);

  const openWhatsAppShare = React.useCallback(() => {
    openExternal(`https://wa.me/?text=${encodeURIComponent(socialTextFor(imageForWhatsApp))}`);
  }, [imageForWhatsApp, openExternal]);

  const openFacebookShare = React.useCallback(() => {
    const quote = `${shareTitle} - ${shareDescription}`;
    openExternal(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(quote)}${imageForFacebook ? `&picture=${encodeURIComponent(imageForFacebook)}` : ""}`
    );
  }, [imageForFacebook, openExternal, shareDescription, shareTitle, shareUrl]);

  const openXShare = React.useCallback(() => {
    const text = imageForX ? `${shareTitle} - ${shareDescription}\n${imageForX}` : `${shareTitle} - ${shareDescription}`;
    openExternal(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`
    );
  }, [imageForX, openExternal, shareDescription, shareTitle, shareUrl]);

  const openTelegramShare = React.useCallback(() => {
    openExternal(
      `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(socialTextFor(imageForTelegram))}`
    );
  }, [imageForTelegram, openExternal, shareUrl]);

  return (
    <View className="px-4 pb-2">
      <View className="flex-row flex-wrap items-center justify-center gap-2">
        <Text className="text-sm">© 2026 KalatitManisha</Text>
        <View className="h-3 w-px bg-black/20" />
        <TouchableOpacity onPress={() => router.push("/contact" as any)}>
          <Text className="text-xs font-medium underline">{t("Contact")}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/privacy-policy" as any)}>
          <Text className="text-xs font-medium underline">{t("Privacy")}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/data-deletion" as any)}>
          <Text className="text-xs font-medium underline">{t("Data Deletion")}</Text>
        </TouchableOpacity>
      </View>
      <View className="mt-2 w-full flex-row items-center justify-center gap-4">
        <TouchableOpacity onPress={openWhatsAppShare} accessibilityLabel="Share on WhatsApp">
          <AppIcon family="ion" name="logo-whatsapp" size={18} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openFacebookShare} accessibilityLabel="Share on Facebook">
          <AppIcon family="ion" name="logo-facebook" size={18} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openXShare} accessibilityLabel="Share on X">
          <AppIcon family="ion" name="logo-twitter" size={18} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openTelegramShare} accessibilityLabel="Share on Telegram">
          <AppIcon family="ion" name="paper-plane" size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
