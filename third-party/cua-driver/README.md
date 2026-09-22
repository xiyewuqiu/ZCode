# third-party/cua-driver

Vendored 的 [trycua/cua](https://github.com/trycua/cua) `cua-driver` Rust workspace。YCode（Windows 桌面为主）
用它作为"电脑控制"能力的 MCP 驱动：驱动本身是一个跨平台桌面自动化 daemon，通过 stdio/HTTP 暴露
MCP JSON-RPC 工具（截图、UIA 元素树、点击、输入、窗口、浏览器 CDP 等）。

本目录是**完整复制的上游 Cargo workspace**，不是子模块，构建不依赖网络上的上游仓库。

## 来源与版本

| 项 | 值 |
| --- | --- |
| 上游仓库 | `https://github.com/trycua/cua` |
| 上游路径 | `libs/cua-driver/rust` |
| 上游提交 | `27a318c3a616f9ff19d24fe2acca7517c5f8fa7b`（2026-09-22，见 `UPSTREAM-REVISION`） |
| 上游版本 | `0.28.2`（`VERSION` / `Cargo.toml` 的 `workspace.package.version`） |
| 许可 | MIT，见 `LICENSE`（复制自上游仓库根 `LICENSE.md`，Copyright (c) 2025 Cua AI, Inc.） |
| 上游 README | 原件保存在 `UPSTREAM-README.md`（本文件覆盖了 `README.md` 位置） |

复制基线：`robocopy /E`，487 个文件 / 12 874 507 字节，与上游逐字节一致；本目录内所有 ZCode 改动见
下文"已做的改动"。

## 目录结构

- `crates/`：13 个 crate。`cua-driver`（CLI/MCP 主程序）、`cua-driver-core`（协议/工具模型/策略）、
  `platform-windows`（UIA/截图/输入/浮窗）、`platform-macos`、`platform-linux`、`cua-driver-uia`、
  `cursor-overlay`、`cursor-theme-cli`、`cua-driver-testkit`、`cua-driver-contract`、`cua-driver-sdk`、
  `cua-driver-bindgen`、`pip-preview`。
- `include/`：C ABI 头（`cua_driver_abi.h`）。
- `Skills/`、`scripts/`、`examples/`、`tests/`、`test-apps/`：上游自带的技能包、打包脚本、示例与测试夹具。
- `vendor/msvc-spectre-libs/`：ZCode 新增，见"Windows 构建环境补丁"。
- `target/`：Cargo 构建产物，已 gitignore。

上游 crate 用途与测试矩阵见 `UPSTREAM-README.md` 与 `crates/cua-driver/tests/README.md`。

## 构建

在仓库根目录执行：

```powershell
pnpm build:cua-driver                  # = node scripts/build-cua-driver.mjs
node scripts/build-cua-driver.mjs --check       # 只校验落盘产物与 --version
node scripts/build-cua-driver.mjs --skip-deps   # 跳过 rustup 预检，复用当前 cargo
node scripts/build-cua-driver.mjs --target=x86_64-pc-windows-msvc --jobs=8
```

脚本行为：

1. 读 `rust-toolchain.toml` 的 `channel`（当前 `1.97.1`），缺失时用 `rustup toolchain install <channel>
   --profile minimal` 装上；**不静默改版本**，装不上就带提示失败。
2. 在 `third-party/cua-driver/` 内执行 `cargo build --release --bin cua-driver`。
3. 把 `target/release/cua-driver.exe`、`LICENSE` 与 `SOURCES.json` 落到
   `packages/desktop/bundled-tools/<platformKey>/cua-driver/`（本机 `win32-x64`）。

也可以直接手写 cargo：

```powershell
cd third-party/cua-driver
cargo build --release --bin cua-driver
```

### 产物与 Electron 打包

`packages/desktop/bundled-tools/` 已在根 `.gitignore`（二进制不入库）。`packages/desktop/electron-builder.config.js`
的 `extraResources` 现已包含 cua-driver：

```js
{
  from: `bundled-tools/${targetPlatform.key}/cua-driver`,
  to: "tools/cua-driver",
  filter: ["**/*", "!**/*.map"],
}
```

`targetPlatform.key` 即 `<os>-<arch>`（`packages/desktop/scripts/target-platform.mjs`），与 build 脚本的落盘目录
`packages/desktop/bundled-tools/<platformKey>/cua-driver/` 同源，Windows 上都是 `win32-x64`，不需要额外映射。
安装包内最终路径：`resources/tools/cua-driver/cua-driver.exe`（同目录还有 `LICENSE` 与 `SOURCES.json`）。
host 侧状态探测按同一路径解析（`packages/desktop/src/host/computerControlDriverStatus.ts`：打包态
`process.resourcesPath/tools/cua-driver/...`，开发态仓库内 `bundled-tools/<platformKey>/cua-driver/...`）。

### Windows 构建环境补丁

`cua-driver-core` → `regorus` → `msvc_spectre_libs/error` 的 build 脚本会在"没装 Visual Studio
Spectre-mitigated libs 组件"的 Windows 主机上直接 panic（本机 BuildTools 即缺该可选组件）。
本仓库用 `Cargo.toml` 的 `[patch.crates-io]` 指向 `vendor/msvc-spectre-libs/`（无 build 脚本的空实现）。

该 crate 只做一件事：把 Spectre 版 CRT 目录加进 native link search path；它自己不打开 `/Qspectre`。
本 workspace 用默认（非 Spectre）CRT 构建，本就不链接那些库，所以去掉 build 脚本只移除了一项主机要求，
不改变任何被链接的内容。若某台机器确实装了该组件、希望恢复上游行为，删除
`[patch.crates-io]` 一节与 `vendor/` 目录即可（`Cargo.lock` 会随之回退）。

## 遥测已剥离（ZCode 改动）

上游 `crates/cua-driver/src/telemetry.rs` 是一个默认开启的 PostHog 上报器：构造固定字段的 payload、
在 `~/.cua-driver/` 落盘伪匿名安装 ID、把待发事件写入 spool、并 fork 出无输出的 worker 进程用
`ureq` + rustls 往 `https://eu.i.posthog.com/capture/` POST（API key 硬编码在源码里）。

ZCode 要求零上报，因此该文件被**整体重写为惰性空实现**（3683 行 → 246 行）：

| 被删除的内容 | 说明 |
| --- | --- |
| `POSTHOG_CAPTURE_URL` / `POSTHOG_API_KEY` / `POSTHOG_TIMEOUT_SECS` | 上报端点、API key 与超时；产物里已搜不到前两个字符串 |
| `post_to_posthog` / `post_to_posthog_with_timeout` | 唯一发起 HTTP POST 的地方 |
| payload 构造（`build_payload`、`bounded_properties`、各类 `*_properties`） | 事件字段拼装 |
| 安装身份（`get_or_create_install_id`、`.telemetry_id`、`.telemetry_identity.lock`、`config.json` 的 `telemetry_enabled`） | 本地身份与偏好落盘 |
| spool 与投递（`spawn_payload`、`PENDING_SENDS`、worker 子进程的 `ENV_*_WORKER` 通道、`flush_pending` 的等待） | 队列、重试、后台进程 |
| `TelemetryObserver` 与 `register_stdio_observer` 的注册 | 挂在 core 上的 stdio/session 观测钩子 |
| 首次运行提示 `eprintln!("...sends content-free product telemetry by default...")` | 启动噪音 |
| 上游 telemetry 单元测试与全部事件常量 | — |

保留的惰性接口（调用点保留、函数体为空，便于比对上游 diff）：`capture_*` 全部为空函数，
`is_enabled()` 恒为 `false`，`status()` 返回 `{ enabled: false, source: "removed", ... }`，
`flush_pending()` 不再等待，`run_*_worker_if_requested()` / `is_wrapped_cli_child()` 恒 `false`。
`cua-driver telemetry status` 仍可用（用于自证），`enable` 会返回错误（exit 1），`inspect` 不再有
payload 可看（exit 64）。

`reset_id()` 是唯一保留写盘语义的入口，且只删不写：如果这台机器以前装过上游 cua-driver，
`~/.cua-driver/` 与 `~/.cua-driver-rs/` 下可能残留 `.telemetry_id`、`.installation_recorded`、
`.telemetry_retry_after`、`.telemetry_install_channel` 与 `.release_installed/`，`telemetry reset-id`
会真的把它们删掉（不会碰 `config.json` 等其它状态）。

其他文件里的配套改动：

- `crates/cua-driver/src/main.rs`：删除 `maybe_wrap_finite_command()` 及其两处调用。该包装只为"父进程观察
  CLI 子进程退出码再交给遥测 worker"而存在，剥离后它只会白多起一个进程，属于必须删的行为面。
- `crates/cua-driver/src/cli.rs`：删除 11 个只服务于遥测的 `finite_*` 命令行分类器（`finite_command_name_*`、
  `finite_tool_name_*`、`finite_computer_action_*`、`finite_operation_*`、`finite_client_kind_*` 与
  `positional_args`，共 210 行）及其 5 个单测。
- `crates/cua-driver/Cargo.toml`：`ureq` 依赖**保留**——`skills.rs`（下载 skill 包）与 `version_check.rs`
  （读 GitHub Releases 判断新版本）仍在用；只是不再有任何遥测用途。注释已同步更新。

验证方式：对编译产物 `cua-driver.exe` 抓字符串，应搜不到 `posthog`、`phc_eSkLnbLx`（API key）
与 `eu.i.posthog.com`（剥离前三者都在）。可复现命令：

```powershell
node -e "const b=require('fs').readFileSync('packages/desktop/bundled-tools/win32-x64/cua-driver/cua-driver.exe');const s=b.toString('latin1');console.log('posthog:',/posthog/i.test(s),'apikey:',s.includes('phc_eSkLnbLx'))"
```

（产物里仍能搜到 `.telemetry_id` 这类文件名——那是 `reset-id` 的**擦除目标**，不是上报残留。）

## 相对上游的完整改动清单（供复核）

复制基线 487 个文件全部保留，无删除。ZCode 侧共 8 改 5 增：

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| 改 | `crates/cua-driver/src/telemetry.rs` | 整体重写为惰性实现（唯一有语义改动的剥离点） |
| 改 | `crates/cua-driver/src/version_check.rs` | `is_enabled()` 默认翻转成关闭（仅显式 `CUA_DRIVER_RS_UPDATE_CHECK=1` 才联网）+ 相关文档与 4 个单测（新增 3 个、改写 1 个） |
| 改 | `crates/cua-driver/src/main.rs` | 删 `maybe_wrap_finite_command()` + 2 处调用；`telemetry` 子命令文案改为事实描述 |
| 改 | `crates/cua-driver/src/cli.rs` | 删 11 个 `finite_*` 遥测分类器（210 行）+ 5 个单测；3 处"默认开启遥测"文档改为"本构建永不上报" |
| 改 | `crates/cua-driver/Cargo.toml` | `ureq` 注释改为"仅 skills/version_check 使用"（依赖保留） |
| 改 | `Cargo.toml` | 新增 `exclude` 与 `[patch.crates-io]`（Spectre 补丁） |
| 改 | `Cargo.lock` | 上述 patch 导致的锁文件变化 |
| 改 | `README.md`、`.gitignore` | 本文件；vendored `.gitignore` 补 `/target/`（上游该文件为空） |
| 增 | `LICENSE` | 上游 MIT 全文 |
| 增 | `UPSTREAM-README.md`、`UPSTREAM-REVISION` | 上游 README 原件与 revision 记录 |
| 增 | `vendor/msvc-spectre-libs/`（2 文件） | Windows 构建环境补丁 crate |

复现这份清单：把本目录与上游 checkout 逐文件 sha256 对比即可（`target/` 与 `.git/` 除外）。

### 出站网络调用（版本检查已默认关闭）

上游 `crates/cua-driver/src/version_check.rs` 的 `maybe_announce_update()` 会在 `mcp` / `serve` / `doctor`
这三个常驻入口自动读 `https://api.github.com/repos/trycua/cua/releases?per_page=40` 做版本比较，
上游默认**开启**、只提供 opt-out。YCode 侧已把默认值翻转为**关闭**：

- `is_enabled()` 现在要求 `CUA_DRIVER_RS_UPDATE_CHECK` 显式取真值（`1|true|yes|on`）；未设置、空值、
  无法识别的取值与 falsy 值（`0|false|no|off`）全部按关闭处理。因此**默认启动不会再访问 GitHub**。
- 环境变量与 `~/.cua-driver/config.json` 的 `update_check_enabled` 读取逻辑都保留：显式
  `CUA_DRIVER_RS_UPDATE_CHECK=1` 仍可临时打开，config 里的 `update_check_enabled=false` 仍可一票否决。
- 预发布版本自动跳过（上游原有行为，未改）。
- 单元测试同步调整：新增「未设置/无法识别 → 关闭」「显式真值 → 打开」「config=false 能否决显式打开」，
  原「无 config + 无 opt-out → 开启」的断言按新默认反转。

仍然存在的出站读取只有**显式命令/显式工具调用**触发的两类，属于功能性读取，不带安装 ID、不回传用户数据：

| 触发点 | 行为 |
| --- | --- |
| `cua-driver check-update`（CLI 子命令） | 读 GitHub Releases 列表比较版本；不经 `is_enabled()`，因为它本身就是「用户要求检查」 |
| `check_for_update`（MCP 工具） | 同上，由调用方（agent）显式调用 |
| `cua-driver skills install\|update` | 从 GitHub Releases / raw.githubusercontent 下载 skill 包；`skills status\|path\|uninstall` 不联网 |

`skills` 的下载路径已确认只在显式子命令里触发：`skills::run()` 只对 `install`/`update` 调用
`fetch_into()`，其它子命令走本地状态查询，没有任何启动期调用点。

## 如何同步上游

1. 在上游 checkout 里取目标 revision：`git -C <cua> rev-parse HEAD`，确认 `libs/cua-driver/rust/VERSION`。
2. 用 `robocopy /E`（或 `rsync -a --delete`）覆盖本目录的**上游部分**，注意保留 ZCode 侧文件：
   `LICENSE`、`UPSTREAM-REVISION`、`README.md`、`UPSTREAM-README.md`、`vendor/` 与本节改动。
3. 重做剥离：以新版 `crates/cua-driver/src/telemetry.rs` 为准，把新增/改名的 `capture_*` 等入口以空实现
   补进本目录的 `telemetry.rs`（编译器的 `cargo check -p cua-driver` 会列出所有缺失入口）。
4. 复查 `main.rs`/`cli.rs` 是否又出现"只为遥测存在"的调用面（`maybe_wrap_finite_command`、`finite_*`、
   `telemetry::` 新增调用点），按同样方式删除。
5. 更新 `UPSTREAM-REVISION` 与本文件顶部版本表，重跑 `pnpm build:cua-driver` 与 `--check`，
   再抓一次产物字符串确认无 PostHog 残留。

## 已知缺口：两个集成测试缺上游 fixture

`cargo build --release --bin cua-driver` 不受影响，但 `cargo check -p cua-driver --all-targets`
会报 3 处"找不到路径"：`crates/cua-driver/tests/` 里的 `../../../../compat-fixtures/{cli.json,mcp.json}`
与 `../../../../tests/fixtures/shared/web/index.html`。这两个路径指向上游 `libs/cua-driver/` 下
**`rust/` 之外**的资源（`compat-fixtures/`、`tests/fixtures/`），而本次只 vendor 了 `rust/`。

受影响的两个测试：`compatibility_contract_test`、`standalone_browser_behavior_test`。修法三选一：
把上游 `libs/cua-driver/{compat-fixtures,tests/fixtures}` 也 vendor 到本仓库（但 4 层 `..` 会落到
`third-party/`，要么改测试里的相对路径、要么把目录放到 `third-party/` 下）；或给这两个测试加
`#[ignore]` 并在 README 记录；或本仓库不跑这两个测试。Wave 2 决定。

其余测试目标可正常编译；集成测试里大量出现的 `CUA_DRIVER_RS_TELEMETRY_ENABLED=false` 只是给上游
子进程设环境变量，剥离后该变量已无意义但也无害，未改动。

## 许可与声明登记

已做：`LICENSE` = 上游 MIT 全文（版权归 Cua AI, Inc.），随 vendor 源码入库；构建脚本会把它复制到
`bundled-tools/<platformKey>/cua-driver/LICENSE`，随二进制一起分发。

仓库惯例是"改数据源 → 重新生成"，而不是手写生成物（`node scripts/licenses.mjs notices`）。
本目录已按该惯例登记：

- 数据源：`third-party/copied-components.json` 新增 `cua-driver (trycua/cua)` 条目
  （MIT / revision `27a318c3a616f9ff19d24fe2acca7517c5f8fa7b` / 19 条 roots，覆盖本目录除
  gitignore 的 `target/` 之外的全部文件）。
- 许可快照：`third-party/upstream/c0779290c1d4783169aa3dbfb55feb505e563ef8a004bbf55298ceffcfbda8d9.txt`
  = 上游 `LICENSE.md` 在该 revision 的逐字节内容（1069 字节，已用 `raw.githubusercontent.com`
  下载核对）；本目录的 `LICENSE` 只有换行差异（Windows CRLF），把 CRLF 归一成 LF 后两者 sha256 相同。
- 生成物 `THIRD-PARTY-NOTICES.md` 与 `third-party/inventory.json` **尚未重生成**：`licenses.mjs notices`
  需要 `pnpm -r ls --prod --json --depth Infinity`，而本机 pnpm（10.33.2，hoisted 布局）在递归列举
  node_modules 时稳定报 `EMFILE: too many open files`，属环境限制。请在有可用 pnpm 的机器上执行：

  ```powershell
  node scripts/licenses.mjs notices   # 重新生成声明与 inventory（含本目录 492 个文件的 sha256）
  node scripts/licenses.mjs check     # 通过后即可（新增的 input 哈希会随之刷新）
  ```

  在该命令跑通之前，`licenses.mjs check` 与 SEA 上传路径（`scripts/third-party-notices.mjs` 的
  `readVerifiedNotices`）会报 `Third-party input changed: third-party/copied-components.json`——
  这是"改了数据源还没重生成"的预期提示，不是新增条目本身有错。

仍待补齐（未完成项）：

1. **传递依赖**：产出的 `cua-driver.exe` 静态链接了 `Cargo.lock` 里数百个 crate
   （rustls/ring、windows、tokio、regorus…）。这些许可文本目前没有进 notices 流程。native-search 的做法是
   另建 `third-party/native-search/sources.json` 记录归档与许可快照；Rust crate 同理需要一份
   `cua-driver` 的 sources 清单并接入生成脚本。新条目的 `scope` 字段已显式声明这一缺口。
2. 上述缺口补齐前，发行仍存在**只登记了 vendored 源码 MIT、未登记静态链接依赖许可**的材料缺口；
   `licenses.mjs check --strict` 的 `reviewRequired` 不会因此项报错（它只覆盖已登记条目的缺口），
   所以这里靠文档记录而非门禁兜底。

