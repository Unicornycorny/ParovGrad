import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

const animations = await importModule(new URL("../module/animations/animation-player.js", import.meta.url));
let serial = 0;

function setup(preset = {}) {
  const scene = { id: "scene", uuid: "Scene.scene" };
  const actor = { documentName: "Actor", uuid: "Actor.caster", items: [], effects: [] };
  const documents = new Map();
  const makeToken = (id, owner = actor) => {
    const doc = { id, uuid: `Scene.scene.Token.${id}`, actor: owner, parent: scene };
    doc.object = { document: doc, actor: owner, center: { x: 100, y: 200 } };
    documents.set(doc.uuid, doc);
    return doc.object;
  };
  const caster = makeToken("caster");
  const first = makeToken("first", { uuid: "Actor.first" });
  const second = makeToken("second", { uuid: "Actor.second" });
  const item = { uuid: "Actor.caster.Item.spell", parent: actor,
    flags: { ParovGrad: { animation: { enabled: true, ...preset } } } };
  const sequences = [], warnings = [], ended = [], running = [];
  class Sequence {
    constructor() { this.sections = []; sequences.push(this); }
    effect() {
      const calls = [], section = new Proxy({}, { get: (_target, method) => (...args) => {
        calls.push({ method, args }); return section;
      } });
      this.sections.push(calls);
      return section;
    }
    play(options) { this.options = options; return Promise.resolve(); }
  }
  globalThis.Sequence = Sequence;
  globalThis.game = { modules: new Map([["sequencer", { active: true }]]),
    user: { id: "gm" }, users: { activeGM: { id: "gm" } } };
  globalThis.canvas = { ready: true, scene, dimensions: { size: 100, distance: 10 },
    tokens: { placeables: [caster, first, second], controlled: [] } };
  globalThis.fromUuidSync = uuid => documents.get(uuid);
  globalThis.foundry = { utils: { randomID: () => `cast-${++serial}` } };
  globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
  globalThis.Sequencer = {
    Database: { entryExists: key => key === "jb2a" || key.startsWith("jb2a.valid"),
      getPathsUnder: () => ["jb2a.valid.red", "jb2a.valid.blue", "jb2a.valid.red"] },
    EffectManager: {
      getEffects: ({ name }) => running.filter(entry => entry.name === name),
      async endEffects(filter) { ended.push(filter); running.length = 0; }
    }
  };
  return { scene, actor, caster, first, second, item, documents, sequences, warnings, ended, running, makeToken,
    context: templateDocument => animations.createContext({ actor, item, sourceToken: caster, templateDocument }) };
}

test("source resolution respects synthetic and explicitly selected tokens and refuses ambiguity", () => {
  const env = setup();
  assert.equal(animations.resolveSourceToken(env.actor), env.caster.document);
  const copy = env.makeToken("copy");
  canvas.tokens.placeables.push(copy);
  assert.equal(animations.resolveSourceToken(env.actor), null);
  canvas.tokens.controlled = [copy];
  assert.equal(animations.resolveSourceToken(env.actor), copy.document);
  assert.equal(animations.resolveSourceToken(env.actor, env.caster), env.caster.document);
  assert.equal(animations.resolveSourceToken(env.actor, env.first), null);
  env.actor.token = env.caster.document;
  assert.equal(animations.resolveSourceToken(env.actor), env.caster.document);
});

test("a use freezes preset, source and complete area geometry before the template is deleted", () => {
  const env = setup({ area: "jb2a.valid.area" });
  const template = { parent: env.scene, x: 30, y: 40, t: "cone", direction: 90, distance: 20, width: 5, angle: 60 };
  const context = env.context(template);
  template.x = 900;
  template.parent = null;
  env.item.flags.ParovGrad.animation.area = "jb2a.other";
  assert.equal(context.sourceTokenUuid, env.caster.document.uuid);
  assert.equal(context.template.x, 30);
  assert.equal(context.template.sceneUuid, env.scene.uuid);
  assert.equal(context.template.gridDistance, 10);
  assert.equal(context.preset.area, "jb2a.valid.area");
  assert.doesNotThrow(() => JSON.stringify(context));
});

