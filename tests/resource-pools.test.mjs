import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const poolSource = await readFile(new URL("../module/actors/resource-pools.js", import.meta.url), "utf8");
const poolUrl = `data:text/javascript;base64,${Buffer.from(poolSource).toString("base64")}`;
const { createResourcePoolField, buildResourcePoolViews, isResourcePoolInRange,
  validateResourcePoolsJoint, activateResourcePoolInputValidation } = await import(poolUrl);

test("resource fields keep only current/max, without premature SchemaField joint validation", () => {
  class Field {
    constructor(...args) { this.args = args; this.options = args.at(-1); }
  }
  class SchemaField extends Field {}
  class NumberField extends Field {}
  globalThis.foundry = { data: { fields: { SchemaField, NumberField } } };

  const schema = createResourcePoolField();
  assert.ok(schema instanceof SchemaField);
  assert.deepEqual(Object.keys(schema.args[0]), ["value", "max"]);
  for (const field of Object.values(schema.args[0])) {
    assert.ok(field instanceof NumberField);
    assert.deepEqual(field.options, { required: true, integer: true, min: 0, initial: 0 });
  }
  assert.equal(schema.options.required, true);
  // A schema-level comparator misfires on Foundry V13 partial form updates.
  assert.equal(schema.options.validate, undefined);
});

test("neither negative, non-integer, nor above-maximum pool values are allowed", () => {
  for (const pool of [{ value: 0, max: 0 }, { value: 1, max: 1 }, { value: 3, max: 8 }]) {
    assert.equal(isResourcePoolInRange(pool), true);
  }
  for (const pool of [
    { value: -1, max: 3 }, { value: 4, max: 3 }, { value: 0, max: -1 },
    { value: 1.5, max: 2 }, { value: 1, max: 2.5 },
    { value: NaN, max: 2 }, { value: undefined, max: 4 }, { value: 1, max: undefined }
  ]) {
    assert.equal(isResourcePoolInRange(pool), false, JSON.stringify(pool));
  }
});

test("joint validation accepts valid full data and numeric form strings", () => {
  for (const pools of [
    { mana: { value: 0, max: 0 }, combatPoints: { value: 3, max: 8 } },
    { mana: { value: 7, max: 7 }, combatPoints: { value: 4, max: 10 } },
    { mana: { value: "7", max: "9" }, combatPoints: { value: "0", max: "0" } },
    { mana: { value: "7.0", max: "1e1" }, combatPoints: { value: 0, max: 0 } }
  ]) {
    assert.doesNotThrow(() => validateResourcePoolsJoint(pools));
  }
  // Checking only changed fields in an intermediate candidate must not
  // reject the *other* resource just because it wasn't submitted.
  assert.doesNotThrow(() => validateResourcePoolsJoint({ mana: { value: 5 } }));
  assert.doesNotThrow(() => validateResourcePoolsJoint({ combatPoints: { max: 6 } }));
  assert.doesNotThrow(() => validateResourcePoolsJoint({ level: 3 }));
});

test("joint validation rejects out-of-range or malformed complete resource values", () => {
  for (const key of ["mana", "combatPoints"]) {
    for (const pair of [
      { value: 5, max: 4 }, { value: -1, max: 4 }, { value: 0, max: -1 },
      { value: 1.5, max: 2 }, { value: 1, max: 1.5 },
      { value: "", max: "0" }, { value: "potato", max: "8" },
      { value: "2.5", max: "3" }, { value: "6", max: "5" }
    ]) {
      assert.throws(() => validateResourcePoolsJoint({ [key]: pair }), /от 0 до максимума/);
    }
  }
});

test("player and NPC models delegate complete resource comparison to validateJoint", async () => {
  const effectsUrl = "data:text/javascript,export%20const%20buildActorInfluenceState%20%3D%20()%20%3D%3E%20(%7B%7D)%3B";
  let called = 0;
  class TypeDataModel {
    static validateJoint() { called++; }
  }
  class Field { constructor(...args) { this.args = args; } }
  globalThis.foundry = {
    ...globalThis.foundry,
    abstract: { TypeDataModel },
    data: { fields: {
      SchemaField: class extends Field {}, NumberField: class extends Field {},
      ArrayField: class extends Field {}, StringField: class extends Field {}
    } }
  };
  for (const type of ["player", "npc"]) {
    let source = await readFile(new URL(`../module/data/actor/${type}-data.js`, import.meta.url), "utf8");
    source = source.replace('"../../effects/effect-utils.js"', JSON.stringify(effectsUrl));
    source = source.replace('"../../actors/resource-pools.js"', JSON.stringify(poolUrl));
    const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    const Model = Object.values(await import(url)).find((entry) => typeof entry === "function");
    assert.doesNotThrow(() => Model.validateJoint({ mana: { value: 3, max: 5 }, combatPoints: { value: 1, max: 4 } }));
    assert.throws(() => Model.validateJoint({ mana: { value: 6, max: 5 } }), /Мана/);
    assert.throws(() => Model.validateJoint({ combatPoints: { value: 8, max: 7 } }), /Боевые очки/);
    assert.match(Model.validateJoint.toString(), /super\.validateJoint/);
  }
  assert.equal(called, 6);
});

