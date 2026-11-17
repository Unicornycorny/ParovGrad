import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const dependencies = {
  "../damage/damage-types.js": `
    export const getItemDamageParts = () => [{formula: "1d6"}];
    export const rollDamageParts = () => { throw new Error("Cancelled damage dialog must not roll"); };
    export const serializeDamageResults = parts => parts;
    export const damageResultsHtml = () => "";
    export const applyTypedDamage = () => { throw new Error("No damage application expected"); };
  `,
  "../dice/roll-dialog.js": `
    export const consumeActorInspiration = async () => true;
    export const openConfiguredD20RollDialog = async () => globalThis.skillAnimationMocks.rollConfig;
    export const openConfiguredDamageRollDialog = async () => null;
  `,
  "../canvas/spell-template.js": `
    export const placeSpellTemplate = async () => globalThis.skillAnimationMocks.placement;
  `
};
let source = await readFile(new URL("../module/workflows/skill-area-attack.js", import.meta.url), "utf8");
for (const [path, dependency] of Object.entries(dependencies)) {
  source = source.replace(JSON.stringify(path), JSON.stringify(moduleUrl(dependency)));
}
const { startMassSkillAttack, renderMassSkillChatButtons } = await import(moduleUrl(source));

let messages, order, visuals, contexts, documents, totals;
const actor = { uuid: "Actor.source", name: "Источник" };
const item = { uuid: "Actor.source.Item.skill", name: "Область", system: {} };
const sourceToken = { uuid: "Scene.scene.Token.source" };
function getPath(object, path) {
  return path.split(".").reduce((value, part) => value?.[part], object);
}
function reset() {
  messages = []; order = []; visuals = []; contexts = []; documents = new Map(); totals = [15];
  globalThis.foundry = { utils: { deepClone: structuredClone, escapeHTML: String } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, CHAT_MESSAGE_STYLES: { ROLL: 5 } };
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.fromUuid = async uuid => documents.get(uuid);
  documents.set(item.uuid, item);
  documents.set(actor.uuid, actor);
  globalThis.game = { user: { id: "user", isGM: true }, parovgrad: {
    dice: { createRoll() { const total = totals.shift() ?? 10; return { total, formula: "1d20",
      async evaluate() {}, toJSON() { return { total }; } }; } },
    animations: {
      createContext(options) {
        assert.equal(options.templateDocument.deleted, false);
        contexts.push(options);
        return { useId: "area-use", sourceTokenUuid: options.sourceToken?.uuid ?? null,
          template: structuredClone(options.templateDocument.geometry) };
      },
      async play(event) {
        assert.equal(messages.length, 1);
        order.push(event.phase);
        visuals.push(structuredClone(event));
      }
    }
  } };
  globalThis.ChatMessage = {
    getSpeaker: () => ({ actor: actor.uuid }),
    async create(data) {
      order.push("message");
      const message = { ...structuredClone(data), id: "message", uuid: "ChatMessage.message",
        getFlag(scope, path) { return getPath(this.flags[scope], path); },
        async update(patch) {
          order.push("update");
          for (const [path, value] of Object.entries(patch)) {
            const parts = path.split(".");
            const last = parts.pop();
            let parent = this;
            for (const part of parts) parent = parent[part] ??= {};
            parent[last] = structuredClone(value);
          }
        }
      };
      messages.push(message);
      return message;
    }
  };
  const templateDocument = { id: "template", deleted: false,
    geometry: { x: 100, y: 200, t: "cone", direction: 45, distance: 30, angle: 90 },
    parent: { async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "MeasuredTemplate");
      assert.deepEqual(ids, ["template"]);
      templateDocument.deleted = true;
      templateDocument.geometry = null;
      order.push("cleanup");
    } }
  };
  const targets = ["first", "second"].map(id => {
    const document = { uuid: `Scene.scene.Token.${id}`, name: id, actor: { testUserPermission: () => true } };
    documents.set(document.uuid, document);
    return { document };
  });
  globalThis.skillAnimationMocks = { placement: { templateDocument, targets },
    rollConfig: { mode: "normal", modifier: 0, useInspiration: false } };
}
function defenseButton(index) {
  return { dataset: { action: "mass-skill-defense", target: String(index) },
    addEventListener(type, callback) { this.listener = callback; },
    async click() { await this.listener({ preventDefault() {} }); }
  };
}

test("area skill snapshots its placement before cleanup and starts only after the card exists", async () => {
  reset();
  await startMassSkillAttack({ actor, item, sourceToken });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].sourceToken, sourceToken);
  assert.deepEqual(order, ["message", "use", "cleanup"]);
  assert.equal(skillAnimationMocks.placement.templateDocument.deleted, true);
  assert.deepEqual(messages[0].getFlag("ParovGrad", "massSkillAttack.animation.template"), {
    x: 100, y: 200, t: "cone", direction: 45, distance: 30, angle: 90
  });
  assert.deepEqual(visuals[0].targetTokenUuids, ["Scene.scene.Token.first", "Scene.scene.Token.second"]);
});

test("area skill resolves visuals per original target after cleanup without replay on render or retry", async () => {
  reset();
  await startMassSkillAttack({ actor, item, sourceToken });
  totals.push(10, 20);
  const buttons = [defenseButton(0), defenseButton(1)];
  const html = { querySelectorAll: () => buttons };
  renderMassSkillChatButtons(messages[0], html);
  assert.equal(visuals.length, 1);
  await buttons[0].click();
  await buttons[1].click();
  assert.deepEqual(visuals.map(event => [event.phase, event.targetTokenUuids]), [
    ["use", ["Scene.scene.Token.first", "Scene.scene.Token.second"]],
    ["hit", ["Scene.scene.Token.first"]], ["miss", ["Scene.scene.Token.second"]]
  ]);
  assert.deepEqual(order, ["message", "use", "cleanup", "update", "hit", "update", "miss"]);
  assert.deepEqual(visuals[1].context, visuals[0].context);
  renderMassSkillChatButtons(messages[0], html);
  await buttons[0].click();
  await buttons[1].click();
  assert.equal(visuals.length, 3);
});

test("cancelled placement or attack never creates an area animation", async () => {
  reset();
  const placement = skillAnimationMocks.placement;
  skillAnimationMocks.placement = null;
  await startMassSkillAttack({ actor, item, sourceToken });
  assert.deepEqual(order, []);
  skillAnimationMocks.placement = placement;
  skillAnimationMocks.rollConfig = null;
  await startMassSkillAttack({ actor, item, sourceToken });
  assert.deepEqual(order, ["cleanup"]);
  assert.equal(messages.length, 0);
  assert.equal(contexts.length, 0);
  assert.equal(visuals.length, 0);
});

test("area skills still work without an installed animation service", async () => {
  reset();
  delete game.parovgrad.animations;
  await startMassSkillAttack({ actor, item, sourceToken });
  assert.equal(messages.length, 1);
  assert.equal(skillAnimationMocks.placement.templateDocument.deleted, true);
  assert.deepEqual(order, ["message", "cleanup"]);
});
