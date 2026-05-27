import React from "react";
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ViewStyle,
  TextStyle,
  StyleProp,
} from "react-native";
import AppIcon from "./AppIcon";

type ChapterNavigatorProps = {
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onJump: (value: string) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  disableFirst?: boolean;
  disablePrev?: boolean;
  disableNext?: boolean;
  disableLast?: boolean;
  placeholder?: string;
  maxLength?: number;
  buttonStyle?: StyleProp<ViewStyle>;
  buttonDisabledStyle?: StyleProp<ViewStyle>;
  jumpInputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  hideInput?: boolean;
};

export default function ChapterNavigator({
  onFirst,
  onPrev,
  onNext,
  onLast,
  onJump,
  inputValue,
  onInputChange,
  disableFirst,
  disablePrev,
  disableNext,
  disableLast,
  placeholder = "--",
  maxLength = 3,
  buttonStyle,
  buttonDisabledStyle,
  jumpInputStyle,
  containerStyle,
  hideInput = false,
}: ChapterNavigatorProps) {
  const handleSubmit = () => {
    onJump(inputValue);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.paginationBar, containerStyle]}
    >
      <TouchableOpacity
        style={[buttonStyle, disableFirst && buttonDisabledStyle]}
        onPress={onFirst}
        disabled={disableFirst}
      >
        <AppIcon family="ion" name="play-skip-back-outline" size={18} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={[buttonStyle, disablePrev && buttonDisabledStyle]}
        onPress={onPrev}
        disabled={disablePrev}
      >
        <AppIcon family="feather" name="chevron-left" size={18} color="#fff" />
      </TouchableOpacity>

      {!hideInput && (
        <TextInput
        style={jumpInputStyle}
        value={inputValue}
        onChangeText={(val) => onInputChange(val)}
        keyboardType="number-pad"
        placeholder={placeholder}
        maxLength={maxLength}
        onSubmitEditing={handleSubmit}
        onBlur={handleSubmit}
        returnKeyType="go"
        />
      )}

      <TouchableOpacity
        style={[buttonStyle, disableNext && buttonDisabledStyle]}
        onPress={onNext}
        disabled={disableNext}
      >
        <AppIcon family="feather" name="chevron-right" size={18} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={[buttonStyle, disableLast && buttonDisabledStyle]}
        onPress={onLast}
        disabled={disableLast}
      >
        <AppIcon family="ion" name="play-skip-forward-outline" size={18} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  paginationBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
    flexGrow: 1,
    justifyContent: "center",
  },
});
