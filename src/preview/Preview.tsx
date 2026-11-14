import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fontFamilyCss, SANS_FALLBACK } from "../features/fonts";
import { renderMarkdown } from "./markdown";
import { useDocStore, selectActiveDoc, dirName } from "../store/useDocStore";
import { useSettings, isDarkTheme } from "../store/useSettings";
import { attachPreview, previewRendered, alignPreview, bringEditorTo, levelsPanes, setLevelPanes, pauseFollowing } from "./scrollSync";
import { openDocument } from "../features/files/fileOps";
import { joinPath, isAbsolutePath } from "./paths";
import { platform } from "../platform";
import { scrollPreviewToLine } from "../features/reveal";
import { toggleTaskAtLine } from "../editor/tasks";
import { cursorLine, goToLine } from "../editor/Editor";

/**
 * Links in the rendered HTML must not navigate the webview itself:
 * external URLs open in the system browser, #anchors scroll the preview,
 * and relative Markdown links open the target file in a tab.
 */
/** 1-based source line of the block an element of the preview belongs to. */
function sourceLineOf(el: HTMLElement): number | null {
  const line = Number(el.closest<HTMLElement>("[data-line]")?.dataset.line);
  return Number.isFinite(line) && line > 0 ? line : null;
}

async function onPreviewClick(e: React.MouseEvent<HTMLDivElement>, docPath: string | null) {
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    // Tick the task in the source; the preview follows from there. If the
    // line cannot be found, leave the box as it was.
    const line = sourceLineOf(target);
    if (line == null || !toggleTaskAtLine(line)) e.preventDefault();
    return;
  }
  const a = target.closest("a");
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  e.preventDefault();
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const target = e.currentTarget.querySelector(`[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: "start" });
    return;
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    await platform.openExternal(href).catch(() => {});
    return;
  }
  if (/\.(md|markdown|mdown|mkd|txt)(#.*)?$/i.test(href)) {
    const rel = href.replace(/#.*$/, "");
    let decoded = rel;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      /* use raw */
    }
    const abs = isAbsolutePath(decoded) ? decoded : docPath != null ? joinPath(dirName(docPath), decoded) : null;
    if (abs) void openDocument(abs);
  }
}

/** Set by the preview: render the active document now and resolve when it is on screen. */
let renderNow: (() => Promise<void>) | null = null;

/**
 * Wait until the preview shows the current text (printing needs it). While the preview is
 * hidden it is only brought up to date now and then, so that typing does not wait for it.
 */
export function previewReady(): Promise<void> {
  const done = renderNow?.() ?? Promise.resolve();
  // Never hold up the caller for long: a render that is dropped (the tab changed) would not report back.
  return Promise.race([done, new Promise<void>((r) => setTimeout(r, 8000))]);
}

export function Preview() {
  const doc = useDocStore(selectActiveDoc);
  const theme = useSettings((s) => s.theme);
  const previewFontSize = useSettings((s) => s.previewFontSize);
  const previewFont = useSettings((s) => s.previewFontFamily);
  const [html, setHtml] = useState("");
  /** Bumped after every finished render; `rendered` is the text that render was for. */
  const [renderTick, setRenderTick] = useState(0);
  const rendered = useRef<string | null>(null);
  const reveal = useDocStore((s) => s.reveal);
  const viewMode = useDocStore((s) => s.viewMode);
  const prevMode = useRef(viewMode);
  /** The preview is not on screen: editor only, focus mode, or the changes view in front. */
  const hidden = useDocStore((s) => s.viewMode === "editor" || s.focusMode || s.diffOpen);
  /** A caller waiting for an up-to-date preview (see previewReady). */
  const waiting = useRef<(() => void)[]>([]);
  const [forced, setForced] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? attachPreview(ref.current) : undefined), []);
  const levelPanes = useSettings((s) => s.levelPanes);
  useEffect(() => setLevelPanes(levelPanes), [levelPanes]);
  const [systemDark, setSystemDark] = useState(() => isDarkTheme());

  // Re-render Mermaid diagrams when the OS theme flips while following "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(isDarkTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Rendering waits for a short pause in typing, but another tab is shown at
  // once, and during a long burst of typing the preview still catches up every
  // now and then instead of standing still until the burst ends.
  const timing = useRef({ shownDoc: null as string | null, pendingSince: null as number | null, seq: 0, applied: 0, cost: 0 });
  const activeId = useRef(doc.id);
  activeId.current = doc.id;
  useEffect(() => {
    renderNow = () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setForced((n) => n + 1);
      });
    return () => {
      renderNow = null;
    };
  }, []);
  useEffect(() => {
    const t = timing.current;
    const now = Date.now();
    const answer = () => waiting.current.splice(0).forEach((resolve) => resolve());
    if (waiting.current.length > 0 && rendered.current === doc.content && t.shownDoc === doc.id) {
      answer();
      return;
    }
    t.pendingSince ??= now;
    // A render takes the main thread for `cost` ms, during which nothing typed appears. So the
    // pause in typing that is waited for grows with the document: a short one is rendered
    // 120 ms after the last key, a very long one only once the writer really stops, and during
    // a long burst it still catches up now and then. Out of sight, it only follows at leisure.
    const maxWait = Math.max(500, t.cost * 8);
    const pause = hidden ? Math.max(1500, t.cost * 2) : Math.max(120, t.cost);
    const delay =
      waiting.current.length > 0 || t.shownDoc !== doc.id ? 0 : hidden ? pause : Math.min(pause, Math.max(0, maxWait - (now - t.pendingSince)));
    const timer = setTimeout(() => {
      t.pendingSince = null;
      const content = doc.content;
      const id = doc.id;
      const seq = ++t.seq;
      const started = Date.now();
      void renderMarkdown(content, {
        docDir: doc.path != null ? dirName(doc.path) : null,
        sourceLines: true,
        mermaid: true,
        dark: isDarkTheme(),
      }).then((h) => {
        t.cost = Date.now() - started;
        // A newer render already landed, or the user moved to another tab meanwhile.
        if (seq < t.applied || activeId.current !== id) return;
        t.applied = seq;
        t.shownDoc = id;
        setHtml(h);
        rendered.current = content;
        setRenderTick((n) => n + 1);
        // What follows a render (levelling the panes, answering whoever waits) is done once React
        // has put the HTML on screen: see the layout effect below.
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [doc.id, doc.content, doc.path, theme, systemDark, hidden, forced]);

  // The new HTML is in the document now (not merely asked for): the preview shows the current text.
  useLayoutEffect(() => {
    if (renderTick === 0) return;
    previewRendered();
    waiting.current.splice(0).forEach((resolve) => resolve());
  }, [renderTick]);

  // Jump requested by the outline / search: wait until this document's HTML is on screen.
  useEffect(() => {
    if (!reveal || !ref.current) return;
    if (rendered.current !== doc.content) return;
    const el = ref.current;
    const line = reveal.line;
    useDocStore.setState({ reveal: null });
    // With the editor next to it, the preview goes level with the editor (which is moving to that
    // line right now, hence the wait). On its own, it shows the block at the top.
    if (!levelsPanes()) {
      pauseFollowing(400);
      scrollPreviewToLine(el, line);
    } else requestAnimationFrame(() => requestAnimationFrame(() => alignPreview() || scrollPreviewToLine(el, line)));
  }, [reveal, renderTick, doc.content]);

  // Coming from editor-only: the preview was hidden, so show the block the cursor is in.
  useEffect(() => {
    const was = prevMode.current;
    prevMode.current = viewMode;
    if (was !== "editor" || viewMode === "editor") return;
    // Through the same request the outline uses: it waits until the current text has been rendered,
    // which may still be under way when the preview was hidden a moment ago.
    useDocStore.setState({ reveal: { line: cursorLine(), seq: -Date.now() } });
  }, [viewMode]);

  return (
    <div
      ref={ref}
      className={`preview markdown-body${levelPanes && viewMode === "split" ? " show-cursor" : ""}`}
      style={{ fontSize: previewFontSize, fontFamily: fontFamilyCss(previewFont, SANS_FALLBACK) ?? undefined }}
      onClick={(e) => void onPreviewClick(e, doc.path)}
      // A middle click on a link would open it in a new browser tab, past the handler above:
      // a relative link then loads a second copy of the whole app.
      onAuxClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) e.preventDefault();
      }}
      onDoubleClick={(e) => {
        // Find this spot in the source: the editor cursor moves to the block's line.
        const line = sourceLineOf(e.target as HTMLElement);
        if (line == null) return;
        // The cursor goes to that line; the editor then comes level with the preview, which stays put.
        if (!levelsPanes()) {
          pauseFollowing(700);
          return goToLine(line, false);
        }
        goToLine(line, false, false);
        bringEditorTo(line);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
