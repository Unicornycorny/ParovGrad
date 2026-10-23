import {DAMAGE_TYPES, DAMAGE_CATEGORIES, getItemDamageParts, applyTypedDamage} from "./damage/damage-types.js";
import { PlayerDataModel } from "./data/actor/player-data.js";
import { NpcDataModel } from "./data/actor/npc-data.js";
import { ItemDataModel } from "./data/item/item-data.js";
import { WeaponDataModel } from "./data/item/weapon-data.js";
import { SkillDataModel } from "./data/item/skill-data.js";
import { EffectDataModel } from "./data/item/effect-data.js";
import { SpellDataModel } from "./data/item/spell-data.js";
import { MagicTreeDataModel } from "./data/item/magic-tree-data.js";
import { SkillTreeDataModel } from "./data/item/skill-tree-data.js";

import { ParovGradPlayerSheet } from "./apps/sheets/actor-player-sheet.js";
import { ParovGradNpcSheet } from "./apps/sheets/actor-npc-sheet.js";
import { ParovGradItemSheet } from "./apps/sheets/item-sheet.js";
import { ParovGradWeaponSheet } from "./apps/sheets/weapon-sheet.js";
import { ParovGradSkillSheet } from "./apps/sheets/skill-sheet.js";
import { ParovGradEffectSheet } from "./apps/sheets/effect-sheet.js";
import { createParovgradRoll, rollToMessage } from "./dice/parovgrad-roll.js";
import { renderAttackChatButtons } from "./workflows/weapon-attack.js";
import { renderSpellChatButtons } from "./workflows/spell-use.js";
import { renderMassSkillChatButtons } from "./workflows/skill-area-attack.js";
import { handleCanvasEffectDrop, buildActorInfluenceState, migrateLegacyActorEffects } from "./effects/effect-utils.js";
import { ParovGradSpellSheet } from "./apps/sheets/spell-sheet.js";
import { ParovGradMagicTreeSheet } from "./apps/sheets/magic-tree-sheet.js";
import { ParovGradSkillTreeSheet } from "./apps/sheets/skill-tree-sheet.js";
import {
  getSpellTemplateConfig,
  getTargetsForSpellTemplate,
  hasSpellTemplate,
  placeSpellTemplate
} from "./canvas/spell-template.js";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels.Player = PlayerDataModel;
  CONFIG.Actor.dataModels.NPC = NpcDataModel;
  CONFIG.Item.dataModels.item = ItemDataModel;
  CONFIG.Item.dataModels.weapon = WeaponDataModel;
  CONFIG.Item.dataModels.skill = SkillDataModel;
  CONFIG.Item.dataModels.effect = EffectDataModel;
  CONFIG.Item.dataModels.spell = SpellDataModel;
  CONFIG.Item.dataModels.magicTree = MagicTreeDataModel;
  CONFIG.Item.dataModels.skillTree = SkillTreeDataModel;

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "ParovGrad", ParovGradPlayerSheet, {
    types: ["Player"],
    makeDefault: true
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "ParovGrad", ParovGradNpcSheet, {
    types: ["NPC"],
    makeDefault: true
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "ParovGrad", ParovGradItemSheet, {
    types: ["item"],
    makeDefault: true
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "ParovGrad", ParovGradWeaponSheet, {
    types: ["weapon"],
    makeDefault: true
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "ParovGrad", ParovGradSkillSheet, {
    types: ["skill"],
    makeDefault: true
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "ParovGrad", ParovGradEffectSheet, {
    types: ["effect"],
    makeDefault: true
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    Item,
    "ParovGrad",
    ParovGradSpellSheet,
    {
      types: ["spell"],
      makeDefault: true
    }
  );

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    Item,
    "ParovGrad",
    ParovGradMagicTreeSheet,
    {
      types: ["magicTree"],
      makeDefault: true
    }
  );

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    Item,
    "ParovGrad",
    ParovGradSkillTreeSheet,
    {
      types: ["skillTree"],
      makeDefault: true
    }
  );
});

Hooks.once("setup", () => {
  game.parovgrad = {
    ...(game.parovgrad ?? {}),
    dice: {
      createRoll: createParovgradRoll,
      rollToMessage
    },
    damage: {types: DAMAGE_TYPES, categories: DAMAGE_CATEGORIES, getItemDamageParts, applyTypedDamage},
    actors: {
      getDerivedHealthMax
    },
    spells: {
      getTemplateConfig: getSpellTemplateConfig,
      hasTemplate: hasSpellTemplate,
      placeTemplate: placeSpellTemplate,
      getTemplateTargets: getTargetsForSpellTemplate
    }
  };
});

// Protect all Actor types, including API-created embedded Items and token Actors.
const NON_EMBEDDABLE_ITEM_TYPES = new Set(["magicTree", "skillTree"]);

function getNonEmbeddableItemLabel(type) {
  if (type === "magicTree") return "Древо магии";
  if (type === "skillTree") return "Древо навыков";
  return "Эта сущность";
}

Hooks.on("preCreateItem", (item) => {
  if (item.parent?.documentName !== "Actor" || !NON_EMBEDDABLE_ITEM_TYPES.has(item.type)) return;
  const label = getNonEmbeddableItemLabel(item.type);
  ui.notifications.warn(`${label} нельзя хранить у актёра. Храните его в каталоге предметов мира.`);
  return false;
});

Hooks.on("preUpdateItem", (item, changed) => {
  if (item.parent?.documentName !== "Actor" || !NON_EMBEDDABLE_ITEM_TYPES.has(changed.type)) return;
  const label = getNonEmbeddableItemLabel(changed.type);
  ui.notifications.warn(`Нельзя преобразовать предмет актёра в сущность «${label}».`);
  return false;
});

Hooks.on("preCreateActor", (actor, data) => {
  const forbiddenItem = data.items?.find((item) => NON_EMBEDDABLE_ITEM_TYPES.has(item.type));
  if (forbiddenItem) {
    const label = getNonEmbeddableItemLabel(forbiddenItem.type);
    ui.notifications.warn(`Актёр содержит сущность «${label}». Уберите её из состава предметов перед импортом или копированием.`);
    return false;
  }
  if (actor.type !== "Player") return;
  applyDerivedHealthToSource(data);
});

Hooks.on("preUpdateActor", (actor, changed) => {
  const forbiddenItem = changed.items?.find((item) => NON_EMBEDDABLE_ITEM_TYPES.has(item.type));
  if (forbiddenItem) {
    const label = getNonEmbeddableItemLabel(forbiddenItem.type);
    ui.notifications.warn(`Сущность «${label}» нельзя добавить в состав предметов актёра.`);
    return false;
  }
  if (actor.type !== "Player") return;
  applyDerivedHealthToUpdate(actor, changed);
});


Hooks.once("ready", async () => {
  if (!game.user?.isGM) return;

  for (const actor of game.actors.contents) {
    try {
      await migrateLegacyActorEffects(actor);
    } catch (error) {
      console.error(`ParovGrad | Failed to migrate legacy effects for actor ${actor.name}`, error);
    }
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  renderAttackChatButtons(message, html);
  renderSpellChatButtons(message, html);
  renderMassSkillChatButtons(message, html);
});

Hooks.on("dropCanvasData", async (canvas, data, event) => {
  try {
    await handleCanvasEffectDrop(canvas, data, event);
  } catch (error) {
    console.error("ParovGrad | Failed to handle effect canvas drop", error);
    ui.notifications?.error("Не удалось применить эффект на токен.");
  }
});

function getDerivedHealthMax(source, influenceTotals = {}) {
  const constitution = Number(foundry.utils.getProperty(source, "system.stats.constitution")) || 0;
  const lifePath = Number(foundry.utils.getProperty(source, "system.lifePath")) || 0;
  const constitutionInfluence = Number(influenceTotals.constitution) || 0;
  const healthMaxInfluence = Number(influenceTotals.healthMax) || 0;
  const effectiveConstitution = constitution + constitutionInfluence;
  return Math.max(0, effectiveConstitution * lifePath + healthMaxInfluence);
}

function applyDerivedHealthToSource(source) {
  const derivedMax = getDerivedHealthMax(source);
  const currentValue = Number(foundry.utils.getProperty(source, "system.health.value"));
  const nextValue = Number.isFinite(currentValue) ? Math.min(Math.max(currentValue, 0), derivedMax) : derivedMax;

  foundry.utils.setProperty(source, "system.health.max", derivedMax);
  foundry.utils.setProperty(source, "system.health.value", nextValue);
}

function applyDerivedHealthToUpdate(actor, changed) {
  const merged = foundry.utils.mergeObject(actor.toObject(), changed, { inplace: false });
  const influenceTotals = buildActorInfluenceState(actor).totalsByTarget;
  const derivedMax = getDerivedHealthMax(merged, influenceTotals);

  foundry.utils.setProperty(changed, "system.health.max", derivedMax);

  const currentValue = Number(foundry.utils.getProperty(merged, "system.health.value"));
  if (!Number.isFinite(currentValue)) {
    foundry.utils.setProperty(changed, "system.health.value", derivedMax);
    return;
  }

  const clampedValue = Math.min(Math.max(currentValue, 0), derivedMax);
  foundry.utils.setProperty(changed, "system.health.value", clampedValue);
}
