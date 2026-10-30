/**
 * 流式 Markdown 冻结前缀解析。
 *
 * 每个 chunk 重新解析整篇累计文本，成本随回复长度线性增长；把已经稳定的
 * 顶层块冻结后，只需重新解析尾部两个块（外加未闭合围栏的当前行）。块划分
 * 直接复用 Streamdown 的 `parseMarkdownIntoBlocks`，因此冻结切点与渲染器
 * 完全一致，包括脚注、跨块数学公式和未闭合 HTML 的合并规则。
 *
 * 关键约束：
 * - 输入必须是 append-only 的累计文本；不以旧文本为前缀时整体失效。
 * - 冻结块的 key 是完整源文本中的绝对起始 offset，跨 chunk 稳定。
 * - 任何无法证明安全的切分都回退为“尾部整段渲染”，不做猜测。
 * - 未闭合围栏走第二前沿：只有当前未完成行需要重算。
 */

import { parseMarkdownIntoBlocks } from "streamdown";

/** 尾部保留的不稳定顶层块数量；追加文本最多重塑最后一个块，第二块作为安全余量。 */
export const UNSTABLE_TAIL_BLOCKS = 2;

/** 一个已冻结的顶层块。`source` 是该块在完整源文本中的逐字切片。 */
export interface FrozenMarkdownBlock {
  /** 完整源文本中的绝对起始 offset，用作 React key。 */
  readonly key: number;
  readonly source: string;
}

/** 尾部未闭合代码围栏的增量视图。 */
export interface OpenMarkdownFence {
  /** 围栏起始行的绝对 offset，用作代码块 React key。 */
  readonly key: number;
  readonly marker: "`" | "~";
  readonly markerLength: number;
  readonly indent: number;
  readonly language: string;
  /** 已提交行的稳定值 + 当前未完成行，按围栏缩进剥离后的代码文本。 */
  readonly code: string;
}

/** 一次 `update` 的结果。 */
export interface IncrementalMarkdownSnapshot {
  /** 可复用的冻结块；同一解析器实例内只增不减。 */
  readonly frozen: readonly FrozenMarkdownBlock[];
  /** 需要按流式模式重新渲染的尾部源文本；不含未闭合围栏本身。 */
  readonly tailSource: string;
  /** 尾部最后一块是未闭合围栏时的增量描述。 */
  readonly openFence: OpenMarkdownFence | null;
  /** 非追加输入会递增，调用方据此丢弃元素缓存。 */
  readonly generation: number;
  /** 本次因块划分异常或 offset 不完整未冻结新块；尾部按完整源文本渲染。 */
  readonly fallback: boolean;
}

/** 顶层块划分函数，便于单测替换。 */
export type MarkdownBlockSplitter = (source: string) => readonly string[];

/** 默认块划分：与 Streamdown 渲染器共用同一实现。 */
function splitMarkdownBlocks(source: string): readonly string[] {
  return parseMarkdownIntoBlocks(source);
}

interface OpenFenceState {
  readonly key: number;
  readonly marker: "`" | "~";
  readonly markerLength: number;
  readonly indent: number;
  readonly language: string;
  /** 已提交完整行的稳定代码值（保留行结束符）。 */
  readonly valuePrefix: string;
  readonly pendingStart: number;
}

const fenceOpeningPattern = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const lineBreakPattern = /[\r\n]/;
const whitespaceBlockPattern = /^\s*$/;
// 引用式链接定义和脚注会反向影响已渲染的前缀，无法按顶层块冻结。
const referenceDefinitionPattern = /^ {0,3}\[[^\]\n]+\]:/m;
const footnotePattern = /\[\^[\w-]{1,200}\]/;

/** 引用式链接/脚注会让冻结前缀无法独立解析，必须整篇渲染。 */
function hasNonFreezableReference(text: string): boolean {
  return referenceDefinitionPattern.test(text) || footnotePattern.test(text);
}

/** 返回 `start` 之后第一个逻辑行结束位置（包含 CRLF 对）。 */
function lineTerminatorEnd(text: string, start: number): number | undefined {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") return index + 1;
    if (char === "\r") return text[index + 1] === "\n" ? index + 2 : index + 1;
  }
  return undefined;
}

/** 最后一个完整行之前的长度，保留当前未完成行。 */
function committableLinePrefixLength(text: string): number {
  let previousEnd = 0;
  let end = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") {
      previousEnd = end;
      end = index + 1;
      continue;
    }
    if (char !== "\r" || index + 1 >= text.length) continue;
    if (text[index + 1] === "\n") index += 1;
    previousEnd = end;
    end = index + 1;
  }
  return previousEnd;
}

