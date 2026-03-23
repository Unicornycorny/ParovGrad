export class ParovGradItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    id: "parovgrad-item-sheet",
    classes: ["ParovGrad", "sheet", "item"],
    position: { width: 650, height: 500 },
    window: { title: "ParovGrad: Item", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-item.hbs",
      scrollable: [""]
    }
  };

  get title() {
    const typeLabel = this.document.type === "weapon" ? "Оружие" : "Предмет";
    return `${typeLabel}: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    context.isEditMode = this._isEditMode;
    context.isWeapon = this.document.type === "weapon";

    const currentDamageDie = this.document.system.damageDie || "d4";
    context.damageDieOptions = ["d4", "d6", "d8", "d12"].map(value => ({
      value,
      label: value.toUpperCase(),
      selected: value === currentDamageDie
    }));

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
