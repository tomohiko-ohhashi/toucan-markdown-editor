import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { visit, EXIT } from "unist-util-visit";
import type { Root, Element } from "hast";
import { platform } from "../platform";
import { isAbsolutePath, isExternalUrl, joinPath } from "./paths";

const DRIVE_LETTERS = Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

// What may appear in the preview: the sanitiser's default list (the one GitHub uses for
// Markdown), plus the class names rehype-highlight / remark-math emit and GFM task-list checkboxes.
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^(hljs|language-|math-).*/]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^(hljs-|math).*/]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", /^math.*/]],
    input: [...(defaultSchema.attributes?.input ?? []), "checked", "disabled", ["type", "checkbox"]],
  },
  // <u> and <mark> are harmless and commonly written by hand.
  tagNames: [...(defaultSchema.tagNames ?? []), "input", "u", "mark"],
  // Drop the text inside <style> too; left as it is, the CSS would show up as a paragraph.
  strip: [...(defaultSchema.strip ?? []), "style"],
  protocols: {
    ...defaultSchema.protocols,
    // Where a picture may come from: also the document itself (data:) and a file on this computer.
    // "C:/pictures/a.png" looks like an address with the scheme "C", so the drive letters are listed.
    src: [...(defaultSchema.protocols?.src ?? []), "data", "file", "asset", "blob", ...DRIVE_LETTERS],
  },
};

export interface RenderOptions {
  /** Directory of the document; relative image paths are resolved against it and
   *  converted to Tauri asset URLs so they display in the preview. */
  docDir?: string | null;
  /** Tag block elements with `data-line` (their source line) so the UI can scroll to them. */
  sourceLines?: boolean;
  /** Render ```mermaid blocks to inline SVG (requires a DOM). */
  mermaid?: boolean;
  dark?: boolean;
}

/** Rewrite relative <img src> to asset URLs the webview can load. */
const rehypeLocalImages: Plugin<[{ docDir: string | null | undefined }], Root> = function (
  this: unknown,
  { docDir },
) {
  return (tree: Root) => {
    if (docDir == null) return;
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src !== "string" || isExternalUrl(src)) return;
      let decoded = src;
      try {
        decoded = decodeURIComponent(src);
      } catch {
        /* keep the raw path for inputs like "100%.png" */
      }
      const abs = isAbsolutePath(decoded) ? decoded : joinPath(docDir, decoded);
      node.properties.src = platform.assetUrl(abs);
    });
  };
};

/**
 * "$5 and $10" is two prices, not a formula. Math between single dollar signs follows the usual
 * rule (the one pandoc and GitHub use): no space right inside the dollars, and no digit right
 * after the closing one. Anything else is put back as the text it was.
 */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function remarkPlainDollars() {
  return (tree: MdNode, file: { value: unknown }) => {
    const src = String(file.value);
    const walk = (parent: MdNode) => {
      parent.children?.forEach((node, index) => {
        walk(node);
        const from = node.position?.start.offset;
        const to = node.position?.end.offset;
        if (node.type !== "inlineMath" || from == null || to == null) return;
        const raw = src.slice(from, to);
        if (raw.startsWith("$$")) return;
        if (/^\$\s|\s\$$/.test(raw) || /[0-9]/.test(src[to] ?? "")) {
          (parent.children as MdNode[])[index] = { type: "text", value: raw };
        }
      });
    };
    walk(tree);
  };
}

/**
 * Parse the HTML written in the document into elements. Parsing goes over the whole
 * tree again, so it is skipped for the many documents that contain no HTML at all.
 */
const rehypeDocumentHtml: Plugin<[], Root> = function (this: unknown) {
  const parse = rehypeRaw();
  return (tree, file) => {
    let found = false;
    visit(tree, "raw", () => {
      found = true;
      return EXIT;
    });
    return found ? parse(tree, file) : undefined;
  };
};

/** What the sanitiser puts in front of every id, so that a document cannot shadow the page's own names. */
const ID_PREFIX = "user-content-";

/**
 * Links inside the document ("#heading", footnotes). The sanitiser has renamed the ids they
 * point at, so point the links at the new names; then they work in the preview and in exported HTML.
 */
const rehypeAnchorLinks: Plugin<[], Root> = function (this: unknown) {
  return (tree: Root) => {
    const ids = new Set<string>();
    visit(tree, "element", (node: Element) => {
      if (typeof node.properties?.id === "string") ids.add(node.properties.id);
      // <a name="x"></a>, the old way of marking a place.
      if (typeof node.properties?.name === "string") ids.add(node.properties.name);
    });
    visit(tree, "element", (node: Element) => {
      const href = node.tagName === "a" ? node.properties?.href : null;
      if (typeof href !== "string" || !href.startsWith("#") || href.length < 2) return;
      let name = href.slice(1);
      try {
        name = decodeURIComponent(name);
      } catch {
        /* not percent-encoded */
      }
      if (ids.has(name)) return;
      // Heading ids are lower case; links to them are often written as the heading is.
      const target = [ID_PREFIX + name, ID_PREFIX + name.toLowerCase()].find((id) => ids.has(id));
      if (target) node.properties.href = `#${target}`;
    });
  };
};