test("cast, projectile and area play once, with hit and miss independently deduplicated per target", async () => {
  const env = setup({ cast: "jb2a.valid.cast", projectile: "jb2a.valid.projectile", area: "jb2a.valid.area",
    hit: "jb2a.valid.hit", miss: "jb2a.valid.miss", scale: 1.5, opacity: 0.7 });
  const context = env.context({ parent: env.scene, t: "circle", x: 500, y: 600, distance: 20 });
  const ids = [env.first.document.uuid, env.second.document.uuid];
  assert.equal(await animations.play({ context, targetTokenUuids: ids }), true);
  assert.equal(env.sequences[0].sections.length, 4);
  assert.deepEqual(env.sequences[0].sections[1].find(call => call.method === "stretchTo").args, [env.first]);
  assert.deepEqual(env.sequences[0].sections[3].find(call => call.method === "size").args, [{ width: 600, height: 600 }]);
  assert.equal(await animations.play({ context, targetTokenUuids: [...ids].reverse() }), false);
  assert.equal(await animations.play({ context, phase: "hit", targetTokenUuids: [ids[0]] }), true);
  assert.equal(await animations.play({ context, phase: "hit", targetTokenUuids: [ids[0]] }), false);
  assert.equal(await animations.play({ context, phase: "miss", targetTokenUuids: [ids[1]] }), true);
  assert.equal(env.sequences.length, 3);
});

test("separate healing events share a cast but each restore can show its visual", async () => {
  const env = setup({ healing: "jb2a.valid.heal" });
  const context = env.context();
  const call = { context, phase: "heal", targetTokenUuids: [env.first.document.uuid] };
  assert.equal(await animations.play({ ...call, eventId: "effect-1" }), true);
  assert.equal(await animations.play({ ...call, eventId: "effect-1" }), false);
  assert.equal(await animations.play({ ...call, eventId: "effect-2" }), true);
});

test("playback is optional, stays in its source scene and never throws into combat", async () => {
  const env = setup({ hit: "jb2a.valid.hit" });
  const context = env.context();
  const call = { context, phase: "hit", targetTokenUuids: [env.first.document.uuid] };
  canvas.scene = { id: "another", uuid: "Scene.another" };
  assert.equal(await animations.play(call), false);
  canvas.scene = env.scene;
  game.modules.get("sequencer").active = false;
  assert.equal(await animations.play(call), false);
  game.modules.get("sequencer").active = true;
  globalThis.Sequence = class { constructor() { throw new Error("Broken animation renderer"); } };
  const oldWarn = console.warn;
  console.warn = () => {};
  try { assert.equal(await animations.play(call), false); } finally { console.warn = oldWarn; }
});

test("a long-running sequence cannot delay the next combat action", async () => {
  const env = setup({ hit: "jb2a.valid.hit" });
  Sequence.prototype.play = () => new Promise(() => {});
  const result = await animations.play({ context: env.context(), phase: "hit", targetTokenUuids: [env.first.document.uuid] });
  assert.equal(result, true);
});

test("area fitting uses scene units, native rectangle diagonal and directional ray width", () => {
  const base = { x: 100, y: 200, gridSize: 100, gridDistance: 10, distance: Math.sqrt(800), direction: 45 };
  const rect = animations.areaGeometry({ ...base, t: "rect" });
  assert.ok(Math.abs(rect.width - 200) < 0.001);
  assert.ok(Math.abs(rect.location.x - 200) < 0.001);
  assert.ok(Math.abs(rect.location.y - 300) < 0.001);
  const ray = animations.areaGeometry({ ...base, t: "ray", distance: 30, width: 5, direction: 90 });
  assert.equal(ray.width, 300);
  assert.equal(ray.height, 50);
  assert.equal(ray.rotation, 90);
  assert.deepEqual(ray.anchor, { x: 0, y: 0.5 });
});

test("invalid keys and unavailable catalog entries fail softly while direct asset paths work", async () => {
  const env = setup({ hit: "jb2a.nonexistent" });
  assert.deepEqual(animations.listEntries(), ["jb2a.valid.blue", "jb2a.valid.red"]);
  assert.equal(await animations.play({ context: env.context(), phase: "hit", targetTokenUuids: [env.first.document.uuid] }), false);
  env.item.flags.ParovGrad.animation.hit = "modules/jb2a_patreon/Library/example.webm";
  assert.equal(await animations.play({ context: env.context(), phase: "hit", targetTokenUuids: [env.first.document.uuid] }), true);
});

