import { parse } from "unbash";
import type {
  AndOr,
  ArithmeticFor,
  BraceGroup,
  Case,
  Command,
  CompoundList,
  If,
  Node,
  Pipeline,
  Redirect,
  Script,
  Statement,
  Subshell,
  While,
  Word,
  WordPart,
} from "unbash";

/**
 * 破坏性 Git 命令的稳定分类 id。新增分类时同步更新
 * specs/security/git-destructive-command-guard.md 的规则与验收场景。
 */
export type DestructiveGitCategory =
  | "branch-force-delete"
  | "checkout-discard"
  | "clean-force"
  | "gc-prune-now"
  | "push-force"
  | "reflog-expire-now"
  | "reset-hard"
  | "restore-worktree"
  | "stash-clear"
  | "stash-drop";

export interface DestructiveGitFinding {
  /** 稳定分类 id，供日志/测试断言，不面向最终用户。 */
  readonly category: DestructiveGitCategory;
  /** 归一化后的命令文本，用于让用户/模型确认具体是哪条命令。 */
  readonly commandText: string;
  /** 规范化 argv（从 git 开始），便于测试和后续策略扩展。 */
  readonly argv: readonly string[];
  /** 本次操作会破坏什么。 */
  readonly summary: string;
  /** 明显的安全替代做法。 */
  readonly alternative: string;
}

export interface DestructiveGitScan {
  readonly findings: readonly DestructiveGitFinding[];
  /** shell 本身是否解析失败；失败时调用方仍按既有非只读策略询问/拒绝。 */
  readonly hasParseErrors: boolean;
}

const MAX_BASH_PARSE_LENGTH = 10_000;
const MAX_NESTED_DEPTH = 8;
const MAX_REPORTED_COMMANDS = 3;

const SHELL_EXECUTABLES = new Set(["bash", "dash", "ksh", "sh", "zsh"]);

const WRAPPER_EXECUTABLES = new Set([
  "builtin",
  "command",
  "env",
  "exec",
  "nice",
  "noglob",
  "nohup",
  "sudo",
  "time",
  "timeout",
]);

const WRAPPER_SHORT_OPTIONS_WITH_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
  env: new Set(["C", "S", "u"]),
  exec: new Set(["a"]),
  nice: new Set(["n"]),
  sudo: new Set([
    "C",
    "D",
    "R",
    "T",
    "U",
    "a",
    "c",
    "g",
    "h",
    "p",
    "r",
    "t",
    "u",
  ]),
  time: new Set(["f", "o"]),
  timeout: new Set(["k", "s"]),
};

const WRAPPER_LONG_OPTIONS_WITH_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
  env: new Set(["chdir", "unset"]),
  sudo: new Set([
    "askpass",
    "chdir",
    "chroot",
    "close-from",
    "group",
    "host",
    "prompt",
    "role",
    "type",
    "user",
  ]),
  time: new Set(["format", "output"]),
  timeout: new Set(["kill-after", "signal"]),
};

const GIT_GLOBAL_LONG_OPTIONS_WITH_VALUE = new Set([
  "config-env",
  "git-dir",
  "namespace",
  "super-prefix",
  "work-tree",
]);

const CATEGORY_META: Readonly<
  Record<DestructiveGitCategory, { summary: string; alternative: string }>
> = {
  "branch-force-delete": {
    summary:
      "deletes a branch together with commits that may not be merged anywhere (Git refuses to delete the current branch)",
    alternative:
      "create a backup tag/branch and inspect it with `git log <branch>` first; `git branch -d` only deletes merged branches",
  },
  "checkout-discard": {
    summary: "overwrites working-tree files and discards uncommitted changes",
    alternative:
      "inspect with `git diff -- <paths>` and save work with `git stash push -u -- <paths>` first",
  },
  "clean-force": {
    summary: "permanently removes untracked files and directories",
    alternative:
      "preview with `git clean -nd` first and commit or `git stash push -u` before cleaning",
  },
  "gc-prune-now": {
    summary: "prunes unreachable objects immediately and removes the recovery window",
    alternative:
      "run `git gc` without `--prune=now`, and create a backup or `git fsck --lost-found` first",
  },
  "push-force": {
    summary: "rewrites remote history and can discard teammates' commits",
    alternative:
      "prefer `git push --force-with-lease --force-if-includes`, and confirm the remote branch is yours",
  },
  "reflog-expire-now": {
    summary: "expires reflog entries immediately and removes the recovery path for lost commits",
    alternative:
      "run `git reflog expire --dry-run` first; keep the default expiry instead of `now`",
  },
  "reset-hard": {
    summary: "discards uncommitted working-tree and index changes",
    alternative:
      "commit or `git stash push -u` first; `git reset --soft`/`--mixed` keeps working-tree files",
  },
  "restore-worktree": {
    summary: "overwrites working-tree files and discards uncommitted changes",
    alternative:
      "use `git restore --staged` to only unstage, or save work with `git stash push -u` first",
  },
  "stash-clear": {
    summary: "permanently deletes every stash entry",
    alternative: "inspect with `git stash list`/`git stash show -p` and create a backup branch first",
  },
  "stash-drop": {
    summary: "permanently deletes a stash entry and its changes",
    alternative: "inspect with `git stash show -p <stash>` and create a backup branch first",
  },
};

