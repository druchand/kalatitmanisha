import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useLanguage } from "../../context/LanguageContext";
import { useAppSettings } from "../../context/AppSettingsContext";

export default function LanguageSelectorPanel(): React.ReactElement {
  const lang = useLanguage();
  const { switches } = useAppSettings();

  const currentLanguage =
    lang.availableLangs.find((option) => option.code === lang.lang)?.displayName ??
    lang.availableLangs.find((option) => option.code === lang.lang)?.englishName ??
    lang.availableLangs.find((option) => option.code === lang.lang)?.name ??
    lang.lang;
  const currentCountry =
    lang.availableCountries.find((option) => option.code === lang.country)?.name ??
    lang.country ??
    "Country";
  const currentCountryEmoji =
    lang.availableCountries.find((option) => option.code === lang.country)?.emoji ?? "🏳️";

  return (
    <View className="flex-row border-b border-slate-100" style={{ justifyContent: "flex-end", alignItems: "center" }}>
      <TouchableOpacity
        onPress={lang.openLanguage}
        className={`px-4 py-3 ${switches.countryEnabled ? "flex-1 border-r border-slate-100" : "w-full"}`}
      >
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Language
        </Text>
        <Text className="text-sm font-medium text-slate-700">{currentLanguage}</Text>
      </TouchableOpacity>
      {switches.countryEnabled && (
        <TouchableOpacity
          onPress={lang.openCountry}
          className="flex-1 px-4 py-3"
        >
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Country
          </Text>
          <Text className="text-sm font-medium text-slate-700">
            {currentCountryEmoji} {currentCountry}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
