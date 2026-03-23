import { PlayerDataModel } from "./data/actor/player-data.js";
import { NpcDataModel } from "./data/actor/npc-data.js";
import { ItemDataModel } from "./data/item/item-data.js";
import { WeaponDataModel } from "./data/item/weapon-data.js";

import { ParovGradPlayerSheet } from "./apps/sheets/actor-player-sheet.js";
import { ParovGradNpcSheet } from "./apps/sheets/actor-npc-sheet.js";
import { ParovGradItemSheet } from "./apps/sheets/item-sheet.js";
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
    types: ["item", "weapon"],
    makeDefault: true
  });
});

Hooks.once("setup", () => {
  game.parovgrad = {
    ...(game.parovgrad ?? {}),
    dice: {
      createRoll: createParovgradRoll,
      rollToMessage
    }
  };
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  renderAttackChatButtons(message, html);
});