test("both pools display the current value out of maximum and percentage from zero", () => {
  const pools = buildResourcePoolViews({
    mana: { min: 25, value: 30, max: 50 }, // legacy min must be ignored
    combatPoints: { value: 3, max: 12 }
  });
  assert.deepEqual(pools.map(({ key, label }) => [key, label]), [
    ["mana", "Мана"], ["combatPoints", "Боевые очки"]
  ]);
  assert.deepEqual(pools.map(({ value, max, fillPercent }) => [value, max, fillPercent]), [
    [30, 50, 60], [3, 12, 25]
  ]);
  assert.equal("min" in pools[0], false);
});

test("zero maximum displays an empty bar; defensive rendering does not modify actor data", () => {
  assert.equal(buildResourcePoolViews({})[0].fillPercent, 0);
  assert.equal(buildResourcePoolViews({ mana: { value: 0, max: 0 } })[0].fillPercent, 0);
  const legacy = buildResourcePoolViews({ mana: { value: 20, max: 10 } })[0];
  assert.equal(legacy.fillPercent, 100);
  assert.equal(legacy.value, 20);
});

class FakeInput {
  constructor(value) {
    this.value = String(value);
    this.max = "";
    this.handlers = {};
  }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  change(newValue) {
    this.value = String(newValue);
    const state = { prevented: false, stopped: false, currentTarget: this,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }
    };
    this.handlers.change(state);
    return state;
  }
}

test("invalid input is reverted before actor form submission, while valid values are accepted", () => {
  const manaValue = new FakeInput(5);
  const manaMax = new FakeInput(10);
  const combatValue = new FakeInput(1);
  const combatMax = new FakeInput(2);
  const inputs = {
    'system.mana.value': manaValue, 'system.mana.max': manaMax,
    'system.combatPoints.value': combatValue, 'system.combatPoints.max': combatMax
  };
  const root = { querySelector(selector) {
    return inputs[selector.match(/\[name="([^"]+)"\]/)?.[1]] ?? null;
  } };
  const actor = { system: { mana: { value: 5, max: 10 }, combatPoints: { value: 1, max: 2 } } };
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  activateResourcePoolInputValidation(root, actor);

  let event = manaValue.change(11);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(manaValue.value, "5");

  event = manaValue.change(-1);
  assert.equal(event.stopped, true);
  assert.equal(manaValue.value, "5");

  event = manaMax.change(4); // below existing current value
  assert.equal(event.stopped, true);
  assert.equal(manaMax.value, "10");

  event = manaMax.change(-3);
  assert.equal(event.stopped, true);
  assert.equal(manaMax.value, "10");

  event = manaMax.change(20);
  assert.equal(event.stopped, false);
  assert.equal(manaValue.max, "20");

  event = manaValue.change(18);
  assert.equal(event.stopped, false);
  assert.equal(manaValue.value, "18");

  event = manaValue.change(1.5);
  assert.equal(event.stopped, true);
  assert.equal(manaValue.value, "5");

  event = combatMax.change(1);
  assert.equal(event.stopped, false); // equal to existing current value
  assert.equal(combatValue.max, "1");
  assert.equal(combatValue.value, "1");
  assert.equal(warnings.length, 5);
});

test("player and NPC models, sheets and templates include two constrained resource fields", async () => {
  for (const type of ["player", "npc"]) {
    const data = await readFile(new URL(`../module/data/actor/${type}-data.js`, import.meta.url), "utf8");
    const sheet = await readFile(new URL(`../module/apps/sheets/actor-${type}-sheet.js`, import.meta.url), "utf8");
    const template = await readFile(new URL(`../templates/sheet/actor-${type}.hbs`, import.meta.url), "utf8");
    assert.match(data, /mana: createResourcePoolField\(\)/);
    assert.match(data, /combatPoints: createResourcePoolField\(\)/);
    assert.match(sheet, /context\.resourcePools = buildResourcePoolViews\(this\.document\.system\)/);
    assert.match(sheet, /activateResourcePoolInputValidation\(htmlElement, this\.document\)/);
    assert.doesNotMatch(template, /name="system\.\{\{this\.key\}\}\.min"/);
    assert.match(template, /name="system\.\{\{this\.key\}\}\.value" value="\{\{this\.value\}\}" required/);
    assert.match(template, /min="0" max="\{\{this\.max\}\}"/);
    assert.match(template, /name="system\.\{\{this\.key\}\}\.max" value="\{\{this\.max\}\}" required/);
    assert.match(template, /class="pg-pool-divider"/);
    assert.doesNotMatch(template, /pg-pool-warning/);
  }
});
