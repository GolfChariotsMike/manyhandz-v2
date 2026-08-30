import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_WIDGET_SRC,
  chatWidgetEmbedSnippet,
  mountChatWidgetPreview,
  unmountChatWidgetPreview,
} from "./chat-widget-preview.ts";

type FakeEl = {
  tagName: string;
  id: string;
  src: string;
  textContent: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  parent: FakeEl | null;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  appendChild: (child: FakeEl) => FakeEl;
  remove: () => void;
  querySelector: (sel: string) => FakeEl | null;
  querySelectorAll: (sel: string) => FakeEl[];
};

function createEl(tag: string): FakeEl {
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    id: "",
    src: "",
    textContent: "",
    attrs: {},
    children: [],
    parent: null,
    setAttribute(k, v) {
      el.attrs[k] = v;
      if (k === "id") el.id = v;
    },
    getAttribute(k) {
      if (k === "src" && el.src) return el.src;
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null;
    },
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (!el.parent) return;
      el.parent.children = el.parent.children.filter((c) => c !== el);
      el.parent = null;
    },
    querySelector(sel) {
      return el.querySelectorAll(sel)[0] ?? null;
    },
    querySelectorAll(sel) {
      const out: FakeEl[] = [];
      walk(el, (node) => {
        if (matches(node, sel)) out.push(node);
      });
      return out;
    },
  };
  return el;
}

function walk(node: FakeEl, visit: (n: FakeEl) => void) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

function matches(node: FakeEl, sel: string): boolean {
  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel === "style") return node.tagName === "STYLE";
  if (sel.startsWith("script[")) {
    const attr = sel.slice("script[".length, -1);
    return node.tagName === "SCRIPT" && Object.prototype.hasOwnProperty.call(node.attrs, attr);
  }
  return false;
}

function installFakeDom() {
  const html = createEl("html");
  const head = createEl("head");
  const body = createEl("body");
  html.appendChild(head);
  html.appendChild(body);

  const document = {
    head,
    body,
    documentElement: html,
    createElement: (tag: string) => createEl(tag),
    getElementById: (id: string) => html.querySelector(`#${id}`),
    querySelector: (sel: string) => html.querySelector(sel),
    querySelectorAll: (sel: string) => html.querySelectorAll(sel),
  };

  (globalThis as any).document = document;
  return { html, head, body, document };
}

test("embed snippet matches the customer copy box", () => {
  assert.equal(
    chatWidgetEmbedSnippet("abc123"),
    `<script src="https://app.manyhandz.ai/widget.js" data-key="abc123"></script>`
  );
  assert.equal(CHAT_WIDGET_SRC, "https://app.manyhandz.ai/widget.js");
});

test("mount injects a real script with the live src and data-key", () => {
  const { body } = installFakeDom();
  mountChatWidgetPreview("key-1");
  const scripts = body.children.filter((c) => c.tagName === "SCRIPT");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, CHAT_WIDGET_SRC);
  assert.equal(scripts[0].getAttribute("data-key"), "key-1");
});

test("mount does nothing when embed_key is missing", () => {
  const { body } = installFakeDom();
  mountChatWidgetPreview(undefined);
  mountChatWidgetPreview("");
  mountChatWidgetPreview(null);
  assert.equal(body.children.length, 0);
});

test("mount does not stack a second script for the same key", () => {
  const { body } = installFakeDom();
  mountChatWidgetPreview("key-1");
  mountChatWidgetPreview("key-1");
  assert.equal(body.children.filter((c) => c.tagName === "SCRIPT").length, 1);
});

test("unmount removes the script, #mhz-widget, and widget style tag", () => {
  const { head, body, document } = installFakeDom();
  mountChatWidgetPreview("key-1");

  const widget = document.createElement("div");
  widget.setAttribute("id", "mhz-widget");
  body.appendChild(widget);

  const style = document.createElement("style");
  style.textContent = "#mhz-widget * { box-sizing: border-box; }";
  head.appendChild(style);

  const other = document.createElement("style");
  other.textContent = "body { margin: 0; }";
  head.appendChild(other);

  unmountChatWidgetPreview();

  assert.equal(body.children.length, 0);
  assert.equal(head.querySelector("#mhz-widget"), null);
  assert.equal(
    head.children.filter((c) => c.tagName === "STYLE" && c.textContent.includes("#mhz-widget")).length,
    0
  );
  assert.equal(head.children.filter((c) => c.tagName === "STYLE").length, 1);
});

test("re-entering after unmount injects a single script again", () => {
  const { body } = installFakeDom();
  mountChatWidgetPreview("key-1");
  unmountChatWidgetPreview();
  mountChatWidgetPreview("key-1");
  assert.equal(body.children.filter((c) => c.tagName === "SCRIPT").length, 1);
  assert.equal(body.children[0].getAttribute("data-key"), "key-1");
});
