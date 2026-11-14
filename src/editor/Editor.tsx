import { useEffect, useRef } from "react";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches, setSearchQuery, SearchQuery } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { useDocStore, selectActiveDoc, flashStatus } from "../store/useDocStore";
import { useSettings } from "../store/useSettings";
import { baseTheme, markdownHighlight } from "./theme";
import { toggleBold, toggleItalic, toggleCode, insertLink, setHeading } from "./formatting";
import { attachEditor, editorScrolled, cursorMoved, previewIsBehind, pauseFollowing } from "../preview/scrollSync";
import { handlePaste, handleDrop } from "./images";
import { inTauri } from "../platform";
import { typewriterScrolling, tabSizeExt, fullWidthHeadingFix, plainHtmlTags } from "./extensions";
import { tableNextCell, tablePrevCell } from "./table";
import { listKeymap, indentListItem, outdentListItem } from "./listContinuation";
import { formatDocument } from "./format";
import { livePreview } from "./livePreview";
import { handleSmartPaste } from "./smartPaste";
import { fontFamilyCss, MONO_FALLBACK } from "../features/fonts";
import { noteCursor, takeRestoredCursor, lineOffset } from "../features/session";
import type { ListContinuation } from "../store/useSettings";
import { t, getLanguage } from "../i18n";

/** Japanese labels for CodeMirror's own UI (search panel, go-to-line). Its built-in text is English. */
const JA_PHRASES: Record<string, string> = {
  Find: "検索",
  Replace: "置換後の文字列",
  next: "次へ",
  previous: "前へ",
  all: "すべて選択",
  "match case": "大文字と小文字を区別",
  regexp: "正規表現",
  "by word": "単語単位",
  replace: "置換",
  "replace all": "すべて置換",
  close: "閉じる",
  "current match": "現在の一致",
  "replaced $ matches": "$ 件を置換しました",
  "replaced match on line $": "$ 行目を置換しました",
  "on line": "行",
  "Go to line": "行へ移動",
  go: "移動",
};

/** Everything in the editor that is written in the UI language. */
const languageExtensions = () => [
  EditorState.phrases.of(getLanguage() === "ja" ? JA_PHRASES : {}),
  placeholder(t("ここに Markdown を書きます。書き方は F1 のチートシートで確認できます。")),
];

/**
 * The search panel does not pass the "literal" setting on for what is typed into it, so a
 * query that is not a regular expression is made literal here, on its way into the editor.
 */
const literalSearch = EditorState.transactionFilter.of((tr) => {
  const typed = tr.effects.find((e) => e.is(setSearchQuery) && !e.value.literal && !e.value.regexp);
  if (!typed) return tr;
  const q = typed.value as SearchQuery;
  const literal = new SearchQuery({ search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, literal: true });
  return [tr, { effects: setSearchQuery.of(literal), sequential: true }];
});

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Shared view so toolbar buttons and the outline can reach the editor. */
export const editorRef: { view: EditorView | null } = { view: null };

const lineWrap = new Compartment();
const tabSize = new Compartment();
const typewriter = new Compartment();
const listKeys = new Compartment();
const preview = new Compartment();
const uiLanguage = new Compartment();
const spelling = new Compartment();
const spellingExt = (on: boolean) => EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false" });

/** Editor state (undo history, selection, scroll) is kept per tab. */
const states = new Map<string, EditorState>();

