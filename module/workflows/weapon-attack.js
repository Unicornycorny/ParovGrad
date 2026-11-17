import {getItemDamageParts, rollDamageParts, serializeDamageResults, damageResultsHtml, applyTypedDamage, getAppliedDamage} from "../damage/damage-types.js";
import { getActiveItemEffectData, applyItemEffectDataToActor } from "../effects/effect-utils.js";
import {
  consumeActorInspiration,
  openConfiguredD20RollDialog,
  openConfiguredDamageRollDialog
} from "../dice/roll-dialog.js";

function getSingleTargetToken(warning = "Для атаки выберите ровно одну цель.") {
  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications?.warn(warning);
    return null;
  }

  const target = targets[0];
  return target?.document ? target : canvas.tokens?.get(target.id) ?? null;
}

function getTokenDocument(tokenLike) {
  if (!tokenLike) return null;
  if (tokenLike.document) return tokenLike.document;
  return tokenLike;
}

function getActorFromTokenUuid(tokenUuid) {
  if (!tokenUuid) return null;
  const tokenDocument = fromUuidSync(tokenUuid);
  return tokenDocument?.actor ?? null;
}

function getTokenFromUuid(tokenUuid) {
  if (!tokenUuid) return null;
  const tokenDocument = fromUuidSync(tokenUuid);
  return tokenDocument?.object ?? tokenDocument ?? null;
}

function getRollModeLabel(mode) {
  return {
    normal: "Обычный",
    advantage: "Преимущество",
    disadvantage: "Помеха"
  }[mode] ?? "Обычный";
}

function getD20Formula(mode) {
  switch (mode) {
    case "advantage":
      return "2d20kh";
    case "disadvantage":
      return "2d20kl";
    default:
      return "1d20";
  }
}

function buildFormula(baseFormula, modifier = 0) {
  const normalizedModifier = Number(modifier) || 0;
  if (!normalizedModifier) return baseFormula;
  return `${baseFormula} ${normalizedModifier >= 0 ? "+" : "-"} ${Math.abs(normalizedModifier)}`;
}

function getEffectDieFaces(die) {
  const match = String(die ?? "").trim().toLowerCase().match(/^d(2|4|6|8|12|20|100)$/);
  return match ? Number(match[1]) : null;
}

function normalizeEffectRanges(effectRanges, dieFaces = null) {
  if (!Array.isArray(effectRanges)) return [];

  return effectRanges.map((entry) => {
    let from = Math.trunc(Number(entry?.from) || 1);
    let to = Math.trunc(Number(entry?.to) || from);

    from = Math.max(from, 1);
    to = Math.max(to, 1);

    if (dieFaces) {
      from = Math.min(from, dieFaces);
      to = Math.min(to, dieFaces);
    }

    if (from > to) [from, to] = [to, from];

    return {
      from,
      to,
      effect: String(entry?.effect ?? "").trim()
    };
  });
}

function hasConfiguredEffect(item) {
  const effectDieFaces = getEffectDieFaces(item?.system?.effectCheckDie);
  if (!effectDieFaces) return false;
  return normalizeEffectRanges(item?.system?.effectRanges, effectDieFaces).length > 0;
}

function findTriggeredWeaponEffects(effectRanges, rolledValue) {
  return effectRanges.filter((entry) => rolledValue >= entry.from && rolledValue <= entry.to);
}

async function createAttackEffectResultMessage({
  actor,
  itemName,
  targetName = "",
  effectCheckDie,
  effectRoll,
  source,
  triggeredEffects = []
}) {
  const speaker = ChatMessage.getSpeaker({ actor });
  const hasTriggeredEffects = triggeredEffects.length > 0;
  const effectListHtml = hasTriggeredEffects
    ? `
      <div class="pg-chat-card__comparison">
        ${triggeredEffects.map((entry) => `
          <div><strong>${entry.from}–${entry.to}</strong>: ${entry.effect || "—"}</div>
        `).join("")}
      </div>
    `
    : "";

  await createRollCardMessage({
    roll: effectRoll,
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">${source.effectTitle}</div>
        <div class="pg-chat-card__subtitle">${itemName} проверяет дополнительный эффект${targetName ? ` по цели ${targetName}` : ""}</div>
      </div>
      <div class="pg-chat-card__meta">Куб эффекта: ${String(effectCheckDie).toUpperCase()}</div>
      <div class="pg-chat-card__result ${hasTriggeredEffects ? "is-success" : "is-failure"}">
        ${hasTriggeredEffects ? "Дополнительный эффект сработал" : "Дополнительный эффект не сработал"}
      </div>
      ${effectListHtml}
    `,
    flags: {
      cardType: "weapon-effect",
      weaponEffect: {
        itemName,
        targetName: targetName || null,
        sourceType: source.type,
        effectCheckDie,
        total: effectRoll.total,
        triggeredEffects
      }
    }
  });
}

async function createRollCardMessage({ roll, additionalRolls = [], speaker, content, flags = {} }) {
  const rollHtml = (await Promise.all([roll, ...additionalRolls].map(entry => entry.render()))).join("");
  return ChatMessage.create({
    user: game.user.id,
    speaker,
    content: `
      <div class="pg-chat-card">
        ${content}
        <div class="pg-chat-card__roll">${rollHtml}</div>
      </div>
    `,
    rolls: [roll, ...additionalRolls].map(entry => JSON.stringify(entry.toJSON())),
    style: CONST.CHAT_MESSAGE_STYLES.ROLL,
    flags: {
      ParovGrad: flags
    }
  });
}

async function createInfoCardMessage({ speaker, content, flags = {} }) {
  return ChatMessage.create({
    user: game.user.id,
    speaker,
    content: `
      <div class="pg-chat-card">
        ${content}
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      ParovGrad: flags
    }
  });
}

