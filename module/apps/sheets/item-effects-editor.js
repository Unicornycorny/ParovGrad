import {
  addEffectToItem,
  getItemEffectViews,
  openActorEffectDialog,
  resolveEffectSourceFromDropData
} from "../../effects/effect-utils.js";

export function prepareItemEffectsContext(sheet) {
  const item = sheet.document;
  const editing = Boolean(sheet.isEditable && sheet._isEditMode);
  return {
    equipped: Boolean(item.system?.equipped),
    // Wear state is a quick action, available in view mode for any item the user may change.
    canToggleEquipped: Boolean(sheet.isEditable),
    itemEffectGroups: [
      {
        application: "passive",
        label: "Пассивные эффекты",
        hint: "Действуют на носителя, пока предмет отмечен как надетый."
      },
      {
        application: "active",
        label: "Активные эффекты",
        hint: "Применяются к цели при использовании предмета."
      }
    ].map((group) => ({
      ...group,
      isEditable: editing,
      effects: getItemEffectViews(item, group.application).map((effect) => ({
        ...effect,
        isPassive: group.application === "passive"
      }))
    }))
  };
}

export function attachItemEffectsEditor(sheet, root) {
  const canEdit = () => Boolean(sheet.isEditable);
  const canConfigure = () => canEdit() && sheet._isEditMode;
  const run = async (work) => {
    try {
      await work();
    } catch (error) {
      console.error("ParovGrad | Failed to update item effects", error);
      ui.notifications?.error(error.message || "Не удалось изменить эффекты предмета.");
    }
  };

  root.querySelector(".pg-item-equipped")?.addEventListener("change", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit()) return;
    return run(() => sheet.document.update({ "system.equipped": Boolean(event.currentTarget.checked) }));
  });

  if (!canConfigure()) return;

  root.querySelectorAll("[data-item-effect-application]").forEach((group) => {
    const application = group.dataset.itemEffectApplication;
    group.addEventListener("dragover", (event) => {
      if (!canConfigure()) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    group.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canConfigure()) return;
      return run(async () => {
        const raw = event.dataTransfer?.getData("text/plain");
        let data;
        try {
          data = JSON.parse(raw || "null");
        } catch (_error) {
          ui.notifications?.warn("Перетащите сюда эффект из каталога или листа персонажа.");
          return;
        }
        const source = await resolveEffectSourceFromDropData(data);
        if (!source) {
          ui.notifications?.warn("К предмету можно привязать только эффект.");
          return;
        }
        if (!canConfigure()) return;
        if (source.document.parent?.uuid === sheet.document.uuid) {
          await source.document.update({ "flags.ParovGrad.itemApplication": application, transfer: false });
        } else {
          await addEffectToItem(sheet.document, source.document, application);
        }
      });
    });
    group.querySelector(".pg-item-effect-create")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canConfigure()) return;
      return run(async () => {
        await openActorEffectDialog({ actor: sheet.document, itemApplication: application });
      });
    });
  });

  root.querySelectorAll(".pg-item-effect-row").forEach((row) => {
    const getEffect = () => sheet.document.effects?.get(row.dataset.effectId);
    const listen = (selector, type, callback) => row.querySelector(selector)?.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canConfigure()) return;
      const effect = getEffect();
      if (effect) return run(() => callback(effect, event));
    });
    listen(".pg-item-effect-edit", "click", (effect) => openActorEffectDialog({ actor: sheet.document, effect }));
    listen(".pg-item-effect-toggle", "click", (effect) => effect.update({ disabled: !effect.disabled }));
    listen(".pg-item-effect-delete", "click", (effect) => sheet.document.deleteEmbeddedDocuments("ActiveEffect", [effect.id]));
    listen(".pg-item-effect-mode", "change", (effect, event) => effect.update({
      "flags.ParovGrad.itemApplication": event.currentTarget.value === "active" ? "active" : "passive",
      transfer: false
    }));
  });
}
