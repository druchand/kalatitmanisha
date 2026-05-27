import React from "react";
import { Platform } from "react-native";

type IconFamily = "ion" | "feather";

type AppIconProps = {
  family?: IconFamily;
  name: string;
  size?: number;
  color?: string;
  style?: any;
};

// Map kebab-case Ionicons/Feather names into react-icons component keys (web)
const toPascal = (value: string) =>
  value
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

const mapWebName = (family: IconFamily, name: string) => {
  if (family === "ion") {
    if (name.startsWith("Io")) return name;
    return `Io${toPascal(name)}`;
  }
  if (name.startsWith("Fi")) return name;
  return `Fi${toPascal(name)}`;
};

export function AppIcon({
  family = "ion",
  name,
  size = 22,
  color = "#444",
  style,
}: AppIconProps) {
  // Web: use react-icons
  if (Platform.OS === "web") {
    const mappedName = mapWebName(family, name);
    if (family === "ion") {
      const io = require("react-icons/io5");
      const Icon = io?.[mappedName];
      return Icon ? <Icon size={size} color={color} style={style} /> : null;
    }
    const fi = require("react-icons/fi");
    const Icon = fi?.[mappedName];
    return Icon ? <Icon size={size} color={color} style={style} /> : null;
  }

  // Native (Expo / RN) uses @expo/vector-icons
  if (family === "ion") {
    const { Ionicons } = require("@expo/vector-icons");
    return <Ionicons name={name as any} size={size} color={color} style={style} />;
  }
  const { Feather } = require("@expo/vector-icons");
  return <Feather name={name as any} size={size} color={color} style={style} />;
}

export default AppIcon;
