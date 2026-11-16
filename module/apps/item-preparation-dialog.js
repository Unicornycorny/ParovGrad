import {
  PREPARATION_TYPES,
  getKnownPreparationItems,
  getPreparedItemIds,
  savePreparedItems
} from "../actors/item-preparation.js";

/** Select any subset of the actor's known spells or skills. */
export class ParovGradItemPreparationApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["parovgrad", "sheet", "actor", "player", "pg-preparation-window"],
    position: { width: 560, height: 640 },
    window: { title: "Подготовка", resizable: true }
  };

  static PARTS = {
    main: {
      template: "systems/ParovGrad/templates/apps/item-preparation.hbs",
      scrollable: [".pg-preparation-list"]
    }
  };

  _saving = false;

  constructor(actor, type, options = {}) {
    super(options);
    if (actor?.documentName !== "Actor" || actor.type !== "Player" || !Object.hasOwn(PREPARATION_TYPES, type)) {
      throw new Error("Preparation requires a Player Actor and a spell or skill item type.");
    }
    this.actor = actor;
    this.itemType = type;
    this._selectedIds = new Set(getPreparedItemIds(actor, type));
  }

  get title() {
    return `${PREPARATION_TYPES[this.itemType].label} — ${this.actor.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = PREPARATION_TYPES[this.itemType];
    const items = getKnownPreparationItems(this.actor, this.itemType);
    context.actorName = this.actor.name;
    context.knownLabel = config.knownLabel;
    context.emptyLabel = config.empty;
    context.items = items.map((item) => ({
      id: item.id,
      name: item.name,
      img: item.img,
      prepared: this._selectedIds.has(item.id)
    }));
    context.selectedCount = context.items.filter((item) => item.prepared).length;
    context.totalCount = items.length;
    context.saving = this._saving;
    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    htmlElement.querySelectorAll('input[name="preparedItems"]').forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this._selectedIds.add(checkbox.value);
        else this._selectedIds.delete(checkbox.value);
        const count = htmlElement.querySelector(".pg-preparation-selected-count");
        if (count) count.textContent = String(htmlElement.querySelectorAll('input[name="preparedItems"]:checked').length);
      });
    });

    htmlElement.querySelector(".pg-preparation-save")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this._saveSelection(htmlElement);
    });
    htmlElement.querySelector(".pg-preparation-cancel")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.close();
    });
  }

  async _saveSelection(htmlElement) {
    if (this._saving) return;
    this._saving = true;
    const controls = htmlElement.querySelectorAll('.pg-preparation-save, input[name="preparedItems"]');
    controls.forEach((control) => { control.disabled = true; });
    try {
      await savePreparedItems(this.actor, this.itemType, Array.from(this._selectedIds));
      await this.close();
    } catch (error) {
      console.error("ParovGrad | Could not save prepared items", error);
      ui.notifications?.error(error.message || "Не удалось сохранить список подготовленных записей.");
    } finally {
      this._saving = false;
      controls.forEach((control) => { control.disabled = false; });
    }
  }
}

export async function openItemPreparationDialog(actor, type) {
  if (actor?.documentName !== "Actor" || actor.type !== "Player" || !Object.hasOwn(PREPARATION_TYPES, type)) return;
  if (!actor.isOwner) {
    ui.notifications?.warn("Недостаточно прав для изменения подготовки персонажа.");
    return;
  }
  const app = new ParovGradItemPreparationApp(actor, type);
  await app.render({ force: true });
  return app;
}