function canControlDefense(message) {
  const data = message.getFlag("ParovGrad", "attack") ?? {};
  const targetActor = getActorFromTokenUuid(data.targetTokenUuid);
  if (!targetActor) return false;
  return game.user.isGM || targetActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function canApplyDamage(message) {
  const data = message.getFlag("ParovGrad", "damage") ?? {};
  const targetActor = getActorFromTokenUuid(data.targetTokenUuid);
  if (!targetActor) return false;
  return game.user.isGM || targetActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function canRollWeaponEffect(message) {
  const data = message.getFlag("ParovGrad", "attack") ?? {};
  const attackerActor = data.attackerActorUuid ? fromUuidSync(data.attackerActorUuid) : null;
  if (!attackerActor) return false;
  return game.user.isGM || attackerActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function canRollItemEffect(message) {
  const data = message.getFlag("ParovGrad", "itemUse") ?? {};
  const ownerActor = data.actorUuid ? fromUuidSync(data.actorUuid) : null;
  if (!ownerActor) return false;
  return game.user.isGM || ownerActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

const activeEffectApplications = new Set();
const defenseResolutions = new Set();
const attackDamageRolls = new Set();
const damageApplications = new Set();

function getChatMessages() {
  return Array.from(game.messages?.contents ?? []);
}

function getAttackContext(message) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  if (cardType !== "attack" && cardType !== "defense-result") return null;
  const defense = cardType === "defense-result" ? message.getFlag("ParovGrad", "defense") ?? {} : null;
  const original = defense
    ? game.messages?.get?.(defense.attackMessageId) ?? (defense.attackMessageUuid ? fromUuidSync(defense.attackMessageUuid) : null)
    : message;
  const stored = original?.getFlag("ParovGrad", "attack") ?? defense?.attack;
  if (!stored?.targetTokenUuid) return null;
  const result = defense ? message : getChatMessages().find((entry) => {
    if (entry.getFlag("ParovGrad", "cardType") !== "defense-result") return false;
    const candidate = entry.getFlag("ParovGrad", "defense") ?? {};
    return candidate.attackMessageId === message.id && candidate.targetTokenUuid === stored.targetTokenUuid;
  });
  const resolution = result?.getFlag("ParovGrad", "defense");
  const data = resolution
    ? {
      ...stored, ...resolution.attack, resolved: true, success: resolution.success === true,
      damageRolled: Boolean(stored.damageRolled || resolution.attack?.damageRolled),
      activeEffectsApplied: Boolean(stored.activeEffectsApplied || resolution.attack?.activeEffectsApplied)
    }
    : stored;
  const applicationId = original?.uuid || defense?.attackMessageUuid || message.uuid;
  return { data, original, result, applicationId, attackMessageId: original?.id || defense?.attackMessageId };
}

function getAttackDamageParts(data) {
  if (Array.isArray(data.damageParts)) return data.damageParts;
  const source = data.itemUuid ? fromUuidSync(data.itemUuid) : null;
  return source ? getItemDamageParts(source) : [];
}

function getAttackDamageMessage(context) {
  return getChatMessages().find((entry) => {
    if (entry.getFlag("ParovGrad", "cardType") !== "damage") return false;
    const damage = entry.getFlag("ParovGrad", "damage") ?? {};
    return damage.attackMessageUuid === context.applicationId
      || (context.attackMessageId && damage.sourceAttackMessageId === context.attackMessageId);
  });
}

function canRollAttackDamage(context) {
  const actor = context?.data.attackerActorUuid ? fromUuidSync(context.data.attackerActorUuid) : null;
  return Boolean(actor && (game.user.isGM || actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)));
}

async function saveChatFlagIfAllowed(message, path, value) {
  if (!message?.canUserModify?.(game.user, "update")) return;
  try {
    await message.setFlag("ParovGrad", path, value);
  } catch (error) {
    console.warn("ParovGrad | Action completed but chat status could not be updated", error);
  }
}

function renderAttackDamageAction(message, html) {
  const button = html.querySelector('[data-action="roll-attack-damage"]');
  if (!button) return;
  const context = getAttackContext(message);
  if (!context) return;
  const ready = context.data.resolved && context.data.success === true;
  const rolled = Boolean(context.data.damageRolled || getAttackDamageMessage(context));
  button.hidden = !ready || !getAttackDamageParts(context.data).length;
  button.disabled = !ready || rolled || !canRollAttackDamage(context);
  button.textContent = rolled ? "Урон уже брошен" : "Нанести урон";
  if (!canRollAttackDamage(context)) button.title = "Кнопка доступна ведущему или владельцу атакующего.";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await handleAttackDamageButtonClick(message);
    } finally {
      const updated = getAttackContext(message);
      const done = updated && (updated.data.damageRolled || getAttackDamageMessage(updated));
      button.disabled = !updated?.data.success || Boolean(done) || !canRollAttackDamage(updated);
      button.textContent = done ? "Урон уже брошен" : "Нанести урон";
    }
  });
}

