export type SectionId = "1" | "2" | "3" | "4" | "5";

const IMAGE_EXT_REGEX = /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/i;
const GENERIC_URL_REGEX = /https?:\/\/\S+/i;

const cleanCodeFence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const lines = trimmed.split("\n");

  if (lines[0].trim().startsWith("```")) {
    lines.shift();
  }
  if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
    lines.pop();
  }

  return lines.join("\n");
};

export function extractNarrationFromRaw(cleaned: string, sectionId: SectionId): string | null {
  if (sectionId !== "4") return null;
  const raw = String(cleaned || "").trim();
  if (!raw) return null;

  // First try structured parsing.
  try {
    let parsed: any = JSON.parse(raw);
    // Some backends return JSON as a quoted string; parse one more layer if needed.
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // keep original parsed string
      }
    }
    const candidates = [
      parsed?.["4"],
      parsed?.payLoad?.["4"],
      parsed?.payload?.["4"],
      parsed?.sections?.["4"],
      parsed?.section4,
      parsed?.section_4,
      parsed?.data?.sections?.["4"],
      parsed?.data?.["4"],
      parsed?.data?.section4,
      parsed?.data?.section_4,
    ];
    for (const node of candidates) {
      if (!node || typeof node !== "object") continue;
      const narration =
        (node as any).Narration ??
        (node as any).narration ??
        (node as any).long_explanatory_narration;
      if (typeof narration === "string" && narration.trim()) {
        return narration.trim();
      }
    }
  } catch {
    // fall through to strict regex extraction
  }

  // Fallback: extract only the first narration string field, never the entire payload.
  const match = raw.match(/"(?:Narration|narration)"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match?.[1]) return null;
  const body = match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
  return body.length ? body : null;
}

export function normalizeGitaAIRoot(result: any): {
  root: any;
  cleanedRaw: string | null;
} {
  let root = result;
  if (root && typeof root === "object" && ("success" in root || "data" in root)) {
    const envelope = root as any;
    const hasDataField = Object.prototype.hasOwnProperty.call(envelope, "data");
    if (hasDataField && (envelope.data === null || envelope.data === undefined)) {
      return { root: null, cleanedRaw: null };
    }
    root = envelope.data ?? root;
  }

  if (!root) {
    throw new Error("EMPTY_AI_RESPONSE");
  }

  let cleanedRaw: string | null = null;

  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      cleanedRaw = root.trim();
    }
  } else if (root && typeof root === "object" && typeof (root as any).raw === "string") {
    const cleaned = cleanCodeFence((root as any).raw);
    try {
      const parsed = JSON.parse(cleaned);
      const { raw: _raw, ...rest } = root as any;
      root = { ...rest, ...parsed };
    } catch {
      cleanedRaw = cleaned;
      root = cleaned;
    }
  }

  // Some aiGitaSnippet responses embed full sections JSON inside section1.raw.
  // Parse and merge that payload into root so downstream section extractors can
  // use the same standard path for sections 1-5.
  if (root && typeof root === "object") {
    const embeddedRawCandidates = [
      (root as any)?.section1?.raw,
      (root as any)?.section_1?.raw,
      (root as any)?.section1_raw,
      (root as any)?.sections?.["1"]?.raw,
      (root as any)?.sections?.section1?.raw,
    ];
    const embeddedRaw = embeddedRawCandidates.find((value) => typeof value === "string" && value.trim());
    if (typeof embeddedRaw === "string" && embeddedRaw.trim()) {
      const cleaned = cleanCodeFence(embeddedRaw);
      try {
        const parsedEmbedded = JSON.parse(cleaned);
        if (parsedEmbedded && typeof parsedEmbedded === "object") {
          const merged = { ...(root as any), ...(parsedEmbedded as any) } as any;
          // When API returns section1.raw containing a full {1..5} JSON payload,
          // remap explicit section nodes so downstream extractors don't read raw JSON text.
          ["1", "2", "3", "4", "5"].forEach((id) => {
            if (parsedEmbedded[id] !== undefined) {
              merged[`section${id}`] = parsedEmbedded[id];
              merged[`section_${id}`] = parsedEmbedded[id];
            }
          });
          if (!merged.sections || typeof merged.sections !== "object") {
            const sectionMap: Record<string, any> = {};
            ["1", "2", "3", "4", "5"].forEach((id) => {
              if (parsedEmbedded[id] !== undefined) sectionMap[id] = parsedEmbedded[id];
            });
            if (Object.keys(sectionMap).length) {
              merged.sections = { ...(merged.sections || {}), ...sectionMap };
            }
          }
          root = merged;
          if (!cleanedRaw) cleanedRaw = cleaned;
        }
      } catch {
        if (!cleanedRaw) cleanedRaw = cleaned;
      }
    }
  }

  return { root, cleanedRaw };
}

