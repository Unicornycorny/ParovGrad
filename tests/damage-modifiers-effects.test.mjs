import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";
function mergeObject(base, extra) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(result[key] ?? {}, value) : structuredClone(value);
  }
  return result;
}
class Field {
  constructor(...args) { this.args = args; }
}
globalThis.foundry = {
  utils: { mergeObject, escapeHTML: (value) => String(value).replaceAll("<", "&lt;") },
  abstract: { TypeDataModel: class {} },
  data: { fields: Object.fromEntries(["StringField", "NumberField", "ArrayField", "SchemaField"].map((key) => [key, Field])) },
  applications: { api: { DialogV2: {} } }
};
globalThis.game = { user: { isGM: true } };
globalThis.ui = { notifications: { info() {}, error() {} } };
const modifiers = await importModule(new URL("../module/effects/damage-modifiers.js", import.meta.url));
const effects = await importModule(new URL("../module/effects/effect-utils.js", import.meta.url));
const { EffectDataModel } = await importModule(new URL("../module/data/item/effect-data.js", import.meta.url));

const resistance = { mode: "resistance", damageType: "fire" };
const vulnerability = { mode: "vulnerability", damageType: "physical" };
const immunity = { mode: "immunity", damageType: "all" };
function effect(damageModifiers, extra = {}) {
  return { documentName: "ActiveEffect", name: "Преобразование", flags: { ParovGrad: { damageModifiers } }, ...extra };
}
function document(documentName = "Actor", extra = {}) {
  return {
    documentName, name: "Цель", uuid: `${documentName}.target`, isOwner: true, effects: [], items: [],
    async createEmbeddedDocuments(name, data) {
      assert.equal(name, "ActiveEffect");
      const created = data.map((entry, index) => ({ ...structuredClone(entry), id: `effect-${this.effects.length + index}` }));
      this.effects.push(...created);
      return created;
    },
    ...extra
  };
}

test("effect schema defaults to no conversion and accepts modes and every supported damage scope", () => {
  const schema = EffectDataModel.defineSchema().damageModifiers;
  assert.deepEqual(schema.args[1], { required: true, initial: [] });
  assert.deepEqual(schema.args[0].args[0].mode.args[0].choices, ["resistance", "immunity", "vulnerability"]);
  const types = schema.args[0].args[0].damageType.args[0].choices;
  for (const type of ["all", "physical", "unspecified", "fire", "cold", "piercing", "slashing", "bludgeoning"]) {
    assert.ok(types.includes(type), type);
  }
  assert.deepEqual(modifiers.normalizeDamageModifiers(undefined), []);
  assert.deepEqual(modifiers.normalizeDamageModifiers([null, {}, { mode: "resistance", damageType: "unknown" }, resistance]), [resistance]);
});

test("damage conversions survive template attachment, snapshots, applying, cloning and editing", async () => {
  const template = { documentName: "Item", type: "effect", uuid: "Item.template", name: "Пламя", system: {
    modifiers: [{ target: "will", value: 2 }], damageModifiers: [resistance, vulnerability]
  } };
  const weapon = document("Item", { type: "weapon", uuid: "Item.weapon" });
  const attached = await effects.addEffectToItem(weapon, template, "active");
  assert.deepEqual(attached.flags.ParovGrad.damageModifiers, [resistance, vulnerability]);
  template.system.damageModifiers[0] = immunity;
  const snapshot = effects.getActiveItemEffectData(weapon);
  attached.flags.ParovGrad.damageModifiers[0] = immunity;
  const target = document();
  await effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "hit" });
  assert.deepEqual(target.effects[0].flags.ParovGrad.damageModifiers, [resistance, vulnerability]);
  assert.deepEqual(modifiers.getActorDamageModifiers(target), [resistance, vulnerability]);
  const view = effects.getActorEffectView(target.effects[0]);
  assert.equal(view.changesCount, 3);
  assert.match(view.modifierSummary, /Воля \+2/);
  assert.match(view.modifierSummary, /Сопротивление: Огонь/);
  assert.match(view.modifierSummary, /Уязвимость: Весь физический урон/);

  const clonedTarget = document();
  await effects.cloneActiveEffectToActor(clonedTarget, target.effects[0]);
  assert.deepEqual(clonedTarget.effects[0].flags.ParovGrad.damageModifiers, [resistance, vulnerability]);
  foundry.applications.api.DialogV2.wait = async () => ({ name: "Изменённый эффект", damageModifiers: [immunity], modifiers: [] });
  const editing = target.effects[0];
  editing.update = async (patch) => Object.assign(editing, patch);
  await effects.openActorEffectDialog({ actor: target, effect: editing });
  assert.deepEqual(editing.flags.ParovGrad.damageModifiers, [immunity]);
  assert.equal(editing.flags.ParovGrad.applicationId, "hit");
  assert.equal(editing.flags.ParovGrad.sourceItemUuid, "");
  foundry.applications.api.DialogV2.wait = async () => ({ name: "Без защиты", modifiers: [], damageModifiers: [] });
  await effects.openActorEffectDialog({ actor: target, effect: editing });
  assert.deepEqual(editing.flags.ParovGrad.damageModifiers, []);
});

