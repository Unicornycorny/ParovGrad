import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const effectSource = await readFile(new URL("../module/effects/effect-utils.js", import.meta.url), "utf8");
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectSource).toString("base64")}`;
const restSource = (await readFile(new URL("../module/actors/rest-recovery.js", import.meta.url), "utf8"))
  .replace('"../effects/effect-utils.js"', JSON.stringify(effectUrl));
const { getRestRecoveryPoints, getRestRecoverableEffects, applyRestRecovery } = await import(
  `data:text/javascript;base64,${Buffer.from(restSource).toString("base64")}`
);

function effect(id, level = 3, removal = "после отдыха", extra = {}) {
  return {
    id, name: `Эффект ${id}`, disabled: false, isSuppressed: false,
    flags: { ParovGrad: { level, removal, modifiers: [], impact: "Сохранить описание", sourceItemUuid: "Item.source" } },
    ...extra
  };
}

function actor(extra = {}) {
  const target = {
    documentName: "Actor", type: "Player", isOwner: true,
    effects: [effect("a"), effect("b", 2)], writes: [],
    system: { health: { value: 5 }, baseHealthMax: 20 },
    async updateEmbeddedDocuments(type, updates) {
      this.writes.push({ type, updates: structuredClone(updates) });
      for (const update of updates) {
        const entry = this.effects.find((candidate) => candidate.id === update._id);
        entry.flags.ParovGrad.level = update["flags.ParovGrad.level"];
      }
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.writes.push({ type, deletions: [...ids] });
      this.effects = this.effects.filter((entry) => !ids.includes(entry.id));
    },
    async update(patch) {
      this.writes.push({ actor: structuredClone(patch) });
      this.system.health.value = patch["system.health.value"];
    },
    ...extra
  };
  Object.defineProperty(target.system, "derivedHealthMax", {
    configurable: true,
    get() {
      const modifier = target.effects.filter((entry) => !entry.disabled && !entry.isSuppressed)
        .flatMap((entry) => entry.flags.ParovGrad.modifiers)
        .filter((entry) => entry.target === "healthMax")
        .reduce((sum, entry) => sum + entry.value, 0);
      return Math.max(0, this.baseHealthMax + modifier);
    }
  });
  return target;
}

test("D20 grants a shared point per full two above ten and rejects invalid dice", () => {
  for (let d20 = 1; d20 <= 20; d20++) {
    assert.equal(getRestRecoveryPoints(d20), d20 <= 11 ? 0 : Math.floor((d20 - 10) / 2));
  }
  for (const d20 of [0, 21, -1, 1.5, NaN, Infinity, "20", null, undefined]) {
    assert.throws(() => getRestRecoveryPoints(d20));
  }
});

test("only positive integer active effects with an exact normalized rest removal qualify", () => {
  const target = actor({ effects: [
    effect("normal"), effect("spaces", 1, "  ПОСЛЕ\u00a0\u00a0ОТДЫХА.  "),
    effect("newline", 1, "после\nотдыха!"),
    effect("negative-text", 1, "не снимается после отдыха"),
    effect("condition", 1, "после отдыха и лечения"), effect("empty", 1, ""),
    effect("disabled", 1, "после отдыха", { disabled: true }),
    effect("suppressed", 1, "после отдыха", { isSuppressed: true }),
    effect("zero", 0), effect("negative", -1), effect("fractional", 1.5)
  ] });
  assert.deepEqual(getRestRecoverableEffects(target).map((entry) => entry.id), ["normal", "spaces", "newline"]);
  assert.equal(getRestRecoverableEffects(target)[0].level, 3);
  assert.deepEqual(getRestRecoverableEffects(null), []);
});

test("points can be distributed, with partial updates preserving metadata and zero removing effects", async () => {
  const target = actor();
  const metadata = structuredClone(target.effects[0].flags.ParovGrad);
  const result = await applyRestRecovery(target, {
    d20: 16, reductions: [{ effectId: "a", points: 1 }, { effectId: "b", points: 2 }], healthRecovery: 4
  });
  assert.deepEqual(target.writes, [
    { type: "ActiveEffect", updates: [{ _id: "a", "flags.ParovGrad.level": 2 }] },
    { type: "ActiveEffect", deletions: ["b"] },
    { actor: { "system.health.value": 9 } }
  ]);
  assert.deepEqual(target.effects[0].flags.ParovGrad, { ...metadata, level: 2 });
  assert.deepEqual(result, {
    d20: 16, recoveryPoints: 3, spentPoints: 3,
    effects: [
      { id: "a", name: "Эффект a", previousLevel: 3, level: 2, removed: false },
      { id: "b", name: "Эффект b", previousLevel: 2, level: 0, removed: true }
    ],
    healthRecovered: 4, healthValue: 9, healthMax: 20
  });
});

test("multiple partial reductions and removals each use one embedded-document batch", async () => {
  const target = actor({ effects: [effect("a", 2), effect("b", 2), effect("c", 1), effect("d", 1)] });
  await applyRestRecovery(target, {
    d20: 18, reductions: [
      { effectId: "a", points: 1 }, { effectId: "b", points: 1 },
      { effectId: "c", points: 1 }, { effectId: "d", points: 1 }
    ]
  });
  assert.equal(target.writes.length, 2);
  assert.equal(target.writes[0].updates.length, 2);
  assert.deepEqual(target.writes[1].deletions, ["c", "d"]);
});

test("bad allocations, duplicates, foreign or newly ineligible effects never write", async () => {
  const invalid = [
    [{ effectId: "a", points: -1 }], [{ effectId: "a", points: 0.5 }],
    [{ effectId: "a", points: "1" }], [{ effectId: "a", points: 4 }],
    [{ effectId: "a", points: NaN }], [{ effectId: "foreign", points: 1 }],
    [{ effectId: "a", points: 1 }, { effectId: "a", points: 1 }],
    [{ effectId: "a", points: 2 }, { effectId: "b", points: 2 }],
    [null], null, {}
  ];
  for (const reductions of invalid) {
    const target = actor();
    await assert.rejects(applyRestRecovery(target, { d20: 16, reductions }), (error) => !error.restRecoveryStarted);
    assert.deepEqual(target.writes, []);
  }
  for (const replacement of [effect("a", 0), effect("a", 1, "лечение"), effect("a", 1, "после отдыха", { disabled: true })]) {
    const target = actor({ effects: [replacement] });
    await assert.rejects(applyRestRecovery(target, { d20: 20, reductions: [{ effectId: "a", points: 1 }] }));
    assert.deepEqual(target.writes, []);
  }
});

test("bad healing is rejected before effect writes", async () => {
  for (const healthRecovery of [-1, 1.5, NaN, Infinity, "2", null]) {
    const target = actor();
    await assert.rejects(applyRestRecovery(target, {
      d20: 20, reductions: [{ effectId: "b", points: 2 }], healthRecovery
    }), (error) => !error.restRecoveryStarted);
    assert.deepEqual(target.writes, []);
  }
});

test("owner and actor type are checked before any write", async () => {
  for (const extra of [{ isOwner: false }, { type: "NPC" }, { documentName: "Item" }]) {
    const target = actor(extra);
    await assert.rejects(applyRestRecovery(target, { d20: 20, healthRecovery: 5 }));
    assert.deepEqual(target.writes, []);
  }
});

test("health-only recovery works on a low roll and caps at the derived maximum", async () => {
  const target = actor();
  const result = await applyRestRecovery(target, { d20: 1, healthRecovery: 100 });
  assert.equal(result.healthRecovered, 15);
  assert.equal(result.healthValue, 20);
  assert.equal(result.spentPoints, 0);
  assert.deepEqual(target.writes, [{ actor: { "system.health.value": 20 } }]);
});

test("healing without a wellbeing roll caps HP and never changes effects or invents a D20 result", async () => {
  for (const rollOptions of [{}, { d20: null }, { d20: undefined }]) {
    const target = actor();
    const originalEffects = structuredClone(target.effects);
    const result = await applyRestRecovery(target, { ...rollOptions, healthRecovery: 100 });
    assert.equal(result.d20, null);
    assert.equal(result.recoveryPoints, 0);
    assert.equal(result.spentPoints, 0);
    assert.deepEqual(result.effects, []);
    assert.equal(result.healthRecovered, 15);
    assert.equal(result.healthValue, 20);
    assert.deepEqual(target.effects, originalEffects);
    assert.deepEqual(target.writes, [{ actor: { "system.health.value": 20 } }]);
  }
});

test("effect recovery without a roll and invalid provided rolls are rejected before writing", async () => {
  for (const rollOptions of [{}, { d20: null }, { d20: undefined }]) {
    const target = actor();
    await assert.rejects(applyRestRecovery(target, {
      ...rollOptions, reductions: [{ effectId: "a", points: 1 }], healthRecovery: 10
    }), (error) => !error.restRecoveryStarted);
    assert.deepEqual(target.writes, []);
  }
  for (const d20 of [0, 21, -1, 1.5, NaN, Infinity, "20", false]) {
    const target = actor();
    await assert.rejects(applyRestRecovery(target, { d20, healthRecovery: 10 }));
    assert.deepEqual(target.writes, []);
  }
});

test("healing reads the new maximum after removing its penalty effect", async () => {
  const penalty = effect("penalty", 1);
  penalty.flags.ParovGrad.modifiers = [{ target: "healthMax", value: -15 }];
  const target = actor({ effects: [penalty] });
  assert.equal(target.system.derivedHealthMax, 5);
  const result = await applyRestRecovery(target, {
    d20: 12, reductions: [{ effectId: "penalty", points: 1 }], healthRecovery: 20
  });
  assert.equal(result.healthMax, 20);
  assert.equal(result.healthValue, 20);
  assert.equal(result.healthRecovered, 15);
  assert.deepEqual(target.writes[0], { type: "ActiveEffect", deletions: ["penalty"] });
});

test("zero allocations, zero healing and full health do not produce unnecessary writes", async () => {
  const target = actor();
  const result = await applyRestRecovery(target, { d20: 10, reductions: [{ effectId: "a", points: 0 }] });
  assert.deepEqual(target.writes, []);
  assert.deepEqual(result.effects, []);
  assert.equal(result.healthRecovered, 0);
  target.system.health.value = 20;
  await applyRestRecovery(target, { d20: 20, healthRecovery: 10 });
  assert.deepEqual(target.writes, []);
  target.system.health.value = 30;
  const overMax = await applyRestRecovery(target, { d20: 20, healthRecovery: 10 });
  assert.equal(overMax.healthValue, 30);
  assert.equal(overMax.healthRecovered, 0);
  assert.deepEqual(target.writes, []);
});

test("effect-only recovery preserves HP even if removing a bonus lowers the maximum", async () => {
  const bonus = effect("bonus", 1);
  bonus.flags.ParovGrad.modifiers = [{ target: "healthMax", value: 10 }];
  const target = actor({ effects: [bonus] });
  target.system.health.value = 25;
  const result = await applyRestRecovery(target, { d20: 12, reductions: [{ effectId: "bonus", points: 1 }] });
  assert.equal(result.healthValue, 25);
  assert.equal(result.healthMax, 20);
  assert.equal(result.healthRecovered, 0);
  assert.equal(target.writes.length, 1);
});

test("mutation failures are marked for the UI, are never retried, and release the actor lock", async () => {
  const target = actor();
  target.updateEmbeddedDocuments = async () => {
    target.writes.push("failed");
    throw new Error("Storage failed");
  };
  const options = { d20: 12, reductions: [{ effectId: "a", points: 1 }] };
  await assert.rejects(applyRestRecovery(target, options), (error) => error.restRecoveryStarted === true);
  assert.deepEqual(target.writes, ["failed"]);
  await applyRestRecovery(target, { d20: 1 });
  assert.deepEqual(target.writes, ["failed"]);
});

test("concurrent recovery on the same actor is rejected while writes are pending", async () => {
  let finish;
  const target = actor();
  const write = target.updateEmbeddedDocuments.bind(target);
  target.updateEmbeddedDocuments = async (...args) => {
    await new Promise((resolve) => { finish = resolve; });
    return write(...args);
  };
  const first = applyRestRecovery(target, { d20: 12, reductions: [{ effectId: "a", points: 1 }] });
  await assert.rejects(applyRestRecovery(target, { d20: 20, healthRecovery: 5 }), (error) => !error.restRecoveryStarted);
  assert.deepEqual(target.writes, []);
  finish();
  await first;
  await applyRestRecovery(target, { d20: 1 });
});

test("silently cancelled effect updates or deletions fail before healing and mark the attempted mutation", async () => {
  for (const [method, points] of [["updateEmbeddedDocuments", 1], ["deleteEmbeddedDocuments", 3]]) {
    const target = actor();
    target[method] = async () => {
      target.writes.push("cancelled");
      return [];
    };
    await assert.rejects(applyRestRecovery(target, {
      d20: 20, reductions: [{ effectId: "a", points }], healthRecovery: 10
    }), (error) => error.restRecoveryStarted === true);
    assert.deepEqual(target.writes, ["cancelled"]);
    assert.equal(target.effects[0].flags.ParovGrad.level, 3);
    assert.equal(target.system.health.value, 5);
  }
});

test("silently cancelled or rewritten healing fails and cannot be reported as successful recovery", async () => {
  for (const nextValue of [5, 7]) {
    const target = actor();
    target.update = async () => {
      target.writes.push("intercepted healing");
      target.system.health.value = nextValue;
    };
    await assert.rejects(applyRestRecovery(target, {
      d20: 1, healthRecovery: 10
    }), (error) => error.restRecoveryStarted === true);
    assert.deepEqual(target.writes, ["intercepted healing"]);
  }
});
