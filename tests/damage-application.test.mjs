import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const { applyTypedDamage, getAppliedDamage } = await importModule(new URL("../module/damage/damage-types.js", import.meta.url));

function target(health = 20) {
  return {
    system: { health: { value: health } }, flags: { otherModule: { value: 42 } }, writes: [],
    async update(patch) {
      this.writes.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split(".");
        const key = parts.pop();
        let parent = this;
        for (const part of parts) parent = parent[part] ??= {};
        parent[key] = structuredClone(value);
      }
      return this;
    }
  };
}

const damage = [{ amount: 5, category: "typed", damageType: "fire" }];

test("a tracked damage update saves HP and its receipt together, then ignores repeated application", async () => {
  const actor = target();
  const expected = { amount: 5, before: 20, after: 15 };
  assert.equal(getAppliedDamage(actor, "ChatMessage.damage"), null);
  assert.deepEqual(await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.damage" }), expected);
  assert.equal(actor.writes.length, 1);
  assert.equal(actor.writes[0]["system.health.value"], 15);
  const [receiptPath] = Object.keys(actor.writes[0]).filter(path => path.startsWith("flags."));
  assert.match(receiptPath, /^flags\.ParovGrad\.damageApplications\.id_[a-f0-9]+$/);
  assert.deepEqual(actor.writes[0][receiptPath], expected);
  assert.deepEqual(getAppliedDamage(actor, "ChatMessage.damage"), expected);
  assert.deepEqual(await applyTypedDamage(actor, [{ amount: 99 }], { applicationId: "ChatMessage.damage" }), expected);
  assert.equal(actor.system.health.value, 15);
  assert.equal(actor.writes.length, 1);
  assert.deepEqual(actor.flags.otherModule, { value: 42 });
});

test("distinct and dotted application IDs cannot collide or change the receipt when returned data is edited", async () => {
  const actor = target();
  const first = await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.a.b" });
  first.after = 100;
  assert.equal(getAppliedDamage(actor, "ChatMessage.a.b").after, 15);
  await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.a%2Eb" });
  await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.эффект🧪" });
  assert.equal(actor.system.health.value, 5);
  assert.equal(Object.keys(actor.flags.ParovGrad.damageApplications).length, 3);
  assert.equal(getAppliedDamage(actor, "ChatMessage.a.b").before, 20);
  assert.equal(getAppliedDamage(actor, "ChatMessage.a%2Eb").before, 15);
});

test("an exception after persistence returns the receipt and a later retry cannot damage twice", async () => {
  const actor = target();
  const update = actor.update;
  actor.update = async function (patch) {
    await update.call(this, patch);
    throw new Error("Hook failed after update");
  };
  assert.deepEqual(await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.once" }), { amount: 5, before: 20, after: 15 });
  assert.deepEqual(await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.once" }), { amount: 5, before: 20, after: 15 });
  assert.equal(actor.writes.length, 1);
});

test("failed and silently cancelled updates never record successful application and permit retry", async () => {
  const actor = target();
  const update = actor.update;
  actor.update = async () => { throw new Error("Permission denied"); };
  await assert.rejects(applyTypedDamage(actor, damage, { applicationId: "ChatMessage.retry" }), /Permission/);
  assert.equal(getAppliedDamage(actor, "ChatMessage.retry"), null);
  actor.update = async () => undefined;
  await assert.rejects(applyTypedDamage(actor, damage, { applicationId: "ChatMessage.retry" }), /Не удалось подтвердить/);
  assert.equal(actor.system.health.value, 20);
  actor.update = update;
  await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.retry" });
  assert.equal(actor.system.health.value, 15);
  assert.equal(actor.writes.length, 1);
});

test("overlapping calls share one in-flight update for the same actor and application", async () => {
  const actor = target();
  const update = actor.update;
  let release;
  actor.update = async function (patch) {
    await new Promise(resolve => { release = resolve; });
    return update.call(this, patch);
  };
  const first = applyTypedDamage(actor, damage, { applicationId: "ChatMessage.concurrent" });
  const second = applyTypedDamage(actor, damage, { applicationId: "ChatMessage.concurrent" });
  release();
  assert.deepEqual(await first, await second);
  assert.equal(actor.system.health.value, 15);
  assert.equal(actor.writes.length, 1);
});

test("half damage, zero damage and clamping retain a stable receipt even when health does not change", async () => {
  const actor = target(2);
  assert.deepEqual(await applyTypedDamage(actor, damage, { half: true, applicationId: "ChatMessage.half" }), { amount: 2, before: 2, after: 0 });
  assert.deepEqual(await applyTypedDamage(actor, damage, { applicationId: "ChatMessage.zero-health" }), { amount: 5, before: 0, after: 0 });
  assert.deepEqual(await applyTypedDamage(actor, [], { applicationId: "ChatMessage.no-damage" }), { amount: 0, before: 0, after: 0 });
  assert.equal(actor.writes.length, 3);
  assert.equal(getAppliedDamage(actor, "ChatMessage.no-damage").amount, 0);
});

test("untracked damage preserves legacy patch and result without creating a receipt", async () => {
  const actor = target(7);
  assert.deepEqual(await applyTypedDamage(actor, damage, { half: true }), { amount: 2, before: 7, after: 5 });
  assert.deepEqual(actor.writes, [{ "system.health.value": 5 }]);
  assert.equal(actor.flags.ParovGrad, undefined);
  assert.equal(getAppliedDamage(actor, ""), null);
});
