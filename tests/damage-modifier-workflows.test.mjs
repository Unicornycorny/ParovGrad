import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

// Use the production modules, including damage calculation and effect collection.
globalThis.foundry = { canvas: { placeables: { MeasuredTemplate: class {} } } };
const weapon = await importModule(new URL("../module/workflows/weapon-attack.js", import.meta.url));
const spell = await importModule(new URL("../module/workflows/spell-use.js", import.meta.url));
const area = await importModule(new URL("../module/workflows/skill-area-attack.js", import.meta.url));
const effects = await importModule(new URL("../module/effects/effect-utils.js", import.meta.url));
const { getAppliedDamage } = await importModule(new URL("../module/damage/damage-types.js", import.meta.url));

let documents, messages, errors, serial;
function setPath(object, path, value) {
  const keys = path.split(".");
  const leaf = keys.pop();
  for (const key of keys) object = object[key] ??= {};
  object[leaf] = structuredClone(value);
}
function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}
function mergeObject(base, extra) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(result[key] ?? {}, value) : structuredClone(value);
  }
  return result;
}
function reset() {
  documents = new Map(); messages = []; errors = []; serial = 0;
  globalThis.foundry = {
    utils: { deepClone: structuredClone, mergeObject, escapeHTML: String, randomID: () => `id-${++serial}` },
    applications: { api: { DialogV2: {} } }
  };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
    ACTIVE_EFFECT_MODES: { ADD: 2 },
    CHAT_MESSAGE_STYLES: { OTHER: 0 }
  };
  globalThis.game = { user: { id: "owner", isGM: false } };
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.ui = { notifications: { info() {}, warn: text => errors.push(text), error: text => errors.push(text) } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.uuid }),
    async create(data) { const value = message(data.flags?.ParovGrad ?? {}, data); messages.push(value); return value; }
  };
}
function message(flags, extra = {}) {
  return {
    id: `message-${++serial}`, uuid: `ChatMessage.${serial}`, user: "owner",
    flags: { ParovGrad: structuredClone(flags) }, ...extra,
    getFlag(scope, path) { return getPath(this.flags[scope], path); },
    canUserModify() { return true; },
    async setFlag(scope, path, value) { setPath(this.flags[scope], path, value); },
    async update(patch) { for (const [path, value] of Object.entries(patch)) setPath(this, path, value); }
  };
}
function conversion(mode, damageType = "fire", extra = {}) {
  return { name: `${mode} ${damageType}`, flags: { ParovGrad: { modifiers: [], damageModifiers: [{ mode, damageType }] } }, ...extra };
}
function target(id, actorEffects = [], items = []) {
  const actor = {
    uuid: `Actor.${id}`, documentName: "Actor", name: id, isOwner: true, effects: actorEffects, items,
    system: { health: { value: 50, max: 50 } }, flags: {}, writes: [],
    testUserPermission() { return true; },
    async update(patch) {
      this.writes.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) setPath(this, path, value);
      return this;
    },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const created = data.map(value => ({ ...structuredClone(value), id: `effect-${++serial}` }));
      this.effects.push(...created);
      return created;
    }
  };
  const token = { uuid: `Scene.battle.Token.${id}`, name: id, actor };
  documents.set(token.uuid, token);
  documents.set(actor.uuid, actor);
  return token;
}
const part = (damageType, amount) => ({ category: "typed", damageType, amount, formula: "1d6" });
function button(dataset) {
  const listeners = new Map();
  return {
    dataset, disabled: false, isConnected: true,
    addEventListener(type, callback) { listeners.set(type, callback); },
    async click() { assert.ok(listeners.has("click")); await listeners.get("click")({ preventDefault() {} }); }
  };
}

for (const sourceType of ["weapon", "skill"]) {
  test(`${sourceType} damage card applies the target's mixed conversions and records the transformed damage once`, async () => {
    reset();
    const token = target(sourceType, [conversion("resistance"), conversion("vulnerability", "slashing"), conversion("immunity", "poison")]);
    const parts = [part("fire", 3), part("fire", 2), part("slashing", 3), part("poison", 9)];
    const card = message({ cardType: "damage", damage: { targetTokenUuid: token.uuid, targetName: token.name, sourceType, sourceName: "Атака", amount: 17, parts } });
    await weapon.handleApplyDamageButtonClick(card);
    assert.equal(token.actor.system.health.value, 42);
    assert.deepEqual(getAppliedDamage(token.actor, card.uuid), { amount: 8, before: 50, after: 42 });
    assert.match(messages[0].content, /получает 8 урона/);
    await weapon.handleApplyDamageButtonClick(card);
    assert.equal(token.actor.writes.length, 1);
    assert.deepEqual(errors, []);
  });
}

