import { startWeaponAttack } from "../../workflows/weapon-attack.js";

export class ParovGradPlayerSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    id: "parovgrad-player-sheet",
    classes: ["parovgrad", "sheet", "actor", "player"],
    position: { width: 700, height: 650 },
    window: { title: "ParovGrad: Player", resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/actor-player.hbs",
      scrollable: [""]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const derivedHealthMax = this._getDerivedHealthMax();

    context.system = this.document.system;
    context.derivedHealthMax = derivedHealthMax;

    context.items = Array.from(this.document.items).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      isWeapon: item.type === "weapon"
    }));

    return context;
  }

  _canDragDrop(selector) {
    return this.isEditable;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    htmlElement.querySelectorAll(".pg-item-link").forEach(element => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();

        const itemId = element.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item?.sheet) return;

        await item.sheet.render({ force: true });
      });
    });

    htmlElement.querySelectorAll(".pg-item-roll").forEach(element => {
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

    htmlElement.querySelectorAll(".pg-item-delete").forEach(element => {
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

    htmlElement.querySelectorAll(".pg-stat-roll").forEach(element => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const statKey = element.dataset.statKey;
        if (!statKey) return;

        await this._openStatRollDialog(statKey);
      });
    });
  }

  async _useItem(item) {
    if (item.type === "weapon") {
      await startWeaponAttack({ actor: this.document, item });
      return;
    }

    const result = await this._openD20RollDialog(`Бросок предмета: ${item.name}`);
    if (!result) return;

    await this._rollItem(item, result.mode, result.modifier);
  }

  async _openStatRollDialog(statKey) {
    const statConfig = this._getStatConfig(statKey);
    if (!statConfig) return;

    const result = await this._openD20RollDialog(`Проверка характеристики: ${statConfig.label}`);
    if (!result) return;

    await this._rollStatCheck(statKey, result.mode, result.modifier);
  }

  async _openD20RollDialog(title) {
    return foundry.applications.api.DialogV2.wait({
      window: { title },
      modal: true,
      rejectClose: false,
      content: `
        <form class="pg-roll-dialog">
          <div class="pg-roll-dialog__field">
            <label for="pg-roll-modifier">Ручной модификатор</label>
            <input id="pg-roll-modifier" name="modifier" type="number" step="1" value="0" autofocus>
          </div>
          <p class="pg-roll-dialog__hint">Выберите вариант броска.</p>
        </form>
      `,
      buttons: [
        {
          action: "normal",
          label: "Обычный",
          callback: (event, button) => ({
            mode: "normal",
            modifier: Number(button.form?.elements?.modifier?.value) || 0
          })
        },
        {
          action: "advantage",
          label: "Преимущество",
          callback: (event, button) => ({
            mode: "advantage",
            modifier: Number(button.form?.elements?.modifier?.value) || 0
          })
        },
        {
          action: "disadvantage",
          label: "Помеха",
          callback: (event, button) => ({
            mode: "disadvantage",
            modifier: Number(button.form?.elements?.modifier?.value) || 0
          })
        }
      ]
    });
  }

  async _rollItem(item, mode, modifier = 0) {
    const formula = this._buildD20Formula(mode, [modifier]);
    const roll = await (new Roll(formula)).evaluate();

    const modeLabel = this._getRollModeLabel(mode);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `${modeLabel}: ${item.name}`
    });
  }

  async _rollStatCheck(statKey, mode, modifier = 0) {
    const statConfig = this._getStatConfig(statKey);
    if (!statConfig) return;

    const statValue = Number(foundry.utils.getProperty(this.document.system, `stats.${statKey}`)) || 0;
    const formula = this._buildD20Formula(mode, [statValue, modifier]);
    const roll = await (new Roll(formula)).evaluate();

    const modeLabel = this._getRollModeLabel(mode);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `${modeLabel}: Проверка характеристики «${statConfig.label}»`
    });
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

  _getDerivedHealthMax() {
    const constitution = Number(foundry.utils.getProperty(this.document.system, "stats.constitution")) || 0;
    const lifePath = Number(foundry.utils.getProperty(this.document.system, "lifePath")) || 0;
    return Math.max(0, constitution * lifePath);
  }
}