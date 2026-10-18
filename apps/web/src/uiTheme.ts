import { create } from "zustand";

type PanelTheme = "light" | "dark";
const storageKey = "house:panel-theme";
function initialTheme(): PanelTheme {
  try {
    return localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Device preference; independent of scene lighting and accepted room edits. */
export const usePanelTheme = create<{ theme: PanelTheme; toggle: () => void }>(
  (set) => ({
    theme: initialTheme(),
    toggle: () =>
      set(({ theme }) => {
        const next = theme === "light" ? "dark" : "light";
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          /* Still usable without storage. */
        }
        return { theme: next };
      }),
  }),
);
