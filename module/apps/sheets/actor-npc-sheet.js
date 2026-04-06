import {
  applyEffectItemToActor,
  cloneActiveEffectToActor,
  getActorEffectView,
  openActorEffectDialog
} from "../../effects/effect-utils.js";

export class ParovGradNpcSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "actor", "NPC"],
    position: { width: 760, height: 720 },
    window: { title: "ParovGrad: NPC", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/actor-npc.hbs",
      scrollable: [""]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    context.statViews = this._buildStatViews();
    context.healthInfluenceView = this._buildHealthInfluenceView();
    context.derivedHealthMax = Number(this.document.system.derivedHealthMax) || 0;

    context.items = Array.from(this.document.items)
      .filter((item) => item.type !== "effect")
      .map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type
      }));

    context.effects = Array.from(this.document.effects)
      .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, "ru"))
      .map((effect) => getActorEffectView(effect));

    return context;
  }

  _canDragDrop(selector) {
    return this.isEditable;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    htmlElement.querySelectorAll(".pg-item-link").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item?.sheet) return;

        await item.sheet.render({ force: true });
      });
    });

    htmlElement.querySelectorAll(".pg-item-delete").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Удаление предмета" },
          content: `<p>Удалить предмет <strong>${item.name}</strong> у персонажа?</p>`,
          modal: true,
          rejectClose: false
        });

        if (!confirmed) return;

        await this.document.deleteEmbeddedDocuments("Item", [itemId]);
      });
    });

    htmlElement.querySelectorAll(".pg-effect-create").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await openActorEffectDialog({ actor: this.document });
      });
    });

    htmlElement.querySelectorAll(".pg-effect-edit").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const effectId = element.dataset.effectId;
        if (!effectId) return;

        const effect = this.document.effects.get(effectId);
        if (!effect) return;

        await openActorEffectDialog({ actor: this.document, effect });
      });
    });

    htmlElement.querySelectorAll(".pg-effect-delete").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const effectId = element.dataset.effectId;
        if (!effectId) return;

        const effect = this.document.effects.get(effectId);
        if (!effect) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Удаление эффекта" },
          content: `<p>Удалить эффект <strong>${effect.name}</strong> у персонажа?</p>`,
          modal: true,
          rejectClose: false
        });

        if (!confirmed) return;
        await this.document.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
      });
    });

    htmlElement.querySelectorAll(".pg-effect-toggle").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const effectId = element.dataset.effectId;
        if (!effectId) return;

        const effect = this.document.effects.get(effectId);
        if (!effect) return;

        await effect.update({ disabled: !effect.disabled });
      });
    });

    htmlElement.querySelectorAll(".pg-effect-row[draggable='true']").forEach((element) => {
      element.addEventListener("dragstart", (event) => {
        const effectId = element.dataset.effectId;
        if (!effectId || !event.dataTransfer) return;

        const effect = this.document.effects.get(effectId);
        if (!effect?.uuid) return;

        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: "ActiveEffect",
          uuid: effect.uuid
        }));
      });
    });
  }

  async _onDropItem(event, item) {
    if (item?.type === "effect") {
      await applyEffectItemToActor(this.document, item);
      return;
    }

    return super._onDropItem(event, item);
  }

  async _onDropActiveEffect(event, effect) {
    await cloneActiveEffectToActor(this.document, effect);
  }


  _buildStatViews() {
    const statDefinitions = [
      ["constitution", "Телосложение"],
      ["awareness", "Внимание"],
      ["movement", "Движение"],
      ["thinking", "Мышление"],
      ["will", "Воля"]
    ];

    return statDefinitions.map(([key, label]) => {
      const total = Number(foundry.utils.getProperty(this.document.system, `externalInfluenceTotals.${key}`)) || 0;
      return {
        key,
        label,
        value: Number(foundry.utils.getProperty(this.document.system, `stats.${key}`)) || 0,
        influenceTotal: total,
        influenceDisplay: total >= 0 ? `+${total}` : String(total),
        influenceTooltip: String(foundry.utils.getProperty(this.document.system, `externalInfluenceTooltips.${key}`) ?? "Нет внешних влияний"),
        effectiveValue: Number(foundry.utils.getProperty(this.document.system, `effectiveStats.${key}`)) || 0
      };
    });
  }

  _buildHealthInfluenceView() {
    const total = Number(foundry.utils.getProperty(this.document.system, "externalInfluenceTotals.healthMax")) || 0;
    return {
      influenceTotal: total,
      influenceDisplay: total >= 0 ? `+${total}` : String(total),
      influenceTooltip: String(foundry.utils.getProperty(this.document.system, "derivedHealthInfluenceTooltip") ?? "Нет внешних влияний")
    };
  }
}
