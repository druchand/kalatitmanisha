import React from "react";
import { ScrollView, View, Text } from "react-native";
import PageBottomMeta from "../components/layout/PageBottomMeta";

const Contact = () => {
  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 py-5">
      <View className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
        <Text className="text-2xl font-semibold text-slate-900">Contact</Text>
        <Text className="mt-3 text-base text-slate-700">
          Reach out at <Text className="font-semibold">hello@kalatitmanisha.dev</Text> or
          schedule a session with our product team.
        </Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <PageBottomMeta />
      </View>
    </ScrollView>
  );
};

export default Contact;
