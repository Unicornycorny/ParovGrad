import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];
const errors = [];
const messages = [];
const dice = [];
const appliedRollModes = [];
let nextD20 = 18;
let currentRollMode = "publicroll";
let chatFailure = null;
let rollChatFailure = null;

globalThis.ui = { notifications: {
  warn: (message) => warnings.push(message),
  error: (message) => errors.push(message),
  info() {}
} };

class ApplicationV2 {
  constructor(options) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
  _attachPartListeners() {}
  async render() { this.context = await this._prepareContext({}); this.rendered = true; return this; }
  async close() { this.rendered = false; return this; }
  bringToFront() { return this; }
}

globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } },
  utils: { escapeHTML: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;") }
};
globalThis.game = { settings: { get: () => currentRollMode } };
globalThis.ChatMessage = class {
  static getSpeaker({ actor }) { return { actor: actor.id, alias: actor.name }; }
  static applyRollMode(data, mode) { appliedRollModes.push({ data, mode }); }
  static async create(data) {
    if (chatFailure) throw chatFailure;
    messages.push(data);
    return data;
  }
};
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; this.total = nextD20; this.messages = []; dice.push(this); }
  async evaluate() { return this; }
  async toMessage(data, options) {
    this.messages.push(data);
    this.chatOptions = options;
    if (rollChatFailure) throw rollChatFailure;
    return data;
  }
};

globalThis.__restAppTestHelper = {
  getRestRecoveryPoints: (d20) => Math.max(0, Math.floor((d20 - 10) / 2)),
  getRestRecoverableEffects: (actor) => actor.effectViews.map((effect) => ({ ...effect })),
  async applyRestRecovery(actor, options) {
    actor.calls.push(structuredClone(options));
    if (!actor.isOwner) throw new Error("Недостаточно прав для отдыха персонажа.");
    if (actor.applyError) throw actor.applyError;
    if (!Number.isInteger(options.healthRecovery) || options.healthRecovery < 0) {
      throw new Error("Восстановление здоровья должно быть целым неотрицательным числом.");
    }
    await actor.beforeApply?.();
    actor.writes.push(structuredClone(options));
    const effects = options.reductions.filter((entry) => entry.points > 0).map((entry) => {
      const effect = actor.effectViews.find((view) => view.id === entry.effectId);
      return { id: effect.id, name: effect.name, previousLevel: effect.level,
        level: effect.level - entry.points, removed: effect.level === entry.points };
    });
    const healthBefore = actor.system.health.value;
    actor.system.health.value = Math.min(actor.system.derivedHealthMax, healthBefore + options.healthRecovery);
    return { d20: options.d20, recoveryPoints: options.d20 === null ? 0 : Math.max(0, Math.floor((options.d20 - 10) / 2)),
      spentPoints: options.reductions.reduce((sum, entry) => sum + entry.points, 0),
      effects, healthRecovered: actor.system.health.value - healthBefore,
      healthValue: actor.system.health.value,
      healthMax: actor.system.derivedHealthMax };
  }
};
const helperSource = `
export const getRestRecoveryPoints = (...args) => globalThis.__restAppTestHelper.getRestRecoveryPoints(...args);
export const getRestRecoverableEffects = (...args) => globalThis.__restAppTestHelper.getRestRecoverableEffects(...args);
export const applyRestRecovery = (...args) => globalThis.__restAppTestHelper.applyRestRecovery(...args);
`;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`;
const appSource = (await readFile(new URL("../module/apps/rest-recovery-dialog.js", import.meta.url), "utf8"))
  .replace('from "../actors/rest-recovery.js"', `from "${helperUrl}"`);
const { openActorRestDialog } = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`);

function actor(extra = {}) {
  return {
    id: "player", documentName: "Actor", type: "Player", name: "Персонаж", isOwner: true,
    system: { health: { value: 5 }, derivedHealthMax: 20 },
    effectViews: [
      { id: "fatigue", name: "Усталость", img: "fatigue.svg", level: 3, removal: "после отдыха" },
      { id: "cold", name: "Озноб", img: "cold.svg", level: 2, removal: "после отдыха" }
    ],
    calls: [], writes: [], ...extra
  };
}

