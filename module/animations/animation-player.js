/** Optional, system-owned Sequencer integration. No combat rules depend on playback. */
const SLOTS = ["cast", "projectile", "hit", "miss", "healing", "area", "persistent"];
const recent = new Map();
const warnings = new Set();
const auraStarts = new Set();
let auraGeneration = 0;

function number(value, fallback, min, max = Infinity) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizePreset(value = {}) {
  const preset = { enabled: value?.enabled === true };
  for (const slot of SLOTS) preset[slot] = typeof value?.[slot] === "string" ? value[slot].trim().slice(0, 2048) : "";
  preset.scale = number(value?.scale, 1, 0.1, 10);
  preset.opacity = number(value?.opacity, 1, 0, 1);
  return preset;
}

export function getPreset(item) {
  return normalizePreset(item?.flags?.ParovGrad?.animation);
}

function warnOnce(key, message, error) {
  if (warnings.has(key)) return;
  if (warnings.size > 100) warnings.clear();
  warnings.add(key);
  globalThis.ui?.notifications?.warn(message);
  if (error) console.warn("ParovGrad | Animation", error);
}

function ready() {
  return globalThis.game?.modules?.get("sequencer")?.active === true && typeof globalThis.Sequence === "function";
}

export function listEntries() {
  try {
    const database = globalThis.Sequencer?.Database;
    if (!database?.entryExists("jb2a")) return [];
    return [...new Set(database.getPathsUnder("jb2a", { fullyQualified: true }))].sort();
  } catch { return []; }
}

function tokenDocument(token) { return token?.document ?? token; }
function sameActor(token, actor) {
  const source = tokenDocument(token)?.actor;
  return source && (source === actor || (source.uuid && source.uuid === actor?.uuid));
}

/** Never silently pick one of multiple tokens belonging to the same Actor. */
export function resolveSourceToken(actor, sourceToken = null) {
  if (!actor) return null;
  const canvas = globalThis.canvas;
  const onScene = token => {
    const document = tokenDocument(token);
    return sameActor(document, actor) && document?.parent?.id === canvas?.scene?.id;
  };
  if (sourceToken) return onScene(sourceToken) ? tokenDocument(sourceToken) : null;
  if (actor.token && onScene(actor.token)) return tokenDocument(actor.token);
  const controlled = (canvas?.tokens?.controlled ?? []).filter(onScene);
  if (controlled.length === 1) return tokenDocument(controlled[0]);
  const candidates = (canvas?.tokens?.placeables ?? []).filter(onScene);
  return candidates.length === 1 ? tokenDocument(candidates[0]) : null;
}

export function snapshotTemplate(template) {
  const doc = template?.document ?? template;
  if (!doc) return null;
  return {
    t: doc.t, x: number(doc.x, 0, -Infinity), y: number(doc.y, 0, -Infinity),
    direction: number(doc.direction, 0, -Infinity), distance: number(doc.distance, 0, 0),
    width: number(doc.width, 0, 0), angle: number(doc.angle, 90, 1, 360),
    sceneUuid: doc.parent?.uuid ?? null,
    // Scene units and pixels are frozen too, so late defense uses the original geometry.
    gridSize: number(globalThis.canvas?.dimensions?.size, 100, 1),
    gridDistance: number(globalThis.canvas?.dimensions?.distance, 1, 0.001)
  };
}

export function createContext({ actor, item, sourceToken = null, templateDocument = null } = {}) {
  try {
    const preset = getPreset(item);
    if (!preset.enabled) return null;
    const source = resolveSourceToken(actor, sourceToken);
    return {
      useId: globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID(),
      actorUuid: actor?.uuid ?? null, itemUuid: item?.uuid ?? null,
      sourceTokenUuid: source?.uuid ?? null,
      sceneUuid: globalThis.canvas?.scene?.uuid ?? null,
      template: snapshotTemplate(templateDocument), preset
    };
  } catch (error) {
    warnOnce("context", "Не удалось подготовить анимацию. Действие продолжено.", error);
    return null;
  }
}

function resolveToken(uuid) {
  if (!uuid) return null;
  const document = globalThis.fromUuidSync?.(uuid);
  if (document?.parent?.id !== globalThis.canvas?.scene?.id) return null;
  return document?.object ?? null;
}