/** 是否包含与起始围栏匹配的闭合围栏行。 */
function containsClosingFence(text: string, marker: "`" | "~", markerLength: number): boolean {
  let start = 0;
  while (start <= text.length) {
    let end = start;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
    const line = text.slice(start, end);
    let indent = 0;
    while (indent < 3 && line[indent] === " ") indent += 1;
    let run = indent;
    while (line[run] === marker) run += 1;
    if (run - indent >= markerLength && /^[ \t]*$/.test(line.slice(run))) return true;
    if (end === text.length) return false;
    start = text[end] === "\r" && text[end + 1] === "\n" ? end + 2 : end + 1;
  }
  return false;
}

/** 按围栏缩进宽度剥离每行最多 `indent` 个前导空格。 */
function stripFenceIndent(source: string, indent: number): string {
  if (indent === 0 || source.length === 0) return source;
  let result = "";
  let index = 0;
  while (index < source.length) {
    let removed = 0;
    while (removed < indent && source[index] === " ") {
      index += 1;
      removed += 1;
    }
    let lineEnd = index;
    while (lineEnd < source.length && !lineBreakPattern.test(source[lineEnd] ?? "")) lineEnd += 1;
    result += source.slice(index, lineEnd);
    if (lineEnd >= source.length) break;
    if (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n") {
      result += "\r\n";
      index = lineEnd + 2;
    } else {
      result += source[lineEnd] ?? "";
      index = lineEnd + 1;
    }
  }
  return result;
}

/** 从未闭合的代码块原始文本中提取第二前沿状态。 */
function readOpenFence(raw: string, absoluteStart: number): OpenFenceState | null {
  const firstLineEnd = lineTerminatorEnd(raw, 0);
  // 起始围栏行尚未完成时不能进入第二前沿：注释/语言还可能继续追加。
  if (firstLineEnd === undefined) return null;
  if (firstLineEnd === raw.length && raw.endsWith("\r")) return null;
  const openingLine = raw.slice(0, firstLineEnd).replace(/[\r\n]+$/, "");
  const opening = fenceOpeningPattern.exec(openingLine);
  if (opening === null) return null;
  const indentText = opening[1] ?? "";
  const markerRun = opening[2] ?? "";
  const info = (opening[3] ?? "").trim();
  const marker = markerRun[0];
  if (marker !== "`" && marker !== "~") return null;
  // CommonMark 规定反引号围栏的 info string 不能包含反引号。
  if (marker === "`" && info.includes("`")) return null;
  const content = raw.slice(firstLineEnd);
  if (containsClosingFence(content, marker, markerRun.length)) return null;
  const stableLength = committableLinePrefixLength(content);
  const valuePrefix = stripFenceIndent(content.slice(0, stableLength), indentText.length);
  return {
    key: absoluteStart,
    marker,
    markerLength: markerRun.length,
    indent: indentText.length,
    language: info.length === 0 ? "text" : (info.split(/\s+/)[0] ?? "text"),
    valuePrefix,
    pendingStart: absoluteStart + firstLineEnd + stableLength,
  };
}

function openFenceView(state: OpenFenceState, code: string): OpenMarkdownFence {
  return {
    key: state.key,
    marker: state.marker,
    markerLength: state.markerLength,
    indent: state.indent,
    language: state.language,
    code,
  };
}

/**
 * append-only 文本上的增量顶层块解析器。一个实例只服务一条流式消息；
 * 非追加输入会清空冻结前缀并递增 generation。
 */
export class IncrementalMarkdownParser {
  private prevText = "";
  private tailStart = 0;
  private frozenBlocks: FrozenMarkdownBlock[] = [];
  private generation = 0;
  private cached: IncrementalMarkdownSnapshot | null = null;
  private openFence: OpenFenceState | null = null;

  /** @param splitBlocks - 顶层块划分；测试可注入自定义实现。 */
  constructor(private readonly splitBlocks: MarkdownBlockSplitter = splitMarkdownBlocks) {}

  /** 回到本次尾部整段渲染，保留已冻结前缀。 */
  private fallbackSnapshot(text: string): IncrementalMarkdownSnapshot {
    return {
      frozen: [...this.frozenBlocks],
      tailSource: text.slice(this.tailStart),
      openFence: null,
      generation: this.generation,
      fallback: true,
    };
  }

