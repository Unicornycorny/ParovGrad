import {
  MAGIC_TREE_NODE_TYPES,
  MAGIC_TREE_NODE_TYPE_LABELS
} from "./magic-tree-constants.js";
import {
  SPELL_EFFECT_TYPE_LABELS,
  getMagicTreeNodeSpellEffect,
  isValidSpellRollFormula
} from "./spell-effects.js";

export const MAX_SPELL_INFLUENCES = 4;

function asTrimmedString(value) {
  return String(value ?? "").trim();
}

function uniqueIds(values) {
  const result = [];
  const seen = new Set();

  for (const value of values ?? []) {
    const id = asTrimmedString(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function getNodeOutputValue(node) {
  const value = asTrimmedString(node?.output?.value);
  const name = asTrimmedString(node?.output?.name);
  return value || name || asTrimmedString(node?.name);
}

function getNodeDisplayOutput(node) {
  const name = asTrimmedString(node?.output?.name);
  const value = asTrimmedString(node?.output?.value);
  const spellEffect = node?.type === MAGIC_TREE_NODE_TYPES.INFLUENCE
    ? getMagicTreeNodeSpellEffect(node)
    : null;

  if (name && value) return `${name}: ${value}`;
  if (!name && value && spellEffect) {
    return `${spellEffect.label}: ${value}`;
  }
  return name || value || asTrimmedString(node?.name) || "—";
}

function normalizeMaterials(materials) {
  if (!Array.isArray(materials)) return [];
  return materials.map(asTrimmedString).filter(Boolean);
}

/**
 * Compile selected magic-tree nodes into the persistent fields of a Spell Item.
 *
 * Edges are intentionally ignored here. They describe character progression,
 * not the composition of an individual spell.
 */
export class MagicTreeCompiler {
  static compile(tree, selectedNodeIds = []) {
    const system = tree?.system ?? tree ?? {};
    const nodesById = system?.nodes ?? {};
    const selectedIds = uniqueIds(selectedNodeIds);
    const errors = [];
    const warnings = [];
    const selectedNodes = [];
    const missingNodeIds = [];

    for (const id of selectedIds) {
      const node = nodesById?.[id];
      if (!node) {
        missingNodeIds.push(id);
        errors.push(`Узел ${id} больше не существует в выбранном древе.`);
        continue;
      }

      selectedNodes.push({ id, node });
    }

    const rangeNodes = selectedNodes.filter(({ node }) => node?.type === MAGIC_TREE_NODE_TYPES.RANGE);
    const shapeNodes = selectedNodes.filter(({ node }) => node?.type === MAGIC_TREE_NODE_TYPES.SHAPE);
    const influenceNodes = selectedNodes.filter(({ node }) => node?.type === MAGIC_TREE_NODE_TYPES.INFLUENCE);
    const modifierNodes = selectedNodes.filter(({ node }) => node?.type === MAGIC_TREE_NODE_TYPES.MODIFIER);
    const knownTypes = new Set(Object.values(MAGIC_TREE_NODE_TYPES));
    const unknownNodes = selectedNodes.filter(({ node }) => !knownTypes.has(node?.type));

    if (rangeNodes.length === 0) {
      errors.push("Не выбрана дальность заклинания.");
    } else if (rangeNodes.length > 1) {
      errors.push("Можно выбрать только один узел дальности.");
    }

    if (shapeNodes.length === 0) {
      errors.push("Не выбрана форма заклинания.");
    } else if (shapeNodes.length > 1) {
      errors.push("Можно выбрать только один узел формы.");
    }

    if (influenceNodes.length > MAX_SPELL_INFLUENCES) {
      errors.push(`Можно выбрать не более ${MAX_SPELL_INFLUENCES} типов влияния.`);
    }

    if (modifierNodes.length) {
      warnings.push(
        "Узлы типа «Модификатор» учитываются в стоимости и материалах, но пока не изменяют другие параметры заклинания автоматически."
      );
    }

    for (const { id, node } of unknownNodes) {
      warnings.push(`Узел «${node?.name || id}» имеет неизвестный тип «${node?.type || "—"}» и не влияет на параметры заклинания.`);
    }

    const range = rangeNodes.length === 1 ? getNodeOutputValue(rangeNodes[0].node) : "";
    const shape = shapeNodes.length === 1 ? getNodeOutputValue(shapeNodes[0].node) : "";
    const influences = influenceNodes
      .map(({ node }) => getNodeDisplayOutput(node))
      .filter(Boolean);

    const effects = [];
    for (const { node } of influenceNodes) {
      const effect = getMagicTreeNodeSpellEffect(node);
      if (!effect) continue;

      effects.push({
        ...effect,
        typeLabel: SPELL_EFFECT_TYPE_LABELS[effect.type] ?? effect.type
      });

      if (!effect.formula) {
        errors.push(`Влияние «${effect.label}» должно содержать формулу броска.`);
        continue;
      }

      if (!isValidSpellRollFormula(effect.formula)) {
        errors.push(`Влияние «${effect.label}» содержит некорректную формулу: ${effect.formula}.`);
      }
    }

    const materials = selectedNodes.flatMap(({ node }) => normalizeMaterials(node?.materials));
    const costBreakdown = selectedNodes.map(({ id, node }) => ({
      nodeId: id,
      name: asTrimmedString(node?.name) || id,
      value: Math.max(0, Number(node?.cost) || 0)
    }));
    const cost = costBreakdown.reduce((total, entry) => total + entry.value, 0);

    const components = selectedNodes.map(({ id, node }) => {
      const spellEffect = node?.type === MAGIC_TREE_NODE_TYPES.INFLUENCE
        ? getMagicTreeNodeSpellEffect(node)
        : null;

      return {
        id,
        name: asTrimmedString(node?.name) || id,
        type: asTrimmedString(node?.type),
        typeLabel: MAGIC_TREE_NODE_TYPE_LABELS[node?.type] ?? (asTrimmedString(node?.type) || "—"),
        branchId: asTrimmedString(node?.branchId),
        level: Number(node?.level) || 0,
        cost: Math.max(0, Number(node?.cost) || 0),
        output: getNodeDisplayOutput(node),
        materials: normalizeMaterials(node?.materials),
        effectType: spellEffect?.type ?? "",
        effectTypeLabel: spellEffect ? (SPELL_EFFECT_TYPE_LABELS[spellEffect.type] ?? spellEffect.type) : "",
        effectFormula: spellEffect?.formula ?? ""
      };
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      missingNodeIds,
      selectedNodeIds: selectedIds,
      components,
      modifiers: modifierNodes.map(({ id, node }) => ({
        id,
        name: asTrimmedString(node?.name) || id,
        output: getNodeDisplayOutput(node)
      })),
      costBreakdown,
      spell: {
        range,
        shape,
        influences,
        effects,
        cost,
        materials
      },
      meta: {
        treeUuid: asTrimmedString(tree?.uuid),
        treeRevision: Math.max(0, Number(system?.revision) || 0),
        selectedCount: selectedIds.length,
        maxSelectedNodeLevel: selectedNodes.reduce(
          (max, { node }) => Math.max(max, Number(node?.level) || 0),
          0
        )
      }
    };
  }
}
