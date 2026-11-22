import { buildResourcePoolViews, activateResourcePoolInputValidation } from "../../actors/resource-pools.js";
import { openConfiguredD20RollDialog, consumeActorInspiration } from "../../dice/roll-dialog.js";
import { startItemAttack, startItemUse } from "../../workflows/weapon-attack.js";
import { startSpellUse } from "../../workflows/spell-use.js";
import {
  applyEffectItemToActor,
  cloneActiveEffectToActor,
  getActorEffectView,
  getActorPassiveItemEffectViews,
  openActorEffectDialog
} from "../../effects/effect-utils.js";
import { openActorLevelUpDialog } from "../level-up-dialog.js";
import { openLearnSkillFromTreeDialog } from "../learn-skill-dialog.js";
import { openItemPreparationDialog } from "../item-preparation-dialog.js";
import { getPreparedItemIds } from "../../actors/item-preparation.js";
import { openActorRestDialog } from "../rest-recovery-dialog.js";
import {
  STAT_ICONS,
  buildHealthGauge,
  buildItemRow,
  buildLedgerView,
  buildSheetCode
} from "./actor-sheet-view.js";
import { animateGaugeNeedles, captureGaugeReadings } from "./gauge-motion.js";

/** Lower half of the sheet: one category per tab or known/prepared switch. */
const PLAYER_CATEGORIES = [
  { key: "inventory", tab: "inventory", types: ["item", "weapon"], empty: "Снаряжение пусто" },
  { key: "spells", tab: "spells", label: "Известные", types: ["spell"], empty: "Нет известных заклинаний" },
  { key: "preparedSpells", tab: "spells", label: "Подготовленные", types: ["spell"], preparedOnly: true, empty: "Нет подготовленных заклинаний" },
  { key: "abilities", tab: "abilities", label: "Известные", types: ["skill"], empty: "Нет известных навыков" },
  { key: "preparedSkills", tab: "abilities", label: "Подготовленные", types: ["skill"], preparedOnly: true, empty: "Нет подготовленных навыков" },
  { key: "effects", tab: "effects" }
];

const PLAYER_TABS = [
  { key: "inventory", label: "Снаряжение", icon: "fa-toolbox" },
  { key: "spells", label: "Заклинания", icon: "fa-book-open" },
  { key: "abilities", label: "Навыки", icon: "fa-scroll" },
  { key: "effects", label: "Эффекты", icon: "fa-flask" }
];

