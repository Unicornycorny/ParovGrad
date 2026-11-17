import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const { openActorEffectDialog } = await importModule(new URL("../module/effects/effect-utils.js", import.meta.url));

class Form {
  constructor(values) {
    this.elements = { namedItem: name => name in values ? { value: values[name] } : null };
  }
}
function mergeObject(base, extra) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(result[key] ?? {}, value) : structuredClone(value);
  }
  return result;
}
function harness({ action = "save", fields = {} } = {}) {
  const writes = [];
  const configs = [];
  const form = new Form({ name: "  Защита от огня  ", img: "icons/svg/fire.svg", level: "2",
    effectType: "Защита", impact: "От пламени", removal: "Отдых", description: "Описание",
    modifiersData: JSON.stringify([{ target: "will", value: 2 }]),
    damageModifiersData: JSON.stringify([{ mode: "resistance", damageType: "fire" }]), ...fields });
  globalThis.HTMLFormElement = Form;
  // Ordinary form controls do not require the optional RadioNodeList constructor.
  delete globalThis.RadioNodeList;
  globalThis.foundry = {
    utils: { escapeHTML: value => String(value).replaceAll("<", "&lt;").replaceAll('"', "&quot;"), mergeObject },
    applications: { api: { DialogV2: { async wait(config) {
      configs.push(config);
      if (action === "close") return null;
      const button = config.buttons.find(button => button.action === action);
      // Execute the actual production callback with Foundry V13's (event, button, dialog) contract.
      return button.callback?.({ type: "click" }, { form }, { element: null }) ?? button.action;
    } } } }
  };
  globalThis.ui = { notifications: { error: message => { throw new Error(message); } } };
  const actor = {
    name: 'Тест <"героя">', documentName: "Actor",
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      writes.push(structuredClone(data[0]));
      return [{ id: "created", ...structuredClone(data[0]) }];
    }
  };
  return { actor, writes, configs };
}

test("Create reads the real dialog callback and persists both kinds of influence", async () => {
  const h = harness();
  const created = await openActorEffectDialog({ actor: h.actor });
  assert.equal(created.id, "created");
  assert.equal(h.writes.length, 1);
  assert.equal(created.name, "Защита от огня");
  assert.equal(created.flags.ParovGrad.level, 2);
  assert.deepEqual(created.flags.ParovGrad.modifiers, [{ target: "will", value: 2 }]);
  assert.deepEqual(created.flags.ParovGrad.damageModifiers, [{ mode: "resistance", damageType: "fire" }]);
  const [config] = h.configs;
  assert.ok(config.classes.includes("pg-item-window"));
  assert.ok(config.classes.includes("pg-effect-window"));
  assert.equal(config.window.resizable, true);
  assert.ok(config.position.width >= 600);
  assert.equal(config.buttons.find(button => button.action === "save").default, true);
  assert.match(config.content, /pg-item-dossier pg-effect-dialog/);
  assert.match(config.content, /Тест &lt;&quot;героя&quot;>/);
});

test("Save updates an existing effect and keeps its disabled state and source flags", async () => {
  const h = harness({ fields: { name: "Изменённый эффект", modifiersData: "[]", damageModifiersData: "[]" } });
  const updates = [];
  const effect = { name: "Старый эффект", disabled: true, origin: "Item.original", flags: {
    module: { retained: true }, ParovGrad: { sourceItemUuid: "Item.original", sourceItemName: "Источник",
      itemApplication: "active", applicationId: "hit-1", damageModifiers: [{ mode: "immunity", damageType: "cold" }] }
  }, async update(patch) { updates.push(patch); } };
  assert.equal(await openActorEffectDialog({ actor: h.actor, effect }), effect);
  assert.equal(h.writes.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, "Изменённый эффект");
  assert.equal(updates[0].disabled, true);
  assert.equal(updates[0].origin, "Item.original");
  assert.deepEqual(updates[0].flags.module, { retained: true });
  assert.equal(updates[0].flags.ParovGrad.applicationId, "hit-1");
  assert.deepEqual(updates[0].flags.ParovGrad.damageModifiers, []);
});

test("the same dialog creates item effects with their requested application", async () => {
  const h = harness();
  h.actor.documentName = "Item";
  const created = await openActorEffectDialog({ actor: h.actor, itemApplication: "active" });
  assert.equal(created.flags.ParovGrad.itemApplication, "active");
});

test("Cancel and closing the dialog never create an effect", async () => {
  for (const action of ["cancel", "close"]) {
    const h = harness({ action });
    assert.equal(await openActorEffectDialog({ actor: h.actor }), null);
    assert.equal(h.writes.length, 0);
  }
});
