// Starts markdown-editor-server on a throw-away workspace for the browser tests.
// The folder is printed so the tests can look at the files on disk.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? ".exe" : "";
const binary = ["release", "debug"].map((p) => join(root, "target", p, `markdown-editor-server${exe}`)).find(existsSync);
if (!binary) {
  console.error("markdown-editor-server is not built. Run: cargo build -p markdown-editor-server");
  process.exit(1);
}
if (!existsSync(join(root, "dist", "index.html"))) {
  console.error("The UI is not built. Run: pnpm build");
  process.exit(1);
}

const workspace = process.env.E2E_WORKSPACE ?? mkdtempSync(join(tmpdir(), "mde-e2e-"));
mkdirSync(join(workspace, "docs"), { recursive: true });
mkdirSync(join(workspace, "notes"), { recursive: true });
const long = ["# 長い文書", "", "導入の段落です。", ""];
for (let c = 1; c <= 8; c++) {
  long.push(`## 第${c}章`, "");
  for (let p = 1; p <= 6; p++) long.push(`第${c}章の段落 ${p}。${"本文".repeat(40)}`, "");
}
const files = {
  "hello.md": "# Hello\n\nFirst paragraph.\n",
  "tasks.md": "# タスク\n\n- [ ] 一つ目\n- [x] 二つ目\n\n本文\n\n## 後半\n\nおわり\n",
  "long.md": long.join("\n"),
  "notes/long-too.md": long.join("\n").replaceAll("第", "別の第"),
  "save-me.md": "# Save me\n",
  "unsaved.md": "# Unsaved\n",
  "docs/README.md": "# Docs\n\ndocs のファイル\n",
  "notes/README.md": "# Notes\n\nnotes のファイル\n",
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(workspace, name), text);

// A Shift_JIS text file ("# 見出し\r\n日本語のテキスト\r\n") and a tiny PNG, for the encoding and image tests.
writeFileSync(
  join(workspace, "sjis.txt"),
  Buffer.from([0x23, 0x20, 0x8c, 0xa9, 0x8f, 0x6f, 0x82, 0xb5, 0x0d, 0x0a, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x65, 0x83, 0x4c, 0x83, 0x58, 0x83, 0x67, 0x0d, 0x0a]),
);
mkdirSync(join(workspace, "docs", "assets"), { recursive: true });
writeFileSync(
  join(workspace, "docs", "assets", "dot.png"),
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

const server = spawn(binary, ["--root", workspace, "--port", process.env.E2E_PORT ?? "36670", "--token", "e2e", "--dist", join(root, "dist")], {
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill());
