/** ParovGrad damage types. Physical is the base category, NOT force energy. */
export const DAMAGE_TYPES = Object.freeze({
  fire: "Огонь",
  cold: "Холод",
  sonic: "Звук",
  electricity: "Электричество",
  force: "Силовой",
  poison: "Яд",
  acid: "Кислота",
  necrotic: "Некротик",
  holy: "Святой"
});
export const DAMAGE_CATEGORIES = Object.freeze({
  physical: "Физический",
  typed: "Особый тип",
  unspecified: "Не определён"
});
export const DAMAGE_TYPE_OPTIONS = Object.entries(DAMAGE_TYPES).map(([value, label]) => ({value, label}));

export function damagePartSchema() {
  const { SchemaField, StringField } = foundry.data.fields;
  return new SchemaField({
    id: new StringField({required: true, blank: false, initial: () => foundry.utils.randomID()}),
    formula: new StringField({required: true, blank: false, initial: "d4"}),
    category: new StringField({required: true, choices: Object.keys(DAMAGE_CATEGORIES), initial: "physical"}),
    damageType: new StringField({required: false, blank: true, nullable: true, initial: null, choices: Object.keys(DAMAGE_TYPES)})
  });
}
export function damageSchema() {
  const { SchemaField, ArrayField } = foundry.data.fields;
  return new SchemaField({parts: new ArrayField(damagePartSchema(), {required: true, initial: []})});
}
export function makeDamagePart(formula = "d4", category = "physical", damageType = null) {
  return {id: foundry.utils.randomID(), formula, category, damageType: category === "typed" ? damageType : null};
}
export function normalizedDamagePart(part, fallback = "d4") {
  const category = Object.hasOwn(DAMAGE_CATEGORIES, part?.category) ? part.category : "physical";
  const damageType = category === "typed" && Object.hasOwn(DAMAGE_TYPES, part?.damageType) ? part.damageType : null;
  return {
    id: String(part?.id || foundry.utils.randomID()),
    formula: String(part?.formula || fallback).trim(),
    category: category === "typed" && !damageType ? "unspecified" : category,
    damageType
  };
}
export function damagePartLabel(part) {
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
  return {
    ...part,
    typeLabel: damagePartLabel(part),
    categoryOptions: Object.entries(DAMAGE_CATEGORIES).filter(([value]) => value !== "unspecified").map(([value, label]) => ({value, label, selected: value === part.category})),
    damageTypeOptions: DAMAGE_TYPE_OPTIONS.map(option => ({...option, selected: option.value === part.damageType})),
    isTyped: part.category === "typed"
  };
}
export function validateDamageParts(parts) {
  for (const part of parts) {
    if (!String(part.formula ?? "").trim() || (globalThis.Roll?.validate && !Roll.validate(part.formula))) {
      throw new Error(`Некорректная формула урона: ${part.formula || "—"}`);
    }
    if (part.category === "typed" && !Object.hasOwn(DAMAGE_TYPES, part.damageType)) {
      throw new Error("Для типизированного урона необходимо выбрать один из девяти типов.");
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
/** Resistance hooks can be inserted here without changing attack workflows. */
export function calculateDamage(parts, {half = false} = {}) {
  const total = (parts ?? []).reduce((sum, part) => sum + Math.max(0, Number(part.amount) || 0), 0);
  return half ? Math.floor(total / 2) : total;
}
export async function applyTypedDamage(actor, parts, {half = false} = {}) {
  const amount = calculateDamage(parts, {half});
  const before = Math.max(0, Number(actor.system?.health?.value) || 0);
  const after = Math.max(0, before - amount);
  await actor.update({"system.health.value": after});
  return {amount, before, after};
}
