import React, { useMemo, useState } from "react";
import { Pressable, Text, TextStyle, View, ViewStyle } from "react-native";

type Props = {
  text: string;
  collapsedLines?: number;
  containerStyle?: ViewStyle;
  textStyle?: TextStyle;
  linkStyle?: TextStyle;
};

export default function CollapsibleText({
  text,
  collapsedLines = 5,
  containerStyle,
  textStyle,
  linkStyle,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggleLabel = useMemo(() => (expanded ? "Show less" : "Read more"), [expanded]);

  if (!text?.trim()) return null;

  return (
    <View style={containerStyle}>
      <Text style={textStyle} numberOfLines={expanded ? undefined : collapsedLines}>
        {text}
      </Text>

      <Pressable onPress={() => setExpanded((v) => !v)} style={{ marginTop: 8 }}>
        <Text style={[{ fontWeight: "600" }, linkStyle]}>{toggleLabel}</Text>
      </Pressable>
    </View>
  );
}