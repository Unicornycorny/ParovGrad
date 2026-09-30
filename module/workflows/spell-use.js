import {
  SPELL_EFFECT_TYPES,
  SPELL_EFFECT_TYPE_LABELS,
  getSpellEffects,
  isValidSpellRollFormula
} from "../magic/spell-effects.js";

function getSingleTargetToken() {
  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications?.warn("Для применения эффекта заклинания выберите ровно одну цель.");
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

function canApplySpellEffect(message) {
  const data = message.getFlag("ParovGrad", "spellEffect") ?? {};
  const targetActor = getActorFromTokenUuid(data.targetTokenUuid);
  if (!targetActor) return false;
  return game.user.isGM || targetActor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function formatInfluences(influences) {
  const values = Array.isArray(influences)
    ? influences.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  return values.length ? values.join(" · ") : "—";
}

async function createInfoCardMessage({ actor, item, targetDocument = null, effects = [] }) {
  const speaker = ChatMessage.getSpeaker({ actor });
  const targetText = targetDocument ? ` на цель ${targetDocument.name}` : "";

  return ChatMessage.create({
    user: game.user.id,
    speaker,
    content: `
      <div class="pg-chat-card">
        <div class="pg-chat-card__header">
          <div class="pg-chat-card__title">Применение заклинания</div>
          <div class="pg-chat-card__subtitle">${actor.name} применяет «${item.name}»${targetText}</div>
        </div>
        <div class="pg-chat-card__meta">Дальность: ${item.system?.range || "—"} · Форма: ${item.system?.shape || "—"}</div>
        <div class="pg-chat-card__meta">Влияния: ${formatInfluences(item.system?.influences)}</div>
        ${effects.length
          ? `<div class="pg-chat-card__meta">Бросков эффекта: ${effects.length}</div>`
          : '<div class="pg-chat-card__meta">У заклинания нет влияний с броском урона или лечения.</div>'}
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      ParovGrad: {
        cardType: "spell-use",
        spellUse: {
          actorUuid: actor.uuid,
          itemUuid: item.uuid,
          itemName: item.name,
          targetTokenUuid: targetDocument?.uuid ?? null,
          targetName: targetDocument?.name ?? null,
          effectCount: effects.length
        }
      }
    }
  });
}

async function createSpellEffectRollMessage({ actor, item, targetDocument, effect, roll }) {
  const isDamage = effect.type === SPELL_EFFECT_TYPES.DAMAGE;
  const typeLabel = SPELL_EFFECT_TYPE_LABELS[effect.type] ?? effect.label ?? effect.type;
  const rollHtml = await roll.render();
  const speaker = ChatMessage.getSpeaker({ actor });

  const actionHtml = isDamage
    ? `
      <button type="button" class="pg-chat-button pg-chat-button--danger" data-action="apply-spell-damage">Нанести урон</button>
      <button type="button" class="pg-chat-button" data-action="apply-spell-half-damage">Нанести половину урона</button>
    `
    : `
      <button type="button" class="pg-chat-button pg-chat-button--healing" data-action="apply-spell-healing">Вылечить</button>
    `;

  return ChatMessage.create({
    user: game.user.id,
    speaker,
    content: `
      <div class="pg-chat-card">
        <div class="pg-chat-card__header">
          <div class="pg-chat-card__title">${typeLabel}: ${item.name}</div>
          <div class="pg-chat-card__subtitle">${effect.label} для цели ${targetDocument.name}</div>
        </div>
        <div class="pg-chat-card__meta">Формула: ${effect.formula}</div>
        <div class="pg-chat-card__actions">${actionHtml}</div>
        <div class="pg-chat-card__roll">${rollHtml}</div>
      </div>
    `,
    rolls: [JSON.stringify(roll.toJSON())],
    style: CONST.CHAT_MESSAGE_STYLES.ROLL,
    flags: {
      ParovGrad: {
        cardType: "spell-effect",
        spellEffect: {
          actorUuid: actor.uuid,
          itemUuid: item.uuid,
          itemName: item.name,
          targetTokenUuid: targetDocument.uuid,
          targetName: targetDocument.name,
          effectType: effect.type,
          effectLabel: effect.label,
          formula: effect.formula,
          amount: Math.max(0, Number(roll.total) || 0),
          applied: false,
          appliedMode: null,
          appliedAmount: null
        }
      }
    }
  });
}

export async function startSpellUse({ actor, item }) {
  if (!actor || !item || item.type !== "spell") return;

  const effects = getSpellEffects(item);
  let targetDocument = null;

  if (effects.length) {
    const targetToken = getSingleTargetToken();
    if (!targetToken) return;

    targetDocument = getTokenDocument(targetToken);
    if (!targetDocument?.actor) {
      ui.notifications?.warn("У выбранной цели нет актора.");
      return;
    }

    for (const effect of effects) {
      if (!isValidSpellRollFormula(effect.formula)) {
        ui.notifications?.error(`У влияния «${effect.label}» задана некорректная формула: ${effect.formula || "—"}.`);
        return;
      }
    }
  }

  await createInfoCardMessage({ actor, item, targetDocument, effects });

  for (const effect of effects) {
    const rollData = actor.getRollData?.() ?? actor.system?.toObject?.() ?? actor.system ?? {};
    const roll = game.parovgrad.dice.createRoll(effect.formula, rollData);
    await roll.evaluate();

    await createSpellEffectRollMessage({
      actor,
      item,
      targetDocument,
      effect,
      roll
    });
  }
}

export function renderSpellChatButtons(message, html) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  if (cardType !== "spell-effect") return;

  const effectData = message.getFlag("ParovGrad", "spellEffect") ?? {};
  const allowed = canApplySpellEffect(message);
  const applied = Boolean(effectData.applied);

  const bind = (selector, mode, activeLabel) => {
    const button = html.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = !allowed || applied;

    if (applied) {
      const modeLabels = {
        damage: "Урон применён",
        halfDamage: "Половина урона применена",
        healing: "Лечение применено"
      };
      button.textContent = modeLabels[effectData.appliedMode] ?? "Эффект применён";
    } else {
      button.textContent = activeLabel;
    }

    if (!allowed && !applied) {
      button.title = "Кнопка доступна только GM или владельцу цели.";
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await handleApplySpellEffectButtonClick(message, mode);
    });
  };

  bind('[data-action="apply-spell-damage"]', "damage", "Нанести урон");
  bind('[data-action="apply-spell-half-damage"]', "halfDamage", "Нанести половину урона");
  bind('[data-action="apply-spell-healing"]', "healing", "Вылечить");
}

export async function handleApplySpellEffectButtonClick(message, mode) {
  const effectData = foundry.utils.deepClone(message.getFlag("ParovGrad", "spellEffect") ?? {});
  if (!effectData?.targetTokenUuid) return;

  if (effectData.applied) {
    ui.notifications?.info("Эффект этого броска уже был применён.");
    return;
  }

  if (!canApplySpellEffect(message)) {
    ui.notifications?.warn("У вас нет прав на изменение здоровья этой цели.");
    return;
  }

  const targetActor = getActorFromTokenUuid(effectData.targetTokenUuid);
  if (!targetActor) {
    ui.notifications?.warn("Не удалось найти цель для применения эффекта.");
    return;
  }

  const currentHealth = Math.max(0, Number(targetActor.system?.health?.value) || 0);
  const rolledAmount = Math.max(0, Number(effectData.amount) || 0);
  let appliedAmount = rolledAmount;
  let nextHealth = currentHealth;
  let actionTitle = "Эффект применён";
  let actionText = "";

  if (mode === "damage" || mode === "halfDamage") {
    if (effectData.effectType !== SPELL_EFFECT_TYPES.DAMAGE) {
      ui.notifications?.warn("Этот бросок не является уроном.");
      return;
    }

    // Half damage is rounded down for odd totals.
    appliedAmount = mode === "halfDamage" ? Math.floor(rolledAmount / 2) : rolledAmount;
    nextHealth = Math.max(currentHealth - appliedAmount, 0);
    actionTitle = mode === "halfDamage" ? "Половина урона применена" : "Урон применён";
    actionText = `${effectData.targetName} получает ${appliedAmount} урона от «${effectData.itemName}»`;
  } else if (mode === "healing") {
    if (effectData.effectType !== SPELL_EFFECT_TYPES.HEALING) {
      ui.notifications?.warn("Этот бросок не является лечением.");
      return;
    }

    const derivedMax = Number(targetActor.system?.derivedHealthMax);
    const storedMax = Number(targetActor.system?.health?.max);
    const maxHealth = Number.isFinite(derivedMax) && derivedMax >= 0
      ? derivedMax
      : (Number.isFinite(storedMax) && storedMax >= 0 ? storedMax : currentHealth + rolledAmount);

    nextHealth = Math.min(currentHealth + rolledAmount, maxHealth);
    appliedAmount = Math.max(0, nextHealth - currentHealth);
    actionTitle = "Лечение применено";
    actionText = `${effectData.targetName} восстанавливает ${appliedAmount} здоровья от «${effectData.itemName}»`;
  } else {
    return;
  }

  await targetActor.update({
    "system.health.value": nextHealth
  });

  await message.setFlag("ParovGrad", "spellEffect.applied", true);
  await message.setFlag("ParovGrad", "spellEffect.appliedMode", mode);
  await message.setFlag("ParovGrad", "spellEffect.appliedAmount", appliedAmount);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `
      <div class="pg-chat-card">
        <div class="pg-chat-card__header">
          <div class="pg-chat-card__title">${actionTitle}</div>
          <div class="pg-chat-card__subtitle">${actionText}</div>
        </div>
        <div class="pg-chat-card__comparison">
          <div>Результат броска: <strong>${rolledAmount}</strong></div>
          <div>Применено: <strong>${appliedAmount}</strong></div>
          <div>Было здоровья: <strong>${currentHealth}</strong></div>
          <div>Стало здоровья: <strong>${nextHealth}</strong></div>
        </div>
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}
