/** Shared by damage rolls and effect editors without importing either workflow. */
export const PHYSICAL_DAMAGE_TYPES = Object.freeze({
  bludgeoning: "Дробящий",
  piercing: "Колющий",
  slashing: "Режущий"
});
export const DAMAGE_TYPES = Object.freeze({
  ...PHYSICAL_DAMAGE_TYPES,
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
  // Accepted in saved data only; normalized to typed bludgeoning on read.
  physical: "Физический",
  typed: "Тип урона",
  unspecified: "Не определён"
});
export const DAMAGE_TYPE_OPTIONS = Object.entries(DAMAGE_TYPES).map(([value, label]) => ({value, label}));
