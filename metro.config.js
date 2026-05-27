const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Keep minimal polyfills only (no monorepo watchFolders / singletons)
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  events: path.resolve(__dirname, "polyfills/events.js"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
