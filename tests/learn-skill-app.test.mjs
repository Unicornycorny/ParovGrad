import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sources = new Map();
const hooks = new Map();
const warnings = [];
let serial = 0;
globalThis.Hooks = {
  on(name, callback) { const id = ++serial; hooks.set(id, { name, callback }); return id; },
  off(_name, id) { hooks.delete(id); },
  callAll(name, ...args) { for (const entry of hooks.values()) if (entry.name === name) entry.callback(...args); }
};
globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
globalThis.game = { user: { isGM: false }, items: [] };
class ApplicationV2 {
  constructor(options) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
  async render() { this.rendered = true; this.context = await this._prepareContext({}); return this; }
  async close() { this._onClose({}); this.rendered = false; }
  _onClose() {}
}
globalThis.foundry = {
  utils: { fromUuid: async (uuid) => sources.get(uuid) ?? null, randomID: () => String(++serial) },
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } }
};
const helperSource = await readFile(new URL("../module/skills/skill-learning.js", import.meta.url), "utf8");
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`;
const { withActorSkillLock } = await import(helperUrl);
const appSource = (await readFile(new URL("../module/apps/learn-skill-dialog.js", import.meta.url), "utf8"))
  .replace('import { MagicTreeGraphView } from "./components/magic-tree-graph.js";', "class MagicTreeGraphView {}")
  .replace('from "../skills/skill-learning.js"', `from "${helperUrl}"`);
const { openLearnSkillFromTreeDialog } = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`);
const actor = { uuid: "Actor.player", name: "Персонаж", documentName: "Actor", type: "Player", isOwner: true, items: [], system: { level: 3, skillPoints: 2 } };

function tree(uuid, extra = {}) {
  return { uuid, name: "Древо", documentName: "Item", type: "skillTree", testUserPermission: () => true,
    system: { branches: {}, nodes: {}, milestones: {}, edges: {} }, ...extra };
}

test("explicit compendium tree opens without any world trees and releases hooks on close", async () => {
  game.items = [];
  const source = tree("Compendium.ParovGrad.trees.Item.tree", { pack: "ParovGrad.trees" });
  sources.set(source.uuid, source);
  const app = await openLearnSkillFromTreeDialog(actor, { treeUuid: source.uuid });
  assert.equal(app.context.tree, source);
  assert.equal(app.context.treeOptions[0].selected, true);
  assert.equal(hooks.size, 5);
  Hooks.callAll("deleteItem", source);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app._getTree(), null);
  assert.equal(app.context.tree, null);
  await app.close();
  assert.equal(hooks.size, 0);
});

test("an inaccessible requested tree never silently opens a different world tree", async () => {
  game.items = [tree("Item.other")];
  const hidden = tree("Item.hidden", { name: "Секретное древо", testUserPermission: () => false });
  sources.set(hidden.uuid, hidden);
  const result = await openLearnSkillFromTreeDialog(actor, { treeUuid: hidden.uuid });
  assert.equal(result, undefined);
  assert.match(warnings.at(-1), /недоступно/);
  assert.doesNotMatch(warnings.at(-1), /Секретное/);
  assert.equal(hooks.size, 0);
});

test("tree options and previews do not reveal inaccessible document names", async () => {
  const selected = tree("Item.visible");
  selected.system.nodes.a = { skillUuid: "Item.secret", level: 1 };
  game.items = [selected, tree("Item.hidden", { name: "Секретное древо", testUserPermission: () => false })];
  sources.set("Item.secret", { name: "Секретный навык", documentName: "Item", type: "skill", testUserPermission: () => false });
  const app = await openLearnSkillFromTreeDialog(actor);
  assert.equal(app.context.treeOptions.length, 1);
  assert.equal(app.context.nodes[0].missing, true);
  assert.equal(app.context.nodes[0].skillName, "Навык недоступен");
  assert.doesNotMatch(JSON.stringify(app.context.treeOptions), /Секретное/);
  await app.close();
  assert.equal(hooks.size, 0);
});

test("other open learning windows reenable automatically after a shared purchase lock", async () => {
  const selected = tree("Item.visible");
  selected.system.nodes.a = { skillUuid: "Item.allowed", level: 1 };
  game.items = [selected];
  sources.set("Item.allowed", { uuid: "Item.allowed", name: "Навык", documentName: "Item", type: "skill", system: { cost: 1 }, testUserPermission: () => true });
  const app = await openLearnSkillFromTreeDialog(actor);
  app._selectedNodeId = "a";
  await app.render();
  assert.equal(app.context.canLearn, true);
  await withActorSkillLock(actor, async () => {
    await app.render();
    assert.equal(app.context.canLearn, false);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.context.canLearn, true);
  await app.close();
  assert.equal(hooks.size, 0);
});
