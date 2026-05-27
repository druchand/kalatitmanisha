import "../global.css";
import { Slot, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  View,
  Image,
  ImageBackground,
  useWindowDimensions,
  Pressable,
  PanResponder,
  TouchableOpacity,
  Text,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Linking,
  Share,
  InteractionManager,
  Platform,
  LayoutChangeEvent,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ShareOptions as NativeShareOptions } from "react-native-share";

import Header from "../components/layout/Header";
import SidebarRight from "../components/layout/SidebarRight";
import Footer from "../components/layout/Footer";
import AppIcon from "../components/AppIcon";
import LanguageModal from "../components/LanguageModal";
import CountryModal from "../components/CountryModal";
import { APP_LOGO_PNG } from "../utils/logoAssets";
import { AuthModalProvider, useAuth } from "../auth/AuthModalContext";
import { setupDefaultSocialTokenFactory } from "../auth/social/tokenFactory";
import { LanguageProvider, useLanguage } from "../context/LanguageContext";
import { LocationProvider } from "../context/LocationContext";
import { VerseSelectionProvider, useVerseSelection } from "../context/VerseSelectionContext";
import { AppSettingsProvider, useAppSettings } from "../context/AppSettingsContext";
import { TeleprompterProvider } from "../context/TeleprompterContext";
import {
  guardProtectedNavigation,
  setLoginPromptSuppressed,
} from "../utils/routeAccess";
import { functionUrl } from "../utils/functionApi";
import { LogBox } from "react-native";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated and will be removed in a future release.",
  "Please use 'react-native-safe-area-context' instead.",
  "[expo-av]: Expo AV has been deprecated and will be removed in SDK 54.",
  "The native view manager for module(ExpoAppleAuthentication)",
  "NativeViewManagerAdapter isn't exported by expo-modules-core",
]);

if (__DEV__) {
  const g = globalThis as typeof globalThis & {
    __KM_WARN_FILTER_INSTALLED__?: boolean;
    __KM_ORIGINAL_WARN__?: typeof console.warn;
  };
  if (!g.__KM_WARN_FILTER_INSTALLED__) {
    g.__KM_WARN_FILTER_INSTALLED__ = true;
    g.__KM_ORIGINAL_WARN__ = console.warn.bind(console);
    const blockedWarnSnippets = [
      "SafeAreaView has been deprecated and will be removed in a future release.",
      "Please use 'react-native-safe-area-context' instead.",
      "The native view manager for module(ExpoAppleAuthentication)",
      "NativeViewManagerAdapter isn't exported by expo-modules-core",
    ];
    console.warn = (...args: any[]) => {
      const first = String(args?.[0] ?? "");
      const shouldBlock = blockedWarnSnippets.some((snippet) => first.includes(snippet));
      if (shouldBlock) return;
      g.__KM_ORIGINAL_WARN__?.(...args);
    };
  }
}

setupDefaultSocialTokenFactory();

const LAST_VISITED_ROUTE_KEY = "lastVisitedRoute";
const ROUTES_TO_SKIP_FOR_RESUME = new Set([
  "/",
  "/index",
  "/forgot-password",
]);
const ROUTES_ALLOWED_FOR_INITIAL_RESUME = new Set([
  "/",
  "/index",
  "/home",
]);
const COMMENT_MODAL_ENDPOINT = functionUrl("commentModalPayload");
const COMMENT_MODAL_SUBMIT_ENDPOINT = functionUrl("GitaPostUserComment");
const COMMENT_MODAL_LIKE_ENDPOINT = functionUrl("GitaPostUserCommentLike");
const COMMENT_MODAL_BOOKMARK_ENDPOINT = functionUrl("GitaPostUserCommentBookmark");
const APP_ANNOUNCEMENT_ENDPOINT = functionUrl("AppAnnouncement");
const ANNOUNCEMENT_SUPPRESS_PREFIX = "app_announcement_suppress::";
const DEV_FORCE_ANNOUNCEMENT = __DEV__;
const GITA_VERSE_ENDPOINT = functionUrl("gitaVerse");
const SHARE_META_ENDPOINT = functionUrl("shareMeta");
const WEB_APP_BASE_URL = "https://app.kalatitmanisha.com";
const DEFAULT_SHARE_IMAGE_URL = "https://static.wixstatic.com/media/3ba4a1_d98196f7f4a649b3b66d88cabf059986~mv2.png";
type ShareImageByPlatform = {
  default: string;
  whatsapp: string;
  facebook: string;
  x: string;
  telegram: string;
};
const DEFAULT_SHARE_DETAILS = {
  title: "Explore Kalatit Manisha",
  description: "Timeless wisdom from the Bhagavad Gita for daily life.",
  contentLabel: "Bhagavad Gita Companion",
  contentText: "Timeless wisdom from the Bhagavad Gita for daily life.",
  footerText: "Open Kalatit Manisha",
  imageUrl: DEFAULT_SHARE_IMAGE_URL,
  imageUrlByPlatform: {
    default: DEFAULT_SHARE_IMAGE_URL,
    whatsapp: DEFAULT_SHARE_IMAGE_URL,
    facebook: DEFAULT_SHARE_IMAGE_URL,
    x: DEFAULT_SHARE_IMAGE_URL,
    telegram: DEFAULT_SHARE_IMAGE_URL,
  } as ShareImageByPlatform,
};
type ShareDetails = typeof DEFAULT_SHARE_DETAILS;
const COMMENT_MODAL_DEFAULT_INSTRUCTIONS =
  "Dear User, this is a direct communication channel between you and the app developers. " +
  "Please share your views, grievances, copyright-related claims, translation quality feedback, " +
  "or user interface feedback in your preferred language. Your input is important for guiding " +
  "ongoing enhancements requested by our users. This submission is visible only to you and the app admin. " +
  "Your comment is retained for exactly one month from the date it is first submitted. " +
  "You may edit and resubmit it at any time, or delete it from the system if appropriate. " +
  "Please use this facility responsibly; abusive or inappropriate use may result in permanent suspension of site/app access.";

const parseBackendJsonPayload = (rawText: string) => {
  const parsed = rawText ? JSON.parse(rawText) : {};
  return parsed?.body && typeof parsed.body === "string"
    ? JSON.parse(parsed.body)
    : parsed?.body ?? parsed ?? {};
};

