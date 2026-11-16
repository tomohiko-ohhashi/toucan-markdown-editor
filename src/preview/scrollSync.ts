import { BlockType, type BlockInfo, type EditorView } from "@codemirror/view";

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
 * Where there are no lines to go by (the empty space under the text, and in typewriter mode
 * above it), the panes are as far from the text as each other. While reading (the cursor is out
 * of view) they also reach the top and the end of the document together, and a pane that follows
 * a scroll never moves the other way.
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
/** The height (px from the top of the editor pane) at which the panes are level. */
let reference = 0;
/** The cursor's row is at that height right now (it was put there and nothing has been scrolled since). */
let atCursor = false;
/** Another document was put into the editor; the preview has not shown it yet. */
let newDocument = false;
/**
 * What is at the top edge of the preview: a (fractional) line, or a distance from the text when
 * the edge is in the empty space above (negative) or under it. It stays there when the pane is
 * laid out again.
 */
let previewTop = { line: 1, off: 0 };
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
 * How far a pane can be scrolled until the end of its text is at the bottom edge. Both panes
 * have empty space under their text (more than half a screen, so the last lines can be brought
 * up); that space is not text and is not counted as length.
 */
function textEnd(el: HTMLElement): number {
  // What is under the last line of text: the END mark and the empty space.
  let under = 0;
  if (el === pane) {
    const last = el.lastElementChild;
    if (last) under = el.scrollHeight - (last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop);
  } else if (view) {
    under = el.scrollHeight - (editorGeometry(view).base + textOf(view.lineBlockAt(view.state.doc.length)).bottom);
  }
  // At "the end of the text" the mark is just on screen.
  return Math.max(0, el.scrollHeight - Math.max(0, under - 64) - el.clientHeight);
}

/** By-fraction mode: `to` goes as far through its text as `from` is; past the end of the text, the same distance. */
function followByFraction(from: HTMLElement, to: HTMLElement, side: "editor" | "preview") {
  if (now() < pausedUntil) return;
  const max = textEnd(from);
  const through = max > 0 ? from.scrollTop / max : 0;
  const target = Math.round(through <= 1 ? Math.max(0, through) * textEnd(to) : textEnd(to) + (from.scrollTop - max));
  if (Math.abs(target - to.scrollTop) < 1) return;
  scrollTo(side, to, target, 100);
}

/** Bring the panes level again after a change of layout, without moving the one the user is using. */
function settle() {
  if (leader === "preview") alignEditor();
  else alignPreview();
}

/**
 * The preview was laid out again (its width changed, an image arrived, a <details> was opened).
 * It keeps showing the place it showed (the browser's own way of doing that is switched off for
 * this pane: its corrections arrived as scroll events and were taken for the user scrolling), and
 * the panes are brought level again.
 */
