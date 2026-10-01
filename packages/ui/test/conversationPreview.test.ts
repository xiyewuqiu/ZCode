import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationPreview } from "../src/v4/conversationPreviewText.js";

function reference(texts: string[], maxChars = 220, maxParagraphs = 2) {
  const value = texts
    .join("\n\n")
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxParagraphs))
    .join("\n");
  return value.length > Math.max(8, maxChars)
    ? `${value.slice(0, Math.max(8, maxChars) - 3).trimEnd()}...`
    : value || "Empty";
}

test("bounded previews preserve paragraph, whitespace and truncation behavior", () => {
  const cases = [
    [],
    [""],
    [" \r\n\t "],
    ["one\ntwo\n\nthree\n\nfour"],
    [" leading ", "", " next ", "last"],
    ["中 文\r\n\r\n第二段", "后续"],
    ["hello\u00a0world\u2028next"],
    ["x".repeat(220)],
    ["x".repeat(221)],
    ["one", " \n ", "two\n\nthree"],
    ["12345678\n\nnext"],
    ["12345678   "],
  ];
  for (const texts of cases)
    for (const maxChars of [8, 20, 220])
      for (const maxParagraphs of [1, 2, 3]) {
        assert.equal(
          buildConversationPreview({ texts, fallback: "Empty", maxChars, maxParagraphs }),
          reference(texts, maxChars, maxParagraphs),
        );
      }
});

test("preview stops before reading unneeded assistant blocks", () => {
  function* texts() {
    yield "x".repeat(10_000_000);
    throw new Error("The remaining message blocks must not be read");
  }
  assert.equal(
    buildConversationPreview({ texts: texts(), fallback: "Empty" }),
    "x".repeat(217) + "...",
  );
});

test("preview truncation never leaves a lone surrogate", () => {
  const result = buildConversationPreview({
    texts: ["1234😀abcdef"],
    fallback: "Empty",
    maxChars: 8,
  });
  assert.equal(result, "1234...");
  assert.equal(result.isWellFormed(), true);
});

test("preview benchmark reads only the displayed prefix", (t) => {
  const texts = ["A paragraph. ".repeat(100_000)];
  const measure = (build: () => string) => {
    const start = performance.now();
    let result = "";
    for (let i = 0; i < 25; i++) result = build();
    return { result, ms: performance.now() - start };
  };
  const before = measure(() => reference(texts));
  const after = measure(() => buildConversationPreview({ texts, fallback: "Empty" }));
  assert.equal(after.result, before.result);
  t.diagnostic(
    `1.3M characters / 25 previews: full=${before.ms.toFixed(1)}ms bounded=${after.ms.toFixed(1)}ms`,
  );
});
