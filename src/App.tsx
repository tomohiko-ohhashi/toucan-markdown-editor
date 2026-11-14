import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { handleDroppedPaths } from "./features/files/dropped";
import { Splitter } from "./components/Splitter";
import { normalizePanelSizes, panelCssVars } from "./features/layout";
import { platform, inTauri } from "./platform";
import { FilePicker } from "./components/FilePicker";
import { PromptDialog } from "./components/PromptDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FocusControls } from "./components/FocusControls";
import { searchBoxRef } from "./components/Sidebar";
import { Toolbar, MobileBar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { Sidebar } from "./components/Sidebar";
import { Outline } from "./components/Outline";
import { SettingsDialog } from "./components/SettingsDialog";
import { AboutDialog } from "./components/AboutDialog";
import { ImagePreview } from "./components/ImagePreview";
import { DiffPanel } from "./components/DiffPanel";
import { CheatSheet } from "./components/CheatSheet";
import { Editor } from "./editor/Editor";
import { Preview } from "./preview/Preview";
import { useDocStore, selectActiveDoc, selectActiveIsDirty, fileName } from "./store/useDocStore";
import { useSettings, applyTheme, loadSettings, savedSetting } from "./store/useSettings";
import { restoreSession, saveSessionNow, confirmQuit } from "./features/session";
import { resolveLanguage, setLanguage } from "./i18n";
import {
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs,
  closeDocument,
  checkExternalChanges,
  autosaveAll,
} from "./features/files/fileOps";
import { exportHtml, exportPdf, installPrintHooks } from "./features/export";
import { checkForUpdates } from "./features/updater";

export default function App() {
  const viewMode = useDocStore((s) => s.viewMode);
  const setViewMode = useDocStore((s) => s.setViewMode);
  const toggle = useDocStore((s) => s.toggle);
  const doc = useDocStore(selectActiveDoc);
  const dirty = useDocStore(selectActiveIsDirty);
  const showSidebar = useDocStore((s) => s.showSidebar);
  const showOutline = useDocStore((s) => s.showOutline);
  const cheatSheetOpen = useDocStore((s) => s.cheatSheetOpen);
  const focusMode = useDocStore((s) => s.focusMode);
  const diffOpen = useDocStore((s) => s.diffOpen) && !focusMode;
  const theme = useSettings((s) => s.theme);
  // Set while rendering, so everything below reads the chosen language in this same pass.
  const language = resolveLanguage(useSettings((s) => s.language));
  setLanguage(language);
  // The saved value: a number that is only being tried out in the settings dialog must not start writing files.
  const autosaveSeconds = useSettings(() => savedSetting("autosaveSeconds"));
  const panelSizes = useSettings((s) => s.panelSizes);

  // Load settings, then restore the previous session and check for updates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Use the returned snapshot: it is what was on disk, before this run changes anything.
      const s = await loadSettings();
      if (cancelled) return;
      await restoreSession(s);
      if (inTauri && s.checkUpdatesOnStartup) setTimeout(() => void checkForUpdates(true), 3000);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // Window title reflects the document and its dirty state.
  useEffect(() => {
    const title = `${dirty ? "● " : ""}${fileName(doc.path)} - Toucan Markdown Editor`;
    document.title = title;
    if (inTauri) getCurrentWindow().setTitle(title).catch(() => {});
  }, [doc.path, dirty, language]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useDocStore.getState();
      if (e.key === "F1") {
        e.preventDefault();
        return toggle("cheatSheetOpen");
      }
      if (e.key === "Escape") {
        // The cheat sheet is a side panel now and stays open; F1 toggles it.
        if (state.aboutOpen) toggle("aboutOpen");
        // In focus mode the changes view is hidden; Esc leaves focus mode first.
        else if (state.diffOpen && !state.focusMode) toggle("diffOpen");
        else if (state.settingsOpen) toggle("settingsOpen");
        else if (state.focusMode) toggle("focusMode");
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // None of these shortcuts use Alt. On Windows AltGr arrives as Ctrl+Alt and types characters
      // ("ń" is AltGr+N on a Polish keyboard, "@" AltGr+Q on a German one): typing must not run a command.
      if (e.altKey || e.getModifierState("AltGraph")) return;
      const code = e.code;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.ctrlKey && code === "Tab") {
        const i = state.docs.findIndex((d) => d.id === state.activeId);
        const n = (i + (e.shiftKey ? -1 : 1) + state.docs.length) % state.docs.length;
        return run(() => state.setActive(state.docs[n].id));
      }
      // Text size. Only in the desktop app: in a browser these keys are the browser's own zoom.
      // Matched by the character the key gives, so "+" works wherever the layout has it (Shift+; on a
      // Japanese keyboard).
      const zoom = !inTauri
        ? null
        : e.key === "+" || (e.key === "=" && !e.shiftKey) || code === "NumpadAdd"
          ? 1
          : (e.key === "-" && !e.shiftKey) || code === "NumpadSubtract"
            ? -1
            : e.key === "0" || (code === "Digit0" && !e.shiftKey) || code === "Numpad0"
              ? 0
              : null;
      if (zoom != null) {
        return run(() => {
          const s = useSettings.getState();
          const step = zoom;
          const size = (cur: number, def: number) => (step === 0 ? def : Math.max(9, Math.min(40, cur + step)));
          s.update({ editorFontSize: size(s.editorFontSize, 14), previewFontSize: size(s.previewFontSize, 15) });
        });
      }
      if (e.shiftKey) {
        if (code === "KeyS") return run(() => void saveDocumentAs());
        if (code === "KeyH") return run(() => void exportHtml());
        if (code === "KeyE") return run(() => toggle("showSidebar"));
        if (code === "KeyO") return run(() => toggle("showOutline"));
        if (code === "KeyD") return run(() => toggle("focusMode"));
        if (code === "KeyG") return run(() => toggle("diffOpen"));
        if (code === "KeyF")
          return run(() => {
            if (!state.showSidebar) toggle("showSidebar");
            setTimeout(() => searchBoxRef.el?.focus(), 50);
          });
        if (code === "KeyT") return run(() => toggle("typewriterMode"));
        if (code === "KeyL") return run(() => useSettings.getState().update({ levelPanes: !useSettings.getState().levelPanes }));
        if (code === "Slash") return run(() => toggle("cheatSheetOpen"));
        if (code === "Digit1") return run(() => setViewMode("editor"));
        if (code === "Digit2") return run(() => setViewMode("split"));
        if (code === "Digit3") return run(() => setViewMode("preview"));
        return;
      }
      if (code === "KeyS") return run(() => void saveDocument());
      if (code === "KeyO") return run(() => void openDocument());
      if (code === "KeyN") return run(() => newDocument());
      if (code === "KeyW") return run(() => void closeDocument());
      if (code === "KeyP") return run(() => void exportPdf());
      if (code === "Comma") return run(() => toggle("settingsOpen"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setViewMode, toggle]);

  useEffect(() => installPrintHooks(), []);

  // Browser: warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (inTauri) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useDocStore.getState().docs.some((d) => d.content !== d.savedContent)) return;
      // The text is kept for the next visit; only ask when the user wants to be asked.
      const keep = savedSetting("restoreUnsaved");
      if (keep) saveSessionNow();
      if (!(keep && savedSetting("quitWithoutAsking"))) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Ask before closing the window with unsaved changes.
  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      saveSessionNow();
      if (!useDocStore.getState().docs.some((d) => d.content !== d.savedContent)) return;
      event.preventDefault();
      if (await confirmQuit()) await win.destroy();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Files opened via the OS while running (macOS). Registered before the startup
  // drain below runs so an early Opened event is not missed.
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = listen<string[]>("open-files", async (e) => {
      for (const f of e.payload) await openDocument(f);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Files, images or a folder dragged onto the window. The desktop shell takes
  // these over from the page (which never sees a path), so they arrive as an event.
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const scale = window.devicePixelRatio || 1;
      const at = { x: e.payload.position.x / scale, y: e.payload.position.y / scale };
      void handleDroppedPaths(e.payload.paths, at);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Quit from the macOS menu (Cmd+Q) goes through the same unsaved-changes check.
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = listen("quit-requested", async () => {
      if (await confirmQuit()) {
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Detect changes made to open files by other programs.
  useEffect(() => {
    const id = setInterval(() => void checkExternalChanges(), platform.pollIntervalMs);
    const onFocus = () => void checkExternalChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Autosave.
  useEffect(() => {
    if (autosaveSeconds <= 0) return;
    const id = setInterval(() => void autosaveAll(), autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, [autosaveSeconds]);

  const effectiveMode = focusMode ? "editor" : viewMode;

  return (
    <div className={`app ${focusMode ? "focus" : ""}`}>
      <Toolbar />
      <TabBar />
      <div className="workbench" style={panelCssVars(normalizePanelSizes(panelSizes))}>
        {showSidebar && !focusMode && <Sidebar />}
        {showSidebar && !focusMode && <Splitter panel="sidebar" grow={1} />}
        {diffOpen && <DiffPanel />}
        {/* Kept mounted (hidden) under the changes view so the editor keeps its state. */}
        <main className={`panes mode-${effectiveMode}`} hidden={diffOpen}>
          <section className="pane pane-editor">
            <Editor />
          </section>
          {effectiveMode === "split" && <Splitter panel="split" grow={1} />}
          <section className="pane pane-preview">
            <Preview />
          </section>
        </main>
        {showOutline && !focusMode && <Splitter panel="outline" grow={-1} />}
        {showOutline && !focusMode && <Outline />}
        {cheatSheetOpen && !focusMode && <Splitter panel="cheatSheet" grow={-1} />}
        {cheatSheetOpen && !focusMode && <CheatSheet />}
      </div>
      <StatusBar />
      <MobileBar />
      <SettingsDialog />
      <AboutDialog />
      <ImagePreview />
      <FilePicker />
      <PromptDialog />
      <ConfirmDialog />
      <FocusControls />
    </div>
  );
}
