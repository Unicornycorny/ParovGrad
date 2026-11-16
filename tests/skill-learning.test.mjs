import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.game = { user: { isGM: false } };
let sources = new Map();
let serial = 0;
globalThis.foundry = { utils: {
  fromUuid: async (uuid) => sources.get(uuid) ?? null,
  randomID: () => `purchase${++serial}`
} };
const moduleSource = await readFile(new URL("../module/skills/skill-learning.js", import.meta.url), "utf8");
const {
  isKnownSkill, createOwnedSkillSource, getSkillSourceKey, resolveAccessibleSkill,
  getSkillNodeLearningState, learnSkillFromTree, withActorSkillLock, isActorLearningSkill
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

function skill(id, cost = 1, extra = {}) {
  const result = {
    id, uuid: `Item.${id}`, name: id, documentName: "Item", type: "skill",
    flags: {}, system: { cost }, testUserPermission: () => true, ...extra
  };
  result.toObject = () => structuredClone({
    _id: id, folder: "folder", sort: 10, ownership: { default: 3 }, _stats: {},
    name: result.name, type: "skill", flags: result.flags, system: result.system
  });
  return result;
}

function actor(extra = {}) {
  const result = {
    uuid: `Actor.actor${++serial}`, type: "Player", isOwner: true, items: [],
    system: { level: 5, skillPoints: 5 },
    async update(patch) { this.system.skillPoints = patch["system.skillPoints"]; return this; },
    async createEmbeddedDocuments(_type, data) {
      const created = data.map((source) => ({ ...source, uuid: `Actor.actor.Item.owned${++serial}` }));
      this.items.push(...created);
      return created;
    },
    ...extra
  };
  return result;
}

function tree(nodes = { a: { skillUuid: "Item.a", level: 1 } }, edges = {}) {
  return {
    uuid: "Item.tree", type: "skillTree", documentName: "Item", testUserPermission: () => true,
    system: { nodes, edges }
  };
}

test("UUID and legacy source flags prevent duplicates without conflating names", () => {
  const source = skill("a", 2, { uuid: "Compendium.ParovGrad.skills.Item.a", pack: "ParovGrad.skills", name: "Одинаковое имя" });
  const flags = [
    { ParovGrad: { skillTreeSourceUuid: source.uuid } },
    { ParovGrad: { sourceSkillUuid: source.uuid } },
    { ParovGrad: { sourceSkillKey: "ParovGrad.skills:a" } },
    { core: { sourceId: source.uuid } }
  ];
  for (const entry of flags) assert.equal(isKnownSkill(actor({ items: [{ type: "skill", flags: entry }] }), source), true);
  assert.equal(isKnownSkill(actor({ items: [skill("b", 2, { name: source.name })] }), source), false);
  assert.equal(getSkillSourceKey(skill("a", 2, { uuid: source.uuid })), "ParovGrad.skills:a");
});

test("owned source records shared provenance and preserves source data", () => {
  const source = skill("a", 2, { flags: { other: { enabled: true } } });
  const result = createOwnedSkillSource(source, { treeUuid: "Item.tree", nodeId: "node" });
  assert.equal(result.flags.core.sourceId, source.uuid);
  assert.equal(result.flags.ParovGrad.sourceSkillUuid, source.uuid);
  assert.equal(result.flags.ParovGrad.skillTreeNodeId, "node");
  assert.equal(result.flags.other.enabled, true);
  for (const field of ["_id", "folder", "sort", "ownership", "_stats"]) assert.equal(Object.hasOwn(result, field), false);
  assert.deepEqual(source.flags, { other: { enabled: true } });
});

test("world imports and original compendium skills share identity in both directions", () => {
  const packSkill = skill("a", 2, { uuid: "Compendium.ParovGrad.skills.Item.a", pack: "ParovGrad.skills" });
  const worldSkill = skill("imported", 2, { _stats: { compendiumSource: packSkill.uuid } });
  const viaWorld = actor({ items: [createOwnedSkillSource(worldSkill)] });
  const viaPack = actor({ items: [createOwnedSkillSource(packSkill)] });
  assert.equal(isKnownSkill(viaWorld, packSkill), true);
  assert.equal(isKnownSkill(viaPack, worldSkill), true);
  assert.equal(viaWorld.items[0].flags.ParovGrad.sourceSkillUuid, worldSkill.uuid);
  assert.equal(viaWorld.items[0].flags.core.sourceId, packSkill.uuid);
});

test("level, all incoming requirements and skill points gate learning", () => {
  const documents = new Map(["a", "b", "c"].map((id) => [`Item.${id}`, skill(id, 3)]));
  const skillTree = tree({
    a: { skillUuid: "Item.a", level: 1 }, b: { skillUuid: "Item.b", level: 1 },
    c: { skillUuid: "Item.c", level: 5 }
  }, { ac: { from: "a", to: "c" }, bc: { from: "b", to: "c" } });
  const character = actor({ system: { level: 4, skillPoints: 2 }, items: [createOwnedSkillSource(documents.get("Item.a"))] });
  let state = getSkillNodeLearningState({ actor: character, tree: skillTree, nodeId: "c", resolvedSkills: documents });
  assert.equal(state.available, false);
  assert.equal(state.requiredSkills.filter((entry) => entry.known).length, 1);
  assert.match(state.reasons.join(" "), /5 уровень/);
  assert.match(state.reasons.join(" "), /очков навыков/);
  assert.match(state.reasons.join(" "), /Сначала изучите: b/);
  character.system = { level: 5, skillPoints: 3 };
  character.items.push(createOwnedSkillSource(documents.get("Item.b")));
  state = getSkillNodeLearningState({ actor: character, tree: skillTree, nodeId: "c", resolvedSkills: documents });
  assert.equal(state.available, true);
  assert.equal(state.cost, 3);
});

test("cyclic, missing and inaccessible prerequisites remain blocked", () => {
  const a = skill("a"), b = skill("b");
  const documents = new Map([[a.uuid, a], [b.uuid, b]]);
  const character = actor({ items: [createOwnedSkillSource(b)] });
  const cyclic = tree({ a: { skillUuid: a.uuid, level: 1 }, b: { skillUuid: b.uuid, level: 1 } }, {
    ab: { from: "a", to: "b" }, ba: { from: "b", to: "a" }
  });
  let state = getSkillNodeLearningState({ actor: character, tree: cyclic, nodeId: "a", resolvedSkills: documents });
  assert.equal(state.available, false);
  assert.match(state.reasons.join(" "), /цикл/);
  cyclic.system.edges = { missing: { from: "missing", to: "a" } };
  state = getSkillNodeLearningState({ actor: character, tree: cyclic, nodeId: "a", resolvedSkills: documents });
  assert.equal(state.available, false);
  cyclic.system.edges = { ba: { from: "b", to: "a" } };
  documents.set(b.uuid, null);
  state = getSkillNodeLearningState({ actor: character, tree: cyclic, nodeId: "a", resolvedSkills: documents });
  assert.equal(state.available, false);
  assert.doesNotMatch(state.reasons.join(" "), /Сначала изучите: b/);
});

test("source resolution rejects hidden, embedded and wrong-type documents", async () => {
  const allowed = skill("allowed");
  sources = new Map([
    ["allowed", allowed], ["hidden", skill("secret", 1, { testUserPermission: () => false })],
    ["embedded", skill("owned", 1, { parent: { documentName: "Actor" } })],
    ["wrong", skill("weapon", 1, { type: "weapon" })],
    ["pack", skill("pack", 1, { compendium: { visible: false } })]
  ]);
  assert.equal(await resolveAccessibleSkill("allowed"), allowed);
  for (const id of ["hidden", "embedded", "wrong", "pack", "missing"]) assert.equal(await resolveAccessibleSkill(id), null);
});

test("purchase charges once and rechecks duplicate ownership", async () => {
  sources = new Map([["Item.a", skill("a", 3)]]);
  const character = actor();
  const result = await learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" });
  assert.equal(result.created.length, 1);
  assert.equal(character.system.skillPoints, 2);
  assert.equal(character.items[0].flags.ParovGrad.skillTreeUuid, "Item.tree");
  await assert.rejects(learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" }), /уже изучен/);
  assert.equal(character.system.skillPoints, 2);
  assert.equal(character.items.length, 1);
});

test("cancelled debit grants nothing; failed creation refunds its debit", async () => {
  sources = new Map([["Item.a", skill("a", 3)]]);
  const character = actor({ async update() { return this; } });
  await assert.rejects(learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" }), /списать/);
  assert.equal(character.items.length, 0);
  const failed = actor({ async createEmbeddedDocuments() { throw new Error("Creation rejected"); } });
  await assert.rejects(learnSkillFromTree({ actor: failed, tree: tree(), nodeId: "a" }), /Creation rejected/);
  assert.equal(failed.system.skillPoints, 5);
  assert.equal(isActorLearningSkill(failed), false);
});

test("persisted creation after an error is recognized and stays charged", async () => {
  sources = new Map([["Item.a", skill("a", 2)]]);
  const character = actor({ async createEmbeddedDocuments(_type, data) {
    this.items.push(...data);
    throw new Error("Post-persistence hook failure");
  } });
  const result = await learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" });
  assert.equal(result.created.length, 1);
  assert.equal(character.system.skillPoints, 3);
});

test("debit error after persistence is refunded without granting a skill", async () => {
  sources = new Map([["Item.a", skill("a", 2)]]);
  let calls = 0;
  const character = actor({ async update(patch) {
    this.system.skillPoints = patch["system.skillPoints"];
    if (++calls === 1) throw new Error("Post-debit hook failure");
    return this;
  } });
  await assert.rejects(learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" }), /Post-debit/);
  assert.equal(character.system.skillPoints, 5);
  assert.equal(character.items.length, 0);
  assert.equal(isActorLearningSkill(character), false);
});

test("refund is accepted when an update throws after the refund persisted", async () => {
  sources = new Map([["Item.a", skill("a", 2)]]);
  let calls = 0;
  const character = actor({
    async update(patch) {
      this.system.skillPoints = patch["system.skillPoints"];
      if (++calls === 2) throw new Error("Post-refund hook failure");
      return this;
    },
    async createEmbeddedDocuments() { throw new Error("Creation rejected"); }
  });
  await assert.rejects(learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" }), /Creation rejected/);
  assert.equal(character.system.skillPoints, 5);
  assert.equal(character.items.length, 0);
});

test("zero cost skills succeed; malformed costs cannot grant free skills", async () => {
  const character = actor({ system: { level: 1, skillPoints: 0 } });
  sources = new Map([["Item.a", skill("a", 0)]]);
  await learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" });
  assert.equal(character.system.skillPoints, 0);
  for (const cost of [-1, 1.5, NaN]) {
    sources = new Map([["Item.a", skill("a", cost)]]);
    await assert.rejects(learnSkillFromTree({ actor: actor(), tree: tree(), nodeId: "a" }), /некорректная стоимость/);
  }
});

test("actor-scoped lock blocks a second window before async source lookup completes", async () => {
  sources = new Map([["Item.a", skill("a", 1)]]);
  const originalResolve = foundry.utils.fromUuid;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  foundry.utils.fromUuid = async (uuid) => { await gate; return sources.get(uuid); };
  const character = actor();
  try {
    const first = learnSkillFromTree({ actor: character, tree: tree(), nodeId: "a" });
    assert.equal(isActorLearningSkill(character), true);
    await assert.rejects(withActorSkillLock({ uuid: character.uuid }, () => assert.fail("lock bypassed")), /Дождитесь/);
    release();
    await first;
    assert.equal(character.items.length, 1);
    assert.equal(isActorLearningSkill(character), false);
  } finally {
    release();
    foundry.utils.fromUuid = originalResolve;
  }
});

test("completion hook fires after the shared lock is released even on failure", async () => {
  const previousHooks = globalThis.Hooks;
  const character = actor();
  let notified = false;
  globalThis.Hooks = { callAll(name, document) {
    assert.equal(name, "parovgradSkillLearningComplete");
    assert.equal(document, character);
    assert.equal(isActorLearningSkill(document), false);
    notified = true;
  } };
  try {
    await assert.rejects(withActorSkillLock(character, async () => { throw new Error("Purchase cancelled"); }), /Purchase cancelled/);
    assert.equal(notified, true);
  } finally { globalThis.Hooks = previousHooks; }
});

test("inaccessible trees and non-owners cannot purchase", async () => {
  sources = new Map([["Item.a", skill("a", 1)]]);
  const hidden = tree();
  hidden.testUserPermission = () => false;
  const character = actor();
  await assert.rejects(learnSkillFromTree({ actor: character, tree: hidden, nodeId: "a" }), /Древо недоступно/);
  await assert.rejects(learnSkillFromTree({ actor: actor({ isOwner: false }), tree: tree(), nodeId: "a" }), /Недостаточно прав/);
  assert.equal(character.system.skillPoints, 5);
  assert.equal(character.items.length, 0);
});