/** Refresh related cards locally; this never changes another user's messages. */
export function refreshAttackChatCards(message) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  const attackId = cardType === "defense-result"
    ? message.getFlag("ParovGrad", "defense")?.attackMessageId
    : cardType === "damage" ? message.getFlag("ParovGrad", "damage")?.sourceAttackMessageId : null;
  if (!attackId) return;
  for (const related of getChatMessages()) {
    if (related.id === message.id) continue;
    const isRelated = related.id === attackId
      || (related.getFlag("ParovGrad", "cardType") === "defense-result"
        && related.getFlag("ParovGrad", "defense")?.attackMessageId === attackId);
    if (isRelated) ui.chat?.updateMessage(related);
  }
}

function getItemEffectAction(message) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  const namespace = cardType === "item-use" ? "itemUse" : cardType === "attack" ? "attack" : cardType === "defense-result" ? "defense.attack" : null;
  if (!namespace) return null;
  const context = cardType === "item-use" ? null : getAttackContext(message);
  const storedData = context?.data ?? message.getFlag("ParovGrad", namespace) ?? {};
  const effects = Array.isArray(storedData.activeEffects) ? storedData.activeEffects : [];
  const targetActor = getActorFromTokenUuid(storedData.targetTokenUuid);
  const applicationId = String(context?.applicationId ?? message.uuid ?? message.id ?? "");
  const appliedIndices = new Set(Array.from(targetActor?.effects ?? [])
    .filter(effect => applicationId && effect.flags?.ParovGrad?.applicationId === applicationId)
    .map(effect => effect.flags.ParovGrad.applicationIndex));
  const appliedToTarget = effects.length > 0 && effects.every((_effect, index) => appliedIndices.has(index));
  const data = { ...storedData, activeEffectsApplied: storedData.activeEffectsApplied || appliedToTarget };
  const allowed = Boolean(targetActor && (game.user.isGM
    || targetActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)));
  const ready = namespace === "itemUse" || (data.resolved && data.success === true);
  return { namespace, data, effects, targetActor, allowed, ready, applicationId };
}

function renderItemEffectAction(message, html) {
  const button = html.querySelector('[data-action="apply-item-effects"]');
  if (!button) return;
  const action = getItemEffectAction(message);
  if (!action) return;
  button.hidden = !action.effects.length || !action.ready;
  button.disabled = !action.allowed || !action.ready || Boolean(action.data.activeEffectsApplied);
  button.textContent = action.data.activeEffectsApplied ? "Активные эффекты применены" : "Применить активные эффекты";
  if (!action.allowed) button.title = "Кнопка доступна только GM или владельцу цели.";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.disabled = true;
    await handleApplyItemEffectsButtonClick(message);
    const updated = getItemEffectAction(message);
    button.disabled = !updated?.allowed || !updated?.ready || Boolean(updated?.data.activeEffectsApplied);
    if (updated?.data.activeEffectsApplied) button.textContent = "Активные эффекты применены";
  });
}

export async function handleApplyItemEffectsButtonClick(message) {
  const action = getItemEffectAction(message);
  const key = action?.applicationId || message.uuid || message.id || message;
  if (activeEffectApplications.has(key)) return;
  if (!action?.effects.length || action.data.activeEffectsApplied) return;
  if (!action.ready) {
    ui.notifications?.warn("Активные эффекты оружия применяются только после успешной атаки.");
    return;
  }
  if (!action.targetActor) {
    ui.notifications?.warn("Не удалось найти цель применения предмета.");
    return;
  }
  if (!action.allowed) {
    ui.notifications?.warn("Применить активные эффекты может только GM или владелец цели.");
    return;
  }

  activeEffectApplications.add(key);
  try {
    await applyItemEffectDataToActor(action.targetActor, foundry.utils.deepClone(action.effects), {
      applicationId: action.applicationId
    });
    // A target owner can apply effects without owning the source's chat message.
    // The created effects retain the application ID, so status also survives a denied chat update.
    await saveChatFlagIfAllowed(message, `${action.namespace}.activeEffectsApplied`, true);
    ui.notifications?.info(`Активные эффекты предмета «${action.data.itemName}» применены к ${action.targetActor.name}.`);
  } catch (error) {
    console.error("ParovGrad | Failed to apply item effects", error);
    ui.notifications?.error(error.message || "Не удалось применить активные эффекты предмета.");
  } finally {
    activeEffectApplications.delete(key);
  }
}