export function wrapRootForSection(root: any, sectionId: SectionId): any {
  if (!root || typeof root !== "object") {
    return root;
  }

  if (
    (root as any)[sectionId] &&
    !(root as any).shloka &&
    !(root as any).section1 &&
    !(root as any).section_1
  ) {
    return { section1: (root as any)[sectionId], ...root };
  }

  return root;
}

function makeFlattener(langKey: string) {
  function flattenToText(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string") return value.trim() || null;
    if (Array.isArray(value)) {
      const parts = value
        .map((v) => flattenToText(v))
        .filter((v): v is string => !!v);
      return parts.length ? parts.join("\n\n") : null;
    }
    if (typeof value === "object") {
      const preferredKeys = [
        "long_explanatory_narration",
        "long_explanation",
        `explanation_${langKey}`,
        "explanation_en",
        "explanation_hi",
        "explanation",
        "summary",
        "commentary",
        "Translation",
        "translation",
        "headline",
        "title",
        "text",
        "description",
        "narration",
        "english_translation",
      ];
      const excludedKeys = new Set([
        "raw",
        "data",
        "body",
        "payload",
        "payLoad",
        "sections",
        "sectionRange",
        "success",
        "cached",
        "message",
      ]);

      const collected: string[] = [];
      for (const key of preferredKeys) {
        if (typeof (value as any)[key] === "string") {
          collected.push((value as any)[key]);
        }
      }

      if (!collected.length) {
        for (const [key, v] of Object.entries(value)) {
          if (excludedKeys.has(key) || /^\d+$/.test(key)) continue;
          const flat = flattenToText(v);
          if (flat) collected.push(flat);
        }
      }

      return collected.length ? collected.join("\n\n") : null;
    }
    return null;
  }

  return flattenToText;
}

