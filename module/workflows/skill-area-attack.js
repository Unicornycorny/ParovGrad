/** Multi-target skill attacks. Each target has an independent, persistent chat-card state. */
import { consumeActorInspiration, openConfiguredD20RollDialog, openConfiguredDamageRollDialog } from "../dice/roll-dialog.js";
import { placeSpellTemplate } from "../canvas/spell-template.js";

const FLAG = "massSkillAttack";
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const tokenActor = (uuid) => fromUuidSync(uuid)?.actor ?? null;
const canManage = (actor) => !!actor && (game.user.isGM || actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER));
const dice = (mode) => mode === "advantage" ? "2d20kh" : mode === "disadvantage" ? "2d20kl" : "1d20";
const formula = (mode, modifier) => {
  const n = Number(modifier) || 0;
  return `${dice(mode)}${n ? ` ${n > 0 ? "+" : "-"} ${Math.abs(n)}` : ""}`;
};
const targetsHtml = (state) => state.targets.map((target, i) => {
  const stateLabel = !target.defended ? "" : target.hit ? `Защита ${target.defenseTotal} · Попадание` : `Защита ${target.defenseTotal} · Отбито`;
  const buttons = !target.defended
    ? `<button type="button" class="pg-chat-button" data-action="mass-skill-defense" data-target="${i}">Защита</button>`
    : !target.hit ? ""
      : target.damage === null
        ? `<button type="button" class="pg-chat-button" data-action="mass-skill-damage" data-target="${i}">Урон</button>`
        : target.applied ? `<span class="pg-mass-applied">Нанесено ${target.appliedAmount}</span>`
          : `<span class="pg-mass-effect__value">Урон: ${target.damage}</span><button type="button" class="pg-chat-button" data-action="mass-skill-apply" data-target="${i}" data-half="false">Урон</button><button type="button" class="pg-chat-button" data-action="mass-skill-apply" data-target="${i}" data-half="true">Половина</button>`;
  const effect = target.effectTotal === null ? "" : `<span class="pg-mass-effect__value" title="${esc(target.effectText)}">Эффект ${target.effectTotal}: ${esc(target.effectText || "—")}</span>`;
  const effectButton = target.defended && target.hit && target.damage !== null && !target.effectChecked && state.hasEffect
    ? `<button type="button" class="pg-chat-button" data-action="mass-skill-effect" data-target="${i}">Доп. эффект</button>` : "";
  return `<div class="pg-mass-target"><span class="pg-mass-target__name" title="${esc(target.name)}">${esc(target.name)}</span><span class="pg-mass-defense ${target.defended ? (target.hit ? "is-success" : "is-failure") : ""}">${esc(stateLabel)}</span><span class="pg-mass-target__actions">${buttons}${effectButton}${effect}</span></div>`;
}).join("");

function renderCard(state) {
  return `<div class="pg-chat-card"><div class="pg-chat-card__header"><div class="pg-chat-card__title">Массовая атака навыком</div><div class="pg-chat-card__subtitle">${esc(state.actorName)} использует «${esc(state.itemName)}»</div></div><div class="pg-chat-card__meta">Атака: <strong>${state.attackTotal}</strong> · ${esc(state.attackFormula)}</div><div class="pg-mass-targets">${targetsHtml(state)}</div></div>`;
}
async function updateState(message, state) {
  await message.update({ content: renderCard(state), [`flags.ParovGrad.${FLAG}`]: state });
}
async function rollConfigured(actor, title) {
  const config = await openConfiguredD20RollDialog({ actor, title });
  if (!config) return null;
  if (config.useInspiration && !await consumeActorInspiration(actor)) return null;
  const roll = game.parovgrad.dice.createRoll(formula(config.mode, config.modifier), {}, { addExtraDie: config.useInspiration });
  await roll.evaluate();
  return { roll, config };
}
async function cleanup(templateDocument) {
  if (!templateDocument?.id || !templateDocument.parent) return;
  try { await templateDocument.parent.deleteEmbeddedDocuments("MeasuredTemplate", [templateDocument.id]); }
  catch (error) { console.warn("ParovGrad | Could not remove skill area template", error); ui.notifications?.warn("Не удалось удалить шаблон навыка."); }
}

export async function startMassSkillAttack({ actor, item }) {
  const placement = await placeSpellTemplate({ actor, item, targetTokens: true });
  if (!placement) return;
  const { templateDocument } = placement;
  const targets = placement.targets.map(token => token.document ?? token).filter(doc => doc?.actor);
  if (!targets.length) {
    ui.notifications?.warn("В области навыка нет целей.");
    await cleanup(templateDocument);
    return;
  }
  const attack = await rollConfigured(actor, `Массовая атака навыком: ${item.name}`);
  if (!attack) { await cleanup(templateDocument); return; }
  const state = {
    itemUuid: item.uuid, itemName: item.name, actorUuid: actor.uuid, actorName: actor.name,
    attackTotal: attack.roll.total, attackFormula: attack.roll.formula,
    hasEffect: !!String(item.system?.effectCheckDie || "").match(/^d(2|4|6|8|12|20|100)$/i) && !!item.system?.effectRanges?.length,
    targets: targets.map(doc => ({ uuid: doc.uuid, name: doc.name, defended: false, defenseTotal: null,
      hit: null, damage: null, applied: false, appliedAmount: null, effectChecked: false, effectTotal: null, effectText: "" }))
  };
  try {
    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: renderCard(state),
      rolls: [JSON.stringify(attack.roll.toJSON())], style: CONST.CHAT_MESSAGE_STYLES.ROLL,
      flags: { ParovGrad: { cardType: "mass-skill-attack", [FLAG]: state } } });
  } finally { await cleanup(templateDocument); }
}