function getButtonStateText({ disabled, doneLabel, activeLabel }) {
  if (disabled) return doneLabel ?? activeLabel;
  return activeLabel;
}

function getAttackSourceConfig(itemType) {
  if (itemType === "skill") {
    return {
      type: "skill",
      instrumental: "навыком",
      genitive: "навыка",
      attackTitle: "Атака навыком",
      damageTitle: "Урон навыка",
      effectTitle: "Дополнительный эффект навыка"
    };
  }

  if (itemType === "item") {
    return {
      type: "item",
      instrumental: "предметом",
      genitive: "предмета",
      attackTitle: "Атака предметом",
      damageTitle: "Урон предмета",
      effectTitle: "Дополнительный эффект предмета"
    };
  }

  return {
    type: "weapon",
    instrumental: "оружием",
    genitive: "оружия",
    attackTitle: "Атака оружием",
    damageTitle: "Урон оружия",
    effectTitle: "Дополнительный эффект оружия"
  };
}

export async function startWeaponAttack({ actor, item, sourceToken = null }) {
  return startItemAttack({ actor, item, sourceToken, sourceType: "weapon" });
}

export async function startSkillAttack({ actor, item, sourceToken = null }) {
  return startItemAttack({ actor, item, sourceToken, sourceType: "skill" });
}

export async function startItemUse({ actor, item, sourceToken = null }) {
  const hasSourceEffect = hasConfiguredEffect(item);
  const activeEffects = foundry.utils.deepClone(getActiveItemEffectData(item));
  let targetDocument = null;
  if (activeEffects.length) {
    const targetToken = getSingleTargetToken("Для применения активных эффектов предмета выберите ровно одну цель.");
    if (!targetToken) return;
    targetDocument = getTokenDocument(targetToken);
    if (!targetDocument?.actor) {
      ui.notifications?.warn("У выбранной цели нет актора.");
      return;
    }
  }
  const description = String(item?.system?.description ?? "").trim();
  const speaker = ChatMessage.getSpeaker({ actor });
  const animation = game.parovgrad?.animations?.createContext?.({ actor, item, sourceToken }) ?? null;

  const message = await createInfoCardMessage({
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">Использование предмета</div>
        <div class="pg-chat-card__subtitle">${actor.name} использует «${item.name}»${targetDocument ? ` на цель ${targetDocument.name}` : ""}</div>
      </div>
      <div class="pg-chat-card__meta">Описание: ${description || "—"}</div>
      ${activeEffects.length ? `
        <div class="pg-chat-card__actions">
          <button type="button" class="pg-chat-button" data-action="apply-item-effects">Применить активные эффекты</button>
        </div>
      ` : ""}
      ${hasSourceEffect
        ? `
          <div class="pg-chat-card__actions">
            <button type="button" class="pg-chat-button" data-action="roll-item-effect">Проверить доп. эффект</button>
          </div>
        `
        : ""}
    `,
    flags: {
      cardType: "item-use",
      itemUse: {
        actorUuid: actor.uuid,
        itemUuid: item.uuid,
        animation,
        itemName: item.name,
        sourceType: "item",
        description,
        hasSourceEffect,
        effectRolled: false,
        targetTokenUuid: targetDocument?.uuid ?? null,
        targetName: targetDocument?.name ?? "",
        activeEffects,
        activeEffectsApplied: false
      }
    }
  });
  await game.parovgrad?.animations?.play?.({
    context: animation,
    phase: "use",
    targetTokenUuids: targetDocument?.uuid ? [targetDocument.uuid] : []
  });
  if (activeEffects.length && getItemEffectAction(message)?.allowed) {
    await handleApplyItemEffectsButtonClick(message);
  }
  return message;
}

export async function startItemAttack({ actor, item, sourceToken = null, sourceType = null }) {
  if (item?.type === "skill") {
    const { hasSpellTemplate } = await import("../canvas/spell-template.js");
    if (hasSpellTemplate(item)) {
      const { startMassSkillAttack } = await import("./skill-area-attack.js");
      return startMassSkillAttack({ actor, item, sourceToken });
    }
  }
  if ((sourceType ?? item?.type) === "item") {
    return startItemUse({ actor, item, sourceToken });
  }

  const source = getAttackSourceConfig(sourceType ?? item?.type);
  const hasSourceEffect = hasConfiguredEffect(item);
  const activeEffects = foundry.utils.deepClone(getActiveItemEffectData(item));
  const damageParts = foundry.utils.deepClone(getItemDamageParts(item));
  const targetToken = getSingleTargetToken();
  if (!targetToken) return;

  const targetDocument = getTokenDocument(targetToken);
  const targetActor = targetDocument?.actor ?? null;
  if (!targetActor) {
    ui.notifications?.warn("У выбранной цели нет актора.");
    return;
  }

  const attackConfig = await openConfiguredD20RollDialog({
    title: `${source.attackTitle}: ${item.name}`,
    actor
  });
  if (!attackConfig) return;

  if (attackConfig.useInspiration) {
    const spent = await consumeActorInspiration(actor);
    if (!spent) return;
  }

  const attackFormula = buildFormula(getD20Formula(attackConfig.mode), attackConfig.modifier);
  const roll = game.parovgrad.dice.createRoll(attackFormula, {}, {
    addExtraDie: attackConfig.useInspiration
  });
  await roll.evaluate();

  const speaker = ChatMessage.getSpeaker({ actor });
  const animation = game.parovgrad?.animations?.createContext?.({ actor, item, sourceToken }) ?? null;

  const message = await createRollCardMessage({
    roll,
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">${source.attackTitle}</div>
        <div class="pg-chat-card__subtitle">${actor.name} атакует ${targetDocument.name} ${source.instrumental} «${item.name}»</div>
      </div>
      <div class="pg-chat-card__meta">Режим: ${getRollModeLabel(attackConfig.mode)}${attackConfig.modifier ? ` · Модификатор: ${attackConfig.modifier >= 0 ? "+" : "-"}${Math.abs(attackConfig.modifier)}` : ""}${attackConfig.useInspiration ? " · Вдохновение" : ""}</div>
      <div class="pg-chat-card__actions">
        <button type="button" class="pg-chat-button" data-action="roll-defense">Защита от атаки</button>
        <button type="button" class="pg-chat-button" data-action="roll-attack-damage" hidden>Нанести урон</button>
        ${activeEffects.length ? '<button type="button" class="pg-chat-button" data-action="apply-item-effects" hidden>Применить активные эффекты</button>' : ""}
        ${hasSourceEffect
          ? '<button type="button" class="pg-chat-button" data-action="roll-weapon-effect">Проверить доп. эффект</button>'
          : ""}
      </div>
    `,
    flags: {
      cardType: "attack",
      attack: {
        attackerActorUuid: actor.uuid,
        itemUuid: item.uuid,
        animation,
        itemName: item.name,
        sourceType: source.type,
        targetTokenUuid: targetDocument.uuid,
        targetName: targetDocument.name,
        total: roll.total,
        formula: attackFormula,
        mode: attackConfig.mode,
        modifier: attackConfig.modifier,
        usedInspiration: attackConfig.useInspiration,
        resolved: false,
        success: null,
        hasSourceEffect,
        hasWeaponEffect: hasSourceEffect,
        effectRolled: false,
        damageParts,
        damageRolled: false,
        activeEffects,
        activeEffectsApplied: false
      }
    }
  });
  await game.parovgrad?.animations?.play?.({
    context: animation,
    phase: "use",
    targetTokenUuids: [targetDocument.uuid]
  });
  return message;
}

