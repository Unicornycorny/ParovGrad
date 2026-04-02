import { PlayerDataModel } from "./data/actor/player-data.js";
import { NpcDataModel } from "./data/actor/npc-data.js";
import { ItemDataModel } from "./data/item/item-data.js";
import { WeaponDataModel } from "./data/item/weapon-data.js";

import { ParovGradPlayerSheet } from "./apps/sheets/actor-player-sheet.js";
import { ParovGradNpcSheet } from "./apps/sheets/actor-npc-sheet.js";
import { ParovGradItemSheet } from "./apps/sheets/item-sheet.js";
import { ParovGradWeaponSheet } from "./apps/sheets/weapon-sheet.js";
import { createParovgradRoll, rollToMessage } from "./dice/parovgrad-roll.js";
import { renderAttackChatButtons } from "./workflows/weapon-attack.js";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels.Player = PlayerDataModel;
  CONFIG.Actor.dataModels.NPC = NpcDataModel;
  CONFIG.Item.dataModels.item = ItemDataModel;
  CONFIG.Item.dataModels.weapon = WeaponDataModel;

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
});

Hooks.once("setup", () => {
  game.parovgrad = {
    ...(game.parovgrad ?? {}),
    dice: {
      createRoll: createParovgradRoll,
      rollToMessage
    },
    actors: {
      getDerivedHealthMax
    }
  };
});

Hooks.on("preCreateActor", (actor, data) => {
  if (actor.type !== "Player") return;
  applyDerivedHealthToSource(data);
});

Hooks.on("preUpdateActor", (actor, changed) => {
  if (actor.type !== "Player") return;
  applyDerivedHealthToUpdate(actor, changed);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  renderAttackChatButtons(message, html);
});

function getDerivedHealthMax(source) {
  const constitution = Number(foundry.utils.getProperty(source, "system.stats.constitution")) || 0;
  const lifePath = Number(foundry.utils.getProperty(source, "system.lifePath")) || 0;
  return Math.max(0, constitution * lifePath);
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
  const derivedMax = getDerivedHealthMax(merged);

  foundry.utils.setProperty(changed, "system.health.max", derivedMax);

  const currentValue = Number(foundry.utils.getProperty(merged, "system.health.value"));
  if (!Number.isFinite(currentValue)) {
    foundry.utils.setProperty(changed, "system.health.value", derivedMax);
    return;
  }

  const clampedValue = Math.min(Math.max(currentValue, 0), derivedMax);
  foundry.utils.setProperty(changed, "system.health.value", clampedValue);
}
