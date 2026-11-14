import type { EditorView } from "@codemirror/view";

/**
 * Keeps the editor and the preview at the same place in the document.
 *
 * The two panes show the same text at very different heights (a heading is taller in the
 * preview, an image is one line in the source and a third of a screen rendered), so "scrolled
 * to the same percentage" drifts apart in the middle of a document. Here the panes are matched
 * by source line instead: every block of the preview knows the line it starts on, and a line
 * between two blocks is placed proportionally between them.
 *
 * One height on screen is where the two panes are level: the height the cursor was last put at
 * (by a click, a key or typing). The line shown there in the editor is shown at the same height
 * in the preview. It stays that height while the panes are scrolled, also when the cursor has
 * scrolled out of view or the editor is no longer focused: the place the writer last worked at
 * is where the eye is, and nothing switches over when the cursor leaves the screen.
 *
 * This can be switched off (in the "..." menu). The panes then follow each other by
 * how far they are scrolled, as a fraction of their length, and nothing is marked.
 */

interface Anchor {
  /** 1-based source line. */
  line: number;
  /** Where that line is in the preview, in px from the top of its scrolled content. */
  top: number;
}

interface Block {
  el: HTMLElement;
  line: number;
  end: number;
}

let view: EditorView | null = null;
let pane: HTMLElement | null = null;

/** The preview does not show the editor's current text yet; its line numbers cannot be trusted. */
let stale = false;
/** A mouse button is down in the text: the selection is being dragged. */
let dragging = false;
/**
 * The last scroll made here, per pane: the scroll event it causes is not the user's. Told apart by
 * time and by place (the pane is still about where it was put), so that a scroll by the user
 * right afterwards, to somewhere else, is not thrown away with it.
 */
const ownScroll = { editor: { until: 0, to: 0 }, preview: { until: 0, to: 0 } };

function scrollTo(side: "editor" | "preview", el: HTMLElement, value: number, ms = 150) {
  ownScroll[side] = { until: now() + ms, to: value };
  el.scrollTop = value;
}

function isOwnScroll(side: "editor" | "preview", el: HTMLElement): boolean {
  // Some slack: the editor adjusts its position by a few pixels when it learns the real height of new lines.
  return now() < ownScroll[side].until && Math.abs(el.scrollTop - ownScroll[side].to) <= 40;
}

let anchors: Anchor[] | null = null;
let blocks: Block[] = [];
let anchorsFor = { height: 0, width: 0 };
let marked: HTMLElement | null = null;
/** The height (px from the top of the editor pane) at which the panes are level. */
let reference = 0;
/** Until this time a scroll of the editor is the editor following its cursor, not the user scrolling. */
let followingCursorUntil = 0;
/**
 * The pane the user moved last. The other one follows it; and when something else changes the
 * layout (a re-render, an image arriving), it is again the other one that is adjusted, so the
 * pane the user is looking at never moves by itself.
 */
let leader: "editor" | "preview" = "editor";
/** Level by line (true), or follow by fraction scrolled (false). */
let level = true;
/** In the by-fraction mode: no following until this time (both panes were just put somewhere on purpose). */
let pausedUntil = 0;

/** Switch between the two ways of keeping the panes together. */
export function setLevelPanes(on: boolean) {
  if (level === on) return;
  level = on;
  markCursor();
  if (!on) return;
  // Level at the cursor if it is on screen, else at the height used last.
  if (view && canSync()) takeReferenceFromCursor(view, editorGeometry(view));
  leader = "editor";
  settle();
}

/** True when the panes are kept level by line (and both are on screen). */
export function levelsPanes(): boolean {
  return level && canSync();
}

/** By-fraction mode: let two deliberate scrolls stand for a moment instead of pulling each other along. */
export function pauseFollowing(ms: number) {
  pausedUntil = now() + ms;
}

/**
 * How far a pane can be scrolled until the end of its text is at the bottom edge. The preview
 * has empty space under its text (more than half a screen, so the last lines can be brought up);
 * that space is not text, and counting it made "the same fraction" run ahead in the preview and
 * end on a blank screen.
 */
