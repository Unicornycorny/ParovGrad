import { getActorEffectView, getEffectFlagScope } from "../effects/effect-utils.js";

const recoveringActors = new WeakSet();

/** A rest grants one shared recovery point per full two points above ten. */
export function getRestRecoveryPoints(d20) {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
    throw new Error("Результат D20 должен быть целым числом от 1 до 20.");
  }
  return Math.max(0, Math.floor((d20 - 10) / 2));
}

export function getRestRecoverableEffects(actor) {
  return Array.from(actor?.effects ?? [])
    .filter((effect) => !effect.disabled && !effect.isSuppressed)
    .map((effect) => getActorEffectView(effect))
    .filter((effect) => Number.isInteger(effect.level) && effect.level > 0
      && normalizeRemoval(effect.removal) === "после отдыха");
}

/** Validate the whole selection against current documents before writing. */
export async function applyRestRecovery(actor, { d20 = null, reductions = [], healthRecovery = 0 } = {}) {
  if (actor?.documentName !== "Actor" || actor.type !== "Player") {
    throw new Error("Отдых доступен только для персонажа.");
  }
  if (!actor.isOwner) throw new Error("Недостаточно прав для отдыха персонажа.");
  if (recoveringActors.has(actor)) throw new Error("Отдых этого персонажа уже применяется.");

  const recoveryPoints = d20 === null ? 0 : getRestRecoveryPoints(d20);
  if (!Number.isInteger(healthRecovery) || healthRecovery < 0) {
    throw new Error("Восстановление здоровья должно быть целым неотрицательным числом.");
  }
  if (!Array.isArray(reductions)) throw new Error("Не удалось прочитать выбранные эффекты.");

  const eligible = new Map(getRestRecoverableEffects(actor).map((effect) => [effect.id, effect]));
  const selectedIds = new Set();
  const effects = [];
  let spentPoints = 0;
  for (const reduction of reductions) {
    const effect = eligible.get(reduction?.effectId);
    if (!effect) throw new Error("Выбранный эффект больше нельзя снять после отдыха. Откройте отдых заново.");
    if (selectedIds.has(effect.id)) throw new Error("Один эффект выбран несколько раз.");
    selectedIds.add(effect.id);
    const points = reduction.points;
    if (!Number.isInteger(points) || points < 0 || points > effect.level) {
      throw new Error(`Для эффекта «${effect.name}» укажите целое число от 0 до ${effect.level}.`);
    }
    spentPoints += points;
    if (spentPoints > recoveryPoints) throw new Error("Выбрано больше пунктов эффектов, чем позволяет результат D20.");
    if (points === 0) continue;
    effects.push({
      id: effect.id,
      name: effect.name,
      previousLevel: effect.level,
      level: effect.level - points,
      removed: points === effect.level
    });
  }

  // Check health data before any effect write; effects may then change its maximum.
  readHealth(actor);
  const updates = effects.filter((effect) => !effect.removed).map((effect) => ({
    _id: effect.id,
    [`flags.${getEffectFlagScope()}.level`]: effect.level
  }));
  const deletions = effects.filter((effect) => effect.removed).map((effect) => effect.id);

  recoveringActors.add(actor);
  let started = false;
  try {
    if (updates.length) {
      started = true;
      await actor.updateEmbeddedDocuments("ActiveEffect", updates);
      const observed = new Map(Array.from(actor.effects).map((effect) => [effect.id, effect]));
      if (updates.some((update) => Number(observed.get(update._id)?.flags?.[getEffectFlagScope()]?.level)
        !== update[`flags.${getEffectFlagScope()}.level`])) {
        throw new Error("Снижение уровня эффекта было отменено. Проверьте эффекты персонажа.");
      }
    }
    if (deletions.length) {
      started = true;
      await actor.deleteEmbeddedDocuments("ActiveEffect", deletions);
      const remainingIds = new Set(Array.from(actor.effects).map((effect) => effect.id));
      if (deletions.some((id) => remainingIds.has(id))) {
        throw new Error("Снятие эффекта было отменено. Проверьте эффекты персонажа.");
      }
    }

    const health = readHealth(actor);
    const nextHealth = Math.min(health.max, health.value + healthRecovery);
    let healthValue = health.value;
    if (healthRecovery > 0 && nextHealth > health.value) {
      started = true;
      await actor.update({ "system.health.value": nextHealth });
      healthValue = Number(actor.system.health.value);
      if (healthValue !== nextHealth) {
        throw new Error("Восстановление здоровья было отменено или изменено. Проверьте здоровье персонажа.");
      }
    }
    return {
      d20,
      recoveryPoints,
      spentPoints,
      effects,
      healthRecovered: Math.max(0, healthValue - health.value),
      healthValue,
      healthMax: health.max
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (started) failure.restRecoveryStarted = true;
    throw failure;
  } finally {
    recoveringActors.delete(actor);
  }
}

function normalizeRemoval(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru")
    .trim().replace(/\s+/gu, " ").replace(/[.!]+$/u, "").trim();
}

function readHealth(actor) {
  const value = Number(actor.system?.health?.value);
  const max = Number(actor.system?.derivedHealthMax);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(max) || max < 0) {
    throw new Error("Не удалось прочитать текущее или максимальное здоровье персонажа.");
  }
  return { value, max };
}
