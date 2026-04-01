import {
  consumeActorInspiration,
  openConfiguredD20RollDialog,
  openConfiguredDamageRollDialog
} from "../dice/roll-dialog.js";

function getSingleTargetToken() {
  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications?.warn("Для атаки оружием выберите ровно одну цель.");
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

async function createRollCardMessage({ roll, speaker, content, flags = {} }) {
  const rollHtml = await roll.render();
  return ChatMessage.create({
    user: game.user.id,
    speaker,
    content: `
      <div class="pg-chat-card">
        ${content}
        <div class="pg-chat-card__roll">${rollHtml}</div>
      </div>
    `,
    rolls: [JSON.stringify(roll.toJSON())],
    style: CONST.CHAT_MESSAGE_STYLES.ROLL,
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

async function setAttackResolved(message, resolved = true) {
  await message.setFlag("ParovGrad", "attack.resolved", resolved);
}

async function setDamageApplied(message, applied = true) {
  await message.setFlag("ParovGrad", "damage.applied", applied);
}

function getButtonStateText({ disabled, doneLabel, activeLabel }) {
  if (disabled) return doneLabel ?? activeLabel;
  return activeLabel;
}

export async function startWeaponAttack({ actor, item }) {
  const targetToken = getSingleTargetToken();
  if (!targetToken) return;

  const targetDocument = getTokenDocument(targetToken);
  const targetActor = targetDocument?.actor ?? null;
  if (!targetActor) {
    ui.notifications?.warn("У выбранной цели нет актора.");
    return;
  }

  const attackConfig = await openConfiguredD20RollDialog({
    title: `Атака оружием: ${item.name}`,
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

  await createRollCardMessage({
    roll,
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">Атака оружием</div>
        <div class="pg-chat-card__subtitle">${actor.name} атакует ${targetDocument.name} оружием «${item.name}»</div>
      </div>
      <div class="pg-chat-card__meta">Режим: ${getRollModeLabel(attackConfig.mode)}${attackConfig.modifier ? ` · Модификатор: ${attackConfig.modifier >= 0 ? "+" : "-"}${Math.abs(attackConfig.modifier)}` : ""}${attackConfig.useInspiration ? " · Вдохновение" : ""}</div>
      <div class="pg-chat-card__actions">
        <button type="button" class="pg-chat-button" data-action="roll-defense">Защита от атаки</button>
      </div>
    `,
    flags: {
      cardType: "attack",
      attack: {
        attackerActorUuid: actor.uuid,
        itemUuid: item.uuid,
        itemName: item.name,
        targetTokenUuid: targetDocument.uuid,
        targetName: targetDocument.name,
        total: roll.total,
        formula: attackFormula,
        mode: attackConfig.mode,
        modifier: attackConfig.modifier,
        usedInspiration: attackConfig.useInspiration,
        resolved: false
      }
    }
  });
}

export async function renderAttackChatButtons(message, html) {
  const cardType = message.getFlag("ParovGrad", "cardType");
  if (!cardType) return;

  if (cardType === "attack") {
    const button = html.querySelector('[data-action="roll-defense"]');
    if (!button) return;

    const attackData = message.getFlag("ParovGrad", "attack") ?? {};
    const allowed = canControlDefense(message);
    const disabled = !allowed || attackData.resolved;

    button.disabled = disabled;
    button.textContent = getButtonStateText({
      disabled: attackData.resolved,
      doneLabel: "Защита выполнена",
      activeLabel: "Защита от атаки"
    });

    if (!allowed && !attackData.resolved) {
      button.title = "Кнопка доступна только GM или владельцу цели.";
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await handleDefenseButtonClick(message);
    });
  }

  if (cardType === "damage") {
    const button = html.querySelector('[data-action="apply-damage"]');
    if (!button) return;

    const damageData = message.getFlag("ParovGrad", "damage") ?? {};
    const allowed = canApplyDamage(message);
    const disabled = !allowed || damageData.applied;

    button.disabled = disabled;
    button.textContent = getButtonStateText({
      disabled: damageData.applied,
      doneLabel: "Урон нанесён",
      activeLabel: "Нанести урон"
    });

    if (!allowed && !damageData.applied) {
      button.title = "Кнопка доступна только GM или владельцу цели.";
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await handleApplyDamageButtonClick(message);
    });
  }
}

export async function handleDefenseButtonClick(message) {
  const attackData = foundry.utils.deepClone(message.getFlag("ParovGrad", "attack") ?? {});
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

  await createRollCardMessage({
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
    `,
    flags: {
      cardType: "defense-result",
      defense: {
        attackMessageId: message.id,
        targetTokenUuid: attackData.targetTokenUuid,
        total: defenseRoll.total,
        success,
        usedInspiration: defenseConfig.useInspiration
      }
    }
  });

  await setAttackResolved(message, true);

  if (!success) return;

  const weapon = fromUuidSync(attackData.itemUuid);
  if (!weapon) {
    ui.notifications?.warn("Не удалось найти оружие для броска урона.");
    return;
  }

  const damageDie = weapon.system?.damageDie;
  if (!damageDie) {
    ui.notifications?.warn("У оружия не задана кость урона.");
    return;
  }

  const attackerActor = fromUuidSync(attackData.attackerActorUuid);
  const damageConfig = await openConfiguredDamageRollDialog({
    title: `Урон оружия: ${attackData.itemName}`,
    actor: attackerActor,
    damageDie
  });
  if (!damageConfig) return;

  if (damageConfig.useInspiration && attackerActor) {
    const spent = await consumeActorInspiration(attackerActor);
    if (!spent) return;
  }

  const damageRoll = game.parovgrad.dice.createRoll(damageDie, {}, {
    addExtraDie: damageConfig.useInspiration
  });
  await damageRoll.evaluate();

  await createRollCardMessage({
    roll: damageRoll,
    speaker,
    content: `
      <div class="pg-chat-card__header">
        <div class="pg-chat-card__title">Урон оружия</div>
        <div class="pg-chat-card__subtitle">${attackData.itemName} наносит урон цели ${attackData.targetName}</div>
      </div>
      <div class="pg-chat-card__meta">Кость урона: ${String(damageDie).toUpperCase()}${damageConfig.useInspiration ? " · Вдохновение" : ""}</div>
      <div class="pg-chat-card__actions">
        <button type="button" class="pg-chat-button pg-chat-button--danger" data-action="apply-damage">Нанести урон</button>
      </div>
    `,
    flags: {
      cardType: "damage",
      damage: {
        targetTokenUuid: attackData.targetTokenUuid,
        targetName: attackData.targetName,
        amount: damageRoll.total,
        weaponName: attackData.itemName,
        sourceAttackMessageId: message.id,
        usedInspiration: damageConfig.useInspiration,
        applied: false
      }
    }
  });
}

export async function handleApplyDamageButtonClick(message) {
  const damageData = foundry.utils.deepClone(message.getFlag("ParovGrad", "damage") ?? {});
  if (!damageData || !damageData.targetTokenUuid) return;

  if (damageData.applied) {
    ui.notifications?.info("Урон по этому сообщению уже был нанесён.");
    return;
  }

  if (!canApplyDamage(message)) {
    ui.notifications?.warn("У вас нет прав на нанесение урона этой цели.");
    return;
  }

  const targetActor = getActorFromTokenUuid(damageData.targetTokenUuid);
  if (!targetActor) {
    ui.notifications?.warn("Не удалось найти цель для нанесения урона.");
    return;
  }

  const currentHealth = Number(targetActor.system?.health?.value) || 0;
  const damageAmount = Math.max(Number(damageData.amount) || 0, 0);
  const nextHealth = Math.max(currentHealth - damageAmount, 0);

  await targetActor.update({
    "system.health.value": nextHealth
  });

  await setDamageApplied(message, true);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `
      <div class="pg-chat-card">
        <div class="pg-chat-card__header">
          <div class="pg-chat-card__title">Урон применён</div>
          <div class="pg-chat-card__subtitle">${damageData.targetName} получает ${damageAmount} урона от «${damageData.weaponName}»</div>
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