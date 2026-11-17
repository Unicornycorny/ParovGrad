import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const dependencies = {
  "../damage/damage-types.js": `
    export const getItemDamageParts = item => structuredClone(item?.system?.damage?.parts ?? []);
    export const rollDamageParts = (...args) => globalThis.attackMocks.rollDamage(...args);
    export const serializeDamageResults = parts => parts.map(({roll, ...part}) => structuredClone(part));
    export const damageResultsHtml = () => "4 режущего";
    export const getAppliedDamage = () => null;
    export const applyTypedDamage = () => { throw new Error("Damage must await its apply button"); };
  `,
  "../effects/effect-utils.js": `
    export const getActiveItemEffectData = item => structuredClone(item?.activeEffects ?? []);
    export const applyItemEffectDataToActor = (...args) => globalThis.attackMocks.apply(...args);
  `,
  "../dice/roll-dialog.js": `
    export const consumeActorInspiration = async () => true;
    export const openConfiguredD20RollDialog = (...args) => globalThis.attackMocks.d20Dialog(...args);
    export const openConfiguredDamageRollDialog = (...args) => globalThis.attackMocks.damageDialog(...args);
  `
};
let source = await readFile(new URL("../module/workflows/weapon-attack.js", import.meta.url), "utf8");
for (const [path, dependency] of Object.entries(dependencies)) {
  source = source.replace(JSON.stringify(path), JSON.stringify(moduleUrl(dependency)));
}
const { startItemAttack, handleDefenseButtonClick, handleAttackDamageButtonClick,
  handleApplyItemEffectsButtonClick, renderAttackChatButtons } = await import(moduleUrl(source));

let messages, documents, warnings, applications, rollTotals, damageDialogs, d20Dialogs, damageRolls, serial, forbiddenWrites;
function getPath(object, path) {
  return path.split(".").reduce((parent, key) => parent?.[key], object);
}
function setPath(object, path, value) {
  const parts = path.split(".");
  let parent = object;
  for (const key of parts.slice(0, -1)) parent = parent[key] ??= {};
  parent[parts.at(-1)] = value;
}
function roll(total) {
  return { total, async evaluate() {}, async render() { return `<p>${total}</p>`; }, toJSON() { return { total }; } };
}
function reset() {
  messages = []; documents = new Map(); warnings = []; applications = []; rollTotals = [];
  damageDialogs = []; d20Dialogs = []; damageRolls = []; serial = 0; forbiddenWrites = 0;
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, CHAT_MESSAGE_STYLES: { ROLL: 5, OTHER: 0 } };
  globalThis.ui = { notifications: { warn: message => warnings.push(message), info() {}, error: message => warnings.push(message) }, chat: { updateMessage() {} } };
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.canvas = { tokens: { get() { return null; } } };
  globalThis.attackMocks = {
    async d20Dialog(options) { d20Dialogs.push(options); return { mode: "normal", modifier: 0, useInspiration: false }; },
    async damageDialog(options) { damageDialogs.push(options); return { useInspiration: false }; },
    async rollDamage(parts, options) {
      damageRolls.push({ parts: structuredClone(parts), options });
      const result = { ...parts[0], amount: 4, total: 4, roll: roll(4) };
      return { primaryRoll: result.roll, results: [result], total: 4 };
    },
    async apply(actor, data, options) {
      applications.push({ actor, data: structuredClone(data), options });
      const created = data.map((entry, index) => ({ ...structuredClone(entry), flags: {
        ...structuredClone(entry.flags ?? {}),
        ParovGrad: { ...structuredClone(entry.flags?.ParovGrad ?? {}), applicationId: options.applicationId, applicationIndex: index }
      } }));
      actor.effects.push(...created);
      return created;
    }
  };
  globalThis.game = {
    user: { id: "attacker", isGM: false, targets: new Set() },
    messages: {
      contents: messages, get: id => messages.find(message => message.id === id),
      find: callback => messages.find(callback), filter: callback => messages.filter(callback),
      values: () => messages.values(), [Symbol.iterator]: () => messages[Symbol.iterator]()
    },
    parovgrad: { dice: { createRoll: () => roll(rollTotals.shift() ?? 10) } }
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.uuid }),
    async create(data) {
      const message = {
        ...structuredClone(data), id: `resolution-${++serial}`, uuid: `ChatMessage.resolution-${serial}`,
        getFlag(scope, path) { return getPath(this.flags?.[scope], path); },
        canUserModify(user, action) { return action === "update" && (user.isGM || user.id === this.user); },
        async setFlag(scope, path, value) {
          if (!this.canUserModify(game.user, "update")) { forbiddenWrites++; throw new Error("Message permission denied"); }
          setPath(this.flags[scope], path, value);
        },
        async update(patch) {
          if (!this.canUserModify(game.user, "update")) { forbiddenWrites++; throw new Error("Message permission denied"); }
          for (const [path, value] of Object.entries(patch)) setPath(this, path, value);
          return this;
        }
      };
      messages.push(message);
      documents.set(message.uuid, message);
      return message;
    }
  };
}
function actor(id, owner = "attacker") {
  const value = { documentName: "Actor", uuid: `Actor.${id}`, name: id, effects: [], system: { health: { value: 20 } }, testUserPermission: user => user.isGM || user.id === owner };
  Object.defineProperty(value, "isOwner", { get: () => game.user.isGM || game.user.id === owner });
  documents.set(value.uuid, value);
  return value;
}
function target(id = "victim", owner = "attacker") {
  const document = { uuid: `Scene.scene.Token.${id}`, name: id, actor: actor(id, owner) };
  const token = { id, document, actor: document.actor };
  documents.set(document.uuid, document);
  return token;
}
function weapon({ damage = true, effects = true } = {}) {
  const value = { uuid: "Actor.source.Item.weapon", name: "Клинок", type: "weapon", system: {
    damage: { parts: damage ? [{ formula: "1d6", category: "typed", damageType: "slashing" }] : [] }
  }, activeEffects: effects ? [{ name: "Горение", flags: { ParovGrad: { modifiers: [{ target: "will", value: -2 }] } } }] : [] };
  documents.set(value.uuid, value);
  return value;
}
async function attack({ hit = true, targetOwner = "attacker", ...weaponOptions } = {}) {
  const source = actor("source");
  const victim = target("victim", targetOwner);
  const physical = weapon(weaponOptions);
  game.user.targets = new Set([victim]);
  rollTotals.push(hit ? 15 : 5, hit ? 10 : 20);
  await startItemAttack({ actor: source, item: physical });
  return { source, victim, physical, message: messages[0] };
}
const byType = type => messages.filter(message => message.getFlag("ParovGrad", "cardType") === type);