/** Uses the same damage dialog and roll options as the single-target skill attack.
 * Returns false on cancellation, so the target retains its damage-roll button.
 */
async function rollTargetDamage(state, target) {
    const item = await fromUuid(state.itemUuid);
    const attacker = await fromUuid(state.actorUuid);
    const damageDie = item?.system?.damageDie;
    if (!damageDie) { ui.notifications?.warn("У навыка не задана кость урона."); return false; }
    const config = await openConfiguredDamageRollDialog({ title: `Урон навыка: ${state.itemName} — ${target.name}`, actor: attacker, damageDie });
    if (!config) return false;
    if (config.useInspiration && !await consumeActorInspiration(attacker)) return false;
    const roll = game.parovgrad.dice.createRoll(damageDie, {}, { addExtraDie: config.useInspiration });
    await roll.evaluate();
    target.damage = Math.max(0, Number(roll.total) || 0);
    return true;
}

async function performAction(message, action, i, half) {
  const state = foundry.utils.deepClone(message.getFlag("ParovGrad", FLAG));
  if (!state?.targets || !Number.isInteger(i) || i < 0 || i >= state.targets.length) return;
  const target = state.targets[i];
  const actor = tokenActor(target.uuid);
  if (!actor || !canManage(actor)) { ui.notifications?.warn("Недостаточно прав для управления этой целью."); return; }
  if (action === "mass-skill-defense") {
    if (target.defended) return;
    const result = await rollConfigured(actor, `Защита: ${target.name}`);
    if (!result) return;
    target.defended = true;
    target.defenseTotal = Number(result.roll.total);
    target.hit = Number(state.attackTotal) >= target.defenseTotal;
    // Commit defense before opening the next dialog, so cancelling it does not
    // discard the successful defense or block damage from being rolled later.
    await updateState(message, state);
    if (target.hit) {
      try {
        if (await rollTargetDamage(state, target)) await updateState(message, state);
      } catch (error) {
        console.error("ParovGrad | Skill damage roll after defense failed", error);
        ui.notifications?.error("Не удалось бросить урон навыка. Используйте кнопку «Урон» у цели.");
      }
    }
    return;
  } else if (action === "mass-skill-damage") {
    if (!target.defended || !target.hit || target.damage !== null) return;
    if (!await rollTargetDamage(state, target)) return;

  } else if (action === "mass-skill-effect") {
    if (!target.hit || target.damage === null || target.effectChecked || !state.hasEffect) return;
    const item = await fromUuid(state.itemUuid);
    const die = item?.system?.effectCheckDie;
    if (!/^d(2|4|6|8|12|20|100)$/i.test(die ?? "")) return;
    const roll = game.parovgrad.dice.createRoll(die, {}, { autoExplode: false });
    await roll.evaluate();
    target.effectChecked = true;
    target.effectTotal = Number(roll.total) || 0;
    target.effectText = (item.system.effectRanges ?? []).filter(r => target.effectTotal >= Number(r.from) && target.effectTotal <= Number(r.to)).map(r => r.effect).filter(Boolean).join(" · ");
  } else if (action === "mass-skill-apply") {
    if (target.damage === null || !target.hit || target.applied) return;
    const value = half ? Math.floor(target.damage / 2) : target.damage;
    const health = Number(actor.system?.health?.value) || 0;
    await actor.update({ "system.health.value": Math.max(0, health - value) });
    target.applied = true;
    target.appliedAmount = value;
  } else return;
  await updateState(message, state);
}

export function renderMassSkillChatButtons(message, html) {
  if (message.getFlag("ParovGrad", "cardType") !== "mass-skill-attack") return;
  for (const button of html.querySelectorAll('button[data-action^="mass-skill-"]')) {
    const action = button.dataset.action;
    const index = Number(button.dataset.target);
    const target = message.getFlag("ParovGrad", FLAG)?.targets?.[index];
    const actor = target ? tokenActor(target.uuid) : null;
    button.disabled = !canManage(actor);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      button.disabled = true;
      try { await performAction(message, action, index, button.dataset.half === "true"); }
      catch (error) { console.error("ParovGrad | Mass skill attack error", error); ui.notifications?.error("Ошибка обработки массовой атаки навыком."); button.disabled = false; }
    });
  }
}