/** A picture may be written into the document as data; nothing else may ("data:text/html, ..."). */
const rehypeImageDataOnly: Plugin<[], Root> = function (this: unknown) {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const src = node.tagName === "img" ? node.properties?.src : null;
      if (typeof src === "string" && /^data:/i.test(src) && !/^data:image\//i.test(src)) delete node.properties.src;
    });
  };
};

const LINE_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "blockquote", "table", "tr", "hr"]);

/** Runs after sanitising, so the attribute needs no schema entry. */
const rehypeSourceLines: Plugin<[{ enabled: boolean }], Root> = function (this: unknown, { enabled }) {
  return (tree: Root) => {
    if (!enabled) return;
    visit(tree, "element", (node: Element, index, parent) => {
      const line = node.position?.start.line;
      if (line && LINE_TAGS.has(node.tagName)) {
        const first = node.tagName === "pre" ? node.children[0] : null;
        const isMath = first?.type === "element" && Array.isArray(first.properties.className) && first.properties.className.includes("language-math");
        if (isMath && parent && index != null) {
          // A block of math: KaTeX puts its own elements in place of this one, so the lines are
          // noted on a wrapper that stays.
          parent.children[index] = {
            type: "element",
            tagName: "div",
            properties: { className: ["math-block"], dataLine: line, dataLineEnd: node.position?.end.line ?? line },
            children: [node],
          };
          return;
        }
        node.properties.dataLine = line;
        // Where the block ends, so the UI can tell which block a source line is in.
        node.properties.dataLineEnd = node.position?.end.line ?? line;
      }
      // Task-list checkboxes come out disabled; in the live preview a click ticks the item in the source.
      if (node.tagName === "input" && node.properties.type === "checkbox") delete node.properties.disabled;
    });
  };
};

function buildProcessor(docDir: string | null | undefined, sourceLines: boolean) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPlainDollars)
    .use(remarkFrontmatter, ["yaml", "toml"])
    // HTML written in the document is part of Markdown ("<br>" in a table cell, <details>, <kbd>, <img width>):
    // it is parsed here and then goes through the sanitiser like everything else, which keeps the
    // harmless tags and drops scripts, styles, frames, forms and event handlers.
    // clobberPrefix "": the sanitiser already prefixes ids; with both, footnote links pointed nowhere.
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "" })
    .use(rehypeDocumentHtml)
    .use(rehypeSlug)
    .use(rehypeSanitize, schema)
    .use(rehypeImageDataOnly)
    .use(rehypeAnchorLinks)
    .use(rehypeSourceLines, { enabled: sourceLines })
    .use(rehypeKatex, { throwOnError: false, strict: false })
    .use(rehypeHighlight, { detect: false, plainText: ["mermaid", "math", "txt", "text"] })
    .use(rehypeLocalImages, { docDir })
    .use(rehypeStringify);
}

let mermaidInit: Promise<typeof import("mermaid").default> | null = null;
let mermaidDark: boolean | null = null;

async function getMermaid(dark: boolean) {
  if (!mermaidInit) mermaidInit = import("mermaid").then((m) => m.default);
  const mermaid = await mermaidInit;
  if (mermaidDark !== dark) {
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
      fontFamily: "inherit",
    });
    mermaidDark = dark;
  }
  return mermaid;
}

let mermaidSeq = 0;

/** Replace ```mermaid code blocks in an HTML string with rendered SVG. */
async function renderMermaidBlocks(html: string, dark: boolean): Promise<string> {
  if (!html.includes("language-mermaid")) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const blocks = tpl.content.querySelectorAll("pre > code.language-mermaid");
  if (blocks.length === 0) return html;
  const mermaid = await getMermaid(dark);
  for (const code of Array.from(blocks)) {
    const pre = code.parentElement!;
    const source = code.textContent ?? "";
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-diagram";
    for (const name of ["data-line", "data-line-end"]) {
      const value = pre.getAttribute(name);
      if (value) wrapper.setAttribute(name, value);
    }
    try {
      const { svg } = await mermaid.render(`mermaid-${mermaidSeq++}`, source);
      wrapper.innerHTML = svg;
    } catch (e) {
      wrapper.className = "mermaid-error";
      wrapper.textContent = `Mermaid: ${e instanceof Error ? e.message : String(e)}`;
      // mermaid leaves an error element behind in the body on failure; remove it.
      document.querySelectorAll('[id^="dmermaid-"]').forEach((n) => n.remove());
    }
    pre.replaceWith(wrapper);
  }
  return tpl.innerHTML;
}

export async function renderMarkdown(src: string, opts: RenderOptions = {}): Promise<string> {
  const file = await buildProcessor(opts.docDir, opts.sourceLines ?? false).process(src);
  let html = String(file);
  if (opts.mermaid) html = await renderMermaidBlocks(html, opts.dark ?? false);
  return html;
}
