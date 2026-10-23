import {
  DAMAGE_TYPES, getItemDamageParts, normalizedDamagePart, makeDamagePart,
  validateDamageParts
} from "./damage-types.js";

/** Form elements deliberately have no name attributes: the whole array is updated atomically. */
export function attachDamageEditor(sheet, root) {
  const commit = async (parts) => {
    try {
      validateDamageParts(parts);
      await sheet.document.update({
        "system.damage.parts": parts,
        // Old callers still use this field during the transition.
        "system.damageDie": parts[0]?.formula || "d4"
      });
      await sheet.render({force: true});
    } catch (error) {
      ui.notifications?.error(error.message);
      await sheet.render({force: true});
    }
  };
  root.querySelector(".pg-damage-add")?.addEventListener("click", async (event) => {
    event.preventDefault(); event.stopPropagation();
    await commit([...getItemDamageParts(sheet.document), makeDamagePart()]);
  });
  for (const row of root.querySelectorAll("[data-damage-index]")) {
    const index = Number(row.dataset.damageIndex);
    row.querySelector(".pg-damage-delete")?.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation();
      const parts = getItemDamageParts(sheet.document);
      if (parts.length <= 1) {ui.notifications?.warn("Оставьте хотя бы один компонент урона."); return;}
      parts.splice(index, 1);
      await commit(parts);
    });
    for (const element of row.querySelectorAll(".pg-damage-formula, .pg-damage-category, .pg-damage-type")) {
      element.addEventListener("change", async (event) => {
        event.preventDefault(); event.stopPropagation();
        const parts = getItemDamageParts(sheet.document);
        const part = parts[index];
        if (!part) return;
        if (element.classList.contains("pg-damage-formula")) part.formula = element.value.trim();
        if (element.classList.contains("pg-damage-category")) {
          part.category = element.value;
          part.damageType = element.value === "typed" ? (part.damageType || "fire") : null;
        }
        if (element.classList.contains("pg-damage-type")) part.damageType = element.value;
        await commit(parts.map((value) => normalizedDamagePart(value)));
      });
    }
  }
}
