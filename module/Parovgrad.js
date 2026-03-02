import { PlayerDataModel } from "./data/actor/player-data.js";
import { NpcDataModel } from "./data/actor/npc-data.js";
import { ItemDataModel } from "./data/item/item-data.js";

import { ParovGradPlayerSheet } from "./apps/sheets/actor-player-sheet.js";
import { ParovGradNpcSheet } from "./apps/sheets/actor-npc-sheet.js";
import { ParovGradItemSheet } from "./apps/sheets/item-sheet.js";

Hooks.once("init", () => {
  // 1) Регистрируем DataModels строго по ID типов (case-sensitive!)
  CONFIG.Actor.dataModels.Player = PlayerDataModel;
  CONFIG.Actor.dataModels.NPC = NpcDataModel;
  CONFIG.Item.dataModels.item = ItemDataModel;

  // 2) Регистрируем sheets (новый API)
  DocumentSheetConfig.registerSheet(Actor, "ParovGrad", ParovGradPlayerSheet, {
    types: ["Player"],
    makeDefault: true
  });

  DocumentSheetConfig.registerSheet(Actor, "ParovGrad", ParovGradNpcSheet, {
    types: ["NPC"],
    makeDefault: true
  });

  DocumentSheetConfig.registerSheet(Item, "ParovGrad", ParovGradItemSheet, {
    types: ["item"],
    makeDefault: true
  });
});