export class ParovGradPlayerSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["parovgrad", "sheet", "actor", "player"],
    position: { width: 860, height: 860 },
    window: { title: "ParovGrad: Player", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/actor-player.hbs",
      scrollable: [".sheet-body"]
    }
  };

  _itemCategory = "inventory";
  /** Last known needle positions, so a re-render can move the needle instead of jumping. */
  _gaugeReadings = new Map();

  async _preRender(context, options) {
    await super._preRender(context, options);
    captureGaugeReadings(this.element, this._gaugeReadings);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    animateGaugeNeedles(this.element, this._gaugeReadings);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    context.canEditProfile = this.isEditable;
    context.statViews = this._buildStatViews();
    context.resourcePools = buildResourcePoolViews(this.document.system);
    context.healthInfluenceView = this._buildHealthInfluenceView();
    context.derivedHealthMax = Number(this.document.system.derivedHealthMax) || 0;
    context.healthGauge = buildHealthGauge(this.document.system);
    context.sheetCode = buildSheetCode(this.document);

    context.effects = Array.from(this.document.effects)
      .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, "ru"))
      .map((effect) => getActorEffectView(effect))
      .concat(getActorPassiveItemEffectViews(this.document));

    const allItems = Array.from(this.document.items);
    const preparedIds = new Set([
      ...getPreparedItemIds(this.document, "spell"),
      ...getPreparedItemIds(this.document, "skill")
    ]);
    const matchesCategory = (item, category) => Boolean(category.types?.includes(item.type))
      && (!category.preparedOnly || preparedIds.has(item.id));
    const ledger = buildLedgerView({
      categories: PLAYER_CATEGORIES,
      tabs: PLAYER_TABS,
      selectedKey: this._itemCategory,
      countFor: (category) => category.key === "effects"
        ? context.effects.length
        : allItems.filter((item) => matchesCategory(item, category)).length
    });
    const selected = ledger.selected;
    context.sheetTabs = ledger.sheetTabs;
    context.preparationFilters = ledger.preparationFilters;
    context.isEffectsTab = selected.tab === "effects";
    context.itemCategoryEmpty = selected.empty ?? "";
    context.isAbilitiesCategory = selected.tab === "abilities";
    context.isPreparationCategory = selected.tab === "spells" || selected.tab === "abilities";
    context.prepareItemType = { spells: "spell", abilities: "skill" }[selected.tab] ?? "";
    const knownTypes = selected.types ?? [];
    context.preparationKnownCount = allItems.filter((item) => knownTypes.includes(item.type)).length;
    context.preparationPreparedCount = allItems.filter((item) => knownTypes.includes(item.type) && preparedIds.has(item.id)).length;
    context.canLearnSkill = this.isEditable;
    // Keep legacy embedded trees accessible for manual export/removal; never silently delete data.
    context.legacyMagicTrees = allItems.filter((item) => item.type === "magicTree")
      .map((item) => ({ id: item.id, name: item.name, img: item.img }));
    context.items = allItems
      .filter((item) => matchesCategory(item, selected))
      .map((item, index) => buildItemRow(item, index, {
        showPreparedBadge: !selected.preparedOnly && preparedIds.has(item.id)
      }));

    return context;
  }

  _canDragDrop(selector) {
    return this.isEditable;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    activateResourcePoolInputValidation(htmlElement, this.document);

    htmlElement.querySelector(".pg-rest-button")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isEditable) return;
      await openActorRestDialog(this.document);
    });

    htmlElement.querySelector(".pg-portrait-edit")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this._editPortrait();
    });

    htmlElement.querySelectorAll("[data-pg-category]").forEach((button) => {
      button.addEventListener("click", (event) => {
        // UI-only state: the ledger tab is not an Actor field.
        event.preventDefault();
        event.stopPropagation();
        const category = button.dataset.pgCategory;
        if (!PLAYER_CATEGORIES.some((entry) => entry.key === category) || category === this._itemCategory) return;
        this._itemCategory = category;
        this.render({ parts: ["form"] });
      });
    });

    htmlElement.querySelectorAll(".pg-prepare-items-button").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await openItemPreparationDialog(this.document, button.dataset.itemType);
      });
    });

    htmlElement.querySelector(".pg-learn-skill-button")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isEditable) return;
      await openLearnSkillFromTreeDialog(this.document);
    });

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

    htmlElement.querySelectorAll(".pg-item-roll").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item) return;

        await this._useItem(item);
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
          classes: ["ParovGrad", "pg-dialog"],
          window: { title: "Удаление предмета" },
          content: `<p>Удалить предмет <strong>${item.name}</strong> у персонажа?</p>`,
          modal: true,
          rejectClose: false
        });

        if (!confirmed) return;

        await this.document.deleteEmbeddedDocuments("Item", [itemId]);
      });
    });

    htmlElement.querySelectorAll(".pg-stat-roll").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const statKey = element.dataset.statKey;
        if (!statKey) return;

        await this._openStatRollDialog(statKey);
      });
    });

    htmlElement.querySelectorAll(".pg-level-up-button").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await openActorLevelUpDialog(this.document);
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
          classes: ["ParovGrad", "pg-dialog"],
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

  async _editPortrait() {
    if (!this.isEditable) return;
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this.document.img,
      callback: async (path) => {
        if (!path || !this.isEditable) return;
        await this.document.update({ img: path });
      }
    });
    await picker.render({ force: true });
  }

  async _onDropItem(event, item) {
    if (item?.type === "skillTree") {
      if (this.isEditable) await openLearnSkillFromTreeDialog(this.document, { treeUuid: item.uuid });
      return;
    }
    if (item?.type === "magicTree") {
      ui.notifications.warn("Древо магии нельзя хранить у актёра. Добавьте созданное на его основе заклинание.");
      return;
    }

    if (item?.type === "effect") {
      await applyEffectItemToActor(this.document, item);
      return;
    }

    return super._onDropItem(event, item);
  }

  async _onDropActiveEffect(event, effect) {
    await cloneActiveEffectToActor(this.document, effect);
  }

  async _useItem(item) {
    if (item.type === "weapon" || item.type === "skill") {
      await startItemAttack({ actor: this.document, item, sourceToken: this.token ?? this.document.token ?? null });
      return;
    }

    if (item.type === "item") {
      await startItemUse({ actor: this.document, item, sourceToken: this.token ?? this.document.token ?? null });
      return;
    }

    if (item.type === "spell") {
      await startSpellUse({ actor: this.document, item, sourceToken: this.token ?? this.document.token ?? null });
      return;
    }

    const result = await openConfiguredD20RollDialog({
      title: `Бросок предмета: ${item.name}`,
      actor: this.document
    });
    if (!result) return;

    await this._rollItem(item, result.mode, result.modifier, result.useInspiration);
  }

  async _openStatRollDialog(statKey) {
    const statConfig = this._getStatConfig(statKey);
    if (!statConfig) return;

    const result = await openConfiguredD20RollDialog({
      title: `Проверка характеристики: ${statConfig.label}`,
      actor: this.document
    });
    if (!result) return;

    await this._rollStatCheck(statKey, result.mode, result.modifier, result.useInspiration);
  }

  async _rollItem(item, mode, modifier = 0, useInspiration = false) {
    const formula = this._buildD20Formula(mode, [modifier]);
    const roll = await this._evaluateActorRoll(formula, { useInspiration });
    if (!roll) return;

    const modeLabel = this._getRollModeLabel(mode);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `${modeLabel}: ${item.name}${useInspiration ? " · Вдохновение" : ""}`
    });
  }

  async _rollStatCheck(statKey, mode, modifier = 0, useInspiration = false) {
    const statConfig = this._getStatConfig(statKey);
    if (!statConfig) return;

    const statValue = Number(foundry.utils.getProperty(this.document.system, `effectiveStats.${statKey}`))
      || Number(foundry.utils.getProperty(this.document.system, `stats.${statKey}`))
      || 0;
    const formula = this._buildD20Formula(mode, [statValue, modifier]);
    const roll = await this._evaluateActorRoll(formula, { useInspiration });
    if (!roll) return;

    const modeLabel = this._getRollModeLabel(mode);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `${modeLabel}: Проверка характеристики «${statConfig.label}»${useInspiration ? " · Вдохновение" : ""}`
    });
  }

  async _evaluateActorRoll(formula, { useInspiration = false } = {}) {
    if (useInspiration) {
      const spent = await consumeActorInspiration(this.document);
      if (!spent) return null;
    }

    const roll = game.parovgrad.dice.createRoll(formula, {}, {
      addExtraDie: useInspiration
    });

    await roll.evaluate();
    return roll;
  }

  _buildD20Formula(mode, numericModifiers = []) {
    let formula = this._getD20RollFormula(mode);

    for (const value of numericModifiers) {
      const number = Number(value);
      if (!Number.isFinite(number) || number === 0) continue;

      formula += number >= 0 ? ` + ${number}` : ` - ${Math.abs(number)}`;
    }

    return formula;
  }

  _getD20RollFormula(mode) {
    switch (mode) {
      case "advantage":
        return "2d20kh";
      case "disadvantage":
        return "2d20kl";
      default:
        return "1d20";
    }
  }

  _getRollModeLabel(mode) {
    return {
      normal: "Обычный бросок",
      advantage: "Бросок с преимуществом",
      disadvantage: "Бросок с помехой"
    }[mode] ?? "Бросок";
  }

  _getStatConfig(statKey) {
    const stats = {
      constitution: { label: "Телосложение" },
      awareness: { label: "Внимание" },
      movement: { label: "Движение" },
      thinking: { label: "Мышление" },
      will: { label: "Воля" }
    };

    return stats[statKey] ?? null;
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
        icon: STAT_ICONS[key],
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
