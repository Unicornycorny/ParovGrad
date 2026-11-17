const ACTOR_RESOURCES = [
  { key: "mana", label: "Мана" },
  { key: "combatPoints", label: "Боевые очки" }
];

/** Each resource owns its fields so its limits can be set independently. */
export function createActorResourceSchema() {
  const { SchemaField, NumberField } = foundry.data.fields;
  const integerField = (initial) => new NumberField({ required: true, integer: true, initial });
  return new SchemaField({
    value: integerField(10),
    min: integerField(0),
    max: integerField(10)
  });
}

function toInteger(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function getResourceValues(resource = {}) {
  const min = toInteger(resource?.min, 0);
  // Keep the requested minimum when inverted limits collapse the range.
  const max = Math.max(min, toInteger(resource?.max, 10));
  const value = Math.min(max, Math.max(min, toInteger(resource?.value, 10)));
  return { value, min, max };
}

export function getActorResourceViews(system) {
  return ACTOR_RESOURCES.map(({ key, label }) => {
    const { value, min, max } = getResourceValues(system?.[key]);
    const percent = max > min ? 100 * (value - min) / (max - min) : 0;
    return { key, label, value, min, max, percent };
  });
}

/** Normalize merged source data into the create source or update patch. */
export function normalizeActorResources(source, changed = source) {
  for (const { key } of ACTOR_RESOURCES) {
    const resource = source?.system?.[key];
    if (resource === undefined) continue;
    const values = getResourceValues(resource);
    for (const [field, value] of Object.entries(values)) {
      foundry.utils.setProperty(changed, `system.${key}.${field}`, value);
    }
  }
}
