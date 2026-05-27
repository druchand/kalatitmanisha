import React from "react";
import { StyleSheet, Text, TextProps, TextStyle } from "react-native";

import { useLanguage } from "@/context/LanguageContext";

/**
 * Wrapper around `<Text>` that always syncs `textAlign`/`writingDirection`
 * with the current language direction from the `LanguageContext`.
 */
const DirectionalText = React.forwardRef<Text, TextProps>(({ style, ...rest }, ref) => {
  const { direction } = useLanguage();
  const horizontalAlign = direction === "rtl" ? "right" : "left";
  const writingDirection = direction === "rtl" ? "rtl" : "ltr";
  const flattenedStyle = StyleSheet.flatten(style) as TextStyle | undefined;
  const requestedAlign = flattenedStyle?.textAlign;
  const resolvedTextAlign =
    requestedAlign === "center" || requestedAlign === "justify" ? requestedAlign : horizontalAlign;

  return (
    <Text
      ref={ref}
      {...rest}
      style={[style, { textAlign: resolvedTextAlign, writingDirection }]}
    />
  );
});

DirectionalText.displayName = "DirectionalText";

export default DirectionalText;
