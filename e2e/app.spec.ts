import { test, expect, type Page } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.E2E_WORKSPACE as string;
const onDisk = (name: string) => readFileSync(join(workspace, name), "utf8");

async function start(page: Page) {
  await page.goto("/?token=e2e");
  await page.waitForSelector(".sidebar .tree");
}

async function openFile(page: Page, path: string) {
  await page.click(`.tree-file[title="${path}"]`);
  const name = path.split("/").pop() as string;
  await expect(page).toHaveTitle(new RegExp(`^(● )?${name.replace(".", "\\.")} `));
}

const editor = (page: Page) => page.locator(".cm-content");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("settings") ?? "{}") as Record<string, unknown>);

/** Japanese text left in the UI itself (not in the user's documents). */
const japaneseInUi = (page: Page) =>
  page.evaluate(() => {
    const jp = /[぀-ヿ一-鿿]/;
    const skip = (el: Element | null) => !!el?.closest(".cm-content, .preview, .tree, .tab-name, .outline-list, .toolbar-title, .statusbar-path, option[value='ja']");
    const found = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      if (text && jp.test(text) && !skip(n.parentElement) && text !== "言語 / Language") found.add(text);
    }
    for (const el of Array.from(document.querySelectorAll("[title], [placeholder], [aria-label]"))) {
      if (skip(el)) continue;
      for (const a of ["title", "placeholder", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && jp.test(v)) found.add(`${a}=${v}`);
      }
    }
    return Array.from(found);
  });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A native confirm()/alert() would mean an in-app dialog was bypassed.
  page.on("dialog", (d) => void d.accept());
  test.info().annotations.push({ type: "errors", description: "" });
  (page as unknown as { __errors: string[] }).__errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors, "uncaught errors in the page").toEqual([]);
});

test("open a file, edit it, see the preview follow and save to disk", async ({ page }) => {
  await start(page);
  await openFile(page, "save-me.md");
  await expect(page.locator(".preview h1")).toHaveText("Save me");
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nadded by the test");
  await expect(page.locator(".preview")).toContainText("added by the test");
  await expect(page).toHaveTitle(/^● save-me\.md/);
  await page.keyboard.press("Control+S");
  await expect(page).toHaveTitle(/^save-me\.md/);
  expect(onDisk("save-me.md")).toContain("added by the test");
});

test("closing a changed tab asks with three labelled choices", async ({ page }) => {
  await start(page);
  await editor(page).click();
  await page.keyboard.type("draft");
  await page.keyboard.press("Control+W");
  await expect(page.locator(".modal.confirm .prompt-actions button")).toHaveText(["キャンセル", "保存しない", "保存する"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(editor(page)).toContainText("draft");
  await page.keyboard.press("Control+W");
  await page.click('.modal.confirm button:has-text("保存しない")');
  await expect(page.locator(".cm-placeholder")).toBeVisible();
});

test("the session comes back after a restart: tabs, front tab, cursor, panels, view", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await openFile(page, "long.md");
  await editor(page).click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
  await openFile(page, "tasks.md");
  await page.click('.tab:has-text("long.md")');
  await page.keyboard.press("Control+Shift+O");
  await page.keyboard.press("F1");
  await page.keyboard.press("Control+Shift+Digit1");
  const cursor = page.locator('.statusbar span[title="カーソル位置"]');
  const before = await cursor.textContent();
  await page.waitForTimeout(900); // the session is written half a second after the last change

  await page.reload();
  await page.waitForSelector(".sidebar .tree");
  await expect(page.locator(".tab-name")).toHaveText(["hello.md", "long.md", "tasks.md"]);
  await expect(page.locator(".tab.active .tab-name")).toHaveText("long.md");
  await expect(cursor).toHaveText(before as string);
  await expect(page.locator(".outline")).toBeVisible();
  await expect(page.locator(".cheatsheet")).toBeVisible();
  await expect(page.locator(".panes")).toHaveClass(/mode-editor/);
  await expect(page.locator(".cm-activeLine")).toBeInViewport();
});

test("settings show at once but are kept only by Save", async ({ page }) => {
  await start(page);
  const theme = () => page.locator('.modal label:has-text("テーマ") select');
  const applied = () => page.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "system");

  await page.keyboard.press("Control+Comma");
  await theme().selectOption("dark");
  expect(await applied()).toBe("dark");
  await expect(page.locator(".modal-footer-note")).not.toBeEmpty();
  await page.waitForTimeout(700);
  expect((await stored(page)).theme ?? "system").toBe("system");
  await page.click('.modal-footer button:has-text("キャンセル")');
  expect(await applied()).toBe("system");

  await page.keyboard.press("Control+Comma");
  await theme().selectOption("dark");
  await page.keyboard.press("Escape");
  expect(await applied()).toBe("system");

  await page.keyboard.press("Control+Comma");
  await theme().selectOption("dark");
  await page.click(".modal-footer button.primary");
  await expect(page.locator(".modal-footer")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect((await stored(page)).theme).toBe("dark");
  await page.reload();
  await page.waitForSelector(".cm-content");
  expect(await applied()).toBe("dark");
});

test("unsaved changes are restored at the next start when that is switched on", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Control+Comma");
  await page.check('label:has-text("次回の起動時に復元する") input');
  await page.check('label:has-text("終了時に確認しない") input');
  await page.click(".modal-footer button.primary");
  await openFile(page, "unsaved.md");
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nnot saved yet");
  await page.keyboard.press("Control+N");
  await editor(page).click();
  await page.keyboard.type("# untitled draft");
  await page.waitForTimeout(900);

  await page.reload();
  await page.waitForSelector(".sidebar .tree");
  await expect(page.locator(".tab-name")).toHaveText(["● unsaved.md", "● 無題"]);
  await expect(editor(page)).toContainText("untitled draft");
  await page.click('.tab:has-text("unsaved.md")');
  await expect(editor(page)).toContainText("not saved yet");
  expect(onDisk("unsaved.md")).not.toContain("not saved yet");
});