interface ClassifierContext {
  readonly depth: number;
  readonly findings: DestructiveGitFinding[];
  readonly seen: Set<string>;
}

/**
 * 纯函数：解析 command 并返回其中的破坏性 Git 操作。
 * 不读文件、不访问网络、不启动进程，也不改写命令。
 */
export function classifyDestructiveGitCommand(command: string): DestructiveGitScan {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { findings: [], hasParseErrors: false };
  if (command.length > MAX_BASH_PARSE_LENGTH) {
    return { findings: [], hasParseErrors: true };
  }

  let script: Script & { errors?: unknown[] };
  try {
    script = parse(command);
  } catch {
    return { findings: [], hasParseErrors: true };
  }

  const context: ClassifierContext = {
    depth: 0,
    findings: [],
    seen: new Set(),
  };
  visitScript(script, context);

  return {
    findings: context.findings,
    hasParseErrors: Boolean(script.errors?.length),
  };
}

/**
 * 构造面向用户/模型的单行理由。调用方只在命中时使用；未命中返回空字符串。
 */
export function formatDestructiveGitReason(findings: readonly DestructiveGitFinding[]): string {
  if (findings.length === 0) return "";
  const commands = findings
    .slice(0, MAX_REPORTED_COMMANDS)
    .map((finding) => `\`${finding.commandText}\``)
    .join(", ");
  const remainder =
    findings.length > MAX_REPORTED_COMMANDS
      ? ` (+${findings.length - MAX_REPORTED_COMMANDS} more)`
      : "";
  const summaries = uniqueStrings(findings.map((finding) => finding.summary)).join("; ");
  return `Destructive Git command: ${commands}${remainder} ${summaries}. Safe alternative: ${findings[0]!.alternative}.`;
}

function visitScript(script: Script, context: ClassifierContext): void {
  for (const statement of script.commands) {
    visitStatement(statement, context);
  }
}

function visitStatement(statement: Statement, context: ClassifierContext): void {
  visitRedirects(statement.redirects, context);
  visitNode(statement.command, context);
}

function visitNode(node: Node, context: ClassifierContext): void {
  if (context.depth > MAX_NESTED_DEPTH) return;
  const nested = { ...context, depth: context.depth + 1 };

  switch (node.type) {
    case "Command":
      visitCommand(node, context);
      return;
    case "AndOr":
      visitAndOr(node, context);
      return;
    case "Pipeline":
      visitPipeline(node, context);
      return;
    case "Statement":
      visitStatement(node, context);
      return;
    case "Subshell":
      visitSubshell(node, nested);
      return;
    case "BraceGroup":
      visitBraceGroup(node, nested);
      return;
    case "CompoundList":
      visitCompoundList(node, nested);
      return;
    case "If":
      visitIf(node, nested);
      return;
    case "For":
      visitWords(node.wordlist, nested);
      visitCompoundList(node.body, nested);
      return;
    case "ArithmeticFor":
      visitArithmeticFor(node, nested);
      return;
    case "Select":
      visitWords(node.wordlist, nested);
      visitCompoundList(node.body, nested);
      return;
    case "While":
      visitWhile(node, nested);
      return;
    case "Function":
      visitNode(node.body, nested);
      return;
    case "Coproc":
      visitNode(node.body, nested);
      return;
    case "Case":
      visitCase(node, nested);
      return;
    default:
      return;
  }
}

function visitAndOr(node: AndOr, context: ClassifierContext): void {
  const nested = { ...context, depth: context.depth + 1 };
  for (const command of node.commands) visitNode(command, nested);
}

