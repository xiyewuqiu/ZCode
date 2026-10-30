import assert from "node:assert/strict";
import test from "node:test";
import {
  IncrementalMarkdownParser,
  UNSTABLE_TAIL_BLOCKS,
  type MarkdownBlockSplitter,
} from "../src/lib/incrementalMarkdown.js";

// 流式正文只应重新解析尾部：冻结块必须跨 chunk 稳定，未闭合围栏只重算当前行，
// 任何无法证明安全的输入都回退到尾部整段渲染。

function frozenSources(parser: IncrementalMarkdownParser, markdown: string) {
  return parser.update(markdown).frozen.map((block) => block.source);
}

test("append-only 文本冻结前缀单调增长且 key 是绝对 offset", () => {
  const parser = new IncrementalMarkdownParser();
  const chunks = [
    "# Title\n\n",
    "para one\n",
    "line two\n\n",
    "- a\n- b\n\n",
    "> quote\n\n",
    "tail\n",
  ];
  let markdown = "";
  let previousFrozenCount = 0;

  for (const chunk of chunks) {
    markdown += chunk;
    const snapshot = parser.update(markdown);
    assert.ok(snapshot.frozen.length >= previousFrozenCount, "冻结块只能增加");
    previousFrozenCount = snapshot.frozen.length;
    for (const block of snapshot.frozen) {
      assert.equal(block.key, markdown.indexOf(block.source), "key 必须是绝对起始 offset");
      assert.ok(block.key >= 0);
    }
    const keys = snapshot.frozen.map((block) => block.key);
    assert.deepEqual(
      keys,
      [...keys].sort((left, right) => left - right),
      "冻结块按源顺序排列",
    );
    assert.ok(snapshot.tailSource.length > 0, "尾部始终参与重新渲染");
  }

  const finalSnapshot = parser.update(markdown);
  assert.ok(finalSnapshot.frozen.length >= 3);
  assert.match(finalSnapshot.tailSource, /^> quote/);
  assert.equal(finalSnapshot.fallback, false);
  assert.equal(parser.update(markdown), finalSnapshot, "相同输入必须幂等");
});

test(`尾部最多保留 ${UNSTABLE_TAIL_BLOCKS} 个顶层块`, () => {
  const parser = new IncrementalMarkdownParser();
  const markdown = "p1\n\np2\n\np3\n\np4\n\np5\n";
  const snapshot = parser.update(markdown);
  assert.deepEqual(frozenSources(parser, markdown), ["p1", "p2", "p3"]);
  assert.match(snapshot.tailSource, /^p4\n\np5/);
});

test("块跨过冻结边界时保持 key 和内容不变", () => {
  const parser = new IncrementalMarkdownParser();
  const before = parser.update("p1\n\np2\n\np3\n\np4\n");
  const p2Before = before.frozen.find((block) => block.source === "p2");
  assert.ok(p2Before, "p2 应已冻结");

  const after = parser.update("p1\n\np2\n\np3\n\np4\n\np5\n");
  const p2After = after.frozen.find((block) => block.source === "p2");
  assert.deepEqual(p2After, p2Before);
  const p3After = after.frozen.find((block) => block.source === "p3");
  assert.equal(p3After?.key, "p1\n\np2\n\np3\n\np4\n\np5\n".indexOf("p3"));
});

test("非前缀替换递增 generation 并清空旧冻结块", () => {
  const parser = new IncrementalMarkdownParser();
  const original = parser.update("p1\n\np2\n\np3\n\np4\n");
  assert.ok(original.frozen.length > 0);
  const generation = original.generation;

  const replaced = parser.update("P1\n\nP2\n\nP3\n\nP4\n");
  assert.equal(replaced.generation, generation + 1);
  assert.ok(replaced.frozen.every((block) => block.source.startsWith("P")));
});

test("未闭合围栏只重算当前行并把完整行提交到稳定值", () => {
  const parser = new IncrementalMarkdownParser();
  let markdown = "intro\n\n```ts\nconst a = 1\nconst b = 2";
  const first = parser.update(markdown);
  assert.equal(first.openFence?.language, "ts");
  assert.equal(first.openFence?.marker, "`");
  assert.equal(first.openFence?.code, "const a = 1\nconst b = 2");
  assert.equal(first.tailSource, "intro\n\n");
  const frozenCount = first.frozen.length;

  markdown += "\nconst c = 3";
  const second = parser.update(markdown);
  assert.equal(second.frozen.length, frozenCount, "围栏增长不影响冻结前缀");
  assert.equal(second.openFence?.code, "const a = 1\nconst b = 2\nconst c = 3");
  assert.equal(second.openFence?.key, markdown.indexOf("```ts"));

  markdown += "\n```\n\np1\n\np2\n";
  const closed = parser.update(markdown);
  assert.equal(closed.openFence, null);
  const frozenCodeBlock = closed.frozen.find((block) => block.source.startsWith("```ts"));
  assert.ok(frozenCodeBlock, "闭合后的代码块应能进入冻结区");
  assert.match(frozenCodeBlock.source, /```ts\nconst a = 1\nconst b = 2\nconst c = 3\n```/);
});

