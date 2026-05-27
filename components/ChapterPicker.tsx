import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ChapterNavigator from "./ChapterNavigator";
import { useVerseSelection } from "../context/VerseSelectionContext";

type ChapterItem = {
  chapter: number;
  title?: string;
};

const DEFAULT_TITLES = [
  "Arjuna Vishāda-yoga",
  "Sāṃkhya-yoga",
  "Karma-yoga",
  "Jnāna-yoga",
  "Karma-sannyāsa-yoga",
  "Dhyāna-yoga",
  "Jnana-vijnana-yoga",
  "Aśṭādaśa-sāhasra-yoga",
  "Rājavidyā-raja-guhya-yoga",
  "Vibhūti-yoga",
  "Viśvarūpa-darśana-yoga",
  "Bhakti-yoga",
  "Kṣitra-kṣetrajña-vibhāga-yoga",
  "Guṇa-traya-vibhāga-yoga",
  "Puruṣottama-yoga",
  "Daivasura-sampad-vibhāga-yoga",
  "Śraddhā-traya-vibhāga-yoga",
  "Mokṣa-sannyāsa-yoga",
];

const DEFAULT_VERSE_COUNTS = [
  47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78,
];

const buildDefaultChapters = (): ChapterItem[] =>
  DEFAULT_TITLES.map((title, index) => ({
    chapter: index + 1,
    title,
  }));