function visitPipeline(node: Pipeline, context: ClassifierContext): void {
  const nested = { ...context, depth: context.depth + 1 };
  for (const command of node.commands) visitNode(command, nested);
}

function visitSubshell(node: Subshell, context: ClassifierContext): void {
  visitCompoundList(node.body, context);
}

function visitBraceGroup(node: BraceGroup, context: ClassifierContext): void {
  visitCompoundList(node.body, context);
}

function visitCompoundList(node: CompoundList, context: ClassifierContext): void {
  const nested = { ...context, depth: context.depth + 1 };
  for (const statement of node.commands) visitStatement(statement, nested);
}

function visitIf(node: If, context: ClassifierContext): void {
  visitCompoundList(node.clause, context);
  visitCompoundList(node.then, context);
  if (node.else?.type === "If") visitIf(node.else, context);
  else if (node.else) visitCompoundList(node.else, context);
}

function visitWhile(node: While, context: ClassifierContext): void {
  visitCompoundList(node.clause, context);
  visitCompoundList(node.body, context);
}

function visitArithmeticFor(node: ArithmeticFor, context: ClassifierContext): void {
  visitCompoundList(node.body, context);
}

function visitCase(node: Case, context: ClassifierContext): void {
  for (const item of node.items) visitCompoundList(item.body, context);
}

function visitCommand(command: Command, context: ClassifierContext): void {
  const words = [command.name, ...command.suffix].filter(isWord);
  for (const word of words) visitWord(word, context);
  for (const assignment of command.prefix) {
    if (assignment.value) visitWord(assignment.value, context);
  }
  visitRedirects(command.redirects, context);

  if (words.length === 0) return;
  const argv = words.map(wordValue);
  inspectArgv(argv, context);
}

function visitRedirects(redirects: readonly Redirect[], context: ClassifierContext): void {
  for (const redirect of redirects) {
    if (redirect.target) visitWord(redirect.target, context);
    if (redirect.body) visitWord(redirect.body, context);
  }
}

function visitWords(words: readonly Word[], context: ClassifierContext): void {
  for (const word of words) visitWord(word, context);
}

function visitWord(word: Word, context: ClassifierContext): void {
  for (const part of word.parts ?? []) visitWordPart(part, context);
}

function visitWordPart(part: WordPart, context: ClassifierContext): void {
  if (context.depth > MAX_NESTED_DEPTH) return;
  const nested = { ...context, depth: context.depth + 1 };

  switch (part.type) {
    case "DoubleQuoted":
    case "LocaleString":
      for (const child of part.parts) visitWordPart(child, nested);
      return;
    case "CommandExpansion":
    case "ProcessSubstitution":
      if (part.script) {
        visitScript(part.script, nested);
      } else if (part.inner) {
        visitNestedScriptText(part.inner, nested);
      }
      return;
    case "ParameterExpansion":
      if (part.operand) visitWord(part.operand, nested);
      if (part.replace) {
        visitWord(part.replace.pattern, nested);
        visitWord(part.replace.replacement, nested);
      }
      return;
    default:
      return;
  }
}

interface ResolvedCommand {
  readonly kind: "git" | "other" | "shell-script";
  readonly argv: readonly string[];
  readonly script?: string;
}

function inspectArgv(argv: readonly string[], context: ClassifierContext): void {
  const resolved = resolveEffectiveCommand(argv);
  if (resolved.kind === "git") {
    const finding = classifyGitInvocation(resolved.argv);
    if (finding) recordFinding(finding, context);
    return;
  }
  if (resolved.kind === "shell-script" && resolved.script) {
    visitNestedScriptText(resolved.script, { ...context, depth: context.depth + 1 });
  }
}

function visitNestedScriptText(source: string, context: ClassifierContext): void {
  let script: Script & { errors?: unknown[] };
  try {
    script = parse(source);
  } catch {
    return;
  }
  visitScript(script, context);
}

function recordFinding(finding: DestructiveGitFinding, context: ClassifierContext): void {
  const key = `${finding.category}\u0000${finding.commandText}`;
  if (context.seen.has(key)) return;
  context.seen.add(key);
  context.findings.push(finding);
}

