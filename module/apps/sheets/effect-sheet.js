import {
  getEffectItemTemplateData,
  getEffectModifierOptions,
  getEffectModifierLabel
} from "../../effects/effect-utils.js";

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
      scrollable: [".sheet-body"]
    }
  };

  get title() {
    return `Эффект: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effectData = getEffectItemTemplateData(this.document);

    context.system = this.document.system;
    context.isEditMode = this._isEditMode;
    context.modifierTargetOptions = getEffectModifierOptions();
    context.modifierList = effectData.modifiers.map((modifier, index) => ({
      index,
      target: modifier.target,
      label: getEffectModifierLabel(modifier.target),
      value: modifier.value,
      signedValue: modifier.value >= 0 ? `+${modifier.value}` : String(modifier.value)
    }));

    context.effectView = {
      name: effectData.name,
      level: effectData.level,
      effectType: effectData.effectType || "—",
      impact: effectData.impact || "—",
      removal: effectData.removal || "—",
      description: effectData.description || "—",
      modifierSummary: effectData.modifierSummary || "—",
      modifierList: context.modifierList
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

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (!this._isEditMode) return;

    const addButton = htmlElement.querySelector(".pg-effect-modifier-add");
    const targetSelect = htmlElement.querySelector(".pg-effect-modifier-target");
    const valueInput = htmlElement.querySelector(".pg-effect-modifier-value-input");

    if (addButton instanceof HTMLButtonElement && targetSelect instanceof HTMLSelectElement && valueInput instanceof HTMLInputElement) {
      addButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const effectData = getEffectItemTemplateData(this.document);
        const modifiers = [...effectData.modifiers, {
          target: targetSelect.value,
          value: Math.trunc(Number(valueInput.value) || 0)
        }];

        valueInput.value = "0";
        await this.document.update({
          "system.modifiers": modifiers,
          "system.changes": "[]"
        });
      });
    }

    htmlElement.querySelectorAll(".pg-effect-modifier-row__value").forEach((input) => {
      input.addEventListener("change", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = Number(input.dataset.modifierIndex);
        if (!Number.isInteger(index)) return;

        const effectData = getEffectItemTemplateData(this.document);
        if (!effectData.modifiers[index]) return;

        const modifiers = effectData.modifiers.map((modifier, modifierIndex) => modifierIndex === index ? {
          ...modifier,
          value: Math.trunc(Number(input.value) || 0)
        } : modifier);

        await this.document.update({
          "system.modifiers": modifiers,
          "system.changes": "[]"
        });
      });
    });

    htmlElement.querySelectorAll(".pg-effect-modifier-delete").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = Number(button.dataset.modifierIndex);
        if (!Number.isInteger(index)) return;

        const effectData = getEffectItemTemplateData(this.document);
        const modifiers = effectData.modifiers.filter((_modifier, modifierIndex) => modifierIndex !== index);

        await this.document.update({
          "system.modifiers": modifiers,
          "system.changes": "[]"
        });
      });
    });
  }
}
