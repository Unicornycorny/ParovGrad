import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

function mergeObject(base, extra) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) result[key] = value && typeof value === "object" && !Array.isArray(value)
    ? mergeObject(result[key] ?? {}, value) : structuredClone(value);
  return result;
}
globalThis.foundry = { utils: { deepClone: structuredClone, mergeObject } };
globalThis.game = { user: { isGM: true } };
globalThis.ui = { notifications: { info() {} } };
const effects = await importModule(new URL("../module/effects/effect-utils.js", import.meta.url));

function container(documentName, uuid, extra = {}) {
  return { documentName, uuid, isOwner: true, name: uuid, effects: [], ...extra,
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const created = data.map((entry, index) => ({ ...structuredClone(entry), documentName: "ActiveEffect",
        id: `effect-${this.effects.length + index}`, uuid: `${this.uuid}.ActiveEffect.${this.effects.length + index}`, parent: this }));
      this.effects.push(...created);
      return created;
    }
  };
}

test("animation metadata survives template attachment, frozen item application and cloning without sharing mutable state", async () => {
  const animation = { enabled: true, persistent: "jb2a.valid.aura", scale: 1.5, opacity: 0.8 };
  const template = { documentName: "Item", type: "effect", uuid: "Item.template", name: "Аура",
    system: { modifiers: [] }, flags: { ParovGrad: { animation } } };
  const weapon = container("Item", "Actor.source.Item.weapon", { type: "weapon" });
  const attached = await effects.addEffectToItem(weapon, template, "active");
  const snapshot = effects.getActiveItemEffectData(weapon);
  template.flags.ParovGrad.animation.persistent = "jb2a.changed";
  attached.flags.ParovGrad.animation.scale = 9;
  const victim = container("Actor", "Actor.victim");
  const [applied] = await effects.applyItemEffectDataToActor(victim, snapshot, { applicationId: "cast-1" });
  assert.deepEqual(applied.flags.ParovGrad.animation, { enabled: true, persistent: "jb2a.valid.aura", scale: 1.5, opacity: 0.8 });
  const copyTarget = container("Actor", "Actor.other");
  const cloned = await effects.cloneActiveEffectToActor(copyTarget, applied);
  applied.flags.ParovGrad.animation.scale = 3;
  assert.equal(cloned.flags.ParovGrad.animation.scale, 1.5);
});

test("an effect template applies its aura directly and leaves existing mechanical modifiers intact", async () => {
  const template = { documentName: "Item", type: "effect", uuid: "Item.aura", name: "Аура",
    system: { modifiers: [{ target: "will", value: 2 }] },
    flags: { ParovGrad: { animation: { enabled: true, persistent: "jb2a.valid.aura" } } } };
  const actor = container("Actor", "Actor.receiver");
  const applied = await effects.applyEffectItemToActor(actor, template);
  assert.equal(applied.flags.ParovGrad.animation.persistent, "jb2a.valid.aura");
  assert.deepEqual(applied.flags.ParovGrad.modifiers, [{ target: "will", value: 2 }]);
});