function control(extra = {}) {
  return {
    value: "", disabled: false, listeners: new Map(), dataset: {}, ...extra,
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    checkValidity() { return true; },
    reportValidity() { return true; },
    setCustomValidity(value) { this.validationMessage = value; },
    async emit(type) { await this.listeners.get(type)?.({ currentTarget: this, preventDefault() {}, stopPropagation() {} }); }
  };
}

function view(app) {
  const roll = control();
  const apply = control();
  const heal = control();
  const cancel = control();
  const health = control({ value: String(app.context.healthRecovery ?? 0) });
  const fields = (app.context.rolled ? app.context.effects ?? [] : []).map((effect) => control({
    value: String(effect.points ?? 0), dataset: { restEffectId: effect.id }, max: String(effect.maxReduction ?? effect.level)
  }));
  const counts = new Map();
  const html = {
    querySelector(selector) {
      const controls = { ".pg-rest-roll": roll, ".pg-rest-apply": apply, ".pg-rest-heal": heal, ".pg-rest-cancel": cancel,
        ".pg-rest-health": health };
      if (Object.hasOwn(controls, selector)) return controls[selector];
      if (!counts.has(selector)) counts.set(selector, { textContent: "", classList: { toggle() {} } });
      return counts.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === "input[data-rest-effect-id]") return fields;
      if (selector.includes("input") || selector.includes("button")) return [roll, apply, heal, cancel, health, ...fields];
      return [];
    },
    reportValidity() { return true; },
    checkValidity() { return true; }
  };
  app._attachPartListeners("main", html, {});
  return { html, roll, apply, heal, cancel, health, fields };
}

async function quietly(action) {
  const originalError = console.error;
  console.error = () => {};
  try { return await action(); }
  finally { console.error = originalError; }
}

test("only an owned Player Actor can open rest", async () => {
  for (const extra of [{ isOwner: false }, { type: "NPC" }, { documentName: "Item" }]) {
    const target = actor(extra);
    assert.equal(await openActorRestDialog(target), undefined);
    assert.deepEqual(target.calls, []);
    assert.deepEqual(target.writes, []);
  }
});

test("one actor shares one open rest session, with one plain d20 roll", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  assert.equal(app.context.rolled, false);
  assert.equal(await openActorRestDialog(target), app);
  const before = dice.length;
  await app._rollRecovery();
  assert.equal(app.context.rolled, true);
  assert.equal(app.context.d20, 18);
  assert.equal(app.context.recoveryPoints, 4);
  assert.equal(dice.length, before + 1);
  assert.equal(dice.at(-1).formula, "1d20");
  assert.equal(dice.at(-1).messages.length, 1);
  await app._rollRecovery();
  assert.equal(dice.length, before + 1, "the same rest cannot roll again");
  assert.deepEqual(target.writes, []);
  await app.close();
  assert.notEqual(await openActorRestDialog(target), app);
});

test("cancelling after a roll discards pending reductions and healing", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  form.fields[0].value = "2";
  form.health.value = "5";
  await form.fields[0].emit("input");
  await form.health.emit("input");
  await form.cancel.emit("click");
  assert.equal(app.rendered, false);
  assert.deepEqual(target.calls, []);
  assert.deepEqual(target.writes, []);
});

test("a failed roll chat message retains the result without allowing a reroll", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  const before = dice.length;
  rollChatFailure = new Error("Не удалось отправить бросок");
  try { await quietly(() => app._rollRecovery()); }
  finally { rollChatFailure = null; }
  assert.equal(app.context.d20, 18);
  assert.equal(app.context.rolled, true);
  await app._rollRecovery();
  assert.equal(dice.length, before + 1);
  await app._applyRecovery(view(app).html);
  assert.equal(target.writes.length, 1);
});

test("applying effects passes the chosen allocation once and never heals", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  form.fields[0].value = "2";
  form.fields[1].value = "1";
  form.health.value = "6";
  const before = messages.length;
  await app._applyRecovery(form.html);
  assert.equal(target.writes.length, 1);
  assert.deepEqual(target.writes[0], { d20: 18,
    reductions: [{ effectId: "fatigue", points: 2 }, { effectId: "cold", points: 1 }], healthRecovery: 0 });
  assert.equal(target.system.health.value, 5, "typing health alone does not heal when applying effects");
  assert.equal(app.rendered, false);
  assert.equal(app._applied, true);
  assert.equal(messages.length, before + 1);
  await app._applyRecovery(form.html);
  assert.equal(target.writes.length, 1, "a completed rest cannot apply a second time");
});

