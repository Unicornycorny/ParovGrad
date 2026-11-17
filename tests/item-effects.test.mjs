import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const urls = new Map();
async function moduleUrl(path) {
  if (urls.has(path)) return urls.get(path);
  const file = new URL(`../module/${path}`, import.meta.url);
  let source = await readFile(file, "utf8");
  for (const match of [...source.matchAll(/from "(\.[^"]+)"/g)]) {
    const dependency = new URL(match[1], file).pathname.split("/module/")[1];
    source = source.replace(match[0], `from "${await moduleUrl(dependency)}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(path, url);
  return url;
}

function mergeObject(base, extra) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(result[key] ?? {}, value) : structuredClone(value);
  }
  return result;
}
class Field { constructor(options) { this.options = options; } }
globalThis.foundry = {
  utils: { mergeObject, escapeHTML: (value) => String(value) },
  abstract: { TypeDataModel: class {} },
  data: { fields: Object.fromEntries(["StringField", "BooleanField", "ArrayField", "SchemaField", "NumberField"].map((key) => [key, Field])) },
  applications: { api: { DialogV2: {} } }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { ADD: 2 } };
globalThis.game = { user: { isGM: false } };
const effects = await import(await moduleUrl("effects/effect-utils.js"));
const { PlayerDataModel } = await import(await moduleUrl("data/actor/player-data.js"));
const { NpcDataModel } = await import(await moduleUrl("data/actor/npc-data.js"));
const { ItemDataModel } = await import(await moduleUrl("data/item/item-data.js"));
const { WeaponDataModel } = await import(await moduleUrl("data/item/weapon-data.js"));

function effect(id, modifiers = [{ target: "constitution", value: 2 }], extra = {}) {
  return {
    id, uuid: `ActiveEffect.${id}`, documentName: "ActiveEffect", name: "Одинаковый эффект",
    flags: { ParovGrad: { modifiers, level: 1 } },
    ...extra
  };
}
function item(id, attached = [], equipped = false, type = "item") {
  return {
    id, uuid: `Actor.wearer.Item.${id}`, documentName: "Item", name: `Предмет ${id}`, type,
    system: { equipped }, effects: attached, isOwner: true, writes: [],
    async createEmbeddedDocuments(documentName, data) {
      assert.equal(documentName, "ActiveEffect");
      this.writes.push(structuredClone(data));
      const created = data.map((entry, index) => ({ ...structuredClone(entry), id: `${this.effects.length + index}` }));
      this.effects.push(...created);
      return created;
    }
  };
}
function actor(extra = {}) {
  return {
    documentName: "Actor", name: "Цель", isOwner: true, items: [], effects: [], writes: [],
    async createEmbeddedDocuments(documentName, data) {
      assert.equal(documentName, "ActiveEffect");
      this.writes.push(structuredClone(data));
      const created = data.map((entry, index) => ({ ...structuredClone(entry), id: `${this.effects.length + index}` }));
      this.effects.push(...created);
      return created;
    },
    ...extra
  };
}
function activeEffect(id, value = 4) {
  return effect(id, [{ target: "will", value }], {
    flags: { ParovGrad: { modifiers: [{ target: "will", value }], itemApplication: "active" } }
  });
}

test("old physical items default to stored, with no passive influence until worn", () => {
  for (const Model of [ItemDataModel, WeaponDataModel]) {
    assert.deepEqual(Model.defineSchema().equipped.options, { required: true, initial: false });
  }
  const ring = item("ring", [effect("bonus")]);
  delete ring.system.equipped;
  const wearer = actor({ items: [ring] });
  assert.equal(effects.buildActorInfluenceState(wearer).totalsByTarget.constitution, 0);
  ring.system.equipped = true;
  assert.equal(effects.buildActorInfluenceState(wearer).totalsByTarget.constitution, 2);
  ring.system.equipped = false;
  assert.equal(effects.buildActorInfluenceState(wearer).totalsByTarget.constitution, 0);
  assert.equal(wearer.effects.length, 0);
  assert.deepEqual(ring.writes, []);
});

test("worn weapon and item passives stack with actor effects and ignore actives, disabled and suppressed effects", () => {
  const wearer = actor({
    effects: [effect("actor", [{ target: "constitution", value: -1 }])],
    items: [
      item("ring", [effect("ring"), activeEffect("active"), effect("disabled", undefined, { disabled: true }), effect("suppressed", undefined, { isSuppressed: true })], true),
      item("sword", [effect("sword", [{ target: "constitution", value: 3 }, { target: "healthMax", value: 5 }])], true, "weapon"),
      item("stored", [effect("stored")]),
      item("spell", [effect("spell")], true, "spell")
    ]
  });
  const state = effects.buildActorInfluenceState(wearer);
  assert.equal(state.totalsByTarget.constitution, 4);
  assert.equal(state.totalsByTarget.healthMax, 5);
  assert.equal(state.totalsByTarget.will, 0);
  assert.equal(state.entriesByTarget.constitution.length, 3);
  assert.match(state.tooltipsByTarget.constitution, /Предмет ring/);
  assert.match(state.tooltipsByTarget.constitution, /Предмет sword/);
  wearer.items.shift();
  assert.equal(effects.buildActorInfluenceState(wearer).totalsByTarget.constitution, 2);
  wearer.items = [];
  assert.equal(effects.buildActorInfluenceState(wearer).totalsByTarget.constitution, -1);
});

test("Player and NPC derive effective stats and health from worn effects without accumulating or changing base stats", () => {
  const worn = item("armor", [effect("armor", [{ target: "constitution", value: 2 }, { target: "healthMax", value: 5 }])], true);
  for (const [Model, max] of [[PlayerDataModel, 41], [NpcDataModel, 25]]) {
    const system = { stats: { constitution: 10, awareness: 10, movement: 10, thinking: 10, will: 10 }, lifePath: 3, health: { value: 10, max: 20 }, parent: actor({ items: [worn] }) };
    worn.system.equipped = true;
    Model.prototype.prepareDerivedData.call(system);
    Model.prototype.prepareDerivedData.call(system);
    assert.equal(system.effectiveStats.constitution, 12);
    assert.equal(system.stats.constitution, 10);
    assert.equal(system.derivedHealthMax, max);
    worn.system.equipped = false;
    Model.prototype.prepareDerivedData.call(system);
    assert.equal(system.effectiveStats.constitution, 10);
    assert.equal(system.derivedHealthMax, Model === PlayerDataModel ? 30 : 20);
  }
});

test("actor views expose passive source items without exposing active or stored effects", () => {
  const ring = item("ring", [effect("passive"), activeEffect("active")], true);
  const views = effects.getActorPassiveItemEffectViews(actor({ items: [ring, item("stored", [effect("stored")])] }));
  assert.equal(views.length, 1);
  assert.equal(views[0].isItemPassive, true);
  assert.equal(views[0].sourceItemId, "ring");
  assert.equal(views[0].sourceLabel, "Предмет ring");
});

test("attaching a template makes an independent local effect with explicit application and no native transfer", async () => {
  const template = { documentName: "Item", type: "effect", uuid: "Compendium.effects.a", name: "Сила", system: { modifiers: [{ target: "constitution", value: 3 }] } };
  const sourceBefore = structuredClone(template);
  const ring = item("ring");
  const created = await effects.addEffectToItem(ring, template, "active");
  assert.equal(created.flags.ParovGrad.itemApplication, "active");
  assert.equal(created.flags.ParovGrad.sourceItemUuid, template.uuid);
  assert.equal(created.transfer, false);
  assert.deepEqual(created.changes, []);
  assert.deepEqual(template, sourceBefore);
  template.system.modifiers[0].value = 99;
  assert.equal(created.flags.ParovGrad.modifiers[0].value, 3);
  await assert.rejects(effects.addEffectToItem(item("unowned", [], false), template, "unknown"), /способ/);
  const unowned = item("unowned"); unowned.isOwner = false;
  await assert.rejects(effects.addEffectToItem(unowned, template), /прав/);
  await assert.rejects(effects.addEffectToItem(ring, { documentName: "Item", type: "weapon" }), /шаблон/);
});

test("active use snapshots only enabled active effects, independent of wear, and attributes them to the physical item", async () => {
  const potion = item("potion", [effect("passive"), activeEffect("active"), { ...activeEffect("disabled"), disabled: true }, { ...activeEffect("suppressed"), isSuppressed: true }]);
  const snapshot = effects.getActiveItemEffectData(potion);
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].flags.ParovGrad.sourceItemUuid, potion.uuid);
  assert.equal(snapshot[0].flags.ParovGrad.sourceItemName, potion.name);
  assert.equal(snapshot[0].flags.ParovGrad.itemApplication, undefined);
  potion.effects[1].flags.ParovGrad.modifiers[0].value = 99;
  const target = actor();
  await effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "ChatMessage.use" });
  assert.equal(target.effects[0].flags.ParovGrad.modifiers[0].value, 4);
  assert.equal(target.effects[0].transfer, false);
  assert.equal(target.effects[0].origin, potion.uuid);
  assert.equal(potion.writes.length, 0);
});

test("application checks target ownership and retries only missing effects after partial persistence", async () => {
  const snapshot = effects.getActiveItemEffectData(item("potion", [activeEffect("one"), activeEffect("two", -2)]));
  const target = actor({ isOwner: false });
  await assert.rejects(effects.applyItemEffectDataToActor(target, snapshot), /владелец/);
  assert.equal(target.writes.length, 0);
  target.isOwner = true;
  const create = target.createEmbeddedDocuments;
  target.createEmbeddedDocuments = async function (name, data) {
    await create.call(this, name, data.slice(0, 1));
    throw new Error("Connection lost after partial persistence");
  };
  await assert.rejects(effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "ChatMessage.use" }), /Connection/);
  target.createEmbeddedDocuments = create;
  await effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "ChatMessage.use" });
  assert.equal(target.effects.length, 2);
  assert.equal(target.writes[1].length, 1);
  assert.equal(target.effects[1].flags.ParovGrad.applicationIndex, 1);
  await effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "ChatMessage.use" });
  assert.equal(target.writes.length, 2);
  await effects.applyItemEffectDataToActor(target, snapshot, { applicationId: "ChatMessage.next-use" });
  assert.equal(target.effects.length, 4);
  const cancelled = actor({ async createEmbeddedDocuments() { return []; } });
  await assert.rejects(effects.applyItemEffectDataToActor(cancelled, snapshot), /Не все эффекты/);
});

test("creating a new active effect from its item dialog persists the application in the same create", async () => {
  foundry.applications.api.DialogV2.wait = async () => ({ name: "Новый эффект", modifiers: [{ target: "will", value: 2 }] });
  const potion = item("potion");
  await effects.openActorEffectDialog({ actor: potion, itemApplication: "active" });
  assert.equal(potion.writes.length, 1);
  assert.equal(potion.writes[0][0].flags.ParovGrad.itemApplication, "active");
  assert.equal(effects.buildActorInfluenceState(actor({ items: [{ ...potion, system: { equipped: true } }] })).totalsByTarget.will, 0);
});

test("actual item-use workflow and effect helpers apply the snapshot to the target once", async () => {
  const { startItemUse, handleApplyItemEffectsButtonClick } = await import(await moduleUrl("workflows/weapon-attack.js"));
  const target = actor({ uuid: "Actor.target", testUserPermission: () => true });
  const source = actor({ uuid: "Actor.source" });
  const potion = item("potion", [effect("passive"), activeEffect("active")]);
  source.items.push(potion);
  const tokenDocument = { uuid: "Scene.test.Token.target", name: "Цель", actor: target };
  game.user = { id: "owner", isGM: false, targets: new Set([{ document: tokenDocument }]) };
  foundry.utils.deepClone = structuredClone;
  CONST.CHAT_MESSAGE_STYLES = { OTHER: 0 };
  CONST.DOCUMENT_OWNERSHIP_LEVELS = { OWNER: 3 };
  globalThis.fromUuidSync = (uuid) => uuid === tokenDocument.uuid ? tokenDocument : null;
  const errors = [];
  globalThis.ui = { notifications: { info() {}, warn() {}, error: (message) => errors.push(message) } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor.uuid }),
    async create(data) {
      return {
        ...data, uuid: "ChatMessage.integration", canUserModify: () => true,
        getFlag(scope, path) { return path.split(".").reduce((value, key) => value?.[key], this.flags[scope]); },
        async setFlag(scope, path, value) {
          const [parent, key] = path.split(".");
          this.flags[scope][parent][key] = value;
        }
      };
    }
  };
  const message = await startItemUse({ actor: source, item: potion });
  assert.deepEqual(errors, []);
  assert.equal(target.effects.length, 1);
  assert.equal(effects.buildActorInfluenceState(target).totalsByTarget.will, 4);
  assert.equal(effects.buildActorInfluenceState(source).totalsByTarget.will, 0);
  assert.equal(message.flags.ParovGrad.itemUse.activeEffectsApplied, true);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(target.effects.length, 1);
  assert.equal(target.writes.length, 1);
});

test("actual attack, effects and damage helpers complete across different message authors", async () => {
  const { startItemAttack, handleDefenseButtonClick, handleAttackDamageButtonClick,
    handleApplyDamageButtonClick, renderAttackChatButtons } = await import(await moduleUrl("workflows/weapon-attack.js"));
  const { getAppliedDamage } = await import(await moduleUrl("damage/damage-types.js"));
  const messages = [];
  const documents = new Map();
  const prompts = [];
  const errors = [];
  let forbiddenWrites = 0;
  let serial = 0;
  const setPath = (object, path, value) => {
    const keys = path.split(".");
    const leaf = keys.pop();
    for (const key of keys) object = object[key] ??= {};
    object[leaf] = structuredClone(value);
  };
  const ownerActor = (id, owner) => {
    const document = actor({ uuid: `Actor.${id}`, flags: {}, system: { health: { value: 20 } },
      testUserPermission: (user) => user.isGM || user.id === owner,
      async update(patch) {
        assert.equal(this.isOwner, true);
        this.writes.push(structuredClone(patch));
        for (const [path, value] of Object.entries(patch)) setPath(this, path, value);
        return this;
      }
    });
    Object.defineProperty(document, "isOwner", { get: () => game.user.isGM || game.user.id === owner });
    documents.set(document.uuid, document);
    return document;
  };
  const source = ownerActor("attacker", "attacker");
  const victim = ownerActor("victim", "defender");
  const tokenDocument = { uuid: "Scene.battle.Token.victim", name: "Цель", actor: victim };
  documents.set(tokenDocument.uuid, tokenDocument);
  const sword = item("sword", [activeEffect("burning", -2)], false, "weapon");
  sword.system.damage = { parts: [{ id: "edge", formula: "1d6", category: "typed", damageType: "slashing" }] };
  documents.set(sword.uuid, sword);
  const totals = [15, 10, 4];
  game.user = { id: "attacker", isGM: false, targets: new Set([{ document: tokenDocument }]) };
  game.messages = { contents: messages, get: (id) => messages.find((entry) => entry.id === id) };
  game.parovgrad = { dice: { createRoll() {
    const total = totals.shift();
    return { total, async evaluate() {}, async render() { return "<p>roll</p>"; }, toJSON() { return { total }; } };
  } } };
  globalThis.fromUuidSync = (uuid) => documents.get(uuid);
  globalThis.ui = { notifications: { info() {}, warn: (message) => errors.push(message), error: (message) => errors.push(message) } };
  foundry.utils.randomID = () => `id-${++serial}`;
  foundry.applications.api.DialogV2.wait = async (options) => {
    prompts.push(options.window.title);
    return { mode: "normal", modifier: 0, useInspiration: false };
  };
  CONST.CHAT_MESSAGE_STYLES = { OTHER: 0, ROLL: 5 };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.uuid }),
    async create(data) {
      const message = {
        ...data, id: `card-${++serial}`, uuid: `ChatMessage.card-${serial}`,
        getFlag(scope, path) { return path.split(".").reduce((value, key) => value?.[key], this.flags?.[scope]); },
        canUserModify(user) { return user.isGM || user.id === this.user; },
        async setFlag(scope, path, value) {
          if (!this.canUserModify(game.user)) { forbiddenWrites++; throw new Error("Message permission denied"); }
          setPath(this.flags[scope], path, value);
        }
      };
      messages.push(message);
      documents.set(message.uuid, message);
      return message;
    }
  };
  const attack = await startItemAttack({ actor: source, item: sword });
  game.user.id = "defender";
  game.user.targets.clear();
  const defense = await handleDefenseButtonClick(attack);
  assert.equal(prompts.length, 2);
  assert.equal(victim.effects.length, 1);
  assert.equal(victim.effects[0].flags.ParovGrad.applicationId, attack.uuid);
  assert.equal(effects.buildActorInfluenceState(victim).totalsByTarget.will, -2);
  assert.equal(victim.system.health.value, 20);
  assert.equal(attack.getFlag("ParovGrad", "attack.resolved"), false);
  assert.equal(defense.getFlag("ParovGrad", "defense.success"), true);
  game.user.id = "attacker";
  const damage = await handleAttackDamageButtonClick(defense);
  assert.equal(prompts.length, 3);
  assert.equal(damage.getFlag("ParovGrad", "damage.amount"), 4);
  assert.equal(victim.system.health.value, 20);
  game.user.id = "defender";
  await handleApplyDamageButtonClick(damage);
  assert.equal(victim.system.health.value, 16);
  assert.deepEqual(getAppliedDamage(victim, damage.uuid), { amount: 4, before: 20, after: 16 });
  await handleApplyDamageButtonClick(damage);
  assert.equal(victim.system.health.value, 16);
  const button = { addEventListener() {} };
  await renderAttackChatButtons(damage, { querySelector: (selector) => selector.includes("apply-damage") ? button : null });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Урон нанесён");
  assert.equal(forbiddenWrites, 0);
  assert.deepEqual(errors, []);
});