test("an active item effect keeps its conversion in the frozen hit snapshot and changes the ensuing damage", async () => {
  reset();
  const token = target("on-hit");
  const effect = conversion("vulnerability");
  effect.flags.ParovGrad.itemApplication = "active";
  const item = { uuid: "Actor.attacker.Item.brand", name: "Огненное клеймо", type: "weapon", effects: [effect] };
  const snapshot = effects.getActiveItemEffectData(item);
  effect.flags.ParovGrad.damageModifiers = [{ mode: "immunity", damageType: "fire" }];
  await effects.applyItemEffectDataToActor(token.actor, snapshot, { applicationId: "ChatMessage.hit" });
  const card = message({ damage: { targetTokenUuid: token.uuid, targetName: token.name, amount: 5, parts: [part("fire", 5)] } });
  await weapon.handleApplyDamageButtonClick(card);
  assert.equal(token.actor.system.health.value, 40);
  assert.equal(token.actor.effects.length, 1);
  assert.deepEqual(token.actor.effects[0].flags.ParovGrad.damageModifiers, [{ mode: "vulnerability", damageType: "fire" }]);
  assert.deepEqual(errors, []);
});

for (const [mode, expected] of [["damage", 8], ["halfDamage", 4]]) {
  test(`single-target spell ${mode} uses the same conversions and preserves the original rolled parts`, async () => {
    reset();
    const token = target(mode, [conversion("resistance"), conversion("vulnerability", "cold"), conversion("immunity", "poison")]);
    const parts = [part("fire", 5), part("cold", 3), part("poison", 7)];
    const card = message({ cardType: "spell-effect", spellEffect: { targetTokenUuid: token.uuid, targetName: token.name, itemName: "Заклинание", effectType: "damage", amount: 15, parts } });
    await spell.handleApplySpellEffectButtonClick(card, mode);
    assert.equal(token.actor.system.health.value, 50 - expected);
    assert.equal(card.getFlag("ParovGrad", "spellEffect.appliedAmount"), expected);
    assert.deepEqual(card.getFlag("ParovGrad", "spellEffect.parts"), parts);
    await spell.handleApplySpellEffectButtonClick(card, mode);
    assert.equal(token.actor.writes.length, 1);
    assert.deepEqual(errors, []);
  });
}

test("area skill damage resolves each target's own actor and worn-item effects", async () => {
  reset();
  const tokens = [
    target("resistant", [], [{ type: "item", system: { equipped: true }, effects: [conversion("resistance")] }]),
    target("immune", [conversion("immunity")]),
    target("vulnerable", [conversion("vulnerability")])
  ];
  const card = message({ cardType: "mass-skill-attack", massSkillAttack: {
    actorName: "Атакующий", itemName: "Навык", attackTotal: 15,
    targets: tokens.map(token => ({ uuid: token.uuid, name: token.name, defended: true, hit: true, damage: 5, damageParts: [part("fire", 5)], applied: false, effectTotal: null }))
  } });
  const buttons = tokens.map((_, i) => button({ action: "mass-skill-apply", target: String(i), half: "false" }));
  area.renderMassSkillChatButtons(card, { querySelectorAll: () => buttons });
  for (const entry of buttons) await entry.click();
  assert.deepEqual(tokens.map(token => token.actor.system.health.value), [48, 50, 40]);
  assert.deepEqual(card.getFlag("ParovGrad", "massSkillAttack.targets").map(entry => entry.appliedAmount), [2, 0, 10]);
  for (const entry of buttons) await entry.click();
  assert.ok(tokens.every(token => token.actor.writes.length === 1));
  assert.deepEqual(errors, []);
});

test("mass spell half damage resolves immunity, resistance and vulnerability independently for every target", async () => {
  reset();
  const tokens = [target("resistant", [conversion("resistance")]), target("immune", [conversion("immunity")]), target("vulnerable", [conversion("vulnerability")])];
  const parts = [part("fire", 5), part("cold", 3)];
  const card = message({ cardType: "spell-mass-attack", spellMassAttack: {
    actorName: "Маг", itemName: "Заклинание", total: 15, mode: "normal",
    targets: tokens.map(token => ({ tokenUuid: token.uuid, name: token.name, resolved: true, success: true, effects: [{ type: "damage", label: "Урон", formula: "2d6", amount: 8, parts, applied: false }] }))
  } });
  const buttons = tokens.map((_, i) => button({ action: "mass-spell-apply", targetIndex: String(i), effectIndex: "0", mode: "halfDamage" }));
  spell.renderSpellChatButtons(card, { querySelectorAll: () => buttons });
  for (const entry of buttons) await entry.click();
  assert.deepEqual(tokens.map(token => token.actor.system.health.value), [48, 49, 44]);
  assert.deepEqual(card.getFlag("ParovGrad", "spellMassAttack.targets").map(entry => entry.effects[0].appliedAmount), [2, 1, 6]);
  for (const entry of buttons) await entry.click();
  assert.ok(tokens.every(token => token.actor.writes.length === 1));
  assert.deepEqual(errors, []);
});

test("healing spells keep their healing amount when the target has immunity to all damage", async () => {
  reset();
  const token = target("healed", [conversion("immunity", "all")]);
  token.actor.system.health.value = 20;
  const card = message({ cardType: "spell-effect", spellEffect: { targetTokenUuid: token.uuid, targetName: token.name, itemName: "Лечение", effectType: "healing", amount: 7 } });
  await spell.handleApplySpellEffectButtonClick(card, "healing");
  assert.equal(token.actor.system.health.value, 27);
  assert.equal(card.getFlag("ParovGrad", "spellEffect.appliedAmount"), 7);
  assert.deepEqual(errors, []);
});
