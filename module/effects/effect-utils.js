const EFFECT_FLAG_SCOPE = "ParovGrad";
const DEFAULT_EFFECT_ICON = "icons/svg/aura.svg";
const DEFAULT_EFFECT_TARGET = "constitution";

const EFFECT_MODIFIER_TARGETS = [
  { key: "constitution", label: "Телосложение", path: "system.stats.constitution" },
  { key: "awareness", label: "Внимание", path: "system.stats.awareness" },
  { key: "movement", label: "Движение", path: "system.stats.movement" },
  { key: "thinking", label: "Мышление", path: "system.stats.thinking" },
  { key: "will", label: "Воля", path: "system.stats.will" },
  { key: "healthMax", label: "Максимальное здоровье", path: "system.health.max" }
];

const CHANGE_KEY_TO_TARGET = Object.fromEntries(EFFECT_MODIFIER_TARGETS.map((target) => [target.path, target.key]));
const EMPTY_INFLUENCE_STATE = Object.freeze(Object.fromEntries(EFFECT_MODIFIER_TARGETS.map((target) => [target.key, 0])));

export function getEffectFlagScope() {
  return EFFECT_FLAG_SCOPE;
}

export function getDefaultEffectIcon() {
  return DEFAULT_EFFECT_ICON;
}

export function getEffectModifierOptions(selectedTarget = DEFAULT_EFFECT_TARGET) {
  return EFFECT_MODIFIER_TARGETS.map((target) => ({
    value: target.key,
    label: target.label,
    selected: target.key === selectedTarget
  }));
}

export function getEffectModifierLabel(targetKey) {
  return EFFECT_MODIFIER_TARGETS.find((target) => target.key === targetKey)?.label ?? targetKey;
}

export function getActorEffectView(effect) {
  const flagData = getParovgradEffectFlagData(effect);

  return {
    id: effect.id,
    uuid: effect.uuid,
    name: effect.name || "Безымянный эффект",
    img: effect.img || DEFAULT_EFFECT_ICON,
    disabled: Boolean(effect.disabled),
    description: String(effect.description || "").trim(),
    level: flagData.level,
    effectType: flagData.effectType,
    impact: flagData.impact,
    removal: flagData.removal,
    changesCount: flagData.modifiers.length,
    modifiers: flagData.modifiers,
    modifierSummary: getEffectModifierSummary(flagData.modifiers),
    sourceLabel: flagData.sourceItemName || ""
  };
}

export function getParovgradEffectFlagData(effect) {
  const stored = effect?.flags?.[EFFECT_FLAG_SCOPE] ?? {};
  const modifiers = getSupportedModifiers(
    Array.isArray(stored.modifiers) ? stored.modifiers : null,
    stored.changesText,
    effect?.changes
  );

  return {
    level: Number.isFinite(Number(stored.level)) ? Number(stored.level) : 1,
    effectType: String(stored.effectType ?? "").trim(),
    impact: String(stored.impact ?? "").trim(),
    removal: String(stored.removal ?? "").trim(),
    modifiers,
    sourceItemUuid: stored.sourceItemUuid ?? "",
    sourceItemName: stored.sourceItemName ?? ""
  };
}

export function getEffectItemTemplateData(item) {
  const modifiers = getSupportedModifiers(item.system?.modifiers, item.system?.changes, null);

  return {
    name: item.name || "Новый эффект",
    img: item.img || DEFAULT_EFFECT_ICON,
    description: String(item.system?.description ?? "").trim(),
    level: Number.isFinite(Number(item.system?.level)) ? Number(item.system.level) : 1,
    effectType: String(item.system?.effectType ?? "").trim(),
    impact: String(item.system?.impact ?? "").trim(),
    removal: String(item.system?.removal ?? "").trim(),
    modifiers,
    modifierSummary: getEffectModifierSummary(modifiers),
    sourceItemUuid: item.uuid,
    sourceItemName: item.name || ""
  };
}