test("task boxes in the preview tick the item in the source", async ({ page }) => {
  await start(page);
  await openFile(page, "tasks.md");
  const boxes = page.locator(".preview input[type=checkbox]");
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).click();
  await expect(editor(page)).toContainText("- [x] 一つ目");
  await expect(boxes.nth(0)).toBeChecked();
  await boxes.nth(1).click();
  await expect(editor(page)).toContainText("- [ ] 二つ目");
});

test("tabs of files with the same name show their folder", async ({ page }) => {
  await start(page);
  await page.click('.tree-dir:has-text("docs")');
  await openFile(page, "docs/README.md");
  await page.click('.tree-dir:has-text("notes")');
  await openFile(page, "notes/README.md");
  await expect(page.locator(".tab-name")).toHaveText(["README.md — docs", "README.md — notes"]);
  await page.click('.tab:has-text("README.md — docs")');
  await expect(page.locator(".preview")).toContainText("docs のファイル");
});

test("the UI is English for an English system and can be switched in the settings", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await start(page);
  await expect(page.locator(".toolbar .tg-file > button").first()).toHaveText("New");
  // A document without Japanese in it, so everything Japanese on screen would be UI text.
  await openFile(page, "hello.md");
  await page.keyboard.press("Control+Shift+O");
  await page.keyboard.press("F1");
  await page.keyboard.press("Control+Comma");
  await page.waitForSelector(".modal-footer");
  expect(await japaneseInUi(page)).toEqual([]);

  await page.locator('label:has-text("Language") select').selectOption("ja");
  await expect(page.locator(".modal h2")).toHaveText("設定");
  await page.click(".modal-footer button.primary");
  await expect(page.locator(".toolbar .tg-file > button").first()).toHaveText("新規");
  await context.close();
});

test("the About dialog shows the version and the bundled license texts", async ({ page }) => {
  await start(page);
  await page.click(".toolbar .tg-more .dropdown > button");
  await page.click('.menu-item:has-text("バージョン情報")');
  await expect(page.locator(".about-version")).toContainText(/バージョン \d+\.\d+\.\d+/);
  await expect(page.locator(".modal.about")).toContainText("All rights reserved");
  await page.click('button:has-text("すべてのライブラリとライセンス文を表示")');
  await expect(page.locator(".licenses-text")).toContainText("THIRD-PARTY LICENSES");
  await expect(page.locator(".licenses-text")).toContainText("Permission is hereby granted, free of charge");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toHaveCount(0);
});

test("printing shows only the document: no phone bar, no panels", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await page.keyboard.press("F1");
  // A printed page is narrower than the phone breakpoint; the phone layout must not apply to it.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.emulateMedia({ media: "print" });
  for (const part of [".mobilebar", ".toolbar", ".tabbar", ".statusbar", ".sidebar", ".cheatsheet", ".pane-editor"]) {
    await expect(page.locator(part).first(), part).toBeHidden();
  }
  await expect(page.locator(".preview h1")).toBeVisible();
});

test("on a phone the bottom bar drives the app", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, locale: "ja-JP" });
  const page = await context.newPage();
  await page.goto("/?token=e2e");
  await page.waitForSelector(".mobilebar");
  await page.tap('.mobilebar button[title="フォルダ"]');
  await page.tap('.tree-file[title="hello.md"]');
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(editor(page)).toContainText("# Hello");
  await page.tap('.mobilebar .segmented button:has-text("閲覧")');
  await expect(page.locator(".preview h1")).toBeVisible();
  await context.close();
});

test("the changes view compares with the first-opened text and with the saved file, and can be edited", async ({ page }) => {
  await start(page);
  await openFile(page, "long.md");
  await editor(page).click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type(" (改)");
  await page.keyboard.press("Control+S");
  await expect(page).toHaveTitle(/^long\.md/);
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n追加した最後の行");

  // Opened from the view switch, next to Edit / Split / Preview.
  await page.click('.tg-view button:has-text("差分")');
  const count = page.locator(".diff-count");
  const left = page.locator(".diff-body .cm-mergeViewEditor").first();
  const right = page.locator(".diff-body .cm-mergeViewEditor").last();
  // Since first opened: the saved heading change and the unsaved last line.
  await expect(count).toHaveText("変更 2 箇所");
  await expect(left).toContainText("# 長い文書");
  await expect(right.locator(".cm-changedText").first()).toHaveText(" (改)");
  // The second change is at the far end of a long file: go there.
  await page.click('.diff-nav button[title="次の変更"]');
  await expect(right).toContainText("追加した最後の行");

  // Against the saved file: only the unsaved line.
  await page.click('.diff-head button:has-text("保存済みの内容と比較")');
  await expect(count).toHaveText("変更 1 箇所");

  // The current side can be edited here; the document follows.
  await right.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" を編集");
  await expect(right).toContainText("追加した最後の行 を編集");
  await expect(page).toHaveTitle(/^● long\.md/);

  // Putting the old text back for the change removes it.
  await page.locator(".diff-revert").first().click();
  await expect(count).toHaveText("違いはありません");
  await expect(page).toHaveTitle(/^long\.md/);

  // Back in the main editor the text is what the changes view left, and undo brings the edit back.
  await page.keyboard.press("Escape");
  await expect(page.locator(".diff")).toHaveCount(0);
  await expect(editor(page)).not.toContainText("追加した最後の行");
  await editor(page).click();
  await page.keyboard.press("Control+Z");
  await expect(editor(page)).toContainText("追加した最後の行 を編集");
  await page.keyboard.press("Control+Shift+Z");

  // Closing and reopening the file keeps the first-opened text as the base.
  await page.keyboard.press("Control+W");
  await openFile(page, "long.md");
  await page.keyboard.press("Control+Shift+G");
  await expect(count).toHaveText("変更 1 箇所");
  await page.click('.diff-head button:has-text("保存済みの内容と比較")');
  await expect(count).toHaveText("違いはありません");
  await page.click('.tg-view button:has-text("分割")');
  await expect(page.locator(".diff")).toHaveCount(0);
});

