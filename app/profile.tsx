import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "../auth/AuthModalContext";
import { maybeOpenLogin } from "../utils/routeAccess";

const formatDetailValue = (value?: string | null) =>
  value && value.trim() ? value.trim() : "Not provided";

const timeAgo = (dateString: string | undefined | null): string | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
};

export default function ProfileScreen(): React.ReactElement {
  const auth = useAuth();
  const { user, sessionId } = auth;
  const router = useRouter();
  const profileUser = useMemo(() => (sessionId && user ? user : null), [sessionId, user]);
  const displayName = useMemo(
    () =>
      profileUser
        ? profileUser.name ??
          profileUser.firstName ??
          profileUser.nickname ??
          profileUser.email?.split?.("@")[0] ??
          "Member"
        : "Guest",
    [profileUser],
  );
  const initials = useMemo(() => {
    if (!displayName) return "G";
    return displayName
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [displayName]);

  const [editing, setEditing] = useState(false);
  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const didValidateProfileRef = useRef(false);

  useEffect(() => {
    if (!sessionId || !user?.id || didValidateProfileRef.current) return;
    didValidateProfileRef.current = true;
    void auth.refreshUser().catch((error) => {
      console.debug("[profile] background profile refresh failed", error);
    });
  }, [auth, sessionId, user?.id]);

  const detailRows = useMemo(() => {
    if (!profileUser) return [];
    const rows = [
      { label: "First name", value: profileUser.firstName },
      { label: "Last name", value: profileUser.lastName },
      { label: "Nickname", value: profileUser.nickname },
      { label: "Email", value: profileUser.email },
      { label: "Phone", value: profileUser.phone },
    ];
    return rows;
  }, [profileUser]);

  const startEditing = () => {
    if (!profileUser) return;
    setFirstNameInput(profileUser.firstName ?? "");
    setLastNameInput(profileUser.lastName ?? "");
    setNicknameInput(profileUser.nickname ?? "");
    setPhoneInput(profileUser.phone ?? "");
    setAvatarUrlInput(profileUser.avatarUrl ?? "");
    setFormError(null);
    setStatusMsg(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setFormError(null);
    setStatusMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    setStatusMsg(null);
    try {
      await auth.updateProfile({
        firstName: firstNameInput,
        lastName: lastNameInput,
        phone: phoneInput,
        nickname: nicknameInput,
        avatarUrl: avatarUrlInput,
      });
      setStatusMsg("Profile saved.");
      setEditing(false);
    } catch (error: any) {
      setFormError(error?.message ?? "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  };

  const runDeleteAccount = async () => {
    setDeletingAccount(true);
    setFormError(null);
    setStatusMsg(null);
    try {
      await auth.deleteAccount();
      router.replace("/home" as any);
    } catch (error: any) {
      setFormError(error?.message ?? "Unable to delete account.");
      setConfirmingDelete(false);
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    void runDeleteAccount().catch((error: any) => {
      setFormError(error?.message ?? "Unable to delete account.");
      setConfirmingDelete(false);
      setDeletingAccount(false);
    });
  };

  if (!profileUser) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50">
        <ScrollView
          contentContainerClassName="flex-1 items-center justify-center px-4"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-lg font-semibold text-slate-700">
            Sign in to view your profile.
          </Text>
          <Pressable
            onPress={() => {
              maybeOpenLogin(auth.openLogin, "login");
            }}
            className="mt-4 rounded-full bg-slate-900 px-5 py-2"
          >
            <Text className="text-sm font-semibold text-white">Open sign-in modal</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const lastLoginText = timeAgo(profileUser.lastLoginDate);
  const handleClose = () => {
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        contentContainerClassName="px-4 py-6"
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-2xl bg-white p-6 shadow">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-slate-800">My Profile</Text>
            <Pressable
              onPress={handleClose}
              className="rounded-full border border-slate-200 px-3 py-1"
            >
              <Text className="text-sm font-semibold text-slate-700">Close</Text>
            </Pressable>
          </View>
          <View className="mt-4 items-center justify-center gap-2">
            {profileUser.avatarUrl ? (
              <Image
                source={{ uri: profileUser.avatarUrl }}
                className="h-24 w-24 rounded-full bg-slate-200"
              />
            ) : (
              <View className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-200">
                <Text className="text-3xl font-bold text-slate-800">{initials}</Text>
              </View>
            )}
            <Text className="text-2xl font-semibold text-slate-900">{displayName}</Text>
            <Text className="text-sm text-slate-500">{profileUser.email ?? "Email not provided"}</Text>
            {lastLoginText ? (
              <Text className="text-xs uppercase tracking-wide text-slate-400">
                Last logged in {lastLoginText}
              </Text>
            ) : null}
          </View>

          <View className="mt-6 space-y-4">
            {detailRows.map((row) => (
              <View key={row.label}>
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {row.label}
                </Text>
                <Text className="text-base text-slate-800">
                  {formatDetailValue(row.value)}
                </Text>
              </View>
            ))}
          </View>

          {statusMsg && (
            <Text className="mt-4 text-sm font-medium text-emerald-600">{statusMsg}</Text>
          )}
          {formError && (
            <Text className="mt-4 text-sm font-medium text-rose-600">{formError}</Text>
          )}

          {editing ? (
            <View className="mt-6 space-y-3">
              <TextInput
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800"
                placeholder="First name"
                value={firstNameInput}
                onChangeText={setFirstNameInput}
              />
              <TextInput
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800"
                placeholder="Last name"
                value={lastNameInput}
                onChangeText={setLastNameInput}
              />
              <TextInput
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800"
                placeholder="Nickname"
                value={nicknameInput}
                onChangeText={setNicknameInput}
              />
              <TextInput
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800"
                placeholder="Phone"
                value={phoneInput}
                onChangeText={setPhoneInput}
                keyboardType="phone-pad"
              />
              <TextInput
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800"
                placeholder="Avatar image URL"
                value={avatarUrlInput}
                onChangeText={setAvatarUrlInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View className="mt-4 flex-row items-center justify-end gap-3">
                <Pressable
                  onPress={cancelEditing}
                  className="rounded-full border border-slate-200 px-4 py-2"
                >
                  <Text className="text-sm font-semibold text-slate-700">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={saving}
                  className="rounded-full bg-slate-900 px-5 py-2 disabled:opacity-60"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">Save changes</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="mt-6 gap-3">
              <Pressable
                onPress={startEditing}
                className="rounded-full bg-slate-900 px-5 py-2"
              >
                <Text className="text-sm font-semibold text-white">Edit profile</Text>
              </Pressable>

              <View className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <Text className="text-base font-semibold text-rose-900">Delete account</Text>
                <Text className="mt-1 text-sm leading-5 text-rose-800">
                  This permanently deletes your account, sign-in links, sessions, comments, and favourites from this app.
                </Text>
                {confirmingDelete ? (
                  <View className="mt-4 gap-3">
                    <Text className="text-sm font-medium text-rose-900">
                      Confirm permanent deletion. This cannot be undone.
                    </Text>
                    <View className="flex-row items-center justify-end gap-3">
                      <Pressable
                        onPress={() => setConfirmingDelete(false)}
                        disabled={deletingAccount}
                        className="rounded-full border border-rose-200 px-4 py-2 disabled:opacity-60"
                      >
                        <Text className="text-sm font-semibold text-rose-900">Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleDeleteAccount}
                        disabled={deletingAccount}
                        className="rounded-full bg-rose-700 px-5 py-2 disabled:opacity-60"
                      >
                        {deletingAccount ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text className="text-sm font-semibold text-white">Confirm deletion</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setFormError(null);
                      setStatusMsg(null);
                      setConfirmingDelete(true);
                    }}
                    className="mt-4 rounded-full border border-rose-300 px-5 py-2"
                  >
                    <Text className="text-sm font-semibold text-rose-800">Delete my account</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
