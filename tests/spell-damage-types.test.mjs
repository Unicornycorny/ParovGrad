import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const moduleUrls = new Map();
async function moduleUrl(path) {
  if (moduleUrls.has(path)) return moduleUrls.get(path);
  const fileUrl = new URL(`../module/${path}`, import.meta.url);
  let source = await readFile(fileUrl, "utf8");
  for (const match of [...source.matchAll(/from "(\.[^"]+)"/g)]) {
    const dependency = new URL(match[1], fileUrl).pathname.split("/module/")[1];
    source = source.replace(match[0], `from "${await moduleUrl(dependency)}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  moduleUrls.set(path, url);
  return url;
}

let serial = 0;
class Field {
  constructor(options) { this.options = options; }
}
class ApplicationV2 {
  async _prepareContext() { return {}; }
  _attachPartListeners() {}
  async render() {}
}
globalThis.foundry = {
  utils: {randomID: () => `part-${++serial}`},
  abstract: {TypeDataModel: class {}},
  data: {fields: Object.fromEntries(["ArrayField", "BooleanField", "NumberField", "SchemaField", "StringField"].map(key => [key, Field]))},
  applications: {api: {ApplicationV2, HandlebarsApplicationMixin: base => base}}
};
globalThis.game = {items: {contents: []}};
globalThis.ui = {notifications: {info() {}, warn() {}, error() {}}};
globalThis.HTMLSelectElement = class {};
globalThis.HTMLButtonElement = class {};
const {PHYSICAL_DAMAGE_TYPES, damagePartLabel} = await import(await moduleUrl("damage/damage-types.js"));
const {MagicTreeCompiler} = await import(await moduleUrl("magic/magic-tree-compiler.js"));
const {getSpellEffects} = await import(await moduleUrl("magic/spell-effects.js"));
const {buildSpellConstruction, getSpellConstruction} = await import(await moduleUrl("magic/spell-construction.js"));
const {ParovGradSpellBuilder} = await import(await moduleUrl("apps/spell-builder.js"));
const {SpellDataModel} = await import(await moduleUrl("data/item/spell-data.js"));

function tree(damageType) {
  return {
    uuid: "Item.tree", name: "Магия", system: {revision: 3, nodes: {
      range: {type: "range", output: {value: "30 футов"}},
      shape: {type: "shape", output: {value: "Цель"}},
      damage: {type: "influence", name: "Урон", output: {effectType: "damage", value: "2d6"}},
      ...(damageType ? {kind: {type: "damageType", output: {damageType}}} : {})
    }}
  };
}

const baseNodes = ["range", "shape", "damage"];
function directBinding(damageType) {
  return {influenceNodeId: "damage", category: "typed", damageTypeNodeId: "", damageType};
}

for (const [damageType, label] of Object.entries(PHYSICAL_DAMAGE_TYPES)) {
  test(`${label} compiles directly without a damage-type node and survives saved construction`, () => {
    const source = tree();
    const construction = buildSpellConstruction(source, baseNodes, [directBinding(damageType)]);
    const saved = getSpellConstruction({system: {construction: structuredClone(construction)}});
    const result = MagicTreeCompiler.compile(source, saved.selectedNodeIds, saved.damageBindings);
    assert.equal(result.valid, true, result.errors.join("\n"));
    const part = result.spell.effects[0].damage.parts[0];
    assert.equal(part.category, "typed");
    assert.equal(part.damageType, damageType);
    assert.equal(part.formula, "2d6");
    assert.equal(damagePartLabel(part), label);
    const options = result.damageControls[0].typeOptions;
    assert.equal(options.find(option => option.selected)?.value, `__${damageType}`);
    assert.deepEqual(options.slice(1).map(option => option.label), Object.values(PHYSICAL_DAMAGE_TYPES));
    assert.ok(!options.some(option => option.label === "Физический"));
  });

  test(`${label} also compiles through a selected damage-type node`, () => {
    const result = MagicTreeCompiler.compile(tree(damageType), [...baseNodes, "kind"]);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.spell.effects[0].damage.parts[0].damageType, damageType);
    assert.equal(result.damageControls[0].selectedTypeNodeId, "kind");
  });
}

test("legacy physical construction becomes a saved bludgeoning binding", () => {
  const legacy = {influenceNodeId: "damage", damageTypeNodeId: "", category: "physical"};
  const direct = MagicTreeCompiler.compile(tree(), baseNodes, [legacy]);
  assert.equal(direct.valid, true);
  assert.equal(direct.spell.effects[0].damage.parts[0].damageType, "bludgeoning");
  const saved = getSpellConstruction({system: {construction: {damageBindings: [legacy]}}});
  assert.deepEqual(saved.damageBindings, [directBinding("bludgeoning")]);
  assert.deepEqual(buildSpellConstruction(tree(), baseNodes, [legacy]).damageBindings, saved.damageBindings);
});

test("existing elemental bindings and the single-node automatic selection keep their types", () => {
  const source = tree("fire");
  for (const bindings of [[], [{influenceNodeId: "damage", damageTypeNodeId: "kind", category: "typed"}]]) {
    const construction = buildSpellConstruction(source, [...baseNodes, "kind"], bindings);
    const saved = getSpellConstruction({system: {construction}});
    const result = MagicTreeCompiler.compile(source, saved.selectedNodeIds, saved.damageBindings);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.spell.effects[0].damage.parts[0].damageType, "fire");
  }
});

test("legacy spell effects default to bludgeoning and configured physical types remain distinct", () => {
  const legacyText = getSpellEffects({influences: ["Урон: 2d6", "Лечение: 1d4"]});
  assert.equal(legacyText[0].damage.parts[0].damageType, "bludgeoning");
  assert.equal(legacyText[0].damage.parts[0].formula, "2d6");
  assert.deepEqual(legacyText[1].damage.parts, []);
  const effects = getSpellEffects({effects: [
    {type: "damage", formula: "1d8"},
    {type: "damage", formula: "1d10", damage: {parts: [{formula: "1d10", category: "physical"}]}},
    ...Object.keys(PHYSICAL_DAMAGE_TYPES).map(damageType => ({
      type: "damage", formula: "1d6", damage: {parts: [{formula: "1d6", category: "typed", damageType}]}
    }))
  ]});
  assert.deepEqual(effects.map(effect => effect.damage.parts[0].damageType),
    ["bludgeoning", "bludgeoning", "bludgeoning", "piercing", "slashing"]);
});

test("missing, stale, unknown and conflicting type bindings prevent compilation", () => {
  const source = tree("fire");
  for (const bindings of [
    [],
    [{influenceNodeId: "damage", category: "typed", damageTypeNodeId: "removed"}],
    [directBinding("fire")],
    [{...directBinding("piercing"), damageTypeNodeId: "kind"}]
  ]) {
    const result = MagicTreeCompiler.compile(source, baseNodes, bindings);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
  }
});

test("new binding schema permits all three direct types and retains legacy category loading", () => {
  const schema = SpellDataModel.defineSchema();
  const binding = schema.construction.options.damageBindings.options.options;
  assert.deepEqual(binding.damageType.options.choices, ["", "bludgeoning", "piercing", "slashing"]);
  assert.equal(binding.category.options.initial, "typed");
  assert.deepEqual(binding.category.options.choices, ["physical", "typed"]);
});

test("changing and applying builder choices saves the direct damage type for each spell", async () => {
  for (const damageType of Object.keys(PHYSICAL_DAMAGE_TYPES)) {
    const source = tree();
    const writes = [];
    const spell = {
      name: "Клинки", documentName: "Item", type: "spell", system: {},
      async update(patch) { writes.push(structuredClone(patch)); }
    };
    const builder = new ParovGradSpellBuilder(spell);
    builder._selectedNodeIds = new Set(baseNodes);
    builder._resolveCurrentTree = async () => source;
    builder._mountGraph = () => {};
    builder._bindGraphNavigation = () => {};
    let change;
    const select = {
      value: `__${damageType}`, dataset: {influenceId: "damage"},
      addEventListener(event, callback) { if (event === "change") change = callback; }
    };
    builder._attachPartListeners("main", {
      querySelector: () => null,
      querySelectorAll: selector => selector === ".pg-spell-damage-binding" ? [select] : []
    }, {});
    await change();
    await builder._applyToSpell();
    assert.equal(writes.length, 1);
    assert.equal(writes[0]["system.effects"][0].damage.parts[0].damageType, damageType);
    const construction = writes[0]["system.construction"];
    assert.deepEqual(construction.damageBindings, [directBinding(damageType)]);
    const restored = getSpellConstruction({system: {construction}});
    const result = MagicTreeCompiler.compile(source, restored.selectedNodeIds, restored.damageBindings);
    assert.equal(result.valid, true);
    assert.equal(result.spell.effects[0].damage.parts[0].damageType, damageType);
  }
});
