import { useEffect, useLayoutEffect, useState } from "react";
import { create } from "zustand";
import { platform } from "../platform";
import type { DirEntry } from "../platform";
import { dirName, fileName } from "../store/useDocStore";
import { t, tError } from "../i18n";
import { isImagePath } from "../preview/paths";
import { IconClose, IconHome, IconFolder, IconFile } from "./icons";

interface PickerRequest {
  mode: "open" | "save";
  defaultPath?: string;
  extensions?: string[];
}

interface PickerState {
  request: PickerRequest | null;
  resolve: ((path: string | null) => void) | null;
}

const usePickerStore = create<PickerState>(() => ({ request: null, resolve: null }));

/**
 * In-app replacement for the OS open/save dialogs (web mode). Resolves with
 * the chosen root-relative path, or null when cancelled.
 */
export function openPicker(request: PickerRequest): Promise<string | null> {
  return new Promise((resolve) => {
    usePickerStore.getState().resolve?.(null); // cancel a previous one
    usePickerStore.setState({ request, resolve });
  });
}

function finish(path: string | null) {
  const { resolve } = usePickerStore.getState();
  usePickerStore.setState({ request: null, resolve: null });
  resolve?.(path);
}

export function FilePicker() {
  const request = usePickerStore((s) => s.request);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Before the dialog is shown, not a moment after: what was typed into the name at once (a
  // test does that, a person with a fast hand might) was replaced by the suggested name again.
  useLayoutEffect(() => {
    if (!request) return;
    const def = request.defaultPath ?? "";
    const d = def.includes("/") ? dirName(def) : "";
    setDir(d === def ? "" : d);
    setName(request.mode === "save" ? fileName(def === "" ? "untitled.md" : def) : "");
    setError(null);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setEntries(null);
    platform
      .readDir(dir)
      .then((e) => {
        // The tree also lists images; only folders and documents can be opened or overwritten here.
        if (!cancelled) setEntries(e.filter((x) => x.is_dir || !isImagePath(x.path)));
      })
      .catch((e) => {
        if (!cancelled) {
          setEntries([]);
          setError(tError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request, dir]);

  if (!request) return null;

  const crumbs = dir ? dir.split("/") : [];
  const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
  const ext = request.extensions?.[0];
  const submitSave = async () => {
    let n = name.trim();
    if (!n) return;
    // The wanted extension is added unless the name ends in it (for a document: in any kind of
    // document). A dot alone does not make an extension: "notes 2026.11" is "notes 2026.11.md".
    const kinds = ext === "md" ? "md|markdown|mdown|mkd|txt" : (request.extensions ?? []).join("|");
    if (ext && ext !== "*" && !new RegExp(`\\.(${kinds})$`, "i").test(n)) n += `.${ext}`;
    if (/[\\/]/.test(n)) {
      setError(t("ファイル名にスラッシュは使えません"));
      return;
    }
    const target = join(dir, n);
    // Asked of the server, not of the list on screen: the list leaves out images and other
    // kinds of files, which would then be overwritten without a question.
    let exists = true;
    try {
      await platform.fileMtime(target);
    } catch {
      exists = false;
    }
    if (exists) {
      const overwrite = await platform.ask(t("「{0}」は既にあります。上書きしますか？", n), {
        title: t("名前を付けて保存"),
        kind: "warning",
        okLabel: t("上書きする"),
        cancelLabel: t("キャンセル"),
      });
      if (!overwrite) return;
    }
    finish(target);
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => finish(null)}>
      <div className="modal picker" onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <h2>{request.mode === "open" ? t("ファイルを開く") : t("名前を付けて保存")}</h2>
          <button onClick={() => finish(null)} title={t("閉じる")}><IconClose /></button>
        </div>
        <div className="picker-crumbs">
          <button onClick={() => setDir("")} title={t("最上位のフォルダ")} aria-label={t("最上位のフォルダ")}><IconHome /></button>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span className="sep">/</span>
              <button onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
            </span>
          ))}
        </div>
        <ul className="picker-list">
          {entries === null && <li className="panel-empty">{t("読み込み中…")}</li>}
          {error && <li className="panel-empty">{error}</li>}
          {entries?.map((e) => (
            <li key={e.path}>
              <button
                className={e.is_dir ? "picker-dir" : "picker-file"}
                onClick={() => {
                  if (e.is_dir) setDir(e.path);
                  else if (request.mode === "open") finish(e.path);
                  else setName(e.name);
                }}
              >
                {e.is_dir ? <IconFolder /> : <IconFile />} {e.name}
              </button>
            </li>
          ))}
          {entries && entries.length === 0 && !error && <li className="panel-empty">{t("(空のフォルダ)")}</li>}
        </ul>
        {request.mode === "open" && (
          <div className="modal-footer">
            <button className="secondary" onClick={() => finish(null)}>{t("キャンセル")}</button>
          </div>
        )}
        {request.mode === "save" && (
          <div className="picker-save modal-footer">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSave();
              }}
              placeholder={t("ファイル名")}
              autoFocus
            />
            <button className="secondary" onClick={() => finish(null)}>{t("キャンセル")}</button>
            <button className="primary" onClick={submitSave}>{t("保存")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