function resolveEffectiveCommand(argv: readonly string[]): ResolvedCommand {
  let index = 0;
  for (let depth = 0; depth < 4 && index < argv.length; depth += 1) {
    const executable = executableBasename(argv[index]!);
    if (!executable) return { kind: "other", argv: [] };

    if (SHELL_EXECUTABLES.has(executable)) {
      const script = readShellCommandString(argv.slice(index + 1));
      return script === undefined
        ? { kind: "other", argv: [] }
        : { kind: "shell-script", argv: argv.slice(index), script };
    }

    if (!WRAPPER_EXECUTABLES.has(executable)) {
      return executable === "git"
        ? { kind: "git", argv: argv.slice(index) }
        : { kind: "other", argv: [] };
    }

    const next = unwrapWrapper(executable, argv, index);
    if (next === undefined) return { kind: "other", argv: [] };
    index = next;
  }
  return { kind: "other", argv: [] };
}

function unwrapWrapper(
  executable: string,
  argv: readonly string[],
  startIndex: number,
): number | undefined {
  let index = startIndex + 1;
  const shortWithValue = WRAPPER_SHORT_OPTIONS_WITH_VALUE[executable] ?? new Set<string>();
  const longWithValue = WRAPPER_LONG_OPTIONS_WITH_VALUE[executable] ?? new Set<string>();

  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (executable === "env" && isAssignmentToken(token)) {
      index += 1;
      continue;
    }
    if (executable === "timeout" && !token.startsWith("-")) {
      // timeout 的第一个位置参数是时长，真正命令在其后。
      index += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const name = equalsIndex >= 0 ? token.slice(2, equalsIndex) : token.slice(2);
      index += equalsIndex < 0 && longWithValue.has(name) ? 2 : 1;
      continue;
    }

    const cluster = token.slice(1);
    let needsValue = false;
    for (let offset = 0; offset < cluster.length; offset += 1) {
      if (shortWithValue.has(cluster[offset]!)) {
        needsValue = offset === cluster.length - 1;
        break;
      }
    }
    index += needsValue ? 2 : 1;
  }

  return index < argv.length ? index : undefined;
}

function readShellCommandString(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "-c" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(token)) {
      return args[index + 1];
    }
  }
  return undefined;
}

interface ParsedGitInvocation {
  readonly subcommand: string;
  readonly args: readonly string[];
}

function parseGitInvocation(argv: readonly string[]): ParsedGitInvocation | undefined {
  let index = 1;
  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const name = equalsIndex >= 0 ? token.slice(2, equalsIndex) : token.slice(2);
      index +=
        equalsIndex < 0 && GIT_GLOBAL_LONG_OPTIONS_WITH_VALUE.has(name)
          ? 2
          : 1;
      continue;
    }

    if (token === "-C" || token === "-c") {
      index += 2;
      continue;
    }
    if (token.startsWith("-C") || token.startsWith("-c")) {
      index += 1;
      continue;
    }
    // 其余全局短 flag（-p/-P/-h 等）不消费后续 token。
    index += 1;
  }

  const subcommand = argv[index];
  if (subcommand === undefined) return undefined;
  return { subcommand, args: argv.slice(index + 1) };
}

interface ParsedArgs {
  readonly shortFlags: ReadonlySet<string>;
  readonly longFlags: ReadonlySet<string>;
  readonly longValues: ReadonlyMap<string, string>;
  readonly positionals: readonly string[];
  readonly afterSeparator: readonly string[];
}

const EMPTY_PARSE_OPTIONS = {
  shortWithValue: new Set<string>(),
  longWithValue: new Set<string>(),
} as const;