test("undo stops at the text the file was opened with", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await editor(page).click();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Z");
  await expect(editor(page)).toContainText("First paragraph.");
  await expect(page).toHaveTitle(/^hello\.md/);

  await page.keyboard.press("Control+End");
  await page.keyboard.type("typed");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Z");
  await expect(editor(page)).toContainText("First paragraph.");
  await expect(editor(page)).not.toContainText("typed");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Shift+Z");
  await expect(editor(page)).toContainText("typed");
});

test("a Shift_JIS file opens readable and is saved in Shift_JIS again", async ({ page }) => {
  await start(page);
  await openFile(page, "sjis.txt");
  await expect(editor(page)).toContainText("日本語のテキスト");
  await expect(page.locator('.statusbar span[title="文字コード"]')).toHaveText("Shift_JIS");
  await expect(page).toHaveTitle(/^sjis\.txt/); // opening it does not mark it as changed
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("追記");
  await page.keyboard.press("Control+S");
  await expect(page).toHaveTitle(/^sjis\.txt/);
  const bytes = readFileSync(join(workspace, "sjis.txt"));
  // "追記" in Shift_JIS is 92 C7 8B 4C; in UTF-8 it would be E8 BF BD E8 A8 98.
  expect(bytes.includes(Buffer.from([0x92, 0xc7, 0x8b, 0x4c]))).toBe(true);
  expect(bytes.includes(Buffer.from("追記", "utf8"))).toBe(false);
  expect(bytes.includes(Buffer.from([0x0d, 0x0a]))).toBe(true);
});

test("an image in the tree can be looked at and inserted", async ({ page }) => {
  await start(page);
  await page.click('.tree-dir:has-text("docs")');
  await openFile(page, "docs/README.md");
  await page.click('.tree-dir:has-text("assets")');
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.click('.tree-file[title="docs/assets/dot.png"]');
  await expect(page.locator(".image-preview img")).toBeVisible();
  await page.click('.image-preview button:has-text("ドキュメントに挿入")');
  await expect(editor(page)).toContainText("![dot](assets/dot.png)");
  await expect(page.locator('.preview img[alt="dot"]')).toBeVisible();
});

test("tabs can be dragged into a different order", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await openFile(page, "tasks.md");
  await openFile(page, "long.md");
  await expect(page.locator(".tab-name")).toHaveText(["hello.md", "tasks.md", "long.md"]);
  const from = await page.locator('.tab:has-text("long.md")').boundingBox();
  const to = await page.locator('.tab:has-text("hello.md")').boundingBox();
  if (!from || !to) throw new Error("tabs not found");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Just inside the neighbour is not enough: a tab moves once the pointer is past the middle of the other one.
  await page.mouse.move(from.x - 5, from.y + from.height / 2, { steps: 4 });
  await expect(page.locator(".tab-name")).toHaveText(["hello.md", "tasks.md", "long.md"]);
  await page.mouse.move(to.x + to.width / 4, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".tab-name")).toHaveText(["long.md", "hello.md", "tasks.md"]);
  // A plain click still just selects a tab.
  await page.click('.tab:has-text("tasks.md")');
  await expect(page.locator(".tab.active .tab-name")).toHaveText("tasks.md");
});

test("the dividers between the panels can be dragged, and the widths are kept", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  const width = async (selector: string) => Math.round((await page.locator(selector).boundingBox())?.width ?? 0);
  const drag = async (panel: string, dx: number) => {
    const box = await page.locator(`.splitter[data-panel="${panel}"]`).boundingBox();
    if (!box) throw new Error(`no divider for ${panel}`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };

  // Sidebar: wider by 100px.
  expect(await width(".sidebar")).toBe(240);
  await drag("sidebar", 100);
  expect(await width(".sidebar")).toBe(340);

  // Editor / preview: move the line to the left, the editor gets narrower and the preview wider.
  const editorBefore = await width(".pane-editor");
  const previewBefore = await width(".pane-preview");
  await drag("split", -150);
  expect(await width(".pane-editor")).toBeLessThan(editorBefore - 120);
  expect(await width(".pane-preview")).toBeGreaterThan(previewBefore + 120);

  // Outline (on the right): dragging to the left makes it wider.
  await page.keyboard.press("Control+Shift+O");
  await expect(page.locator(".outline")).toBeVisible();
  await drag("outline", -60);
  expect(await width(".outline")).toBe(300);

  // Kept after a reload.
  await expect.poll(async () => ((await stored(page)).panelSizes as Record<string, number> | undefined)?.outline).toBe(300);
  await page.reload();
  await page.waitForSelector(".sidebar .tree");
  expect(await width(".sidebar")).toBe(340);
  expect(await width(".outline")).toBe(300);

  // Double-click puts the default width back.
  await page.locator('.splitter[data-panel="sidebar"]').dblclick();
  expect(await width(".sidebar")).toBe(240);
});