test("only enabled actor effects and passive effects of worn equipment influence damage", () => {
  const wearer = document("Actor", {
    effects: [effect([resistance]), effect([immunity], { disabled: true }), effect([immunity], { isSuppressed: true })],
    items: [
      { type: "weapon", system: { equipped: true }, effects: [effect([vulnerability]), effect([immunity], {
        flags: { ParovGrad: { damageModifiers: [immunity], itemApplication: "active" } }
      })] },
      { type: "item", system: { equipped: true }, effects: [effect([immunity], { disabled: true })] },
      { type: "item", system: { equipped: false }, effects: [effect([immunity])] },
      { type: "spell", system: { equipped: true }, effects: [effect([immunity])] }
    ]
  });
  assert.deepEqual(modifiers.getActorDamageModifiers(null), []);
  assert.deepEqual(modifiers.getActorDamageModifiers(wearer), [resistance, vulnerability]);
  wearer.items[0].system.equipped = false;
  assert.deepEqual(modifiers.getActorDamageModifiers(wearer), [resistance]);
  wearer.effects[0].disabled = true;
  assert.deepEqual(modifiers.getActorDamageModifiers(wearer), []);
});

function control(extra = {}) {
  const listeners = new Map();
  return { ...extra, addEventListener: (type, handler) => listeners.set(type, handler),
    fire: async (type, target = null, overrides = {}) => listeners.get(type)?.({ target, preventDefault() {}, stopPropagation() {}, ...overrides }) };
}

test("shared editor adds, edits and removes conversions and keeps the dialog submission in sync", async () => {
  const list = control({ innerHTML: "" });
  const hidden = { value: "" };
  const add = control();
  const newMode = control({ value: "immunity" });
  const newType = control({ value: "cold" });
  const controls = {
    "[data-damage-modifier-list]": list, "input[name='damageModifiersData']": hidden,
    "[data-damage-modifier-add]": add, "[data-damage-modifier-new-mode]": newMode,
    "[data-damage-modifier-new-type]": newType
  };
  const editor = { querySelector: (selector) => controls[selector] };
  const root = { querySelector: () => editor };
  const changes = [];
  modifiers.initializeDamageModifierEditor(root, [resistance], async (value) => changes.push(value));
  assert.deepEqual(JSON.parse(hidden.value), [resistance]);
  let stopped = 0;
  await newMode.fire("change", newMode, { stopPropagation: () => stopped++ });
  await newType.fire("change", newType, { stopPropagation: () => stopped++ });
  assert.equal(stopped, 2, "pending selectors cannot trigger the parent sheet's submit-on-change");
  assert.deepEqual(changes, []);
  assert.equal(newMode.value, "immunity");
  assert.equal(newType.value, "cold");
  await add.fire("click");
  assert.deepEqual(changes[0], [resistance, { mode: "immunity", damageType: "cold" }]);
  const row = { dataset: { damageModifierIndex: "0" } };
  await list.fire("change", { value: "vulnerability", matches: (selector) => selector === "[data-damage-modifier-mode]", closest: () => row });
  assert.deepEqual(changes[1][0], { mode: "vulnerability", damageType: "fire" });
  const button = { closest: () => row };
  await list.fire("click", { closest: () => button });
  assert.deepEqual(changes[2], [{ mode: "immunity", damageType: "cold" }]);
  row.dataset.damageModifierIndex = "0";
  await list.fire("click", { closest: () => button });
  assert.deepEqual(JSON.parse(hidden.value), []);
  assert.match(list.innerHTML, /не добавлены/);
});