export function buildActorInfluenceState(actor) {
  const entriesByTarget = Object.fromEntries(EFFECT_MODIFIER_TARGETS.map((target) => [target.key, []]));
  const totalsByTarget = { ...EMPTY_INFLUENCE_STATE };
  const tooltipsByTarget = Object.fromEntries(EFFECT_MODIFIER_TARGETS.map((target) => [target.key, "Нет внешних влияний"]));

  const effects = Array.from(actor?.effects ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled || effect.isSuppressed) continue;

    const flagData = getParovgradEffectFlagData(effect);
    if (!flagData.modifiers.length) continue;

    for (const modifier of flagData.modifiers) {
      if (!(modifier.target in entriesByTarget)) continue;

      const entry = {
        effectId: effect.id,
        effectName: effect.name || "Безымянный эффект",
        sourceItemName: flagData.sourceItemName || "",
        target: modifier.target,
        value: modifier.value,
        signedValue: formatSignedValue(modifier.value),
        summary: `${effect.name || "Безымянный эффект"}: ${formatSignedValue(modifier.value)}`
      };

      entriesByTarget[modifier.target].push(entry);
      totalsByTarget[modifier.target] += modifier.value;
    }
  }

  for (const target of EFFECT_MODIFIER_TARGETS) {
    const entries = entriesByTarget[target.key];
    if (!entries.length) continue;

    tooltipsByTarget[target.key] = entries.map((entry) => entry.summary).join("\n");
  }

  return { entriesByTarget, totalsByTarget, tooltipsByTarget };
}

export function getModifierTotalForTargetFromEffect(effect, target) {
  const flagData = getParovgradEffectFlagData(effect);
  return flagData.modifiers.reduce((total, modifier) => {
    if (modifier.target !== target) return total;
    return total + modifier.value;
  }, 0);
}