function textEnd(el: HTMLElement): number {
  if (el !== pane) return Math.max(0, el.scrollHeight - el.clientHeight);
  const style = getComputedStyle(el);
  const blank = Math.max(0, parseFloat(style.paddingBottom) - parseFloat(style.paddingTop));
  return Math.max(0, el.scrollHeight - blank - el.clientHeight);
}

/** By-fraction mode: `to` goes as far through its text as `from` is. */
function followByFraction(from: HTMLElement, to: HTMLElement, side: "editor" | "preview") {
  if (now() < pausedUntil) return;
  const max = textEnd(from);
  const target = Math.round(clamp(max > 0 ? from.scrollTop / max : 0, 0, 1) * textEnd(to));
  if (Math.abs(target - to.scrollTop) < 1) return;
  scrollTo(side, to, target, 100);
}

/** Bring the panes level again after a change of layout, without moving the one the user is using. */
function settle() {
  if (leader === "preview") alignEditor();
  else alignPreview();
}
let animation = 0;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const now = () => performance.now();

/** True when both panes are on screen, so there is something to keep together. */
export function canSync(): boolean {
  return !!view && !!pane && pane.clientHeight > 0 && view.scrollDOM.clientHeight > 0;
}

// ---------- the editor's side ----------

function editorGeometry(v: EditorView) {
  const scroller = v.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  return {
    scroller,
    rect,
    /** Where the first line starts, in px from the top of the scrolled content. */
    base: v.documentTop - rect.top + scroller.scrollTop,
    height: scroller.clientHeight,
    max: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
  };
}
type Geometry = ReturnType<typeof editorGeometry>;

/** The source line (with a fraction for "how far into it") shown at content position `y`. */
function lineAt(v: EditorView, g: Geometry, y: number): number {
  const block = v.lineBlockAtHeight(y - g.base);
  const line = v.state.doc.lineAt(block.from).number;
  const into = block.height > 0 ? clamp((y - g.base - block.top) / block.height, 0, 1) : 0;
  return line + into;
}

/** The content position of a (fractional) source line. */
function positionOf(v: EditorView, g: Geometry, line: number): number {
  const n = clamp(Math.floor(line), 1, v.state.doc.lines);
  const block = v.lineBlockAt(v.state.doc.line(n).from);
  return g.base + block.top + clamp(line - n, 0, 1) * block.height;
}

/**
 * The content position of the row the cursor is on: the top of its line, plus how far down the
 * cursor's row is in a line that wraps. Measured against the first character of the line, so that
 * the first row is exactly the top of the line. (The top of the cursor itself is a few pixels
 * lower, inside the row; taken as "a little way into the line", those pixels became a tenth of
 * the height of whatever the line is in the preview: 40 px for an image.)
 */
function cursorPosition(v: EditorView, g: Geometry): number {
  const head = v.state.selection.main.head;
  const block = v.lineBlockAt(head);
  const at = v.coordsAtPos(head);
  const first = v.coordsAtPos(block.from, 1);
  const row = at && first ? clamp(at.top - first.top, 0, block.height) : 0;
  return g.base + block.top + row;
}

// ---------- the preview's side ----------

function invalidate() {
  anchors = null;
}

