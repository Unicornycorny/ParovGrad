import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const dependencies = {
  "../damage/damage-types.js": `
    export const makeDamagePart = formula => ({formula});
    export const rollDamageParts = async parts => {
      const roll = globalThis.spellAnimationMocks.roll(6);
      return { primaryRoll: roll, total: 6, results: [{amount: 6, roll}] };
    };
    export const serializeDamageResults = results => results.map(({roll, ...part}) => part);
    export const damageResultsHtml = () => "6 урона";
    export const applyTypedDamage = async () => { throw new Error("Unexpected damage application"); };
  `,
  "../dice/roll-dialog.js": `
    export const openConfiguredD20RollDialog = async () => globalThis.spellAnimationMocks.dialogs.shift();
    export const consumeActorInspiration = async () => globalThis.spellAnimationMocks.inspiration;
  `,
  "../magic/spell-effects.js": `
    export const SPELL_EFFECT_TYPES = {DAMAGE: "damage", HEALING: "healing"};
    export const SPELL_EFFECT_TYPE_LABELS = {damage: "Урон", healing: "Лечение"};
    export const getSpellEffects = item => item.system.effects;
    export const isValidSpellRollFormula = formula => !!formula && formula !== "invalid";
  `,
  "../canvas/spell-template.js": `
    export const hasSpellTemplate = item => !!item.system.template;
    export const placeSpellTemplate = async () => globalThis.spellAnimationMocks.placement;
  `
};
let source = await readFile(new URL("../module/workflows/spell-use.js", import.meta.url), "utf8");
for (const [path, replacement] of Object.entries(dependencies)) source = source.replace(`"${path}"`, JSON.stringify(dataUrl(replacement)));
const { startSpellUse, handleSpellDefenseButtonClick, handleApplySpellEffectButtonClick, renderSpellChatButtons } = await import(dataUrl(source));

let documents, messages, contexts, plays, serial;
const config = {mode: "normal", modifier: 0, useInspiration: false};
const damage = {type: "damage", label: "Урон", formula: "1d6"};
const healing = {type: "healing", label: "Лечение", formula: "1d6"};
function getPath(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) {
  const keys = path.split(".");
  const leaf = keys.pop();
  for (const key of keys) object = object[key] ??= {};
  object[leaf] = structuredClone(value);
}
function reset() {
  documents = new Map(); messages = []; contexts = []; plays = []; serial = 0;
  globalThis.spellAnimationMocks = {
    dialogs: [config], totals: [15], inspiration: true, placement: null,
    roll(total) { return {total, async evaluate() { return this; }, async render() { return "<roll/>"; }, toJSON() { return {total}; }}; }
  };
  globalThis.game = { user: {id: "owner", isGM: true, targets: new Set()}, parovgrad: {
    dice: {createRoll: formula => spellAnimationMocks.roll(formula.includes("20") ? spellAnimationMocks.totals.shift() : 6)},
    animations: {
      createContext({actor, item, sourceToken, templateDocument}) {
        if (templateDocument) assert.equal(templateDocument.deleted, false, "snapshot precedes template cleanup");
        const context = {useId: `use-${contexts.length}`, actorUuid: actor.uuid,
          sourceTokenUuid: sourceToken?.document?.uuid ?? null, sceneUuid: "Scene.battle",
          preset: structuredClone(item.flags?.ParovGrad?.animation ?? {}),
          template: templateDocument ? {x: templateDocument.x, y: templateDocument.y, t: templateDocument.t} : null};
        contexts.push(context);
        return context;
      },
      async play(event) { plays.push(structuredClone(event)); }
    }
  }};
  globalThis.foundry = {utils: {deepClone: structuredClone}};
  globalThis.CONST = {DOCUMENT_OWNERSHIP_LEVELS: {OWNER: 3}, CHAT_MESSAGE_STYLES: {ROLL: 1, OTHER: 0}};
  globalThis.ui = {notifications: {warn() {}, info() {}, error() {}}};
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.ChatMessage = {
    getSpeaker: ({actor}) => ({actor: actor.uuid}),
    async create(data) {
      const message = {id: `message-${++serial}`, ...data,
        getFlag(scope, path) { return getPath(this.flags?.[scope], path); },
        async setFlag(scope, path, value) { setPath(this.flags[scope], path, value); },
        async update(patch) { for (const [path, value] of Object.entries(patch)) setPath(this, path, value); }};
      message.rolls = [];
      messages.push(message);
      return message;
    }
  };
}
function actor(id) {
  const result = {uuid: `Actor.${id}`, name: id, system: {health: {value: 10, max: 30}},
    testUserPermission() { return true; }, getRollData() { return {}; },
    async update(patch) { for (const [path, value] of Object.entries(patch)) setPath(this, path, value); }};
  documents.set(result.uuid, result);
  return result;
}
function token(id) {
  const document = {uuid: `Scene.battle.Token.${id}`, name: id, actor: actor(id)};
  const result = {document, actor: document.actor};
  document.object = result;
  documents.set(document.uuid, document);
  return result;
}
function spell(effects = [damage], area = false) {
  const result = {uuid: "Item.spell", type: "spell", name: "Заклинание",
    system: {effects: structuredClone(effects), template: area}, flags: {ParovGrad: {animation: {presetId: "fire"}}}};
  documents.set(result.uuid, result);
  return result;
}
function byType(type) { return messages.filter(message => message.getFlag("ParovGrad", "cardType") === type); }
function placement(targets) {
  const templateDocument = {id: "area", uuid: "Scene.battle.MeasuredTemplate.area", x: 100, y: 200, t: "circle", deleted: false};
  templateDocument.parent = {async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "MeasuredTemplate"); assert.deepEqual(ids, ["area"]); templateDocument.deleted = true;
  }};
  spellAnimationMocks.placement = {templateDocument, targets};
  return templateDocument;
}
async function massDefense(message, index) {
  const button = {dataset: {action: "mass-spell-defense", targetIndex: String(index)}, isConnected: true,
    addEventListener(type, callback) { this.callback = callback; }};
  renderSpellChatButtons(message, {querySelectorAll: () => [button]});
  await button.callback({preventDefault() {}});
}

