export const SPELL_EFFECT_TYPES = Object.freeze({
  DAMAGE: "damage",
  HEALING: "healing"
});

export const SPELL_EFFECT_TYPE_LABELS = Object.freeze({
  [SPELL_EFFECT_TYPES.DAMAGE]: "Урон",
  [SPELL_EFFECT_TYPES.HEALING]: "Лечение"
});

export const MAGIC_TREE_INFLUENCE_EFFECT_TYPES = Object.freeze({
  AUTO: "",
  TAG: "tag",
  DAMAGE: SPELL_EFFECT_TYPES.DAMAGE,
  HEALING: SPELL_EFFECT_TYPES.HEALING
});

export const MAGIC_TREE_INFLUENCE_EFFECT_TYPE_LABELS = Object.freeze({
  [MAGIC_TREE_INFLUENCE_EFFECT_TYPES.AUTO]: "Авто по названию",
  [MAGIC_TREE_INFLUENCE_EFFECT_TYPES.TAG]: "Текст / тег",
  [MAGIC_TREE_INFLUENCE_EFFECT_TYPES.DAMAGE]: "Урон",
  [MAGIC_TREE_INFLUENCE_EFFECT_TYPES.HEALING]: "Лечение"
});

function asTrimmedString(value) {
  return String(value ?? "").trim();
}

function normalizedLabel(value) {
  return asTrimmedString(value).toLocaleLowerCase("ru");
}

export function normalizeSpellRollFormula(value) {
  return asTrimmedString(value).replace(/D(?=\d)/g, "d");
}

export function inferSpellEffectType(label) {
  const normalized = normalizedLabel(label);
  if (!normalized) return "";

  if (/^(урон|damage)(?:$|\s|:)/iu.test(normalized)) {
    return SPELL_EFFECT_TYPES.DAMAGE;
  }

  if (/^(лечение|исцеление|восстановление|heal|healing)(?:$|\s|:)/iu.test(normalized)) {
    return SPELL_EFFECT_TYPES.HEALING;
  }

  return "";
}

export function normalizeSpellEffect(effect) {
  const type = asTrimmedString(effect?.type);
  if (!Object.values(SPELL_EFFECT_TYPES).includes(type)) return null;

  return {
    type,
    label: asTrimmedString(effect?.label) || SPELL_EFFECT_TYPE_LABELS[type] || type,
    formula: normalizeSpellRollFormula(effect?.formula)
  };
}

export function getMagicTreeNodeSpellEffect(node) {
  const output = node?.output ?? {};
  const configuredType = asTrimmedString(output.effectType);

  if (configuredType === MAGIC_TREE_INFLUENCE_EFFECT_TYPES.TAG) return null;

  const label = asTrimmedString(output.name) || asTrimmedString(node?.name);
  const type = Object.values(SPELL_EFFECT_TYPES).includes(configuredType)
    ? configuredType
    : inferSpellEffectType(label);

  if (!type) return null;

  return {
    type,
    label: label || SPELL_EFFECT_TYPE_LABELS[type] || type,
    formula: normalizeSpellRollFormula(output.value)
  };
}

export function parseLegacyInfluenceEffect(influence) {
  const text = asTrimmedString(influence);
  if (!text) return null;

  const separatorIndex = text.indexOf(":");
  const label = separatorIndex >= 0 ? text.slice(0, separatorIndex).trim() : text;
  const formula = separatorIndex >= 0 ? text.slice(separatorIndex + 1).trim() : "";
  const type = inferSpellEffectType(label);

  if (!type || !formula) return null;

  return {
    type,
    label: label || SPELL_EFFECT_TYPE_LABELS[type] || type,
    formula: normalizeSpellRollFormula(formula)
  };
}

export function getSpellEffects(spellOrSystem) {
  const system = spellOrSystem?.system ?? spellOrSystem ?? {};
  const configured = Array.isArray(system.effects)
    ? system.effects.map(normalizeSpellEffect).filter(Boolean)
    : [];

  if (configured.length) return configured;

  // Compatibility for spells compiled before structured spell effects existed.
  return (Array.isArray(system.influences) ? system.influences : [])
    .map(parseLegacyInfluenceEffect)
    .filter(Boolean);
}

export function isValidSpellRollFormula(formula) {
  const normalized = normalizeSpellRollFormula(formula);
  if (!normalized) return false;

  try {
    return globalThis.Roll?.validate ? Roll.validate(normalized) : true;
  } catch (_error) {
    return false;
  }
}