function previewReflowed() {
  const el = pane;
  if (!el) return;
  invalidate();
  if (!stale && el.clientHeight > 0) {
    const { line, off } = previewTop;
    const to = Math.max(0, Math.round(off < 0 ? previewTextStart() + off : off > 0 ? previewTextEnd() + off : previewPositionOf(line)));
    if (Math.abs(to - el.scrollTop) >= 1) scrollTo("preview", el, to);
  }
  previewMovedItself();
  if (!canSync() || !level) return;
  if (leader === "preview") return void alignEditor();
  // When the cursor stood at the level, the level goes with its line to where that is now.
  if (atCursor && view) takeReferenceFromCursor(view, editorGeometry(view));
  alignPreview();
  // And once more when the editor has measured its own new layout.
  levelSoon({ quiet: true });
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

/**
 * The text of a line, without what the editor draws around it. The last line has the END mark
 * under it, and the editor reports the two as one block.
 */
function textOf(block: BlockInfo): BlockInfo {
  if (!Array.isArray(block.type)) return block;
  return block.type.find((part) => part.type === BlockType.Text) ?? block;
}

/** The source line (with a fraction for "how far into it") shown at content position `y`. */
function lineAt(v: EditorView, g: Geometry, y: number): number {
  const block = textOf(v.lineBlockAtHeight(y - g.base));
  const line = v.state.doc.lineAt(block.from).number;
  const into = block.height > 0 ? clamp((y - g.base - block.top) / block.height, 0, 1) : 0;
  return line + into;
}

/** The content position of a (fractional) source line. */
function positionOf(v: EditorView, g: Geometry, line: number): number {
  const n = clamp(Math.floor(line), 1, v.state.doc.lines);
  const block = textOf(v.lineBlockAt(v.state.doc.line(n).from));
  return g.base + block.top + clamp(line - n, 0, 1) * block.height;
}

/*
 * The editor knows the height of the lines it has drawn; for the others it has an estimate, and
 * its figures for "which line is at this height" are put right a moment after new lines come into
 * view. Going by those figures while scrolling placed the other pane a few pixels off and then
 * back again: a twitch. So wherever the lines in question are drawn, they are looked at where
 * they are on screen; the editor's figures are used only for what is not drawn.
 */

/** The (fractional) line the editor has drawn at a height of the window, or null when there is none there. */
function drawnLineAt(v: EditorView, clientY: number): number | null {
  const kids = v.contentDOM.children;
  let lo = 0;
  let hi = kids.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > clientY) hi = mid;
    else lo = mid + 1;
  }
  const el = kids[lo];
  const rect = el.getBoundingClientRect();
  if (!el.classList.contains("cm-line") || rect.height <= 0 || clientY < rect.top || clientY >= rect.bottom) return null;
  try {
    return v.state.doc.lineAt(v.posAtDOM(el, 0)).number + (clientY - rect.top) / rect.height;
  } catch {
    return null;
  }
}

