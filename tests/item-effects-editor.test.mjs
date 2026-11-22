import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stubSource = `
export const addEffectToItem = (...args) => globalThis.itemEffectsUiApi.add(...args);
export const getItemEffectViews = (...args) => globalThis.itemEffectsUiApi.views(...args);
export const openActorEffectDialog = (...args) => globalThis.itemEffectsUiApi.dialog(...args);
export const resolveEffectSourceFromDropData = (...args) => globalThis.itemEffectsUiApi.resolve(...args);
`;
const stubUrl = `data:text/javascript;base64,${Buffer.from(stubSource).toString("base64")}`;
const source = (await readFile(new URL("../module/apps/sheets/item-effects-editor.js", import.meta.url), "utf8"))
  .replace('"../../effects/effect-utils.js"', JSON.stringify(stubUrl));
const { prepareItemEffectsContext, attachItemEffectsEditor } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function control(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, callback) { listeners.set(type, callback); },
    async fire(type, extraEvent = {}) {
      return listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, currentTarget: this, ...extraEvent });
    }
  };
}

function harness({ editable = true, editing = true, embedded = true } = {}) {
  const writes = [], calls = [], warnings = [];
  const effects = new Map();
  const document = {
    uuid: "Actor.actor.Item.item", system: { equipped: false }, effects,
    parent: embedded ? { documentName: "Actor" } : null,
    update: async (patch) => writes.push(patch),
    deleteEmbeddedDocuments: async (...args) => calls.push(["delete", ...args])
  };
  const equipped = control({ checked: true });
  const groups = ["passive", "active"].map((application) => {
    const create = control();
    return control({
      dataset: { itemEffectApplication: application }, create,
      querySelector: () => create
    });
  });
  const rows = [];
  const root = {
    querySelector: () => equipped,
    querySelectorAll: (selector) => selector === "[data-item-effect-application]" ? groups : rows
  };
  const sheet = { isEditable: editable, _isEditMode: editing, document };
  globalThis.itemEffectsUiApi = {
    views: (_item, application) => [{ id: application, name: application, disabled: application === "active" }],
    add: async (...args) => calls.push(["add", ...args]),
    dialog: async (...args) => calls.push(["dialog", ...args]),
    resolve: async (data) => data?.uuid ? { document: { uuid: data.uuid, type: "effect" } } : null
  };
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message), error: (message) => warnings.push(message) } };
  return { sheet, root, equipped, groups, rows, writes, calls, warnings, effects };
}

test("wear state is switchable in view mode for owned and catalogue items, never on read-only sheets", async () => {
  for (const options of [{ editing: false }, { editing: false, embedded: false }]) {
    const viewing = harness(options);
    assert.equal(prepareItemEffectsContext(viewing.sheet).canToggleEquipped, true);
    attachItemEffectsEditor(viewing.sheet, viewing.root);
    await viewing.equipped.fire("change");
    assert.deepEqual(viewing.writes, [{ "system.equipped": true }]);
    // Effect configuration stays edit-mode only.
    await viewing.groups[0].fire("drop", { dataTransfer: { getData: () => '{"uuid":"Item.effect"}' } });
    assert.deepEqual(viewing.calls, []);
  }

  const readOnly = harness({ editable: false });
  assert.equal(prepareItemEffectsContext(readOnly.sheet).canToggleEquipped, false);
  attachItemEffectsEditor(readOnly.sheet, readOnly.root);
  await readOnly.equipped.fire("change");
  await readOnly.groups[0].fire("drop", { dataTransfer: { getData: () => '{"uuid":"Item.effect"}' } });
  assert.deepEqual(readOnly.writes, []);
  assert.deepEqual(readOnly.calls, []);
});

test("each drop zone binds its own application and creates a new effect with that application", async () => {
  const target = harness();
  attachItemEffectsEditor(target.sheet, target.root);
  await target.groups[1].fire("drop", { dataTransfer: { getData: () => '{"uuid":"Item.effect"}' } });
  assert.equal(target.calls[0][0], "add");
  assert.equal(target.calls[0][1], target.sheet.document);
  assert.equal(target.calls[0][3], "active");
  await target.groups[1].create.fire("click");
  assert.deepEqual(target.calls[1], ["dialog", { actor: target.sheet.document, itemApplication: "active" }]);

  const context = prepareItemEffectsContext(target.sheet);
  assert.deepEqual(context.itemEffectGroups.map((group) => group.effects[0].isPassive), [true, false]);
  assert.equal(context.itemEffectGroups[1].effects[0].disabled, true);
});

test("dropping an effect already on this item moves it without duplicating and invalid drops do not write", async () => {
  const target = harness();
  const moves = [];
  globalThis.itemEffectsUiApi.resolve = async () => ({ document: {
    parent: target.sheet.document, update: async (patch) => moves.push(patch)
  } });
  attachItemEffectsEditor(target.sheet, target.root);
  await target.groups[1].fire("drop", { dataTransfer: { getData: () => '{"uuid":"existing"}' } });
  assert.deepEqual(moves, [{ "flags.ParovGrad.itemApplication": "active", transfer: false }]);
  assert.deepEqual(target.calls, []);
  await target.groups[0].fire("drop", { dataTransfer: { getData: () => "not JSON" } });
  assert.equal(target.warnings.length, 1);
  assert.equal(moves.length, 1);
});

test("bound effect controls act on that embedded effect and preserve the item", async () => {
  const target = harness();
  const writes = [];
  const controls = new Map();
  for (const selector of [".pg-item-effect-edit", ".pg-item-effect-toggle", ".pg-item-effect-delete", ".pg-item-effect-mode"]) {
    controls.set(selector, control({ value: "active" }));
  }
  const effect = { id: "effect-1", disabled: false, update: async (patch) => writes.push(patch) };
  target.effects.set(effect.id, effect);
  target.rows.push({ dataset: { effectId: effect.id }, querySelector: (selector) => controls.get(selector) });
  attachItemEffectsEditor(target.sheet, target.root);
  await controls.get(".pg-item-effect-toggle").fire("click");
  await controls.get(".pg-item-effect-mode").fire("change");
  await controls.get(".pg-item-effect-edit").fire("click");
  await controls.get(".pg-item-effect-delete").fire("click");
  assert.deepEqual(writes, [{ disabled: true }, { "flags.ParovGrad.itemApplication": "active", transfer: false }]);
  assert.deepEqual(target.calls, [
    ["dialog", { actor: target.sheet.document, effect }],
    ["delete", "ActiveEffect", [effect.id]]
  ]);
  assert.deepEqual(target.writes, []);
});