test("persistent visuals render locally for each viewed scene and stop when disabled or removed", async () => {
  const env = setup();
  const effect = { uuid: "Actor.caster.ActiveEffect.aura", parent: env.actor,
    flags: { ParovGrad: { animation: { enabled: true, persistent: "jb2a.valid.aura" } } } };
  game.user.id = "player";
  await animations.syncPersistentEffect(effect);
  assert.equal(env.sequences.length, 1);
  const calls = env.sequences[0].sections[0];
  assert.deepEqual(calls.find(call => call.method === "attachTo").args, [env.caster]);
  assert.deepEqual(calls.find(call => call.method === "origin").args, [effect.uuid]);
  assert.ok(calls.some(call => call.method === "temporary"));
  assert.deepEqual(env.sequences[0].options, { local: true });
  env.running.push({ name: calls.find(call => call.method === "name").args[0] });
  await animations.syncPersistentEffect(effect);
  assert.equal(env.sequences.length, 1);
  effect.disabled = true;
  await animations.syncPersistentEffect(effect);
  assert.deepEqual(env.ended.at(-1), { origin: effect.uuid });
  effect.disabled = false;
  await animations.syncPersistentEffect(effect, { remove: true });
  assert.equal(env.sequences.length, 1);
});

test("equipment auras follow worn passive effects and never start for unapplied active item effects", async () => {
  const env = setup();
  const item = { documentName: "Item", parent: env.actor, system: { equipped: false } };
  const effect = { uuid: "Actor.caster.Item.ring.ActiveEffect.aura", parent: item,
    flags: { ParovGrad: { itemApplication: "passive", animation: { enabled: true, persistent: "jb2a.valid.aura" } } } };
  await animations.syncPersistentEffect(effect);
  assert.equal(env.sequences.length, 0);
  item.system.equipped = true;
  await animations.syncPersistentEffect(effect);
  assert.equal(env.sequences.length, 1);
  effect.flags.ParovGrad.itemApplication = "active";
  await animations.syncPersistentEffect(effect, { restart: true });
  assert.equal(env.sequences.length, 1);
  assert.equal(env.ended.at(-1).origin, effect.uuid);
});

test("overlapping aura refreshes share a pending generation and a removed loading aura is vetoed", async () => {
  const env = setup();
  const hooks = new Map();
  globalThis.Hooks = { on: (name, callback) => hooks.set(name, callback), once() {} };
  animations.registerAnimationHooks();
  const activeEffect = { uuid: "Actor.caster.ActiveEffect.pending", parent: env.actor,
    flags: { ParovGrad: { animation: { enabled: true, persistent: "jb2a.valid.aura" } } } };
  Sequence.prototype.play = () => new Promise(() => {});
  await Promise.all([animations.syncPersistentEffect(activeEffect), animations.syncPersistentEffect(activeEffect)]);
  assert.equal(env.sequences.length, 1);
  const firstName = env.sequences[0].sections[0].find(call => call.method === "name").args[0];
  const veto = hooks.get("preCreateSequencerEffect");
  assert.notEqual(veto({ name: firstName }), false);
  await animations.syncPersistentEffect(activeEffect, { restart: true });
  assert.equal(env.sequences.length, 2);
  const secondName = env.sequences[1].sections[0].find(call => call.method === "name").args[0];
  assert.equal(veto({ name: firstName }), false);
  assert.notEqual(veto({ name: secondName }), false);
  await animations.syncPersistentEffect(activeEffect, { remove: true });
  assert.equal(veto({ name: secondName }), false);
  assert.notEqual(veto({ name: "unrelated.module.aura" }), false);
});

test("batched and individual impact calls do not repeat the same target", async () => {
  const env = setup({ hit: "jb2a.valid.hit" });
  const context = env.context();
  await animations.play({ context, phase: "hit", targetTokenUuids: [env.first.document.uuid, env.second.document.uuid] });
  assert.equal(await animations.play({ context, phase: "hit", targetTokenUuids: [env.first.document.uuid] }), false);
  assert.equal(env.sequences.length, 1);
});
