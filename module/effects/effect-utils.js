const EFFECT_FLAG_SCOPE = "ParovGrad";
const DEFAULT_EFFECT_ICON = "icons/svg/aura.svg";
const DEFAULT_CHANGES_TEXT = "[]";

export function getEffectFlagScope() {
  return EFFECT_FLAG_SCOPE;
}

export function getDefaultEffectIcon() {
  return DEFAULT_EFFECT_ICON;
}

export function getDefaultEffectChangesText() {
  return DEFAULT_CHANGES_TEXT;
}

export function getExampleEffectChangesText() {
  return JSON.stringify(
    [
      {
        key: "system.stats.constitution",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "1"
      }
    ],
    null,
    2
  );
}

export function parseEffectChanges(rawChanges) {
  const source = String(rawChanges ?? "").trim();
  if (!source) return [];

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Поле механических изменений должно содержать корректный JSON-массив.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Поле механических изменений должно содержать JSON-массив объектов изменений.");
  }

  return parsed.map((entry, index) => normalizeEffectChange(entry, index));
}

export function getActorEffectView(effect) {
  const flagData = getParovgradEffectFlagData(effect);
  const changes = Array.isArray(effect.changes) ? effect.changes : [];

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
    changesCount: changes.length,
    changesText: flagData.changesText,
    sourceLabel: flagData.sourceItemName || ""
  };
}

export function getParovgradEffectFlagData(effect) {
  const stored = effect?.flags?.[EFFECT_FLAG_SCOPE] ?? {};
  return {
    level: Number.isFinite(Number(stored.level)) ? Number(stored.level) : 1,
    effectType: String(stored.effectType ?? "").trim(),
    impact: String(stored.impact ?? "").trim(),
    removal: String(stored.removal ?? "").trim(),
    changesText: String(stored.changesText ?? DEFAULT_CHANGES_TEXT),
    sourceItemUuid: stored.sourceItemUuid ?? "",
    sourceItemName: stored.sourceItemName ?? ""
  };
}

export function getEffectItemTemplateData(item) {
  return {
    name: item.name || "Новый эффект",
    img: item.img || DEFAULT_EFFECT_ICON,
    description: String(item.system?.description ?? "").trim(),
    level: Number.isFinite(Number(item.system?.level)) ? Number(item.system.level) : 1,
    effectType: String(item.system?.effectType ?? "").trim(),
    impact: String(item.system?.impact ?? "").trim(),
    removal: String(item.system?.removal ?? "").trim(),
    changesText: String(item.system?.changes ?? DEFAULT_CHANGES_TEXT),
    sourceItemUuid: item.uuid,
    sourceItemName: item.name || ""
  };
}

export async function openActorEffectDialog({ actor, effect = null, seed = null } = {}) {
  const initial = seed ?? (effect ? getEffectDialogSeedFromActiveEffect(effect) : getBlankEffectDialogSeed());
  const escapedName = foundry.utils.escapeHTML(initial.name);
  const escapedImg = foundry.utils.escapeHTML(initial.img);
  const escapedEffectType = foundry.utils.escapeHTML(initial.effectType);
  const escapedDescription = foundry.utils.escapeHTML(initial.description);
  const escapedImpact = foundry.utils.escapeHTML(initial.impact);
  const escapedRemoval = foundry.utils.escapeHTML(initial.removal);
  const escapedChanges = foundry.utils.escapeHTML(initial.changesText);
  const escapedSource = foundry.utils.escapeHTML(initial.sourceItemName || "");

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: effect ? `Редактирование эффекта: ${effect.name}` : `Новый эффект: ${actor.name}` },
    modal: true,
    rejectClose: false,
    content: `
      <form class="pg-effect-dialog">
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
          <label for="pg-effect-changes">Механические изменения (JSON)</label>
          <textarea id="pg-effect-changes" name="changesText" rows="8" placeholder='${foundry.utils.escapeHTML(getExampleEffectChangesText())}'>${escapedChanges}</textarea>
          <p class="pg-form-hint">Укажи JSON-массив объектов вида {"key":"system.stats.constitution","mode":2,"value":"1"}. Режимы — CONST.ACTIVE_EFFECT_MODES.</p>
        </div>
      </form>
    `,
    buttons: [
      {
        action: "save",
        label: effect ? "Сохранить" : "Создать",
        callback: (event, button) => ({
          name: String(button.form?.elements?.name?.value ?? "").trim(),
          img: String(button.form?.elements?.img?.value ?? "").trim(),
          description: String(button.form?.elements?.description?.value ?? "").trim(),
          level: Number(button.form?.elements?.level?.value) || 0,
          effectType: String(button.form?.elements?.effectType?.value ?? "").trim(),
          impact: String(button.form?.elements?.impact?.value ?? "").trim(),
          removal: String(button.form?.elements?.removal?.value ?? "").trim(),
          changesText: String(button.form?.elements?.changesText?.value ?? DEFAULT_CHANGES_TEXT),
          sourceItemUuid: initial.sourceItemUuid || "",
          sourceItemName: initial.sourceItemName || ""
        })
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
  const data = effect.toObject();
  delete data._id;
  data.origin = effect.uuid;

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  ui.notifications?.info(`Эффект «${effect.name}» добавлен к ${actor.name}.`);
  return created[0] ?? null;
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
    changesText: flagData.changesText,
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
    changesText: DEFAULT_CHANGES_TEXT,
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
  const changesText = String(source.changesText ?? DEFAULT_CHANGES_TEXT).trim() || DEFAULT_CHANGES_TEXT;
  const changes = parseEffectChanges(changesText);

  const parovgradFlags = {
    level: Math.max(Number(source.level) || 0, 0),
    effectType: String(source.effectType ?? "").trim(),
    impact: String(source.impact ?? "").trim(),
    removal: String(source.removal ?? "").trim(),
    changesText,
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

async function resolveDroppedDocument(data) {
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

function normalizeEffectChange(change, index) {
  if (!change || typeof change !== "object") {
    throw new Error(`Изменение #${index + 1} должно быть объектом.`);
  }

  const key = String(change.key ?? "").trim();
  if (!key) {
    throw new Error(`В изменении #${index + 1} отсутствует поле key.`);
  }

  const mode = Number(change.mode);
  if (!Number.isFinite(mode)) {
    throw new Error(`В изменении #${index + 1} отсутствует числовое поле mode.`);
  }

  const value = change.value == null ? "" : String(change.value);
  const priority = Number(change.priority);

  return {
    key,
    mode,
    value,
    ...(Number.isFinite(priority) ? { priority } : {})
  };
}
