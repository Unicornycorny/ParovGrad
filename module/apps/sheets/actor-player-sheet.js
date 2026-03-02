export class ParovGradPlayerSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
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
    return context;
  }
}