import { DAMAGE_TYPES } from "../damage/damage-config.js";

export const DAMAGE_MODIFIER_MODES = Object.freeze({
  resistance: "Сопротивление",
  immunity: "Иммунитет",
  vulnerability: "Уязвимость"
});

export const DAMAGE_MODIFIER_TYPES = Object.freeze({
  all: "Любой урон",
  physical: "Весь физический урон",
  unspecified: "Урон без типа",
  ...DAMAGE_TYPES
});

/** Older effects have no damage modifiers; unknown saved entries cannot grant protection. */
export function normalizeDamageModifiers(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const mode = String(entry?.mode ?? "").trim();
    const damageType = String(entry?.damageType ?? "").trim();
    return Object.hasOwn(DAMAGE_MODIFIER_MODES, mode) && Object.hasOwn(DAMAGE_MODIFIER_TYPES, damageType)
      ? [{ mode, damageType }] : [];
  });
}

export function damageModifiersSchema() {
  const { ArrayField, SchemaField, StringField } = foundry.data.fields;
  return new ArrayField(new SchemaField({
    mode: new StringField({ required: true, blank: false, initial: "resistance", choices: Object.keys(DAMAGE_MODIFIER_MODES) }),
    damageType: new StringField({ required: true, blank: false, initial: "all", choices: Object.keys(DAMAGE_MODIFIER_TYPES) })
  }), { required: true, initial: [] });
}

/** Read current effects at damage application so equipping, removal and suppression take effect immediately. */
export function getActorDamageModifiers(actor) {
  const effects = [
    ...Array.from(actor?.effects ?? []),
    ...Array.from(actor?.items ?? [])
      .filter((item) => ["item", "weapon"].includes(item.type) && item.system?.equipped === true)
      .flatMap((item) => Array.from(item.effects ?? [])
        .filter((effect) => effect?.flags?.ParovGrad?.itemApplication !== "active"))
  ];
  return effects.filter((effect) => effect && !effect.disabled && !effect.isSuppressed)
    .flatMap((effect) => normalizeDamageModifiers(effect.flags?.ParovGrad?.damageModifiers));
}

export function getDamageModifierModeOptions(selected = "resistance") {
  return Object.entries(DAMAGE_MODIFIER_MODES).map(([value, label]) => ({ value, label, selected: value === selected }));
}

export function getDamageModifierTypeOptions(selected = "all") {
  return Object.entries(DAMAGE_MODIFIER_TYPES).map(([value, label]) => ({ value, label, selected: value === selected }));
}

export function getDamageModifierSummary(value) {
  return normalizeDamageModifiers(value)
    .map(({ mode, damageType }) => `${DAMAGE_MODIFIER_MODES[mode]}: ${DAMAGE_MODIFIER_TYPES[damageType]}`)
    .join(", ");
}

function optionsHtml(options) {
  return options.map(({ value, label, selected }) => `<option value="${value}"${selected ? " selected" : ""}>${foundry.utils.escapeHTML(label)}</option>`).join("");
}

export function renderDamageModifierEditor() {
  return `<div class="pg-form-field pg-damage-modifiers" data-damage-modifier-editor>
    <label>Преобразование входящего урона</label>
    <input type="hidden" name="damageModifiersData" value="[]">
    <div class="pg-damage-modifier-add-row">
      <select data-damage-modifier-new-mode aria-label="Преобразование урона">${optionsHtml(getDamageModifierModeOptions())}</select>
      <select data-damage-modifier-new-type aria-label="Тип урона">${optionsHtml(getDamageModifierTypeOptions())}</select>
      <button type="button" data-damage-modifier-add>+</button>
    </div>
    <p class="pg-form-hint">Сопротивление — половина с округлением вниз, иммунитет — 0, уязвимость — двойной урон. Одинаковые преобразования не складываются.</p>
    <div class="pg-effect-modifier-list" data-damage-modifier-list></div>
  </div>`;
}

/** Shared editor for an effect template and the actor/item effect dialog. */
export function initializeDamageModifierEditor(root, initial = [], onChange = null) {
  const editor = root?.querySelector?.("[data-damage-modifier-editor]");
  if (!editor) return;
  const list = editor.querySelector("[data-damage-modifier-list]");
  const hidden = editor.querySelector("input[name='damageModifiersData']");
  const add = editor.querySelector("[data-damage-modifier-add]");
  const newMode = editor.querySelector("[data-damage-modifier-new-mode]");
  const newType = editor.querySelector("[data-damage-modifier-new-type]");
  if (!list || !add || !newMode || !newType) return;
  let modifiers = normalizeDamageModifiers(initial);
  const render = () => {
    if (hidden) hidden.value = JSON.stringify(modifiers);
    list.innerHTML = modifiers.length ? modifiers.map((modifier, index) => `<div class="pg-damage-modifier-row" data-damage-modifier-index="${index}">
      <select data-damage-modifier-mode aria-label="Преобразование урона">${optionsHtml(getDamageModifierModeOptions(modifier.mode))}</select>
      <select data-damage-modifier-type aria-label="Тип урона">${optionsHtml(getDamageModifierTypeOptions(modifier.damageType))}</select>
      <button type="button" data-damage-modifier-delete>Удалить</button>
    </div>`).join("") : '<div class="pg-effect-modifier-empty">Преобразования урона не добавлены</div>';
  };
  const save = async () => {
    render();
    try { await onChange?.(normalizeDamageModifiers(modifiers)); }
    catch (error) {
      console.error("ParovGrad | Failed to save damage modifiers", error);
      globalThis.ui?.notifications?.error(error.message || "Не удалось сохранить преобразование урона.");
    }
  };
  // These are pending choices, not document fields; auto-submit must wait for the add button.
  for (const control of [newMode, newType]) {
    control.addEventListener("change", (event) => event.stopPropagation());
  }
  add.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    modifiers = normalizeDamageModifiers([...modifiers, { mode: newMode.value, damageType: newType.value }]);
    await save();
  });
  list.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-damage-modifier-delete]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(button.closest("[data-damage-modifier-index]")?.dataset.damageModifierIndex);
    if (!Number.isInteger(index) || !modifiers[index]) return;
    modifiers = modifiers.filter((_modifier, entryIndex) => entryIndex !== index);
    await save();
  });
  list.addEventListener("change", async (event) => {
    const control = event.target;
    const field = control?.matches?.("[data-damage-modifier-mode]") ? "mode"
      : control?.matches?.("[data-damage-modifier-type]") ? "damageType" : null;
    if (!field) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(control.closest("[data-damage-modifier-index]")?.dataset.damageModifierIndex);
    if (!Number.isInteger(index) || !modifiers[index]) return;
    modifiers = normalizeDamageModifiers(modifiers.map((modifier, entryIndex) => entryIndex === index
      ? { ...modifier, [field]: control.value } : modifier));
    await save();
  });
  render();
}
