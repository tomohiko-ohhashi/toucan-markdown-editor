import { create } from "zustand";
import type { ViewMode } from "./useDocStore";
import type { LanguageSetting } from "../i18n";
import { DEFAULT_PANEL_SIZES, type PanelSizes } from "../features/layout";

export type Theme = "system" | "light" | "dark";
/** How Enter behaves inside lists and quotes. */
export type ListContinuation = "shift" | "enter" | "off";
/** What to do when a URL is pasted over selected text. */
export type SmartPaste = "always" | "ask" | "off";

/** How the window looked when it was last closed (the open files themselves are in `lastOpenFiles`). */
export interface SessionState {
  /** Path of the tab that was in front, or null when it was an untitled document. */
  activeFile: string | null;
  showSidebar: boolean;
  showOutline: boolean;
  cheatSheetOpen: boolean;
  viewMode: ViewMode;
  typewriterMode: boolean;
  /** Cursor line (1-based) per open file. */
  cursors: Record<string, number>;
}

/** A document with changes that were not saved when the app was closed. */
export interface UnsavedDoc {
  /** File the changes belong to, or null for a document that was never saved. */
  path: string | null;
  content: string;
  /** The saved text the changes were made on; lets the next start notice that the file changed meanwhile. */
  base?: string;
}

export interface Settings {
  theme: Theme;
  /** UI language; "system" follows the OS (Japanese there, otherwise English). */
  language: LanguageSetting;
  editorFontSize: number;
  /** Font name picked in the settings ("" = default). Older versions stored a CSS font list here. */
  editorFontFamily: string;
  previewFontSize: number;
  previewFontFamily: string;
  tabSize: number;
  lineWrap: boolean;
  listContinuation: ListContinuation;
  /** Hide Markdown markup on lines the cursor is not on. */
  livePreview: boolean;
  smartPaste: SmartPaste;
  /**
   * Keep the editor and the preview level at the height of the cursor, and mark the cursor's
   * block in the preview. Off: the panes follow each other by how far they are scrolled.
   */
  levelPanes: boolean;
  /** Let the OS / browser underline spelling mistakes in the editor. */
  spellCheck: boolean;
  /** Seconds between autosaves of dirty documents that have a path; 0 disables. */
  autosaveSeconds: number;
  /** Restore the previous session (files, folder, layout) on start. */
  reopenLastFiles: boolean;
  checkUpdatesOnStartup: boolean;
  /** Keep unsaved changes when the app is closed and bring them back on the next start. */
  restoreUnsaved: boolean;
  /** With restoreUnsaved: close without asking. */
  quitWithoutAsking: boolean;
  /** The unsaved changes kept for the next start (only filled while restoreUnsaved is on). */
  unsavedDocs: UnsavedDoc[];
  recentFiles: string[];
  lastOpenFiles: string[];
  lastWorkspace: string | null;
  session: SessionState | null;
  /** Folders expanded in the workspace tree; kept so the tree looks the same after hiding the sidebar or restarting. */
  expandedDirs: string[];
  /** Widths of the side panels and the editor / preview split, set by dragging the dividers. */
  panelSizes: PanelSizes;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  language: "system",
  editorFontSize: 14,
  editorFontFamily: "",
  previewFontSize: 15,
  previewFontFamily: "",
  tabSize: 2,
  lineWrap: true,
  listContinuation: "shift",
  livePreview: false,
  smartPaste: "ask",
  levelPanes: true,
  spellCheck: false,
  autosaveSeconds: 0,
  reopenLastFiles: true,
  checkUpdatesOnStartup: true,
  restoreUnsaved: false,
  quitWithoutAsking: false,
  unsavedDocs: [],
  recentFiles: [],
  lastOpenFiles: [],
  lastWorkspace: null,
  session: null,
  expandedDirs: [],
  panelSizes: DEFAULT_PANEL_SIZES,
};

const MAX_RECENT = 12;
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface Backend {
  load(): Promise<Partial<Settings>>;
  save(s: Settings): Promise<void>;
  /** Make sure what was saved has reached the disk. */
  flush(): Promise<void>;
}

