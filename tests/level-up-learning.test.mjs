import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, beforeEach, afterEach } from "node:test";

// Load the browser ES modules without adding Node package metadata to the system.
const learningSource = await readFile(new URL("../module/skills/skill-learning.js", import.meta.url), "utf8");
const learningUrl = `data:text/javascript;base64,${Buffer.from(learningSource).toString("base64")}`;
const learning = await import(learningUrl);
const levelSource = (await readFile(new URL("../module/apps/level-up-dialog.js", import.meta.url), "utf8"))
  .replace("../skills/skill-learning.js", learningUrl);
const { openActorLevelUpDialog, buildDialogResult, loadSkillCompendiumCatalogue } = await import(
  `data:text/javascript;base64,${Buffer.from(`${levelSource}\nexport { buildDialogResult, loadSkillCompendiumCatalogue };`).toString("base64")}`
);

let notifications;
let nextId = 0;
let originalError;
beforeEach(() => {
  notifications = { info: [], warn: [] };
  globalThis.ui = { notifications: {
    info: (message) => notifications.info.push(message),
    warn: (message) => notifications.warn.push(message)
  } };
  globalThis.game = { user: { isGM: true }, packs: [] };
  globalThis.foundry = { utils: { randomID: () => `test${++nextId}` }, applications: { api: { DialogV2: {
    confirm: async (options) => {
      assert.equal(options.yes.label, "Далее");
      assert.equal(options.no.label, "Отмена");
      return true;
    },
    wait: async () => null
  } } } };
  originalError = console.error;
  console.error = () => {};
});
afterEach(() => { console.error = originalError; });

function skill(id, cost = 2, name = "Навык") {
  return {
    documentName: "Item", type: "skill", id, pack: "ParovGrad.skills",
    uuid: `Compendium.ParovGrad.skills.Item.${id}`, name, flags: {}, system: { cost },
    testUserPermission: () => true,
    toObject() {
      return structuredClone({ _id: id, name, type: "skill", folder: "folder", sort: 1,
        ownership: { default: 0 }, system: this.system, flags: this.flags });
    }
  };
}

function actor({ mode = "success", updateMode = "success" } = {}) {
  return {
    documentName: "Actor", type: "Player", uuid: `Actor.${++nextId}`, isOwner: true,
    system: { level: 1, skillPoints: 4 }, items: [], writes: [], creates: 0,
    async update(updates) {
      this.writes.push(structuredClone(updates));
      if (updateMode === "reject") throw new Error("Update rejected");
      if (updateMode === "cancel") return this;
      for (const [key, value] of Object.entries(updates)) this.system[key.slice(7)] = value;
      if (updateMode === "persistThenThrow") throw new Error("Update hook failed after persistence");
      return this;
    },
    async createEmbeddedDocuments(type, sources) {
      assert.equal(type, "Item");
      this.creates += 1;
      assert.ok(this.system.level > 1, "level and points are saved before skill creation");
      if (mode === "reject") throw new Error("Create rejected");
      if (mode === "cancel") return [];
      const selected = mode === "partial" ? sources.slice(0, 1) : sources;
      const created = selected.map((source) => ({ ...structuredClone(source), id: `owned${++nextId}` }));
      this.items.push(...created);
      if (mode === "persistThenThrow") throw new Error("Hook failed after persistence");
      return created;
    }
  };
}

function selection(target, skills) {
  const skillLookup = new Map(skills.map((document) => {
    const key = `${document.pack}:${document.id}`;
    return [key, { key, document, cost: document.system.cost, alreadyOwned: false }];
  }));
  return buildDialogResult(target, { skillLookup }, skills.map((document) => ({
    packId: document.pack, skillId: document.id
  })), 5);
}

function choose(target, skills, duringDialog = () => {}) {
  const result = selection(target, skills);
  foundry.applications.api.DialogV2.wait = async () => {
    duringDialog();
    return result;
  };
}

test("declining confirmation and cancelling selection do not change the actor", async () => {
  const target = actor();
  foundry.applications.api.DialogV2.confirm = async () => false;
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.writes, []);
  foundry.applications.api.DialogV2.confirm = async () => true;
  foundry.applications.api.DialogV2.wait = async () => "cancel";
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.writes, []);
  assert.equal(target.creates, 0);
});

test("a successful purchase charges once and stamps canonical source identity", async () => {
  const target = actor();
  const source = skill("a");
  choose(target, [source]);
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.system, { level: 2, skillPoints: 3 });
  assert.equal(target.items.length, 1);
  assert.equal(target.writes.length, 1);
  assert.equal(target.items[0].flags.ParovGrad.sourceSkillUuid, source.uuid);
  assert.equal(target.items[0].flags.ParovGrad.sourceSkillKey, "ParovGrad.skills:a");
  assert.equal(learning.isKnownSkill(target, source), true);
  assert.equal(notifications.warn.length, 0);
});

test("stale level or point snapshots are rejected without overwriting new state", async () => {
  for (const field of ["level", "skillPoints"]) {
    const target = actor();
    choose(target, [skill("a")], () => { target.system[field] += 1; });
    const expected = field === "level" ? { level: 2, skillPoints: 4 } : { level: 1, skillPoints: 5 };
    await openActorLevelUpDialog(target);
    assert.deepEqual(target.system, expected);
    assert.equal(target.writes.length, 0);
    assert.equal(target.creates, 0);
  }
});

test("a tree-learned skill added while the dialog is open cannot be repurchased", async () => {
  const target = actor();
  const source = skill("a");
  choose(target, [source], () => target.items.push({ type: "skill", flags: {
    ParovGrad: { skillTreeSourceUuid: source.uuid }
  } }));
  await openActorLevelUpDialog(target);
  assert.equal(target.writes.length, 0);
  assert.equal(target.creates, 0);
  assert.match(notifications.warn[0], /уже изучен/);
});