export async function openActorEffectDialog({ actor, effect = null, seed = null } = {}) {
  const initial = seed ?? (effect ? getEffectDialogSeedFromActiveEffect(effect) : getBlankEffectDialogSeed());
  const escapedName = foundry.utils.escapeHTML(initial.name);
  const escapedImg = foundry.utils.escapeHTML(initial.img);
  const escapedEffectType = foundry.utils.escapeHTML(initial.effectType);
  const escapedDescription = foundry.utils.escapeHTML(initial.description);
  const escapedImpact = foundry.utils.escapeHTML(initial.impact);
  const escapedRemoval = foundry.utils.escapeHTML(initial.removal);
  const escapedSource = foundry.utils.escapeHTML(initial.sourceItemName || "");
  const modifierOptionsHtml = renderModifierTargetOptionsHtml(DEFAULT_EFFECT_TARGET);

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: effect ? `Редактирование эффекта: ${effect.name}` : `Новый эффект: ${actor.name}` },
    modal: true,
    rejectClose: false,
    content: `
      <div class="pg-effect-dialog">
        ${escapedSource ? `<p class="pg-effect-dialog__source">Шаблон: <strong>${escapedSource}</strong></p>` : ""}

        <div class="pg-form-field">
          <label for="pg-effect-name">Название</label>
          <input id="pg-effect-name" type="text" name="name" value="${escapedName}" autofocus>
        </div>

        <div class="pg-form-grid pg-form-grid--two-columns">
          <div class="pg-form-field">
            <label for="pg-effect-level">Уровень</label>
            <input id="pg-effect-level" type="number" name="level" min="0" step="1" value="${initial.level}">
          </div>

          <div class="pg-form-field">
            <label for="pg-effect-type">Тип</label>
            <input id="pg-effect-type" type="text" name="effectType" value="${escapedEffectType}">
          </div>
        </div>

        <div class="pg-form-field">
          <label for="pg-effect-img">Иконка</label>
          <input id="pg-effect-img" type="text" name="img" value="${escapedImg}" placeholder="${DEFAULT_EFFECT_ICON}">
        </div>

        <div class="pg-form-field">
          <label for="pg-effect-impact">Воздействие эффекта</label>
          <textarea id="pg-effect-impact" name="impact" rows="3">${escapedImpact}</textarea>
        </div>

        <div class="pg-form-field">
          <label for="pg-effect-removal">Снятие эффекта</label>
          <textarea id="pg-effect-removal" name="removal" rows="3">${escapedRemoval}</textarea>
        </div>

        <div class="pg-form-field">
          <label for="pg-effect-description">Описание</label>
          <textarea id="pg-effect-description" name="description" rows="3">${escapedDescription}</textarea>
        </div>

        <div class="pg-form-field">
          <label>Влияния эффекта</label>
          <input type="hidden" name="modifiersData" value="[]">
          <div class="pg-effect-modifier-add-row">
            <select name="newModifierTarget" class="pg-effect-modifier-target">
              ${modifierOptionsHtml}
            </select>
            <input type="number" name="newModifierValue" class="pg-effect-modifier-value-input" step="1" value="0">
            <button type="button" class="pg-effect-modifier-add" data-action="add-modifier">+</button>
          </div>
          <p class="pg-form-hint">Положительное число усиливает показатель, отрицательное — уменьшает.</p>
          <div class="pg-effect-modifier-list" data-effect-modifier-list></div>
        </div>
      </div>
    `,
    render: (_event, dialog) => {
      initializeEffectModifierEditor(dialog, initial.modifiers);
    },
    buttons: [
      {
        action: "save",
        label: effect ? "Сохранить" : "Создать",
        callback: (_event, button, _dialog) => {
          const form = button?.form;
          if (!(form instanceof HTMLFormElement)) return null;

          return {
            name: readDialogControlValue(form, "name").trim(),
            img: readDialogControlValue(form, "img").trim(),
            description: readDialogControlValue(form, "description").trim(),
            level: Number(readDialogControlValue(form, "level")) || 0,
            effectType: readDialogControlValue(form, "effectType").trim(),
            impact: readDialogControlValue(form, "impact").trim(),
            removal: readDialogControlValue(form, "removal").trim(),
            modifiers: parseModifiersFieldValue(readDialogControlValue(form, "modifiersData", "[]")),
            sourceItemUuid: initial.sourceItemUuid || "",
            sourceItemName: initial.sourceItemName || ""
          };
        }
      },
      {
        action: "cancel",
        label: "Отмена"
      }
    ]
  });

  if (!result?.name) return null;

  let update;
  try {
    update = buildActiveEffectUpdateData(result, effect);
  } catch (error) {
    ui.notifications?.error(error.message || "Не удалось сохранить эффект.");
    console.error("ParovGrad | Failed to build active effect update", error);
    return null;
  }

  if (effect) {
    await effect.update(update);
    return effect;
  }

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [update]);
  return created[0] ?? null;
}

export async function applyEffectItemToActor(actor, item) {
  let data;
  try {
    data = buildActiveEffectDataFromItem(item);
  } catch (error) {
    ui.notifications?.error(error.message || `Не удалось применить эффект «${item.name}».`);
    console.error("ParovGrad | Failed to apply effect item to actor", error);
    return null;
  }

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  ui.notifications?.info(`Эффект «${item.name}» применён к ${actor.name}.`);
  return created[0] ?? null;
}

export async function cloneActiveEffectToActor(actor, effect) {
  const seed = getEffectDialogSeedFromActiveEffect(effect);
  const data = buildActiveEffectCreateData(seed, {
    origin: effect.uuid,
    disabled: Boolean(effect.disabled),
    baseFlags: effect.flags ?? {}
  });

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  ui.notifications?.info(`Эффект «${effect.name}» добавлен к ${actor.name}.`);
  return created[0] ?? null;
}

