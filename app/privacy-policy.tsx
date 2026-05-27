import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useLanguage } from "../context/LanguageContext";
import TapToSpeakContainer from "../components/TapToSpeakContainer";
import PageBottomMeta from "../components/layout/PageBottomMeta";

const PRIVACY_EMAIL = "support@kalatitmanisha.com";
const COMPANY_NAME = "KalatitManisha";
const EFFECTIVE_DATE = "February 27, 2026";

export default function PrivacyPolicyRoute() {
  const { lang } = useLanguage();
  const policyText = [
    "Privacy Policy",
    `${COMPANY_NAME} Effective Date: ${EFFECTIVE_DATE}`,
    `Short Version. We collect only the data needed to provide sign-in, account services, support, and security.`,
    `To request access, correction, or deletion, contact ${PRIVACY_EMAIL}.`,
    "Full Privacy Policy.",
    "1. Information We Collect. We may collect account data, authentication session data, diagnostics, support communications and app usage data required for service operation.",
    "2. Social Login Data. When you sign in with external identity providers, we may receive your name, email, provider user ID and profile image.",
    "3. How We Use Information. We use data to authenticate users, deliver features, provide support, prevent abuse, improve reliability and comply with legal obligations.",
    "4. Data Sharing. We may share data with service providers acting on our behalf and authorities when legally required. We do not sell personal data.",
    "5. Data Retention. We retain data only as long as necessary for service delivery, security, legal compliance and dispute handling.",
    "6. Security. We apply reasonable safeguards. No method of transmission or storage is completely secure.",
    "7. Your Rights. Depending on jurisdiction, you may request access, correction, deletion or restriction of processing.",
    "8. Children. Service is not intended for children below the legal age threshold.",
    "9. Changes to This Policy. We may update this policy periodically.",
    `10. Contact. ${COMPANY_NAME}. Email ${PRIVACY_EMAIL}.`,
  ].join("\n");

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <View className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Text className="text-3xl font-bold text-slate-900">Privacy Policy</Text>
        <Text className="mt-2 text-sm text-slate-500">
          {COMPANY_NAME} - Effective Date: {EFFECTIVE_DATE}
        </Text>
        <TapToSpeakContainer
          text={policyText}
          lang={lang}
          ttsHeader="Privacy Policy"
          ttsSubheader={`${COMPANY_NAME} - Effective Date: ${EFFECTIVE_DATE}`}
          style={{ marginTop: 8, borderRadius: 12 }}
        >
          <View>
            <Text className="mt-6 text-xl font-semibold text-slate-900">Short Version</Text>
            <Text className="mt-2 text-base leading-7 text-slate-700">
              We collect only the data needed to provide sign-in, account services, support, and security. If you sign in
              using Google, Facebook, Apple, LinkedIn, or another OAuth provider, we may receive basic profile information
              as allowed by your provider settings. We do not sell your personal data. To request access, correction, or
              deletion, contact {PRIVACY_EMAIL}.
            </Text>

            <Text className="mt-6 text-xl font-semibold text-slate-900">Full Privacy Policy</Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">1. Information We Collect</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We may collect account data, authentication/session data, technical diagnostics, support communications, and
              app usage data required to operate the service.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">2. Social Login Data</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              When you sign in with external identity providers such as Google, Facebook, Apple, LinkedIn, or similar
              providers, we may receive your name, email, provider user ID, and profile image where available.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">3. How We Use Information</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We use data to authenticate users, deliver app features, provide support, prevent abuse, improve reliability,
              and comply with legal obligations.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">4. Data Sharing</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We may share data with hosting, infrastructure, analytics, and support providers acting on our behalf, and
              with authorities when legally required. We do not sell personal data.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">5. Data Retention</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We retain data only as long as necessary for service delivery, security, legal compliance, and dispute
              handling. Retention periods vary by data type and applicable law.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">6. Security</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We apply reasonable administrative, technical, and organizational safeguards. No method of transmission or
              storage is completely secure.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">7. Your Rights</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              Depending on your jurisdiction, you may have rights to access, correct, delete, or restrict certain
              processing of your personal data. Contact us at {PRIVACY_EMAIL} to submit requests.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">8. Children</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              The service is not intended for children below the age required by applicable law. If unauthorized child data
              is identified, we will remove it.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">9. Changes to This Policy</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              We may update this policy periodically. Updates are posted on this page with a revised date.
            </Text>

            <Text className="mt-4 text-lg font-semibold text-slate-900">10. Contact</Text>
            <Text className="mt-1 text-base leading-7 text-slate-700">
              {COMPANY_NAME}
              {"\n"}
              Email: {PRIVACY_EMAIL}
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
