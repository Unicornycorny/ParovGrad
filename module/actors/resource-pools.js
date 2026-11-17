/**
 * Resource pools for Player and NPC actors.
 * The lower bound is always zero; only the current and maximum are stored.
 */
export function isResourcePoolInRange(pool) {
  return Number.isInteger(pool?.value)
    && Number.isInteger(pool?.max)
    && pool.max >= 0
    && pool.value >= 0
    && pool.value <= pool.max;
}

export function createResourcePoolField() {
  const { SchemaField, NumberField } = foundry.data.fields;
  const nonNegativeInteger = () => new NumberField({
    required: true, integer: true, min: 0, initial: 0
  });
  return new SchemaField({
    value: nonNegativeInteger(),
    max: nonNegativeInteger()
  }, { required: true });
}

const RESOURCE_POOLS = [
  { key: "mana", label: "Мана" },
  { key: "combatPoints", label: "Боевые очки" }
];

/**
 * Validate the relationship between current and maximum *after* Foundry
 * has prepared the actor system candidate. A SchemaField-level `validate`
 * hook is also called for partial updates, where one or both child fields
 * can be missing, and incorrectly rejects ordinary sheet submissions.
 *
 * Called by PlayerDataModel/NpcDataModel.validateJoint, the V13 hook for
 * constraints spanning several fields. Numeric inputs are normalized by
 * NumberField; this function also tolerates their string form during a
 * preliminary validation phase, without allowing blank/invalid values.
 */
export function validateResourcePoolsJoint(data) {
  for (const { key, label } of RESOURCE_POOLS) {
    const pool = data?.[key];
    // DataModel may validate partial changes before building the complete
    // candidate. Field-level NumberField validation handles individual values.
    if (pool == null || pool.value == null || pool.max == null) continue;

    const parseInteger = (input) => {
      if (typeof input === "number") return input;
      if (typeof input === "string" && input.trim() !== "") return Number(input);
      return Number.NaN;
    };
    const value = parseInteger(pool.value);
    const max = parseInteger(pool.max);
    if (!isResourcePoolInRange({ value, max })) {
      throw new Error(`${label}: текущее значение должно быть целым числом от 0 до максимума.`);
    }
  }
}

/**
 * Calculate the displayed fill from a fixed lower bound of zero.
 * Defensive clamping here is visual only: invalid values cannot be saved.
 */
export function buildResourcePoolViews(system) {
  return RESOURCE_POOLS.map(({ key, label }) => {
    const pool = system?.[key];
    const value = Number(pool?.value ?? 0);
    const max = Number(pool?.max ?? 0);
    const fillPercent = Number.isFinite(value) && Number.isFinite(max) && max > 0
      ? Math.max(0, Math.min(100, value / max * 100))
      : 0;
    return { key, label, value, max, fillPercent };
  });
}

/**
 * Reject an invalid edit before submitOnChange can submit the entire actor form.
 * The form inputs are only a convenience layer; TypeDataModel.validateJoint
 * also rejects invalid programmatic updates on a complete candidate.
 */
export function activateResourcePoolInputValidation(root, actor) {
  for (const { key, label } of RESOURCE_POOLS) {
    const valueInput = root.querySelector(`[name="system.${key}.value"]`);
    const maxInput = root.querySelector(`[name="system.${key}.max"]`);
    if (!valueInput || !maxInput) continue;

    const onChange = (event) => {
      const valueRaw = valueInput.value.trim();
      const maxRaw = maxInput.value.trim();
      const value = Number(valueRaw);
      const max = Number(maxRaw);
      const isValid = valueRaw !== "" && maxRaw !== ""
        && isResourcePoolInRange({ value, max });
      if (isValid) {
        // Refresh the native HTML range as soon as the maximum changes.
        valueInput.max = String(max);
        return;
      }

      // Revert only the edited input. Preserve valid, unsaved edits elsewhere.
      event.preventDefault();
      event.stopImmediatePropagation();
      const previous = actor.system?.[key];
      if (event.currentTarget === valueInput) {
        valueInput.value = String(previous?.value ?? 0);
      } else {
        maxInput.value = String(previous?.max ?? 0);
      }
      valueInput.max = maxInput.value;
      globalThis.ui?.notifications?.warn?.(`${label}: значение должно быть целым числом от 0 до максимума.`);
    };

    valueInput.addEventListener("change", onChange);
    maxInput.addEventListener("change", onChange);
  }
}