function build(el: HTMLElement, lines: number): Anchor[] {
  const paneRect = el.getBoundingClientRect();
  const scrolled = el.scrollTop;
  const found: Anchor[] = [];
  blocks = [];
  for (const node of Array.from(el.querySelectorAll<HTMLElement>("[data-line]"))) {
    const line = Number(node.dataset.line);
    if (!(line >= 1)) continue;
    const rect = node.getBoundingClientRect();
    // Not shown (inside a closed <details>, which keeps a box for what it hides): it has no place of its own.
    if (rect.height === 0 && rect.width === 0) continue;
    if (node.closest("details:not([open])") && !node.closest("summary")) continue;
    const top = rect.top - paneRect.top + scrolled;
    const end = Number(node.dataset.lineEnd) || line;
    // A block reaches from its first line to its last: the line after it is where the block ends.
    // So lines inside it are spread over its height, and the blank lines that follow it fall
    // into the gap below it, not into the block (or, at the end of the document, into the empty
    // space under the text).
    found.push({ line, top }, { line: end + 1, top: top + rect.height });
    blocks.push({ el: node, line, end });
    // A fenced code block: its lines are all the same height, so they can be matched one to one
    // (first line of code under the opening fence, closing fence at the bottom).
    if (node.tagName === "PRE") {
      const rows = (node.textContent ?? "").replace(/\n$/, "").split("\n").length;
      if (end - line === rows + 1) {
        const style = getComputedStyle(node);
        const padTop = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
        const padBottom = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
        found.push({ line: line + 1, top: top + padTop }, { line: end, top: top + rect.height - padBottom });
      }
    }
  }
  found.sort((a, b) => a.line - b.line || a.top - b.top);
  const out: Anchor[] = [{ line: 1, top: 0 }];
  for (const a of found) {
    const last = out[out.length - 1];
    // Lines and positions both only go forward; anything else (a float, a nested duplicate) is left out.
    if (a.line > last.line && a.top >= last.top) out.push(a);
    else if (a.line === last.line && out.length === 1) last.top = Math.min(a.top, last.top);
  }
  // Whatever comes after the last block (blank lines) stays at its lower edge.
  const last = out[out.length - 1];
  out.push({ line: Math.max(lines + 1, last.line + 1), top: last.top });
  return out;
}

function currentAnchors(): Anchor[] {
  const el = pane as HTMLElement;
  if (!anchors || anchorsFor.height !== el.scrollHeight || anchorsFor.width !== el.clientWidth) {
    anchors = build(el, view?.state.doc.lines ?? 1);
    anchorsFor = { height: el.scrollHeight, width: el.clientWidth };
    marked = null; // elements may have been replaced
  }
  return anchors;
}

/** Index of the last anchor for which `key` is not greater than `value`. */
function search(list: Anchor[], value: number, key: "line" | "top"): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid][key] <= value) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, list.length - 2);
}

/** Where a (fractional) source line is in the preview's content. */
function previewPositionOf(line: number): number {
  const list = currentAnchors();
  const i = search(list, line, "line");
  const a = list[i];
  const b = list[i + 1];
  const t = clamp((line - a.line) / (b.line - a.line), 0, 1);
  return a.top + t * (b.top - a.top);
}

/** The (fractional) source line shown at content position `y` of the preview. */
function previewLineAt(y: number): number {
  const list = currentAnchors();
  const i = search(list, y, "top");
  const a = list[i];
  const b = list[i + 1];
  const t = b.top > a.top ? clamp((y - a.top) / (b.top - a.top), 0, 1) : 0;
  return a.line + t * (b.line - a.line);
}

// ---------- moving the panes ----------

function scrollPreview(target: number, smooth: boolean) {
  const el = pane as HTMLElement;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const to = clamp(Math.round(target), 0, max);
  cancelAnimationFrame(animation);
  const from = el.scrollTop;
  // Less than two pixels is not worth a visible twitch.
  if (Math.abs(to - from) < 2) return;
  const set = (value: number) => {
    scrollTo("preview", el, value);
  };
  // Following a scroll is done at once, so the panes move as one. A larger step glides instead
  // of jumping: after a click, and where one line of the source is a tall thing in the preview
  // (an image) that the editor scrolls past in a moment. A very long way is jumped, not travelled.
  const far = Math.abs(to - from);
  if ((!smooth && far <= 120) || far > el.clientHeight * 1.5) return set(to);
  const started = now();
  const step = () => {
    const t = clamp((now() - started) / 110, 0, 1);
    set(from + (to - from) * (1 - (1 - t) * (1 - t)));
    if (t < 1) animation = requestAnimationFrame(step);
  };
  step();
}

/** Take the cursor's height as the place where the panes are level, if the cursor is on screen. */
function takeReferenceFromCursor(v: EditorView, g: Geometry) {
  const y = cursorPosition(v, g) - g.scroller.scrollTop;
  if (y >= 0 && y <= g.height) reference = y;
}

/**
 * Put the preview where the editor is. Returns false when there is nothing to do it with
 * (a pane is hidden, or the preview has not caught up with the text).
 */
export function alignPreview(opts: { smooth?: boolean } = {}): boolean {
  const target = previewTarget();
  if (target == null) return false;
  scrollPreview(target, !!opts.smooth);
  return true;
}

