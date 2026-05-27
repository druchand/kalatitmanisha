// src/utils/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

async function setItem(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}
async function getItem(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}
async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
async function clear(): Promise<void> {
  await AsyncStorage.clear();
}

const storage = {
  setItem,
  getItem,
  removeItem,
  clear,
};

export default storage;
export { clear, getItem, removeItem, setItem };
// Session-specific helpers
const SESSION_KEY = "sessionId";

const USER_ID_KEY = "userId";

const USE_SECURE_STORE =
  Platform.OS !== "web" &&
  typeof SecureStore?.setItemAsync === "function" &&
  typeof SecureStore?.getItemAsync === "function" &&
  typeof SecureStore?.deleteItemAsync === "function";

async function setSessionToken(token: string): Promise<void> {
  if (USE_SECURE_STORE) {
    await SecureStore.setItemAsync(SESSION_KEY, token);
  } else {
    await AsyncStorage.setItem(SESSION_KEY, token);
  }
}

async function getSessionToken(): Promise<string | null> {
  if (USE_SECURE_STORE) {
    return SecureStore.getItemAsync(SESSION_KEY);
  }
  return AsyncStorage.getItem(SESSION_KEY);
}

async function clearSessionToken(): Promise<void> {
  if (USE_SECURE_STORE) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } else {
    await AsyncStorage.removeItem(SESSION_KEY);
  }
}

// New functions for user ID
async function setUserId(userId: string): Promise<void> {
  if (USE_SECURE_STORE) {
    await SecureStore.setItemAsync(USER_ID_KEY, userId);
  } else {
    await AsyncStorage.setItem(USER_ID_KEY, userId);
  }
}

async function getUserId(): Promise<string | null> {
  if (USE_SECURE_STORE) {
    return SecureStore.getItemAsync(USER_ID_KEY);
  }
  return AsyncStorage.getItem(USER_ID_KEY);
}

async function clearUserId(): Promise<void> {
  if (USE_SECURE_STORE) {
    await SecureStore.deleteItemAsync(USER_ID_KEY);
  } else {
    await AsyncStorage.removeItem(USER_ID_KEY);
  }
}

export {
  setSessionToken,
  getSessionToken,
  clearSessionToken,
  setUserId,
  getUserId,
  clearUserId,
};
