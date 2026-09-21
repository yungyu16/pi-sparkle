/**
 * 星场渲染内核：把「一行带 ANSI 的文本 + 当前时间」变成「一行带星点的文本」。
 *
 * 这一层是纯函数，不依赖 TUI 实例，便于单独验证宽字符对齐、样式跳过与闪烁曲线。
 * 移植自 codex 的 Astra Sparkle（codex-rs/tui/src/bottom_pane/chat_composer/sparkle_field.rs），
 * 差异在于 codex 操作 ratatui 的逐格 Buffer，这里操作的是行字符串。
 */

import { visibleWidth, type RgbColor } from "@earendil-works/pi-tui";

/** 盲文单点：一个字符格内 8 个亚格位置，比整字符更细，适合当星点。 */
export const DOTS = ["⠁", "⠂", "⠄", "⠈", "⠐", "⠠", "⡀", "⢀"];

/** Codex 的原始闪烁策略：4~7 秒一个周期，阈值 0.04，sin^12 脉冲。 */
const MIN_PERIOD_S = 4;
const MIN_BRIGHTNESS = 0.04;
const PULSE_EXPONENT = 12;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface StarfieldConfig {
  background: RgbColor;
  foreground: RgbColor;
  density: number;
  speed: number;
  peakBrightness: number;
}

interface AnsiToken {
  ansi: boolean;
  text: string;
}

/**
 * 从 start 处识别一个 ANSI / OSC / APC 转义序列，返回序列文本与长度。
 * 不是转义序列时返回 undefined。
 */
function scanAnsi(text: string, start: number): { seq: string; length: number } | undefined {
  if (text.charCodeAt(start) !== 0x1b) return undefined;
  const introducer = text[start + 1];

  if (introducer === "[") {
    // CSI：参数字节 0x30-0x3F，中间字节 0x20-0x2F，结束字节 0x40-0x7E
    let i = start + 2;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code >= 0x30 && code <= 0x3f) i++;
      else break;
    }
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code >= 0x20 && code <= 0x2f) i++;
      else break;
    }
    if (i < text.length) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) i++;
    }
    return { seq: text.slice(start, i), length: i - start };
  }

  // OSC("]") / DCS("P") / APC("_") / PM("^")：到 BEL 或 ST(ESC \) 结束
  if (introducer === "]" || introducer === "P" || introducer === "_" || introducer === "^") {
    let i = start + 2;
    while (i < text.length) {
      if (text[i] === "\x07") {
        i++;
        break;
      }
      if (text[i] === "\x1b" && text[i + 1] === "\\") {
        i += 2;
        break;
      }
      i++;
    }
    return { seq: text.slice(start, i), length: i - start };
  }

  if (introducer !== undefined) {
    // 两字符转义序列，例如 ESC ( B
    return { seq: text.slice(start, start + 2), length: 2 };
  }
  return undefined;
}

/** 把一行拆成「ANSI 序列」与「普通文本」两类 token，普通文本段的列宽需要另行累加。 */
function tokenizeAnsi(line: string): AnsiToken[] {
  const tokens: AnsiToken[] = [];
  let plainStart = 0;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      const ansi = scanAnsi(line, i);
      if (ansi) {
        if (i > plainStart) tokens.push({ ansi: false, text: line.slice(plainStart, i) });
        tokens.push({ ansi: true, text: ansi.seq });
        i += ansi.length;
        plainStart = i;
        continue;
      }
    }
    i++;
  }
  if (i > plainStart) tokens.push({ ansi: false, text: line.slice(plainStart, i) });
  return tokens;
}

/**
 * 跟踪 SGR 状态，只关心「这个空白格还能不能画星点」。
 * 有背景色或反显的格子底色可见，插星点会破坏原样式，因此跳过。
 */
class SgrState {
  private hasBackground = false;
  private inverse = false;

  get blocksStarfield(): boolean {
    return this.hasBackground || this.inverse;
  }

  apply(sequence: string): void {
    if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return;
    const body = sequence.slice(2, -1);
    const codes = body === "" ? [0] : body.split(";").map((part) => (part === "" ? 0 : Number.parseInt(part, 10)));

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === undefined || Number.isNaN(code)) continue;

      if (code === 38 || code === 48) {
        // 扩展颜色 38;5;n / 38;2;r;g;b（48 同理），必须跳过后续参数，否则 r/g/b 会被误判成颜色码
        const mode = codes[i + 1];
        if (mode === 5) {
          if (code === 48) this.hasBackground = true;
          i += 2;
        } else if (mode === 2) {
          if (code === 48) this.hasBackground = true;
          i += 4;
        }
        continue;
      }

      if (code === 0) {
        this.hasBackground = false;
        this.inverse = false;
      } else if (code === 7) {
        this.inverse = true;
      } else if (code === 27) {
        this.inverse = false;
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107) || code === 49) {
        this.hasBackground = code !== 49;
      }
    }
  }
}

/**
 * 坐标哈希：同一格每帧算出同一个值，所以星星位置稳定、无需保存状态。
 * 采用 codex 同款的 xor-shift + 乘法混淆，这里用 32 位整数实现。
 */
export function starHash(column: number, row: number): number {
  let hash = (row * 65537 + column) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** 按亮度在前景色与背景色之间线性插值：alpha=0 等于背景色（隐形），alpha=1 等于前景色。 */
export function blend(foreground: RgbColor, background: RgbColor, alpha: number): RgbColor {
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
}

/**
 * 计算某个空白格在当前时刻的星点，返回带真彩色的盲文点；此刻不可见时返回 undefined。
 */
export function starAt(column: number, row: number, time: number, config: StarfieldConfig): string | undefined {
  const hash = starHash(column, row);
  if (hash % config.density !== 0) return undefined;

  const period = (MIN_PERIOD_S + (hash % 31) / 10) / config.speed;
  const phase = (time / period + (hash % 997) / 997) % 1;
  const brightness = Math.sin(phase * Math.PI) ** PULSE_EXPONENT * config.peakBrightness;
  if (brightness < MIN_BRIGHTNESS) return undefined;

  const color = blend(config.foreground, config.background, brightness);
  const dot = DOTS[Math.floor(hash / 161) % DOTS.length];
  return `\x1b[38;2;${color.r};${color.g};${color.b}m${dot}\x1b[39m`;
}

/**
 * 把一行里符合条件的空白格替换成星点。
 * 星点宽度为 1，正好替换一个空格，因此行的可视宽度不变。
 */
export function decorateLine(line: string, row: number, time: number, config: StarfieldConfig): string {
  let out = "";
  let column = 0;
  const sgr = new SgrState();

  for (const token of tokenizeAnsi(line)) {
    if (token.ansi) {
      out += token.text;
      sgr.apply(token.text);
      continue;
    }
    for (const { segment } of graphemeSegmenter.segment(token.text)) {
      if (segment === " " && !sgr.blocksStarfield) {
        out += starAt(column, row, time, config) ?? segment;
      } else {
        out += segment;
      }
      column += visibleWidth(segment);
    }
  }
  return out;
}

/** 感知亮度，用来决定星点该偏亮还是偏暗。 */
export function relativeLuminance(color: RgbColor): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

/** 深色背景用浅色星点，浅色背景用深色星点。 */
export function foregroundFor(background: RgbColor): RgbColor {
  return relativeLuminance(background) > 0.5 ? { r: 40, g: 40, b: 40 } : { r: 220, g: 220, b: 220 };
}
