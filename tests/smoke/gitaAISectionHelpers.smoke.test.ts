import {
  extractNarrationFromRaw,
  extractTextForSection,
  normalizeGitaAIRoot,
} from "../../utils/gitaAISectionHelpers";

describe("gitaAISectionHelpers smoke", () => {
  test("parses fenced raw json into root object", () => {
    const input = {
      raw: "```json\n{\"section1\":{\"translation_en\":\"Duty first.\"}}\n```",
    };
    const parsed = normalizeGitaAIRoot(input);
    expect(parsed.cleanedRaw).toBeNull();
    expect(parsed.root.section1.translation_en).toBe("Duty first.");
  });

  test("extracts section 1 text from normalized object", () => {
    const text = extractTextForSection(
      { section1: { translation_en: "Stay steady in action." } },
      "1",
      "en"
    );
    expect(text).toBe("Stay steady in action.");
  });

  test("extracts narration text for section 4", () => {
    const raw = '{"narration":"Line 1\\nLine 2"}';
    expect(extractNarrationFromRaw(raw, "4")).toBe("Line 1\nLine 2");
  });

  test("treats pending envelope with null data as empty", () => {
    const parsed = normalizeGitaAIRoot({
      success: true,
      cached: false,
      data: null,
      message: "Please wait, building AI response in progress.",
    });
    expect(parsed.cleanedRaw).toBeNull();
    expect(parsed.root).toBeNull();
  });
});
