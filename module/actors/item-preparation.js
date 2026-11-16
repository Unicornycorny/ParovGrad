/** Prepared lists reference known embedded Items without changing their use. */
export const PREPARATION_TYPES = Object.freeze({
  spell: Object.freeze({
    field: "preparedSpells",
    label: "Подготовка заклинаний",
    knownLabel: "Известные заклинания",
    empty: "Нет известных заклинаний"
  }),
  skill: Object.freeze({
    field: "preparedSkills",
    label: "Подготовка навыков",
    knownLabel: "Известные навыки",
    empty: "Нет известных навыков"
  })
});

export function getKnownPreparationItems(actor, type) {
  if (!Object.hasOwn(PREPARATION_TYPES, type)) return [];
  return Array.from(actor?.items ?? []).filter((item) => item.type === type);
}

function knownSelectedIds(actor, type, selectedIds) {
  const knownIds = new Set(getKnownPreparationItems(actor, type).map((item) => item.id));
  return [...new Set(Array.from(selectedIds ?? []).filter((id) => knownIds.has(id)))];
}

export function getPreparedItemIds(actor, type) {
  if (!Object.hasOwn(PREPARATION_TYPES, type)) return [];
  return knownSelectedIds(actor, type, actor?.system?.[PREPARATION_TYPES[type].field]);
}

export async function savePreparedItems(actor, type, selectedIds) {
  if (actor?.documentName !== "Actor" || actor.type !== "Player") {
    throw new Error("Подготовка доступна только для персонажа.");
  }
  if (!actor.isOwner) throw new Error("Недостаточно прав для изменения подготовки персонажа.");
  if (!Object.hasOwn(PREPARATION_TYPES, type)) throw new Error("Неизвестный тип подготовки.");

  const ids = knownSelectedIds(actor, type, selectedIds);
  return actor.update({ [`system.${PREPARATION_TYPES[type].field}`]: ids });
}