export async function renderAttackChatButtons(message, html) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  if (!cardType) return;
  renderItemEffectAction(message, html);
  renderAttackDamageAction(message, html);

  if (cardType === "item-use") {
    const effectButton = html.querySelector('[data-action="roll-item-effect"]');
    if (!effectButton) return;

    const itemUseData = message.getFlag("ParovGrad", "itemUse") ?? {};
    const allowed = canRollItemEffect(message);
    const disabled = !allowed || itemUseData.effectRolled;

    effectButton.disabled = disabled;
    effectButton.textContent = getButtonStateText({
      disabled: itemUseData.effectRolled,
      doneLabel: "Доп. эффект проверен",
      activeLabel: "Проверить доп. эффект"
    });

    if (!allowed && !itemUseData.effectRolled) {
      effectButton.title = "Кнопка доступна только GM или владельцу использовавшего предмет.";
    }

    effectButton.addEventListener("click", async (event) => {
      event.preventDefault();
      await handleItemEffectButtonClick(message);
    });

    return;
  }

  if (cardType === "attack") {
    const defenseButton = html.querySelector('[data-action="roll-defense"]');
    const effectButton = html.querySelector('[data-action="roll-weapon-effect"]');
    const attackData = getAttackContext(message)?.data ?? {};

    if (defenseButton) {
      const allowed = canControlDefense(message);
      const disabled = !allowed || attackData.resolved;

      defenseButton.disabled = disabled;
      defenseButton.textContent = getButtonStateText({
        disabled: attackData.resolved,
        doneLabel: "Защита выполнена",
        activeLabel: "Защита от атаки"
      });

      if (!allowed && !attackData.resolved) {
        defenseButton.title = "Кнопка доступна только GM или владельцу цели.";
      }

      defenseButton.addEventListener("click", async (event) => {
        event.preventDefault();
        await handleDefenseButtonClick(message);
      });
    }

    if (effectButton) {
      const allowed = canRollWeaponEffect(message);
      const disabled = !allowed || attackData.effectRolled;

      effectButton.disabled = disabled;
      effectButton.textContent = getButtonStateText({
        disabled: attackData.effectRolled,
        doneLabel: "Доп. эффект проверен",
        activeLabel: "Проверить доп. эффект"
      });

      if (!allowed && !attackData.effectRolled) {
        effectButton.title = "Кнопка доступна только GM или владельцу атакующего.";
      }

      effectButton.addEventListener("click", async (event) => {
        event.preventDefault();
        await handleWeaponEffectButtonClick(message);
      });
    }

    return;
  }

  if (cardType === "damage") {
    const button = html.querySelector('[data-action="apply-damage"]');
    if (!button) return;

    const damageData = message.getFlag("ParovGrad", "damage") ?? {};
    const allowed = canApplyDamage(message);
    const targetActor = getActorFromTokenUuid(damageData.targetTokenUuid);
    const applied = damageData.applied || getAppliedDamage(targetActor, message.uuid ?? message.id);
    const disabled = !allowed || Boolean(applied);

    button.disabled = disabled;
    button.textContent = getButtonStateText({
      disabled: applied,
      doneLabel: "Урон нанесён",
      activeLabel: "Нанести урон"
    });

    if (!allowed && !applied) {
      button.title = "Кнопка доступна только GM или владельцу цели.";
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await handleApplyDamageButtonClick(message);
      } finally {
        const done = message.getFlag("ParovGrad", "damage")?.applied
          || getAppliedDamage(targetActor, message.uuid ?? message.id);
        button.disabled = !canApplyDamage(message) || Boolean(done);
        if (done) button.textContent = "Урон нанесён";
      }
    });
  }
}

