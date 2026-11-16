import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Exercise the real sheet methods without starting a Foundry world. Only UI,
// Document persistence and unrelated imported components are replaced here.
const sheetSource = (await readFile(new URL("../module/apps/sheets/skill-tree-sheet.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?$/gm, "")
  .replace("export class ParovGradSkillTreeSheet", "class ParovGradSkillTreeSheet");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

function harness({answer = {name: "Новый приём", description: "Описание", cost: 2, level: 4}, wait, failNode = false,
  canCreate = true, editable = true, editMode = true, createFailure = false} = {}) {
  const created = [];
  const updates = [];
  const messages = [];
  const dialogCalls = [];
  const hooks = new Map();
  let nextId = 0;
  const document = {
    uuid: "Item.tree", name: "Бой", ownership: {default: 2, player: 3}, folder: {id: "folder"},
    system: {
      revision: 7,
      branches: {first: {name: "Первая"}, selected: {name: "Выбранная"}},
      nodes: {existing: {skillUuid: "Item.existing", branchId: "selected", level: 3}},
      edges: {}
    },
    async update(data) {
      if (failNode) throw new Error("Node write rejected");
      updates.push(data);
      for (const [path, value] of Object.entries(data)) {
        const keys = path.split(".");
        const leaf = keys.pop();
        let target = this;
        for (const key of keys) target = target[key] ??= {};
        target[leaf] = value;
      }
      return this;
    }
  };
  const controls = {
    navigation: {disabled: false}, openSkill: {disabled: false}, actorSelect: {disabled: false},
    learn: {disabled: false}, create: {disabled: false}, branchInput: {disabled: false}
  };
  class DocumentSheet {
    constructor({document}) { this.document = document; this.isEditable = editable; this.rendered = true; }
    async render() { this.renderCount = (this.renderCount ?? 0) + 1; }
    async _onRender() {
      if (!this.isEditable) for (const control of Object.values(controls)) control.disabled = true;
    }
    _onClose() { this.rendered = false; }
  }
  const context = {
    structuredClone,
    console: {error() {}, warn() {}},
    canObserveDocument: () => true,
    attachItemPortraitListener() {},
    MagicTreeGraphView: class {},
    validateSkillTreeStructure: () => ({errors: [], warnings: [], valid: true}),
    openLearnSkillFromTreeDialog() {},
    Hooks: {
      on(event, callback) { const id = ++nextId; hooks.set(id, {event, callback}); return id; },
      off(_event, id) { hooks.delete(id); }
    },
    game: {user: {id: "player"}, items: [], actors: []},
    ui: {notifications: Object.fromEntries(["warn", "error", "info"].map((type) =>
      [type, (message) => messages.push({type, message})]))},
    foundry: {
      utils: {
        deepClone: structuredClone,
        randomID: () => `node${++nextId}`,
        fromUuid: async (uuid) => created.find((item) => item.uuid === uuid) ?? null
      },
      applications: {
        api: {
          HandlebarsApplicationMixin: (base) => base,
          DocumentSheetV2: DocumentSheet,
          DialogV2: {async wait(config) {
            dialogCalls.push(config);
            return wait ? wait(config) : answer;
          }}
        },
        handlebars: {async renderTemplate() { return "<div>Creation form</div>"; }}
      }
    },
    Item: {implementation: {
      canUserCreate: () => canCreate,
      async create(data, options) {
        if (createFailure) throw new Error("Item write rejected");
        const skill = {...data, uuid: `Item.skill${created.length + 1}`, documentName: "Item",
          creationOptions: options, sheet: {async render() { this.opened = true; }}};
        created.push(skill);
        return skill;
      }
    }}
  };
  vm.runInNewContext(`${sheetSource}\nglobalThis.TreeSheet = ParovGradSkillTreeSheet;`, context);
  const sheet = new context.TreeSheet({document});
  sheet._isEditMode = editMode;
  sheet._selectedNodeId = "existing";
  sheet._graphView = {getViewportCenterWorldPosition: () => ({x: 800, y: 500}), destroy() { this.destroyed = true; }};
  sheet.element = {
    querySelectorAll() { return [controls.navigation, controls.openSkill, controls.actorSelect]; },
    querySelector() { return controls.learn; }
  };
  return {sheet, document, created, updates, messages, dialogCalls, controls, hooks};
}

test("creates a world Skill, adds it to the selected branch at the current view, and opens its editor", async () => {
  const h = harness();
  await h.sheet._createSkill();
  assert.equal(h.created.length, 1);
  const skill = h.created[0];
  assert.equal(skill.type, "skill");
  assert.equal(skill.name, "Новый приём");
  assert.equal(skill.system.description, "Описание");
  assert.equal(skill.system.cost, 2);
  assert.equal(skill.folder, "folder");
  assert.notEqual(skill.ownership, h.document.ownership);
  assert.equal(skill.ownership.default, 2);
  const node = Object.values(h.document.system.nodes).find((entry) => entry.skillUuid === skill.uuid);
  assert.equal(node.branchId, "selected");
  assert.equal(node.level, 4);
  assert.equal(node.position.x, 710);
  assert.equal(node.position.y, 440);
  assert.equal(h.document.system.revision, 8);
  assert.equal(skill.sheet._isEditMode, true);
  assert.equal(skill.sheet.opened, true);
  assert.equal(h.sheet._creatingSkill, false);
});

test("reads and trims actual dialog fields through the Foundry callback contract", async () => {
  const fields = {name: "  Уклонение  ", description: "  Ответное действие  ", cost: "1", level: "6"};
  const h = harness({wait: (config) => config.buttons.find((button) => button.action === "create").callback(
    {}, {form: {elements: {namedItem: (name) => ({value: fields[name]})}}}
  )});
  await h.sheet._createSkill();
  assert.equal(h.created[0].name, "Уклонение");
  assert.equal(h.created[0].system.description, "Ответное действие");
  assert.equal(h.created[0].system.cost, 1);
  assert.equal(Object.values(h.document.system.nodes).at(-1).level, 6);
});

test("cancel, close and invalid input leave the world and tree unchanged", async () => {
  for (const answer of [null, "cancel", {name: "", cost: 1, level: 1}, {name: "X", cost: -1, level: 1},
    {name: "X", cost: 1.5, level: 1}, {name: "X", cost: 1, level: -1}, {name: "X", cost: 1, level: 1.5}]) {
    const h = harness({answer});
    await h.sheet._createSkill();
    assert.equal(h.created.length, 0);
    assert.equal(h.updates.length, 0);
    assert.equal(h.sheet._creatingSkill, false);
  }
});

test("a second creation request while the dialog is open does not create a duplicate", async () => {
  const pending = deferred();
  const opened = deferred();
  const h = harness({wait: () => { opened.resolve(); return pending.promise; }});
  const first = h.sheet._createSkill();
  await opened.promise;
  await h.sheet._createSkill();
  assert.equal(h.dialogCalls.length, 1);
  pending.resolve({name: "Один навык", description: "", cost: 0, level: 1});
  await first;
  assert.equal(h.created.length, 1);
  assert.equal(h.updates.length, 1);
});

test("creation permissions and edit mode are required, including after the dialog closes", async () => {
  for (const options of [{canCreate: false}, {editable: false}, {editMode: false}]) {
    const h = harness(options);
    await h.sheet._createSkill();
    assert.equal(h.dialogCalls.length, 0);
    assert.equal(h.created.length, 0);
  }
  const pending = deferred();
  const opened = deferred();
  const h = harness({wait: () => { opened.resolve(); return pending.promise; }});
  const request = h.sheet._createSkill();
  await opened.promise;
  h.sheet.isEditable = false;
  pending.resolve({name: "Поздний навык", cost: 0, level: 1});
  await request;
  assert.equal(h.created.length, 0);
  assert.equal(h.updates.length, 0);
});

test("a failed node write preserves the created world Skill and reports recovery", async () => {
  const h = harness({failNode: true});
  await h.sheet._createSkill();
  assert.equal(h.created.length, 1);
  assert.equal(h.updates.length, 0);
  assert.equal(Object.keys(h.document.system.nodes).length, 1);
  assert.ok(h.messages.some(({type, message}) => type === "error" && /сохранён в каталоге мира/.test(message)));
  assert.equal(h.sheet._creatingSkill, false);
});

test("a failed Item write does not add a dangling tree node and allows another attempt", async () => {
  const h = harness({createFailure: true});
  await h.sheet._createSkill();
  assert.equal(h.created.length, 0);
  assert.equal(h.updates.length, 0);
  assert.equal(h.sheet._creatingSkill, false);
  await h.sheet._createSkill();
  assert.equal(h.dialogCalls.length, 2);
});

test("tree observers can use learning and navigation while mutation controls stay disabled", async () => {
  const h = harness({editable: false});
  await h.sheet._onRender({canOpenLearning: true}, {});
  assert.equal(h.controls.navigation.disabled, false);
  assert.equal(h.controls.actorSelect.disabled, false);
  assert.equal(h.controls.openSkill.disabled, false);
  assert.equal(h.controls.learn.disabled, false);
  assert.equal(h.controls.create.disabled, true);
  assert.equal(h.controls.branchInput.disabled, true);
  await h.sheet._onRender({canOpenLearning: false}, {});
  assert.equal(h.controls.learn.disabled, true);
});

test("closing the tree releases graph resources and linked-skill watchers", () => {
  const h = harness();
  const graph = h.sheet._graphView;
  h.sheet._watchLinkedSkills();
  h.sheet._watchLinkedSkills();
  assert.equal(h.hooks.size, 2);
  h.sheet._onClose({});
  assert.equal(h.hooks.size, 0);
  assert.equal(graph.destroyed, true);
  assert.equal(h.sheet._graphView, null);
});