test("single spell snapshots its source and preset once, then plays hit only after defense and carries context to effect cards", async () => {
  reset();
  const caster = actor("caster"), sourceToken = token("caster-token"), target = token("target"), item = spell();
  game.user.targets.add(target);
  await startSpellUse({actor: caster, item, sourceToken});
  const attack = byType("spell-attack")[0];
  assert.equal(contexts.length, 1);
  assert.equal(attack.getFlag("ParovGrad", "spellAttack.animation.sourceTokenUuid"), sourceToken.document.uuid);
  assert.deepEqual(plays.map(event => event.phase), ["use"]);
  item.flags.ParovGrad.animation.presetId = "changed";
  spellAnimationMocks.dialogs.push(config); spellAnimationMocks.totals.push(10);
  await handleSpellDefenseButtonClick(attack);
  await handleSpellDefenseButtonClick(attack);
  assert.deepEqual(plays.map(event => event.phase), ["use", "hit"]);
  assert.deepEqual(plays[1].targetTokenUuids, [target.document.uuid]);
  assert.equal(plays[1].context.preset.presetId, "fire");
  assert.equal(byType("spell-effect")[0].getFlag("ParovGrad", "spellEffect.animation.useId"), contexts[0].useId);
});

test("a defended single spell plays miss once and creates no damage effect", async () => {
  reset();
  const caster = actor("caster"), target = token("target"), item = spell();
  game.user.targets.add(target);
  await startSpellUse({actor: caster, item});
  spellAnimationMocks.dialogs.push(config); spellAnimationMocks.totals.push(20);
  await handleSpellDefenseButtonClick(byType("spell-attack")[0]);
  assert.deepEqual(plays.map(event => event.phase), ["use", "miss"]);
  assert.equal(byType("spell-effect").length, 0);
});

test("mass spell preserves its area before cleanup and resolves each target independently", async () => {
  reset();
  const caster = actor("caster"), targets = [token("one"), token("two")], item = spell([damage], true);
  const template = placement(targets);
  await startSpellUse({actor: caster, item});
  const mass = byType("spell-mass-attack")[0];
  assert.equal(template.deleted, true);
  assert.equal(contexts.length, 1);
  assert.deepEqual(mass.getFlag("ParovGrad", "spellMassAttack.animation.template"), {x: 100, y: 200, t: "circle"});
  assert.deepEqual(plays[0].targetTokenUuids, targets.map(target => target.document.uuid));
  spellAnimationMocks.dialogs.push(config, config); spellAnimationMocks.totals.push(10, 20);
  await massDefense(mass, 0); await massDefense(mass, 1); await massDefense(mass, 0);
  assert.deepEqual(plays.map(event => event.phase), ["use", "hit", "miss"]);
  assert.deepEqual(plays.slice(1).map(event => event.targetTokenUuids), targets.map(target => [target.document.uuid]));
});

