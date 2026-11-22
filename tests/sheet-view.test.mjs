import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importModule } from "./helpers/import-module.mjs";

const {
  STAT_ICONS, gaugePercent, buildHealthGauge, buildSheetCode, buildLedgerView, buildItemRow
} = await importModule(new URL("../module/apps/sheets/actor-sheet-view.js", import.meta.url));

const categories = [
  { key: "inventory", tab: "inventory", types: ["item", "weapon"], empty: "Снаряжение пусто" },
  { key: "spells", tab: "spells", label: "Известные", types: ["spell"] },
  { key: "preparedSpells", tab: "spells", label: "Подготовленные", types: ["spell"], preparedOnly: true },
  { key: "effects", tab: "effects" }
];
const tabs = [
  { key: "inventory", label: "Снаряжение", icon: "fa-toolbox" },
  { key: "spells", label: "Заклинания", icon: "fa-book-open" },
  { key: "effects", label: "Эффекты", icon: "fa-flask" }
];
const counts = { inventory: 4, spells: 3, preparedSpells: 1, effects: 2 };

test("manometer share is clamped to 0..100 and tolerates an empty scale", () => {
  assert.equal(gaugePercent(5, 10), 50);
  assert.equal(gaugePercent(15, 10), 100);
  assert.equal(gaugePercent(-3, 10), 0);
  assert.equal(gaugePercent(4, 0), 0);
  assert.equal(gaugePercent("x", 10), 0);
  assert.deepEqual(buildHealthGauge({ health: { value: 6 }, derivedHealthMax: 8 }), { value: 6, max: 8, fillPercent: 75 });
  assert.deepEqual(buildHealthGauge({}), { value: 0, max: 0, fillPercent: 0 });
});

test("every characteristic has an icon and the archive code is short and stable", () => {
  assert.deepEqual(Object.keys(STAT_ICONS), ["constitution", "awareness", "movement", "thinking", "will"]);
  assert.equal(buildSheetCode({ id: "aBcD1234efGh5678" }), "ПГ-ABCD");
  assert.equal(buildSheetCode({}), "ПГ-0000");
});

test("ledger tabs mark the selected tab and count its first category", () => {
  const view = buildLedgerView({ categories, tabs, selectedKey: "preparedSpells", countFor: (c) => counts[c.key] });
  assert.equal(view.selected.key, "preparedSpells");
  assert.deepEqual(view.sheetTabs.map((t) => [t.key, t.count, t.active]), [
    ["inventory", 4, false], ["spells", 3, true], ["effects", 2, false]
  ]);
  assert.deepEqual(view.preparationFilters.map((f) => [f.key, f.count, f.active]), [
    ["spells", 3, false], ["preparedSpells", 1, true]
  ]);
});

test("unknown categories fall back to the first one; single-category tabs have no switch", () => {
  const view = buildLedgerView({ categories, tabs, selectedKey: "nonsense", countFor: (c) => counts[c.key] });
  assert.equal(view.selected.key, "inventory");
  assert.deepEqual(view.preparationFilters, []);
  assert.deepEqual(buildLedgerView({ categories, tabs, selectedKey: "effects", countFor: () => 0 }).preparationFilters, []);
});

test("specification rows carry a two-digit position and a type caption", () => {
  const row = buildItemRow({ id: "a", name: "Трость", type: "weapon", img: "x.webp", system: { equipped: true } }, 2, { showPreparedBadge: false });
  assert.deepEqual(row, {
    id: "a", name: "Трость", type: "weapon", img: "x.webp", typeLabel: "Оружие",
    position: "03", equipped: true, showPreparedBadge: false
  });
});

test("actor sheets switch the ledger with buttons instead of the old category select", async () => {
  for (const type of ["player", "npc"]) {
    const template = await readFile(new URL(`../templates/sheet/actor-${type}.hbs`, import.meta.url), "utf8");
    const sheet = await readFile(new URL(`../module/apps/sheets/actor-${type}-sheet.js`, import.meta.url), "utf8");
    assert.doesNotMatch(template, /pg-item-category/);
    assert.match(template, /data-pg-category="\{\{this\.key\}\}"/);
    assert.match(sheet, /querySelectorAll\("\[data-pg-category\]"\)/);
    for (const hook of ["pg-item-link", "pg-item-roll", "pg-item-delete", "pg-effect-create", "pg-effect-edit", "pg-effect-delete"]) {
      assert.match(template, new RegExp(`class="[^"]*\\b${hook}\\b`), `${type}: ${hook}`);
    }
  }
});

test("item passports keep the controls their sheet classes listen to", async () => {
  const hooks = {
    item: ["pg-item-portrait-edit", "pg-item-equipped", "pg-weapon-effect-add", "pg-weapon-effect-delete", "pg-mode-toggle", "data-item-effect-application"],
    weapon: ["pg-item-portrait-edit", "pg-item-equipped", "pg-damage-add", "pg-damage-delete", "pg-weapon-effect-add", "pg-mode-toggle"],
    skill: ["pg-item-portrait-edit", "pg-damage-add", "pg-weapon-effect-add", "system.template.enabled", "pg-mode-toggle"],
    spell: ["pg-item-portrait-edit", "pg-spell-open-builder", "pg-spell-influence-add", "pg-spell-materials-input", "pg-mode-toggle"],
    effect: ["pg-item-portrait-edit", "pg-effect-modifier-add", "data-damage-modifier-editor", "pg-mode-toggle"]
  };
  for (const [type, list] of Object.entries(hooks)) {
    const template = await readFile(new URL(`../templates/sheet/item-${type}.hbs`, import.meta.url), "utf8");
    for (const hook of list) assert.ok(template.includes(hook), `${type}: ${hook}`);
  }
});
