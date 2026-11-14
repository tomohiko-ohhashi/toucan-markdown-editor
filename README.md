# Toucan Markdown Editor

macOS / Linux / Windows で動く、単独で動作する Markdown エディタです。
(A standalone Markdown editor for macOS, Linux and Windows. The UI is available in Japanese and English; this README is in Japanese.)
[Tauri 2](https://tauri.app) (Rust) + React + CodeMirror 6 で作られています。

## 機能

- ファイルの新規作成 / 開く / 保存 / 名前を付けて保存、複数タブ、最近使ったファイル
- 前回終了時の状態の復元: ファイルを指定せずに起動すると、開いていたタブ (順番・前面のタブ・各ファイルのカーソル行)、ワークスペースのフォルダ、サイドバー / アウトライン / チートシートの開閉、表示モードが元に戻る (設定でオフにできる)
- フォルダをワークスペースとして開き、サイドバーのファイルツリーから開く (フォルダの選択はサイドバー見出しの 📂 から)。各項目の「⋯」から新規ファイル / 新規フォルダ / 名前の変更 / 削除 (デスクトップ版は OS のゴミ箱へ移動)。未保存の変更があるファイルと、それを含むフォルダには ● が付く。開いていたフォルダの状態は、サイドバーを閉じても再起動しても保持。見出しの「◎」で、いま開いているファイルの位置までツリーを開いて表示
- Markdown シンタックスハイライト付きエディタ (行番号、折返し、検索・置換、Undo/Redo)
- リスト・引用の継続: Shift+Enter で次の項目を作成 (番号は自動で増加、空の項目で解除)。設定で「Enter で継続」「しない」に変更可。リストの項目で Tab を押すと上の項目の下に入り (番号付きは 1 から)、Shift+Tab で戻る
- Enter はその行のインデントをそのまま引き継ぐだけ。自動で字下げを足したり、タブを空白に変えたりしない
- WYSIWYG 風表示 (設定で有効化): カーソル行以外では `#` や `**`、リンクの URL などの記号を隠して表示
- スマートペースト: 文字を選択した状態で URL を貼り付けるとリンクに変換。設定で「常に」「毎回確認」「しない」を選択
- ワークスペースの全文検索 (サイドバーの検索欄、Ctrl/⌘+Shift+F)。結果をクリックすると該当行へ移動
- ドキュメント全体の整形 (ツールバーの「整形」、Shift+Alt+F / ⇧⌥F): 箇条書きを `-`、強調を `*` と `**` に統一、番号の振り直し、表の列幅を揃える (全角文字対応)、空行や改行コードの正規化。書き方をそろえるだけで、内容は変えない (そのまま書いた URL や改行の書き方は残し、不要な `\` や `<>` は足さない)。フロントマターと数式はそのまま
- GFM 対応のライブプレビュー (表、タスクリスト、脚注、取り消し線、コードハイライト)。文書に書いた HTML (`<br>`、`<details>`、`<kbd>`、`<img width>` など) も表示する。スクリプトやイベント属性など、動くものは取り除く
- 数式 (KaTeX: `$...$`, `$$...$$`) と Mermaid 図 (```` ```mermaid ````)、すべてオフラインで動作
- 画像の貼り付け / ドラッグ&ドロップ: 文書と同じ場所の `assets/` に保存して相対パスで挿入。ローカル画像をプレビューに表示
- デスクトップ版はウィンドウへのドラッグ&ドロップに対応: Markdown ファイルはタブで開き、画像はドロップした位置に挿入、フォルダはワークスペースとして開く
- プレビューのタスクリストはチェックボックスをクリックして切り替えられる (元の Markdown が書き換わる)。プレビューをダブルクリックすると、エディタのカーソルがその箇所の行へ移動
- 表の編集支援: 挿入ダイアログ、Tab / Shift+Tab でセル移動 (最終セルで Tab すると行追加)、列幅の自動整形 (全角文字対応)、行・列の追加削除、配置切替
- アウトライン: 見出しをクリックすると、エディタとプレビューの両方がその見出しへ移動 (閲覧のみの表示やスマホでも動作)
- プレビューのリンク: 外部 URL は既定のブラウザで開き、相対パスの .md はタブで開く。`[目次](#見出し)` と脚注は、その場所へ移動する
- HTML 書き出し (単独で開ける HTML)、印刷 / PDF (OS の印刷ダイアログ)。PDF のヘッダー・フッターはファイル名・時刻・ページ番号のみ (Windows と Chrome / Edge。URL やアプリ名は出ない)
- 分割表示では、カーソルのある行が左右で同じ高さになり、プレビューのその箇所に印が付く (スクロール中もその高さで合わせ続ける)。「⋯」メニューの「カーソルの位置で左右をそろえる」でオフにすると、スクロールした割合で連動する
- 表示モード: 編集のみ / 分割 / プレビューのみ、フォーカスモード、タイプライターモード。フォーカスモードは Esc、右上の「✕ フォーカス解除」ボタン、右クリックメニューのいずれでも終了できる
- 日本語 / 英語の UI: 既定は OS の言語に合わせ (日本語以外の OS では英語)、設定の「言語 / Language」で切り替えられる
- 設定: テーマ (OS 追従 / ライト / ダーク)、エディタとプレビューのフォント (インストール済みフォントの一覧から選択)、文字サイズ、タブ幅、折返し、自動保存。変更はその場で画面に反映され、「保存」を押すと記録される (「キャンセル」や Esc で元に戻る)
- アイコンは Lucide (ISC ライセンス) で統一
- チートシート (Markdown 記法とショートカットの一覧): 右側のサイドパネルに表示。F1 またはツールバーの「？」で開閉でき、開いたまま執筆できる
- ステータスバーにカーソル位置 (行・列)、選択中の文字数、行数・語数・文字数を表示
- 新規ドキュメントの保存時は、最初の見出しからファイル名を提案。同じ名前のファイルを複数開いたときは、タブにフォルダ名も表示
- 差分表示 (表示切替の「差分」、Ctrl/⌘+Shift+G): 左に元の内容、右に現在の内容を並べ、変わった行と行内の変更部分に色を付ける。右側はその場で編集でき、変更ごとの「→」で元の内容に戻せる。比較元は「アプリ起動後に最初に開いたときの内容」と「保存済みの内容」を切り替えられる
- 保存時の上書き防止: 開いたあとに他のプログラムが変更したファイルは、上書きする前に確認する (自動保存では上書きしない)
- バージョン情報 (「⋯」メニュー): バージョン、権利表記、利用しているライブラリ、GitHub へのリンク。同梱しているライブラリのライセンス文もここから表示できる
- 保存していない変更の復元 (設定で有効化): 保存せずに終了しても、次回の起動時に無題のドキュメントや編集中の内容を復元。終了時の確認を出さない設定もある
- 未保存の変更がある状態での終了確認 (「保存する / 保存しない / キャンセル」)、他のプログラムによるファイル変更の検知と再読込
- UTF-8 以外の文字コード (Shift_JIS / EUC-JP / UTF-16 など) や BOM 付き UTF-8 のファイルも開ける。文字コードはステータスバーに表示し、保存は元の文字コードのまま行う。その文字コードで表せない文字 (絵文字など) が含まれるときは、UTF-8 に変換して保存するかを確認する。文字コードは自動判別で、日本語以外 (中国語・韓国語など) の古い文字コードは誤判定することがある
- 自動保存に失敗したときは、ステータスバーに警告を表示 (保存できるようになると消える)
- タブはドラッグで並べ替えられる
- パネルの幅の変更: サイドバー、エディタとプレビューの境目、アウトライン、チートシート、差分表示の中央の線は、ドラッグで動かせる (ダブルクリックで元の幅に戻る。幅は次回の起動でも保たれる)
- ワークスペースのツリーには画像も表示。クリックすると画像を表示し、「ドキュメントに挿入」で相対パスの画像記法を挿入する
- 文字サイズの変更 (デスクトップ版): Ctrl/⌘ と + / - / 0
- スペルチェック (設定で有効化、既定はオフ。OS / ブラウザのスペルチェックを使う)
- 自動アップデート (バージョン情報から更新を確認。起動時の自動確認もここで切り替える)
- `.md` / `.markdown` ファイルの関連付け
- 日本語 IME で行頭に入力した全角「＃」「　」は半角に補正 (見出し記号として扱えるように)

### ショートカット

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新規タブ | ⌘N | Ctrl+N |
| 開く | ⌘O | Ctrl+O |
| 保存 / 名前を付けて保存 | ⌘S / ⌘⇧S | Ctrl+S / Ctrl+Shift+S |
| タブを閉じる | ⌘W | Ctrl+W |
| 次 / 前のタブ | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| 検索 / 置換 | ⌘F | Ctrl+F |
| 太字 / 斜体 / コード | ⌘B / ⌘I / ⌘E | Ctrl+B / Ctrl+I / Ctrl+E |
| リンク挿入 | ⌘K | Ctrl+K |
| 見出し 1 / 2 / 3 | ⌘1 / ⌘2 / ⌘3 | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| 編集 / 分割 / プレビュー表示 | ⌘⇧1 / ⌘⇧2 / ⌘⇧3 | Ctrl+Shift+1 / 2 / 3 |
| サイドバー / アウトライン | ⌘⇧E / ⌘⇧O | Ctrl+Shift+E / Ctrl+Shift+O |
| ワークスペースを全文検索 | ⌘⇧F | Ctrl+Shift+F |
| 差分表示 | ⌘⇧G | Ctrl+Shift+G |
| 文字を大きく / 小さく / 元に戻す (デスクトップ版) | ⌘+ / ⌘- / ⌘0 | Ctrl++ / Ctrl+- / Ctrl+0 |
| リスト・引用の続きの行 | ⇧Enter | Shift+Enter |
| ドキュメント全体を整形 | ⇧⌥F | Shift+Alt+F |
| フォーカス / タイプライターモード | ⌘⇧D / ⌘⇧T | Ctrl+Shift+D / Ctrl+Shift+T |
| HTML 書き出し / 印刷 (PDF) | ⌘⇧H / ⌘P | Ctrl+Shift+H / Ctrl+P |
| 設定 | ⌘, | Ctrl+, |
| チートシート | F1 または ⌘⇧/ | F1 または Ctrl+Shift+/ |
| 表の中でセル移動 | Tab / ⇧Tab | Tab / Shift+Tab |

## Web モード (ブラウザ / スマホから使う)

デスクトップ版と同じ画面を HTTP サーバーから配信し、サーバー上のフォルダにある Markdown をブラウザ (iPhone の Safari など) から編集できます。デスクトップ版はそのまま単独で動き、Web モードはそれに加えて使える別の入れ物です。

```bash
# ビルド (UI を同梱した単一バイナリができます)
pnpm install && pnpm server:build
# 起動
./target/release/markdown-editor-server --root ~/notes --port 36660
```

起動時に `http://<サーバー>:36660/?token=...` という URL が表示されるので、スマホのブラウザで開きます。トークンは Cookie に保存され、次回からは不要です。Safari の共有メニューから「ホーム画面に追加」すると、アプリのように全画面で起動します。

| オプション | 説明 |
| --- | --- |
| `--root <dir>` | 公開するフォルダ。この外のファイルには一切アクセスできません (既定: カレントディレクトリ) |
| `--port <n>` / `--host <addr>` | 待ち受けポートとアドレス (既定: 36660 / 0.0.0.0) |
| `--token <str>` | アクセストークン。省略時は起動ごとに生成。環境変数 `MDE_TOKEN` でも指定可 |
| `--no-auth` | 認証を無効化 (完全に信頼できるネットワーク専用) |
| `--dist <dir>` | UI を同梱分ではなくフォルダから配信 (開発用) |

Web モードでの違い: ファイルを開く / 保存のダイアログはアプリ内のファイル選択画面になり、ワークスペースは常に `--root` のフォルダです。自動アップデートと OS のファイル関連付けはありません。スマホ幅では下部のバーからフォルダ・保存・表示切替を操作します。

systemd で常駐させる (Linux):

```bash
pnpm server:build
sudo ./deploy/install-service.sh --root ~/notes            # 初回。トークンを生成して表示します
sudo ./deploy/install-service.sh --root ~/notes --token 既存のトークン   # 今使っている URL をそのまま使いたい場合
```

バイナリは `/usr/local/bin/markdown-editor-server` に、設定 (トークン / フォルダ / ポート) は `/etc/markdown-editor.env` に置かれます。ユニットファイルは `deploy/markdown-editor.service` で、公開フォルダ以外に書き込めないよう制限しています。コードを更新したら `pnpm server:build` のあと同じスクリプトをもう一度実行すれば、トークンを保ったまま入れ替わります。ログは `journalctl -u markdown-editor -f` で見られます。

サーバーが読み書きするのは公開フォルダの中だけです。フォルダの中に置いたシンボリックリンクが外を指している場合、その先は開けません (フォルダの中を指すリンクは使えます)。

Tailscale などの VPN 内で使うことを想定しています。インターネットに直接公開する場合は、HTTPS を終端するリバースプロキシ (Caddy など) の後ろに置いてください。

## 開発

### 必要なもの

- Node.js 22+ と pnpm
- Rust (stable) — https://rustup.rs
- OS 別の依存関係: https://tauri.app/start/prerequisites/
  - Linux (Ubuntu/Debian): `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev build-essential`
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools (C++)、WebView2 ランタイム

### コマンド

```bash
pnpm install
pnpm tauri dev      # 開発モードで起動
pnpm tauri build    # 配布用パッケージを作成 (target/release/bundle/)
pnpm build          # フロントエンドのみビルド (型チェック含む)
pnpm test           # フロントエンドのユニットテスト (vitest)
pnpm server:build   # Web モードのサーバーをビルド
pnpm server:dev     # Web モードを開発用に起動 (dist/ を配信、認証なし)
cargo test --workspace
pnpm e2e            # 画面を実際に操作するテスト (Playwright、先に pnpm server:build が必要)
pnpm update-licenses       # 同梱するライセンス一覧 (public/THIRD-PARTY-LICENSES.txt) を作り直す。依存を変えたら実行
```

## リリース

GitHub の Actions タブから「Release」ワークフローを手動実行 (Run workflow) し、タグ名 (例: `v0.3.4`) を入力します。macOS (Apple Silicon / Intel)、Linux (AppImage / deb / rpm)、Windows (msi / exe) のパッケージと Web サーバーのバイナリがビルドされ、ドラフトリリースに添付されます。内容を確認して Publish すると公開され、タグもそのとき作られます。

タグの push では起動しません。Publish でタグが作られるたびに同じビルドがもう一度走り、公開直後のリリースのファイルを置き換えてしまうためです (置き換え中はインストーラと `latest.json` の署名が一致せず、自動アップデートが失敗します)。

### コード署名

署名用の Secrets が設定されていない場合は未署名でビルドされます。その場合、macOS では初回起動時に Gatekeeper の警告が出るため、アプリを右クリック →「開く」で起動してください。Windows では SmartScreen の警告が出る場合があります（「詳細情報」→「実行」）。

macOS で署名・公証するには、Apple Developer Program に加入し、リポジトリの Secrets に次を登録します。

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application 証明書 (.p12) を base64 化した文字列 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 のパスワード |
| `KEYCHAIN_PASSWORD` | CI 用キーチェーンの任意のパスワード |
| `APPLE_SIGNING_IDENTITY` | 例: `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公証用の Apple ID、App 用パスワード、Team ID |

### 自動アップデート

アプリは起動時に GitHub Releases の `latest.json` を確認します (設定でオフにできます)。更新パッケージは minisign 鍵で署名されている必要があり、対応する公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入っています。リポジトリの Secrets に `TAURI_SIGNING_PRIVATE_KEY` (秘密鍵の内容) と、パスワード付きの場合は `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` を登録すると、リリース時に署名済みの更新パッケージと `latest.json` が生成されます。未設定の場合は通常のインストーラだけが作られ、自動更新は動きません (鍵を作り直す場合は `pnpm tauri signer generate` で生成し、公開鍵を設定に貼り替えてください)。ローカルで `pnpm tauri build` するときは署名ファイルを作りません。作る場合は `TAURI_SIGNING_PRIVATE_KEY` を設定したうえで `pnpm tauri build --config src-tauri/tauri.updater.json` を実行してください。

Windows の署名は任意です。必要になった場合は Tauri のドキュメント (https://tauri.app/distribute/sign/windows/) に従って `tauri.conf.json` の `bundle.windows` に設定を追加してください。

## 構成

```
src/                 フロントエンド (React + TypeScript)
  platform/          ホスト抽象化 (Tauri IPC / HTTP API) — ファイル操作、ダイアログ、リンクを開く
  editor/            CodeMirror 6 のラッパー、テーマ、書式コマンド、表編集、画像挿入
  preview/           unified (remark/rehype) による Markdown 変換、KaTeX / Mermaid、スクロール同期
  features/          ファイル操作、書き出し、アップデータ
  components/        ツールバー、タブ、サイドバー、アウトライン、設定、チートシート
  store/             アプリ状態と設定 (zustand、tauri-plugin-store)
  __tests__/         ユニットテスト (vitest)
src-tauri/           Tauri アプリ (IPC コマンド、macOS メニュー、起動ファイル)
crates/mde-core/     デスクトップ版と Web サーバーで共有するファイル操作
crates/mde-server/   Web モードの HTTP サーバー (axum、UI を同梱)
docs/PLAN.md         開発計画
docs/SUMMARY.md      経緯、環境構築のトラブル対処、リリース手順、レビュー結果のまとめ
```

## ライセンス

Copyright (c) 2026 BigBridge Digital. All rights reserved.

オープンソースライセンスでは公開していません。リポジトリは参照用の公開で、許可なく使用・複製・改変・再配布することはできません。詳細は [LICENSE](LICENSE) を参照してください。利用している第三者のライブラリには、それぞれのライセンスが適用されます。