test("healing casts play use once and heal only for committed health restoration, with distinct repeated effect events", async () => {
  reset();
  const caster = actor("caster"), target = token("target"), item = spell([healing, healing]);
  game.user.targets.add(target);
  await startSpellUse({actor: caster, item});
  const cards = byType("spell-effect");
  assert.equal(contexts.length, 1);
  assert.equal(cards.length, 2);
  assert.deepEqual(plays.map(event => event.phase), ["use"]);
  await handleApplySpellEffectButtonClick(cards[0], "healing");
  await handleApplySpellEffectButtonClick(cards[0], "healing");
  await handleApplySpellEffectButtonClick(cards[1], "healing");
  assert.equal(target.actor.system.health.value, 22);
  assert.deepEqual(plays.map(event => event.phase), ["use", "heal", "heal"]);
  assert.notEqual(plays[1].eventId, plays[2].eventId);
});

test("mixed area shares one cast context across healing cards and the mass attack", async () => {
  reset();
  const caster = actor("caster"), targets = [token("one"), token("two")], item = spell([damage, healing], true);
  placement(targets);
  await startSpellUse({actor: caster, item});
  assert.equal(contexts.length, 1);
  assert.deepEqual(plays.map(event => event.phase), ["use"]);
  assert.equal(byType("spell-mass-attack").length, 1);
  for (const card of byType("spell-effect")) {
    assert.equal(card.getFlag("ParovGrad", "spellEffect.animation.useId"), contexts[0].useId);
    await handleApplySpellEffectButtonClick(card, "healing");
  }
  assert.deepEqual(plays.map(event => event.phase), ["use", "heal", "heal"]);
});

test("cancelled placement, cancelled mixed attack and invalid effects create no animation or partial healing cards", async () => {
  for (const reason of ["placement", "dialog", "invalid", "inspiration"]) {
    reset();
    const caster = actor("caster"), target = token("target");
    const item = spell([damage, healing], reason === "placement");
    game.user.targets.add(target);
    if (reason === "dialog") spellAnimationMocks.dialogs = [null];
    if (reason === "invalid") item.system.effects[0].formula = "invalid";
    if (reason === "inspiration") { spellAnimationMocks.dialogs = [{...config, useInspiration: true}]; spellAnimationMocks.inspiration = false; }
    await startSpellUse({actor: caster, item});
    assert.equal(contexts.length, 0, reason);
    assert.equal(plays.length, 0, reason);
    assert.equal(messages.length, 0, reason);
  }
});

test("informational casts and empty areas still play their use exactly once", async () => {
  for (const emptyArea of [false, true]) {
    reset();
    const caster = actor("caster"), item = spell(emptyArea ? [damage] : [], emptyArea);
    if (emptyArea) placement([]);
    await startSpellUse({actor: caster, item});
    assert.equal(contexts.length, 1);
    assert.deepEqual(plays.map(event => event.phase), ["use"]);
    assert.deepEqual(plays[0].targetTokenUuids, []);
    assert.equal(byType("spell-use")[0].getFlag("ParovGrad", "spellUse.animation.useId"), contexts[0].useId);
  }
});

test("a healing action at full health has no heal animation and missing animation API preserves spell mechanics", async () => {
  reset();
  const caster = actor("caster"), target = token("target"), item = spell([healing]);
  target.actor.system.health.value = 30;
  game.user.targets.add(target);
  await startSpellUse({actor: caster, item});
  await handleApplySpellEffectButtonClick(byType("spell-effect")[0], "healing");
  assert.deepEqual(plays.map(event => event.phase), ["use"]);
  delete game.parovgrad.animations;
  await startSpellUse({actor: caster, item});
  assert.equal(byType("spell-effect").length, 2);
  assert.equal(byType("spell-effect")[1].getFlag("ParovGrad", "spellEffect.animation"), null);
});
