import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../module/actors/item-preparation.js", import.meta.url), "utf8");
const { getKnownPreparationItems, getPreparedItemIds, savePreparedItems } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function actor(extra = {}) {
  return {
    documentName: "Actor", type: "Player", isOwner: true,
    items: [
      { id: "spell-a", type: "spell", name: "Одинаковое имя" },
      { id: "spell-b", type: "spell", name: "Одинаковое имя" },
      { id: "skill-a", type: "skill", name: "Навык" },
      { id: "sword", type: "weapon", name: "Меч" }
    ],
    system: {}, writes: [],
    async update(patch) {
      this.writes.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) this.system[path.slice(7)] = value;
      return this;
    },
    ...extra
  };
}

test("legacy actors start with empty preparation while every existing spell and skill stays known", () => {
  const target = actor();
  assert.deepEqual(getPreparedItemIds(target, "spell"), []);
  assert.deepEqual(getPreparedItemIds(target, "skill"), []);
  assert.deepEqual(getKnownPreparationItems(target, "spell").map((item) => item.id), ["spell-a", "spell-b"]);
  assert.deepEqual(getKnownPreparationItems(target, "skill").map((item) => item.id), ["skill-a"]);
  assert.deepEqual(target.writes, []);
});

test("saving spells and skills changes only its respective list and preserves known items and resources", async () => {
  const target = actor({ system: { level: 1, skillPoints: 0, preparedSkills: ["skill-a"] } });
  const originalItems = structuredClone(target.items);
  await savePreparedItems(target, "spell", ["spell-b"]);
  assert.deepEqual(target.writes, [{ "system.preparedSpells": ["spell-b"] }]);
  assert.deepEqual(target.system, { level: 1, skillPoints: 0, preparedSkills: ["skill-a"], preparedSpells: ["spell-b"] });
  await savePreparedItems(target, "skill", []);
  assert.deepEqual(target.writes[1], { "system.preparedSkills": [] });
  assert.deepEqual(target.system.preparedSpells, ["spell-b"]);
  assert.deepEqual(target.items, originalItems);
});

test("prepared lists ignore duplicate, foreign, deleted and wrong-type ids", async () => {
  const selected = ["spell-b", "spell-b", "spell-a", "deleted", "skill-a", "sword", "foreign"];
  const target = actor({ system: { preparedSpells: selected } });
  target.items = target.items.filter((item) => item.id !== "spell-a");
  assert.deepEqual(getPreparedItemIds(target, "spell"), ["spell-b"]);
  await savePreparedItems(target, "spell", selected);
  assert.deepEqual(target.writes, [{ "system.preparedSpells": ["spell-b"] }]);
});

test("any number of known entries can be prepared and the list can be cleared", async () => {
  const items = Array.from({ length: 150 }, (_, index) => ({ id: `spell-${index}`, type: "spell" }));
  const target = actor({ items });
  const allIds = items.map((item) => item.id);
  await savePreparedItems(target, "spell", allIds);
  assert.deepEqual(getPreparedItemIds(target, "spell"), allIds);
  await savePreparedItems(target, "spell", []);
  assert.deepEqual(getPreparedItemIds(target, "spell"), []);
});

test("ownership, actor type and preparation type are checked before writing", async () => {
  for (const extra of [{ isOwner: false }, { type: "NPC" }, { documentName: "Item" }]) {
    const target = actor(extra);
    await assert.rejects(savePreparedItems(target, "spell", ["spell-a"]));
    assert.deepEqual(target.writes, []);
  }
  const target = actor();
  for (const type of ["weapon", "toString", "__proto__"]) {
    await assert.rejects(savePreparedItems(target, type, ["spell-a"]));
    assert.deepEqual(getPreparedItemIds(target, type), []);
    assert.deepEqual(getKnownPreparationItems(target, type), []);
  }
  assert.deepEqual(target.writes, []);
});