const dataUriToFile = (dataUri: string, fileName: string) => {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const binary = atob(match[2] || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
};

const openNativeImageShare = async (options: NativeShareOptions) => {
  const nativeShareModule = await import("react-native-share");
  const nativeShare = ((nativeShareModule as any).default || nativeShareModule) as {
    open: (shareOptions: NativeShareOptions) => Promise<unknown>;
  };
  return nativeShare.open(options);
};

type AppAnnouncementPayload = {
  show?: boolean;
  announcement?: {
    type?: "html" | "pdf" | "richtext" | "text" | string;
    title?: string;
    header?: string;
    html?: string;
    richText?: string;
    text?: string;
    pdfUrl?: string | null;
    updatedAt?: string;
  };
  controls?: {
    dismissLabel?: string;
    dontShowAgainLabel?: string;
  };
  suppression?: {
    key?: string;
    ttlHours?: number;
  };
};

function LayoutContent() {
  const isWeb = Platform.OS === "web";
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const isDrawerMode = width < 1024;
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<{
    chapter?: string | string[];
    verse?: string | string[];
    id?: string | string[];
    next?: string | string[];
  }>();
  const router = useRouter();
  const [isRightDrawerOpen, setIsRightDrawerOpen] = React.useState(false);
  const [authMenuOpen, setAuthMenuOpen] = React.useState(false);
  const showSignInButton = true;
  const [centralLiked, setCentralLiked] = React.useState(false);
  const [centralBookmarked, setCentralBookmarked] = React.useState(false);
  const [centralActionsVisible, setCentralActionsVisible] = React.useState(false);
  const [commentModalOpen, setCommentModalOpen] = React.useState(false);
  const [commentModalLoading, setCommentModalLoading] = React.useState(false);
  const [commentModalSubmitting, setCommentModalSubmitting] = React.useState(false);
  const [commentModalDeleting, setCommentModalDeleting] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState<AppAnnouncementPayload | null>(null);
  const [announcementVisible, setAnnouncementVisible] = React.useState(false);
  const [announcementLoading, setAnnouncementLoading] = React.useState(false);
  const [dontShowAnnouncementAgain, setDontShowAnnouncementAgain] = React.useState(false);
  const [commentModalHeader, setCommentModalHeader] = React.useState("Comment");
  const [commentModalText, setCommentModalText] = React.useState(COMMENT_MODAL_DEFAULT_INSTRUCTIONS);
  const [commentModalFormText, setCommentModalFormText] = React.useState("");
  const [centralLikeSubmitting, setCentralLikeSubmitting] = React.useState(false);
  const [centralBookmarkSubmitting, setCentralBookmarkSubmitting] = React.useState(false);
  const [focusedVerseSanskrit, setFocusedVerseSanskrit] = React.useState("");
  const [shareDetails, setShareDetails] = React.useState<ShareDetails>(DEFAULT_SHARE_DETAILS);
  const shareCardRef = React.useRef<React.ElementRef<typeof View> | null>(null);
  const webAuthOverrideEnabled = true;
  const HEADER_HEIGHT = 64;
  const [headerBottom, setHeaderBottom] = React.useState(HEADER_HEIGHT);
  const authOverlayTop = headerBottom;
  const authMenuTop = authOverlayTop + 4;
  const overlayWidth = Math.min(240, width * 0.8);
  const auth = useAuth();
  const { lang, t, isLanguageOpen, openLanguage, closeLanguage } = useLanguage();
  const { selection } = useVerseSelection();
  const { switches } = useAppSettings();
  const [initialRouteHandled, setInitialRouteHandled] = React.useState(false);
  const webAuthEnabled = !(isWeb && switches.webEnabled === false);
  const effectiveWebAuthEnabled = webAuthEnabled || webAuthOverrideEnabled;
  const suppressLoginPrompt = !showSignInButton || !effectiveWebAuthEnabled;
  const safeLang = String(lang || "EN").toUpperCase();
  const firstParam = React.useCallback((value: string | string[] | undefined) => {
    if (Array.isArray(value)) return value[0];
    return value;
  }, []);
  const routeChapter = Number(firstParam(globalParams?.chapter) || 0);
  const routeVerse = Number(firstParam(globalParams?.verse) || 0);
  const routeDilemmaId = String(firstParam(globalParams?.id) || "").trim();
  const routeNext = String(firstParam(globalParams?.next) || "").trim();
  const isGitaVersePath = React.useCallback((value: string | null | undefined) => {
    const normalized = String(value || "").trim().toLowerCase();
    return (
      normalized === "/gitaverse" ||
      normalized === "/gitaverse/" ||
      normalized === "/gitaverse-old" ||
      normalized === "/gitaverse-old/" ||
      normalized === "/gitaverse-new" ||
      normalized === "/gitaverse-new/"
    );
  }, []);
  const selectedChapter = Number(selection?.chapter || 0);
  const selectedVerse = Number(selection?.verse || 0);
  const chapterInFocus = Number.isFinite(selectedChapter) && selectedChapter > 0
    ? Math.floor(selectedChapter)
    : (Number.isFinite(routeChapter) && routeChapter > 0 ? Math.floor(routeChapter) : 0);
  const verseInFocus = Number.isFinite(selectedVerse) && selectedVerse > 0
    ? Math.floor(selectedVerse)
    : (Number.isFinite(routeVerse) && routeVerse > 0 ? Math.floor(routeVerse) : 0);
  const currentPathWithQuery = React.useMemo(() => {
    const currentPath = String(pathname || "/home");
    const queryParams = new URLSearchParams();
    if (isGitaVersePath(currentPath) && chapterInFocus > 0 && verseInFocus > 0) {
      queryParams.set("chapter", String(chapterInFocus));
      queryParams.set("verse", String(verseInFocus));
    }
    if (currentPath === "/dilemma" && routeDilemmaId) {
      queryParams.set("id", routeDilemmaId);
    }
    const query = queryParams.toString();
    return query ? `${currentPath}?${query}` : currentPath;
  }, [chapterInFocus, verseInFocus, pathname, routeDilemmaId, isGitaVersePath]);

  const currentPageLink = React.useMemo(() => {
    const base = WEB_APP_BASE_URL;
    return `${base}${currentPathWithQuery}`;
  }, [currentPathWithQuery]);
  const currentPageId = React.useMemo(() => currentPathWithQuery, [currentPathWithQuery]);
  const mainMenuItems = React.useMemo(
    () => [
      { key: "home", label: t("Home"), path: "/home", icon: { family: "feather" as const, name: "home" } },
      { key: "explore", label: t("Explore"), path: "/explore", icon: { family: "feather" as const, name: "compass" } },
      { key: "gitaverse", label: t("Gita Verse"), path: "/gitaverse", icon: { family: "feather" as const, name: "book-open" } },
      { key: "favourites", label: t("Favourites"), path: "/myfavourates", icon: { family: "feather" as const, name: "star" } },
      { key: "dilemma", label: t("Dilemma"), path: "/dilemma", icon: { family: "feather" as const, name: "help-circle" } },
      { key: "panel", label: t("Panel"), path: "", icon: { family: "feather" as const, name: "sidebar" } },
      { key: "about", label: t("About"), path: "/about", icon: { family: "feather" as const, name: "info" } },
      { key: "privacy", label: t("Privacy"), path: "/privacy-policy", icon: { family: "feather" as const, name: "shield" } },
      { key: "data-deletion", label: t("Data Deletion"), path: "/data-deletion", icon: { family: "feather" as const, name: "trash-2" } },
    ],
    [t]
  );
  const socialActionItems = React.useMemo(
    () => [
      { key: "share", label: t("Share"), icon: { family: "feather" as const, name: "share-2" } },
      { key: "comment", label: t("Comment"), icon: { family: "feather" as const, name: "message-circle" } },
      { key: "like", label: t("Like"), icon: { family: "feather" as const, name: "thumbs-up" } },
      { key: "bookmark", label: t("Bookmark"), icon: { family: "feather" as const, name: "bookmark" } },
    ],
    [t]
  );
  const closeCentralActions = React.useCallback(() => {
    setCentralActionsVisible(false);
  }, []);
  const toggleCentralActions = React.useCallback(() => {
    setCentralActionsVisible((prev) => !prev);
  }, []);
  const sessionIdParam = React.useMemo(
    () => (auth.sessionId ?? "").trim(),
    [auth.sessionId]
  );

  const getAnnouncementSuppressStorageKey = React.useCallback((suppressionKey: string) => {
    return `${ANNOUNCEMENT_SUPPRESS_PREFIX}${suppressionKey}`;
  }, []);

  const isAnnouncementSuppressed = React.useCallback(async (suppressionKey: string) => {
    const storageKey = getAnnouncementSuppressStorageKey(suppressionKey);
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return false;
    try {
      const payload = JSON.parse(raw) as { expiresAt?: number };
      const expiresAt = Number(payload?.expiresAt || 0);
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        return true;
      }
      await AsyncStorage.removeItem(storageKey);
      return false;
    } catch {
      await AsyncStorage.removeItem(storageKey);
      return false;
    }
  }, [getAnnouncementSuppressStorageKey]);

  const buildAnnouncementUrl = React.useCallback(() => {
    const url = new URL(APP_ANNOUNCEMENT_ENDPOINT);
    if (sessionIdParam) {
      url.searchParams.set("sessionId", sessionIdParam);
      url.searchParams.set("session", sessionIdParam);
    }
    return url.toString();
  }, [sessionIdParam]);

  const normalizeInternalPath = React.useCallback((value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return "/home";
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    if (/^https?:\/\//i.test(decoded) || decoded.startsWith("//") || /^javascript:/i.test(decoded)) {
      return "/home";
    }
    const withSlash = decoded.startsWith("/") ? decoded : `/${decoded}`;
    try {
      const parsed = new URL(withSlash, WEB_APP_BASE_URL);
      const pathname = String(parsed.pathname || "/home");
      const allowedPaths = new Set([
        "/home",
        "/explore",
        "/gitaverse",
        "/gitaverse-old",
        "/gitaverse-new",
        "/dilemma",
        "/aichat",
        "/myfavourates",
        "/profile",
        "/about",
        "/about-sattvic-logic",
        "/marketing",
      ]);
      const loweredPathname = pathname.toLowerCase();
      const normalizedPathname =
        loweredPathname === "/gitaverse"
          ? "/gitaverse"
          : loweredPathname === "/gitaverse-old"
          ? "/gitaverse-old"
          : loweredPathname === "/gitaverse-new"
          ? "/gitaverse-new"
          : pathname;
      if (!allowedPaths.has(normalizedPathname)) return "/home";
      return `${normalizedPathname}${parsed.search || ""}`;
    } catch {
      return "/home";
    }
  }, []);

  const resolveShareUrl = React.useCallback(() => {
    const path = String(pathname || "/home");
    const normalizedPath = path.toLowerCase();
    if (isGitaVersePath(path) && chapterInFocus > 0 && verseInFocus > 0) {
      const versePath = normalizedPath.startsWith("/gitaverse-old")
        ? "/gitaverse-old"
        : "/gitaverse";
      return `${WEB_APP_BASE_URL}${versePath}?chapter=${chapterInFocus}&verse=${verseInFocus}&lang=${encodeURIComponent(safeLang)}`;
    }
    if (path === "/dilemma" && routeDilemmaId) {
      return `${WEB_APP_BASE_URL}/dilemma?id=${encodeURIComponent(routeDilemmaId)}&lang=${encodeURIComponent(safeLang)}`;
    }
    const pagePath = String(currentPathWithQuery || "/home").trim();
    const normalizedPagePath = pagePath === "/" || pagePath === "/index" ? "/home" : pagePath;
    const url = new URL(`${WEB_APP_BASE_URL}${normalizedPagePath}`);
    if (!url.searchParams.get("lang")) {
      url.searchParams.set("lang", safeLang);
    }
    return url.toString();
  }, [chapterInFocus, currentPathWithQuery, pathname, routeDilemmaId, safeLang, verseInFocus, isGitaVersePath]);

  const shareUrlForCard = React.useMemo(() => resolveShareUrl(), [resolveShareUrl]);

  const resolveFallbackShareDetails = React.useCallback(() => {
    const path = String(pathname || "/home");
    if (isGitaVersePath(path) && chapterInFocus > 0 && verseInFocus > 0) {
      return {
        title: `Bhagavad Gita ${chapterInFocus}.${verseInFocus} | Kalatit Manisha`,
        description: `Explore Bhagavad Gita verse ${chapterInFocus}.${verseInFocus} in ${safeLang}, with meaning and guided insights.`,
        contentLabel: `Bhagavad Gita ${chapterInFocus}.${verseInFocus}`,
        contentText: `Explore Bhagavad Gita verse ${chapterInFocus}.${verseInFocus} in ${safeLang}, with meaning and guided insights.`,
        footerText: `Open verse ${chapterInFocus}.${verseInFocus}`,
        imageUrl: DEFAULT_SHARE_IMAGE_URL,
        imageUrlByPlatform: {
          ...DEFAULT_SHARE_DETAILS.imageUrlByPlatform,
        },
      };
    }
    if (path === "/dilemma" && routeDilemmaId) {
      return {
        title: "Human Dilemma | Kalatit Manisha",
        description: "Explore this life dilemma with Bhagavad Gita based wisdom and practical reflections.",
        contentLabel: "Human Dilemma",
        contentText: "Explore this life dilemma with Bhagavad Gita based wisdom and practical reflections.",
        footerText: "Open dilemma",
        imageUrl: DEFAULT_SHARE_IMAGE_URL,
        imageUrlByPlatform: {
          ...DEFAULT_SHARE_DETAILS.imageUrlByPlatform,
        },
      };
    }
    if (path === "/explore") {
      return {
        ...DEFAULT_SHARE_DETAILS,
        title: "Explore | Kalatit Manisha",
        contentLabel: "Explore",
        footerText: "Open Explore",
      };
    }
    if (path === "/about") {
      return {
        ...DEFAULT_SHARE_DETAILS,
        title: "About Kalatit Manisha",
        contentLabel: "About Kalatit Manisha",
        footerText: "Open About",
      };
    }
    if (path === "/privacy-policy") {
      return {
        ...DEFAULT_SHARE_DETAILS,
        title: "Privacy Policy | Kalatit Manisha",
        contentLabel: "Privacy Policy",
        footerText: "Open Privacy Policy",
      };
    }
    return {
      ...DEFAULT_SHARE_DETAILS,
    };
  }, [chapterInFocus, pathname, routeDilemmaId, safeLang, verseInFocus, isGitaVersePath]);

  const buildShareMessage = React.useCallback(() => {
    const shareUrl = resolveShareUrl();
    const deepLink = `kalatitmanisha://open?path=${encodeURIComponent(currentPathWithQuery)}`;
    return [
      shareDetails.title,
      shareDetails.description,
      "",
      "Web link:",
      shareUrl,
      "",
      "App link:",
      deepLink,
    ].join("\n");
  }, [currentPathWithQuery, resolveShareUrl, shareDetails.description, shareDetails.title]);

  const fetchAnnouncement = React.useCallback(async () => {
    setAnnouncementLoading(true);
    try {
      const response = await fetch(buildAnnouncementUrl(), {
        headers: { Accept: "application/json" },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const payload: AppAnnouncementPayload = text ? JSON.parse(text) : {};
      if (DEV_FORCE_ANNOUNCEMENT && !payload?.show) {
        const devPayload: AppAnnouncementPayload = {
          show: true,
          announcement: {
            type: "html",
            title: "What's New - Simulator Preview",
            header: "What's New - Simulator Preview",
            html: "<h3>Announcement Test</h3><p>This popup is forced in development mode so you can verify UI behavior.</p>",
            richText:
              "<h3>Announcement Test</h3><p>This popup is forced in development mode so you can verify UI behavior.</p>",
            updatedAt: new Date().toISOString(),
          },
          controls: {
            dismissLabel: "Dismiss",
            dontShowAgainLabel: "Don't show again",
          },
          suppression: {
            key: `dev-announcement-${new Date().toISOString().slice(0, 10)}`,
            ttlHours: 24,
          },
        };
        setAnnouncement(devPayload);
        setAnnouncementVisible(true);
        return;
      }
      setAnnouncement(payload);
      const shouldShow = Boolean(payload?.show);
      const suppressionKey = String(payload?.suppression?.key || "").trim();
      if (!shouldShow || !suppressionKey) {
        setAnnouncementVisible(false);
        return;
      }
      const suppressed = await isAnnouncementSuppressed(suppressionKey);
      setAnnouncementVisible(!suppressed);
    } catch (err) {
      if (__DEV__) {
        console.debug("[layout] announcement fetch failed", err);
      }
      setAnnouncementVisible(false);
    } finally {
      setAnnouncementLoading(false);
    }
  }, [buildAnnouncementUrl, isAnnouncementSuppressed]);

  React.useEffect(() => {
    let cancelled = false;
    const fallback = resolveFallbackShareDetails();
    setShareDetails(fallback);

    const run = async () => {
      try {
        const url = new URL(SHARE_META_ENDPOINT);
        url.searchParams.set("path", String(pathname || "/home"));
        url.searchParams.set("lang", safeLang);
        url.searchParams.set("platform", "default");
        if (chapterInFocus > 0) url.searchParams.set("chapter", String(chapterInFocus));
        if (verseInFocus > 0) url.searchParams.set("verse", String(verseInFocus));
        if (routeDilemmaId) url.searchParams.set("id", routeDilemmaId);
        const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const raw = await res.text();
        const payload = parseBackendJsonPayload(raw);
        const title = String(payload?.title || "").trim() || fallback.title;
        const description = String(payload?.description || "").trim() || fallback.description;
        const contentLabel = String(payload?.contentLabel || payload?.kicker || "").trim() || fallback.contentLabel;
        const contentText =
          String(payload?.contentText || payload?.sanskrit || payload?.quote || "").trim() ||
          fallback.contentText ||
          description;
        const footerText = String(payload?.footerText || "").trim() || fallback.footerText;
        const imageUrl = String(payload?.imageUrl || payload?.image || "").trim() || fallback.imageUrl;
        const imageMapRaw = payload?.imageUrlByPlatform || {};
        const imageUrlByPlatform: ShareImageByPlatform = {
          default: String(imageMapRaw?.default || "").trim() || imageUrl,
          whatsapp: String(imageMapRaw?.whatsapp || "").trim() || imageUrl,
          facebook: String(imageMapRaw?.facebook || "").trim() || imageUrl,
          x: String(imageMapRaw?.x || "").trim() || imageUrl,
          telegram: String(imageMapRaw?.telegram || "").trim() || imageUrl,
        };
        if (!cancelled) {
          setShareDetails({
            title,
            description,
            contentLabel,
            contentText,
            footerText,
            imageUrl,
            imageUrlByPlatform,
          });
        }
      } catch {
        if (!cancelled) {
          setShareDetails(fallback);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    chapterInFocus,
    pathname,
    routeDilemmaId,
    safeLang,
    verseInFocus,
    resolveFallbackShareDetails,
  ]);

  const handleCentralShare = React.useCallback(async () => {
    try {
      const shareUrl = resolveShareUrl();
      const shareMessage = buildShareMessage();
      let capturedShareImage = "";
      if (shareCardRef.current) {
        capturedShareImage = String(
          await captureRef(shareCardRef, {
            format: "png",
            quality: 0.95,
            result: Platform.OS === "web" ? "data-uri" : "tmpfile",
          }).catch(() => "")
        ).trim();
      }
      if (Platform.OS === "web") {
        const nav = (globalThis as any)?.navigator;
        if (nav?.share && typeof nav.share === "function" && capturedShareImage.startsWith("data:image/")) {
          const file = dataUriToFile(capturedShareImage, "kalatit-manisha-share.png");
          if (file && (!nav.canShare || nav.canShare({ files: [file] }))) {
            await nav.share({
              title: shareDetails.title,
              text: shareDetails.description,
              url: shareUrl,
              files: [file],
            });
            closeCentralActions();
            return;
          }
        }
        if (nav?.share && typeof nav.share === "function") {
          await nav.share({
            title: shareDetails.title,
            text: shareDetails.description,
            url: shareUrl,
          });
          closeCentralActions();
          return;
        }
        if (nav?.clipboard?.writeText && typeof nav.clipboard.writeText === "function") {
          await nav.clipboard.writeText(shareMessage);
          try {
            Alert.alert(
              t("Share link copied"),
              t("The share text and links were copied to your clipboard.")
            );
          } catch {}
          closeCentralActions();
          return;
        }
      }
      const canShareImage = await Sharing.isAvailableAsync().catch(() => false);
      if (canShareImage && capturedShareImage) {
        const normalizedCapturedUri = String(capturedShareImage || "").trim();
        if (normalizedCapturedUri) {
          const imageUri = normalizedCapturedUri.startsWith("file://")
            ? normalizedCapturedUri
            : `file://${normalizedCapturedUri}`;
          try {
            await openNativeImageShare({
              title: shareDetails.title,
              subject: shareDetails.title,
              message: shareMessage,
              url: imageUri,
              type: "image/png",
              filename: "kalatit-manisha-share",
              failOnCancel: false,
              useInternalStorage: true,
            });
            closeCentralActions();
            return;
          } catch (nativeShareErr) {
            if (__DEV__) console.debug("[layout] native image+text share failed", nativeShareErr);
          }
          if (Platform.OS === "ios") {
            try {
              await Share.share(
                {
                  title: shareDetails.title,
                  message: shareMessage,
                  url: imageUri,
                },
                {
                  subject: shareDetails.title,
                }
              );
              closeCentralActions();
              return;
            } catch (shareErr) {
              if (__DEV__) console.debug("[layout] iOS image+text share failed", shareErr);
            }
          }
          if (Platform.OS !== "android") {
            await Sharing.shareAsync(imageUri, {
              mimeType: "image/png",
              dialogTitle: shareDetails.title,
            });
            closeCentralActions();
            return;
          }
        }
      }
      await Share.share({
        title: shareDetails.title,
        message: shareMessage,
        url: shareUrl,
      });
      closeCentralActions();
    } catch (err) {
      if (__DEV__) {
        console.debug("[layout] central share failed", err);
      }
    }
  }, [buildShareMessage, closeCentralActions, resolveShareUrl, shareDetails, t]);

  const parseApiPayload = React.useCallback((rawText: string) => {
    return parseBackendJsonPayload(rawText);
  }, []);

  const fetchUserCommentRecord = React.useCallback(async () => {
    if (!auth.sessionId) {
      setCentralLiked(false);
      setCentralBookmarked(false);
      return { commentText: "", like: false, bookmark: false };
    }
    const existingUrl = new URL(COMMENT_MODAL_SUBMIT_ENDPOINT);
    existingUrl.searchParams.set("pageId", currentPageId);
    existingUrl.searchParams.set("sessionId", auth.sessionId);
    existingUrl.searchParams.set("session", auth.sessionId);
    const existingRes = await fetch(existingUrl.toString(), { headers: { Accept: "application/json" } });
    const existingRaw = await existingRes.text();
    const existingPayload = parseApiPayload(existingRaw);
    const like = Boolean(existingPayload?.like);
    const bookmark = Boolean(existingPayload?.bookmark ?? existingPayload?.star);
    setCentralLiked(like);
    setCentralBookmarked(bookmark);
    return {
      commentText: String(existingPayload?.commentText ?? existingPayload?.CommentText ?? ""),
      like,
      bookmark,
    };
  }, [auth.sessionId, currentPageId, parseApiPayload]);

  const openCommentModal = React.useCallback(async () => {
    if (!auth.sessionId) {
      auth.promptRestrictedAction(
        "You need to sign up or sign in to comment, like, bookmark, and save favourites.",
        "signup"
      );
      return;
    }
    setCommentModalOpen(true);
    setCommentModalLoading(true);
    try {
      const url = new URL(COMMENT_MODAL_ENDPOINT);
      url.searchParams.set("path", String(pathname || "/home"));
      if (chapterInFocus > 0) url.searchParams.set("chapter", String(chapterInFocus));
      if (verseInFocus > 0) url.searchParams.set("verse", String(verseInFocus));
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      const raw = await res.text();
      const payload = parseApiPayload(raw);
      setCommentModalHeader(String(payload?.header || payload?.title || "Comment"));
      setCommentModalText(
        String(payload?.text || payload?.description || COMMENT_MODAL_DEFAULT_INSTRUCTIONS)
      );
      let nextFormText = String(
        String(
          payload?.commentText ??
          payload?.CommentText ??
          payload?.formText ??
          payload?.form ??
          payload?.defaultValue ??
          ""
        )
      );
      if (!nextFormText) {
        const existingPayload = await fetchUserCommentRecord();
        nextFormText = String(
          existingPayload?.commentText ??
          ""
        );
      }
      setCommentModalFormText(nextFormText);
    } catch {
      setCommentModalHeader("Comment");
      setCommentModalText(COMMENT_MODAL_DEFAULT_INSTRUCTIONS);
      setCommentModalFormText("");
    } finally {
      setCommentModalLoading(false);
    }
  }, [auth, auth.sessionId, chapterInFocus, fetchUserCommentRecord, parseApiPayload, pathname, verseInFocus]);

  const closeCommentModal = React.useCallback(() => {
    setCommentModalOpen(false);
  }, []);

  const deleteCommentModal = React.useCallback(async () => {
    if (!auth.sessionId) {
      auth.promptRestrictedAction(
        "You need to sign up or sign in to manage comments.",
        "signup"
      );
      return;
    }
    setCommentModalDeleting(true);
    try {
      const deleteUrl = new URL(COMMENT_MODAL_SUBMIT_ENDPOINT);
      deleteUrl.searchParams.set("pageId", currentPageId);
      deleteUrl.searchParams.set("sessionId", auth.sessionId);
      deleteUrl.searchParams.set("session", auth.sessionId);
      const res = await fetch(deleteUrl.toString(), {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        throw new Error(`DELETE_COMMENT_FAILED:${res.status}:${raw}`);
      }
      setCommentModalFormText("");
      setCentralLiked(false);
      setCentralBookmarked(false);
      setCommentModalOpen(false);
    } catch (err) {
      console.warn("[layout] delete comment failed", err);
    } finally {
      setCommentModalDeleting(false);
    }
  }, [auth, auth.sessionId, currentPageId]);

  const submitCommentModal = React.useCallback(async () => {
    if (!auth.sessionId) {
      auth.promptRestrictedAction(
        "You need to sign up or sign in to submit comments.",
        "signup"
      );
      return;
    }
    setCommentModalSubmitting(true);
    try {
      const submitUrl = new URL(COMMENT_MODAL_SUBMIT_ENDPOINT);
      submitUrl.searchParams.set("pageId", currentPageId);
      submitUrl.searchParams.set("sessionId", auth.sessionId);
      submitUrl.searchParams.set("session", auth.sessionId);

      const res = await fetch(submitUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentText: commentModalFormText,
        }),
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        throw new Error(`SUBMIT_COMMENT_FAILED:${res.status}:${raw}`);
      }
      setCommentModalOpen(false);
    } catch (err) {
      console.warn("[layout] submit comment failed", err);
    } finally {
      setCommentModalSubmitting(false);
    }
  }, [
    auth,
    auth.sessionId,
    commentModalFormText,
    currentPageId,
  ]);

  const toggleCentralLike = React.useCallback(async () => {
    if (!auth.sessionId) {
      auth.promptRestrictedAction(
        "You need to sign up or sign in to like content.",
        "signup"
      );
      return;
    }
    if (centralLikeSubmitting) return;
    setCentralLikeSubmitting(true);
    try {
      const likeUrl = new URL(COMMENT_MODAL_LIKE_ENDPOINT);
      likeUrl.searchParams.set("pageId", currentPageId);
      likeUrl.searchParams.set("sessionId", auth.sessionId);
      likeUrl.searchParams.set("session", auth.sessionId);
      const likeRes = await fetch(likeUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ pageId: currentPageId }),
      });
      if (!likeRes.ok) {
        const raw = await likeRes.text().catch(() => "");
        throw new Error(`LIKE_FAILED:${likeRes.status}:${raw}`);
      }
      const likeRaw = await likeRes.text();
      const likePayload = parseApiPayload(likeRaw);
      if (typeof likePayload?.like === "boolean") {
        setCentralLiked(likePayload.like);
      }
    } catch (err) {
      console.warn("[layout] toggle like failed", err);
    } finally {
      setCentralLikeSubmitting(false);
    }
  }, [auth, auth.sessionId, centralLikeSubmitting, currentPageId, parseApiPayload]);

  const toggleCentralBookmark = React.useCallback(async () => {
    if (!auth.sessionId) {
      auth.promptRestrictedAction(
        "You need to sign up or sign in to mark favourites.",
        "signup"
      );
      return;
    }
    if (centralBookmarkSubmitting) return;
    setCentralBookmarkSubmitting(true);
    try {
      const bookmarkUrl = new URL(COMMENT_MODAL_BOOKMARK_ENDPOINT);
      bookmarkUrl.searchParams.set("pageId", currentPageId);
      bookmarkUrl.searchParams.set("sessionId", auth.sessionId);
      bookmarkUrl.searchParams.set("session", auth.sessionId);
      const bookmarkRes = await fetch(bookmarkUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ pageId: currentPageId }),
      });
      if (!bookmarkRes.ok) {
        const raw = await bookmarkRes.text().catch(() => "");
        throw new Error(`BOOKMARK_FAILED:${bookmarkRes.status}:${raw}`);
      }
      const bookmarkRaw = await bookmarkRes.text();
      const bookmarkPayload = parseApiPayload(bookmarkRaw);
      if (typeof bookmarkPayload?.bookmark === "boolean" || typeof bookmarkPayload?.star === "boolean") {
        setCentralBookmarked(Boolean(bookmarkPayload?.bookmark ?? bookmarkPayload?.star));
      }
    } catch (err) {
      console.warn("[layout] toggle bookmark failed", err);
    } finally {
      setCentralBookmarkSubmitting(false);
    }
  }, [auth, auth.sessionId, centralBookmarkSubmitting, currentPageId, parseApiPayload]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.sessionId) {
        if (!cancelled) setCentralLiked(false);
        if (!cancelled) setCentralBookmarked(false);
        return;
      }
      try {
        const result = await fetchUserCommentRecord();
        if (!cancelled) setCentralLiked(Boolean(result?.like));
        if (!cancelled) setCentralBookmarked(Boolean(result?.bookmark));
      } catch {
        if (!cancelled) setCentralLiked(false);
        if (!cancelled) setCentralBookmarked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.sessionId, currentPageId, fetchUserCommentRecord]);

  React.useEffect(() => {
    if (!commentModalOpen) return;
    if (!chapterInFocus || !verseInFocus) {
      setFocusedVerseSanskrit("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(GITA_VERSE_ENDPOINT);
        url.searchParams.set("lang", safeLang || "EN");
        url.searchParams.set("chapter", String(chapterInFocus));
        url.searchParams.set("verse", String(verseInFocus));
        if (auth.sessionId) url.searchParams.set("sessionId", auth.sessionId);
        const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const raw = await res.text();
        const parsed = raw ? JSON.parse(raw) : {};
        const payload = parsed?.body && typeof parsed.body === "string"
          ? JSON.parse(parsed.body)
          : parsed?.body ?? parsed ?? {};
        const verseData = payload?.payLoad?.verseData ?? payload?.verseData ?? payload ?? {};
        const sanskrit =
          verseData?.sanskrit ??
          verseData?.GitaVerses_verseTranslations?.[0]?.sanskrit ??
          "";
        if (!cancelled) setFocusedVerseSanskrit(String(sanskrit || "").trim());
      } catch {
        if (!cancelled) setFocusedVerseSanskrit("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.sessionId, chapterInFocus, commentModalOpen, safeLang, verseInFocus]);

  const openCentralChatDirect = React.useCallback(() => {
    router.push("/aichat");
  }, [router]);

  React.useEffect(() => {
    (globalThis as any).__webAuthOverride = webAuthOverrideEnabled;
  }, [webAuthOverrideEnabled]);

  React.useEffect(() => {
    if (auth.initializing || initialRouteHandled) return;
    let cancelled = false;

    const run = async () => {
      const normalizedPath = String(pathname || "").trim();
      const hasSession = Boolean(auth.sessionId?.trim());
      if (!hasSession) {
        if (!cancelled) setInitialRouteHandled(true);
        return;
      }

      try {
        const saved = (await AsyncStorage.getItem(LAST_VISITED_ROUTE_KEY))?.trim();
        const target = saved || "/home";
        const canResumeFromCurrentRoute = ROUTES_ALLOWED_FOR_INITIAL_RESUME.has(normalizedPath);
        if (canResumeFromCurrentRoute && target && pathname !== target) {
          router.replace(target as any);
        }
      } catch (err) {
        console.warn("[layout] failed to resolve last visited route", err);
        if (pathname !== "/home") {
          router.replace("/home");
        }
      } finally {
        if (!cancelled) setInitialRouteHandled(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [auth.initializing, auth.sessionId, initialRouteHandled, pathname, router]);

  React.useEffect(() => {
    if (auth.initializing) return;
    const normalizedPath = String(pathname || "").trim();
    if (normalizedPath !== "/home" || !routeNext) return;
    const target = normalizeInternalPath(routeNext);
    if (!target || target === "/home") return;
    router.replace(target as any);
  }, [auth.initializing, normalizeInternalPath, pathname, routeNext, router]);

  React.useEffect(() => {
    if (auth.initializing) return;
    void fetchAnnouncement();
  }, [auth.initializing, fetchAnnouncement, safeLang, sessionIdParam]);

  React.useEffect(() => {
    const normalizedPath = String(pathname || "").trim();
    if (!normalizedPath || ROUTES_TO_SKIP_FOR_RESUME.has(normalizedPath)) return;
    AsyncStorage.setItem(LAST_VISITED_ROUTE_KEY, normalizedPath).catch((err) => {
      console.warn("[layout] failed to persist last visited route", err);
    });
  }, [pathname]);

  React.useEffect(() => {
    if (auth.user) {
      setAuthMenuOpen(false);
    }
  }, [auth.user]);

  React.useEffect(() => {
    setLoginPromptSuppressed(suppressLoginPrompt);
  }, [suppressLoginPrompt]);
  const dismissAnnouncement = React.useCallback(async () => {
    const suppressionKey = String(announcement?.suppression?.key || "").trim();
    const ttlHours = Number(announcement?.suppression?.ttlHours || 24);
    if (dontShowAnnouncementAgain && suppressionKey) {
      const storageKey = getAnnouncementSuppressStorageKey(suppressionKey);
      const ttlMs = Math.max(1, Number.isFinite(ttlHours) ? ttlHours : 24) * 60 * 60 * 1000;
      const payload = JSON.stringify({
        expiresAt: Date.now() + ttlMs,
      });
      await AsyncStorage.setItem(storageKey, payload).catch(() => null);
    }
    setAnnouncementVisible(false);
    setDontShowAnnouncementAgain(false);
  }, [
    announcement?.suppression?.key,
    announcement?.suppression?.ttlHours,
    dontShowAnnouncementAgain,
    getAnnouncementSuppressStorageKey,
  ]);

  const announcementType = String(announcement?.announcement?.type || "html").toLowerCase();
  const announcementTitle =
    String(announcement?.announcement?.header || announcement?.announcement?.title || "What's New");
  const announcementHtml =
    String(announcement?.announcement?.html || announcement?.announcement?.richText || "").trim();
  const announcementText = String(announcement?.announcement?.text || "").trim();
  const announcementPdfUrl = String(announcement?.announcement?.pdfUrl || "").trim();
  const dismissLabel = String(announcement?.controls?.dismissLabel || "Dismiss");
  const dontShowLabel = String(announcement?.controls?.dontShowAgainLabel || "Don't show again");

  const renderAnnouncementBody = () => {
    if (announcementType === "pdf" && announcementPdfUrl) {
      return (
        <TouchableOpacity
          onPress={() => {
            void Linking.openURL(announcementPdfUrl);
          }}
          className="rounded-xl bg-slate-100 px-3 py-2"
        >
          <Text className="text-sky-700 font-semibold">Open PDF</Text>
        </TouchableOpacity>
      );
    }

    const plainText = announcementText || announcementHtml.replace(/<[^>]+>/g, "");
    if (plainText) {
      return (
        <ScrollView style={{ maxHeight: 320 }}>
          <Text className="text-sm leading-6 text-slate-700">{plainText}</Text>
        </ScrollView>
      );
    }

    return <Text className="text-sm text-slate-500">No announcement content available.</Text>;
  };

  const renderAnnouncementCard = () => (
    <View
      className="rounded-2xl bg-white p-4"
      style={{ maxHeight: "86%", width: Platform.OS === "web" ? 560 : "100%", maxWidth: "100%" }}
    >
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-slate-900">{announcementTitle}</Text>
        {announcementLoading && <ActivityIndicator size="small" color="#475569" />}
      </View>

      {renderAnnouncementBody()}

      <Pressable
        onPress={() => setDontShowAnnouncementAgain((prev) => !prev)}
        className="mt-4 flex-row items-center"
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: "#94a3b8",
            backgroundColor: dontShowAnnouncementAgain ? "#0f172a" : "#ffffff",
            marginRight: 10,
          }}
        />
        <Text className="text-sm text-slate-600">{dontShowLabel}</Text>
      </Pressable>

      <View className="mt-4 flex-row justify-end">
        <TouchableOpacity
          onPress={() => {
            void dismissAnnouncement();
          }}
          className="rounded-xl bg-slate-900 px-4 py-2"
        >
          <Text className="text-sm font-semibold text-white">{dismissLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const openRightDrawer = React.useCallback(() => {
    setIsRightDrawerOpen(true);
  }, []);
  const closeRightDrawer = React.useCallback(
    () => setIsRightDrawerOpen(false),
    []
  );

  const toggleRightDrawer = React.useCallback(() => {
    setIsRightDrawerOpen((prev) => !prev);
  }, []);

  const rightPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 10,
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 10) closeRightDrawer();
        },
      }),
    [closeRightDrawer]
  );

  React.useEffect(() => {
    closeRightDrawer();
    setAuthMenuOpen(false);
    closeLanguage();
  }, [pathname, closeLanguage, closeRightDrawer]);

  const toggleAuthMenu = React.useCallback(() => {
    if (!effectiveWebAuthEnabled) return;
    closeLanguage();
    setAuthMenuOpen((prev) => !prev);
  }, [closeLanguage, effectiveWebAuthEnabled]);
  const toggleHeaderLanguagePanel = React.useCallback(() => {
    setAuthMenuOpen(false);
    if (isLanguageOpen) {
      closeLanguage();
      return;
    }
    openLanguage();
  }, [closeLanguage, isLanguageOpen, openLanguage]);

  const handleMenuAction = React.useCallback(
    (action: () => void) => {
      setAuthMenuOpen(false);
      if (Platform.OS === "web") {
        action();
        return;
      }
      InteractionManager.runAfterInteractions(action);
    },
    []
  );
  const handleCentralMenuNavigation = React.useCallback(
    (path: string) => {
      if (path === "__panel__") {
        setCentralActionsVisible(false);
        toggleRightDrawer();
        return;
      }
      setCentralActionsVisible(false);
      guardProtectedNavigation({
        targetPath: path,
        sessionId: auth.sessionId,
        openLogin: auth.openLogin,
        onAllowed: () => {
          if (path === "/gitaverse") {
            router.push({
              pathname: "/gitaverse",
              params: {
                chapter: String(chapterInFocus || 1),
                verse: String(verseInFocus || 1),
                lang: safeLang,
              },
            });
            return;
          }
          router.push(path as any);
        },
      });
    },
    [auth.openLogin, auth.sessionId, chapterInFocus, router, safeLang, toggleRightDrawer, verseInFocus]
  );

  const authMenuItems = React.useMemo(() => {
    const items = [];
    if (auth.user) {
      items.push({
        key: "profile",
        label: "My Profile",
        action: () => router.push("/profile"),
      });
    }
    if (effectiveWebAuthEnabled || auth.user) {
      items.push({
        key: "auth",
        label: auth.user ? "Sign out" : "Sign in",
        action: () => {
          if (auth.user) {
            auth.logout();
          } else {
            auth.openLogin("login");
          }
        },
      });
    }
    if (effectiveWebAuthEnabled) {
      items.push(
        {
          key: "signup",
          label: "Create account",
          action: () => {
            auth.openLogin("signup");
          },
        },
        {
          key: "forgot",
          label: "Forgot password",
          action: () => {
            auth.openLogin("forgot");
          },
        }
      );
    }
    items.push({
      key: "about",
      label: "About",
      action: () => router.push("/about"),
    });
    return items;
  }, [auth, router, effectiveWebAuthEnabled]);

  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-slate-50">
          <View className="flex-1 flex-col overflow-hidden relative">
            <StatusBar style="auto" />
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                elevation: 1000,
              }}
              pointerEvents="auto"
              onLayout={(event: LayoutChangeEvent) => {
                const { y, height } = event.nativeEvent.layout;
                const next = Math.max(HEADER_HEIGHT, Math.round(y + height));
                if (next !== headerBottom) setHeaderBottom(next);
              }}
            >
              <Header
                onLanguagePress={toggleHeaderLanguagePanel}
                languagePanelOpen={isLanguageOpen}
                onLoginPress={
                  showSignInButton && (effectiveWebAuthEnabled || auth.user)
                    ? toggleAuthMenu
                    : undefined
                }
              />
            </View>

            <View
              className="flex-1 relative"
              style={{ zIndex: 1, paddingTop: headerBottom }}
            >
              <View className="flex-1 flex-row overflow-hidden bg-slate-50">
                <View
                  className="relative flex-1"
                  style={{ minWidth: 0, marginLeft: 0, marginRight: isDesktop ? 12 : 0 }}
                >
                  <Slot />

                </View>

                {isDesktop && (
                  <View
                    className="flex-shrink-0"
                    style={{
                      width: 240,
                      minWidth: 220,
                    }}
                  >
                    <SidebarRight />
                  </View>
                )}
              </View>

              {isDrawerMode && !isRightDrawerOpen && (
                <>
                  <Pressable
                    className="absolute right-0 top-1/2 z-30 h-16 w-6 -translate-y-1/2 rounded-l-full bg-slate-200"
                    onPress={openRightDrawer}
                  >
                    <View className="h-full w-full flex-col items-center justify-center">
                      <View className="h-10 w-1 rounded-full bg-slate-400" />
                    </View>
                  </Pressable>
                </>
              )}

              {isDrawerMode && isRightDrawerOpen && (
                <>
                  <Pressable
                    className="absolute inset-0 z-40 bg-black/40"
                    style={{ top: headerBottom }}
                    onPress={closeRightDrawer}
                  />
                  <View
                    {...rightPanResponder.panHandlers}
                    className="absolute right-0 top-0 bottom-0 z-50 bg-white shadow-xl"
                    style={{ width: overlayWidth, top: headerBottom }}
                  >
                    <Pressable
                      className="absolute left-0 top-1/2 h-12 w-4 -translate-y-1/2 rounded-r-full bg-slate-200"
                      onPress={closeRightDrawer}
                    />
                    <SidebarRight />
                  </View>
                </>
              )}
            </View>

            <Footer
              onMenuPress={toggleCentralActions}
              menuOpen={centralActionsVisible}
            />
          </View>
          <Modal
            visible={centralActionsVisible}
            transparent
            animationType="slide"
            onRequestClose={closeCentralActions}
          >
            <View className="flex-1 justify-end bg-black/35">
              <Pressable className="flex-1" onPress={closeCentralActions} />
              <View className="mx-3 mb-3 rounded-2xl border border-slate-200 bg-white px-4 pb-4 pt-3">
                <View className="mb-3 h-1.5 w-12 self-center rounded-full bg-slate-300" />
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-bold text-slate-900">{t("Quick Actions")}</Text>
                  <TouchableOpacity
                    className="h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-100"
                    onPress={closeCentralActions}
                  >
                    <Text className="text-base font-bold text-slate-700">X</Text>
                  </TouchableOpacity>
                </View>
                <View className="mt-4">
                  <Text className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {t("Social")}
                  </Text>
                  <View className="mt-3 flex-row flex-wrap justify-center" style={{ gap: 14 }}>
                    {socialActionItems.map((item) => {
                      const isComment = item.key === "comment";
                      const isLike = item.key === "like";
                      const isBookmark = item.key === "bookmark";
                      const isActive = isComment ? commentModalOpen : isLike ? centralLiked : isBookmark ? centralBookmarked : false;
                      const activeBorder = isComment
                        ? "#7dd3fc"
                        : isLike
                          ? "#fda4af"
                          : isBookmark
                            ? "#fcd34d"
                            : "#cbd5e1";
                      const activeBg = isComment
                        ? "rgba(3,105,161,0.05)"
                        : isLike
                          ? "rgba(225,29,72,0.05)"
                          : isBookmark
                            ? "rgba(217,119,6,0.05)"
                            : "rgba(15,23,42,0.05)";
                      const activeColor = isComment
                        ? "#0369a1"
                        : isLike
                          ? "#e11d48"
                          : isBookmark
                            ? "#d97706"
                            : "#0f172a";
                      const disabled = isLike ? centralLikeSubmitting : isBookmark ? centralBookmarkSubmitting : false;
                      return (
                        <Pressable
                          key={item.key}
                          className="items-center"
                          style={{ width: 68 }}
                          onPress={() => {
                            if (item.key === "share") {
                              void handleCentralShare();
                              return;
                            }
                            if (item.key === "comment") {
                              closeCentralActions();
                              void openCommentModal();
                              return;
                            }
                            if (item.key === "like") {
                              closeCentralActions();
                              void toggleCentralLike();
                              return;
                            }
                            if (item.key === "bookmark") {
                              closeCentralActions();
                              void toggleCentralBookmark();
                            }
                          }}
                          disabled={disabled}
                        >
                          <View
                            className="h-14 w-14 items-center justify-center rounded-full border"
                            style={{
                              borderColor: isActive ? activeBorder : "#cbd5e1",
                              backgroundColor: isActive ? activeBg : "rgba(15,23,42,0.05)",
                            }}
                          >
                            <AppIcon family={item.icon.family} name={item.icon.name} size={24} color={isActive ? activeColor : "#0f172a"} />
                          </View>
                          <Text className="mt-2 text-[11px] font-semibold text-slate-700 text-center">
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View className="mt-5">
                  <Text className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {t("Main Menu")}
                  </Text>
                  <ScrollView
                    horizontal={false}
                    nestedScrollEnabled
                    contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12, justifyContent: "center" }}
                    style={{ maxHeight: 280 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {mainMenuItems.map((item) => (
                      <Pressable
                        key={item.key}
                        className="items-center"
                        style={{ width: 68 }}
                        onPress={() => handleCentralMenuNavigation(item.key === "panel" ? "__panel__" : item.path)}
                      >
                        <View
                          className="h-14 w-14 items-center justify-center rounded-full border border-slate-300"
                          style={{ backgroundColor: "rgba(15,23,42,0.05)" }}
                        >
                          <AppIcon family={item.icon.family} name={item.icon.name} size={22} color="#0f172a" />
                        </View>
                        <Text className="mt-2 text-[11px] font-semibold text-slate-700 text-center">
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </View>
          </Modal>
          <LanguageModal />
          <CountryModal />
          <Modal
            visible={commentModalOpen}
            transparent
            animationType="slide"
            onRequestClose={closeCommentModal}
          >
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
            >
              <View className="flex-1 bg-black/35 justify-end">
                <View className="mx-3 mb-3 rounded-2xl bg-white p-4" style={{ maxHeight: "88%" }}>
                  {commentModalLoading ? (
                    <View className="py-8 items-center">
                      <ActivityIndicator />
                      <Text className="mt-3 text-slate-600">Loading…</Text>
                    </View>
                  ) : (
                    <>
                      <View className="mb-2 flex-row items-start justify-between">
                        <Text className="flex-1 pr-3 text-lg font-bold text-slate-900">{commentModalHeader}</Text>
                        <TouchableOpacity
                          className="h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-100"
                          onPress={closeCommentModal}
                          disabled={commentModalSubmitting || commentModalDeleting}
                        >
                          <Text className="text-base font-bold text-slate-700">X</Text>
                        </TouchableOpacity>
                      </View>
                      <ScrollView
                        style={{ flexGrow: 0 }}
                        contentContainerStyle={{ paddingBottom: 10 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                      >
                        <Text className="mt-2 text-sm text-slate-700">{commentModalText}</Text>
                        <TextInput
                          value={commentModalFormText}
                          onChangeText={setCommentModalFormText}
                          placeholder="Write your comments"
                          multiline
                          style={{
                            marginTop: 12,
                            minHeight: 90,
                            borderWidth: 1,
                            borderColor: "rgba(15,23,42,0.2)",
                            borderRadius: 12,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            color: "#0f172a",
                            textAlignVertical: "top",
                          }}
                        />
                        <View style={{ marginTop: 12, borderRadius: 10, backgroundColor: "rgba(15,23,42,0.05)", padding: 10 }}>
                          <Text style={{ color: "#0f172a", fontWeight: "700", fontSize: 13 }}>Current page</Text>
                          <Text style={{ color: "rgba(15,23,42,0.8)", fontSize: 12, marginTop: 4 }}>{currentPageLink}</Text>
                          {!!focusedVerseSanskrit && (
                            <>
                              <Text style={{ color: "#0f172a", fontWeight: "700", fontSize: 13, marginTop: 8 }}>
                                Sanskrit in focus
                              </Text>
                              <Text style={{ color: "rgba(15,23,42,0.9)", fontSize: 13, marginTop: 4 }}>
                                {focusedVerseSanskrit}
                              </Text>
                            </>
                          )}
                        </View>
                      </ScrollView>
                      <View className="mt-4 flex-row items-center justify-between">
                        <TouchableOpacity
                          className="flex-1 mr-2 rounded-xl border border-rose-300 bg-rose-100 py-3 items-center"
                          onPress={deleteCommentModal}
                          disabled={commentModalSubmitting || commentModalDeleting}
                        >
                          <Text className="font-semibold text-rose-700">
                            {commentModalDeleting ? "Deleting…" : "Delete"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="flex-1 ml-2 rounded-xl border border-emerald-300 bg-emerald-100 py-3 items-center"
                          onPress={submitCommentModal}
                          disabled={commentModalSubmitting || commentModalDeleting}
                        >
                          <Text className="font-semibold text-emerald-800">
                            {commentModalSubmitting ? "Submitting…" : "Submit"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
          {Platform.OS === "web" ? (
            announcementVisible ? (
              <View
                style={{
                  position: "fixed" as any,
                  inset: 0,
                  backgroundColor: "rgba(2,6,23,0.45)",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 16,
                  zIndex: 9999,
                }}
              >
                {renderAnnouncementCard()}
              </View>
            ) : null
          ) : (
            <Modal
              transparent
              animationType="fade"
              visible={announcementVisible}
              onRequestClose={() => {
                void dismissAnnouncement();
              }}
            >
              <View style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.45)", justifyContent: "center", padding: 16 }}>
                {renderAnnouncementCard()}
              </View>
            </Modal>
          )}
          {authMenuOpen && (
            <>
              <Pressable
                className="absolute inset-x-0 bottom-0 z-40 bg-black/20"
                style={{ top: authOverlayTop }}
                onPress={() => setAuthMenuOpen(false)}
              />
              <View
                className="absolute right-4 z-50 w-40 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg"
                style={{ top: authMenuTop }}
              >
                {authMenuItems.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    className="rounded-xl px-3 py-2"
                    onPress={() => handleMenuAction(item.action)}
                  >
                    <Text className="text-sm font-medium text-slate-700">
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <View
            ref={shareCardRef}
            collapsable={false}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: -10000,
              top: 0,
              width: 1080,
              padding: 56,
              backgroundColor: "#0f172a",
            }}
          >
            <View
              style={{
                borderRadius: 36,
                backgroundColor: "#f8fafc",
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 14 },
                elevation: 10,
              }}
            >
              <ImageBackground
                source={{ uri: shareDetails.imageUrl || DEFAULT_SHARE_IMAGE_URL }}
                resizeMode="cover"
                imageStyle={{ opacity: 0.14 }}
                style={{ borderRadius: 36, overflow: "hidden", padding: 48 }}
              >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 18,
                  marginBottom: 28,
                }}
              >
                <Image
                  source={APP_LOGO_PNG}
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 28,
                    backgroundColor: "#ffffff",
                  }}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#14532d", fontSize: 22, fontWeight: "800", letterSpacing: 1 }}>
                    KALATIT MANISHA
                  </Text>
                  <Text style={{ color: "#334155", fontSize: 18, marginTop: 6 }}>
                    Bhagavad Gita Companion
                  </Text>
                </View>
              </View>
              <View
                style={{
                  borderRadius: 28,
                  backgroundColor: "rgba(220,252,231,0.94)",
                  padding: 36,
                }}
              >
                <Text
                  style={{
                    color: "#166534",
                    fontSize: 26,
                    lineHeight: 34,
                    fontWeight: "800",
                    marginBottom: 20,
                  }}
                >
                  {shareDetails.contentLabel}
                </Text>
                <Text
                  style={{
                    color: "#052e16",
                    fontSize: 44,
                    lineHeight: 58,
                    fontWeight: "800",
                    marginBottom: 28,
                  }}
                >
                  {shareDetails.contentText || shareDetails.description}
                </Text>
                <Text
                  style={{
                    color: "#052e16",
                    fontSize: 34,
                    lineHeight: 44,
                    fontWeight: "800",
                  }}
                >
                  {shareDetails.title}
                </Text>
                <Text
                  style={{
                    color: "#14532d",
                    fontSize: 34,
                    lineHeight: 46,
                    marginTop: 24,
                  }}
                >
                  {shareDetails.description}
                </Text>
                <Text
                  style={{
                    color: "#166534",
                    fontSize: 22,
                    lineHeight: 30,
                    fontWeight: "800",
                    marginTop: 36,
                  }}
                >
                  {shareDetails.footerText}
                </Text>
              </View>
              </ImageBackground>
            </View>
          </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthModalProvider>
      <LocationProvider>
        <AppSettingsProvider>
          <LanguageProvider>
            <VerseSelectionProvider>
              <TeleprompterProvider>
                <LayoutContent />
              </TeleprompterProvider>
            </VerseSelectionProvider>
          </LanguageProvider>
        </AppSettingsProvider>
      </LocationProvider>
    </AuthModalProvider>
  );
}
