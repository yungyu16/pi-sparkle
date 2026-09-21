# pi-sparkle 维护指引

## 项目边界

- 这是一个 Pi coding agent extension package，不修改 Pi 核心包。
- 包入口是 `src/index.ts`，由 `package.json` 的 `pi.extensions` 声明。
- 运行时依赖 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`，两者保持在 `peerDependencies`，不要打包进扩展。
- 支持 Pi `0.86.0+`、Node.js `22.6+`。

## 代码结构

- `src/index.ts`：扩展入口、`/starfield` 命令、配置更新、`CustomEditor` 生命周期、timer 和真彩色门控。
- `src/config.ts`：配置文件路径、默认值、范围校验、读写。
- `src/starfield-core.ts`：纯渲染逻辑。输入 ANSI 行、相对坐标、时间和渲染配置，输出等宽的 ANSI 行。
- `tests/config.test.ts`：配置契约测试。
- `tests/starfield-core.test.ts`：ANSI、宽字符、光标反显、背景色、颜色混合和闪烁逻辑测试。

## 行为契约

- 星点只能替换空白 cell，不得覆盖输入文字、光标、宽字符或已有背景样式。
- 不得在 `handleInput` 中拦截或改写用户输入；动画只通过 `render()` 和 `tui.requestRender()` 驱动。
- `session_shutdown` 必须停止 timer；重新创建 editor 或 `/reload` 时也必须停止旧实例，避免 timer 泄漏。
- 不支持真彩色时不启动动画；`PI_TRUE_COLOR=1` 是用户显式覆盖入口。
- 配置键只维护以下五个：`enabled`、`density`、`speed`、`peakBrightness`、`onlyWhenEmpty`。新增配置前先同步 README、校验逻辑和测试。
- 默认闪烁因子必须保持 Codex 对齐：`density=5`、`speed=1`、周期 4~7 秒、峰值亮度 `0.55`、最小可见亮度 `0.04`、`sin^12`、150ms 帧间隔。用户可调参数只通过配置层覆盖允许项。
- 改变密度或速度策略时，必须更新配置测试和 README 的行为说明，不要在渲染函数里散落魔法数字。
- ANSI 行后处理必须保持 `visibleWidth` 不变；涉及 ANSI、OSC、APC、CJK 或组合字符时补回归测试。

## 配置与命令

默认配置路径：`~/.pi/agent/extensions/pi-sparkle.json`。

- `/starfield status`：显示当前配置和配置文件路径。
- `/starfield on` / `/starfield off`：持久化启停状态。
- `/starfield reset`：恢复默认配置。
- `/starfield set <key> <value>`：更新并立即应用单个配置项。

`PI_STARFIELD=0` 在扩展入口层禁用整个扩展；`PI_TRUE_COLOR=1` 强制通过真彩色探测。

## 验证命令

```bash
npm install
npm test
npm run typecheck
npm pack --dry-run
```

不要使用嵌套 pty 启动另一个 Pi 做常规验证；这类测试容易阻塞。优先使用纯函数测试、模块加载检查和 `npm pack --dry-run`。需要人工确认视觉效果时，在本机 Pi 会话中执行 `/reload`，再观察输入框。

## 文档和发布

- 使用者文档维护在 `README.md`。
- 发布前在 README 的预览占位处补充真实截图或 GIF，不要提交与实际实现不符的示意图。
- 修改包入口、peer dependency、版本或 `pi` manifest 后，必须重新执行 `npm pack --dry-run`。
- 每个独立需求使用一个 Conventional Commit；只提交本次任务路径，不混入用户或其他 Agent 的并行改动。
