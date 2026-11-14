import { useState } from "react";
import { useDocStore } from "../store/useDocStore";
import { t } from "../i18n";
import { inTauri } from "../platform";
import { IconClose } from "./icons";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";
const shift = isMac ? "⇧" : "Shift";
const k = (...keys: string[]) => keys.join(isMac ? "" : "+");

// Built while rendering so the rows follow the UI language.
const syntaxRows = (): [string, string][] => [
  [t("# 見出し1 / ## 見出し2 / ### 見出し3"), t("見出し（# の数でレベル、# の後に半角スペース）")],
  [t("**太字**  *斜体*  ~~取り消し線~~"), t("強調")],
  [t("`コード`"), t("インラインコード")],
  [t("```js\nコード\n```"), t("コードブロック（言語名でハイライト）")],
  [t("- 項目\n- 項目\n  - ネスト"), t("箇条書き")],
  [t("1. 項目\n2. 項目"), t("番号付きリスト")],
  [t("- [ ] 未完了\n- [x] 完了"), t("タスクリスト")],
  [t("> 引用"), t("引用")],
  [t("[テキスト](https://example.com)"), t("リンク")],
  [t("![代替テキスト](assets/image.png)"), t("画像（貼り付け/ドロップで自動挿入）")],
  [t("| 列1 | 列2 |\n| --- | --- |\n| a | b |"), t("表")],
  ["---", t("水平線")],
  ["$E = mc^2$", t("インライン数式（KaTeX）")],
  ["$$\n\\int_0^1 x^2 dx\n$$", t("ブロック数式")],
  ["```mermaid\ngraph LR\n  A --> B\n```", t("Mermaid 図")],
  [t("脚注[^1]\n\n[^1]: 注の本文"), t("脚注")],
  [t("行末にスペース2つ  "), t("改行")],
  [t("Shift+Enter (設定で変更可)"), t("リスト・引用の続きの行を作る。番号は自動で増える")],
  [t("URL を貼り付け (文字を選択中)"), t("選択した文字をその URL へのリンクにする (設定で動作を変更可)")],
];

const shortcutRows = (): [string, string][] => [
  [k(mod, "N"), t("新規タブ")],
  [k(mod, "O"), t("ファイルを開く")],
  [k(mod, "S"), t("保存")],
  [k(mod, shift, "S"), t("名前を付けて保存")],
  [k(mod, "W"), t("タブを閉じる")],
  [`${k("Ctrl", "Tab")} / ${k("Ctrl", shift, "Tab")}`, t("次 / 前のタブ")],
  [k(mod, "F"), t("検索・置換")],
  [k(mod, "Z") + " / " + k(mod, shift, "Z"), t("元に戻す / やり直す")],
  [k(mod, "B") + " / " + k(mod, "I") + " / " + k(mod, "E"), t("太字 / 斜体 / コード")],
  [k(mod, "K"), t("リンクを挿入")],
  [k(shift, isMac ? "⌥" : "Alt", "F"), t("ドキュメント全体を整形 (記号や表の列幅を統一)")],
  [k(mod, "1") + " / " + k(mod, "2") + " / " + k(mod, "3"), t("見出し 1 / 2 / 3 の切替")],
  [k(mod, shift, "1") + " / 2 / 3", t("編集 / 分割 / プレビュー表示")],
  [k(mod, shift, "E"), t("サイドバー（フォルダ）")],
  [k(mod, shift, "O"), t("アウトライン")],
  [k(mod, shift, "F"), t("ワークスペースを全文検索")],
  [k(mod, shift, "G"), t("変更箇所を表示 (最初に開いたとき / 保存済みとの差分)")],
  [k(mod, shift, "D"), t("フォーカスモード")],
  [k(mod, shift, "T"), t("タイプライターモード")],
  [k(mod, shift, "L"), t("カーソルの位置で左右をそろえる (分割表示)")],
  [k(mod, shift, "H"), t("HTML を書き出す")],
  [k(mod, "P"), t("印刷 / PDF")],
  // In a browser these keys are the browser's own zoom.
  ...(inTauri ? [[`${k(mod, "+")} / ${k(mod, "-")} / ${k(mod, "0")}`, t("文字を大きく / 小さく / 元の大きさに戻す")] as [string, string]] : []),
  [k(mod, ","), t("設定")],
  ["F1 / " + k(mod, shift, "/"), t("このチートシートを開く / 閉じる")],
  ["Esc", t("フォーカスモードを終了 / 設定を閉じる")],
  [t("右上の「✕ フォーカス解除」 / 右クリック"), t("フォーカスモードを終了 (Esc 以外の方法)")],
];

/**
 * Side panel (right of the outline) with the Markdown syntax and the keyboard
 * shortcuts, so it can stay open next to the text while writing.
 */
export function CheatSheet() {
  const toggle = useDocStore((s) => s.toggle);
  const [tab, setTab] = useState<"syntax" | "keys">("syntax");
  const rows = tab === "syntax" ? syntaxRows() : shortcutRows();
  return (
    <aside className="cheatsheet" aria-label={t("チートシート")}>
      <div className="panel-title">
        <span>{t("チートシート")}</span>
        <span className="panel-actions">
          <button onClick={() => toggle("cheatSheetOpen")} title={t("閉じる (F1)")} aria-label={t("チートシートを閉じる")}><IconClose /></button>
        </span>
      </div>
      <div className="cheat-tabs segmented" role="tablist">
        <button role="tab" aria-selected={tab === "syntax"} className={tab === "syntax" ? "active" : ""} onClick={() => setTab("syntax")}>
          {t("Markdown 記法")}
        </button>
        <button role="tab" aria-selected={tab === "keys"} className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>
          {t("ショートカット")}
        </button>
      </div>
      <dl className="cheat-list">
        {rows.map(([a, b]) => (
          <div key={a} className="cheat-row">
            <dt>{tab === "syntax" ? <pre>{a}</pre> : <kbd>{a}</kbd>}</dt>
            <dd>{b}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