export async function handleDefenseButtonClick(message) {
  const key = message.uuid ?? message.id ?? message;
  if (defenseResolutions.has(key)) return;
  defenseResolutions.add(key);
  try {
    return await resolveAttackDefense(message);
  } finally {
    defenseResolutions.delete(key);
  }
}

async function resolveAttackDefense(message) {
  const attackData = foundry.utils.deepClone(getAttackContext(message)?.data ?? {});
  if (!attackData || !attackData.targetTokenUuid) return;

  if (attackData.resolved) {
    ui.notifications?.info("Эта атака уже была обработана.");
    return;
  }

  if (!canControlDefense(message)) {
    ui.notifications?.warn("У вас нет прав на бросок защиты за эту цель.");
    return;
  }

  const targetToken = getTokenFromUuid(attackData.targetTokenUuid);
  if (!targetToken?.actor) {
    ui.notifications?.warn("Не удалось найти цель для защиты.");
    return;
  }

  const defenseConfig = await openConfiguredD20RollDialog({
    title: `Защита: ${attackData.targetName}`,
    actor: targetToken.actor
  });
  if (!defenseConfig) return;

  if (defenseConfig.useInspiration) {
    const spent = await consumeActorInspiration(targetToken.actor);
    if (!spent) return;
  }

  const defenseFormula = buildFormula(getD20Formula(defenseConfig.mode), defenseConfig.modifier);
  const defenseRoll = game.parovgrad.dice.createRoll(defenseFormula, {}, {
    addExtraDie: defenseConfig.useInspiration
  });
  await defenseRoll.evaluate();

  const speaker = ChatMessage.getSpeaker({ actor: targetToken.actor, token: targetToken.document ?? targetToken });
  const success = Number(attackData.total) >= Number(defenseRoll.total);
  const resolvedAttack = { ...attackData, resolved: true, success };

  const result = await createRollCardMessage({
    roll: defenseRoll,
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">Защита от атаки</div>
        <div class="pg-chat-card__subtitle">${attackData.targetName} защищается от атаки «${attackData.itemName}»</div>
      </div>
      <div class="pg-chat-card__meta">Режим: ${getRollModeLabel(defenseConfig.mode)}${defenseConfig.modifier ? ` · Модификатор: ${defenseConfig.modifier >= 0 ? "+" : "-"}${Math.abs(defenseConfig.modifier)}` : ""}${defenseConfig.useInspiration ? " · Вдохновение" : ""}</div>
      <div class="pg-chat-card__comparison">
        <div>Атака: <strong>${attackData.total}</strong></div>
        <div>Защита: <strong>${defenseRoll.total}</strong></div>
      </div>
      <div class="pg-chat-card__result ${success ? "is-success" : "is-failure"}">
        ${success ? "Атака успешна" : "Атака отбита"}
      </div>
      ${success ? `
        <div class="pg-chat-card__actions">
          ${getAttackDamageParts(attackData).length ? '<button type="button" class="pg-chat-button" data-action="roll-attack-damage">Нанести урон</button>' : ""}
          ${attackData.activeEffects?.length ? '<button type="button" class="pg-chat-button" data-action="apply-item-effects">Применить активные эффекты</button>' : ""}
        </div>
      ` : ""}
    `,
    flags: {
      cardType: "defense-result",
      defense: {
        attackMessageId: message.id,
        attackMessageUuid: message.uuid,
        targetTokenUuid: attackData.targetTokenUuid,
        total: defenseRoll.total,
        success,
        usedInspiration: defenseConfig.useInspiration,
        attack: resolvedAttack
      }
    }
  });

  await saveChatFlagIfAllowed(message, "attack", resolvedAttack);
  await game.parovgrad?.animations?.play?.({
    context: attackData.animation,
    phase: success ? "hit" : "miss",
    targetTokenUuids: [attackData.targetTokenUuid]
  });
  if (success && attackData.activeEffects?.length) {
    await handleApplyItemEffectsButtonClick(result);
  }
  return result;
}

export async function handleAttackDamageButtonClick(message) {
  const context = getAttackContext(message);
  if (!context?.data.resolved || context.data.success !== true) {
    ui.notifications?.warn("Урон доступен только после успешной атаки.");
    return;
  }
  if (!canRollAttackDamage(context)) {
    ui.notifications?.warn("Бросить урон может ведущий или владелец атакующего.");
    return;
  }
  if (context.data.damageRolled || getAttackDamageMessage(context) || attackDamageRolls.has(context.applicationId)) return;
  attackDamageRolls.add(context.applicationId);
  try {
    return await rollAttackDamage(context);
  } finally {
    attackDamageRolls.delete(context.applicationId);
  }
}

async function rollAttackDamage(context) {
  const attackData = foundry.utils.deepClone(context.data);
  const source = getAttackSourceConfig(attackData.sourceType);
  const parts = foundry.utils.deepClone(getAttackDamageParts(attackData));
  const damageDie = parts[0]?.formula;
  if (!damageDie) {
    ui.notifications?.warn("У источника урона не задана кость урона.");
    return;
  }

  const attackerActor = fromUuidSync(attackData.attackerActorUuid);
  const damageConfig = await openConfiguredDamageRollDialog({
    title: `${source.damageTitle}: ${attackData.itemName}`,
    actor: attackerActor,
    damageDie
  });
  if (!damageConfig) return;

  if (damageConfig.useInspiration && attackerActor) {
    const spent = await consumeActorInspiration(attackerActor);
    if (!spent) return;
  }

  const rolledDamage = await rollDamageParts(parts, {useInspiration: damageConfig.useInspiration});
  const damageRoll = rolledDamage.primaryRoll;

  const message = await createRollCardMessage({
    roll: damageRoll,
    additionalRolls: rolledDamage.results.slice(1).map(part => part.roll),
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">${source.damageTitle}</div>
        <div class="pg-chat-card__subtitle">${attackData.itemName} наносит урон цели ${attackData.targetName}</div>
      </div>
      <div class="pg-chat-card__meta">Урон: ${damageResultsHtml(rolledDamage.results)} · Всего: ${rolledDamage.total}${damageConfig.useInspiration ? " · Вдохновение" : ""}</div>
      <div class="pg-chat-card__actions">
        <button type="button" class="pg-chat-button pg-chat-button--danger" data-action="apply-damage">Нанести урон</button>
      </div>
    `,
    flags: {
      cardType: "damage",
      damage: {
        targetTokenUuid: attackData.targetTokenUuid,
        targetName: attackData.targetName,
        amount: rolledDamage.total,
        parts: serializeDamageResults(rolledDamage.results),
        sourceType: source.type,
        sourceName: attackData.itemName,
        weaponName: attackData.itemName,
        sourceAttackMessageId: context.attackMessageId,
        attackMessageUuid: context.applicationId,
        usedInspiration: damageConfig.useInspiration,
        applied: false
      }
    }
  });
  await saveChatFlagIfAllowed(context.original, "attack.damageRolled", true);
  if (context.result) await saveChatFlagIfAllowed(context.result, "defense.attack.damageRolled", true);
  return message;
}

