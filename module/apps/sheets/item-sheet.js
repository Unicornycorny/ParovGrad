const STANDARD_EFFECT_DICE = ["", "d2", "d4", "d6", "d8", "d12", "d20", "d100"];

function getDieFaces(die) {
  const match = String(die ?? "").trim().toLowerCase().match(/^d(2|4|6|8|12|20|100)$/);
  return match ? Number(match[1]) : null;
}

function normalizeEffectRangeEntry(entry, dieFaces = null) {
  const min = 1;
  const max = Number.isFinite(dieFaces) && dieFaces > 0 ? dieFaces : null;

  let from = Math.trunc(Number(entry?.from) || 1);
  let to = Math.trunc(Number(entry?.to) || from);

  from = Math.max(from, min);
  to = Math.max(to, min);

  if (max) {
    from = Math.min(from, max);
    to = Math.min(to, max);
  }

  if (from > to) [from, to] = [to, from];

  return {
    from,
    to,
    effect: String(entry?.effect ?? "").trim()
  };
}

export class ParovGradItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item"],
    position: { width: 700, height: 700 },
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
    return `Предмет: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const currentEffectDie = String(this.document.system?.effectCheckDie || "").toLowerCase();
    const effectDice = STANDARD_EFFECT_DICE.includes(currentEffectDie)
      ? STANDARD_EFFECT_DICE
      : [...STANDARD_EFFECT_DICE, currentEffectDie].filter((value, index, array) => array.indexOf(value) === index);

    const effectDieFaces = getDieFaces(currentEffectDie);
    const effectRanges = Array.isArray(this.document.system?.effectRanges)
      ? this.document.system.effectRanges.map((entry, index) => ({
          index,
          ...normalizeEffectRangeEntry(entry, effectDieFaces),
          hasText: Boolean(String(entry?.effect ?? "").trim())
        }))
      : [];

    context.system = this.document.system;
    context.isEditMode = this._isEditMode;
    context.effectDieOptions = effectDice.map((value) => ({
      value,
      label: value ? value.toUpperCase() : "— Не использовать —",
      selected: value === currentEffectDie
    }));
    context.effectRanges = effectRanges;
    context.effectCheckConfigured = Boolean(currentEffectDie && effectRanges.length);

    context.itemView = {
      name: this.document.name || "—",
      description: this.document.system?.description?.trim() || "—",
      effectCheckDie: currentEffectDie ? currentEffectDie.toUpperCase() : "—",
      effectRanges
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

    const addButton = htmlElement.querySelector(".pg-weapon-effect-add");
    const fromInput = htmlElement.querySelector(".pg-weapon-effect-add-from");
    const toInput = htmlElement.querySelector(".pg-weapon-effect-add-to");
    const textInput = htmlElement.querySelector(".pg-weapon-effect-add-text");

    if (
      addButton instanceof HTMLButtonElement
      && fromInput instanceof HTMLInputElement
      && toInput instanceof HTMLInputElement
      && textInput instanceof HTMLTextAreaElement
    ) {
      addButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const dieFaces = getDieFaces(this.document.system?.effectCheckDie);
        if (!dieFaces) {
          ui.notifications?.warn("Сначала выберите куб проверки дополнительного эффекта.");
          return;
        }

        const currentRanges = Array.isArray(this.document.system?.effectRanges)
          ? this.document.system.effectRanges
          : [];

        const nextEntry = normalizeEffectRangeEntry({
          from: fromInput.value,
          to: toInput.value,
          effect: textInput.value
        }, dieFaces);

        await this.document.update({
          "system.effectRanges": [...currentRanges, nextEntry]
        });

        fromInput.value = "1";
        toInput.value = String(dieFaces);
        textInput.value = "";
      });
    }

    htmlElement.querySelectorAll(".pg-weapon-effect-row__from, .pg-weapon-effect-row__to, .pg-weapon-effect-row__text").forEach((element) => {
      element.addEventListener("change", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = element.closest("[data-effect-range-index]");
        const index = Number(row?.dataset.effectRangeIndex);
        if (!Number.isInteger(index)) return;

        const dieFaces = getDieFaces(this.document.system?.effectCheckDie);
        const currentRanges = Array.isArray(this.document.system?.effectRanges)
          ? foundry.utils.deepClone(this.document.system.effectRanges)
          : [];
        if (!currentRanges[index]) return;

        const fromField = row.querySelector(".pg-weapon-effect-row__from");
        const toField = row.querySelector(".pg-weapon-effect-row__to");
        const textField = row.querySelector(".pg-weapon-effect-row__text");
        if (!(fromField instanceof HTMLInputElement) || !(toField instanceof HTMLInputElement) || !(textField instanceof HTMLTextAreaElement)) return;

        currentRanges[index] = normalizeEffectRangeEntry({
          from: fromField.value,
          to: toField.value,
          effect: textField.value
        }, dieFaces);

        await this.document.update({
          "system.effectRanges": currentRanges
        });
      });
    });

    htmlElement.querySelectorAll(".pg-weapon-effect-delete").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = Number(button.dataset.effectRangeIndex);
        if (!Number.isInteger(index)) return;

        const currentRanges = Array.isArray(this.document.system?.effectRanges)
          ? this.document.system.effectRanges
          : [];

        await this.document.update({
          "system.effectRanges": currentRanges.filter((_entry, entryIndex) => entryIndex !== index)
        });
      });
    });
  }
}