/** Where the editor has drawn a line, or null when it has not drawn it. */
function drawnLine(v: EditorView, n: number): DOMRect | null {
  const from = v.state.doc.line(n).from;
  if (from < v.viewport.from || from > v.viewport.to) return null;
  try {
    const { node, offset } = v.domAtPos(from);
    const el = node === v.contentDOM ? v.contentDOM.children[offset] : (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(".cm-line");
    if (!el || el.parentElement !== v.contentDOM || !el.classList.contains("cm-line") || v.posAtDOM(el, 0) !== from) return null;
    return el.getBoundingClientRect();
  } catch {
    return null;
  }
}

/** The (fractional) line at a height of the editor's pane (px from its top edge). */
function lineOnScreen(v: EditorView, g: Geometry, y: number): number {
  return drawnLineAt(v, g.rect.top + y) ?? lineAt(v, g, g.scroller.scrollTop + y);
}

/** The height in the editor's pane at which a (fractional) line is now; `drawn` tells whether that was seen or estimated. */
function screenOfLine(v: EditorView, g: Geometry, line: number): { y: number; drawn: boolean } {
  const n = clamp(Math.floor(line), 1, v.state.doc.lines);
  const rect = drawnLine(v, n);
  if (rect) return { y: rect.top - g.rect.top + clamp(line - n, 0, 1) * rect.height, drawn: true };
  return { y: positionOf(v, g, line) - g.scroller.scrollTop, drawn: false };
}

/** Where the editor's text starts and ends, as heights in its pane (above the top edge: negative). */
function editorSpan(v: EditorView, g: Geometry): { start: number; end: number } {
  const doc = v.state.doc;
  const scrolled = g.scroller.scrollTop;
  const first = drawnLine(v, 1);
  const last = drawnLine(v, doc.lines);
  return {
    start: first ? first.top - g.rect.top : g.base + textOf(v.lineBlockAt(0)).top - scrolled,
    end: last ? last.bottom - g.rect.top : g.base + textOf(v.lineBlockAt(doc.length)).bottom - scrolled,
  };
}

/**
 * The height in the editor's pane of the row the cursor is on: the top of its line, plus how far
 * down the cursor's row is in a line that wraps. Measured against the first character of the
 * line, so that the first row is exactly the top of the line. (The top of the cursor itself is a
 * few pixels lower, inside the row; taken as "a little way into the line", those pixels became a
 * tenth of the height of whatever the line is in the preview: 40 px for an image.)
 */
function cursorOnScreen(v: EditorView, g: Geometry): number {
  const head = v.state.selection.main.head;
  const block = textOf(v.lineBlockAt(head));
  const at = v.coordsAtPos(head);
  const first = v.coordsAtPos(block.from, 1);
  const row = at && first ? clamp(at.top - first.top, 0, block.height) : 0;
  const rect = drawnLine(v, v.state.doc.lineAt(head).number);
  return (rect ? rect.top - g.rect.top : g.base + block.top - g.scroller.scrollTop) + row;
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
  // The first line is at the very top. With empty space above the text (typewriter mode), it is
  // where that space ends; what is above it is treated like the space under the text.
  const first = el.classList.contains("start-space") ? el.firstElementChild : null;
  const out: Anchor[] = [{ line: 1, top: first ? first.getBoundingClientRect().top - paneRect.top + scrolled : 0 }];
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

/** Where the text starts in the preview (content position of its first line). */
function previewTextStart(): number {
  return currentAnchors()[0].top;
}

/** Where the text ends in the preview (content position of the bottom of the last block). */
function previewTextEnd(): number {
  const list = currentAnchors();
  return list[list.length - 1].top;
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
  const y = cursorOnScreen(v, g);
  if (y >= 0 && y <= g.height) reference = y;
}

/**
 * The browser moves a pane by itself when its content gets shorter than where it was scrolled to
 * (text deleted, another document). That is not the user scrolling, and the editor must not be
 * sent after it.
 */
function previewMovedItself() {
  if (pane) ownScroll.preview = { until: now() + 150, to: pane.scrollTop };
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
  const y = clamp(reference, 0, g.height);
  // The panes need not start at the same height on screen.
  const inPreview = y + g.rect.top - el.getBoundingClientRect().top;
  const span = editorSpan(v, g);
  // In the empty space under (or above) the text there are no lines to go by: as far from the text here as there.
  let position: number;
  if (y > span.end) position = previewTextEnd() + (y - span.end);
  else if (y < span.start) position = previewTextStart() - (span.start - y);
  else position = previewPositionOf(lineOnScreen(v, g, y));
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  return endsTogether(position - inPreview, g.scroller.scrollTop, g.max, max, reading(cursorOnScreen(v, g), g.height));
}

/**
 * How much the user is reading rather than writing: 0 while the cursor's row is on screen, rising
 * to 1 as it gets a few lines out of view. (Gradually, so that nothing jumps when the cursor
 * crosses the edge of the screen.)
 */
function reading(cursorY: number, height: number): number {
  const outside = cursorY < 0 ? -cursorY : cursorY > height ? cursorY - height : 0;
  return clamp(outside / 200, 0, 1);
}

/**
 * The two panes reach the top and the end of the document together.
 *
 * Level at one height, they would not: what is above (or below) that height takes a different
 * amount of room on each side, so one pane would be at its end while the other still had some way
 * to go. So the following pane is never more than a few times as far from an end as the pane
 * being scrolled: it arrives at the same moment, a little faster over the last stretch, and
 * without a jump. Only while reading: when the cursor is on screen, its line stays exactly level.
 *
 * `exact` is where the following pane would go by the level alone; `lead` and `leadMax` are the
 * pane that was scrolled, `max` is how far the following one can go.
 */
function endsTogether(exact: number, lead: number, leadMax: number, max: number, reading: number): number {
  if (reading <= 0 || leadMax <= 0 || max <= 0) return exact;
  const pace = Math.max(3, max / leadMax) / reading;
  return Math.min(pace * lead, Math.max(exact, max - pace * (leadMax - lead)));
}

/** Which way a pane is being scrolled (1 down, -1 up), from one scroll event to the next. */
const lastTop = { editor: 0, preview: 0 };
function wayOf(side: "editor" | "preview", el: HTMLElement): number {
  const way = Math.sign(el.scrollTop - lastTop[side]);
  lastTop[side] = el.scrollTop;
  return way;
}

/** What the next levelling pass has to do; several requests within one frame are done as one. */
const pending = { smooth: false, takeCursor: false, mark: false, quiet: true, way: null as number | null };

/**
 * Level the preview with the editor once the editor has finished with its own layout. Not at
 * once: right after a scroll the editor still has to draw and measure the lines that have just
 * come into view, and when lines above the screen turn out to be taller or shorter than it had
 * assumed, it moves its own scroll position to keep the text where it is. Levelling in the middle
 * of that is corrected a moment later, which shows as a twitch. So the editor is asked for a
 * measuring pass, and the levelling is done right after that pass has ended (still before the
 * screen is painted).
 */
function levelSoon(what: Partial<typeof pending>) {
  const v = view;
  if (!v) return;
  pending.smooth ||= !!what.smooth;
  pending.takeCursor ||= !!what.takeCursor;
  pending.mark ||= !!what.mark;
  if (!what.quiet) {
    pending.quiet = false;
    // The way the editor is being scrolled, when scrolling is all that happened.
    const way = what.way ?? 0;
    pending.way = pending.way == null || pending.way === way ? way : 0;
  }
  v.requestMeasure({
    key: pending,
    read: () => null,
    write: () => {
      if (levelling) return;
      levelling = true;
      queueMicrotask(levelNow);
    },
  });
}
let levelling = false;

function levelNow() {
  levelling = false;
  const { smooth, takeCursor, mark, quiet, way } = pending;
  pending.smooth = pending.takeCursor = pending.mark = false;
  pending.quiet = true;
  pending.way = null;
  const v = view;
  if (!v) return;
  // When the layout changed under a cursor that stood at the level (the window was resized, a
  // panel opened), the level goes with the cursor's line to where that is now.
  if (takeCursor || (quiet && atCursor)) takeReferenceFromCursor(v, editorGeometry(v));
  if (!quiet && canSync()) atCursor = Math.abs(cursorOnScreen(v, editorGeometry(v)) - reference) < 2;
  if (mark) markCursor();
  const target = dragging ? null : previewTarget();
  if (target == null) return;
  const by = target - (pane as HTMLElement).scrollTop;
  // A correction nobody asked for (the editor laid its lines out again) is made only when it
  // can be seen as one; and a pane that follows a scroll never goes the other way.
  if ((quiet && Math.abs(by) < 4) || (way && Math.sign(by) === -way)) return;
  scrollPreview(target, smooth);
}

/**
 * Put the editor where the preview is (the preview was scrolled by hand; `way`: which way, if
 * that is all that happened).
 */
export function alignEditor(way = 0, again = true): boolean {
  if (!canSync() || stale || !level) return false;
  const v = view as EditorView;
  const el = pane as HTMLElement;
  const g = editorGeometry(v);
  const scrolled = el.scrollTop;
  const y = clamp(reference, 0, g.height);
  const at = scrolled + y + g.rect.top - el.getBoundingClientRect().top;
  const start = previewTextStart();
  const end = previewTextEnd();
  const span = editorSpan(v, g);
  // The height in the editor's pane at which that place of the preview is now.
  let found = { y: 0, drawn: true };
  if (at > end) found.y = span.end + (at - end);
  else if (at < start) found.y = span.start - (start - at);
  else found = screenOfLine(v, g, previewLineAt(at));
  const current = g.scroller.scrollTop;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const together = endsTogether(current + found.y - y, scrolled, max, g.max, reading(cursorOnScreen(v, g), g.height));
  // The preview brought to its very top means "the beginning": the editor goes there too.
  const target = scrolled <= 0 ? 0 : Math.round(clamp(together, 0, g.max));
  const by = target - current;
  if (Math.abs(by) >= 2 && !(way && Math.sign(by) === -way)) {
    scrollTo("editor", g.scroller, target);
    atCursor = false;
  }
  // The line was not drawn yet and its place only estimated: look again once the editor has drawn it.
  if (!found.drawn && again) {
    v.requestMeasure({
      key: alignEditor,
      read: () => null,
      write: () => {
        if (leader === "preview") alignEditor(way, false);
      },
    });
  }
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
  atCursor = true;
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
  // Asked of the document, not remembered: the elements are replaced at every render.
  if (pane.querySelector(".cursor-block") !== el) {
    pane.querySelectorAll<HTMLElement>(".cursor-block").forEach((n) => {
      n.classList.remove("cursor-block");
      for (const name of ["--cursor-row-y", "--cursor-row-h", "--cursor-own-h"]) n.style.removeProperty(name);
    });
    el?.classList.add("cursor-block");
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

/** The editor's layout changed by itself (it measured lines, a font arrived): level again if it matters. */
export function editorReflowed() {
  if (leader === "editor") levelSoon({ quiet: true });
}

/**
 * The cursor moved: mark its block and bring it level. With `take` false only the mark is moved
 * (a tab was put back as it was left: its level is where it was, not where its cursor is).
 */
export function cursorMoved(take = true) {
  if (take) followingCursorUntil = now() + 300;
  leader = "editor";
  // While the selection is being dragged the height stays where it was; it is taken when the button comes up.
  levelSoon({ mark: true, smooth: take, takeCursor: take && !dragging });
}

export function editorScrolled() {
  if (!view) return;
  const way = wayOf("editor", view.scrollDOM);
  if (isOwnScroll("editor", view.scrollDOM)) return;
  if (!level) {
    if (canSync()) followByFraction(view.scrollDOM, pane as HTMLElement, "preview");
    return;
  }
  if (dragging) return;
  leader = "editor";
  // Right after the cursor moved, the editor scrolls by itself to keep it in view
  // (typing at the bottom, typewriter mode): the level moves with the cursor.
  const withCursor = now() < followingCursorUntil;
  levelSoon({ takeCursor: withCursor, way: withCursor ? 0 : way });
}

function previewScrolled() {
  if (!pane) return;
  if (!stale && pane.clientHeight > 0) {
    const y = pane.scrollTop;
    const start = previewTextStart();
    const end = previewTextEnd();
    // At the very top is at the very top, however much space there is above the text.
    previewTop = y <= 0 ? { line: 1, off: -1e9 } : y < start ? { line: 1, off: y - start } : y > end ? { line: 1, off: y - end } : { line: previewLineAt(y), off: 0 };
  }
  const way = wayOf("preview", pane);
  if (isOwnScroll("preview", pane)) return;
  if (!level) {
    if (canSync()) followByFraction(pane as HTMLElement, (view as EditorView).scrollDOM, "editor");
    return;
  }
  leader = "preview";
  alignEditor(way);
}

/**
 * The preview's own layout was changed (the space above its text was added or taken away, by
 * `shift` px): keep the text where it is on screen, and level again.
 */
export function previewShifted(shift: number) {
  if (!pane) return;
  invalidate();
  // At the very top it stays at the very top: the new space is then what is seen first.
  if (shift < 0 || pane.scrollTop > 0) scrollTo("preview", pane, Math.max(0, pane.scrollTop + shift));
  settle();
}

/** The preview shows the current text. */
export function previewRendered() {
  stale = false;
  invalidate();
  previewMovedItself();
  markCursor();
  if (view && canSync() && (atCursor || now() < followingCursorUntil)) takeReferenceFromCursor(view, editorGeometry(view));
  if (newDocument) {
    newDocument = false;
    // By fraction, nothing else would bring the preview to where the editor is in this document.
    if (!level && canSync()) followByFraction((view as EditorView).scrollDOM, pane as HTMLElement, "preview");
  }
  settle();
}

/**
 * Another document is in the editor now. The editor says where it is; the preview follows once it
 * shows the text. `height`: the level this document had when it was last on screen.
 */
export function documentChanged(height?: number) {
  stale = true;
  newDocument = true;
  leader = "editor";
  atCursor = false;
  followingCursorUntil = 0;
  if (height != null) reference = height;
}

/** The height at which the panes are level now (kept per tab by the editor). */
export function levelHeight(): number {
  return reference;
}

/**
 * The editor is back on screen next to a preview that was read on its own: it goes to where the
 * preview is. False when that cannot be done (yet).
 */
export function editorFollowsPreview(): boolean {
  if (!canSync() || stale) return false;
  leader = "preview";
  if (level) return alignEditor();
  pausedUntil = 0;
  followByFraction(pane as HTMLElement, (view as EditorView).scrollDOM, "editor");
  return true;
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
  const reflow = () => previewReflowed();
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
