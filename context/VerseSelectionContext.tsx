import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import storage from "../auth/utils/storage";

export type VerseSelection = {
  chapter: number;
  verse: number;
};

type SelectionUpdater = VerseSelection | ((prev: VerseSelection) => VerseSelection);

type VerseSelectionValue = {
  selection: VerseSelection;
  updateSelection: (updater: SelectionUpdater) => void;
};

const CHAPTER_SELECTION_KEY = "@gitaVerse/selectedChapter";

const defaultSelection: VerseSelection = { chapter: 1, verse: 1 };

const VerseSelectionContext =
  createContext<VerseSelectionValue | undefined>(undefined);

export function useVerseSelection(): VerseSelectionValue {
  const context = useContext(VerseSelectionContext);
  if (!context) {
    throw new Error("useVerseSelection must be used within a VerseSelectionProvider");
  }
  return context;
}

export function VerseSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<VerseSelection>(defaultSelection);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await storage.getItem(CHAPTER_SELECTION_KEY);
        if (!active || !raw) return;
        const parsed = JSON.parse(raw);
        if (
          parsed?.chapter &&
          parsed?.verse &&
          Number.isFinite(parsed.chapter) &&
          Number.isFinite(parsed.verse)
        ) {
          setSelection({
            chapter: Math.max(1, Number(parsed.chapter)),
            verse: Math.max(1, Number(parsed.verse)),
          });
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const updateSelection = useCallback((updater: SelectionUpdater) => {
    setSelection((prev) => {
      const next =
        typeof updater === "function" ? updater(prev) : updater;
      storage
        .setItem(CHAPTER_SELECTION_KEY, JSON.stringify(next))
        .catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ selection, updateSelection }),
    [selection, updateSelection]
  );

  return (
    <VerseSelectionContext.Provider value={value}>
      {children}
    </VerseSelectionContext.Provider>
  );
}
