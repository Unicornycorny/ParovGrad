import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const dependencies = {
  "../damage/damage-types.js": `
    export const getItemDamageParts = () => [];
    export const rollDamageParts = () => { throw new Error("Unexpected damage roll"); };
    export const serializeDamageResults = x => x;
    export const damageResultsHtml = () => "";
    export const applyTypedDamage = () => {};
    export const getAppliedDamage = () => null;
  `,
  "../effects/effect-utils.js": `
    export const getActiveItemEffectData = item => item.activeEffects ?? [];
    export const applyItemEffectDataToActor = (...args) => globalThis.workflowMocks.apply(...args);
  `,
  "../dice/roll-dialog.js": `
    export const consumeActorInspiration = async () => true;
    export const openConfiguredD20RollDialog = async () => ({mode: "normal", modifier: 0, useInspiration: false});
    export const openConfiguredDamageRollDialog = async () => null;
  `
};
let source = await readFile(new URL("../module/workflows/weapon-attack.js", import.meta.url), "utf8");
for (const [path, dependency] of Object.entries(dependencies)) {
  source = source.replace(JSON.stringify(path), JSON.stringify(moduleUrl(dependency)));
}
const { startItemUse, startItemAttack, handleDefenseButtonClick,
  handleApplyItemEffectsButtonClick, renderAttackChatButtons } = await import(moduleUrl(source));

let messages, applications, documents, warnings, serial, rollTotals;
async function applySnapshot(actor, data, options) {
  applications.push({ actor, data: structuredClone(data), options });
  const created = data.map((effect, index) => ({ ...structuredClone(effect), flags: {
    ...structuredClone(effect.flags ?? {}),
    ParovGrad: { ...structuredClone(effect.flags?.ParovGrad ?? {}),
      applicationId: options.applicationId, applicationIndex: index }
  } }));
  actor.effects.push(...created);
  return created;
}
function setPath(object, path, value) {
  const parts = path.split(".");
  let parent = object;
  for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
  parent[parts.at(-1)] = value;
}
function getPath(object, path) {
  return path.split(".").reduce((value, part) => value?.[part], object);
}
function reset() {
  messages = []; applications = []; warnings = []; documents = new Map(); serial = 0; rollTotals = [];
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, CHAT_MESSAGE_STYLES: { ROLL: 5, OTHER: 0 } };
  globalThis.ui = { notifications: { warn: text => warnings.push(text), info() {}, error: text => warnings.push(text) } };
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.canvas = { tokens: { get() { return null; } } };
  globalThis.workflowMocks = { apply: applySnapshot };
  globalThis.game = { user: { id: "source-owner", isGM: false, targets: new Set() }, parovgrad: { dice: {
    createRoll() {
      const total = rollTotals.shift() ?? 10;
      return { total, async evaluate() {}, async render() { return "<p>roll</p>"; }, toJSON() { return { total }; } };
    }
  } } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.uuid }),
    async create(data) {
      const message = {
        ...structuredClone(data), id: `message-${++serial}`, uuid: `ChatMessage.message-${serial}`,
        canUserModify(user, action) { return action === "update" && (user.isGM || user.id === this.user); },
        getFlag(scope, path) { return getPath(this.flags[scope], path); },
        async setFlag(scope, path, value) {
          if (!this.canUserModify(game.user, "update")) throw new Error("Message permission denied");
          setPath(this.flags[scope], path, value);
        }
      };
      messages.push(message);
      return message;
    }
  };
}
function actor(id, owner = "source-owner") {
  const value = { uuid: `Actor.${id}`, name: id, effects: [], testUserPermission: user => user.id === owner };
  documents.set(value.uuid, value);
  return value;
}
function target(id, owner = "source-owner") {
  const document = { uuid: `Scene.scene.Token.${id}`, name: id, actor: actor(id, owner) };
  const token = { id, document, actor: document.actor };
  documents.set(document.uuid, document);
  return token;
}
function item(type = "item", effects = [{ name: "Усиление", flags: { ParovGrad: { modifiers: [{ target: "will", value: 2 }] } } }]) {
  const value = { uuid: "Actor.source.Item.item", name: "Амулет", type, system: { description: "Описание" }, activeEffects: effects };
  documents.set(value.uuid, value);
  return value;
}
function effectButton() {
  return { hidden: false, disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
}

test("legacy item use stays untargeted and retains its range-check action", async () => {
  reset();
  const source = actor("source");
  const physical = item("item", []);
  physical.system.effectCheckDie = "d6";
  physical.system.effectRanges = [{ from: 1, to: 6, effect: "Сияние" }];
  const message = await startItemUse({ actor: source, item: physical });
  assert.equal(messages.length, 1);
  assert.equal(applications.length, 0);
  assert.match(message.content, /roll-item-effect/);
  assert.equal(message.flags.ParovGrad.itemUse.targetTokenUuid, null);
});

test("active effects require one target with an actor before creating a use card", async () => {
  reset();
  const source = actor("source");
  const physical = item();
  await startItemUse({ actor: source, item: physical });
  game.user.targets = new Set([target("a"), target("b")]);
  await startItemUse({ actor: source, item: physical });
  game.user.targets = new Set([{ document: { uuid: "Scene.scene.Token.empty" } }]);
  await startItemUse({ actor: source, item: physical });
  assert.equal(messages.length, 0);
  assert.equal(applications.length, 0);
  assert.equal(warnings.length, 3);
});

test("a target owner applies active effects automatically with once-only status", async () => {
  reset();
  const source = actor("source");
  const victim = target("target");
  game.user.targets.add(victim);
  const message = await startItemUse({ actor: source, item: item() });
  assert.equal(applications.length, 1);
  assert.equal(applications[0].actor, victim.actor);
  assert.equal(applications[0].options.applicationId, message.uuid);
  assert.equal(message.flags.ParovGrad.itemUse.activeEffectsApplied, true);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("source ownership cannot change another target; later GM uses frozen target and effects", async () => {
  reset();
  const source = actor("source");
  const victim = target("victim", "target-owner");
  const physical = item();
  game.user.targets.add(victim);
  const message = await startItemUse({ actor: source, item: physical });
  assert.equal(applications.length, 0);
  const button = effectButton();
  await renderAttackChatButtons(message, { querySelector: selector => selector.includes("apply-item-effects") ? button : null });
  assert.equal(button.disabled, true);
  assert.equal(button.hidden, false);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 0);
  physical.activeEffects[0].name = "Изменённый эффект";
  documents.delete(physical.uuid);
  game.user.targets = new Set([target("different")]);
  game.user.isGM = true;
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].actor, victim.actor);
  assert.equal(applications[0].data[0].name, "Усиление");
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("weapon effects stay unavailable until a successful attack, including weapons without damage", async () => {
  reset();
  const source = actor("source");
  const victim = target("victim");
  const physical = item("weapon");
  game.user.targets.add(victim);
  rollTotals.push(15, 10);
  await startItemAttack({ actor: source, item: physical });
  const attack = messages[0];
  const button = effectButton();
  const html = { querySelector: selector => selector.includes("apply-item-effects") ? button : null };
  await renderAttackChatButtons(attack, html);
  assert.equal(button.hidden, true);
  await handleApplyItemEffectsButtonClick(attack);
  assert.equal(applications.length, 0);
  physical.activeEffects[0].name = "Changed";
  await handleDefenseButtonClick(attack);
  assert.equal(attack.flags.ParovGrad.attack.success, true);
  await renderAttackChatButtons(attack, html);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(applications.length, 1);
  assert.equal(button.textContent, "Активные эффекты применены");
  await handleApplyItemEffectsButtonClick(attack);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].data[0].name, "Усиление");
});

