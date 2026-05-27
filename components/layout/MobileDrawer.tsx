import React from 'react';
import { View, Text } from 'react-native';

const MobileDrawer = () => {
  return (
    <View className="bg-white px-4 py-3 border-b border-slate-100">
      <Text className="text-sm font-semibold text-slate-600">Menu</Text>
      <View className="mt-2 flex-row" style={{ flexWrap: 'wrap' }}>
        {['Overview', 'Activity', 'Projects', 'Settings'].map((item) => (
          <View
            key={item}
            className="mr-2 mb-2 rounded-full bg-indigo-100 px-3 py-1"
          >
            <Text className="text-xs font-semibold text-indigo-600">{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export default MobileDrawer;
