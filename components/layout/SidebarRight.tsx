import React from 'react';
import { ScrollView, View } from 'react-native';
import ChapterPicker from '../ChapterPicker';
import LanguageSelectorPanel from './LanguageSelectorPanel';

const SidebarRight = () => {
  return (
    <View
      className="border-l border-slate-200 bg-white"
      style={{ flex: 1, minHeight: 0, width: "100%" }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <LanguageSelectorPanel />
        <ChapterPicker />
      </ScrollView>
    </View>
  );
};

export default SidebarRight;