test("a successful defense resolution applies frozen active effects to the attack target without a damage dialog", async () => {
  reset();
  const { victim, physical, message } = await attack();
  physical.activeEffects[0].name = "Изменённый эффект";
  game.user.targets = new Set([target("another")]);
  await handleDefenseButtonClick(message);
  assert.equal(damageDialogs.length, 0);
  assert.equal(damageRolls.length, 0);
  assert.equal(byType("damage").length, 0);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].actor, victim.actor);
  assert.equal(applications[0].data[0].name, "Горение");
  assert.equal(victim.actor.system.health.value, 20);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("effects still apply when the successful weapon has no damage configured", async () => {
  reset();
  const { victim, message } = await attack({ damage: false });
  await handleDefenseButtonClick(message);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].actor, victim.actor);
  assert.equal(damageDialogs.length, 0);
  assert.equal(byType("defense-result").length, 1);
});

test("an unresolved or missed attack cannot open damage or apply active effects", async () => {
  reset();
  const { message } = await attack({ hit: false });
  await handleAttackDamageButtonClick(message);
  assert.equal(damageDialogs.length, 0);
  await handleDefenseButtonClick(message);
  await handleAttackDamageButtonClick(message);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 0);
  assert.equal(damageDialogs.length, 0);
  assert.equal(byType("damage").length, 0);
});

test("explicit damage action opens the dialog and creates one damage card for the original target", async () => {
  reset();
  const { victim, message } = await attack({ effects: false });
  await handleDefenseButtonClick(message);
  assert.equal(damageDialogs.length, 0);
  game.user.targets = new Set([target("another")]);
  await handleAttackDamageButtonClick(message);
  assert.equal(damageDialogs.length, 1);
  assert.equal(damageRolls.length, 1);
  assert.equal(byType("damage").length, 1);
  assert.equal(byType("damage")[0].getFlag("ParovGrad", "damage.targetTokenUuid"), victim.document.uuid);
  assert.match(byType("damage")[0].content, /data-action="apply-damage"/);
  assert.equal(victim.actor.system.health.value, 20);
  await handleAttackDamageButtonClick(message);
  assert.equal(damageDialogs.length, 1);
  assert.equal(byType("damage").length, 1);
});

test("damage uses its attack snapshot even when the source item changes or disappears", async () => {
  reset();
  const { physical, message } = await attack({ effects: false });
  physical.system.damage.parts[0] = { formula: "9d20", category: "typed", damageType: "fire" };
  documents.delete(physical.uuid);
  await handleDefenseButtonClick(message);
  await handleAttackDamageButtonClick(message);
  assert.equal(damageRolls.length, 1);
  assert.deepEqual(damageRolls[0].parts, [{ formula: "1d6", category: "typed", damageType: "slashing" }]);
});

