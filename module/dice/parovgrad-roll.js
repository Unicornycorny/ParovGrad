/**
 * Создаёт системный Roll с авто-взрывом всех dN, кроме d20.
 * Важно: используем встроенный exploding modifier Foundry,
 * а не пишем свою рекурсию руками.
 */
export function createParovgradRoll(formula, data = {}, options = {}) {
  const roll = new Roll(formula, data, options);

  // Не применяем авто-взрыв для служебных max/min вычислений,
  // иначе максимизация d6x6 может уйти в бесконечный взрыв.
  if (!options.maximize && !options.minimize) {
    applyAutoExplode(roll);
    roll.resetFormula();
  }

  return roll;
}

export async function rollToMessage({
  formula,
  data = {},
  options = {},
  messageData = {},
  chatOptions = {}
} = {}) {
  const roll = createParovgradRoll(formula, data, options);
  await roll.evaluate(options);
  await roll.toMessage(messageData, chatOptions);
  return roll;
}

export function applyAutoExplode(roll) {
  for (const die of roll.dice) {
    const faces = Number(die.faces);

    // Только обычные числовые кубы
    if (!Number.isFinite(faces)) continue;

    // d20 не взрывается
    if (faces === 20) continue;

    // Если взрыв уже задан явно в формуле, не дублируем
    if (hasExplosionModifier(die)) continue;

    die.modifiers ??= [];

    // Ставим explode ПЕРЕД остальными модификаторами,
    // чтобы сначала сработал взрыв, а потом kh/kl/cs и т.д.
    die.modifiers.unshift(`x${faces}`);
  }

  return roll;
}

function hasExplosionModifier(die) {
  return (die.modifiers ?? []).some(modifier => modifier.startsWith("x"));
}