test("the shared actor lock rejects overlapping skill purchases", async () => {
  const target = actor();
  choose(target, [skill("a")]);
  let release;
  const held = learning.withActorSkillLock(target, () => new Promise((resolve) => { release = resolve; }));
  await openActorLevelUpDialog(target);
  assert.equal(target.creates, 0);
  assert.equal(target.writes.length, 0);
  assert.match(notifications.warn[0], /Дождитесь/);
  release();
  await held;
  assert.equal(learning.isActorLearningSkill(target), false);
});

test("rejected or cancelled debits never create free skills", async () => {
  for (const updateMode of ["reject", "cancel"]) {
    const target = actor({ updateMode });
    choose(target, [skill("a")]);
    await openActorLevelUpDialog(target);
    assert.deepEqual(target.system, { level: 1, skillPoints: 4 });
    assert.equal(target.creates, 0);
    assert.equal(learning.isActorLearningSkill(target), false);
  }
});

test("rejected or cancelled skill creation restores the original level and points", async () => {
  for (const mode of ["reject", "cancel"]) {
    const target = actor({ mode });
    choose(target, [skill("a")]);
    await openActorLevelUpDialog(target);
    assert.deepEqual(target.system, { level: 1, skillPoints: 4 });
    assert.equal(target.items.length, 0);
    assert.equal(target.writes.length, 2);
    assert.equal(learning.isActorLearningSkill(target), false);
  }
});

test("partial creation charges only persisted skills and preserves the completed level-up", async () => {
  const target = actor({ mode: "partial" });
  choose(target, [skill("a", 2), skill("b", 1)]);
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.system, { level: 2, skillPoints: 3 });
  assert.equal(target.items.length, 1);
  assert.equal(target.writes.length, 2);
  assert.match(notifications.warn[0], /1 из 2/);
});

test("a hook failure after persistence does not refund a successfully created skill", async () => {
  const target = actor({ mode: "persistThenThrow" });
  choose(target, [skill("a")]);
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.system, { level: 2, skillPoints: 3 });
  assert.equal(target.items.length, 1);
  assert.equal(target.writes.length, 1);
  assert.equal(notifications.warn.length, 0);
});

test("a hook failure after saving the debit still completes the purchase once", async () => {
  const target = actor({ updateMode: "persistThenThrow" });
  choose(target, [skill("a")]);
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.system, { level: 2, skillPoints: 3 });
  assert.equal(target.items.length, 1);
  assert.equal(target.writes.length, 1);
  assert.equal(notifications.warn.length, 0);
});

test("revoked ownership and revoked skill visibility are rechecked before payment", async () => {
  for (const revoked of ["owner", "visibility"]) {
    const target = actor();
    const source = skill("a");
    choose(target, [source], () => {
      if (revoked === "owner") target.isOwner = false;
      else {
        game.user.isGM = false;
        source.testUserPermission = () => false;
      }
    });
    await openActorLevelUpDialog(target);
    assert.equal(target.writes.length, 0);
    assert.equal(target.creates, 0);
  }
});

test("leveling without selected skills grants the level points without creating items", async () => {
  const target = actor();
  choose(target, []);
  await openActorLevelUpDialog(target);
  assert.deepEqual(target.system, { level: 2, skillPoints: 5 });
  assert.equal(target.creates, 0);
  assert.equal(target.writes.length, 1);
});

test("source identity permits distinct skills with the same name in the catalogue", async () => {
  const target = actor();
  const first = skill("a");
  const second = skill("b");
  target.items.push({ type: "skill", name: first.name, flags: { ParovGrad: { sourceSkillUuid: first.uuid } } });
  game.packs = [{ documentName: "Item", visible: true, collection: "ParovGrad.skills", title: "Skills",
    getDocuments: async () => [first, second] }];
  const catalogue = await loadSkillCompendiumCatalogue(target);
  assert.equal(catalogue.skillLookup.get("ParovGrad.skills:a").alreadyOwned, true);
  assert.equal(catalogue.skillLookup.get("ParovGrad.skills:b").alreadyOwned, false);
});

test("copies in different packs sharing canonical origin cannot be selected together", async () => {
  for (const reference of ["core.sourceId", "compendiumSource"]) {
    const target = actor();
    const first = skill("a");
    const second = skill("b");
    second.pack = "Other.skills";
    second.uuid = "Compendium.Other.skills.Item.b";
    for (const document of [first, second]) {
      if (reference === "core.sourceId") document.flags.core = { sourceId: "Compendium.original.skills.Item.origin" };
      else document._stats = { compendiumSource: "Compendium.original.skills.Item.origin" };
    }
    assert.equal(selection(target, [first, second]), null);
    assert.match(notifications.warn.at(-1), /Один и тот же навык/);
    assert.equal(target.writes.length, 0);
  }
});

test("canonical duplicates introduced while the dialog is open are rechecked before payment", async () => {
  const target = actor();
  const first = skill("a");
  const second = skill("b");
  second.pack = "Other.skills";
  second.uuid = "Compendium.Other.skills.Item.b";
  choose(target, [first, second], () => {
    first.flags.core = { sourceId: "Compendium.original.skills.Item.origin" };
    second._stats = { compendiumSource: "Compendium.original.skills.Item.origin" };
  });
  await openActorLevelUpDialog(target);
  assert.equal(target.writes.length, 0);
  assert.equal(target.creates, 0);
  assert.match(notifications.warn[0], /Один и тот же навык/);
});
