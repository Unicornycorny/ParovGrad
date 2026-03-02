export class ParovGradPlayerSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  static DEFAULT_OPTIONS = {
    id: "parovgrad-player-sheet",
    classes: ["parovgrad", "sheet", "actor", "player"],
    position: { width: 700, height: 650 },
    window: { title: "Parovgrad: Player" },
    form: {
      handler: this.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    main: { template: "systems/ParovGrad/templates/sheet/actor-player.hbs" }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    return context;
  }

  static async #onSubmit(event, form, formData) {
    // formData is a FormDataExtended-like structure; update the document
    await this.document.update(formData.object);
  }
}