import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, normalizeSettings } from "../src/config.ts";

test("默认配置对齐 Codex，并保留输入时星场", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    enabled: true,
    density: 5,
    speed: 1,
    peakBrightness: 0.55,
    onlyWhenEmpty: false,
  });
});

test("配置只接受有限范围内的值", () => {
  assert.deepEqual(
    normalizeSettings({
      enabled: false,
      density: 0,
      speed: 99,
      peakBrightness: -1,
      onlyWhenEmpty: true,
      unknown: "ignored",
    }),
    {
      enabled: false,
      density: 1,
      speed: 4,
      peakBrightness: 0.05,
      onlyWhenEmpty: true,
    },
  );
});

test("非法配置字段回退默认值", () => {
  assert.deepEqual(normalizeSettings({ density: "dense", speed: NaN, onlyWhenEmpty: "yes" }), DEFAULT_SETTINGS);
});
