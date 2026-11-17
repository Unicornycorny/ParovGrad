import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../module/actors/actor-resources.js", import.meta.url), "utf8");
const { createActorResourceSchema, getActorResourceViews, normalizeActorResources } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

globalThis.foundry = {
  data: {
    fields: {
      NumberField: class { constructor(options) { this.options = options; } },
      SchemaField: class { constructor(fields) { this.fields = fields; } }
    }
  },
  utils: {
    setProperty(object, path, value) {
      const keys = path.split(".");
      const leaf = keys.pop();
      for (const key of keys) object = object[key] ??= {};
      object[leaf] = value;
    }
  }
};

test("resources have independent manually editable signed integer bounds and defaults", () => {
  const mana = createActorResourceSchema();
  const combatPoints = createActorResourceSchema();
  assert.notEqual(mana, combatPoints);
  for (const [field, initial] of [["min", 0], ["max", 10], ["value", 10]]) {
    assert.notEqual(mana.fields[field], combatPoints.fields[field]);
    assert.deepEqual(mana.fields[field].options, { required: true, integer: true, initial });
  }
  assert.deepEqual(getActorResourceViews({}), [
    { key: "mana", label: "Мана", value: 10, min: 0, max: 10, percent: 100 },
    { key: "combatPoints", label: "Боевые очки", value: 10, min: 0, max: 10, percent: 100 }
  ]);
});

test("each bar scales from its own minimum and keeps its resource independent", () => {
  const system = {
    mana: { value: 15, min: 10, max: 30 },
    combatPoints: { value: -5, min: -10, max: 0 }
  };
  assert.deepEqual(getActorResourceViews(system).map(({ value, min, max, percent }) => ({ value, min, max, percent })), [
    { value: 15, min: 10, max: 30, percent: 25 },
    { value: -5, min: -10, max: 0, percent: 50 }
  ]);
  const original = structuredClone(system);
  const patch = { name: "Персонаж" };
  normalizeActorResources({ system }, patch);
  assert.deepEqual(patch, { name: "Персонаж", system });
  assert.deepEqual(system, original);
});

test("raising a minimum and lowering a maximum clamp only the affected resource", () => {
  const source = { system: {
    mana: { value: 3, min: 5, max: 20 },
    combatPoints: { value: 12, min: 0, max: 8 },
    health: { value: 17, max: 20 }
  } };
  normalizeActorResources(source);
  assert.deepEqual(source.system, {
    mana: { value: 5, min: 5, max: 20 },
    combatPoints: { value: 8, min: 0, max: 8 },
    health: { value: 17, max: 20 }
  });
});

test("inverted and zero-width ranges are finite and preserve the manual minimum", () => {
  const source = { system: {
    mana: { value: 20, min: 8, max: 2 },
    combatPoints: { value: -3, min: 0, max: 0 }
  } };
  normalizeActorResources(source);
  assert.deepEqual(source.system.mana, { value: 8, min: 8, max: 8 });
  assert.deepEqual(source.system.combatPoints, { value: 0, min: 0, max: 0 });
  for (const view of getActorResourceViews(source.system)) assert.equal(view.percent, 0);
});

test("partial and invalid imported data gets finite integer values without adding absent resources", () => {
  const source = { system: { mana: { value: Infinity, min: "-4.9", max: "15.8" } } };
  normalizeActorResources(source);
  assert.deepEqual(source.system, { mana: { value: 10, min: -4, max: 15 } });
  const patch = {};
  normalizeActorResources({ system: { combatPoints: { value: NaN, min: null, max: "" } } }, patch);
  assert.deepEqual(patch, { system: { combatPoints: { value: 10, min: 0, max: 10 } } });
  normalizeActorResources({}, patch);
  assert.deepEqual(patch, { system: { combatPoints: { value: 10, min: 0, max: 10 } } });
});