test("起始围栏行未完成时不进入第二前沿", () => {
  const parser = new IncrementalMarkdownParser();
  assert.equal(parser.update("```").openFence, null);
  assert.equal(parser.update("```ts").openFence, null);
  const complete = parser.update("```ts\nconst a = 1");
  assert.equal(complete.openFence?.language, "ts");
  assert.equal(complete.openFence?.code, "const a = 1");
});

test("未闭合围栏支持缩进与 CRLF", () => {
  const parser = new IncrementalMarkdownParser();
  const markdown = '```json\r\n{\r\n  "a": 1';
  const snapshot = parser.update(markdown);
  assert.equal(snapshot.openFence?.language, "json");
  // CRLF 归一为 LF 后再切片，避免 marked token offset 与原始文本错位。
  assert.equal(snapshot.openFence?.code, '{\n  "a": 1');

  const indented = new IncrementalMarkdownParser();
  const indentedSnapshot = indented.update('  ```json\n{\n  "a": 1');
  assert.equal(indentedSnapshot.openFence?.indent, 2);
  assert.equal(indentedSnapshot.openFence?.code, '{\n"a": 1');
});

test("流式 chunk 拆分 CRLF 时仍保持追加语义", () => {
  const parser = new IncrementalMarkdownParser();
  const first = parser.update("p1\r");
  const generation = first.generation;
  const second = parser.update("p1\r\n\r\np2\r\n\r\np3\r\n\r\np4\r\n");
  assert.equal(second.generation, generation, "拆分 CRLF 不应触发缓存重置");
  assert.ok(second.frozen.length > 0);
  assert.equal(second.frozen[0]?.source, "p1");
});

test("已闭合围栏不会进入第二前沿", () => {
  const parser = new IncrementalMarkdownParser();
  const snapshot = parser.update("```ts\nconst a = 1\n```\n");
  assert.equal(snapshot.openFence, null);
  assert.match(snapshot.tailSource, /```ts/);
});

test("块划分异常时回退到尾部整段渲染", () => {
  const throwingSplitter: MarkdownBlockSplitter = () => {
    throw new Error("split failed");
  };
  const parser = new IncrementalMarkdownParser(throwingSplitter);
  const snapshot = parser.update("p1\n\np2\n\np3\n\np4\n");
  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.frozen.length, 0);
  assert.equal(snapshot.tailSource, "p1\n\np2\n\np3\n\np4\n");
});

test("块 offset 不完整时回退且不冻结", () => {
  const incompleteSplitter: MarkdownBlockSplitter = () => ["short"];
  const parser = new IncrementalMarkdownParser(incompleteSplitter);
  const snapshot = parser.update("a much longer document");
  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.frozen.length, 0);
  assert.equal(snapshot.tailSource, "a much longer document");
});

test("脚注文档回退到整篇尾部渲染", () => {
  const parser = new IncrementalMarkdownParser();
  const markdown = "p1[^1]\n\np2\n\np3\n\n[^1]: note\n";
  const snapshot = parser.update(markdown);
  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.frozen.length, 0);
  assert.equal(snapshot.tailSource, markdown);
});

test("引用式链接定义到达时丢弃冻结前缀并整篇渲染", () => {
  const parser = new IncrementalMarkdownParser();
  const initial = parser.update("p1\n\np2\n\np3\n\np4\n");
  assert.ok(initial.frozen.length > 0);

  const withDefinition = parser.update("p1\n\np2\n\np3\n\np4\n\n[ref]: https://example.com\n");
  assert.equal(withDefinition.fallback, true);
  assert.equal(withDefinition.frozen.length, 0);
  assert.ok(withDefinition.generation > initial.generation, "必须让渲染器丢弃冻结元素");
  assert.match(withDefinition.tailSource, /^p1/);
});

test("冻结前缀出现奇数 $$ 时不冻结", () => {
  const parser = new IncrementalMarkdownParser();
  const markdown = "before\n\n$$\nx + y\n\np3\n\np4\n";
  const snapshot = parser.update(markdown);
  // `$$` 之后的块会被完整解析器合并，冻结前缀无法独立渲染。
  assert.equal(snapshot.fallback, false);
  assert.equal(snapshot.frozen.length, 0);
  assert.match(snapshot.tailSource, /^before/);
});