test("applying without a roll cannot change the actor", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  await app._applyRecovery(view(app).html);
  assert.deepEqual(target.calls, []);
  assert.deepEqual(target.writes, []);
});

test("manual healing works before any d20, leaves effects intact, and keeps rest open", async () => {
  const target = actor();
  const originalEffects = structuredClone(target.effectViews);
  const app = await openActorRestDialog(target);
  const form = view(app);
  const before = dice.length;
  const beforeMessages = messages.length;
  form.health.value = "4";
  await form.heal.emit("click");
  assert.deepEqual(target.writes, [{ d20: null, reductions: [], healthRecovery: 4 }]);
  assert.equal(target.system.health.value, 9);
  assert.equal(app.context.healthValue, 9);
  assert.equal(app.rendered, true);
  assert.equal(app._applied, false);
  assert.equal(app._roll, null);
  assert.equal(app.context.rolled, false);
  assert.equal(app.context.healthRecovery, "0");
  assert.equal(dice.length, before, "healing does not create a d20 roll");
  assert.deepEqual(target.effectViews, originalEffects);
  assert.equal(messages.length, beforeMessages + 1);
  assert.doesNotMatch(messages.at(-1).content, /D20|Самочувствие/);
});

test("healing before and after d20 preserves its result and pending allocations", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  const initial = view(app);
  initial.health.value = "2";
  await app._healRecovery(initial.html);
  await app._rollRecovery();
  const roll = app._roll;
  const rolled = view(app);
  rolled.fields[0].value = "2";
  rolled.fields[1].value = "1";
  await rolled.fields[0].emit("input");
  await rolled.fields[1].emit("input");
  rolled.health.value = "3";
  await app._healRecovery(rolled.html);
  assert.equal(app._roll, roll);
  assert.equal(app.context.d20, 18);
  assert.equal(app.context.spentPoints, 3);
  assert.equal(app.rendered, true);
  assert.deepEqual([...app._reductions], [["fatigue", "2"], ["cold", "1"]]);
  assert.deepEqual(app.context.effects.map((effect) => effect.points), ["2", "1"]);
  assert.equal(target.system.health.value, 10);
  const final = view(app);
  final.health.value = "8";
  await app._applyRecovery(final.html);
  assert.equal(target.system.health.value, 10, "applying effects does not repeat healing");
  assert.deepEqual(target.writes, [
    { d20: null, reductions: [], healthRecovery: 2 },
    { d20: null, reductions: [], healthRecovery: 3 },
    { d20: 18, reductions: [{ effectId: "fatigue", points: 2 }, { effectId: "cold", points: 1 }], healthRecovery: 0 }
  ]);
});

test("invalid manual healing leaves the rest open for correction without rolling", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  const form = view(app);
  const before = dice.length;
  for (const value of ["-1", "1.5", "NaN"]) {
    form.health.value = value;
    await quietly(() => app._healRecovery(form.html));
    assert.equal(app.rendered, true);
    assert.equal(app._failed, false);
    assert.equal(app._busy, false);
    assert.deepEqual(target.writes, []);
    assert.equal(target.system.health.value, 5);
  }
  form.health.value = "2";
  await app._healRecovery(form.html);
  assert.equal(target.system.health.value, 7);
  assert.equal(dice.length, before);
});

test("a healing mutation failure blocks retry and the recovery roll", async () => {
  const failure = Object.assign(new Error("Ошибка записи здоровья"), { restRecoveryStarted: true });
  const target = actor({ applyError: failure });
  const app = await openActorRestDialog(target);
  const form = view(app);
  form.health.value = "4";
  const before = dice.length;
  await quietly(() => app._healRecovery(form.html));
  assert.equal(app._failed, true);
  assert.equal(app._busy, false);
  assert.equal(target.calls.length, 1);
  target.applyError = null;
  await app._healRecovery(form.html);
  await app._rollRecovery();
  assert.equal(target.calls.length, 1);
  assert.equal(dice.length, before);
});

