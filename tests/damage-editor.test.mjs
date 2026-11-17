import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const {attachDamageEditor} = await importModule(new URL("../module/damage/damage-editor.js", import.meta.url));

let nextId = 0;
globalThis.foundry = {utils: {randomID: () => `new-${++nextId}`}};
globalThis.Roll = {validate: (formula) => /^(?:\d*)d\d+$/.test(formula)};

function control(className, value = "") {
  const listeners = new Map();
  return {
    value, classList: {contains: (name) => name === className},
    addEventListener(event, callback) { listeners.set(event, callback); },
    async fire(event) { await listeners.get(event)?.({preventDefault() {}, stopPropagation() {}}); }
  };
}

function harness(parts) {
  const messages = [];
  globalThis.ui = {notifications: {
    error: (text) => messages.push({type: "error", text}),
    warn: (text) => messages.push({type: "warn", text})
  }};
  const add = control("pg-damage-add");
  const rows = parts.map((part, index) => {
    const formula = control("pg-damage-formula", part.formula);
    const type = control("pg-damage-type", part.damageType ?? "bludgeoning");
    const remove = control("pg-damage-delete");
    return {
      dataset: {damageIndex: String(index)}, formula, type, remove,
      querySelector: (selector) => selector === ".pg-damage-delete" ? remove : null,
      querySelectorAll: () => [formula, type]
    };
  });
  const sheet = {
    document: {system: {damage: {parts: structuredClone(parts)}}, writes: [], async update(patch) {
      this.writes.push(structuredClone(patch));
      this.system.damage.parts = structuredClone(patch["system.damage.parts"]);
      this.system.damageDie = patch["system.damageDie"];
    }},
    renders: 0,
    async render() { this.renders++; }
  };
  attachDamageEditor(sheet, {
    querySelector: (selector) => selector === ".pg-damage-add" ? add : null,
    querySelectorAll: () => rows
  });
  return {sheet, rows, add, messages};
}

test("changing a legacy item to any physical subtype saves that type and preserves other components", async () => {
  for (const damageType of ["bludgeoning", "piercing", "slashing"]) {
    const fire = {id: "fire", formula: "1d4", category: "typed", damageType: "fire"};
    const {sheet, rows, messages} = harness([
      {id: "old", formula: "1d8", category: "physical", damageType: null}, fire
    ]);
    rows[0].type.value = damageType;
    await rows[0].type.fire("change");
    assert.deepEqual(sheet.document.system.damage.parts, [
      {id: "old", formula: "1d8", category: "typed", damageType}, fire
    ]);
    assert.equal(sheet.document.system.damageDie, "1d8");
    assert.equal(sheet.renders, 1);
    assert.deepEqual(messages, []);
  }
});

test("formula changes retain the physical type and adding a component defaults to bludgeoning", async () => {
  const {sheet, rows, add, messages} = harness([
    {id: "blade", formula: "1d6", category: "typed", damageType: "slashing"}
  ]);
  rows[0].formula.value = " 2d6 ";
  await rows[0].formula.fire("change");
  await add.fire("click");
  assert.deepEqual(sheet.document.system.damage.parts[0], {
    id: "blade", formula: "2d6", category: "typed", damageType: "slashing"
  });
  const added = sheet.document.system.damage.parts[1];
  assert.ok(added.id);
  assert.equal(added.formula, "d4");
  assert.equal(added.category, "typed");
  assert.equal(added.damageType, "bludgeoning");
  assert.deepEqual(messages, []);
});

test("deleting one damage part retains the other type and prevents deleting the last part", async () => {
  const fire = {id: "fire", formula: "1d4", category: "typed", damageType: "fire"};
  const first = harness([{id: "spear", formula: "1d8", category: "typed", damageType: "piercing"}, fire]);
  await first.rows[0].remove.fire("click");
  assert.deepEqual(first.sheet.document.system.damage.parts, [fire]);
  assert.equal(first.sheet.document.system.damageDie, "1d4");

  const last = harness([fire]);
  await last.rows[0].remove.fire("click");
  assert.deepEqual(last.sheet.document.writes, []);
  assert.equal(last.messages.length, 1);
  assert.equal(last.messages[0].type, "warn");
});
