export class ParovGradEffectSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "effect"],
    position: { width: 720, height: 680 },
    window: { title: "ParovGrad: Effect", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-effect.hbs",
      scrollable: [""]
    }
  };

  get title() {
    return `Эффект: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    context.isEditMode = this._isEditMode;
    context.effectView = {
      name: this.document.name || "—",
      level: Number.isFinite(Number(this.document.system?.level)) ? Number(this.document.system.level) : 1,
      effectType: this.document.system?.effectType?.trim() || "—",
      impact: this.document.system?.impact?.trim() || "—",
      removal: this.document.system?.removal?.trim() || "—",
      description: this.document.system?.description?.trim() || "—",
      changes: this.document.system?.changes?.trim() || "[]"
    };
    return context;
  }

  _getHeaderControls() {
    const controls = super._getHeaderControls();

    controls.unshift({
      action: "toggleEditMode",
      icon: this._isEditMode ? "fa-solid fa-lock-open" : "fa-solid fa-pen-to-square",
      label: this._isEditMode ? "Завершить редактирование" : "Редактировать",
      visible: () => this.isEditable,
      onClick: async () => {
        this._isEditMode = !this._isEditMode;
        await this.render({ force: true });
      }
    });

    return controls;
  }
}
