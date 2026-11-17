import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const {
  PHYSICAL_DAMAGE_TYPES, DAMAGE_TYPES, makeDamagePart, normalizedDamagePart,
  getItemDamageParts, damagePartLabel, damagePartOptions, validateDamageParts,
  rollDamageParts, serializeDamageResults, damageResultsHtml, calculateDamage, applyTypedDamage
} = await importModule(new URL("../module/damage/damage-types.js", import.meta.url));

let nextId = 0;
globalThis.foundry = {utils: {
  randomID: () => `damage-${++nextId}`,
  escapeHTML: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
}};
globalThis.Roll = {validate: (formula) => /^(?:\d*)d\d+(?:\s*\+\s*\d+)?$/.test(formula)};

test("physical subtypes share the damage catalogue with the existing energy types", () => {
  assert.deepEqual(PHYSICAL_DAMAGE_TYPES, {
    bludgeoning: "Дробящий", piercing: "Колющий", slashing: "Режущий"
  });
  assert.equal(Object.keys(DAMAGE_TYPES).length, 12);
  for (const [type, label] of Object.entries(PHYSICAL_DAMAGE_TYPES)) {
    assert.equal(DAMAGE_TYPES[type], label);
  }
  for (const type of ["fire", "cold", "sonic", "electricity", "force", "poison", "acid", "necrotic", "holy"]) {
    assert.equal(typeof DAMAGE_TYPES[type], "string");
  }
  assert.equal(Object.hasOwn(DAMAGE_TYPES, "physical"), false);
});

test("new parts and old physical items consistently default to bludgeoning", () => {
  const created = makeDamagePart();
  assert.ok(created.id);
  assert.equal(created.formula, "d4");
  assert.equal(created.category, "typed");
  assert.equal(created.damageType, "bludgeoning");

  const legacy = {id: "legacy", formula: " 2d6 + 3 ", category: "physical", damageType: null};
  const original = structuredClone(legacy);
  assert.deepEqual(normalizedDamagePart(legacy), {
    id: "legacy", formula: "2d6 + 3", category: "typed", damageType: "bludgeoning"
  });
  assert.deepEqual(legacy, original);
  assert.equal(damagePartLabel(legacy), "Дробящий");

  for (const item of [{damageDie: "2d6"}, {system: {damageDie: "2d6"}}, {damage: {parts: []}, damageDie: "2d6"}]) {
    const [part] = getItemDamageParts(item);
    assert.equal(part.formula, "2d6");
    assert.equal(part.category, "typed");
    assert.equal(part.damageType, "bludgeoning");
  }
  assert.equal(getItemDamageParts({}, {fallback: "1d8"})[0].formula, "1d8");
});

test("each physical type survives normalization and remains selectable in item editors", () => {
  for (const [type, label] of Object.entries(PHYSICAL_DAMAGE_TYPES)) {
    const original = makeDamagePart("2d8", "typed", type);
    const normalized = normalizedDamagePart(original);
    assert.deepEqual(normalized, original);
    assert.equal(damagePartLabel(normalized), label);
    const options = damagePartOptions(normalized);
    assert.equal(options.damageTypeOptions.length, 12);
    assert.deepEqual(options.damageTypeOptions.filter((option) => option.selected).map((option) => option.value), [type]);
    assert.equal((options.categoryOptions ?? []).some((option) => option.value === "physical"), false);
  }
});

test("legacy missing categories normalize safely while invalid explicit types remain unspecified", () => {
  for (const category of [undefined, "unknown"]) {
    const part = normalizedDamagePart({id: "old", formula: "1d6", category});
    assert.equal(part.category, "typed");
    assert.equal(part.damageType, "bludgeoning");
  }
  const invalid = normalizedDamagePart({id: "bad", formula: "1d6", category: "typed", damageType: "unknown"});
  assert.equal(invalid.category, "unspecified");
  assert.equal(invalid.damageType, null);
  assert.equal(damagePartLabel(invalid), "Не определён");
});

test("typed damage validation accepts new types and rejects invalid types or formulas", () => {
  for (const type of Object.keys(DAMAGE_TYPES)) {
    assert.doesNotThrow(() => validateDamageParts([{formula: "1d6", category: "typed", damageType: type}]));
  }
  for (const damageType of [null, "physical", "unknown", "toString"]) {
    assert.throws(() => validateDamageParts([{formula: "1d6", category: "typed", damageType}]));
  }
  for (const formula of ["", "bad formula"]) {
    assert.throws(() => validateDamageParts([{formula, category: "typed", damageType: "piercing"}]), /формула/);
  }
});

test("physical and energy rolls preserve their types in chat data and add inspiration once", async () => {
  const types = ["bludgeoning", "piercing", "slashing", "fire"];
  const parts = types.map((type) => makeDamagePart("1d6", "typed", type));
  const totals = [2, 3, 4, 6];
  const calls = [];
  const rollData = {bonus: 2};
  globalThis.game = {parovgrad: {dice: {createRoll(formula, data, options) {
    const total = totals[calls.length];
    calls.push({formula, data, options});
    return {total, async evaluate() { this.evaluated = true; }};
  }}}};

  const rolled = await rollDamageParts(parts, {rollData, useInspiration: true});
  assert.equal(rolled.total, 15);
  assert.equal(rolled.primaryRoll, rolled.results[0].roll);
  assert.ok(rolled.results.every((part) => part.roll.evaluated));
  assert.deepEqual(calls.map((call) => call.options.addExtraDie), [true, false, false, false]);
  assert.ok(calls.every((call) => call.data === rollData));

  const serialized = serializeDamageResults(rolled.results);
  assert.deepEqual(serialized, parts.map((part, index) => ({...part, amount: totals[index]})));
  assert.deepEqual(serialized.map((part) => part.damageType), types);
  assert.ok(serialized.every((part) => !Object.hasOwn(part, "roll")));
  const html = damageResultsHtml(serialized);
  for (const type of types) assert.ok(html.includes(DAMAGE_TYPES[type]));
});

test("mixed damage keeps full/half totals and health clamping", async () => {
  const parts = [
    {category: "typed", damageType: "slashing", amount: 5},
    {category: "typed", damageType: "fire", amount: 4},
    {category: "typed", damageType: "piercing", amount: -3}
  ];
  assert.equal(calculateDamage(parts), 9);
  assert.equal(calculateDamage(parts, {half: true}), 4);

  const actor = {system: {health: {value: 7}}, writes: [], async update(patch) {
    this.writes.push(patch);
    this.system.health.value = patch["system.health.value"];
  }};
  assert.deepEqual(await applyTypedDamage(actor, parts, {half: true}), {amount: 4, before: 7, after: 3});
  assert.deepEqual(await applyTypedDamage(actor, parts), {amount: 9, before: 3, after: 0});
  assert.deepEqual(actor.writes, [{"system.health.value": 3}, {"system.health.value": 0}]);
});