function parseArgs(
  args: readonly string[],
  options: {
    shortWithValue?: ReadonlySet<string>;
    longWithValue?: ReadonlySet<string>;
  } = EMPTY_PARSE_OPTIONS,
): ParsedArgs {
  const shortWithValue = options.shortWithValue ?? EMPTY_PARSE_OPTIONS.shortWithValue;
  const longWithValue = options.longWithValue ?? EMPTY_PARSE_OPTIONS.longWithValue;
  const shortFlags = new Set<string>();
  const longFlags = new Set<string>();
  const longValues = new Map<string, string>();
  const positionals: string[] = [];
  const afterSeparator: string[] = [];

  let afterSeparatorSeen = false;
  let index = 0;
  while (index < args.length) {
    const token = args[index]!;
    if (afterSeparatorSeen) {
      afterSeparator.push(token);
      positionals.push(token);
      index += 1;
      continue;
    }
    if (token === "--") {
      afterSeparatorSeen = true;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const name = equalsIndex >= 0 ? token.slice(2, equalsIndex) : token.slice(2);
      longFlags.add(name);
      if (equalsIndex >= 0) {
        longValues.set(name, token.slice(equalsIndex + 1));
        index += 1;
        continue;
      }
      if (longWithValue.has(name) && index + 1 < args.length) {
        longValues.set(name, args[index + 1]!);
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      const cluster = token.slice(1);
      let needsValue = false;
      for (let offset = 0; offset < cluster.length; offset += 1) {
        const flag = cluster[offset]!;
        shortFlags.add(flag);
        if (shortWithValue.has(flag)) {
          needsValue = offset === cluster.length - 1;
          break;
        }
      }
      index += needsValue ? 2 : 1;
      continue;
    }
    positionals.push(token);
    index += 1;
  }

  return { shortFlags, longFlags, longValues, positionals, afterSeparator };
}

function classifyGitInvocation(argv: readonly string[]): DestructiveGitFinding | undefined {
  const invocation = parseGitInvocation(argv);
  if (!invocation) return undefined;

  switch (invocation.subcommand) {
    case "branch":
      return classifyBranch(argv, invocation.args);
    case "checkout":
      return classifyCheckout(argv, invocation.args);
    case "clean":
      return classifyClean(argv, invocation.args);
    case "gc":
      return classifyGc(argv, invocation.args);
    case "push":
      return classifyPush(argv, invocation.args);
    case "reflog":
      return classifyReflog(argv, invocation.args);
    case "reset":
      return classifyReset(argv, invocation.args);
    case "restore":
      return classifyRestore(argv, invocation.args);
    case "stash":
      return classifyStash(argv, invocation.args);
    default:
      return undefined;
  }
}

function classifyReset(argv: readonly string[], args: readonly string[]): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args);
  if (!parsed.longFlags.has("hard")) return undefined;
  return createFinding("reset-hard", argv);
}

function classifyClean(argv: readonly string[], args: readonly string[]): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["e"]),
    longWithValue: new Set(["exclude"]),
  });
  // -n/--dry-run 明确不删除任何东西，即使同时给了 -f。
  if (parsed.shortFlags.has("n") || parsed.longFlags.has("dry-run")) return undefined;
  const forced = parsed.shortFlags.has("f") || parsed.longFlags.has("force");
  return forced ? createFinding("clean-force", argv) : undefined;
}

function classifyCheckout(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["b", "B", "c", "C", "t", "U"]),
    longWithValue: new Set([
      "conflict",
      "orphan",
      "pathspec-from-file",
      "recurse-submodules",
      "inter-hunk-context",
      "unified",
    ]),
  });
  const force = parsed.shortFlags.has("f") || parsed.longFlags.has("force");
  const pathspecFromFile = parsed.longFlags.has("pathspec-from-file");
  // `--` 后的任意 token 都是 pathspec，不再依赖路径形态判断（可为普通文件名）。
  const explicitPathspec = parsed.afterSeparator.length > 0;
  const pathTokens = explicitPathspec ? parsed.afterSeparator : parsed.positionals;
  const unmergedSelection =
    parsed.longFlags.has("ours") ||
    parsed.longFlags.has("theirs") ||
    parsed.shortFlags.has("2") ||
    parsed.shortFlags.has("3");
  const discardsPaths =
    pathspecFromFile ||
    explicitPathspec ||
    pathTokens.some(isPathLikeToken) ||
    (unmergedSelection && pathTokens.length > 0);
  return force || discardsPaths ? createFinding("checkout-discard", argv) : undefined;
}

function classifyRestore(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["s"]),
    longWithValue: new Set([
      "conflict",
      "inter-hunk-context",
      "pathspec-from-file",
      "recurse-submodules",
      "source",
      "unified",
    ]),
  });
  const staged = parsed.shortFlags.has("S") || parsed.longFlags.has("staged");
  const noStaged = parsed.longFlags.has("no-staged");
  const worktreeFlag = parsed.shortFlags.has("W") || parsed.longFlags.has("worktree");
  const noWorktree = parsed.longFlags.has("no-worktree");
  // 默认恢复工作区；只有明确 --staged（且没有 --worktree）时才只动索引。
  const touchesWorktree = noWorktree ? false : worktreeFlag || !(staged && !noStaged);
  const hasPaths = parsed.positionals.length > 0 || parsed.afterSeparator.length > 0;
  return touchesWorktree && hasPaths ? createFinding("restore-worktree", argv) : undefined;
}