export async function migrateLegacyActorEffects(actor) {
  const legacyEffects = Array.from(actor?.effects ?? []).filter((effect) => {
    const hasLegacyChanges = Array.isArray(effect.changes) && effect.changes.length > 0;
    const storedModifiers = effect?.flags?.[EFFECT_FLAG_SCOPE]?.modifiers;
    return hasLegacyChanges && !Array.isArray(storedModifiers);
  });

  for (const effect of legacyEffects) {
    const seed = getEffectDialogSeedFromActiveEffect(effect);
    const update = buildActiveEffectCreateData(seed, {
      origin: effect.origin || seed.sourceItemUuid || "",
      disabled: Boolean(effect.disabled),
      baseFlags: effect.flags ?? {}
    });

    await effect.update({
      changes: [],
      flags: update.flags
    });
  }

  return legacyEffects.length;
}

export async function resolveEffectSourceFromDropData(data) {
  if (!data) return null;

  const document = await resolveDroppedDocument(data);
  if (!document) return null;

  if (document.documentName === "Item" && document.type === "effect") {
    return { kind: "item", document };
  }

  if (document.documentName === "ActiveEffect") {
    return { kind: "activeEffect", document };
  }

  return null;
}

export async function handleCanvasEffectDrop(canvas, data) {
  const source = await resolveEffectSourceFromDropData(data);
  if (!source) return false;

  const token = findTokenAtCanvasPoint(canvas, data?.x, data?.y);
  if (!token?.actor) {
    ui.notifications?.warn("Не удалось определить токен для применения эффекта.");
    return true;
  }

  if (source.kind === "item") {
    await applyEffectItemToActor(token.actor, source.document);
    return true;
  }

  await cloneActiveEffectToActor(token.actor, source.document);
  return true;
}

function buildActiveEffectDataFromItem(item) {
  const template = getEffectItemTemplateData(item);
  return buildActiveEffectCreateData(template, {
    origin: item.uuid,
    disabled: false
  });
}

function getEffectDialogSeedFromActiveEffect(effect) {
  const flagData = getParovgradEffectFlagData(effect);
  return {
    name: effect.name || "Новый эффект",
    img: effect.img || DEFAULT_EFFECT_ICON,
    description: String(effect.description || "").trim(),
    level: flagData.level,
    effectType: flagData.effectType,
    impact: flagData.impact,
    removal: flagData.removal,
    modifiers: flagData.modifiers,
    sourceItemUuid: flagData.sourceItemUuid,
    sourceItemName: flagData.sourceItemName
  };
}

function getBlankEffectDialogSeed() {
  return {
    name: "Новый эффект",
    img: DEFAULT_EFFECT_ICON,
    description: "",
    level: 1,
    effectType: "",
    impact: "",
    removal: "",
    modifiers: [],
    sourceItemUuid: "",
    sourceItemName: ""
  };
}

function buildActiveEffectUpdateData(formData, existingEffect) {
  return buildActiveEffectCreateData(formData, {
    origin: existingEffect?.origin || formData.sourceItemUuid || "",
    disabled: existingEffect?.disabled ?? false,
    baseFlags: existingEffect?.flags ?? {}
  });
}

function buildActiveEffectCreateData(source, { origin = "", disabled = false, baseFlags = {} } = {}) {
  const modifiers = getSupportedModifiers(source.modifiers, source.changesText, source.changes);
  const changes = buildEffectChangesFromModifiers(modifiers);

  const parovgradFlags = {
    level: Math.max(Number(source.level) || 0, 0),
    effectType: String(source.effectType ?? "").trim(),
    impact: String(source.impact ?? "").trim(),
    removal: String(source.removal ?? "").trim(),
    modifiers,
    sourceItemUuid: String(source.sourceItemUuid ?? "").trim(),
    sourceItemName: String(source.sourceItemName ?? "").trim()
  };

  return {
    name: String(source.name ?? "").trim() || "Новый эффект",
    img: String(source.img ?? "").trim() || DEFAULT_EFFECT_ICON,
    description: String(source.description ?? "").trim(),
    origin,
    disabled: Boolean(disabled),
    transfer: false,
    changes,
    flags: foundry.utils.mergeObject(baseFlags, {
      [EFFECT_FLAG_SCOPE]: parovgradFlags
    }, { inplace: false })
  };
}

