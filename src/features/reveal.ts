import { goToLine } from "../editor/Editor";
import { pauseFollowing } from "../preview/scrollSync";
import { useDocStore } from "../store/useDocStore";

let seq = 0;
const isNarrow = () => window.innerWidth < 768;

/**
 * Scroll the preview so the block that starts at `line` (or the closest one
 * before it) is at the top. Blocks carry `data-line` from the Markdown renderer.
 */
export function scrollPreviewToLine(container: HTMLElement, line: number): boolean {
  let best: HTMLElement | null = null;
  let bestLine = -1;
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-line]"))) {
    const n = Number(el.dataset.line);
    if (n <= line && n > bestLine) {
      best = el;
      bestLine = n;
    }
  }
  if (!best) {
    container.scrollTop = 0;
    return false;
  }
  const top = best.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTop = Math.max(0, top - 12);
  return true;
}

/**
 * Jump to a source line in both panes: the editor cursor moves there and the
 * preview scrolls to the matching block (as soon as it has rendered the
 * active document). On phones the keyboard is not raised.
 */
export function revealLine(line: number): void {
  const go = () => {
    pauseFollowing(700);
    goToLine(line, !isNarrow());
    useDocStore.setState({ reveal: { line, seq: ++seq } });
  };
  if (useDocStore.getState().diffOpen) {
    // The editor is hidden under the changes view: close that first, then move once the editor is laid out.
    useDocStore.setState({ diffOpen: false });
    requestAnimationFrame(() => requestAnimationFrame(go));
  } else {
    go();
  }
}