test("the changes view: its middle line can be dragged, and the headings and arrows line up with the text", async ({ page }) => {
  await start(page);
  await openFile(page, "tasks.md");
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("追記");
  await page.keyboard.press("Control+Shift+G");
  await page.waitForSelector(".cm-mergeView .diff-revert");
  const left = async (selector: string) => (await page.locator(selector).first().boundingBox())?.x ?? -1;

  // The strip between the two sides continues into the headings above it (it follows within a frame of any layout change).
  await expect.poll(async () => Math.abs((await left(".diff-cols-strip")) - (await left(".cm-merge-revert")))).toBeLessThan(1);

  // The arrow of a change sits on the changed line, not above it.
  const arrow = await page.locator(".diff-revert").first().boundingBox();
  const line = await page.locator(".cm-mergeViewEditor:last-child .cm-changedLine").first().boundingBox();
  if (!arrow || !line) throw new Error("no change shown");
  expect(arrow.y).toBeGreaterThanOrEqual(line.y);
  expect(arrow.y + arrow.height).toBeLessThanOrEqual(line.y + line.height + 1);

  // Drag the line between the two sides to the left: both the strip and the headings follow.
  const before = await left(".cm-merge-revert");
  const bar = await page.locator('.splitter[data-panel="diff"]').boundingBox();
  if (!bar) throw new Error("no divider in the changes view");
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 100);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 - 120, bar.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round(before - (await left(".cm-merge-revert")))).toBe(120);
  await expect.poll(async () => Math.abs((await left(".diff-cols-strip")) - (await left(".cm-merge-revert")))).toBeLessThan(1);
});

test("menus: nothing wraps, and switched-on items are ticked", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Control+Shift+T"); // typewriter mode on
  await page.locator(".toolbar .tg-more .dropdown > button").click();
  const items = page.locator(".toolbar .tg-more .menu-item");
  const heights = await items.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1); // every item is one line high
  await expect(items.filter({ hasText: "タイプライターモード" }).locator(".menu-check svg")).toHaveCount(1);
  await expect(items.filter({ hasText: "チートシート / ショートカット" }).locator(".menu-check svg")).toHaveCount(0);
  await expect(items.filter({ hasText: "タイプライターモード" })).toHaveAttribute("aria-checked", "true");
});

test("layout holds in a smaller window, in Japanese and English", async ({ browser }) => {
  for (const locale of ["ja-JP", "en-US"]) {
    const context = await browser.newContext({ locale, viewport: { width: 960, height: 700 } });
    const page = await context.newPage();
    await start(page);
    await openFile(page, "hello.md");

    // The toolbar stays one row, with nothing cut off at the right.
    const bar = await page.locator(".toolbar").boundingBox();
    expect(bar?.height, `${locale}: toolbar height`).toBeLessThan(45);
    const lastGroup = await page.locator(".toolbar .tg-more").boundingBox();
    expect((lastGroup?.x ?? 0) + (lastGroup?.width ?? 0), `${locale}: toolbar right edge`).toBeLessThanOrEqual(960);

    // With every side panel open, the text area keeps a usable width.
    await page.keyboard.press("Control+Shift+O");
    await page.keyboard.press("F1");
    await expect(page.locator(".cheatsheet")).toBeVisible();
    expect((await page.locator(".panes").boundingBox())?.width, `${locale}: text area`).toBeGreaterThanOrEqual(359);

    // The search panel: the close button sits on the first row, level with the find box.
    await editor(page).click();
    await page.keyboard.press("Control+F");
    const find = await page.locator(".cm-search input[name=search]").boundingBox();
    const close = await page.locator(".cm-search button[name=close]").boundingBox();
    if (!find || !close) throw new Error("no search panel");
    expect(Math.abs(find.y + find.height / 2 - (close.y + close.height / 2)), `${locale}: search close button`).toBeLessThan(2);
    await page.keyboard.press("Escape");

    // Settings: no option of a drop-down is wider than the drop-down itself.
    await page.keyboard.press("Control+Comma");
    await page.waitForSelector(".modal-footer");
    const cut = await page.locator(".modal select").evaluateAll((selects) =>
      selects.flatMap((el) => {
        const select = el as HTMLSelectElement;
        const style = getComputedStyle(select);
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return [];
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const widest = Math.max(...Array.from(select.options).map((o) => ctx.measureText(o.textContent ?? "").width));
        return widest + 30 > select.getBoundingClientRect().width + 1 ? [select.options[0].textContent] : [];
      }),
    );
    expect(cut, `${locale}: drop-downs with cut-off text`).toEqual([]);
    await page.keyboard.press("Escape");

    // The dialog that asks for a name: both buttons on one line, same height.
    await page.locator(".sidebar .panel-title .dropdown > button").click();
    await page.locator(".dropdown-menu .menu-item").first().click();
    const buttons = await page.locator(".modal .prompt-actions button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }));
    expect(new Set(buttons.map((b) => b.join("/"))).size, `${locale}: prompt buttons ${JSON.stringify(buttons)}`).toBe(1);
    await context.close();
  }
});

test("on a phone the changes view is one column, and a change can be put back", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, locale: "ja-JP" });
  const page = await context.newPage();
  await page.goto("/?token=e2e");
  await page.waitForSelector(".mobilebar");
  await page.locator(".mobilebar > button").first().click();
  await page.click('.tree-file[title="hello.md"]');
  await expect(page).toHaveTitle(/^hello\.md /);
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("added on the phone");
  await page.click(".mobilebar .dropdown > button");
  await page.locator(".mobilebar .menu-item").filter({ hasText: "変更箇所を表示" }).click();

  // One editor, not two side by side; the old text is shown with a button to put it back.
  await page.waitForSelector(".diff-body .cm-editor");
  await expect(page.locator(".diff-body .cm-mergeView")).toHaveCount(0);
  await expect(page.locator(".diff-cols")).toBeHidden();
  await expect(page.locator(".diff-count")).toHaveText("変更 1 箇所");
  const back = page.locator(".diff-revert-inline");
  await expect(back).toHaveText("この変更を元に戻す");
  await back.dispatchEvent("mousedown");
  await expect(page.locator(".diff-count")).toHaveText("違いはありません");
  await expect(page).toHaveTitle(/^hello\.md /); // no unsaved mark any more
  await context.close();
});

