/**
 * pi 输入框星场：在编辑器空白处绘制缓慢闪烁的星点。
 *
 * 渲染内核在 ./starfield-core.ts，这里负责配置、命令、组件生命周期和扩展注册。
 * 星点只替换空白格，正文内容不受影响，所以默认输入时也保留星场。
 * 移植自 Codex 的 Astra Sparkle（codex-rs/tui/src/bottom_pane/chat_composer/sparkle_field.rs）。
 *
 * 配置文件：~/.pi/agent/extensions/pi-sparkle.json
 * 命令：/starfield on|off|status|reset|set <key> <value>
 * 环境变量 PI_STARFIELD=0 可直接关闭扩展。
 */

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, getCapabilities, type RgbColor, type TUI } from "@earendil-works/pi-tui";
import {
  DEFAULT_SETTINGS,
  getSettingsPath,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type StarfieldSettings,
} from "./config.ts";
import { decorateLine, foregroundFor } from "./starfield-core.ts";

/** Codex 使用 150ms 帧间隔，约 6.7 FPS。 */
const FRAME_TICK_MS = 150;

/** 查询终端背景色的超时时间。 */
const BG_QUERY_TIMEOUT_MS = 500;

/** 查不到终端背景色时的兜底值（深色主题）。 */
const FALLBACK_BG: RgbColor = { r: 30, g: 30, b: 30 };

/** 保留改名前的注册标识，确保 `/reload` 后仍能停止旧版本实例的定时器。 */
const ACTIVE_EDITOR = Symbol.for("pi.starry-editor.active-editor");

type ManagedEditor = {
  stop(): void;
  applySettings(settings: StarfieldSettings): void;
};

function activeEditorRegistry(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

function activeEditor(): ManagedEditor | undefined {
  const value = activeEditorRegistry()[ACTIVE_EDITOR];
  return value && typeof value === "object" ? (value as ManagedEditor) : undefined;
}

function formatSettings(settings: StarfieldSettings): string {
  return [
    `enabled=${settings.enabled}`,
    `density=${settings.density}`,
    `speed=${settings.speed}`,
    `peakBrightness=${settings.peakBrightness}`,
    `onlyWhenEmpty=${settings.onlyWhenEmpty}`,
  ].join(" ");
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true" || value === "on" || value === "1") return true;
  if (value === "false" || value === "off" || value === "0") return false;
  return undefined;
}

function updateFromCommand(current: StarfieldSettings, args: string): { settings?: StarfieldSettings; message: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase();

  if (!action || action === "status") {
    return {
      message: `${formatSettings(current)}\nconfig=${getSettingsPath()}`,
    };
  }

  if (action === "on" || action === "off") {
    return {
      settings: { ...current, enabled: action === "on" },
      message: `starfield ${action}`,
    };
  }

  if (action === "reset") {
    return {
      settings: { ...DEFAULT_SETTINGS },
      message: `已恢复默认配置：${formatSettings(DEFAULT_SETTINGS)}`,
    };
  }

  if (action !== "set" || tokens.length < 3) {
    return {
      message: "用法：/starfield on|off|status|reset|set <enabled|density|speed|peakBrightness|onlyWhenEmpty> <value>",
    };
  }

  const key = tokens[1];
  const value = tokens[2];
  const next: Record<string, unknown> = { ...current };

  if (key === "enabled" || key === "onlyWhenEmpty") {
    const parsed = parseBoolean(value);
    if (parsed === undefined) {
      return { message: `${key} 需要 true/false、on/off 或 1/0` };
    }
    next[key] = parsed;
  } else if (key === "density" || key === "speed" || key === "peakBrightness") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { message: `${key} 需要数字` };
    next[key] = parsed;
  } else {
    return { message: `未知配置项：${key}` };
  }

  const settings = normalizeSettings(next);
  return {
    settings,
    message: `已更新：${formatSettings(settings)}`,
  };
}

class StarfieldEditor extends CustomEditor implements ManagedEditor {
  private readonly ui: TUI;
  private readonly startedAt = performance.now();
  private background: RgbColor = FALLBACK_BG;
  private timer: ReturnType<typeof setInterval> | undefined;
  private settings: StarfieldSettings;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, settings: StarfieldSettings) {
    super(tui, theme, keybindings);
    this.ui = tui;
    this.settings = settings;
  }

  /** 亮度渐变依赖 24 位色；不支持真彩色时不启动动画。 */
  private get supported(): boolean {
    return getCapabilities().trueColor;
  }

  /** 配置变化后立即切换动画状态并请求重绘。 */
  applySettings(settings: StarfieldSettings): void {
    this.settings = settings;
    this.stop();
    this.start();
    this.ui.requestRender();
  }

  /** 异步查询终端背景色，让星点颜色贴合实际底色；失败则沿用兜底色。 */
  async resolveBackground(): Promise<void> {
    try {
      const background = await this.ui.queryTerminalBackgroundColor({ timeoutMs: BG_QUERY_TIMEOUT_MS });
      if (background) {
        this.background = background;
        this.ui.requestRender();
      }
    } catch {
      // 查询失败不影响功能
    }
  }

  start(): void {
    if (!this.settings.enabled || !this.supported || this.timer) return;
    this.timer = setInterval(() => this.ui.requestRender(), FRAME_TICK_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (!this.settings.enabled || !this.supported || !this.focused) return lines;
    if (this.settings.onlyWhenEmpty && this.getText().length > 0) return lines;

    const time = (performance.now() - this.startedAt) / 1000;
    const background = this.background;
    const config = {
      background,
      foreground: foregroundFor(background),
      density: this.settings.density,
      speed: this.settings.speed,
      peakBrightness: this.settings.peakBrightness,
    };
    return lines.map((line, row) => decorateLine(line, row, time, config));
  }
}

export default function starfield(pi: ExtensionAPI): void {
  if (process.env.PI_STARFIELD === "0") return;

  let settings = loadSettings();

  pi.registerCommand("starfield", {
    description: "Configure the animated editor starfield",
    handler: async (args, ctx) => {
      const result = updateFromCommand(settings, args);
      if (!result.settings) {
        ctx.ui.notify(result.message, "info");
        return;
      }

      try {
        settings = result.settings;
        saveSettings(settings);
        activeEditor()?.applySettings(settings);
        ctx.ui.notify(result.message, "info");
      } catch (error) {
        ctx.ui.notify(`保存星场配置失败：${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const registry = activeEditorRegistry();
      const previous = activeEditor();
      previous?.stop();
      registry[ACTIVE_EDITOR] = undefined;

      const editor = new StarfieldEditor(tui, theme, keybindings, settings);
      registry[ACTIVE_EDITOR] = editor;
      void editor.resolveBackground();
      editor.start();
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    activeEditor()?.stop();
    activeEditorRegistry()[ACTIVE_EDITOR] = undefined;
  });
}
