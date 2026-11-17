import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const { calculateDamage, applyTypedDamage, getAppliedDamage, DAMAGE_TYPES } = await importModule(
  new URL("../module/damage/damage-types.js", import.meta.url)
);

const part = (amount, damageType = "fire") => ({ amount, category: "typed", damageType });
const modifier = (mode, damageType = "fire") => ({ mode, damageType });
function effect(damageModifiers, extra = {}) {
  return { flags: { ParovGrad: { damageModifiers } }, ...extra };
}
function target(effects = [], items = []) {
  return {
    effects, items, flags: {}, system: { health: { value: 100 } }, writes: [],
    async update(patch) {
      this.writes.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split(".");
        let parent = this;
        for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
        parent[keys.at(-1)] = structuredClone(value);
      }
    }
  };
}
function equipment(effects, equipped = true, type = "item") {
  return { type, system: { equipped }, effects };
}

test("every damage type supports immunity, resistance rounding, and vulnerability", () => {
  for (const type of Object.keys(DAMAGE_TYPES)) {
    for (const [mode, expected] of [["immunity", 0], ["resistance", 2], ["vulnerability", 10]]) {
      const actor = target([effect([modifier(mode, type)])]);
      assert.equal(calculateDamage([part(5, type)], { actor }), expected, `${type}: ${mode}`);
    }
  }
});

test("only matching damage is transformed, after combining components of the same type", () => {
  const actor = target([effect([modifier("resistance")])]);
  const parts = [part(3), part(2), part(7, "cold"), part(3, "slashing")];
  const original = structuredClone(parts);
  assert.equal(calculateDamage(parts, { actor }), 12);
  assert.equal(calculateDamage([part(1), part(1)], { actor }), 1);
  assert.deepEqual(parts, original);
});

test("different damage types each round their own resistance down", () => {
  const actor = target([effect([modifier("resistance", "all")])]);
  assert.equal(calculateDamage([part(3), part(3, "cold")], { actor }), 2);
  assert.equal(calculateDamage([part(1), part(1, "cold")], { actor }), 0);
});

test("same-mode effects from actors and multiple worn items never stack", () => {
  for (const [mode, expected] of [["immunity", 0], ["resistance", 2], ["vulnerability", 10]]) {
    const actor = target(
      [effect([modifier(mode), modifier(mode, "all")])],
      [equipment([effect([modifier(mode)])]), equipment([effect([modifier(mode)])], true, "weapon")]
    );
    assert.equal(calculateDamage([part(5)], { actor }), expected);
  }
});

test("immunity wins, and resistance rounds down before vulnerability doubles", () => {
  const actor = target([effect([modifier("resistance"), modifier("vulnerability")])]);
  assert.equal(calculateDamage([part(5)], { actor }), 4);
  assert.equal(calculateDamage([part(1)], { actor }), 0);
  actor.effects.push(effect([modifier("immunity")]));
  assert.equal(calculateDamage([part(5), part(7, "cold")], { actor }), 7);
});

test("half damage is applied before defenses, without premature per-type rounding", () => {
  const parts = [part(3), part(3, "cold")];
  assert.equal(calculateDamage(parts, { half: true }), 3);
  const actor = target([effect([modifier("vulnerability")])]);
  assert.equal(calculateDamage([part(5)], { actor, half: true }), 5);
  actor.effects[0] = effect([modifier("resistance"), modifier("vulnerability")]);
  assert.equal(calculateDamage([part(5)], { actor, half: true }), 2);
  actor.effects[0] = effect([modifier("resistance")]);
  assert.equal(calculateDamage([part(5)], { actor, half: true }), 1);
  actor.effects[0] = effect([modifier("immunity")]);
  assert.equal(calculateDamage(parts, { actor, half: true }), 1);
});

test("all, physical, and unspecified selectors distinguish old physical damage from unknown types", () => {
  const parts = [part(5, "bludgeoning"), part(5, "piercing"), part(5, "slashing"), part(5),
    { amount: 5, category: "unspecified", damageType: null }];
  const actor = target([effect([modifier("immunity", "physical")])]);
  assert.equal(calculateDamage(parts, { actor }), 10);
  assert.equal(calculateDamage([{ amount: 5, category: "physical" }], { actor }), 0);
  assert.equal(calculateDamage([{ amount: 5 }], { actor }), 0);
  actor.effects[0] = effect([modifier("immunity", "unspecified")]);
  assert.equal(calculateDamage(parts, { actor }), 20);
  assert.equal(calculateDamage([part(5, "invalid")], { actor }), 0);
  actor.effects[0] = effect([modifier("immunity", "all")]);
  assert.equal(calculateDamage(parts, { actor }), 0);
});

test("worn equipment is live, active item effects wait until transferred, and disabled effects are ignored", () => {
  const worn = equipment([effect([modifier("resistance")])]);
  const actor = target([], [worn]);
  assert.equal(calculateDamage([part(5)], { actor }), 2);
  worn.system.equipped = false;
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  worn.system.equipped = true;
  worn.effects[0].disabled = true;
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  worn.effects[0].disabled = false;
  worn.effects[0].isSuppressed = true;
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  worn.effects[0].isSuppressed = false;
  worn.effects[0].flags.ParovGrad.itemApplication = "active";
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  actor.effects.push(structuredClone(worn.effects[0]));
  assert.equal(calculateDamage([part(5)], { actor }), 2);
  actor.effects[0].disabled = true;
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  actor.effects[0].disabled = false;
  actor.effects[0].isSuppressed = true;
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  actor.effects = [];
  worn.effects[0].flags.ParovGrad.itemApplication = "passive";
  worn.type = "spell";
  assert.equal(calculateDamage([part(5)], { actor }), 5);
  worn.type = "weapon";
  assert.equal(calculateDamage([part(5)], { actor }), 2);
  actor.items = [];
  assert.equal(calculateDamage([part(5)], { actor }), 5);
});

test("damage checks the target's current defenses when applied and keeps once-only receipts", async () => {
  const actor = target([effect([modifier("immunity")])]);
  const immune = { amount: 0, before: 100, after: 100 };
  assert.deepEqual(await applyTypedDamage(actor, [part(5)], { applicationId: "damage.immune" }), immune);
  actor.effects = [effect([modifier("vulnerability")])];
  assert.deepEqual(await applyTypedDamage(actor, [part(5)], { applicationId: "damage.immune" }), immune);
  assert.equal(actor.writes.length, 1);
  assert.deepEqual(getAppliedDamage(actor, "damage.immune"), immune);
  assert.deepEqual(await applyTypedDamage(actor, [part(5)], { applicationId: "damage.vulnerable" }),
    { amount: 10, before: 100, after: 90 });
  actor.effects = [effect([modifier("resistance")])];
  assert.deepEqual(await applyTypedDamage(actor, [part(5)]), { amount: 2, before: 90, after: 88 });
});

test("negative or invalid components never heal and vulnerability still clamps health at zero", async () => {
  const actor = target([effect([modifier("vulnerability", "all")])]);
  actor.system.health.value = 3;
  assert.equal(calculateDamage([part(-5), part(NaN), part(Infinity), part("invalid")], { actor }), 0);
  assert.deepEqual(await applyTypedDamage(actor, [part(5)]), { amount: 10, before: 3, after: 0 });
});
