/**
 * Создаёт системный Roll с авто-взрывом всех dN, кроме d20,
 * и умеет добавлять 1 дополнительный куб к первому DiceTerm.
 */
export function createParovgradRoll(formula, data = {}, options = {}) {
  const { addExtraDie = false, ...rollOptions } = options;
  const roll = new Roll(formula, data, rollOptions);

  // Не применяем авто-взрыв для служебных max/min вычислений,
  // иначе максимизация d6x6 может уйти в бесконечный взрыв.
  if (!rollOptions.maximize && !rollOptions.minimize) {
    if (addExtraDie) {
      applyExtraDie(roll);
    }

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
  const { addExtraDie = false, ...rollOptions } = options;
  const roll = createParovgradRoll(formula, data, { ...rollOptions, addExtraDie });
  await roll.evaluate(rollOptions);
  await roll.toMessage(messageData, chatOptions);
  return roll;
}

export function applyExtraDie(roll) {
  const die = roll.dice.find(term => {
    const faces = Number(term.faces);
    return Number.isFinite(faces) && (Number(term.number) || 0) > 0;
  });

  if (!die) return roll;

  die.number = (Number(die.number) || 1) + 1;
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