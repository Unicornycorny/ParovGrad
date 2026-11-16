import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];
const errors = [];
globalThis.ui = { notifications: {
  warn: (message) => warnings.push(message),
  error: (message) => errors.push(message)
} };

class ApplicationV2 {
  constructor(options) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
  _attachPartListeners() {}
  async render() { this.context = await this._prepareContext({}); this.rendered = true; return this; }
  async close() { this.rendered = false; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } }
};
const helperSource = await readFile(new URL("../module/actors/item-preparation.js", import.meta.url), "utf8");
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`;
const appSource = (await readFile(new URL("../module/apps/item-preparation-dialog.js", import.meta.url), "utf8"))
  .replace('from "../actors/item-preparation.js"', `from "${helperUrl}"`);
const { openItemPreparationDialog } = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`);

function actor(extra = {}) {
  return {
    documentName: "Actor", type: "Player", name: "Персонаж", isOwner: true,
    items: [
      { id: "spell-a", name: "Заклинание А", type: "spell" },
      { id: "spell-b", name: "Заклинание Б", type: "spell" },
      { id: "skill-a", name: "Навык", type: "skill" }
    ],
    system: { preparedSpells: ["spell-a"], preparedSkills: ["skill-a"] },
    writes: [],
    async update(patch) {
      this.writes.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) this.system[path.slice(7)] = value;
      return this;
    },
    ...extra
  };
}

function control(extra = {}) {
  return {
    disabled: false, listeners: new Map(), ...extra,
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    async emit(type) { await this.listeners.get(type)?.({ preventDefault() {} }); }
  };
}

function view(app) {
  const checkboxes = app.context.items.map((item) => control({ value: item.id, checked: item.prepared }));
  const save = control();
  const cancel = control();
  const count = { textContent: String(app.context.selectedCount) };
  const html = {
    querySelector(selector) {
      return { ".pg-preparation-save": save, ".pg-preparation-cancel": cancel,
        ".pg-preparation-selected-count": count }[selector] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="preparedItems"]') return checkboxes;
      if (selector === 'input[name="preparedItems"]:checked') return checkboxes.filter((box) => box.checked);
      if (selector === '.pg-preparation-save, input[name="preparedItems"]') return [save, ...checkboxes];
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };
  app._attachPartListeners("main", html, {});
  return {
    html, checkboxes, save, cancel, count,
    async toggle(id, checked) {
      const checkbox = checkboxes.find((entry) => entry.value === id);
      checkbox.checked = checked;
      await checkbox.emit("change");
    }
  };
}

test("reopening starts from persisted preparation and cancellation discards pending choices", async () => {
  const target = actor();
  const app = await openItemPreparationDialog(target, "spell");
  assert.equal(app.title, "Подготовка заклинаний — Персонаж");
  assert.deepEqual(app.context.items.map((item) => [item.id, item.prepared]), [["spell-a", true], ["spell-b", false]]);
  assert.equal(app.context.totalCount, 2);
  const form = view(app);
  await form.toggle("spell-a", false);
  await form.toggle("spell-b", true);
  assert.equal(form.count.textContent, "1");
  await form.cancel.emit("click");
  assert.equal(app.rendered, false);
  assert.deepEqual(target.writes, []);
  const reopened = await openItemPreparationDialog(target, "spell");
  assert.deepEqual(reopened.context.items.map((item) => item.prepared), [true, false]);
});

test("checkbox changes save only the chosen preparation list and appear on reopening", async () => {
  const target = actor();
  const app = await openItemPreparationDialog(target, "spell");
  const form = view(app);
  await form.toggle("spell-a", false);
  await form.toggle("spell-b", true);
  assert.deepEqual(target.writes, [], "checkbox changes stay local until Save");
  await form.save.emit("click");
  assert.deepEqual(target.writes, [{ "system.preparedSpells": ["spell-b"] }]);
  assert.deepEqual(target.system.preparedSkills, ["skill-a"]);
  assert.equal(app.rendered, false);
  const reopened = await openItemPreparationDialog(target, "spell");
  assert.deepEqual(reopened.context.items.map((item) => item.prepared), [false, true]);
  const skills = await openItemPreparationDialog(target, "skill");
  const skillsForm = view(skills);
  await skillsForm.toggle("skill-a", false);
  await skillsForm.save.emit("click");
  assert.deepEqual(target.writes[1], { "system.preparedSkills": [] });
  assert.deepEqual(target.system.preparedSpells, ["spell-b"]);
});

test("an empty known list opens and Save clears stale preparation", async () => {
  const target = actor({ items: [] });
  const app = await openItemPreparationDialog(target, "spell");
  assert.deepEqual(app.context.items, []);
  assert.equal(app.context.emptyLabel, "Нет известных заклинаний");
  assert.equal(app.context.selectedCount, 0);
  await view(app).save.emit("click");
  assert.deepEqual(target.writes, [{ "system.preparedSpells": [] }]);
});

test("Save ignores entries deleted while the selection window was open", async () => {
  const target = actor();
  const app = await openItemPreparationDialog(target, "spell");
  const form = view(app);
  await form.toggle("spell-b", true);
  target.items = target.items.filter((item) => item.id !== "spell-a");
  await form.save.emit("click");
  assert.deepEqual(target.writes, [{ "system.preparedSpells": ["spell-b"] }]);
});

test("failed saving keeps the selection open, restores controls and permits retry", async () => {
  const target = actor();
  const persist = target.update;
  const app = await openItemPreparationDialog(target, "spell");
  const form = view(app);
  await form.toggle("spell-b", true);
  target.update = async () => {
    assert.equal(form.save.disabled, true);
    assert.ok(form.checkboxes.every((checkbox) => checkbox.disabled));
    throw new Error("Не удалось записать подготовку");
  };
  const originalError = console.error;
  console.error = () => {};
  try { await form.save.emit("click"); }
  finally { console.error = originalError; }
  assert.equal(app.rendered, true);
  assert.equal(form.save.disabled, false);
  assert.ok(form.checkboxes.every((checkbox) => !checkbox.disabled));
  assert.equal(app._saving, false);
  assert.equal(errors.at(-1), "Не удалось записать подготовку");
  assert.deepEqual(target.writes, []);
  target.update = persist;
  await form.save.emit("click");
  assert.deepEqual(target.system.preparedSpells, ["spell-a", "spell-b"]);
  assert.equal(app.rendered, false);
});

test("non-owners cannot open preparation and revoked ownership prevents saving", async () => {
  const target = actor({ isOwner: false });
  assert.equal(await openItemPreparationDialog(target, "spell"), undefined);
  assert.match(warnings.at(-1), /Недостаточно прав/);
  target.isOwner = true;
  const app = await openItemPreparationDialog(target, "skill");
  const form = view(app);
  await form.toggle("skill-a", false);
  target.isOwner = false;
  const originalError = console.error;
  console.error = () => {};
  try { await form.save.emit("click"); }
  finally { console.error = originalError; }
  assert.equal(app.rendered, true);
  assert.deepEqual(target.writes, []);
  assert.match(errors.at(-1), /Недостаточно прав/);
  for (const type of ["weapon", "toString", "__proto__"]) {
    assert.equal(await openItemPreparationDialog(actor(), type), undefined);
  }
});