  /** 未闭合围栏的追加路径：完整行只提交一次，当前行每个 chunk 重算。 */
  private updateOpenFence(text: string): IncrementalMarkdownSnapshot | null {
    const state = this.openFence;
    if (state === null) return null;
    const pending = text.slice(state.pendingStart);
    if (containsClosingFence(pending, state.marker, state.markerLength)) return null;
    const stableLength = committableLinePrefixLength(pending);
    const nextState: OpenFenceState =
      stableLength === 0
        ? state
        : {
            ...state,
            valuePrefix:
              state.valuePrefix + stripFenceIndent(pending.slice(0, stableLength), state.indent),
            pendingStart: state.pendingStart + stableLength,
          };
    const code =
      nextState.valuePrefix +
      stripFenceIndent(text.slice(nextState.pendingStart), nextState.indent);
    this.openFence = nextState;
    return {
      frozen: [...this.frozenBlocks],
      tailSource: text.slice(this.tailStart, state.key),
      openFence: openFenceView(nextState, code),
      generation: this.generation,
      fallback: false,
    };
  }

  /**
   * 折叠当前累计文本并返回冻结/尾部划分。相同输入幂等。
   * @param text - 完整累计 Markdown 源文本；CRLF/CR 归一为 LF 后再切片，
   * 避免流式 chunk 恰好把 CRLF 拆成两半时被误判为非追加输入。
   */
  update(text: string): IncrementalMarkdownSnapshot {
    const source = text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
    if (this.cached !== null && source === this.prevText) return this.cached;
    if (!source.startsWith(this.prevText)) {
      this.prevText = "";
      this.tailStart = 0;
      this.frozenBlocks = [];
      this.openFence = null;
      this.generation += 1;
    }
    if (this.prevText.length > 0 && this.openFence !== null) {
      const incremental = this.updateOpenFence(source);
      if (incremental !== null) {
        this.prevText = source;
        this.cached = incremental;
        return incremental;
      }
      this.openFence = null;
    }
    // 引用式链接/脚注定义到达时，之前冻结的元素无法再独立解析：丢弃缓存并整篇尾部渲染。
    // 只检查未冻结尾部：任何定义都会先出现在尾部，冻结前缀不可能已经含有它。
    const nonFreezableReference = hasNonFreezableReference(source.slice(this.tailStart));
    if (nonFreezableReference && (this.tailStart > 0 || this.frozenBlocks.length > 0)) {
      this.frozenBlocks = [];
      this.tailStart = 0;
      this.generation += 1;
    }
    const base = this.tailStart;
    const tailSource = source.slice(base);
    let blocks: readonly string[];
    try {
      blocks = this.splitBlocks(tailSource);
    } catch {
      this.prevText = source;
      this.cached = this.fallbackSnapshot(source);
      return this.cached;
    }
    let consumed = 0;
    let offsetsComplete = true;
    const starts = blocks.map((block) => {
      const start = consumed;
      consumed += block.length;
      return start;
    });
    if (consumed !== tailSource.length) offsetsComplete = false;
    const contentIndices: number[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      if (!whitespaceBlockPattern.test(blocks[index] ?? "")) contentIndices.push(index);
    }
    let firstUnstableIndex = 0;
    if (offsetsComplete && !nonFreezableReference && contentIndices.length > UNSTABLE_TAIL_BLOCKS) {
      firstUnstableIndex = contentIndices[contentIndices.length - UNSTABLE_TAIL_BLOCKS] ?? 0;
    }
    if (firstUnstableIndex > 0) {
      for (let index = 0; index < firstUnstableIndex; index += 1) {
        const block = blocks[index];
        if (block === undefined || whitespaceBlockPattern.test(block)) continue;
        this.frozenBlocks.push({
          key: base + (starts[index] ?? 0),
          source: block,
        });
      }
      this.tailStart = base + (starts[firstUnstableIndex] ?? 0);
    }
    const lastContentIndex = contentIndices.at(-1);
    let fence: OpenMarkdownFence | null = null;
    if (lastContentIndex !== undefined && offsetsComplete && !nonFreezableReference) {
      const lastBlock = blocks[lastContentIndex];
      const fenceStart = base + (starts[lastContentIndex] ?? 0);
      // 未闭合围栏必须一直延伸到文本末尾，否则交给普通尾部渲染。
      if (lastBlock !== undefined && fenceStart + lastBlock.length === source.length) {
        this.openFence = readOpenFence(lastBlock, fenceStart);
        if (this.openFence !== null) {
          const pending = source.slice(this.openFence.pendingStart);
          const code =
            this.openFence.valuePrefix + stripFenceIndent(pending, this.openFence.indent);
          fence = openFenceView(this.openFence, code);
        }
      }
    }
    this.prevText = source;
    this.cached = {
      frozen: [...this.frozenBlocks],
      tailSource:
        fence === null ? source.slice(this.tailStart) : source.slice(this.tailStart, fence.key),
      openFence: fence,
      generation: this.generation,
      fallback: !offsetsComplete || nonFreezableReference,
    };
    return this.cached;
  }
}
