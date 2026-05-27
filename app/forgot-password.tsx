import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import authService from "../auth/services/authService";

const EMAIL_REGEX = /\S+@\S+\.\S+/;

export default function ForgotPasswordScreen(): React.ReactElement {
  const params = useLocalSearchParams<{
    identifier?: string | string[];
    error?: string | string[];
    status?: string | string[];
  }>();
  const router = useRouter();
  const toSingle = (value?: string | string[]): string => {
    if (Array.isArray(value)) return String(value[0] ?? "").trim();
    if (typeof value === "string") return value.trim();
    return "";
  };
  const initialIdentifier = useMemo(() => {
    return toSingle(params.identifier);
  }, [params.identifier]);
  const initialError = useMemo(() => {
    const value = toSingle(params.error);
    return value || null;
  }, [params.error]);
  const initialStatus = useMemo(() => {
    const value = toSingle(params.status);
    return value || null;
  }, [params.status]);
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [status, setStatus] = useState<string | null>(initialStatus);

  useEffect(() => {
    setIdentifier(initialIdentifier);
  }, [initialIdentifier]);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const isValid = EMAIL_REGEX.test(identifier.trim());
  const canSubmit = isValid && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      setError(null);
      setStatus(null);
      const response = await authService.forgotPassword(identifier.trim(), {
        delivery: "email",
      });
      if (!response.success) {
        throw new Error(response.message ?? response.error ?? "Unable to send reset link");
      }
      setStatus(
        response.message ??
          "If an account exists, check your email for reset instructions."
      );
    } catch (err: any) {
      setError(err?.message ?? "Unable to send reset link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: "center", backgroundColor: "#f8fafc" }}>
      <View
        style={{
          padding: 16,
          borderRadius: 14,
          backgroundColor: "#ffffff",
          borderWidth: 1,
          borderColor: "#e2e8f0",
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: "700", color: "#0f172a" }}>Forgot Password</Text>
        <Text style={{ marginTop: 8, color: "#475569", lineHeight: 20 }}>
          Enter your account email and we'll send password reset instructions.
        </Text>

        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: "#cbd5e1",
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        />

        {!isValid && identifier.length > 0 ? (
          <Text style={{ marginTop: 8, color: "#b45309", fontSize: 12 }}>
            Enter a valid email address.
          </Text>
        ) : null}
        {error ? <Text style={{ marginTop: 10, color: "#b91c1c" }}>{error}</Text> : null}
        {status ? <Text style={{ marginTop: 10, color: "#166534" }}>{status}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={{
            marginTop: 14,
            backgroundColor: canSubmit ? "#0ea5e9" : "#94a3b8",
            borderRadius: 10,
            paddingVertical: 11,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>
            {submitting ? "Sending..." : "Send Reset Email"}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.replace("/")} style={{ marginTop: 12, alignItems: "center" }}>
          <Text style={{ color: "#0f172a", fontWeight: "600" }}>Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}
