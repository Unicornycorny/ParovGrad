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