test("failed attacks never apply attached active effects", async () => {
  reset();
  const source = actor("source");
  game.user.targets.add(target("victim"));
  rollTotals.push(5, 20);
  await startItemAttack({ actor: source, item: item("weapon") });
  const attack = messages[0];
  await handleDefenseButtonClick(attack);
  assert.equal(attack.flags.ParovGrad.attack.success, false);
  await handleApplyItemEffectsButtonClick(attack);
  assert.equal(applications.length, 0);
});

test("overlapping effect clicks make one application", async () => {
  reset();
  const source = actor("source");
  game.user.targets.add(target("victim", "target-owner"));
  const message = await startItemUse({ actor: source, item: item() });
  game.user.id = "target-owner";
  let release;
  workflowMocks.apply = async (...args) => {
    const created = await applySnapshot(...args);
    await new Promise(resolve => { release = resolve; });
    return created;
  };
  const pending = handleApplyItemEffectsButtonClick(message);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
  release();
  await pending;
  assert.equal(message.flags.ParovGrad.itemUse.activeEffectsApplied, false);
  const button = effectButton();
  await renderAttackChatButtons(message, { querySelector: selector => selector.includes("apply-item-effects") ? button : null });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Активные эффекты применены");
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("an unsuccessful application leaves the card available for retry", async () => {
  reset();
  const source = actor("source");
  game.user.targets.add(target("victim", "target-owner"));
  const message = await startItemUse({ actor: source, item: item() });
  game.user.id = "target-owner";
  workflowMocks.apply = async () => { throw new Error("Временная ошибка"); };
  const originalError = console.error;
  try {
    console.error = () => {};
    await handleApplyItemEffectsButtonClick(message);
  } finally {
    console.error = originalError;
  }
  assert.equal(message.flags.ParovGrad.itemUse.activeEffectsApplied, false);
  assert.match(warnings.at(-1), /Временная ошибка/);
  workflowMocks.apply = applySnapshot;
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
  assert.equal(message.flags.ParovGrad.itemUse.activeEffectsApplied, false);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("target ownership applies another author's card without attempting a forbidden chat write", async () => {
  reset();
  const source = actor("source");
  game.user.targets.add(target("victim", "target-owner"));
  const message = await startItemUse({ actor: source, item: item() });
  let flagWrites = 0;
  message.setFlag = async () => { flagWrites++; throw new Error("Message permission denied"); };
  game.user.id = "target-owner";
  assert.equal(message.canUserModify(game.user, "update"), false);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
  assert.equal(flagWrites, 0);
  assert.equal(warnings.length, 0);
  // A fresh render reads the application markers on the target, even with the chat flag unchanged.
  const button = effectButton();
  await renderAttackChatButtons(message, { querySelector: selector => selector.includes("apply-item-effects") ? button : null });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Активные эффекты применены");
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});

test("effects remain successfully applied if an authorized chat status write fails", async () => {
  reset();
  const source = actor("source");
  game.user.targets.add(target("victim", "target-owner"));
  const message = await startItemUse({ actor: source, item: item() });
  game.user.isGM = true;
  message.setFlag = async () => { throw new Error("Chat disconnected"); };
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    await handleApplyItemEffectsButtonClick(message);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(applications.length, 1);
  assert.equal(warnings.length, 0);
  await handleApplyItemEffectsButtonClick(message);
  assert.equal(applications.length, 1);
});