export function extractTextForSection(
  root: any,
  sectionId: SectionId,
  langKey: string
): string | null {
  if (!root) return null;

  if (typeof root === "string") {
    return root;
  }

  if (typeof root !== "object") return null;

  const flattenToText = makeFlattener(langKey);

  switch (sectionId) {
    case "1": {
      const sectionRoot =
        (root as any).section1 ||
        (root as any).section_1 ||
        (root as any).section_1_shloka ||
        (root as any).shloka ||
        ((root as any)[sectionId] && typeof (root as any)[sectionId] === "object"
          ? (root as any)[sectionId]
          : null) ||
        root;

      if (!sectionRoot) return null;
      if (typeof sectionRoot === "string") return sectionRoot;
      if (typeof sectionRoot !== "object") return null;

      const direct =
        (sectionRoot as any)[`translation_${langKey}`] ||
        (sectionRoot as any).english_translation ||
        (sectionRoot as any).Translation ||
        (sectionRoot as any).translation ||
        (sectionRoot as any).translation_hi ||
        (sectionRoot as any).translation_en ||
        (sectionRoot as any).summary ||
        (sectionRoot as any).commentary ||
        null;

      if (direct) return String(direct);

      if ((sectionRoot as any).Sanskrit || (sectionRoot as any).Translation) {
        return [
          (sectionRoot as any).Sanskrit,
          (sectionRoot as any).Translation,
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      return flattenToText(sectionRoot);
    }

    case "2": {
      const sectionRoot =
        (root as any).section2 ||
        (root as any).section_2 ||
        (root as any).section_2_youtube_link_image ||
        ((root as any)[sectionId] && typeof (root as any)[sectionId] === "object"
          ? (root as any)[sectionId]
          : null);

      if (!sectionRoot) return null;

      const ytNode =
        (sectionRoot as any).section_2_youtube_link_image || sectionRoot;
      const title =
        (ytNode as any).title ||
        (ytNode as any).heading ||
        (ytNode as any).name;
      const relevance =
        (ytNode as any).relevance ||
        (ytNode as any).description ||
        (ytNode as any).summary;

      if (title || relevance) {
        return [title, relevance].filter(Boolean).join("\n\n");
      }

      const scholars = (sectionRoot as any).scholars || sectionRoot;
      if (Array.isArray(scholars)) {
        const text = scholars
          .map((s: any) =>
            `${s.name ? `${s.name}\n` : ""}${
              s.narrative || s.comment || s.text || ""
            }`.trim()
          )
          .filter(Boolean)
          .join("\n\n");
        if (text) return text;
      }

      return flattenToText(sectionRoot);
    }

    case "3": {
      const sectionRoot =
        (root as any).section3 ||
        (root as any).section_3 ||
        ((root as any)[sectionId] && typeof (root as any)[sectionId] === "object"
          ? (root as any)[sectionId]
          : null);

      if (!sectionRoot) return null;
      if (typeof sectionRoot === "string") return sectionRoot;

      const s3: any = sectionRoot;

      const stories =
        s3.news_stories ||
        s3.regional_news_stories ||
        s3.stories ||
        (Array.isArray(sectionRoot) ? sectionRoot : []);

      if (Array.isArray(stories) && stories.length) {
        const text = stories
          .map((n: any) =>
            `${n.headline || n.title || ""} ${
              n.date || n.source
                ? `(${[n.date, n.source].filter(Boolean).join(", ")})`
                : ""
            }\n${n.summary || n.description || ""}\n${
              n.relation_to_shloka || n.relation || ""
            }`.trim()
          )
          .filter(Boolean)
          .join("\n\n");
        if (text) return text;
      }

      if (Array.isArray(s3.commentaries)) {
        const text = s3.commentaries
          .map(
            (c: any) =>
              `${c.commentator || ""}${
                c.credential ? ` – ${c.credential}` : ""
              }\n${c.explanation || ""}`.trim()
          )
          .filter(Boolean)
          .join("\n\n");
        if (text) return text;
      }

      return flattenToText(sectionRoot);
    }

    case "4": {
      const sectionRoot =
        (root as any).section4 ||
        (root as any).section_4 ||
        ((root as any)[sectionId] && typeof (root as any)[sectionId] === "object"
          ? (root as any)[sectionId]
          : null);

      if (!sectionRoot) return null;
      if (typeof sectionRoot === "string") return sectionRoot;

      const sectionNode: any = sectionRoot;
      const narrationText =
        sectionNode.narration ||
        sectionNode.Narration ||
        sectionNode.long_explanatory_narration ||
        null;
      if (narrationText) {
        return String(narrationText);
      }
      const locationText =
        sectionNode.location ||
        sectionNode.place ||
        sectionNode.context ||
        sectionNode.story ||
        null;

      if (locationText) {
        return String(locationText);
      }

      return flattenToText(sectionRoot);
    }

    case "5": {
      const sectionRoot =
        (root as any).section5 ||
        (root as any).section_5 ||
        ((root as any)[sectionId] && typeof (root as any)[sectionId] === "object"
          ? (root as any)[sectionId]
          : null);

      if (!sectionRoot) return null;
      if (typeof sectionRoot === "string") return sectionRoot;

      return flattenToText(sectionRoot);
    }

    default:
      return null;
  }
}
