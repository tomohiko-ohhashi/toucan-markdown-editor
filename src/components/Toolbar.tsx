import { useEffect, useRef, useState } from "react";
import { useDocStore, selectActiveDoc, selectActiveIsDirty, fileName, type ViewMode } from "../store/useDocStore";
import { useSettings } from "../store/useSettings";
import { newDocument, openDocument, saveDocument, saveDocumentAs } from "../features/files/fileOps";
import { exportHtml, exportPdf } from "../features/export";
import { editorRef } from "../editor/Editor";
import { toggleBold, toggleItalic, toggleCode, insertLink, setHeading } from "../editor/formatting";
import {
  insertTable,
  tableFormat,
  tableAddRowBelow,
  tableDeleteRow,
  tableAddColumnRight,
  tableDeleteColumn,
  tableCycleAlign,
} from "../editor/table";
import { Dropdown } from "./Dropdown";
import { formatDocument } from "../editor/format";
import { flashStatus } from "../store/useDocStore";
import type { StateCommand } from "@codemirror/state";
import { t } from "../i18n";
import { IconTreeClosed, IconH1, IconH2, IconH3, IconBold, IconItalic, IconCode, IconLink, IconSidebar, IconOutline, IconHelp, IconCheck } from "./icons";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";
const alt = isMac ? "⌥" : "Alt+";

function runFormat() {
  const view = editorRef.view;
  if (!view) return;
  void formatDocument(view).then((changed) => {
    flashStatus(changed ? t("ドキュメントを整形しました") : t("整形の必要はありませんでした"));
    view.focus();
  });
}

function runInEditor(cmd: StateCommand) {
  const view = editorRef.view;
  if (!view) return;
  cmd(view);
  view.focus();
}

// A function, so the labels follow the UI language.
const viewModes = (): { mode: ViewMode; label: string; title: string }[] => [
  { mode: "editor", label: t("編集"), title: t("エディタのみ ({0}{1}1)", mod, shift) },
  { mode: "split", label: t("分割"), title: t("分割表示 ({0}{1}2)", mod, shift) },
  { mode: "preview", label: t("プレビュー"), title: t("プレビューのみ ({0}{1}3)", mod, shift) },
];

function TableInsert({ close }: { close: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <div className="table-insert">
      <label>{t("行")} <input type="number" min={1} max={50} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} /></label>
      <label>{t("列")} <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Number(e.target.value) || 1)} /></label>
      <button
        onClick={() => {
          if (editorRef.view) insertTable(editorRef.view, rows, cols);
          close();
        }}
      >
        {t("挿入")}
      </button>
    </div>
  );
}


/**
 * The tick in front of a menu item that is switched on. Every item of a menu
 * with such switches gets one (empty when it does not apply), so the labels line up.
 */
export function MenuCheck({ on }: { on?: boolean }) {
  return <span className="menu-check" aria-hidden="true">{on ? <IconCheck /> : null}</span>;
}