test("menus and dialogs opened from the sidebar look like the others", async ({ page }) => {
  await start(page);
  // The menu under the sidebar's "⋯" used to take over the heading's tiny bold capitals.
  await page.locator(".sidebar .panel-title .dropdown > button").click();
  const item = page.locator(".sidebar .panel-title .dropdown-menu .menu-item").first();
  const look = await item.evaluate((e) => { const s = getComputedStyle(e); return { size: s.fontSize, weight: s.fontWeight, height: Math.round(e.getBoundingClientRect().height) }; });
  expect(look.size).toBe("13px");
  expect(look.weight).toBe("400");
  expect(look.height).toBeGreaterThanOrEqual(26);
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 400);

  // Deleting asks with a red button, and Enter does not go for it by default.
  await page.hover('.tree-file[title="unsaved.md"]');
  await page.locator('.tree-file[title="unsaved.md"]').locator("xpath=..").locator(".dropdown > button").click();
  await page.locator(".dropdown-menu .menu-item").last().click();
  await page.waitForSelector(".modal.confirm");
  const del = page.locator(".modal.confirm .prompt-actions button").last();
  await expect(del).toHaveClass(/danger/);
  await expect(del).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator('.tree-file[title="unsaved.md"]')).toBeVisible();
});

test("on a phone the toolbar shows that it scrolls, and its menus open on screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, locale: "ja-JP" });
  const page = await context.newPage();
  await page.goto("/?token=e2e");
  await page.waitForSelector(".mobilebar");
  const bar = page.locator(".toolbar");

  // More to the right at first; after scrolling to the end, more to the left instead.
  await expect(bar).toHaveAttribute("data-more-right", "");
  await expect(page.locator(".toolbar-more.right")).toBeVisible();
  await expect(page.locator(".toolbar-more.left")).toBeHidden();
  await bar.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect(bar).toHaveAttribute("data-more-left", "");
  await expect(page.locator(".toolbar-more.right")).toBeHidden();
  await bar.evaluate((el) => { el.scrollLeft = 0; });

  // A menu of the bar used to open inside the scrolling bar, where it could not be seen.
  await page.locator(".toolbar .dropdown > button").nth(1).click();
  const menu = page.locator(".toolbar .dropdown-menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  if (!box) throw new Error("no menu");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const onTop = await menu.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 20, r.top + 16); return !!hit && el.contains(hit); });
  expect(onTop).toBe(true);
  await context.close();
});

test("a URL pasted over selected text follows the setting: ask, always a link, or plain", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  const thirdLine = () => page.locator(".pane-editor .cm-line").nth(2);
  const selectFirstWord = async () => {
    await editor(page).click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  };
  const paste = (text: string) =>
    page.evaluate((t) => {
      const data = new DataTransfer();
      data.setData("text/plain", t);
      document.querySelector(".pane-editor .cm-content")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  const setMode = async (label: string) => {
    await page.keyboard.press("Control+Comma");
    await page.locator(".modal label").filter({ hasText: "URL を選択範囲に貼り付けたとき" }).locator("select").selectOption({ label });
    await page.click(".modal-footer button.primary");
    await expect(page.locator(".modal")).toHaveCount(0);
  };
  const undo = async () => {
    await editor(page).click();
    await page.keyboard.press("Control+Z");
    await expect(thirdLine()).toHaveText("First paragraph.");
  };

  // Default: ask. Nothing changes until the question is answered.
  await selectFirstWord();
  await paste("https://example.com/a");
  await expect(page.locator(".modal.confirm")).toBeVisible();
  await expect(thirdLine()).toHaveText("First paragraph.");
  await page.locator(".modal.confirm button.primary").click();
  await expect(thirdLine()).toHaveText("[First](https://example.com/a) paragraph.");
  await undo();

  // Plain: the URL replaces the selection, no question, no link.
  await setMode("そのまま貼り付ける");
  await selectFirstWord();
  await paste("https://example.com/b");
  await expect(page.locator(".modal.confirm")).toHaveCount(0);
  await expect(thirdLine()).toHaveText("https://example.com/b paragraph.");
  await undo();

  // Always: a link at once.
  await setMode("常にリンクにする");
  await selectFirstWord();
  await paste("https://example.com/c");
  await expect(page.locator(".modal.confirm")).toHaveCount(0);
  await expect(thirdLine()).toHaveText("[First](https://example.com/c) paragraph.");
});

test("what the editor writes works in Japanese text, and nothing is written that was not typed", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  const lastLine = () => page.locator(".pane-editor .cm-line").last();
  const newLine = async (text: string) => {
    await editor(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(text);
  };

  // Italic uses "*": "_" does nothing between Japanese characters.
  await newLine("これは斜体です");
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+i");
  await expect(lastLine()).toHaveText("これは*斜体*です");
  await expect(page.locator(".preview em")).toHaveText("斜体");
  // ... and pressing it again takes the stars off; the stars of bold are left alone.
  await page.keyboard.press("Control+i");
  await expect(lastLine()).toHaveText("これは斜体です");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+i");
  await expect(lastLine()).toHaveText("これは***斜体***です");

  // An HTML tag is not closed behind the writer's back.
  await newLine("<div>中身</div>");
  await expect(lastLine()).toHaveText("<div>中身</div>");
});

test("saving a file that was not changed leaves it untouched", async ({ page }) => {
  await start(page);
  await openFile(page, "save-me.md");
  const before = statSync(join(workspace, "save-me.md")).mtimeMs;
  await editor(page).click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".toolbar-status")).toHaveText("変更はありません");
  expect(statSync(join(workspace, "save-me.md")).mtimeMs).toBe(before);
});