export async function handleWeaponEffectButtonClick(message) {
  const attackData = foundry.utils.deepClone(message.getFlag("ParovGrad", "attack") ?? {});
  if (!attackData || !attackData.itemUuid) return;
  const source = getAttackSourceConfig(attackData.sourceType);
  const hasSourceEffect = attackData.hasSourceEffect ?? attackData.hasWeaponEffect;

  if (!hasSourceEffect) {
    ui.notifications?.info(`У этого ${source.genitive} не настроен дополнительный эффект.`);
    return;
  }

  if (attackData.effectRolled) {
    ui.notifications?.info("Дополнительный эффект по этой атаке уже был проверен.");
    return;
  }


  if (!canRollWeaponEffect(message)) {
    ui.notifications?.warn(`У вас нет прав на бросок дополнительного эффекта этим ${source.instrumental}.`);
    return;
  }

  const sourceItem = fromUuidSync(attackData.itemUuid);
  if (!sourceItem) {
    ui.notifications?.warn(`Не удалось найти ${source.genitive} для проверки дополнительного эффекта.`);
    return;
  }

  const effectCheckDie = sourceItem.system?.effectCheckDie;
  const effectDieFaces = getEffectDieFaces(effectCheckDie);
  const effectRanges = normalizeEffectRanges(sourceItem.system?.effectRanges, effectDieFaces);

  if (!effectCheckDie || !effectDieFaces || !effectRanges.length) {
    ui.notifications?.warn(`У ${source.genitive} некорректно настроена проверка дополнительного эффекта.`);
    return;
  }

  const attackerActor = attackData.attackerActorUuid ? fromUuidSync(attackData.attackerActorUuid) : null;
  const effectRoll = game.parovgrad.dice.createRoll(effectCheckDie, {}, { autoExplode: false });
  await effectRoll.evaluate();

  const triggeredEffects = findTriggeredWeaponEffects(effectRanges, Number(effectRoll.total) || 0);

  await createAttackEffectResultMessage({
    actor: attackerActor ?? sourceItem.parent ?? null,
    itemName: attackData.itemName,
    targetName: attackData.targetName,
    effectCheckDie,
    effectRoll,
    source,
    triggeredEffects
  });

  await message.setFlag("ParovGrad", "attack.effectRolled", true);
}