export function Toolbar() {
  const doc = useDocStore(selectActiveDoc);
  const dirty = useDocStore(selectActiveIsDirty);
  const viewMode = useDocStore((s) => s.viewMode);
  const setViewMode = useDocStore((s) => s.setViewMode);
  const status = useDocStore((s) => s.status);
  const toggle = useDocStore((s) => s.toggle);
  const showSidebar = useDocStore((s) => s.showSidebar);
  const showOutline = useDocStore((s) => s.showOutline);
  const cheatSheetOpen = useDocStore((s) => s.cheatSheetOpen);
  const typewriterMode = useDocStore((s) => s.typewriterMode);
  const diffOpen = useDocStore((s) => s.diffOpen);
  const levelPanes = useSettings((s) => s.levelPanes);
  const toggleLevel = () => useSettings.getState().update({ levelPanes: !useSettings.getState().levelPanes });
  const recent = useSettings((s) => s.recentFiles);
  const clearRecent = useSettings((s) => s.clearRecent);
  // On a phone the bar scrolls sideways; mark whether there is more to either side, so the edges can show it.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const update = () => {
      const scrolls = el.scrollWidth - el.clientWidth > 2;
      el.toggleAttribute("data-more-left", scrolls && el.scrollLeft > 2);
      el.toggleAttribute("data-more-right", scrolls && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <header className="toolbar" ref={bar}>
      <span className="toolbar-more left" aria-hidden="true"><IconTreeClosed size={14} /></span>
      <div className="toolbar-group tg-file">
        <button onClick={() => newDocument()} title={t("新規 ({0}N)", mod)}>{t("新規")}</button>
        <button onClick={() => openDocument()} title={t("開く ({0}O)", mod)}>{t("開く")}</button>
        <Dropdown label={t("最近")} title={t("最近使ったファイル")}>
          {(close) => (
            <>
              {recent.length === 0 && <div className="menu-empty">{t("履歴はありません")}</div>}
              {recent.map((p) => (
                <button key={p} className="menu-item two-line" title={p} onClick={() => { close(); void openDocument(p); }}>
                  <span className="menu-main">{fileName(p)}</span>
                  {p !== fileName(p) && <span className="menu-sub">{p}</span>}
                </button>
              ))}
              {recent.length > 0 && (
                <>
                  <hr />
                  <button className="menu-item" onClick={() => { close(); clearRecent(); }}>{t("履歴を消去")}</button>
                </>
              )}
            </>
          )}
        </Dropdown>
        <button onClick={() => saveDocument()} title={t("保存 ({0}S)", mod)}>{t("保存")}</button>
        <Dropdown label={t("書き出し")} title={t("書き出し")}>
          {(close) => (
            <>
              <button className="menu-item" onClick={() => { close(); void saveDocumentAs(); }}>{t("名前を付けて保存…")} <kbd>{mod}{shift}S</kbd></button>
              <button className="menu-item" onClick={() => { close(); void exportHtml(); }}>{t("HTML として書き出す…")} <kbd>{mod}{shift}H</kbd></button>
              <button className="menu-item" onClick={() => { close(); void exportPdf(); }}>{t("印刷 / PDF…")} <kbd>{mod}P</kbd></button>
            </>
          )}
        </Dropdown>
      </div>

      <div className="toolbar-group tg-format">
        <button className="tb-heading" onClick={() => runInEditor(setHeading(1))} title={t("見出し1 ({0}1)", mod)}><IconH1 /></button>
        <button className="tb-heading" onClick={() => runInEditor(setHeading(2))} title={t("見出し2 ({0}2)", mod)}><IconH2 /></button>
        <button className="tb-heading" onClick={() => runInEditor(setHeading(3))} title={t("見出し3 ({0}3)", mod)}><IconH3 /></button>
        <button onClick={() => runInEditor(toggleBold)} title={t("太字 ({0}B)", mod)}><IconBold /></button>
        <button onClick={() => runInEditor(toggleItalic)} title={t("斜体 ({0}I)", mod)}><IconItalic /></button>
        <button onClick={() => runInEditor(toggleCode)} title={t("コード ({0}E)", mod)}><IconCode /></button>
        <button onClick={() => runInEditor(insertLink)} title={t("リンク ({0}K)", mod)}><IconLink /></button>
        <Dropdown label={t("表")} title={t("表の挿入と編集")}>
          {(close) => (
            <>
              <div className="menu-label">{t("新しい表を挿入")}</div>
              <TableInsert close={close} />
              <hr />
              <div className="menu-label">{t("カーソル位置の表")}</div>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableFormat); }}>{t("列幅を整える")}</button>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableAddRowBelow); }}>{t("下に行を追加")}</button>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableDeleteRow); }}>{t("この行を削除")}</button>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableAddColumnRight); }}>{t("右に列を追加")}</button>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableDeleteColumn); }}>{t("この列を削除")}</button>
              <button className="menu-item" onClick={() => { close(); runInEditor(tableCycleAlign); }}>{t("列の配置を切替 (左/中央/右)")}</button>
              <div className="menu-hint">{t("表の中では Tab / Shift+Tab でセルを移動できます。最後のセルで Tab を押すと行が増えます。")}</div>
            </>
          )}
        </Dropdown>
        <button onClick={runFormat} title={t("ドキュメント全体を整形 ({0}{1}F)", shift, alt)}>{t("整形")}</button>
      </div>

      <div className="toolbar-title" title={doc.path ?? ""}>
        {dirty ? "● " : ""}{fileName(doc.path)}
        {status && <span className="toolbar-status">{status}</span>}
      </div>

      <div className="toolbar-group tg-panels">
        <button className={showSidebar ? "active" : ""} onClick={() => toggle("showSidebar")} title={t("サイドバー (ファイル一覧) の表示切替 ({0}{1}E)", mod, shift)}><IconSidebar /></button>
        <button className={showOutline ? "active" : ""} onClick={() => toggle("showOutline")} title={t("アウトラインの表示切替 ({0}{1}O)", mod, shift)}><IconOutline /></button>
        <button className={cheatSheetOpen ? "active" : ""} onClick={() => toggle("cheatSheetOpen")} title={t("チートシートの表示切替 (F1)")}><IconHelp /></button>
      </div>
      <div className="toolbar-group segmented tg-view">
        {viewModes().map((v) => (
          <button key={v.mode} className={!diffOpen && viewMode === v.mode ? "active" : ""} onClick={() => setViewMode(v.mode)} title={v.title}>
            {v.label}
          </button>
        ))}
        {/* The changes view is a fourth way to look at the document. */}
        <button className={diffOpen ? "active" : ""} onClick={() => toggle("diffOpen")} title={t("変更箇所を表示 (最初に開いたとき / 保存済みとの差分) ({0}{1}G)", mod, shift)}>
          {t("差分")}
        </button>
      </div>
      <div className="toolbar-group tg-more">
        <Dropdown label="" title={t("その他")} align="right">
          {(close) => (
            <>
              <button className="menu-item" role="menuitemcheckbox" aria-checked={false} onClick={() => { close(); toggle("focusMode"); }}><MenuCheck />{t("フォーカスモード")} <kbd>{mod}{shift}D</kbd></button>
              <button className="menu-item" role="menuitemcheckbox" aria-checked={typewriterMode} onClick={() => { close(); toggle("typewriterMode"); }}><MenuCheck on={typewriterMode} />{t("タイプライターモード")} <kbd>{mod}{shift}T</kbd></button>
              <button className="menu-item" role="menuitemcheckbox" aria-checked={levelPanes} onClick={() => { close(); toggleLevel(); }}><MenuCheck on={levelPanes} />{t("カーソルの位置で左右をそろえる")}</button>
              <hr />
              <button className="menu-item" role="menuitemcheckbox" aria-checked={cheatSheetOpen} onClick={() => { close(); toggle("cheatSheetOpen"); }}><MenuCheck on={cheatSheetOpen} />{t("チートシート / ショートカット")} <kbd>F1</kbd></button>
              <button className="menu-item" onClick={() => { close(); toggle("settingsOpen"); }}><MenuCheck />{t("設定…")} <kbd>{mod},</kbd></button>
              <button className="menu-item" onClick={() => { close(); toggle("aboutOpen"); }}><MenuCheck />{t("バージョン情報…")}</button>
            </>
          )}
        </Dropdown>
      </div>
      <span className="toolbar-more right" aria-hidden="true"><IconTreeClosed size={14} /></span>
    </header>
  );
}