test("headings and list continuation put the marker where the writer expects it", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  const lines = () => page.locator(".pane-editor .cm-line").allTextContents();
  const clear = async () => {
    await editor(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
  };

  // The heading button on an empty line: what is typed next is the heading's text.
  await clear();
  await page.click(".toolbar .tb-heading >> nth=0");
  await page.keyboard.type("Title");
  expect(await lines()).toEqual(["# Title"]);
  await expect(page.locator(".preview h1")).toHaveText("Title");
  // ... and the shortcut with the cursor at the start of a line of text.
  await page.keyboard.press("Enter");
  await page.keyboard.type("abc");
  await page.keyboard.press("Home");
  await page.keyboard.press("Control+2");
  await page.keyboard.type("X");
  expect(await lines()).toEqual(["# Title", "## Xabc"]);

  // Continuing a list (Shift+Enter): ordinary text that starts like a marker is not a list item.
  for (const text of ["**注意** これは文です", "-5度です", "1.5 倍です", "---"]) {
    await clear();
    await page.keyboard.type(text);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Z");
    expect(await lines(), text).toEqual([text, "Z"]);
  }
  await clear();
  await page.keyboard.type("- item");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("next");
  expect(await lines()).toEqual(["- item", "- next"]);
  // In front of the marker it is a plain line break, not a second marker.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+Enter");
  expect(await lines()).toEqual(["- item", "", "- next"]);
});

test("the preview shows the HTML of a document, safely, and links inside the document work", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await editor(page).click();
  await page.keyboard.press("Control+a");
  const filler = Array.from({ length: 60 }, (_, i) => `段落 ${i}`).join("\n\n");
  await page.keyboard.insertText(
    [
      "[先頭へのリンク](#最後の見出し) と脚注[^1]",
      "",
      "| a |",
      "| - |",
      "| 1<br>2 |",
      "",
      "<kbd>Ctrl</kbd> <details><summary>詳細</summary>中身</details>",
      "",
      '<script>window.__hacked = 1</script><img src="x" onerror="window.__hacked = 2"><a href="javascript:window.__hacked=3">罠</a>',
      "",
      filler,
      "",
      "## 最後の見出し",
      "",
      "[^1]: 脚注の本文",
    ].join("\n"),
  );
  const preview = page.locator(".preview");
  await expect(preview.locator("td br")).toHaveCount(1);
  await expect(preview.locator("kbd")).toHaveText("Ctrl");
  await expect(preview.locator("details summary")).toHaveText("詳細");
  await expect(preview.locator("script, [onerror]")).toHaveCount(0);
  await preview.locator("a", { hasText: "罠" }).click();
  expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBeUndefined();

  // A link to a heading and a footnote reference both scroll the preview to their target.
  const top = () => preview.evaluate((el) => el.scrollTop);
  expect(await top()).toBe(0);
  await preview.locator("a", { hasText: "先頭へのリンク" }).click();
  await expect.poll(top).toBeGreaterThan(200);
  await preview.evaluate((el) => (el.scrollTop = 0));
  await preview.locator("sup a").click();
  await expect.poll(top).toBeGreaterThan(200);
  // The page itself did not go anywhere.
  expect(new URL(page.url()).hash).toBe("");
});

