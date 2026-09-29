const MAX_INFLUENCES = 4;

function normalizeInfluences(influences) {
  if (!Array.isArray(influences)) return [];

  return influences
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_INFLUENCES);
}

export class ParovGradSpellSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "spell"],
    position: { width: 700, height: 700 },
    window: {
      title: "ParovGrad: Spell",
      resizable: true
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-spell.hbs",
      scrollable: [".sheet-body"]
    }
  };

  get title() {
    return `Заклинание: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const influences = normalizeInfluences(
      this.document.system?.influences
    );

    context.system = this.document.system;
    context.isEditMode = this._isEditMode;

    context.influenceList = influences.map((value, index) => ({
      index,
      value
    }));

    context.canAddInfluence =
      influences.length < MAX_INFLUENCES;

    context.spellView = {
      name: this.document.name || "—",

      range:
        this.document.system?.range?.trim() || "—",

      shape:
        this.document.system?.shape?.trim() || "—",

      school:
        this.document.system?.school?.trim() || "—",

      level:
        Number.isFinite(Number(this.document.system?.level))
          ? Number(this.document.system.level)
          : 0,

      description:
        this.document.system?.description?.trim() || "—",

      influences
    };

    return context;
  }

  _getHeaderControls() {
    const controls = super._getHeaderControls();

    controls.unshift({
      action: "toggleEditMode",

      icon: this._isEditMode
        ? "fa-solid fa-lock-open"
        : "fa-solid fa-pen-to-square",

      label: this._isEditMode
        ? "Завершить редактирование"
        : "Редактировать",

      visible: () => this.isEditable,

      onClick: async () => {
        this._isEditMode = !this._isEditMode;
        await this.render({ force: true });
      }
    });

    return controls;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(
      partId,
      htmlElement,
      options
    );

    if (!this._isEditMode) return;

    const addButton =
      htmlElement.querySelector(
        ".pg-spell-influence-add"
      );

    const addInput =
      htmlElement.querySelector(
        ".pg-spell-influence-add-input"
      );

    if (
      addButton instanceof HTMLButtonElement
      && addInput instanceof HTMLInputElement
    ) {
      addButton.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const currentInfluences =
            normalizeInfluences(
              this.document.system?.influences
            );

          if (
            currentInfluences.length
            >= MAX_INFLUENCES
          ) {
            ui.notifications?.warn(
              `У заклинания может быть не более ${MAX_INFLUENCES} типов влияния.`
            );
            return;
          }

          const nextInfluence =
            addInput.value.trim();

          if (!nextInfluence) {
            ui.notifications?.warn(
              "Введите тип влияния."
            );
            return;
          }

          await this.document.update({
            "system.influences": [
              ...currentInfluences,
              nextInfluence
            ]
          });
        }
      );
    }

    htmlElement
      .querySelectorAll(
        ".pg-spell-influence-value"
      )
      .forEach((input) => {
        input.addEventListener(
          "change",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const index = Number(
              input.dataset.influenceIndex
            );

            if (!Number.isInteger(index)) {
              return;
            }

            const currentInfluences =
              normalizeInfluences(
                this.document.system?.influences
              );

            if (
              index < 0
              || index >= currentInfluences.length
            ) {
              return;
            }

            const nextValue =
              input.value.trim();

            const nextInfluences =
              nextValue
                ? currentInfluences.map(
                    (value, influenceIndex) =>
                      influenceIndex === index
                        ? nextValue
                        : value
                  )
                : currentInfluences.filter(
                    (_value, influenceIndex) =>
                      influenceIndex !== index
                  );

            await this.document.update({
              "system.influences":
                nextInfluences
            });
          }
        );
      });

    htmlElement
      .querySelectorAll(
        ".pg-spell-influence-delete"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const index = Number(
              button.dataset.influenceIndex
            );

            if (!Number.isInteger(index)) {
              return;
            }

            const currentInfluences =
              normalizeInfluences(
                this.document.system?.influences
              );

            if (
              index < 0
              || index >= currentInfluences.length
            ) {
              return;
            }

            await this.document.update({
              "system.influences":
                currentInfluences.filter(
                  (_value, influenceIndex) =>
                    influenceIndex !== index
                )
            });
          }
        );
      });
  }
}