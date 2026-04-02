export class ParovGradSkillSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "skill"],
    position: { width: 700, height: 560 },
    window: { title: "ParovGrad: Skill", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-skill.hbs",
      scrollable: [""]
    }
  };

  get title() {
    return `Навык: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const currentDamageDie = String(this.document.system?.damageDie || "d4").toLowerCase();
    const baseDamageDice = ["d4", "d6", "d8", "d12"];
    const damageDice = baseDamageDice.includes(currentDamageDie)
      ? baseDamageDice
      : [...baseDamageDice, currentDamageDie];

    context.system = this.document.system;
    context.isEditMode = this._isEditMode;
    context.damageDieOptions = damageDice.map((value) => ({
      value,
      label: value.toUpperCase(),
      selected: value === currentDamageDie
    }));

    context.skillView = {
      name: this.document.name || "-",
      damageDie: String(this.document.system?.damageDie || "-").toUpperCase(),
      description: this.document.system?.description?.trim() || "-"
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