function validFile(file) {
  if (!file) return false;
  if (/\.(webm|mp4|png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(file)) return true;
  if (file.startsWith("jb2a.") && globalThis.Sequencer?.Database?.entryExists(file)) return true;
  warnOnce(`file:${file}`, `Анимация «${file}» не найдена в Sequencer. Проверьте JB2A и настройки предмета.`);
  return false;
}

function effect(sequence, file, preset) {
  if (!validFile(file)) return null;
  return sequence.effect().file(file).opacity(preset.opacity);
}

/** Pixel geometry for circle/rect and a directional artwork for cone/ray. */
export function areaGeometry(template, scale = 1) {
  if (!template?.distance) return null;
  const unit = template.gridSize / template.gridDistance;
  const length = template.distance * unit;
  const direction = template.direction * Math.PI / 180;
  if (template.t === "circle") return {
    location: { x: template.x, y: template.y }, width: length * 2 * scale, height: length * 2 * scale,
    rotation: 0, anchor: { x: 0.5, y: 0.5 }
  };
  if (template.t === "rect") {
    // Foundry stores the diagonal vector of a native rectangle.
    const dx = Math.cos(direction) * length, dy = Math.sin(direction) * length;
    return { location: { x: template.x + dx / 2, y: template.y + dy / 2 },
      width: Math.max(1, Math.abs(dx)) * scale, height: Math.max(1, Math.abs(dy)) * scale,
      rotation: 0, anchor: { x: 0.5, y: 0.5 } };
  }
  const halfAngle = template.angle * Math.PI / 360;
  const left = template.t === "cone" && template.angle > 180 ? length * Math.cos(halfAngle) : 0;
  const spread = template.t === "ray" ? (template.width || template.gridDistance) * unit
    : length * 2 * (template.angle >= 180 ? 1 : Math.sin(halfAngle));
  const width = length - left;
  return { location: { x: template.x, y: template.y }, width: width * scale,
    height: Math.max(1, spread) * scale, rotation: template.direction, anchor: { x: left === 0 ? 0 : -left / width, y: 0.5 } };
}

function start(sequence, local = false) {
  // Sequencer's promise spans the animation. Do not delay damage or defense UI until it ends.
  const playback = Promise.resolve(sequence.play({ local }));
  playback.catch(error =>
    warnOnce("playback", "Не удалось воспроизвести анимацию. Действие продолжено.", error));
  return playback;
}

export async function play({ context, phase = "use", targetTokenUuids = [], eventId = "", local = false } = {}) {
  try {
    if (!context?.useId || !context.preset?.enabled) return false;
    if (context.sceneUuid !== globalThis.canvas?.scene?.uuid || !globalThis.canvas?.ready) return false;
    if (!ready()) {
      warnOnce("sequencer", "Для анимаций ParovGrad включите модуль Sequencer.");
      return false;
    }
    const preset = normalizePreset(context.preset);
    const ids = [...new Set(targetTokenUuids.filter(id => typeof id === "string"))].sort();
    const phaseTargets = phase === "use" ? ["use"] : ids;
    const fresh = phaseTargets.filter(id => {
      const key = JSON.stringify([context.useId, phase, id, eventId]);
      if (recent.has(key)) return false;
      recent.set(key, true);
      return true;
    });
    if (!fresh.length) return false;
    if (recent.size > 2000) recent.delete(recent.keys().next().value);
    const source = resolveToken(context.sourceTokenUuid);
    if (!source && phase === "use" && (preset.cast || preset.projectile)) warnOnce(`source:${context.actorUuid}`,
      "Не удалось однозначно выбрать токен для анимации каста. Выделите токен персонажа.");
    const targets = (phase === "use" ? ids : fresh).map(resolveToken).filter(Boolean);
    const sequence = new globalThis.Sequence();
    let count = 0;
    const onToken = (file, token) => {
      if (!token || !file) return;
      const section = effect(sequence, file, preset);
      if (section) { section.atLocation(token).scaleToObject(preset.scale); count++; }
    };
    if (phase === "use") {
      onToken(preset.cast, source);
      if (preset.projectile && source) for (const target of targets) {
        const section = effect(sequence, preset.projectile, preset);
        if (section) { section.atLocation(source).stretchTo(target).scale(preset.scale); count++; }
      }
      const geometry = areaGeometry(context.template, preset.scale);
      if (preset.area && geometry) {
        const section = effect(sequence, preset.area, preset);
        if (section) {
          section.atLocation(geometry.location).size({ width: geometry.width, height: geometry.height })
            .anchor(geometry.anchor).rotate(geometry.rotation);
          count++;
        }
      }
    } else if (["hit", "miss", "heal"].includes(phase)) {
      const file = phase === "heal" ? preset.healing : preset[phase];
      for (const target of targets) onToken(file, target);
    }
    if (!count) return false;
    start(sequence, local);
    return true;
  } catch (error) {
    warnOnce("playback", "Не удалось воспроизвести анимацию. Действие продолжено.", error);
    return false;
  }
}

export async function preview({ item, preset = getPreset(item), sourceToken = null } = {}) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : tokenDocument(sourceToken)?.actor;
  const context = createContext({ actor, item: { ...item, flags: { ParovGrad: { animation: { ...preset, enabled: true } } } }, sourceToken });
  const targets = [...(globalThis.game?.user?.targets ?? [])].map(token => tokenDocument(token)?.uuid).filter(Boolean);
  return play({ context, targetTokenUuids: targets, local: true });
}