function baseExtensions(opts: {
  lineWrap: boolean;
  tabSize: number;
  typewriter: boolean;
  listContinuation: ListContinuation;
  livePreview: boolean;
}) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    // No indentOnInput(): it re-indents a line by the rules of the language around the cursor while
    // typing ("}" or "</div>" in a code block), which changes text the writer laid out by hand.
    // Search for what is typed. By default "\n", "\t" and "\\" in the search and replace boxes stand for
    // a line break, a tab and a backslash even with "regexp" off: "\theta" was not found, and
    // replacing with it wrote a tab followed by "heta".
    search({ literal: true }),
    literalSearch,
    uiLanguage.of(languageExtensions()),
    spelling.of(spellingExt(useSettings.getState().spellCheck)),
    highlightSelectionMatches(),
    lineWrap.of(opts.lineWrap ? EditorView.lineWrapping : []),
    tabSize.of([tabSizeExt(opts.tabSize), indentUnit.of(" ".repeat(opts.tabSize))]),
    typewriter.of(opts.typewriter ? typewriterScrolling : []),
    // List/quote continuation must come before the default keymap's Enter binding.
    listKeys.of(keymap.of(listKeymap(opts.listContinuation))),
    // addKeymap: false — lang-markdown's own Enter binding (always continues
    // lists) would override the user's list-continuation setting.
    // pasteURLAsLink off: the Markdown package would turn every URL pasted over a selection into a link
    // before our own handler runs, so the "ask / always / off" setting never had a say.
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, pasteURLAsLink: false, htmlTagLanguage: plainHtmlTags }),
    preview.of(opts.livePreview ? livePreview : []),
    fullWidthHeadingFix,
    baseTheme,
    markdownHighlight,
    keymap.of([
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-e", run: toggleCode },
      { key: "Mod-k", run: insertLink },
      {
        // Mod+1..3 by the position of the key, like the app's own shortcuts (Mod+Shift+1..3 are the
        // view modes). Matched by character, a keyboard that needs Shift for digits ran both.
        any: (view, e) => {
          const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
          const level = ["Digit1", "Digit2", "Digit3"].indexOf(e.code) + 1;
          if (!mod || e.shiftKey || e.altKey || level === 0) return false;
          return setHeading(level)(view);
        },
      },
      // The app's shortcut for the changes view (handled in App.tsx). Claimed here so
      // the editor's own binding for it, "find previous", does not open the search panel too.
      { key: "Mod-Shift-g", run: () => true },
      {
        key: "Shift-Alt-f",
        run: (view) => {
          void formatDocument(view).then((changed) => {
            if (changed) flashStatus(t("ドキュメントを整形しました"));
          });
          return true;
        },
      },
      { key: "Tab", run: tableNextCell, shift: tablePrevCell },
      { key: "Tab", run: indentListItem, shift: outdentListItem },
      indentWithTab,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      const id = currentDocId;
      if (u.docChanged && id) useDocStore.getState().setContent(id, u.state.doc.toString());
      // The cursor went to the first line (Mod+Home, Page Up): show the very top. The editor itself
      // stops with the line at the top edge, which leaves the space above the text scrolled away.
      if (u.selectionSet && !useDocStore.getState().typewriterMode && u.state.doc.lineAt(u.state.selection.main.head).number === 1) {
        const view = u.view;
        requestAnimationFrame(() => {
          const scroller = view.scrollDOM;
          if (scroller.scrollTop > 0 && scroller.scrollTop <= view.documentPadding.top + 4) scroller.scrollTop = 0;
        });
      }
      // The preview follows the cursor: it is level with it, and marks the block it is in.
      if (u.docChanged) previewIsBehind();
      // Only for what is done in the editor. A change that comes from elsewhere (a task ticked in
      // the preview) must not pull the preview to the cursor while the reader is busy in it.
      if (u.selectionSet || u.geometryChanged || (u.docChanged && u.view.hasFocus)) cursorMoved();
      if ((u.selectionSet || u.docChanged) && id) {
        // Remembered so the next start can put the cursor back.
        const path = useDocStore.getState().docs.find((d) => d.id === id)?.path ?? null;
        noteCursor(path, u.state.doc.lineAt(u.state.selection.main.head).number);
        publishCursor(u.state);
      }
    }),
    EditorView.domEventHandlers({
      scroll: () => editorScrolled(),
      paste: (e, view) => handlePaste(e, view) || handleSmartPaste(e, view),
      // On the desktop, dropped files arrive through the shell instead (see App.tsx).
      drop: (e, view) => !inTauri && handleDrop(e, view),
    }),
  ];
}

let currentDocId: string | null = null;

function createState(content: string, cursor = 0) {
  const s = useSettings.getState();
  const tw = useDocStore.getState().typewriterMode;
  return EditorState.create({
    doc: content,
    selection: { anchor: cursor },
    extensions: baseExtensions({
      lineWrap: s.lineWrap,
      tabSize: s.tabSize,
      typewriter: tw,
      listContinuation: s.listContinuation,
      livePreview: s.livePreview,
    }),
  });
}