export async function handleItemEffectButtonClick(message) {
  const itemUseData = foundry.utils.deepClone(message.getFlag("ParovGrad", "itemUse") ?? {});
  if (!itemUseData || !itemUseData.itemUuid) return;

  const source = getAttackSourceConfig("item");
  if (!itemUseData.hasSourceEffect) {
    ui.notifications?.info("У этого предмета не настроен дополнительный эффект.");
    return;
  }

  if (itemUseData.effectRolled) {
    ui.notifications?.info("Дополнительный эффект по этому использованию уже был проверен.");
    return;
  }

  if (!canRollItemEffect(message)) {
    ui.notifications?.warn("У вас нет прав на бросок дополнительного эффекта этим предметом.");
    return;
  }

  const sourceItem = fromUuidSync(itemUseData.itemUuid);
  if (!sourceItem) {
    ui.notifications?.warn("Не удалось найти предмет для проверки дополнительного эффекта.");
    return;
  }

  const effectCheckDie = sourceItem.system?.effectCheckDie;
  const effectDieFaces = getEffectDieFaces(effectCheckDie);
  const effectRanges = normalizeEffectRanges(sourceItem.system?.effectRanges, effectDieFaces);

  if (!effectCheckDie || !effectDieFaces || !effectRanges.length) {
    ui.notifications?.warn("У предмета некорректно настроена проверка дополнительного эффекта.");
    return;
  }

  const actor = itemUseData.actorUuid ? fromUuidSync(itemUseData.actorUuid) : null;
  const effectRoll = game.parovgrad.dice.createRoll(effectCheckDie, {}, { autoExplode: false });
  await effectRoll.evaluate();

  const triggeredEffects = findTriggeredWeaponEffects(effectRanges, Number(effectRoll.total) || 0);

  await createAttackEffectResultMessage({
    actor: actor ?? sourceItem.parent ?? null,
    itemName: itemUseData.itemName,
    effectCheckDie,
    effectRoll,
    source,
    triggeredEffects
  });

  await message.setFlag("ParovGrad", "itemUse.effectRolled", true);
}

export async function handleApplyDamageButtonClick(message) {
  const key = message.uuid ?? message.id ?? message;
  if (damageApplications.has(key)) return;
  damageApplications.add(key);
  try {
    return await applyAttackDamage(message);
  } finally {
    damageApplications.delete(key);
  }
}

async function applyAttackDamage(message) {
  const damageData = foundry.utils.deepClone(message.getFlag("ParovGrad", "damage") ?? {});
  if (!damageData || !damageData.targetTokenUuid) return;

  const targetActor = getActorFromTokenUuid(damageData.targetTokenUuid);
  if (damageData.applied || getAppliedDamage(targetActor, message.uuid ?? message.id)) {
    ui.notifications?.info("Урон по этому сообщению уже был нанесён.");
    return;
  }

  if (!canApplyDamage(message)) {
    ui.notifications?.warn("У вас нет прав на нанесение урона этой цели.");
    return;
  }

  if (!targetActor) {
    ui.notifications?.warn("Не удалось найти цель для нанесения урона.");
    return;
  }

  const rolledParts = Array.isArray(damageData.parts) && damageData.parts.length
    ? damageData.parts : [{amount: damageData.amount, category: "unspecified", damageType: null}];
  const {amount: damageAmount, before: currentHealth, after: nextHealth} = await applyTypedDamage(targetActor, rolledParts, {
    applicationId: message.uuid ?? message.id
  });

  await saveChatFlagIfAllowed(message, "damage.applied", true);

  const sourceName = damageData.sourceName ?? damageData.weaponName ?? "источника";

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `
      <div class="pg-chat-card">
        <div class="pg-chat-card__header">
          <div class="pg-chat-card__title">Урон применён</div>
          <div class="pg-chat-card__subtitle">${damageData.targetName} получает ${damageAmount} урона от «${sourceName}»</div>
        </div>
        <div class="pg-chat-card__comparison">
          <div>Было здоровья: <strong>${currentHealth}</strong></div>
          <div>Стало здоровья: <strong>${nextHealth}</strong></div>
        </div>
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}