/**
 * Bottom bar shown instead of the status bar on phones: the controls that
 * must stay reachable without scrolling the (overflowing) toolbar.
 */
export function MobileBar() {
  const viewMode = useDocStore((s) => s.viewMode);
  const setViewMode = useDocStore((s) => s.setViewMode);
  const toggle = useDocStore((s) => s.toggle);
  const showSidebar = useDocStore((s) => s.showSidebar);
  const showOutline = useDocStore((s) => s.showOutline);
  const diffOpen = useDocStore((s) => s.diffOpen);
  const typewriterMode = useDocStore((s) => s.typewriterMode);
  const cheatSheetOpen = useDocStore((s) => s.cheatSheetOpen);
  const dirty = useDocStore(selectActiveIsDirty);
  return (
    <nav className="mobilebar">
      <button className={showSidebar ? "active" : ""} onClick={() => toggle("showSidebar")} title={t("フォルダ")} aria-label={t("フォルダ")}><IconSidebar size={20} /></button>
      <button className={showOutline ? "active" : ""} onClick={() => toggle("showOutline")} title={t("アウトライン")} aria-label={t("アウトライン")}><IconOutline size={20} /></button>
      <div className="segmented">
        {viewModes().map((v) => (
          <button key={v.mode} className={viewMode === v.mode ? "active" : ""} onClick={() => setViewMode(v.mode)} title={v.title}>
            {v.mode === "preview" ? t("閲覧") : v.label}
          </button>
        ))}
      </div>
      <button className={dirty ? "attention" : ""} onClick={() => saveDocument()} title={t("保存")}>
        {dirty ? t("● 保存") : t("保存")}
      </button>
      <Dropdown label="" title={t("その他")} align="right" up>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => { close(); void saveDocumentAs(); }}><MenuCheck />{t("名前を付けて保存…")}</button>
            <button className="menu-item" onClick={() => { close(); void exportHtml(); }}><MenuCheck />{t("HTML として書き出す…")}</button>
            <button className="menu-item" onClick={() => { close(); void exportPdf(); }}><MenuCheck />{t("印刷 / PDF…")}</button>
            <hr />
            <button className="menu-item" onClick={() => { close(); runFormat(); }}><MenuCheck />{t("ドキュメント全体を整形")}</button>
            <button className="menu-item" role="menuitemcheckbox" aria-checked={diffOpen} onClick={() => { close(); toggle("diffOpen"); }}><MenuCheck on={diffOpen} />{t("変更箇所を表示")}</button>
            <button className="menu-item" role="menuitemcheckbox" aria-checked={false} onClick={() => { close(); toggle("focusMode"); }}><MenuCheck />{t("フォーカスモード")}</button>
            <button className="menu-item" role="menuitemcheckbox" aria-checked={typewriterMode} onClick={() => { close(); toggle("typewriterMode"); }}><MenuCheck on={typewriterMode} />{t("タイプライターモード")}</button>
            <button className="menu-item" role="menuitemcheckbox" aria-checked={cheatSheetOpen} onClick={() => { close(); toggle("cheatSheetOpen"); }}><MenuCheck on={cheatSheetOpen} />{t("チートシート / ショートカット")}</button>
            <button className="menu-item" onClick={() => { close(); toggle("settingsOpen"); }}><MenuCheck />{t("設定…")}</button>
            <button className="menu-item" onClick={() => { close(); toggle("aboutOpen"); }}><MenuCheck />{t("バージョン情報…")}</button>
          </>
        )}
      </Dropdown>
    </nav>
  );
}
