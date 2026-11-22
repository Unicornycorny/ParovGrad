/**
 * Плавный ход стрелок манометров на листе персонажа/NPC.
 *
 * Лист перерисовывается целиком после каждого изменения, поэтому CSS-переход
 * не сработает: элемент стрелки каждый раз новый. Перед перерисовкой запоминаем,
 * где стрелка стоит сейчас (с учётом идущей анимации), а после — ведём новую
 * стрелку от этого положения к новому значению по кривой затухающей пружины:
 * короткий перелёт и успокоение, как у стрелки барометра.
 *
 * Анимируется CSS-переменная --pg-gauge-fill (0–100), зарегистрированная через
 * @property в dossier.css, — от неё зависят и стрелка, и цветная дуга.
 */

const FILL_PROPERTY = "--pg-gauge-fill";
const GAUGE_SELECTOR = ".pg-gauge[data-gauge-key]";

/** Коэффициент затухания: 0.55 даёт перелёт около 12% и одно лёгкое возвратное качание. */
const DAMPING = 0.55;
/** Затухание до ~2% к концу анимации. */
const DECAY = 3.9;

const round2 = (value) => Math.round(value * 100) / 100;

/** Длительность хода стрелки: дальше ход — дольше, но не дольше 1.6 с. */
export function gaugeMotionDuration(from, to) {
  return Math.round(Math.min(1600, 650 + Math.abs(to - from) * 9));
}

/**
 * Кадры хода стрелки от `from` к `to` (в процентах шкалы).
 * Переходная функция недодемпфированного осциллятора; перелёт ограничен
 * упорами шкалы (−3…103), последний кадр — ровно `to`.
 */
export function gaugeSpringKeyframes(from, to, { frames = 40, damping = DAMPING } = {}) {
  const omega = DECAY / damping;
  const omegaD = omega * Math.sqrt(1 - damping * damping);
  const ratio = damping / Math.sqrt(1 - damping * damping);
  const keyframes = [];
  for (let index = 0; index <= frames; index++) {
    const t = index / frames;
    const response = index === frames
      ? 1
      : 1 - Math.exp(-damping * omega * t) * (Math.cos(omegaD * t) + ratio * Math.sin(omegaD * t));
    const value = Math.max(-3, Math.min(103, from + (to - from) * response));
    keyframes.push({ [FILL_PROPERTY]: String(round2(index === frames ? to : value)), offset: round2(t) });
  }
  return keyframes;
}

function readFill(value) {
  const number = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

/** Перед перерисовкой: где стрелки стоят прямо сейчас. */
export function captureGaugeReadings(root, memory) {
  if (!root?.querySelectorAll) return;
  const view = root.ownerDocument?.defaultView ?? globalThis;
  for (const gauge of root.querySelectorAll(GAUGE_SELECTOR)) {
    const current = readFill(view.getComputedStyle?.(gauge).getPropertyValue(FILL_PROPERTY))
      ?? readFill(gauge.style.getPropertyValue(FILL_PROPERTY));
    if (current !== null) memory.set(gauge.dataset.gaugeKey, current);
  }
}

/** После перерисовки: довести стрелки от запомненного положения до нового значения. */
export function animateGaugeNeedles(root, memory) {
  if (!root?.querySelectorAll) return;
  const view = root.ownerDocument?.defaultView ?? globalThis;
  const reduceMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  for (const gauge of root.querySelectorAll(GAUGE_SELECTOR)) {
    const key = gauge.dataset.gaugeKey;
    const target = readFill(gauge.style.getPropertyValue(FILL_PROPERTY)) ?? 0;
    const previous = memory.get(key);
    memory.set(key, target);
    // Первое открытие листа и неизменное значение — без движения.
    if (previous === undefined || Math.abs(previous - target) < 0.05) continue;
    if (reduceMotion || typeof gauge.animate !== "function") continue;
    gauge.animate(gaugeSpringKeyframes(previous, target), {
      duration: gaugeMotionDuration(previous, target),
      easing: "linear"
    });
  }
}
