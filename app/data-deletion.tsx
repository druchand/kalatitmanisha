import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useLanguage } from "../context/LanguageContext";
import TapToSpeakContainer from "../components/TapToSpeakContainer";
import PageBottomMeta from "../components/layout/PageBottomMeta";

const SUPPORT_EMAIL = "support@kalatitmanisha.com";
const COMPANY_NAME = "KalatitManisha";
const EFFECTIVE_DATE = "February 27, 2026";

export default function DataDeletionRoute() {
  const { lang } = useLanguage();
  const router = useRouter();
  const deletionPolicyText = [
    "User Data Deletion",
    `${COMPANY_NAME} Effective Date: ${EFFECTIVE_DATE}`,
    "Short Version. Sign in, open Profile, and choose Delete account to permanently delete your account and app data.",
    "The in-app deletion flow completes account deletion directly after confirmation unless limited records must be retained for legal obligations, fraud prevention, security, or dispute handling.",
    "Full Data Deletion Policy.",
    "1. How to Delete Your Account.",
    "2. Confirmation.",
    "3. Data We Delete.",
    "4. Data We May Retain.",
    "5. Completion.",
    "6. Social Provider Permissions.",
    `7. Support. ${COMPANY_NAME}. Email ${SUPPORT_EMAIL}.`,
  ].join("\n");

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <View className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Text className="text-3xl font-bold text-slate-900">User Data Deletion</Text>
        <Text className="mt-2 text-sm text-slate-500">
          {COMPANY_NAME} - Effective Date: {EFFECTIVE_DATE}
        </Text>
        <TapToSpeakContainer
          text={deletionPolicyText}
          lang={lang}
          ttsHeader="User Data Deletion"
          ttsSubheader={`${COMPANY_NAME} - Effective Date: ${EFFECTIVE_DATE}`}
          style={{ marginTop: 8, borderRadius: 12 }}
        >
          <View>
            <Text className="mt-6 text-xl font-semibold text-slate-900">Short Version</Text>
            <Text className="mt-2 text-base leading-7 text-slate-700">
              Sign in, open Profile, and choose Delete account to permanently delete your account and app data. The app
              asks for confirmation before deletion.
            </Text>
            <Pressable
              onPress={() => router.push("/profile" as any)}
              className="mt-4 self-start rounded-full bg-slate-900 px-5 py-2"
            >
              <Text className="text-sm font-semibold text-white">Open Profile</Text>
            </Pressable>

            <Text className="mt-6 text-xl font-semibold text-slate-900">Full Data Deletion Policy</Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">1. How to Delete Your Account</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              Use the in-app flow:
              {"\n"}- Sign in to your account
              {"\n"}- Open Profile from the app menu
              {"\n"}- Tap Delete my account
              {"\n"}- Confirm permanent deletion
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">2. Confirmation</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              The deletion option is available only after sign-in. A confirmation step helps prevent accidental deletion.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">3. Data We Delete</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              After successful verification, we delete or anonymize account profile data, social sign-in linkage data,
              app-related user content where feasible, and active session records tied to your account.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">4. Data We May Retain</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We may retain limited records as required for legal obligations, fraud prevention, tax/audit requirements, or
              dispute handling.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">5. Completion</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              Account deletion is processed directly in the app after confirmation. If legal or security retention applies,
              only the required limited records are retained.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">6. Social Provider Permissions</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              Deleting data in {COMPANY_NAME} does not automatically remove app permissions at Google, Facebook, Apple,
              LinkedIn, or other providers. You should revoke permissions directly in provider account settings if needed.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">7. Support</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              {COMPANY_NAME}
              {"\n"}
              Email: {SUPPORT_EMAIL} for help or questions about deletion. Email is not required to complete account
              deletion.
            </Text>
          </View>
        </TapToSpeakContainer>
      </View>
      <View style={{ marginTop: 8 }}>
        <PageBottomMeta />
      </View>
    </ScrollView>
  );
}