test("manual healing remains available with a low d20 and no eligible effects", async () => {
  const target = actor({ effectViews: [] });
  const app = await openActorRestDialog(target);
  nextD20 = 10;
  try { await app._rollRecovery(); }
  finally { nextD20 = 18; }
  assert.equal(app.context.recoveryPoints, 0);
  assert.deepEqual(app.context.effects, []);
  const form = view(app);
  form.health.value = "3";
  await app._healRecovery(form.html);
  assert.deepEqual(target.writes, [{ d20: null, reductions: [], healthRecovery: 3 }]);
  assert.equal(app.rendered, true);
  assert.equal(app.context.d20, 10);
  assert.equal(app.context.healthValue, 8);
});

test("a validation error keeps the session open for correction without rerolling", async () => {
  const target = actor({ applyError: new Error("Недостаточно пунктов восстановления.") });
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  form.fields[0].value = "1";
  await quietly(() => app._applyRecovery(form.html));
  assert.equal(app.rendered, true);
  assert.equal(app._failed, false);
  assert.equal(app._busy, false);
  assert.deepEqual(target.writes, []);
  target.applyError = null;
  await app._applyRecovery(form.html);
  assert.equal(target.writes.length, 1);
  assert.equal(target.writes[0].d20, 18);
});

test("an error after mutation starts blocks applying the same rest again", async () => {
  const failure = Object.assign(new Error("Не удалось завершить восстановление."), { restRecoveryStarted: true });
  const target = actor({ applyError: failure });
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  form.fields[0].value = "1";
  await quietly(() => app._applyRecovery(form.html));
  assert.equal(app._failed, true);
  assert.equal(app._busy, false);
  assert.equal(target.calls.length, 1);
  target.applyError = null;
  await app._applyRecovery(form.html);
  assert.equal(target.calls.length, 1, "partial success must not be replayed");
});

test("a failed effect chat summary never permits effects to apply twice", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  form.fields[0].value = "1";
  chatFailure = new Error("Чат недоступен");
  try { await quietly(() => app._applyRecovery(form.html)); }
  finally { chatFailure = null; }
  assert.equal(target.writes.length, 1);
  assert.equal(app._applied, true);
  await app._applyRecovery(form.html);
  assert.equal(target.writes.length, 1);
});

test("a healing chat failure still resets its input after successful healing", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  const form = view(app);
  form.health.value = "4";
  chatFailure = new Error("Чат недоступен");
  try { await quietly(() => app._healRecovery(form.html)); }
  finally { chatFailure = null; }
  assert.equal(target.system.health.value, 9);
  assert.equal(app.rendered, true);
  assert.equal(app._failed, false);
  assert.equal(app._applied, false);
  assert.equal(app.context.healthRecovery, "0");
  const next = view(app);
  await app._healRecovery(next.html);
  assert.equal(target.system.health.value, 9, "the successful amount is not retained after a chat error");
});

test("the rest summary preserves the visibility selected for its roll", async () => {
  const target = actor();
  const app = await openActorRestDialog(target);
  try {
    currentRollMode = "gmroll";
    await app._rollRecovery();
    assert.equal(dice.at(-1).chatOptions.rollMode, "gmroll");
    currentRollMode = "publicroll";
    const before = appliedRollModes.length;
    await app._applyRecovery(view(app).html);
    assert.equal(appliedRollModes.length, before + 1);
    assert.equal(appliedRollModes.at(-1).mode, "gmroll");
    assert.equal(appliedRollModes.at(-1).data, messages.at(-1));
  } finally { currentRollMode = "publicroll"; }
});

test("concurrent apply clicks run a single recovery", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const target = actor({ beforeApply: () => gate });
  const app = await openActorRestDialog(target);
  await app._rollRecovery();
  const form = view(app);
  const first = app._applyRecovery(form.html);
  await app._applyRecovery(form.html);
  assert.equal(target.calls.length, 1);
  release();
  await first;
  assert.equal(target.writes.length, 1);
});

test("concurrent heal clicks perform one write and block d20 while healing", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const target = actor({ beforeApply: () => gate });
  const app = await openActorRestDialog(target);
  const form = view(app);
  form.health.value = "3";
  const before = dice.length;
  const first = app._healRecovery(form.html);
  await app._healRecovery(form.html);
  await app._rollRecovery();
  assert.equal(target.calls.length, 1);
  assert.equal(dice.length, before);
  release();
  await first;
  assert.equal(target.writes.length, 1);
  assert.equal(target.system.health.value, 8);
  assert.equal(app.rendered, true);
});