test("damage actions stay hidden before defense and become available after a hit without opening a dialog", async () => {
  reset();
  const { message } = await attack({ effects: false });
  const button = { hidden: false, disabled: false, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
  const html = { querySelector: selector => selector.includes("roll-attack-damage") ? button : null };
  await renderAttackChatButtons(message, html);
  assert.equal(button.hidden, true);
  assert.equal(damageDialogs.length, 0);
  await handleDefenseButtonClick(message);
  await renderAttackChatButtons(message, html);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(damageDialogs.length, 0);
  await button.listeners.click({ preventDefault() {} });
  assert.equal(damageDialogs.length, 1);
  assert.equal(byType("damage").length, 1);
  assert.equal(button.disabled, true);
});

test("cancelling the explicit damage dialog permits retry while effects remain applied only once", async () => {
  reset();
  const { message } = await attack();
  await handleDefenseButtonClick(message);
  let count = 0;
  attackMocks.damageDialog = async options => {
    damageDialogs.push(options);
    return ++count === 1 ? null : { useInspiration: false };
  };
  await handleAttackDamageButtonClick(message);
  assert.equal(byType("damage").length, 0);
  await handleAttackDamageButtonClick(message);
  assert.equal(damageDialogs.length, 2);
  assert.equal(byType("damage").length, 1);
  assert.equal(applications.length, 1);
});

test("overlapping explicit damage clicks share one dialog and one damage card", async () => {
  reset();
  const { message } = await attack({ effects: false });
  await handleDefenseButtonClick(message);
  let release;
  attackMocks.damageDialog = async options => {
    damageDialogs.push(options);
    return new Promise(resolve => { release = resolve; });
  };
  const first = handleAttackDamageButtonClick(message);
  await handleAttackDamageButtonClick(byType("defense-result")[0]);
  assert.equal(damageDialogs.length, 1);
  release({ useInspiration: false });
  await first;
  assert.equal(damageRolls.length, 1);
  assert.equal(byType("damage").length, 1);
});

test("a target owner resolves another player's attack and applies its effects without writing that player's card", async () => {
  reset();
  const { victim, message } = await attack({ targetOwner: "defender" });
  game.user.id = "defender";
  await handleDefenseButtonClick(message);
  assert.equal(forbiddenWrites, 0);
  assert.equal(byType("defense-result").length, 1);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].actor, victim.actor);
  assert.equal(damageDialogs.length, 0);
  const defenseCount = d20Dialogs.length;
  await handleDefenseButtonClick(message);
  assert.equal(d20Dialogs.length, defenseCount);
  assert.equal(applications.length, 1);
  game.user.id = "attacker";
  await handleAttackDamageButtonClick(byType("defense-result")[0]);
  assert.equal(damageDialogs.length, 1);
  assert.equal(byType("damage").length, 1);
  assert.equal(byType("damage")[0].getFlag("ParovGrad", "damage.targetTokenUuid"), victim.document.uuid);
});

test("automatic result effects and an overlapping original-card click share one application", async () => {
  reset();
  const { message } = await attack();
  const applySnapshot = attackMocks.apply;
  let calls = 0;
  let release;
  let started;
  const applicationStarted = new Promise(resolve => { started = resolve; });
  const applicationReleased = new Promise(resolve => { release = resolve; });
  attackMocks.apply = async (...args) => {
    calls++;
    started();
    await applicationReleased;
    return applySnapshot(...args);
  };
  const automaticResolution = handleDefenseButtonClick(message);
  await applicationStarted;
  assert.equal(byType("defense-result").length, 1);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(calls, 1);
  release();
  await automaticResolution;
  assert.equal(applications.length, 1);
  await handleApplyItemEffectsButtonClick(byType("defense-result")[0]);
  assert.equal(calls, 1);
});

test("owning only the target cannot open the attacker's damage dialog after a hit", async () => {
  reset();
  const { message } = await attack({ targetOwner: "defender", effects: false });
  game.user.id = "defender";
  await handleDefenseButtonClick(message);
  await handleAttackDamageButtonClick(message);
  await handleAttackDamageButtonClick(byType("defense-result")[0]);
  assert.equal(damageDialogs.length, 0);
  assert.equal(damageRolls.length, 0);
  assert.equal(byType("damage").length, 0);
  assert.equal(forbiddenWrites, 0);
  const button = { hidden: false, disabled: false, addEventListener() {} };
  await renderAttackChatButtons(byType("defense-result")[0], {
    querySelector: selector => selector.includes("roll-attack-damage") ? button : null
  });
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
});
