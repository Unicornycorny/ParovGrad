import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importModule } from "./helpers/import-module.mjs";

const {
  gaugeSpringKeyframes, gaugeMotionDuration, captureGaugeReadings, animateGaugeNeedles
} = await importModule(new URL("../module/apps/sheets/gauge-motion.js", import.meta.url));

const values = (frames) => frames.map((frame) => Number(frame["--pg-gauge-fill"]));

test("spring curve starts at the old reading, overshoots once and settles exactly on the new one", () => {
  const frames = gaugeSpringKeyframes(20, 60);
  const fill = values(frames);
  assert.equal(fill[0], 20);
  assert.equal(fill.at(-1), 60);
  assert.equal(frames[0].offset, 0);
  assert.equal(frames.at(-1).offset, 1);
  const peak = Math.max(...fill);
  assert.ok(peak > 60 && peak < 60 + 40 * 0.2, `overshoot ${peak}`);
  // After the overshoot the needle swings back below the target once (barometer settle).
  const afterPeak = fill.slice(fill.indexOf(peak));
  assert.ok(Math.min(...afterPeak) < 60);
});

test("falling pressure mirrors the curve and the needle never passes the scale stops", () => {
  const fill = values(gaugeSpringKeyframes(80, 10));
  assert.ok(Math.min(...fill) < 10);
  const full = values(gaugeSpringKeyframes(0, 100));
  const empty = values(gaugeSpringKeyframes(100, 0));
  assert.ok(Math.max(...full) <= 103);
  assert.ok(Math.min(...empty) >= -3);
});

test("longer travel takes longer, within 0.65–1.6 s", () => {
  assert.equal(gaugeMotionDuration(50, 50), 650);
  assert.ok(gaugeMotionDuration(0, 30) < gaugeMotionDuration(0, 90));
  assert.equal(gaugeMotionDuration(0, 100), 1550);
  assert.ok(gaugeMotionDuration(-100, 100) <= 1600);
});

function fakeGauge(key, fill, displayed = fill) {
  const calls = [];
  return {
    dataset: { gaugeKey: key },
    style: { getPropertyValue: () => ` ${fill}` },
    displayed,
    calls,
    animate(keyframes, options) { calls.push({ keyframes, options }); }
  };
}
function fakeRoot(gauges, { reduce = false } = {}) {
  return {
    querySelectorAll: () => gauges,
    ownerDocument: { defaultView: {
      getComputedStyle: (gauge) => ({ getPropertyValue: () => String(gauge.displayed) }),
      matchMedia: () => ({ matches: reduce })
    } }
  };
}

test("first render only remembers readings; a changed value animates from where the needle stood", () => {
  const memory = new Map();
  const first = fakeGauge("health", 70);
  animateGaugeNeedles(fakeRoot([first]), memory);
  assert.equal(first.calls.length, 0);
  assert.equal(memory.get("health"), 70);

  // A previous animation was mid-flight at 64 when the sheet re-rendered.
  captureGaugeReadings(fakeRoot([fakeGauge("health", 70, 64)]), memory);
  const next = fakeGauge("health", 40);
  animateGaugeNeedles(fakeRoot([next]), memory);
  assert.equal(next.calls.length, 1);
  assert.equal(values(next.calls[0].keyframes)[0], 64);
  assert.equal(values(next.calls[0].keyframes).at(-1), 40);
  assert.equal(next.calls[0].options.easing, "linear");
  assert.equal(memory.get("health"), 40);

  const same = fakeGauge("health", 40);
  animateGaugeNeedles(fakeRoot([same]), memory);
  assert.equal(same.calls.length, 0);
});

test("reduced motion moves the needle without animation", () => {
  const memory = new Map([["mana", 10]]);
  const gauge = fakeGauge("mana", 90);
  animateGaugeNeedles(fakeRoot([gauge], { reduce: true }), memory);
  assert.equal(gauge.calls.length, 0);
  assert.equal(memory.get("mana"), 90);
});

test("actor sheets hook the needle motion into rendering and register the fill variable", async () => {
  const css = await readFile(new URL("../styles/theme/dossier.css", import.meta.url), "utf8");
  assert.match(css, /@property --pg-gauge-fill\s*\{[^}]*syntax: "<number>"/);
  for (const type of ["player", "npc"]) {
    const sheet = await readFile(new URL(`../module/apps/sheets/actor-${type}-sheet.js`, import.meta.url), "utf8");
    const template = await readFile(new URL(`../templates/sheet/actor-${type}.hbs`, import.meta.url), "utf8");
    assert.match(sheet, /captureGaugeReadings\(this\.element, this\._gaugeReadings\)/);
    assert.match(sheet, /animateGaugeNeedles\(this\.element, this\._gaugeReadings\)/);
    assert.match(template, /data-gauge-key="health"/);
    assert.match(template, /data-gauge-key="\{\{this\.key\}\}"/);
  }
});
