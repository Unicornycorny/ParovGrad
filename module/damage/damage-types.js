import { DAMAGE_TYPES, PHYSICAL_DAMAGE_TYPES, DAMAGE_CATEGORIES, DAMAGE_TYPE_OPTIONS } from "./damage-config.js";
import { getActorDamageModifiers } from "../effects/damage-modifiers.js";

export { DAMAGE_TYPES, PHYSICAL_DAMAGE_TYPES, DAMAGE_CATEGORIES, DAMAGE_TYPE_OPTIONS } from "./damage-config.js";

export function damagePartSchema() {
  const { SchemaField, StringField } = foundry.data.fields;
  return new SchemaField({
    id: new StringField({required: true, blank: false, initial: () => foundry.utils.randomID()}),
    formula: new StringField({required: true, blank: false, initial: "d4"}),
    category: new StringField({required: true, choices: Object.keys(DAMAGE_CATEGORIES), initial: "typed"}),
    damageType: new StringField({required: false, blank: true, nullable: true, initial: "bludgeoning", choices: Object.keys(DAMAGE_TYPES)})
  });
}
export function damageSchema() {
  const { SchemaField, ArrayField } = foundry.data.fields;
  return new SchemaField({parts: new ArrayField(damagePartSchema(), {required: true, initial: []})});
}
export function makeDamagePart(formula = "d4", category = "typed", damageType = "bludgeoning") {
  return normalizedDamagePart({formula, category, damageType});
}
export function normalizedDamagePart(part, fallback = "d4") {
  const legacyPhysical = part?.category === "physical" || !Object.hasOwn(DAMAGE_CATEGORIES, part?.category);
  const category = legacyPhysical ? "typed" : part.category;
  const damageType = legacyPhysical ? "bludgeoning"
    : category === "typed" && Object.hasOwn(DAMAGE_TYPES, part?.damageType) ? part.damageType : null;
  return {
    id: String(part?.id || foundry.utils.randomID()),
    formula: String(part?.formula || fallback).trim(),
    category: category === "typed" && !damageType ? "unspecified" : category,
    damageType
  };
}
export function damagePartLabel(part) {
  if (part?.category === "physical") return PHYSICAL_DAMAGE_TYPES.bludgeoning;
  if (part?.category === "typed") return DAMAGE_TYPES[part.damageType] ?? DAMAGE_CATEGORIES.unspecified;
  return DAMAGE_CATEGORIES[part?.category] ?? DAMAGE_CATEGORIES.unspecified;
}
/** Unconfigured older items continue to work without running a world migration. */
export function getItemDamageParts(itemOrSystem, {fallback = "d4"} = {}) {
  const system = itemOrSystem?.system ?? itemOrSystem ?? {};
  const parts = system.damage?.parts;
  return Array.isArray(parts) && parts.length
    ? parts.map(part => normalizedDamagePart(part, fallback))
    : [makeDamagePart(system.damageDie || fallback)];
}
export function damagePartOptions(part) {
  part = normalizedDamagePart(part);
  return {
    ...part,
    typeLabel: damagePartLabel(part),
    damageTypeOptions: DAMAGE_TYPE_OPTIONS.map(option => ({...option, selected: option.value === part.damageType}))
  };
}
export function validateDamageParts(parts) {
  for (const part of parts) {
    if (!String(part.formula ?? "").trim() || (globalThis.Roll?.validate && !Roll.validate(part.formula))) {
      throw new Error(`Некорректная формула урона: ${part.formula || "—"}`);
    }
    if (part.category === "typed" && !Object.hasOwn(DAMAGE_TYPES, part.damageType)) {
      throw new Error("Для компонента урона необходимо выбрать допустимый тип урона.");
    }
  }
}
/** Roll each part independently; one inspiration die attaches only to first part. */
export async function rollDamageParts(parts, {rollData = {}, useInspiration = false} = {}) {
  validateDamageParts(parts);
  const results = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const roll = game.parovgrad.dice.createRoll(part.formula, rollData, {addExtraDie: Boolean(i === 0 && useInspiration)});
    await roll.evaluate();
    results.push({ ...normalizedDamagePart(part), amount: Math.max(0, Number(roll.total) || 0), roll });
  }
  return {results, total: results.reduce((sum, part) => sum + part.amount, 0), primaryRoll: results[0]?.roll};
}
export function serializeDamageResults(results) {
  return results.map(({id, formula, category, damageType, amount}) => ({id, formula, category, damageType, amount}));
}
export function damageResultsHtml(results, escapeHTML = foundry.utils.escapeHTML) {
  return results.map(part => `${escapeHTML(damagePartLabel(part))}: ${escapeHTML(String(part.amount))} (${escapeHTML(part.formula)})`).join(" · ");
}
/** Combine each type before rounding; repeated defenses never multiply each other. */
export function calculateDamage(parts, {half = false, actor = null} = {}) {
  const amounts = new Map();
  for (const part of parts ?? []) {
    const value = Number(part?.amount);
    const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
    const legacyPhysical = part?.category === "physical" || !Object.hasOwn(DAMAGE_CATEGORIES, part?.category);
    const type = legacyPhysical ? "bludgeoning"
      : part.category === "typed" && Object.hasOwn(DAMAGE_TYPES, part.damageType) ? part.damageType : "unspecified";
    amounts.set(type, (amounts.get(type) ?? 0) + amount);
  }

  const modifiers = getActorDamageModifiers(actor);
  let total = 0;
  for (const [type, amount] of amounts) {
    const modes = new Set(modifiers
      .filter(modifier => modifier.damageType === "all" || modifier.damageType === type
        || (modifier.damageType === "physical" && Object.hasOwn(PHYSICAL_DAMAGE_TYPES, type)))
      .map(modifier => modifier.mode));
    if (modes.has("immunity")) continue;

    let applied = half ? amount / 2 : amount;
    if (modes.has("resistance")) applied = Math.floor(applied / 2);
    if (modes.has("vulnerability")) applied *= 2;
    total += applied;
  }
  // Half damage can leave fractions in different types; round only after summing.
  return half || modifiers.length ? Math.floor(total) : total;
}
const damageApplicationsInFlight = new WeakMap();

