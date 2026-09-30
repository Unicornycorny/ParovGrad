import { ParovGradSpellBuilder } from "../spell-builder.js";
import { getSpellConstructionStatus } from "../../magic/spell-construction.js";
import {
  SPELL_EFFECT_TYPE_LABELS,
  getSpellEffects
} from "../../magic/spell-effects.js";
import { startSpellUse } from "../../workflows/spell-use.js";

const MAX_INFLUENCES = 4;

function normalizeInfluences(influences) {
  if (!Array.isArray(influences)) return [];

  return influences
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_INFLUENCES);
}

function normalizeMaterials(materials) {
  if (!Array.isArray(materials)) return [];

  return materials
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function normalizeMaterialsText(value) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emptyConstruction() {
  return {
    treeUuid: "",
    treeRevision: 0,
    selectedNodeIds: []
  };
}

export class ParovGradSpellSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;
  _spellBuilder = null;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "spell"],
    position: { width: 700, height: 760 },
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

    const influences = normalizeInfluences(this.document.system?.influences);
    const materials = normalizeMaterials(this.document.system?.materials);
    const spellEffects = getSpellEffects(this.document).map((effect) => ({
      ...effect,
      typeLabel: SPELL_EFFECT_TYPE_LABELS[effect.type] ?? effect.type
    }));
    const constructionStatus = await getSpellConstructionStatus(this.document);

    context.system = this.document.system;
    context.isEditMode = this._isEditMode;

    context.influenceList = influences.map((value, index) => ({
      index,
      value
    }));

    context.canAddInfluence = influences.length < MAX_INFLUENCES;
    context.materialsText = materials.join("\n");
    context.spellEffects = spellEffects;
    context.constructionStatus = constructionStatus;

    context.spellView = {
      name: this.document.name || "—",

      range: this.document.system?.range?.trim() || "—",

      shape: this.document.system?.shape?.trim() || "—",

      level:
        Number.isFinite(Number(this.document.system?.level))
          ? Number(this.document.system.level)
          : 0,

      cost:
        Number.isFinite(Number(this.document.system?.cost))
          ? Number(this.document.system.cost)
          : 0,

      description:
        this.document.system?.description?.trim() || "—",

      influences,
      effects: spellEffects,
      materials
    };

    return context;
  }

  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const fieldName = String(event?.target?.name ?? "");

    // Manually changing a compiled field means the stored tree snapshot no longer
    // exactly describes the spell. Clear provenance rather than showing stale data.
    if (["system.range", "system.shape", "system.cost"].includes(fieldName)) {
      foundry.utils.setProperty(submitData, "system.construction", emptyConstruction());
    }

    return submitData;
  }

  _getHeaderControls() {
    const controls = super._getHeaderControls();

    controls.unshift({
      action: "useSpell",
      icon: "fa-solid fa-wand-sparkles",
      label: "Применить",
      visible: () => this.document.parent?.documentName === "Actor",
      onClick: async () => {
        await startSpellUse({ actor: this.document.parent, item: this.document });
      }
    });

    controls.unshift({
      action: "buildFromMagicTree",
      icon: "fa-solid fa-diagram-project",
      label: "Собрать из древа",
      visible: () => this.isEditable,
      onClick: async () => {
        await this._openSpellBuilder();
      }
    });

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
    super._attachPartListeners(partId, htmlElement, options);

    htmlElement.querySelector(".pg-spell-open-builder")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this._openSpellBuilder();
    });

    if (!this._isEditMode) return;

    const addButton = htmlElement.querySelector(".pg-spell-influence-add");
    const addInput = htmlElement.querySelector(".pg-spell-influence-add-input");

    if (
      addButton instanceof HTMLButtonElement
      && addInput instanceof HTMLInputElement
    ) {
      addButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const currentInfluences = normalizeInfluences(this.document.system?.influences);

        if (currentInfluences.length >= MAX_INFLUENCES) {
          ui.notifications?.warn(
            `У заклинания может быть не более ${MAX_INFLUENCES} типов влияния.`
          );
          return;
        }

        const nextInfluence = addInput.value.trim();

        if (!nextInfluence) {
          ui.notifications?.warn("Введите тип влияния.");
          return;
        }

        await this.document.update({
          "system.influences": [...currentInfluences, nextInfluence],
          "system.effects": [],
          "system.construction": emptyConstruction()
        });
      });
    }

    htmlElement.querySelectorAll(".pg-spell-influence-value").forEach((input) => {
      input.addEventListener("change", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = Number(input.dataset.influenceIndex);
        if (!Number.isInteger(index)) return;

        const currentInfluences = normalizeInfluences(this.document.system?.influences);
        if (index < 0 || index >= currentInfluences.length) return;

        const nextValue = input.value.trim();
        const nextInfluences = nextValue
          ? currentInfluences.map((value, influenceIndex) =>
              influenceIndex === index ? nextValue : value
            )
          : currentInfluences.filter((_value, influenceIndex) => influenceIndex !== index);

        await this.document.update({
          "system.influences": nextInfluences,
          "system.effects": [],
          "system.construction": emptyConstruction()
        });
      });
    });

    htmlElement.querySelectorAll(".pg-spell-influence-delete").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = Number(button.dataset.influenceIndex);
        if (!Number.isInteger(index)) return;

        const currentInfluences = normalizeInfluences(this.document.system?.influences);
        if (index < 0 || index >= currentInfluences.length) return;

        await this.document.update({
          "system.influences": currentInfluences.filter(
            (_value, influenceIndex) => influenceIndex !== index
          ),
          "system.effects": [],
          "system.construction": emptyConstruction()
        });
      });
    });

    const materialsInput = htmlElement.querySelector(".pg-spell-materials-input");
    if (materialsInput instanceof HTMLTextAreaElement) {
      materialsInput.addEventListener("change", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        await this.document.update({
          "system.materials": normalizeMaterialsText(materialsInput.value),
          "system.construction": emptyConstruction()
        });
      });
    }
  }

  async _openSpellBuilder() {
    if (this._spellBuilder?.rendered) {
      this._spellBuilder.bringToFront();
      return;
    }

    this._spellBuilder = new ParovGradSpellBuilder(this.document);
    await this._spellBuilder.render({ force: true });
  }
}