test("creating a file with a name that is taken does not empty the existing file", async ({ page }) => {
  await start(page);
  await page.locator(".sidebar .panel-title .dropdown > button").click();
  await page.locator(".sidebar .panel-title .dropdown-menu .menu-item", { hasText: "新規ファイル…" }).click();
  await page.fill(".modal input", "tasks.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".modal.confirm")).toContainText("同じ名前のフォルダかファイルが既にあります");
  await page.click(".modal.confirm button.primary");
  expect(onDisk("tasks.md")).toContain("- [ ] 一つ目");
});

test("typing, Enter and the format shortcuts write only what was asked for", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page);
  await openFile(page, "hello.md");
  const lines = () => page.locator(".pane-editor .cm-line").allTextContents();
  const fresh = async (text = "") => {
    await editor(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    if (text) await page.keyboard.insertText(text);
  };

  // Enter keeps the indentation as written and adds none of its own.
  await fresh("<div>");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  expect(await lines()).toEqual(["<div>", "x"]);
  await fresh("\tcode");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y");
  expect(await lines()).toEqual(["\tcode", "\ty"]);
  // In a code block "- old" is code, not a list item.
  await fresh("```diff\n- old");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("n");
  expect(await lines()).toEqual(["```diff", "- old", "n"]);

  // Tab puts a list item under the one above, whatever the width of its marker.
  await fresh("1. a\n2. b");
  await page.keyboard.press("Tab");
  expect(await lines()).toEqual(["1. a", "   1. b"]);
  await expect(page.locator(".preview ol ol li")).toHaveText("b");
  await page.keyboard.press("Shift+Tab");
  expect(await lines()).toEqual(["1. a", "2. b"]);

  // Bold: the second press steps out of the markers; a whole-line selection keeps the line break outside.
  await fresh("foo ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("bold");
  await page.keyboard.press("Control+b");
  await page.keyboard.type(" after");
  expect(await lines()).toEqual(["foo **bold** after"]);
  await fresh("first line\nsecond line");
  await page.locator(".pane-editor .cm-line").first().click({ clickCount: 3 });
  await page.keyboard.press("Control+b");
  expect(await lines()).toEqual(["**first line**", "second line"]);
  await page.locator(".pane-editor .cm-line").last().click({ clickCount: 3 });
  await page.keyboard.press("Control+1");
  expect(await lines()).toEqual(["**first line**", "# second line"]);

  // The link command followed by pasting the address: no question, no link inside the link.
  await page.evaluate(() => navigator.clipboard.writeText("https://example.com/page"));
  await fresh("see docs here");
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".pane-editor .cm-line")).toHaveText("see [docs](https://example.com/page) here");
  await expect(page.locator(".modal.confirm")).toHaveCount(0);

  // Search and replace take what is typed literally unless "regexp" is ticked.
  await fresh("角度 θ と \\theta");
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search input[name=search]").click();
  await page.keyboard.type("\\theta");
  await expect(page.locator(".pane-editor .cm-searchMatch")).toHaveCount(1);
  await page.locator(".cm-search input[name=replace]").click();
  await page.keyboard.type("\\tau");
  await page.locator(".cm-search button[name=replaceAll]").click();
  await page.keyboard.press("Escape");
  expect(await lines()).toEqual(["角度 θ と \\tau"]);
});

test("a full-width heading marker typed through the IME becomes a half-width one, once", async ({ page, context }) => {
  await start(page);
  await openFile(page, "hello.md");
  const cdp = await context.newCDPSession(page);
  const lines = () => page.locator(".pane-editor .cm-line").allTextContents();
  const compose = async (text: string) => {
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await page.waitForTimeout(60);
    await cdp.send("Input.insertText", { text });
    await page.waitForTimeout(150);
  };
  const fresh = async (text = "") => {
    await editor(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    if (text) await page.keyboard.insertText(text);
  };
  await fresh();
  await compose("＃");
  expect(await lines()).toEqual(["#"]);
  await fresh();
  await compose("＃＃　見出し");
  expect(await lines()).toEqual(["## 見出し"]);
  // Not where no heading would come of it, and not in code.
  await fresh("タグ");
  await page.keyboard.press("Home");
  await compose("＃");
  expect(await lines()).toEqual(["＃タグ"]);
  await fresh("```\n");
  await compose("＃");
  expect(await lines()).toEqual(["```", "＃"]);
});

test("settings: a font size can be typed, and a setting that is only tried out starts nothing", async ({ page }) => {
  await start(page);
  await openFile(page, "save-me.md");
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("unsaved");
  await page.keyboard.press("Control+Comma");
  const size = page.locator(".modal label").filter({ hasText: "エディタのフォントサイズ" }).locator("input");
  await size.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("12");
  await expect(size).toHaveValue("12");
  await expect(page.locator(".pane-editor .cm-content")).toHaveCSS("font-size", "12px");
  // Autosave chosen in the dialog but not saved: the file is not written.
  const before = onDisk("save-me.md");
  await page.locator(".modal label").filter({ hasText: "自動保存" }).locator("select").selectOption({ index: 1 });
  await page.waitForTimeout(6000);
  expect(onDisk("save-me.md")).toBe(before);
  await page.click(".modal-footer button.secondary");
  await expect(page.locator(".pane-editor .cm-content")).toHaveCSS("font-size", "14px");
});

test("the changes view keeps the cursor when the file is saved, and shares the editor's undo", async ({ page }) => {
  await start(page);
  await openFile(page, "unsaved.md");
  await page.keyboard.press("Control+Shift+g");
  await page.locator(".diff .segmented button").nth(1).click();
  const right = page.locator(".diff .cm-content").last();
  await right.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("AAA");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".toolbar-status")).toHaveText("保存しました");
  await page.keyboard.type("BBB");
  await expect(right).toContainText("AAABBB");
  expect(onDisk("unsaved.md")).toBe("# Unsaved\nAAA");
  // Undo here and then in the editor: what was undone stays undone.
  await page.keyboard.press("Control+z");
  await expect(right).not.toContainText("BBB");
  await page.keyboard.press("Escape");
  await editor(page).click();
  await page.keyboard.press("Control+z");
  await expect(editor(page)).not.toContainText("BBB");
});

