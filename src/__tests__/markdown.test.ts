import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../preview/markdown";

describe("renderMarkdown", () => {
  it("renders headings, GFM tables and task lists", async () => {
    const html = await renderMarkdown("# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done");
    expect(html).toContain('<h1 id="user-content-t">T</h1>');
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
  it("renders KaTeX math", async () => {
    const html = await renderMarkdown("$E=mc^2$");
    expect(html).toContain('class="katex');
  });
  it("strips scripts and event handlers", async () => {
    const html = await renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
  it("renders the harmless HTML written in a document", async () => {
    expect(await renderMarkdown("| a |\n| - |\n| 1<br>2 |")).toContain("<td>1<br>2</td>");
    expect(await renderMarkdown("<kbd>Ctrl</kbd> H<sub>2</sub>O")).toBe("<p><kbd>Ctrl</kbd> H<sub>2</sub>O</p>");
    expect(await renderMarkdown("<details>\n<summary>詳細</summary>\n\n中身 **太字**\n\n</details>")).toBe(
      "<details>\n<summary>詳細</summary>\n<p>中身 <strong>太字</strong></p>\n</details>",
    );
    expect(await renderMarkdown('<div align="center">中央</div>')).toBe('<div align="center">中央</div>');
    expect(await renderMarkdown('<img src="a.png" width="100">')).toBe('<img src="a.png" width="100">');
    expect(await renderMarkdown("<u>u</u> <mark>m</mark>")).toBe("<p><u>u</u> <mark>m</mark></p>");
    // Code stays text.
    expect(await renderMarkdown("`<i>x</i>`")).toBe("<p><code>&#x3C;i>x&#x3C;/i></code></p>");
  });
  it("keeps nothing from a document that could run, restyle or leave the page", async () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<style>body{display:none}</style>",
      '<iframe src="https://example.com"></iframe>',
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="alert(1)" target="_top">x</a>',
      "[x](javascript:alert(1))",
      '<form action="https://example.com"><button formaction="https://example.com">go</button></form>',
      '<svg onload="alert(1)"><script>alert(1)</script></svg>',
      '<base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com"><link rel="stylesheet" href="https://example.com/x.css">',
      '<object data="x"></object><embed src="x">',
      '<p style="position:fixed;inset:0" class="modal-backdrop">p</p>',
      '<img src="data:text/html,<script>alert(1)</script>">',
    ];
    for (const src of [...hostile, hostile.join("\n\n")]) {
      const html = await renderMarkdown(src);
      expect(html, src).not.toMatch(/<(script|style|iframe|form|button|svg|base|meta|link|object|embed)\b/i);
      expect(html, src).not.toMatch(/\son\w+=|javascript:|style=|class=|target=|formaction|data:text/i);
      expect(html, src).not.toContain("display:none");
    }
  });
  it("gives ids a prefix so a document cannot take over the page's own names", async () => {
    expect(await renderMarkdown('<p id="root" name="body">p</p>')).toBe('<p id="user-content-root" name="user-content-body">p</p>');
  });
  it("makes footnote links point at the footnotes", async () => {
    const html = await renderMarkdown("text[^1]\n\n[^1]: note");
    const ids = Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => m[1]);
    const links = Array.from(html.matchAll(/ href="#([^"]+)"/g), (m) => m[1]);
    expect(links).toEqual(["user-content-fn-1", "user-content-fnref-1"]);
    for (const link of links) expect(ids).toContain(link);
  });
  it("makes links to headings work, however the heading is written in the link", async () => {
    const html = await renderMarkdown(
      "# はじめに\n\n## Hello World\n\n[a](#はじめに) [b](#hello-world) [c](#Hello-World) [d](#%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB) [e](#none)",
    );
    expect(html).toContain('<h1 id="user-content-はじめに">');
    expect(html).toContain('<a href="#user-content-はじめに">a</a>');
    expect(html).toContain('<a href="#user-content-hello-world">b</a>');
    expect(html).toContain('<a href="#user-content-hello-world">c</a>');
    expect(html).toContain('<a href="#user-content-はじめに">d</a>');
    expect(html).toContain('<a href="#none">e</a>');
  });
  it("does not take prices for formulas", async () => {
    expect(await renderMarkdown("It costs $5 and $10 total.")).toBe("<p>It costs $5 and $10 total.</p>");
    expect(await renderMarkdown("Only one $ sign here. And US$100.")).toBe("<p>Only one $ sign here. And US$100.</p>");
    expect(await renderMarkdown("$x$ と $y^2$")).toContain('class="katex');
  });
  it("shows pictures given as data or as a path on this computer", async () => {
    expect(await renderMarkdown("![x](data:image/png;base64,AAAA)")).toContain('src="data:image/png;base64,AAAA"');
    expect(await renderMarkdown("![x](C:/Users/me/p.png)", { docDir: "C:/docs" })).toContain("C%3A%2FUsers%2Fme%2Fp.png");
    expect(await renderMarkdown('<a name="place"></a>\n\n[go](#place)')).toContain('href="#user-content-place"');
  });
  it("keeps mermaid blocks as code when not rendering diagrams", async () => {
    const html = await renderMarkdown("```mermaid\ngraph LR\nA-->B\n```");
    expect(html).toContain('class="language-mermaid"');
  });
  it("tags blocks with their source line when asked", async () => {
    const html = await renderMarkdown("# A\n\npara\n\n## B\n\n- x\n", { sourceLines: true });
    expect(html).toContain('<h1 id="user-content-a" data-line="1" data-line-end="1">A</h1>');
    expect(html).toContain('<p data-line="3" data-line-end="3">para</p>');
    expect(html).toContain('<h2 id="user-content-b" data-line="5" data-line-end="5">B</h2>');
    expect(html).toContain('<li data-line="7" data-line-end="7">x</li>');
    expect(await renderMarkdown("# A")).not.toContain("data-line");
    // A block of math keeps its lines on a wrapper (KaTeX replaces the block itself).
    expect(await renderMarkdown("a\n\n$$\nx\n$$\n", { sourceLines: true })).toContain('<div class="math-block" data-line="3" data-line-end="5">');
  });
  it("hides front matter instead of rendering it as text", async () => {
    const html = await renderMarkdown("---\ntitle: x\n---\n\n# A\n");
    expect(html).not.toContain("title: x");
    expect(html).toContain('<h1 id="user-content-a">A</h1>');
  });
  it("does not treat '#text' without a space as a heading", async () => {
    const html = await renderMarkdown("#見出し");
    expect(html).toContain("<p>#見出し</p>");
  });
});