/** Cursor position and selection size for the status bar. */
function publishCursor(state: EditorState) {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  // Count characters as the status bar does (a surrogate pair is one character).
  const count = (from: number, to: number) => (from === to ? 0 : Array.from(state.sliceDoc(from, to)).length);
  const next = { line: line.number, col: count(line.from, sel.head) + 1, selected: count(sel.from, sel.to) };
  const cur = useDocStore.getState().cursor;
  if (cur.line !== next.line || cur.col !== next.col || cur.selected !== next.selected) {
    useDocStore.setState({ cursor: next });
  }
}

/** Have the preview scroll to a source line once it has rendered the active document. */
function showInPreview(line: number) {
  pauseFollowing(700);
  useDocStore.setState({ reveal: { line, seq: -Date.now() } });
}

/** State for a tab shown for the first time; a file from the previous session gets its cursor back. */
function freshState(doc: { path: string | null; content: string }) {
  const line = takeRestoredCursor(doc.path);
  return createState(doc.content, line != null ? lineOffset(doc.content, line) : 0);
}

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const doc = useDocStore(selectActiveDoc);
  const docIds = useDocStore((s) => s.docs.map((d) => d.id).join("\0"));
  const wrap = useSettings((s) => s.lineWrap);
  const tab = useSettings((s) => s.tabSize);
  const fontSize = useSettings((s) => s.editorFontSize);
  const fontFamily = useSettings((s) => s.editorFontFamily);
  const typewriterMode = useDocStore((s) => s.typewriterMode);
  const viewMode = useDocStore((s) => s.viewMode);
  const prevMode = useRef(viewMode);
  const listContinuation = useSettings((s) => s.listContinuation);
  const livePreviewOn = useSettings((s) => s.livePreview);
  const language = useSettings((s) => s.language);
  const spellCheck = useSettings((s) => s.spellCheck);

  // Create the view once.
  useEffect(() => {
    if (!host.current) return;
    const first = selectActiveDoc(useDocStore.getState());
    currentDocId = first.id;
    const view = new EditorView({ state: freshState(first), parent: host.current });
    editorRef.view = view;
    view.focus();
    const unfollow = attachEditor(view);
    return () => {
      unfollow();
      view.destroy();
      editorRef.view = null;
      currentDocId = null;
    };
  }, []);

  // Switch tabs: stash the outgoing state, restore (or create) the incoming one.
  useEffect(() => {
    const view = editorRef.view;
    if (!view) return;
    if (currentDocId === doc.id) return;
    if (currentDocId) states.set(currentDocId, view.state);
    currentDocId = doc.id;
    const saved = states.get(doc.id);
    if (saved && saved.doc.toString() === doc.content) {
      view.setState(saved);
      // The stashed state carries the settings from when it was put away.
      const s = useSettings.getState();
      view.dispatch({
        effects: [
          lineWrap.reconfigure(s.lineWrap ? EditorView.lineWrapping : []),
          tabSize.reconfigure([tabSizeExt(s.tabSize), indentUnit.of(" ".repeat(s.tabSize))]),
          typewriter.reconfigure(useDocStore.getState().typewriterMode ? typewriterScrolling : []),
          listKeys.reconfigure(keymap.of(listKeymap(s.listContinuation))),
          preview.reconfigure(s.livePreview ? livePreview : []),
          uiLanguage.reconfigure(languageExtensions()),
          spelling.reconfigure(spellingExt(s.spellCheck)),
        ],
      });
    } else {
      view.setState(freshState(doc));
    }
    // Another document: what the preview shows is not this text until it has rendered it.
    previewIsBehind();
    cursorMoved();
    publishCursor(view.state);
    // Back to where the cursor is in this tab (also after a restart), in both panes.
    const head = view.state.selection.main.head;
    if (head > 0) {
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
      showInPreview(view.state.doc.lineAt(head).number);
    }
    view.focus();
  }, [doc.id, doc.content]);

  // Drop stashed states of closed tabs.
  useEffect(() => {
    const live = new Set(docIds.split("\0"));
    for (const id of Array.from(states.keys())) if (!live.has(id)) states.delete(id);
  }, [docIds]);

  // Replace the text when the document was changed outside the editor (reload from disk).
  const shown = useRef({ id: doc.id, path: doc.path });
  useEffect(() => {
    const view = editorRef.view;
    if (!view || currentDocId !== doc.id) return;
    // A file opened into this (empty) tab: the click was on the file tree, so bring the cursor here.
    const opened = shown.current.id === doc.id && shown.current.path !== doc.path && doc.path != null;
    shown.current = { id: doc.id, path: doc.path };
    if (opened && !document.querySelector(".modal-backdrop")) view.focus();
    const current = view.state.doc.toString();
    if (current === doc.content) return;
    // A file loaded into this tab at start-up gets its cursor from the previous session.
    const restored = takeRestoredCursor(doc.path);
    const anchor =
      restored != null ? lineOffset(doc.content, restored) : Math.min(view.state.selection.main.anchor, doc.content.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: doc.content },
      selection: { anchor },
      effects: restored != null ? EditorView.scrollIntoView(anchor, { y: "center" }) : [],
      // Not an edit by the user: a file loaded into this tab (or reloaded from disk) must not
      // be something "undo" can take back, or undoing far enough would empty the document.
      annotations: Transaction.addToHistory.of(false),
    });
    if (restored != null && anchor > 0) showInPreview(restored);
  }, [doc.content, doc.id, doc.path]);

  // Apply settings changes live.
  useEffect(() => {
    editorRef.view?.dispatch({ effects: lineWrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => {
    editorRef.view?.dispatch({
      effects: tabSize.reconfigure([tabSizeExt(tab), indentUnit.of(" ".repeat(tab))]),
    });
  }, [tab]);
  useEffect(() => {
    editorRef.view?.dispatch({
      effects: typewriter.reconfigure(typewriterMode ? typewriterScrolling : []),
    });
  }, [typewriterMode]);
  useEffect(() => {
    editorRef.view?.dispatch({ effects: listKeys.reconfigure(keymap.of(listKeymap(listContinuation))) });
  }, [listContinuation]);
  useEffect(() => {
    editorRef.view?.dispatch({ effects: preview.reconfigure(livePreviewOn ? livePreview : []) });
  }, [livePreviewOn]);

  useEffect(() => {
    editorRef.view?.dispatch({ effects: uiLanguage.reconfigure(languageExtensions()) });
  }, [language]);

  useEffect(() => {
    editorRef.view?.dispatch({ effects: spelling.reconfigure(spellingExt(spellCheck)) });
  }, [spellCheck]);

  // A different font changes the character metrics the editor has cached.
  useEffect(() => {
    editorRef.view?.requestMeasure();
  }, [fontFamily, fontSize]);

  // Coming back from preview-only: the editor was hidden, so bring the cursor into view.
  useEffect(() => {
    const was = prevMode.current;
    prevMode.current = viewMode;
    if (was !== "preview" || viewMode === "preview") return;
    const id = requestAnimationFrame(() => {
      const view = editorRef.view;
      if (!view) return;
      pauseFollowing(400);
      view.requestMeasure();
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "start", yMargin: 24 }) });
    });
    return () => cancelAnimationFrame(id);
  }, [viewMode]);

  const style = {
    "--editor-font-size": `${fontSize}px`,
    ...(fontFamilyCss(fontFamily, MONO_FALLBACK) ? { "--mono": fontFamilyCss(fontFamily, MONO_FALLBACK) } : {}),
  } as React.CSSProperties;

  return <div className="editor" ref={host} style={style} />;
}

/** Move the cursor to a 1-based line and scroll it into view (used by the outline). */
export function goToLine(line: number, focus = true, scroll = true) {
  const view = editorRef.view;
  if (!view) return;
  const n = Math.max(1, Math.min(line, view.state.doc.lines));
  const pos = view.state.doc.line(n).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: scroll ? EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }) : [],
  });
  if (focus) view.focus();
}

/** 1-based line of the editor cursor (1 when there is no editor). */
export function cursorLine(): number {
  const view = editorRef.view;
  return view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
}