function effectActor(activeEffect) {
  const parent = activeEffect?.parent;
  if (parent?.documentName === "Actor") return parent;
  if (parent?.parent?.documentName === "Actor" && parent.system?.equipped
    && activeEffect.flags?.ParovGrad?.itemApplication !== "active") return parent.parent;
  return null;
}

export async function syncPersistentEffect(activeEffect, { remove = false, restart = false } = {}) {
  try {
    if (!ready() || !activeEffect?.uuid) return;
    const manager = globalThis.Sequencer?.EffectManager;
    if (!manager) return;
    const preset = getPreset(activeEffect);
    const actor = effectActor(activeEffect);
    const active = !remove && actor && preset.enabled && preset.persistent && !activeEffect.disabled && !activeEffect.isSuppressed;
    if (!active || restart) {
      for (const name of auraStarts) if (name.startsWith(`ParovGrad.aura.${activeEffect.uuid}.`)) auraStarts.delete(name);
      await manager.endEffects({ origin: activeEffect.uuid }, false);
    }
    if (!active || !validFile(preset.persistent) || !globalThis.canvas?.ready) return;
    const tokens = (globalThis.canvas.tokens?.placeables ?? []).filter(token => sameActor(token, actor));
    for (const token of tokens) {
      const prefix = `ParovGrad.aura.${activeEffect.uuid}.${tokenDocument(token).uuid}.`;
      if ([...auraStarts].some(name => name.startsWith(prefix)) || manager.getEffects({ name: `${prefix}*` }).length) continue;
      const name = `${prefix}${++auraGeneration}`;
      auraStarts.add(name);
      const sequence = new globalThis.Sequence();
      effect(sequence, preset.persistent, preset).attachTo(token).scaleToObject(preset.scale)
        .name(name).origin(activeEffect.uuid).persist().temporary().playIf(() => auraStarts.has(name));
      // Reconstruct from ActiveEffects on each client's viewed scene. Temporary + local
      // avoids stale stored auras and never broadcasts one copy per connected player.
      start(sequence, true).catch(() => { auraStarts.delete(name); });
    }
  } catch (error) { warnOnce("persistent", "Не удалось обновить визуальный эффект персонажа.", error); }
}

export async function refreshPersistentEffects() {
  try {
    if (!globalThis.canvas?.ready) return;
    const actors = new Set((globalThis.canvas.tokens?.placeables ?? []).map(token => token.actor).filter(Boolean));
    for (const actor of actors) {
      for (const activeEffect of actor.effects ?? []) await syncPersistentEffect(activeEffect);
      for (const item of actor.items ?? []) for (const activeEffect of item.effects ?? []) await syncPersistentEffect(activeEffect);
    }
  } catch (error) { warnOnce("persistent", "Не удалось обновить визуальные эффекты сцены.", error); }
}

export function registerAnimationHooks() {
  const hooks = globalThis.Hooks;
  // A disabled/deleted/restarted aura may still be loading its media. Veto its
  // obsolete generation immediately before Sequencer registers the effect.
  hooks.on("preCreateSequencerEffect", data => {
    if (data.name?.startsWith("ParovGrad.aura.") && !auraStarts.has(data.name)) return false;
  });
  hooks.on("endedSequencerEffect", effect => { auraStarts.delete(effect.data?.name); });
  hooks.on("createActiveEffect", effect => { void syncPersistentEffect(effect); });
  hooks.on("updateActiveEffect", effect => { void syncPersistentEffect(effect, { restart: true }); });
  hooks.on("deleteActiveEffect", effect => { void syncPersistentEffect(effect, { remove: true }); });
  hooks.on("updateItem", item => {
    for (const effect of item.effects ?? []) void syncPersistentEffect(effect, { restart: true });
  });
  hooks.on("deleteItem", item => {
    for (const effect of item.effects ?? []) void syncPersistentEffect(effect, { remove: true });
  });
  hooks.on("canvasReady", () => { void refreshPersistentEffects(); });
  hooks.on("canvasTearDown", () => { auraStarts.clear(); });
  hooks.on("createToken", () => { void refreshPersistentEffects(); });
  hooks.on("drawToken", () => { void refreshPersistentEffects(); });
  hooks.once("ready", () => { void refreshPersistentEffects(); });
  hooks.on("sequencer.ready", () => { setTimeout(() => { void refreshPersistentEffects(); }, 0); });
  hooks.on("sequencerEffectManagerReady", () => { void refreshPersistentEffects(); });
}

export const animationAPI = Object.freeze({
  getPreset, normalizePreset, listEntries, createContext, play, preview, resolveSourceToken,
  refreshPersistentEffects
});
