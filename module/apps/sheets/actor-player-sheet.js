export class ParovGradPlayerSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    id: "parovgrad-player-sheet",
    classes: ["parovgrad", "sheet", "actor", "player"],
    position: { width: 700, height: 650 },
    window: { title: "ParovGrad: Player", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/actor-player.hbs",
      // В v13 допускается указать "" чтобы корень part'а считался скроллируемым
      scrollable: [""]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;

    context.items = Array.from(this.document.items).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type
    }));

    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    htmlElement.querySelectorAll(".pg-item-link").forEach(element => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item?.sheet) return;

        await item.sheet.render({ force: true });
      });
    });
  }

  _canDragDrop(selector) {
    return this.isEditable;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    htmlElement.querySelectorAll(".pg-item-link").forEach(element => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item?.sheet) return;

        await item.sheet.render({ force: true });
      });
    });

    htmlElement.querySelectorAll(".pg-item-delete").forEach(element => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Удаление предмета" },
          content: `<p>Удалить предмет <strong>${item.name}</strong> у персонажа?</p>`,
          modal: true,
          rejectClose: false
        });

        if (!confirmed) return;

        await this.document.deleteEmbeddedDocuments("Item", [itemId]);
      });
    });
  }


}