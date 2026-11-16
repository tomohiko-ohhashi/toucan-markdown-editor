import { html } from "@codemirror/lang-html";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { EditorState, StateField } from "@codemirror/state";
import { inCodeBlock } from "./context";

/**
 * Keep the cursor line vertically centred while typing (typewriter scrolling).
 *
 * For the first lines to be able to stand in the middle there is empty space above the text, with
 * a mark where the text starts (drawn by the style sheet, see ".cm-has-start"), so that the space
 * does not look like part of the document. The space under the text is the one every document has.
 */
export const typewriterScrolling = [
  EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const head = update.state.selection.main.head;
    requestAnimationFrame(() => {
      update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  }),
  EditorView.editorAttributes.compute(["doc"], (state) => ({ class: state.doc.length > 0 ? "cm-typewriter cm-has-start" : "cm-typewriter" })),
  EditorView.theme({
    ".cm-content": { paddingTop: "var(--start-space, 45vh)", position: "relative" },
  }),
];

export const tabSizeExt = (n: number) => EditorState.tabSize.of(n);

/**
 * Typed with a Japanese IME switched on, the heading marker comes out as full-width "＃" and "　",
 * which Markdown does not recognise. At the start of a line they are turned into "#" and " ", so
 * "＃＃　見出し" becomes "## 見出し".
 *
 * Text that is still being composed is left alone (changing it under the IME broke the
 * composition and doubled the character); it is corrected once the IME has handed it over.
 * Nothing is changed inside a code block, or where no heading would come of it ("＃タグ").
 */
function fixFullWidthMarker(view: EditorView, composed: string) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const m = /^([#＃]{1,6})([ 　]?)/.exec(line.text);
  if (!m || !/[＃　]/.test(m[0])) return;
  const markerEnd = line.from + m[0].length;
  // The marker is what was just typed: the cursor is behind it and the typed text reaches into it.
  if (head < markerEnd || head - composed.length > markerEnd) return;
  if (!m[2] && line.text.length > m[0].length) return;
  if (inCodeBlock(view.state, line.from)) return;
  view.dispatch({
    changes: { from: line.from, to: markerEnd, insert: "#".repeat(m[1].length) + (m[2] ? " " : "") },
    userEvent: "input.type",
  });
}

export const fullWidthHeadingFix = [
  // Typed without a composition (the IME passes the character straight through).
  EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || (text !== "＃" && text !== "　")) return false;
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const after = line.text.slice(to - line.from);
    let insert: string | null = null;
    if (text === "＃" && /^#{0,5}$/.test(before) && /^(\s|$)/.test(after)) insert = "#";
    if (text === "　" && /^#{1,6}$/.test(before)) insert = " ";
    if (insert === null || inCodeBlock(view.state, line.from)) return false;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.type",
    });
    return true;
  }),
  EditorView.domEventHandlers({
    compositionend: (event, view) => {
      const composed = event.data ?? "";
      if (!/[＃　]/.test(composed)) return false;
      // After the editor has taken the composed text in.
      setTimeout(() => {
        if (!view.composing) fixFullWidthMarker(view, composed);
      }, 30);
      return false;
    },
  }),
];

/**
 * HTML inside Markdown, without the HTML package's habit of closing tags by
 * itself: with it, typing "<div>" inserts "</div>", and whoever then types the
 * closing tag by hand ends up with two. The editor writes what is typed.
 */
export const plainHtmlTags = html({ matchClosingTags: false, autoCloseTags: false });

class EndMarker extends WidgetType {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-end-marker";
    el.setAttribute("aria-hidden", "true");
    // The space above the line is padding of the widget, not a margin: the editor measures the box.
    el.appendChild(document.createElement("span")).textContent = "END";
    return el;
  }
  eq() {
    return true;
  }
  ignoreEvent() {
    return true;
  }
}

const endMarkerAt = (state: EditorState): DecorationSet =>
  state.doc.length === 0 ? Decoration.none : Decoration.set([Decoration.widget({ widget: new EndMarker(), side: 1, block: true }).range(state.doc.length)]);

/**
 * The same empty space under the text as the preview has, so that the last lines can be brought
 * up the screen on both sides alike (with space on one side only, the two could not be level at
 * the end of a document). And a mark where the text ends, so that the space does not look like
 * more document to come.
 */
export const endOfDocument = [
  StateField.define<DecorationSet>({
    create: endMarkerAt,
    update: (value, tr) => (tr.docChanged ? endMarkerAt(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  }),
  EditorView.theme({ ".cm-content": { paddingBottom: "var(--end-space, 60vh)" } }),
];
