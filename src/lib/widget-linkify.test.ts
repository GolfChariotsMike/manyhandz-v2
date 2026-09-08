import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const widgetSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/widget.js"),
  "utf8"
);

function extractNamedFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name} in public/widget.js`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name} in public/widget.js`);
}

const helpers = [
  extractNamedFunction(widgetSrc, "mhzSafeHttpUrl"),
  extractNamedFunction(widgetSrc, "mhzSplitTrailingPunct"),
  extractNamedFunction(widgetSrc, "mhzLinkifyTokens"),
  extractNamedFunction(widgetSrc, "mhzAppendLinkified"),
].join("\n");

type LinkifyToken = { type: "text" | "link"; value: string; href?: string };

const mhzLinkifyTokens = new Function(`${helpers}; return mhzLinkifyTokens;`)() as (
  text: unknown
) => LinkifyToken[];

type FakeNode = {
  nodeType: number;
  tagName: string;
  textContent: string;
  attrs: Record<string, string>;
  children: FakeNode[];
  appendChild: (child: FakeNode) => FakeNode;
  setAttribute: (k: string, v: string) => void;
};

function createEl(tag: string): FakeNode {
  const el: FakeNode = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    textContent: "",
    attrs: {},
    children: [],
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
  };
  return el;
}

function createTextNode(value: string): FakeNode {
  return {
    nodeType: 3,
    tagName: "#text",
    textContent: String(value),
    attrs: {},
    children: [],
    appendChild() {
      throw new Error("text nodes cannot append");
    },
    setAttribute() {
      throw new Error("text nodes cannot set attributes");
    },
  };
}

const mhzAppendLinkified = new Function(
  "document",
  `${helpers}; return mhzAppendLinkified;`
)({
  createElement: createEl,
  createTextNode,
}) as (el: FakeNode, text: unknown) => void;

function serialize(el: FakeNode): string {
  return el.children
    .map((child) => {
      if (child.nodeType === 3) return child.textContent;
      if (child.tagName === "A") {
        const href = child.attrs.href || "";
        const target = child.attrs.target || "";
        const rel = child.attrs.rel || "";
        return `<a href="${href}" target="${target}" rel="${rel}">${child.textContent}</a>`;
      }
      return `<${child.tagName.toLowerCase()}>`;
    })
    .join("");
}

test("addMessage helpers exist in the shipped widget (no innerHTML of LLM text)", () => {
  assert.match(widgetSrc, /function mhzAppendLinkified\(/);
  assert.match(widgetSrc, /mhzAppendLinkified\(el, text\)/);
  assert.equal(widgetSrc.includes("el.textContent = text"), false);
  assert.match(widgetSrc, /document\.createTextNode\(t\.value\)/);
  assert.match(widgetSrc, /a\.textContent = t\.value/);
  assert.equal(/innerHTML\s*=\s*text/.test(widgetSrc), false);
});

test("bare https demo/signup URLs become safe new-tab links", () => {
  const tokens = mhzLinkifyTokens(
    "Want to hear it live? Tap here:\nhttps://manyhandz.ai/try"
  );
  assert.deepEqual(tokens, [
    { type: "text", value: "Want to hear it live? Tap here:\n" },
    { type: "link", href: "https://manyhandz.ai/try", value: "https://manyhandz.ai/try" },
  ]);

  const both = mhzLinkifyTokens(
    "Demo https://manyhandz.ai/try or signup https://app.manyhandz.ai/signup"
  );
  assert.equal(both.filter((t) => t.type === "link").length, 2);
  assert.equal(both[1]?.href, "https://manyhandz.ai/try");
  assert.equal(both[3]?.href, "https://app.manyhandz.ai/signup");
});

test("plain text without URLs stays a single text token", () => {
  assert.deepEqual(mhzLinkifyTokens("Hi! How can we help?"), [
    { type: "text", value: "Hi! How can we help?" },
  ]);
  assert.deepEqual(mhzLinkifyTokens(""), []);
});

test("javascript: and other schemes are not linked", () => {
  const malicious = [
    "javascript:alert(1)",
    "click javascript:alert(1) please",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "[pwn](javascript:alert(1))",
    "[pwn](data:text/html,hi)",
  ];
  for (const text of malicious) {
    const tokens = mhzLinkifyTokens(text);
    assert.equal(
      tokens.some((t) => t.type === "link"),
      false,
      `should not linkify: ${text}`
    );
  }
});

test("markdown https links are safe and use the label as text", () => {
  const tokens = mhzLinkifyTokens("Go [Tap here](https://manyhandz.ai/try) now");
  assert.deepEqual(tokens, [
    { type: "text", value: "Go " },
    { type: "link", href: "https://manyhandz.ai/try", value: "Tap here" },
    { type: "text", value: " now" },
  ]);
});

test("append uses DOM nodes, never raw HTML, and sets target/rel", () => {
  const el = createEl("div");
  mhzAppendLinkified(
    el,
    'Tap here:\nhttps://manyhandz.ai/try <img src=x onerror="alert(1)">'
  );
  assert.equal(
    serialize(el),
    'Tap here:\n<a href="https://manyhandz.ai/try" target="_blank" rel="noopener noreferrer">https://manyhandz.ai/try</a> <img src=x onerror="alert(1)">'
  );
  assert.equal(el.children[1]?.tagName, "A");
  assert.equal(el.children[1]?.attrs.target, "_blank");
  assert.equal(el.children[1]?.attrs.rel, "noopener noreferrer");
  assert.equal(el.children[2]?.nodeType, 3);
  assert.equal(el.children[2]?.textContent, ' <img src=x onerror="alert(1)">');
});

test("trailing punctuation stays outside the href", () => {
  const tokens = mhzLinkifyTokens("See https://manyhandz.ai/try.");
  assert.deepEqual(tokens, [
    { type: "text", value: "See " },
    { type: "link", href: "https://manyhandz.ai/try", value: "https://manyhandz.ai/try" },
    { type: "text", value: "." },
  ]);
});
