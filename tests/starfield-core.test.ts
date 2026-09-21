import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { DOTS, decorateLine, foregroundFor, starAt, starHash, type StarfieldConfig } from "../src/starfield-core.ts";

const DARK: StarfieldConfig = {
  background: { r: 30, g: 30, b: 30 },
  foreground: foregroundFor({ r: 30, g: 30, b: 30 }),
  density: 5,
  speed: 1,
  peakBrightness: 0.55,
};

const TIMES = [0, 0.7, 1.9, 3.3, 5.1, 7.7, 11.2, 19.4];
const hasStar = (line: string): boolean => line.includes("\x1b[38;2;");

test("行宽保持不变，兼容 CJK、ANSI 和反显", () => {
  const lines = [
    " ".repeat(80),
    "   " + "中文占两列 ".repeat(6),
    "\x1b[7m \x1b[0m" + " ".repeat(50),
    "\x1b[38;2;100;50;60m" + " ".repeat(40) + "\x1b[39m",
  ];

  for (const line of lines) {
    for (const time of TIMES) {
      const output = decorateLine(line, 3, time, DARK);
      assert.equal(visibleWidth(output), visibleWidth(line));
    }
  }
});

test("空白行会出现星点，但不会占满整行", () => {
  const line = " ".repeat(400);
  let maxStars = 0;

  for (let time = 0; time < 8; time += 0.05) {
    const count = decorateLine(line, 0, time, DARK).split("\x1b[38;2;").length - 1;
    maxStars = Math.max(maxStars, count);
  }

  assert.ok(maxStars > 0);
  assert.ok(maxStars < line.length / 2);
});

test("反显区域不被替换", () => {
  const line = "\x1b[7m \x1b[0m" + " ".repeat(40);

  for (const time of TIMES) {
    const output = decorateLine(line, 0, time, DARK);
    assert.ok(output.startsWith("\x1b[7m \x1b[0m"));
  }
});

test("背景色区域不被替换", () => {
  const background = " ".repeat(20);
  const foreground = " ".repeat(20);
  const line = `\x1b[48;2;100;50;60m${background}\x1b[49m${foreground}`;

  for (const time of TIMES) {
    const output = decorateLine(line, 0, time, DARK);
    assert.ok(output.startsWith(`\x1b[48;2;100;50;60m${background}\x1b[49m`));
  }
});

test("前景色 RGB 参数不会被误判为背景色", () => {
  const line = `\x1b[38;2;100;50;60m${" ".repeat(60)}\x1b[39m`;
  let seen = false;

  for (const time of TIMES) {
    if (hasStar(decorateLine(line, 0, time, DARK))) seen = true;
  }

  assert.equal(seen, true);
});

test("非空格字符保持原样", () => {
  const line = "hello world 你好";

  for (const time of TIMES) {
    const output = decorateLine(line, 0, time, DARK);
    assert.match(output, /hello world/);
    assert.match(output, /你好/);
  }
});

test("单颗星会独立闪烁，而不是常亮", () => {
  let column = -1;

  for (let candidate = 0; candidate < 200 && column === -1; candidate++) {
    for (let time = 0; time < 8; time += 0.02) {
      if (starAt(candidate, 0, time, DARK)) {
        column = candidate;
        break;
      }
    }
  }

  assert.ok(column >= 0);

  let visible = 0;
  let hidden = 0;
  for (let time = 0; time < 8; time += 0.02) {
    if (starAt(column, 0, time, DARK)) visible++;
    else hidden++;
  }

  assert.ok(visible > 0);
  assert.ok(hidden > visible);
});

test("相同输入得到相同输出", () => {
  const line = " ".repeat(60);

  for (const time of TIMES) {
    assert.equal(decorateLine(line, 2, time, DARK), decorateLine(line, 2, time, DARK));
  }
});

test("星点使用宽度为 1 的盲文字符", () => {
  const line = " ".repeat(120);
  let found = 0;

  for (let time = 0; time < 8; time += 0.05) {
    const output = decorateLine(line, 0, time, DARK);
    for (const dot of DOTS) {
      if (output.includes(dot)) {
        assert.equal(visibleWidth(dot), 1);
        found++;
      }
    }
  }

  assert.ok(found > 0);
});

test("浅色背景自动使用深色星点", () => {
  assert.ok(foregroundFor({ r: 250, g: 250, b: 250 }).r < 128);
  assert.ok(foregroundFor({ r: 16, g: 16, b: 16 }).r > 128);
});

test("候选星点哈希保持稳定", () => {
  for (let column = 0; column < 100; column++) {
    assert.equal(starHash(column, 1), starHash(column, 1));
  }
});
