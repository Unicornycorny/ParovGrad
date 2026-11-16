import {
  getRestRecoveryPoints,
  getRestRecoverableEffects,
  applyRestRecovery
} from "../actors/rest-recovery.js";

const restApplications = new WeakMap();

export class ParovGradRestRecoveryApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["parovgrad", "sheet", "actor", "player", "pg-rest-window"],
    position: { width: 560, height: 650 },
    window: { title: "Отдых", resizable: true }
  };

  static PARTS = {
    main: {
      template: "systems/ParovGrad/templates/apps/rest-recovery.hbs",
      scrollable: [".sheet-body"]
    }
  };

  _roll = null;
  _rollMode = null;
  _busy = false;
  _applied = false;
  _failed = false;
  _reductions = new Map();
  _healthRecovery = "0";

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  get title() {
    return `Отдых — ${this.actor.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const recoveryPoints = this._roll ? getRestRecoveryPoints(this._roll.total) : 0;
    context.actorName = this.actor.name;
    context.rolled = Boolean(this._roll);
    context.d20 = this._roll?.total;
    context.recoveryPoints = recoveryPoints;
    context.effects = getRestRecoverableEffects(this.actor).map((effect) => ({
      ...effect,
      points: this._reductions.get(effect.id) ?? "0",
      maxReduction: Math.min(effect.level, recoveryPoints)
    }));
    context.healthValue = this.actor.system.health.value;
    context.healthMax = this.actor.system.derivedHealthMax;
    context.healthRecovery = this._healthRecovery;
    context.spentPoints = [...this._reductions.values()].reduce((sum, value) => sum + (Number(value) || 0), 0);
    context.busy = this._busy;
    context.failed = this._failed;
    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    htmlElement.querySelector(".pg-rest-roll")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this._rollRecovery();
    });
    htmlElement.querySelector(".pg-rest-heal")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this._healRecovery(htmlElement);
    });
    htmlElement.querySelector(".pg-rest-apply")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this._applyRecovery(htmlElement);
    });
    htmlElement.querySelector(".pg-rest-cancel")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.close();
    });
    htmlElement.querySelectorAll("input[data-rest-effect-id]").forEach((input) => {
      input.addEventListener("input", () => {
        this._reductions.set(input.dataset.restEffectId, input.value);
        const spent = htmlElement.querySelector(".pg-rest-spent");
        if (spent) spent.textContent = String([...this._reductions.values()].reduce((sum, value) => sum + (Number(value) || 0), 0));
      });
    });
    htmlElement.querySelector(".pg-rest-health")?.addEventListener("input", (event) => {
      this._healthRecovery = event.currentTarget.value;
    });
  }

  async _rollRecovery() {
    if (this._busy || this._roll || this._applied || this._failed) return;
    if (!this.actor.isOwner) {
      ui.notifications?.warn("Недостаточно прав для отдыха персонажа.");
      return;
    }
    this._busy = true;
    try {
      this._rollMode = game.settings.get("core", "rollMode");
      const roll = await new Roll("1d20").evaluate();
      getRestRecoveryPoints(roll.total);
      // Keep the evaluated result even if publishing the chat message fails.
      this._roll = roll;
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: "Отдых: проверка Самочувствия"
      }, { rollMode: this._rollMode });
    } catch (error) {
      console.error("ParovGrad | Rest recovery roll failed", error);
      ui.notifications?.error(this._roll
        ? "Бросок выполнен, но не отправлен в чат. Используйте показанный результат."
        : "Не удалось выполнить бросок отдыха.");
    } finally {
      this._busy = false;
      await this.render({ force: true });
    }
  }

  async _healRecovery(htmlElement) {
    if (this._busy || this._applied || this._failed) return;
    this._healthRecovery = htmlElement.querySelector(".pg-rest-health")?.value ?? this._healthRecovery;
    htmlElement.querySelectorAll("input[data-rest-effect-id]").forEach((input) => {
      this._reductions.set(input.dataset.restEffectId, input.value);
    });
    const controls = htmlElement.querySelectorAll("button, input");
    const rollMode = game.settings.get("core", "rollMode");
    this._busy = true;
    controls.forEach((control) => { control.disabled = true; });
    let result;
    try {
      result = await applyRestRecovery(this.actor, {
        d20: null,
        reductions: [],
        healthRecovery: Number(this._healthRecovery)
      });
      this._healthRecovery = "0";
    } catch (error) {
      console.error("ParovGrad | Could not restore health", error);
      this._failed = Boolean(error.restRecoveryStarted);
      ui.notifications?.error(this._failed
        ? "Не удалось завершить лечение. Проверьте здоровье в листе перед новым восстановлением."
        : error.message || "Не удалось восстановить здоровье.");
    } finally {
      this._busy = false;
    }
    if (!result) {
      controls.forEach((control) => { control.disabled = false; });
      if (this._failed) await this.render({ force: true });
      return;
    }
    await this.render({ force: true });
    ui.notifications?.info(`Восстановлено здоровья: ${result.healthRecovered}.`);
    try {
      const messageData = {
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: renderRestSummary(result)
      };
      ChatMessage.applyRollMode(messageData, rollMode);
      await ChatMessage.create(messageData);
    } catch (error) {
      console.error("ParovGrad | Could not publish healing summary", error);
      ui.notifications?.warn("Здоровье восстановлено, но итог не отправлен в чат.");
    }
  }

  async _applyRecovery(htmlElement) {
    if (this._busy || !this._roll || this._applied || this._failed) return;
    const inputs = [...htmlElement.querySelectorAll("input[data-rest-effect-id]")];
    // Read the controls again to include edits that have not lost focus yet.
    this._reductions = new Map(inputs.map((input) => [input.dataset.restEffectId, input.value]));
    const controls = htmlElement.querySelectorAll("button, input");
    this._busy = true;
    controls.forEach((control) => { control.disabled = true; });
    let result;
    try {
      result = await applyRestRecovery(this.actor, {
        d20: this._roll.total,
        reductions: [...this._reductions].map(([effectId, value]) => ({ effectId, points: Number(value) })),
        healthRecovery: 0
      });
      this._applied = true;
    } catch (error) {
      console.error("ParovGrad | Could not apply rest recovery", error);
      this._failed = Boolean(error.restRecoveryStarted);
      ui.notifications?.error(this._failed
        ? "Не удалось полностью завершить отдых. Проверьте здоровье и эффекты в листе перед новым отдыхом."
        : error.message || "Не удалось применить восстановление.");
    } finally {
      this._busy = false;
    }
    if (!this._applied) {
      controls.forEach((control) => { control.disabled = false; });
      if (this._failed) await this.render({ force: true });
      return;
    }

    await this.close();
    ui.notifications?.info(`Отдых завершён. Снято пунктов эффектов: ${result.spentPoints}.`);
    try {
      const messageData = {
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: renderRestSummary(result)
      };
      ChatMessage.applyRollMode(messageData, this._rollMode);
      await ChatMessage.create(messageData);
    } catch (error) {
      console.error("ParovGrad | Could not publish rest summary", error);
      ui.notifications?.warn("Отдых применён, но итог не отправлен в чат.");
    }
  }

  async close(options = {}) {
    if (this._busy) return this;
    await super.close(options);
    if (restApplications.get(this.actor) === this) restApplications.delete(this.actor);
    return this;
  }
}

function renderRestSummary(result) {
  if (result.d20 === null) {
    return `<div class="pg-rest-summary"><h3>Восстановление здоровья</h3>
      <p>Восстановлено здоровья: <strong>${result.healthRecovered}</strong>. Здоровье: ${result.healthValue} / ${result.healthMax}.</p>
    </div>`;
  }
  const effects = result.effects.map((effect) => `<li>${foundry.utils.escapeHTML(effect.name)}: ${effect.previousLevel} → ${effect.level}${effect.removed ? " (снят)" : ""}</li>`).join("");
  return `<div class="pg-rest-summary"><h3>Отдых: восстановление</h3>
    <p>Самочувствие: D20 = <strong>${result.d20}</strong>. Снято пунктов эффектов: ${result.spentPoints} из ${result.recoveryPoints}.</p>
    ${effects ? `<ul>${effects}</ul>` : "<p>Эффекты без изменений.</p>"}
    <p>Здоровье: ${result.healthValue} / ${result.healthMax}.</p>
  </div>`;
}

export async function openActorRestDialog(actor) {
  if (actor?.documentName !== "Actor" || actor.type !== "Player") return;
  if (!actor.isOwner) {
    ui.notifications?.warn("Недостаточно прав для отдыха персонажа.");
    return;
  }
  const existing = restApplications.get(actor);
  if (existing) {
    await existing.render({ force: true });
    return existing;
  }
  const app = new ParovGradRestRecoveryApp(actor);
  restApplications.set(actor, app);
  try {
    await app.render({ force: true });
    return app;
  } catch (error) {
    restApplications.delete(actor);
    throw error;
  }
}
