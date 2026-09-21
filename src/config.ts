import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface StarfieldSettings {
  enabled: boolean;
  /** 候选密度分母，5 表示约 1/5 的空白格成为候选星点。 */
  density: number;
  /** 速度倍率，1 是 Codex 的原始速度。 */
  speed: number;
  /** 峰值亮度，范围 0~1。 */
  peakBrightness: number;
  /** true 时输入框有内容后隐藏星场。 */
  onlyWhenEmpty: boolean;
}

export const DEFAULT_SETTINGS: StarfieldSettings = {
  enabled: true,
  density: 5,
  speed: 1,
  peakBrightness: 0.55,
  onlyWhenEmpty: false,
};

const MIN_DENSITY = 1;
const MAX_DENSITY = 20;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const MIN_PEAK_BRIGHTNESS = 0.05;
const MAX_PEAK_BRIGHTNESS = 1;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (!finiteNumber(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 规范化用户配置；未知字段忽略，非法字段回退到默认值。 */
export function normalizeSettings(input: unknown): StarfieldSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_SETTINGS };
  const raw = input as Record<string, unknown>;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
    density: Math.round(boundedNumber(raw.density, DEFAULT_SETTINGS.density, MIN_DENSITY, MAX_DENSITY)),
    speed: boundedNumber(raw.speed, DEFAULT_SETTINGS.speed, MIN_SPEED, MAX_SPEED),
    peakBrightness: boundedNumber(
      raw.peakBrightness,
      DEFAULT_SETTINGS.peakBrightness,
      MIN_PEAK_BRIGHTNESS,
      MAX_PEAK_BRIGHTNESS,
    ),
    onlyWhenEmpty: typeof raw.onlyWhenEmpty === "boolean" ? raw.onlyWhenEmpty : DEFAULT_SETTINGS.onlyWhenEmpty,
  };
}

export function getSettingsPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return process.env.PI_SPARKLE_CONFIG ?? join(agentDir, "extensions", "pi-sparkle.json");
}

export function loadSettings(): StarfieldSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(getSettingsPath(), "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: StarfieldSettings): void {
  const path = getSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, "utf8");
}