function buildEffectChangesFromModifiers(modifiers) {
  // Влияния ParovGrad больше не применяются напрямую через ActiveEffect.changes.
  // Вместо этого они хранятся в flags и вычисляются системой как внешние влияния.
  return [];
}

function getSupportedModifiers(modifiers, legacyChangesText = null, legacyChanges = null) {
  if (Array.isArray(modifiers) && modifiers.length) {
    return modifiers.map((modifier, index) => normalizeEffectModifier(modifier, index));
  }

  const legacy = parseLegacySupportedModifiers(legacyChangesText, legacyChanges);
  return legacy;
}

function parseLegacySupportedModifiers(legacyChangesText = null, legacyChanges = null) {
  if (Array.isArray(legacyChanges) && legacyChanges.length) {
    return extractSupportedModifiersFromChanges(legacyChanges);
  }

  const source = String(legacyChangesText ?? "").trim();
  if (!source) return [];

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (_error) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return extractSupportedModifiersFromChanges(parsed);
}

function extractSupportedModifiersFromChanges(changes) {
  return changes.reduce((result, change) => {
    const key = String(change?.key ?? "").trim();
    const target = CHANGE_KEY_TO_TARGET[key];
    if (!target) return result;

    const mode = Number(change?.mode);
    if (mode !== CONST.ACTIVE_EFFECT_MODES.ADD) return result;

    const value = Number(change?.value);
    if (!Number.isFinite(value)) return result;

    result.push({ target, value });
    return result;
  }, []);
}

function normalizeEffectModifier(modifier, index) {
  if (!modifier || typeof modifier !== "object") {
    throw new Error(`Влияние #${index + 1} должно быть объектом.`);
  }

  const target = String(modifier.target ?? "").trim();
  if (!EFFECT_MODIFIER_TARGETS.some((definition) => definition.key === target)) {
    throw new Error(`Влияние #${index + 1} содержит неизвестный показатель.`);
  }

  const value = Number(modifier.value);
  if (!Number.isFinite(value)) {
    throw new Error(`Влияние #${index + 1} должно содержать числовое значение.`);
  }

  return {
    target,
    value: Math.trunc(value)
  };
}

function getEffectModifierSummary(modifiers) {
  if (!Array.isArray(modifiers) || !modifiers.length) return "";

  return modifiers
    .map((modifier) => `${getEffectModifierLabel(modifier.target)} ${formatSignedValue(modifier.value)}`)
    .join(", ");
}

function renderModifierTargetOptionsHtml(selectedTarget = DEFAULT_EFFECT_TARGET) {
  return getEffectModifierOptions(selectedTarget)
    .map((option) => `<option value="${foundry.utils.escapeHTML(option.value)}" ${option.selected ? "selected" : ""}>${foundry.utils.escapeHTML(option.label)}</option>`)
    .join("");
}

