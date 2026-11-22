/**
 * View helpers shared by the Player and NPC sheets ("чертёж-досье" layout):
 * stat icons, the health manometer, ledger tabs and item rows.
 * Pure functions over plain data so the sheets stay thin.
 */

/** FontAwesome icon per characteristic (as on the paper character sheet). */
export const STAT_ICONS = Object.freeze({
  constitution: "fa-person",
  awareness: "fa-eye",
  movement: "fa-person-running",
  thinking: "fa-brain",
  will: "fa-hand-fist"
});

export const ITEM_TYPE_LABELS = Object.freeze({
  item: "Предмет",
  weapon: "Оружие",
  spell: "Заклинание",
  skill: "Навык",
  effect: "Эффект",
  magicTree: "Древо магии",
  skillTree: "Древо навыков"
});

/** Share of a 0..max scale in percent, clamped for display only. */
export function gaugePercent(value, max) {
  const current = Number(value);
  const limit = Number(max);
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (current / limit) * 100));
}

/** Manometer data for current health against the derived maximum. */
export function buildHealthGauge(system) {
  const value = Number(system?.health?.value) || 0;
  const max = Number(system?.derivedHealthMax) || 0;
  return { value, max, fillPercent: gaugePercent(value, max) };
}

/** Short archive code printed on the photo caption and the title block. */
export function buildSheetCode(document) {
  const id = String(document?.id ?? "").replace(/[^a-z0-9]/gi, "");
  return `ПГ-${(id.slice(0, 4) || "0000").toUpperCase()}`;
}

/**
 * Ledger state for the lower half of the sheet: tab buttons, the
 * known/prepared switch and the selected category.
 *
 * @param {object[]} categories  {key, tab, label?, types?, preparedOnly?, empty?}
 * @param {object[]} tabs        {key, label, icon}
 * @param {string} selectedKey   sheet-local category
 * @param {(category: object) => number} countFor
 */
export function buildLedgerView({ categories, tabs, selectedKey, countFor }) {
  const selected = categories.find((category) => category.key === selectedKey) ?? categories[0];
  const tabCount = (tabKey) => {
    const first = categories.find((category) => category.tab === tabKey);
    return first ? countFor(first) : 0;
  };
  const filters = categories.filter((category) => category.tab === selected.tab && category.label);
  return {
    selected,
    sheetTabs: tabs.map((tab) => ({
      ...tab,
      count: tabCount(tab.key),
      active: tab.key === selected.tab
    })),
    preparationFilters: filters.length > 1
      ? filters.map((category) => ({
        key: category.key,
        label: category.label,
        count: countFor(category),
        active: category.key === selected.key
      }))
      : []
  };
}

/** Row data for the "спецификация" list: position number and type caption. */
export function buildItemRow(item, index, extra = {}) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    img: item.img,
    typeLabel: ITEM_TYPE_LABELS[item.type] ?? item.type,
    position: String(index + 1).padStart(2, "0"),
    equipped: item.system?.equipped === true,
    ...extra
  };
}