/** Where the preview has to be scrolled to for the panes to be level; null when that cannot be said. */
function previewTarget(): number | null {
  if (!canSync() || stale || !level) return null;
  const v = view as EditorView;
  const el = pane as HTMLElement;
  const g = editorGeometry(v);
  const scrolled = g.scroller.scrollTop;
  const cursorY = cursorPosition(v, g) - scrolled;
  const cursorVisible = cursorY >= 0 && cursorY <= g.height;
  // Reading, with the cursor somewhere else: the ends of the document belong together.
  if (!cursorVisible && scrolled <= 0) return 0;
  if (!cursorVisible && scrolled >= g.max - 1) return textEnd(el);

  const height = clamp(reference, 0, g.height);
  // The panes need not start at the same height on screen.
  const inPreview = height + g.rect.top - el.getBoundingClientRect().top;
  return previewPositionOf(lineAt(v, g, scrolled + height)) - inPreview;
}

/** What the next levelling pass has to do; several requests within one frame are done as one. */
const pending = { smooth: false, takeCursor: false, mark: false };

/**
 * Level the preview with the editor in the editor's next measuring pass. Not at once: right after
 * a scroll the editor still works with estimated heights for the lines that have just come into
 * view, and levelling by those is corrected a moment later, which shows as a twitch.
 */
function levelSoon(what: Partial<typeof pending>) {
  const v = view;
  if (!v) return;
  pending.smooth ||= !!what.smooth;
  pending.takeCursor ||= !!what.takeCursor;
  pending.mark ||= !!what.mark;
  v.requestMeasure({
    key: pending,
    read: () => {
      if (pending.takeCursor) takeReferenceFromCursor(v, editorGeometry(v));
      return dragging ? null : previewTarget();
    },
    write: (target) => {
      const { smooth, mark } = pending;
      pending.smooth = pending.takeCursor = pending.mark = false;
      if (mark) markCursor();
      if (target != null) scrollPreview(target, smooth);
    },
  });
}

/** Put the editor where the preview is (the preview was scrolled by hand). */
export function alignEditor(): boolean {
  if (!canSync() || stale || !level) return false;
  const v = view as EditorView;
  const el = pane as HTMLElement;
  const g = editorGeometry(v);
  const scrolled = el.scrollTop;
  let target: number;
  if (scrolled <= 0) target = 0;
  else if (scrolled >= textEnd(el) - 1) target = g.max;
  else {
    const height = clamp(reference, 0, g.height);
    const line = previewLineAt(scrolled + height + g.rect.top - el.getBoundingClientRect().top);
    target = clamp(positionOf(v, g, line) - height, 0, g.max);
  }
  target = Math.round(target);
  if (Math.abs(target - g.scroller.scrollTop) < 2) return true;
  scrollTo("editor", g.scroller, target);
  return true;
}

/**
 * A block of the preview was picked (double click) and the cursor has gone to its line: bring
 * the editor level with the block where it is on screen. The preview stays as it is.
 */
export function bringEditorTo(line: number): boolean {
  if (!canSync() || stale || !level) return false;
  const v = view as EditorView;
  const el = pane as HTMLElement;
  const g = editorGeometry(v);
  const onScreen = previewPositionOf(line) - el.scrollTop - (g.rect.top - el.getBoundingClientRect().top);
  reference = clamp(onScreen, 0, g.height);
  leader = "preview";
  scrollTo("editor", g.scroller, Math.round(clamp(positionOf(v, g, line) - reference, 0, g.max)));
  return true;
}

// ---------- the mark on the cursor's block ----------