function damageApplicationKey(applicationId) {
  // Flag paths cannot contain dots. Fixed-width Unicode hex also keeps distinct IDs distinct.
  return `id_${Array.from(String(applicationId), character => character.codePointAt(0).toString(16).padStart(6, "0")).join("")}`;
}

export function getAppliedDamage(actor, applicationId) {
  if (!applicationId) return null;
  const receipt = actor?.flags?.ParovGrad?.damageApplications?.[damageApplicationKey(applicationId)];
  if (!receipt || ![receipt.amount, receipt.before, receipt.after].every(value => Number.isFinite(value) && value >= 0)) {
    return null;
  }
  return {amount: receipt.amount, before: receipt.before, after: receipt.after};
}

async function applyTrackedDamage(actor, parts, {half, applicationId}) {
  const amount = calculateDamage(parts, {half, actor});
  const before = Math.max(0, Number(actor.system?.health?.value) || 0);
  const after = Math.max(0, before - amount);
  const receipt = {amount, before, after};
  try {
    await actor.update({
      "system.health.value": after,
      [`flags.ParovGrad.damageApplications.${damageApplicationKey(applicationId)}`]: receipt
    });
  } catch (error) {
    // A hook may throw after the whole update persisted. The receipt proves damage was applied.
    const applied = getAppliedDamage(actor, applicationId);
    if (applied) return applied;
    throw error;
  }
  const applied = getAppliedDamage(actor, applicationId);
  if (!applied) throw new Error("Не удалось подтвердить нанесение урона.");
  return applied;
}

export async function applyTypedDamage(actor, parts, {half = false, applicationId = ""} = {}) {
  if (applicationId) {
    applicationId = String(applicationId);
    const applied = getAppliedDamage(actor, applicationId);
    if (applied) return applied;
    const pending = damageApplicationsInFlight.get(actor) ?? new Map();
    if (pending.has(applicationId)) return pending.get(applicationId);
    damageApplicationsInFlight.set(actor, pending);
    const application = applyTrackedDamage(actor, parts, {half, applicationId});
    pending.set(applicationId, application);
    try {
      return await application;
    } finally {
      pending.delete(applicationId);
      if (!pending.size) damageApplicationsInFlight.delete(actor);
    }
  }
  const amount = calculateDamage(parts, {half, actor});
  const before = Math.max(0, Number(actor.system?.health?.value) || 0);
  const after = Math.max(0, before - amount);
  await actor.update({"system.health.value": after});
  return {amount, before, after};
}