const localBackend: Backend = {
  async load() {
    try {
      return JSON.parse(localStorage.getItem("settings") ?? "{}");
    } catch {
      return {};
    }
  },
  async save(s) {
    try {
      localStorage.setItem("settings", JSON.stringify(s));
    } catch {
      /* ignore */
    }
  },
  async flush() {},
};

async function tauriBackend(): Promise<Backend> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json", { autoSave: 300, defaults: {} });
  return {
    async load() {
      return (await store.get<Settings>("settings")) ?? {};
    },
    async save(s) {
      await store.set("settings", s);
    },
    async flush() {
      await store.save();
    },
  };
}

let backend: Backend | null = null;

interface SettingsState extends Settings {
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
  /** Apply a change at once without saving it; saved by commitPreview(), undone by cancelPreview(). */
  preview: (patch: Partial<Settings>) => void;
  commitPreview: () => void;
  cancelPreview: () => void;
  addRecent: (path: string) => void;
  setDirExpanded: (path: string, expanded: boolean) => void;
  clearRecent: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    set(patch);
    void persist(get());
  },
  preview: (patch) => {
    const cur = get() as unknown as Record<string, unknown>;
    for (const key of Object.keys(patch)) if (!(key in unsaved)) unsaved[key] = cur[key];
    set(patch);
  },
  commitPreview: () => {
    unsaved = {};
    // Nothing in the store changes, but what counts as saved does: let subscribers know.
    set({});
    void persist(get());
  },
  cancelPreview: () => {
    const saved = unsaved;
    unsaved = {};
    if (Object.keys(saved).length > 0) set(saved as Partial<Settings>);
  },
  addRecent: (path) => {
    const recent = [path, ...get().recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT);
    set({ recentFiles: recent });
    void persist(get());
  },
  setDirExpanded: (path, expanded) => {
    const cur = get().expandedDirs;
    if (cur.includes(path) === expanded) return;
    set({ expandedDirs: expanded ? [...cur, path] : cur.filter((p) => p !== path) });
    void persist(get());
  },
  clearRecent: () => {
    set({ recentFiles: [] });
    void persist(get());
  },
}));

/**
 * Settings changed in the settings dialog but not saved yet: key -> the saved
 * value. The store already holds the new values (so they show at once), and
 * this is what is written to disk in their place until the dialog is saved.
 * Other things are saved all the time (recent files, the session), and they
 * must not carry an unsaved preference along.
 */
let unsaved: Record<string, unknown> = {};

/** The saved value of a setting, ignoring a change that is only being previewed in the settings dialog. */
export function savedSetting<K extends keyof Settings>(key: K): Settings[K] {
  return (key in unsaved ? unsaved[key] : useSettings.getState()[key]) as Settings[K];
}

/** True when the settings dialog holds changes that have not been saved. */
export function hasUnsavedSettings(): boolean {
  const cur = useSettings.getState() as unknown as Record<string, unknown>;
  return Object.keys(unsaved).some((key) => unsaved[key] !== cur[key]);
}

function pick(s: SettingsState): Settings {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = k in unsaved ? unsaved[k] : s[k as keyof Settings];
  return out as unknown as Settings;
}

async function persist(s: SettingsState) {
  if (!backend) return;
  await backend.save(pick(s));
}

/** Write the settings and wait until they are on disk (before the window is closed). */
export async function flushSettings(): Promise<void> {
  if (!backend) return;
  await backend.save(pick(useSettings.getState()));
  await backend.flush();
}

/** Load the saved settings into the store and return them as they were on disk. */
export async function loadSettings(): Promise<Settings> {
  backend = inTauri ? await tauriBackend() : localBackend;
  const saved: Settings = { ...DEFAULT_SETTINGS, ...(await backend.load()) };
  useSettings.setState({ ...saved, loaded: true });
  return saved;
}

/** Apply the theme preference to the document root; "system" follows the OS. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
