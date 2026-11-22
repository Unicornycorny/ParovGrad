import { buildSheetCode } from "./actor-sheet-view.js";

/** Shared portrait control for all Item sheets; respects document permissions. */
export function attachItemPortraitListener(sheet, htmlElement) {
  htmlElement.querySelector(".pg-item-portrait-edit")?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!sheet.isEditable) return;
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: sheet.document.img,
      callback: async (path) => {
        if (!path || !sheet.isEditable) return;
        await sheet.document.update({ img: path });
      }
    });
    await picker.render({ force: true });
  });
}

/** Header data of the "технический паспорт" item sheets. */
export function buildItemPassport(sheet) {
  return {
    code: buildSheetCode(sheet.document),
    canToggleMode: Boolean(sheet.isEditable)
  };
}

/**
 * In-sheet "Править / Готово" button: the same switch as the header control,
 * visible without opening the window menu.
 */
export function attachItemModeToggle(sheet, htmlElement) {
  htmlElement.querySelector(".pg-mode-toggle")?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!sheet.isEditable) return;
    sheet._isEditMode = !sheet._isEditMode;
    await sheet.render({ force: true });
  });
}