function classifyPush(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["o"]),
    longWithValue: new Set(["exec", "push-option", "receive-pack", "repo"]),
  });
  const forceWithLease = parsed.longFlags.has("force-with-lease");
  const force =
    parsed.shortFlags.has("f") ||
    parsed.longFlags.has("force") ||
    forceWithLease ||
    parsed.longFlags.has("mirror") ||
    parsed.positionals.some(isForceRefspec);
  if (!force) return undefined;

  const category: DestructiveGitCategory = "push-force";
  const meta = CATEGORY_META[category];
  const summary = parsed.longFlags.has("mirror")
    ? "mirrors local refs to the remote and deletes remote refs that do not exist locally"
    : forceWithLease
      ? "rewrites remote history (the lease check is safer but still destructive)"
      : meta.summary;
  return {
    category,
    commandText: formatArgv(argv),
    argv: [...argv],
    summary,
    alternative: meta.alternative,
  };
}

function classifyBranch(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["u"]),
    longWithValue: new Set([
      "abbrev",
      "columns",
      "contains",
      "format",
      "merged",
      "no-contains",
      "no-merged",
      "points-at",
      "set-upstream-to",
      "sort",
    ]),
  });
  const forceDelete =
    parsed.shortFlags.has("D") ||
    (parsed.longFlags.has("delete") &&
      (parsed.shortFlags.has("f") || parsed.longFlags.has("force")));
  return forceDelete && parsed.positionals.length > 0
    ? createFinding("branch-force-delete", argv)
    : undefined;
}

function classifyStash(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  // -m/--message 等取值选项必须先消费掉，否则 `git stash -m drop` 会把消息当成 action。
  const parsed = parseArgs(args, {
    shortWithValue: new Set(["m"]),
    longWithValue: new Set(["message", "pathspec-from-file"]),
  });
  const action = parsed.positionals[0];
  if (action === "drop") return createFinding("stash-drop", argv);
  if (action === "clear") return createFinding("stash-clear", argv);
  return undefined;
}

function classifyReflog(
  argv: readonly string[],
  args: readonly string[],
): DestructiveGitFinding | undefined {
  const parsed = parseArgs(args, {
    longWithValue: new Set(["expire", "expire-unreachable"]),
  });
  if (parsed.positionals[0] !== "expire") return undefined;
  if (parsed.shortFlags.has("n") || parsed.longFlags.has("dry-run")) return undefined;
  const expireNow =
    parsed.longValues.get("expire") === "now" ||
    parsed.longValues.get("expire-unreachable") === "now";
  return expireNow ? createFinding("reflog-expire-now", argv) : undefined;
}

function classifyGc(argv: readonly string[], args: readonly string[]): DestructiveGitFinding | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--prune=now") return createFinding("gc-prune-now", argv);
    if (token === "--prune" && args[index + 1] === "now") {
      return createFinding("gc-prune-now", argv);
    }
  }
  return undefined;
}

function createFinding(
  category: DestructiveGitCategory,
  argv: readonly string[],
): DestructiveGitFinding {
  const meta = CATEGORY_META[category];
  return {
    category,
    commandText: formatArgv(argv),
    argv: [...argv],
    summary: meta.summary,
    alternative: meta.alternative,
  };
}

function isPathLikeToken(token: string): boolean {
  if (token.length === 0) return false;
  if (token === "." || token === "..") return true;
  if (token.startsWith("./") || token.startsWith("../")) return true;
  if (token.startsWith("/") || /^[A-Za-z]:[\\/]/.test(token)) return true;
  // :(top)、:(glob) 等 Git pathspec magic。
  if (token.startsWith(":")) return true;
  if (token.endsWith("/")) return true;
  return /[*?[]/.test(token);
}

function isForceRefspec(token: string): boolean {
  return token.length > 1 && token.startsWith("+");
}

function isAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function executableBasename(token: string): string {
  const normalized = token.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  return basename.endsWith(".exe") ? basename.slice(0, -4) : basename;
}

function wordValue(word: Word): string {
  return word.value ?? word.text;
}

function isWord(word: Word | undefined): word is Word {
  return word !== undefined;
}

function formatArgv(argv: readonly string[]): string {
  return argv.map(formatArg).join(" ");
}

function formatArg(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~^-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