/** Show in the preview which block the cursor is in (the styling decides whether it is visible). */
function markCursor() {
  if (!view || !pane) return;
  let best: Block | null = null;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  if (level && !stale && pane.clientHeight > 0) {
    currentAnchors();
    for (const b of blocks) {
      if (b.line > line) break;
      // The innermost block the line is in. Containers are not marked as a whole.
      if (line <= b.end && b.el.tagName !== "TABLE" && b.el.tagName !== "BLOCKQUOTE" && (!best || b.end - b.line < best.end - best.line)) best = b;
    }
  }
  const el = best?.el ?? null;
  if (el !== marked || (el && !el.classList.contains("cursor-block"))) {
    pane.querySelectorAll<HTMLElement>(".cursor-block").forEach((n) => {
      n.classList.remove("cursor-block");
      for (const name of ["--cursor-row-y", "--cursor-row-h", "--cursor-own-h"]) n.style.removeProperty(name);
    });
    el?.classList.add("cursor-block");
    marked = el;
  }
  if (!el || !best) return;
  if (el.tagName === "PRE") {
    // In a block of code, the row the cursor is on (the block alone says little when it is long).
    const rows = (el.textContent ?? "").replace(/\n$/, "").split("\n").length;
    const row = line - best.line - 1;
    const style = getComputedStyle(el);
    const padTop = parseFloat(style.paddingTop);
    const rowHeight = (el.clientHeight - padTop - parseFloat(style.paddingBottom)) / rows;
    const onRow = best.end - best.line === rows + 1 && row >= 0 && row < rows;
    el.style.setProperty("--cursor-row-y", `${padTop + row * rowHeight}px`);
    el.style.setProperty("--cursor-row-h", onRow ? `${rowHeight}px` : "0px");
  } else if (el.tagName === "LI") {
    // A list item with a list inside it: only its own lines, not the items under it.
    const inner = el.querySelector<HTMLElement>(":scope > ul, :scope > ol");
    if (inner) el.style.setProperty("--cursor-own-h", `${Math.max(0, inner.getBoundingClientRect().top - el.getBoundingClientRect().top)}px`);
  }
}

// ---------- what the panes report ----------

/** The editor's text changed: the preview is behind until it reports a render. */
export function previewIsBehind() {
  stale = true;
}

/** The cursor moved (or the layout changed): mark its block and bring it level. */
export function cursorMoved() {
  followingCursorUntil = now() + 300;
  leader = "editor";
  // While the selection is being dragged the height stays where it was; it is taken when the button comes up.
  levelSoon({ mark: true, smooth: true, takeCursor: !dragging });
}

export function editorScrolled() {
  if (!view || isOwnScroll("editor", view.scrollDOM)) return;
  if (!level) {
    if (canSync()) followByFraction(view.scrollDOM, pane as HTMLElement, "preview");
    return;
  }
  if (dragging) return;
  leader = "editor";
  // Right after the cursor moved, the editor scrolls by itself to keep it in view
  // (typing at the bottom, typewriter mode): the level moves with the cursor.
  levelSoon({ takeCursor: now() < followingCursorUntil });
}

function previewScrolled() {
  if (!pane || isOwnScroll("preview", pane)) return;
  if (!level) {
    if (canSync()) followByFraction(pane as HTMLElement, (view as EditorView).scrollDOM, "editor");
    return;
  }
  leader = "preview";
  alignEditor();
}

/** The preview shows the current text. */
export function previewRendered() {
  stale = false;
  invalidate();
  markCursor();
  if (view && now() < followingCursorUntil) takeReferenceFromCursor(view, editorGeometry(view));
  settle();
}

export function attachEditor(v: EditorView): () => void {
  view = v;
  const down = (e: MouseEvent) => {
    if (e.button === 0 && (e.target as HTMLElement).closest?.(".cm-content")) dragging = true;
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    cursorMoved();
  };
  v.dom.addEventListener("mousedown", down);
  window.addEventListener("mouseup", up);
  return () => {
    v.dom.removeEventListener("mousedown", down);
    window.removeEventListener("mouseup", up);
    if (view === v) view = null;
  };
}

export function attachPreview(el: HTMLElement): () => void {
  pane = el;
  invalidate();
  // Anything that changes heights changes where the lines are.
  const reflow = () => {
    invalidate();
    settle();
  };
  const onScroll = () => previewScrolled();
  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("load", reflow, true); // images
  el.addEventListener("toggle", reflow, true); // <details>
  const observer = new ResizeObserver(reflow);
  observer.observe(el);
  return () => {
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("load", reflow, true);
    el.removeEventListener("toggle", reflow, true);
    observer.disconnect();
    if (pane === el) pane = null;
  };
}