function initializeEffectModifierEditor(dialog, initialModifiers = []) {
  const root = dialog.element ?? dialog.window?.content;
  if (!(root instanceof HTMLElement)) return;

  const form = dialog.form instanceof HTMLFormElement
    ? dialog.form
    : root.querySelector("form");
  if (!(form instanceof HTMLFormElement)) return;

  const hiddenInput = form.querySelector("input[name='modifiersData']");
  const listElement = form.querySelector("[data-effect-modifier-list]");
  const addButton = form.querySelector("[data-action='add-modifier']");
  const targetSelect = form.querySelector("select[name='newModifierTarget']");
  const valueInput = form.querySelector("input[name='newModifierValue']");

  if (!(hiddenInput instanceof HTMLInputElement)
    || !(listElement instanceof HTMLElement)
    || !(addButton instanceof HTMLButtonElement)
    || !(targetSelect instanceof HTMLSelectElement)
    || !(valueInput instanceof HTMLInputElement)) {
    return;
  }

  let modifiers = getSupportedModifiers(initialModifiers);

  const render = () => {
    hiddenInput.value = JSON.stringify(modifiers);

    if (!modifiers.length) {
      listElement.innerHTML = '<div class="pg-effect-modifier-empty">Влияния не добавлены</div>';
      return;
    }

    listElement.innerHTML = modifiers.map((modifier, index) => `
      <div class="pg-effect-modifier-row" data-modifier-index="${index}">
        <div class="pg-effect-modifier-row__label">${foundry.utils.escapeHTML(getEffectModifierLabel(modifier.target))}</div>
        <input type="number" class="pg-effect-modifier-row__value" data-modifier-index="${index}" step="1" value="${modifier.value}">
        <button type="button" class="pg-effect-modifier-delete" data-modifier-index="${index}">Удалить</button>
      </div>
    `).join("");
  };

  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    modifiers = [
      ...modifiers,
      normalizeEffectModifier({ target: targetSelect.value, value: Number(valueInput.value) || 0 }, modifiers.length)
    ];
    valueInput.value = "0";
    render();
  });

  listElement.addEventListener("click", (event) => {
    const deleteButton = event.target instanceof HTMLElement ? event.target.closest(".pg-effect-modifier-delete") : null;
    if (!(deleteButton instanceof HTMLButtonElement)) return;

    event.preventDefault();
    const index = Number(deleteButton.dataset.modifierIndex);
    if (!Number.isInteger(index) || index < 0 || index >= modifiers.length) return;

    modifiers = modifiers.filter((_modifier, modifierIndex) => modifierIndex !== index);
    render();
  });

  listElement.addEventListener("change", (event) => {
    const valueField = event.target instanceof HTMLElement ? event.target.closest(".pg-effect-modifier-row__value") : null;
    if (!(valueField instanceof HTMLInputElement)) return;

    const index = Number(valueField.dataset.modifierIndex);
    if (!Number.isInteger(index) || index < 0 || index >= modifiers.length) return;

    modifiers[index] = normalizeEffectModifier({
      target: modifiers[index].target,
      value: Number(valueField.value) || 0
    }, index);

    render();
  });

  render();
}

function readDialogControlValue(form, fieldName, fallback = "") {
  if (!(form instanceof HTMLFormElement)) return fallback;

  const control = form.elements?.namedItem?.(fieldName);
  if (!control) return fallback;

  if (control instanceof RadioNodeList) {
    return String(control.value ?? fallback);
  }

  if ("value" in control) {
    return String(control.value ?? fallback);
  }

  return fallback;
}

function parseModifiersFieldValue(rawValue) {
  const source = String(rawValue ?? "[]").trim() || "[]";

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Не удалось прочитать список влияний эффекта.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Список влияний эффекта имеет неверный формат.");
  }

  return parsed.map((modifier, index) => normalizeEffectModifier(modifier, index));
}

function resolveDroppedDocument(data) {
  if (data.uuid) {
    return fromUuid(data.uuid);
  }

  if (data.type === "Item" && data.data) {
    return new Item(data.data, { parent: null, strict: false });
  }

  if (data.type === "ActiveEffect" && data.data) {
    return new ActiveEffect(data.data, { parent: null, strict: false });
  }

  return null;
}

function findTokenAtCanvasPoint(canvas, x, y) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;

  const candidates = Array.from(canvas.tokens?.placeables ?? []).reverse();
  return candidates.find((token) => token.bounds?.contains(Number(x), Number(y))) ?? null;
}

function formatSignedValue(value) {
  if (!Number.isFinite(Number(value))) return "0";
  const numericValue = Math.trunc(Number(value));
  return numericValue >= 0 ? `+${numericValue}` : String(numericValue);
}