export default function ChapterPicker(): React.ReactElement | null {
  const { selection, updateSelection } = useVerseSelection();
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentChapter, setCurrentChapter] = useState(selection.chapter);
  const [inputValue, setInputValue] = useState(String(selection.chapter));
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [verse, setVerse] = useState(selection.verse);
  const [verseDropdownOpen, setVerseDropdownOpen] = useState(false);

  const selectedChapter = useMemo(() => {
    return (
      chapters.find((item) => item.chapter === currentChapter) ??
      chapters[0] ??
      null
    );
  }, [chapters, currentChapter]);

  const verseCount = useMemo(() => {
    if (chapters.length && selectedChapter) {
      const chap = DEFAULT_VERSE_COUNTS[selectedChapter.chapter - 1];
      return chap ?? DEFAULT_VERSE_COUNTS[0];
    }
    return DEFAULT_VERSE_COUNTS[0];
  }, [selectedChapter]);

  const verseOptions = useMemo(() => {
    return Array.from({ length: verseCount }, (_, i) => i + 1);
  }, [verseCount]);

  useEffect(() => {
    setCurrentChapter(selection.chapter);
    setInputValue(String(selection.chapter));
    setVerse(selection.verse);
  }, [selection.chapter, selection.verse]);

  useEffect(() => {
    let clamped = verse;
    if (verse > verseCount) {
      clamped = verseCount;
    } else if (verse < 1) {
      clamped = 1;
    }
    if (clamped !== verse) {
      setVerse(clamped);
      updateSelection((prev) => ({ chapter: prev.chapter, verse: clamped }));
    }
  }, [updateSelection, verse, verseCount]);

  useEffect(() => {
    setChapters(buildDefaultChapters());
    setLoading(false);
  }, []);

  const changeChapter = useCallback(
    (chapter: number) => {
      setCurrentChapter(chapter);
      setInputValue(String(chapter));
      setVerse(1);
      updateSelection({ chapter, verse: 1 });
    },
    [updateSelection]
  );

  const changeVerse = useCallback(
    (value: number) => {
      setVerse(value);
      updateSelection((prev) => ({
        chapter: prev.chapter,
        verse: value,
      }));
    },
    [updateSelection]
  );

  const handleJump = useCallback(
    (value: string) => {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return;
      const maxChapter = chapters[chapters.length - 1]?.chapter || num;
      changeChapter(Math.min(num, maxChapter));
    },
    [chapters, changeChapter]
  );

  const handleFirst = () => {
    if (!chapters.length) return;
    changeChapter(chapters[0].chapter);
  };
  const handlePrev = () => {
    if (!chapters.length) return;
    const currentIdx = chapters.findIndex((item) => item.chapter === selectedChapter?.chapter);
    if (currentIdx > 0) {
      changeChapter(chapters[currentIdx - 1].chapter);
    }
  };
  const handleNext = () => {
    if (!chapters.length) return;
    const currentIdx = chapters.findIndex((item) => item.chapter === selectedChapter?.chapter);
    if (currentIdx < chapters.length - 1) {
      changeChapter(chapters[currentIdx + 1].chapter);
    }
  };
  const handleLast = () => {
    if (!chapters.length) return;
    changeChapter(chapters[chapters.length - 1].chapter);
  };

  const handleVerseFirst = () => changeVerse(1);
  const handleVersePrev = () => changeVerse(Math.max(1, verse - 1));
  const handleVerseNext = () => changeVerse(Math.min(verseCount, verse + 1));
  const handleVerseLast = () => changeVerse(verseCount);

  if (loading && !chapters.length) {
    return (
      <View className="px-4 py-3">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="px-4 py-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Chapter
      </Text>
      <Text className="text-sm font-medium text-slate-700 mb-2">
        {selectedChapter
          ? `${selectedChapter.chapter}. ${selectedChapter.title ?? ""}`
          : "Select chapter"}
      </Text>
      <Pressable
        onPress={() => setDropdownOpen(true)}
        style={styles.selector}
        className="mb-3 flex-row items-center justify-between"
      >
        <View>
          <Text className="text-sm font-semibold text-slate-900">
            {selectedChapter ? `${selectedChapter.chapter}` : inputValue}
          </Text>
          <Text className="text-xs text-slate-500">Choose chapter</Text>
        </View>
        <Text className="text-sm text-slate-500">▾</Text>
      </Pressable>
      <Modal visible={dropdownOpen} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
          <View style={styles.dropdown}>
            <ScrollView>
              {chapters.map((chapter) => (
                <Pressable
                  key={chapter.chapter}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    pressed && styles.dropdownItemActive,
                    chapter.chapter === selectedChapter?.chapter && styles.dropdownItemSelected,
                  ]}
                  onPress={() => {
                    changeChapter(chapter.chapter);
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownText}>
                    {chapter.chapter}. {chapter.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <ChapterNavigator
        onFirst={handleFirst}
        onPrev={handlePrev}
        onNext={handleNext}
        onLast={handleLast}
        onInputChange={setInputValue}
        inputValue={inputValue}
        onJump={handleJump}
        hideInput
        buttonStyle={{
          backgroundColor: "#0f172a",
          borderRadius: 999,
          paddingHorizontal: 6,
          paddingVertical: 6,
          marginHorizontal: 2,
          minWidth: 28,
          alignItems: "center",
          justifyContent: "center",
        }}
        buttonDisabledStyle={{
          opacity: 0.5,
        }}
        jumpInputStyle={{
          borderWidth: 0,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 6,
          width: 44,
          textAlign: "center",
          color: "#111827",
          backgroundColor: "#f8fafc",
          fontWeight: "600",
        }}
        containerStyle={{
          backgroundColor: "#1f2937",
          borderRadius: 999,
          paddingHorizontal: 4,
          flexWrap: "wrap",
        }}
      />
      <View className="mt-3 flex-row flex-wrap gap-2">
        {(chapters.length ? chapters : DEFAULT_TITLES.map((title, idx) => ({ chapter: idx + 1, title })))
          .slice(0, 18)
          .map((chapter) => (
            <Pressable
              key={chapter.chapter}
              style={[
                styles.chapterButton,
                chapter.chapter === selectedChapter?.chapter && styles.chapterButtonActive,
              ]}
              onPress={() => changeChapter(chapter.chapter)}
            >
              <Text
                style={[
                  styles.chapterButtonText,
                  chapter.chapter === selectedChapter?.chapter && { color: "#1f2937" },
                ]}
              >
                {chapter.chapter}
              </Text>
            </Pressable>
          ))}
      </View>
      <View className="mt-6">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Verse
          </Text>
          <Pressable onPress={() => setVerseDropdownOpen(true)}>
            <Text className="text-xs text-slate-500">Choose verse ▾</Text>
          </Pressable>
        </View>
        <Text className="text-sm text-slate-700 mb-2">Verse {verse}</Text>
        <ChapterNavigator
          onFirst={handleVerseFirst}
          onPrev={handleVersePrev}
          onNext={handleVerseNext}
          onLast={handleVerseLast}
          onInputChange={setInputValue}
          inputValue={inputValue}
          onJump={handleJump}
          hideInput
          buttonStyle={{
            backgroundColor: "#1d4ed8",
            borderRadius: 999,
            paddingHorizontal: 6,
            paddingVertical: 6,
            marginHorizontal: 2,
            minWidth: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
          buttonDisabledStyle={{
            opacity: 0.5,
          }}
          jumpInputStyle={{
            borderWidth: 0,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
            width: 44,
            textAlign: "center",
            color: "#111827",
            backgroundColor: "#f8fafc",
            fontWeight: "600",
          }}
          containerStyle={{
            backgroundColor: "#0f172a",
            borderRadius: 999,
            paddingHorizontal: 4,
            flexWrap: "wrap",
            marginTop: 6,
          }}
        />
        <View className="mt-3 flex-row flex-wrap gap-2" style={styles.verseRow}>
          {verseOptions.map((num) => (
            <Pressable
              key={`verse-${num}`}
              style={[
                styles.verseButton,
                num === verse && styles.verseButtonActive,
              ]}
              onPress={() => changeVerse(num)}
            >
              <Text
                style={[
                  styles.verseButtonText,
                  num === verse && { color: "#fff" },
                ]}
              >
                {num}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Modal visible={verseDropdownOpen} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setVerseDropdownOpen(false)}
        >
          <View style={styles.dropdown}>
            <ScrollView>
              {verseOptions.map((num) => (
                <Pressable
                  key={`verse-item-${num}`}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    pressed && styles.dropdownItemActive,
                    num === verse && styles.dropdownItemSelected,
                  ]}
                  onPress={() => {
                    changeVerse(num);
                    setVerseDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownText}>{`Verse ${num}`}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  selector: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f1f5ff",
    shadowColor: "#3b82f6",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    minWidth: 160,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "transparent",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 160,
    paddingRight: 16,
    paddingLeft: 16,
    paddingBottom: 16,
  },
  dropdown: {
    width: "auto",
    minWidth: 200,
    maxWidth: 260,
    maxHeight: "60%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 8,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  dropdownItemActive: {
    backgroundColor: "#f1f5f9",
  },
  dropdownItemSelected: {
    backgroundColor: "#e0e7ff",
  },
  dropdownText: {
    fontSize: 14,
    color: "#0f172a",
  },
  chapterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f1f5ff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cbd5f5",
  },
  chapterButtonActive: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  chapterButtonText: {
    color: "#1d4ed8",
    fontWeight: "600",
    fontSize: 16,
  },
  verseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e0e7ff",
    alignItems: "center",
    justifyContent: "center",
    flexBasis: "22%",
    flexGrow: 1,
  },
  verseButtonActive: {
    backgroundColor: "#0f172a",
  },
  verseButtonText: {
    color: "#0f172a",
    fontWeight: "600",
  },
  verseRow: {
    justifyContent: "space-between",
  },
});
