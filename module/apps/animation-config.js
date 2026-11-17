const animationWindows = new WeakMap();
const ANIMATION_FIELDS = [
  { key: "cast", label: "Применение", hint: "На токене, который использует предмет или заклинание." },
  { key: "projectile", label: "Полёт к цели", hint: "Снаряд от действующего токена к выбранной цели." },
  { key: "hit", label: "Попадание", hint: "На цели после успешной атаки." },
  { key: "miss", label: "Промах", hint: "На цели после неудачной атаки." },
  { key: "healing", label: "Лечение", hint: "На получателе лечения." },
  { key: "area", label: "Область", hint: "В месте размещённого шаблона области." },
  { key: "persistent", label: "Постоянная аура", hint: "Показывается на токене, пока наложен этот эффект." }
];

function animationApi() {
  return globalThis.game?.parovgrad?.animations;
}

function normalizePreset(value) {
  if (animationApi()?.normalizePreset) return animationApi().normalizePreset(value);
  const preset = { enabled: value?.enabled === true };
  for (const { key } of ANIMATION_FIELDS) preset[key] = String(value?.[key] ?? "").trim();
  const scale = Number(value?.scale ?? 1);
  const opacity = Number(value?.opacity ?? 1);
  preset.scale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 10) : 1;
  preset.opacity = Number.isFinite(opacity) ? Math.max(0, Math.min(opacity, 1)) : 1;
  return preset;
}

export class ParovGradAnimationConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["parovgrad", "pg-animation-window"],
    position: { width: 600, height: 720 },
    window: { title: "Анимации JB2A", resizable: true }
  };

  static PARTS = {
    main: {
      template: "systems/ParovGrad/templates/apps/animation-config.hbs",
      scrollable: [".pg-animation-fields"]
    }
  };

  _busy = false;

  constructor(item, { canEdit = () => item.isOwner, ...options } = {}) {
    super(options);
    this.item = item;
    this._canEdit = canEdit;
  }

  get title() {
    return `Анимации JB2A — ${this.item.name}`;
  }

  get canEdit() {
    return Boolean(this._canEdit()) && this.item.isOwner !== false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const api = animationApi();
    const preset = normalizePreset(api?.getPreset?.(this.item)
      ?? this.item.getFlag?.("ParovGrad", "animation")
      ?? this.item.flags?.ParovGrad?.animation);
    const entries = await api?.listEntries?.() ?? [];
    context.entries = [...new Set(Array.from(entries).map((entry) => typeof entry === "string"
      ? entry : entry?.key ?? entry?.path ?? "").filter((entry) => entry.startsWith("jb2a.")))].sort();
    context.itemName = this.item.name;
    context.preset = preset;
    context.fields = ANIMATION_FIELDS.filter(({ key }) => key !== "persistent" || this.item.type === "effect")
      .map((field) => ({ ...field, value: preset[field.key] ?? "" }));
    context.listId = `pg-animation-paths-${this.id}`;
    context.canEdit = this.canEdit;
    context.hasEntries = context.entries.length > 0;
    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    htmlElement.querySelector(".pg-animation-save")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this._save(htmlElement);
    });
    htmlElement.querySelector(".pg-animation-cancel")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.close();
    });
  }

  async _save(htmlElement) {
    if (this._busy) return;
    if (!this.canEdit) {
      ui.notifications?.warn("Недостаточно прав для изменения анимаций этого предмета.");
      return;
    }
    const preset = { enabled: Boolean(htmlElement.querySelector('[name="enabled"]')?.checked) };
    for (const { key } of ANIMATION_FIELDS) {
      if (key === "persistent" && this.item.type !== "effect") continue;
      preset[key] = htmlElement.querySelector(`[name="${key}"]`)?.value ?? "";
    }
    for (const key of ["scale", "opacity"]) {
      const input = htmlElement.querySelector(`[name="${key}"]`);
      if (input?.reportValidity && !input.reportValidity()) return;
      preset[key] = input?.value ?? 1;
    }
    const controls = htmlElement.querySelectorAll("button, input");
    this._busy = true;
    controls.forEach((control) => { control.disabled = true; });
    try {
      await this.item.update({ "flags.ParovGrad.animation": normalizePreset(preset) });
      await this.close();
    } catch (error) {
      console.error("ParovGrad | Could not save item animations", error);
      ui.notifications?.error("Не удалось сохранить анимации. Введённые значения сохранены в этом окне.");
    } finally {
      this._busy = false;
      controls.forEach((control) => { control.disabled = !this.canEdit; });
    }
  }
}

export async function openAnimationConfig(item, options = {}) {
  let app = animationWindows.get(item);
  if (app?.rendered) {
    app.bringToFront();
    return app;
  }
  app = new ParovGradAnimationConfig(item, options);
  animationWindows.set(item, app);
  await app.render({ force: true });
  return app;
}

export function animationHeaderControl(sheet) {
  return {
    action: "configureJB2AAnimations",
    icon: "fa-solid fa-film",
    label: "Анимации JB2A",
    visible: () => sheet.isEditable,
    onClick: async () => openAnimationConfig(sheet.document, { canEdit: () => sheet.isEditable })
  };
}