test("saving under a name that exists asks first, and a name with a dot still gets its extension", async ({ page }) => {
  await start(page);
  await openFile(page, "hello.md");
  await page.keyboard.press("Control+Shift+h");
  await page.locator(".modal.picker input").fill("exported");
  await page.keyboard.press("Enter");
  await expect(page.locator(".toolbar-status")).toHaveText("HTML を書き出しました");
  const first = statSync(join(workspace, "exported.html")).mtimeMs;
  // Again under the same name: the question comes, and "cancel" leaves the file as it is.
  await page.keyboard.press("Control+Shift+h");
  await page.locator(".modal.picker input").fill("exported");
  await page.keyboard.press("Enter");
  await expect(page.locator(".modal.confirm")).toContainText("既にあります");
  await page.locator(".modal.confirm .prompt-actions button").first().click();
  expect(statSync(join(workspace, "exported.html")).mtimeMs).toBe(first);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+s");
  await page.locator(".modal.picker input").fill("notes 2026.11");
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(/^notes 2026\.11\.md /);
  expect(onDisk("notes 2026.11.md")).toContain("# Hello");
});

test("split view: the cursor's line is at the same height on both sides, and marked in the preview", async ({ page }) => {
  await start(page);
  await openFile(page, "long.md");
  const heights = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(".pane-editor .cm-scroller") as HTMLElement;
      const preview = document.querySelector(".preview") as HTMLElement;
      const line = document.querySelector(".pane-editor .cm-activeLine");
      const mark = preview.querySelector(".cursor-block");
      return {
        editor: line ? Math.round(line.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : null,
        preview: mark ? Math.round(mark.getBoundingClientRect().top - preview.getBoundingClientRect().top) : null,
        marked: mark?.textContent ?? null,
        editorScroll: Math.round(scroller.scrollTop),
        previewScroll: Math.round(preview.scrollTop),
        // How much empty space there is between the end of the preview's text and the bottom of the pane.
        blankUnderText: preview.lastElementChild ? Math.round(preview.getBoundingClientRect().bottom - preview.lastElementChild.getBoundingClientRect().bottom) : 0,
      };
    });
  const level = async () => {
    await expect.poll(async () => { const h = await heights(); return h.editor != null && h.preview != null ? Math.abs(h.editor - h.preview) : 99; }).toBeLessThanOrEqual(6);
    return heights();
  };

  // To the very end of the editor: the end of the preview's text is then at the bottom of its pane, not the
  // empty space under it. Scrolled again on every look, since the editor learns the real height of the text
  // only as it gets there (a person keeps turning the wheel).
  const endsTogether = () =>
    expect
      .poll(async () => {
        await page.locator(".pane-editor .cm-scroller").evaluate((e) => (e.scrollTop = e.scrollHeight));
        await page.waitForTimeout(150);
        const blank = (await heights()).blankUnderText;
        return blank >= 0 && blank < 80;
      })
      .toBe(true);

  // Click a heading: its block in the preview comes to the same height and carries the mark.
  await page.locator(".pane-editor .cm-line", { hasText: "## 第2章" }).click();
  expect((await level()).marked).toBe("第2章");
  // Typing does not move the preview away.
  await page.keyboard.press("End");
  await page.keyboard.type(" 追記");
  await expect(page.locator(".preview .cursor-block")).toHaveText("第2章 追記");
  await level();

  // Scrolling: the text at that height stays level, and the mark stays on the cursor's block.
  const box = (await page.locator(".pane-editor .cm-scroller").boundingBox()) as { x: number; y: number };
  await page.mouse.move(box.x + 200, box.y + 200);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await heights()).previewScroll).toBeGreaterThan(400);
  expect((await heights()).marked).toBe("第2章 追記");
  // The ends of the document belong together.
  await endsTogether();
  await page.locator(".pane-editor .cm-scroller").evaluate((e) => (e.scrollTop = 0));
  await expect.poll(async () => (await heights()).previewScroll).toBe(0);

  // The preview scrolled by hand stays where it was put; clicking in it moves nothing.
  await page.locator(".preview").evaluate((e) => (e.scrollTop = 900));
  await page.waitForTimeout(300);
  expect((await heights()).previewScroll).toBe(900);
  await page.locator(".preview").click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(300);
  expect((await heights()).previewScroll).toBe(900);

  // A double click in the preview: the editor comes level with that block, the preview stays.
  const para = page.locator(".preview p", { hasText: "第4章の段落 1。" });
  await para.scrollIntoViewIfNeeded();
  const before = (await heights()).previewScroll;
  await para.dblclick({ position: { x: 20, y: 8 } });
  await level();
  expect(Math.abs((await heights()).previewScroll - before)).toBeLessThanOrEqual(2);

  // The "..." menu switches it off (no mark) and on again, with a tick; the choice is kept.
  const toggle = async (checkedBefore: boolean) => {
    await page.locator(".toolbar .tg-more .dropdown > button").click();
    const item = page.locator(".dropdown-menu .menu-item", { hasText: "カーソルの位置で左右をそろえる" });
    await expect(item).toHaveAttribute("aria-checked", String(checkedBefore));
    await item.click();
  };
  await toggle(true);
  await expect(page.locator(".preview .cursor-block")).toHaveCount(0);
  expect((await stored(page)).levelPanes).toBe(false);
  // Switched off, the panes follow each other by how far through the text they are: the ends still belong together.
  await endsTogether();
  await page.locator(".pane-editor .cm-scroller").evaluate((e) => (e.scrollTop = 0));
  await expect.poll(async () => (await heights()).previewScroll).toBe(0);
  await toggle(false);
  await expect(page.locator(".preview .cursor-block")).toHaveCount(1);
  await page.locator(".pane-editor .cm-line", { hasText: "## 第1章" }).click();
  expect((await level()).marked).toBe("第1章");
});
