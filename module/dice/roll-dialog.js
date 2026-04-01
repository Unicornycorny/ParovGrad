export function getActorInspiration(actor) {
  return Math.max(Number(actor?.system?.inspiration) || 0, 0);
}

export async function consumeActorInspiration(actor, amount = 1) {
  if (!actor) return false;

  const normalizedAmount = Math.max(Number(amount) || 0, 0);
  if (!normalizedAmount) return true;

  const currentInspiration = getActorInspiration(actor);
  if (currentInspiration < normalizedAmount) {
    ui.notifications?.warn("Недостаточно вдохновения для добавления куба.");
    return false;
  }

  await actor.update({
    "system.inspiration": currentInspiration - normalizedAmount
  });

  return true;
}

export async function openConfiguredD20RollDialog({ title, actor } = {}) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: title ?? "Бросок" },
    modal: true,
    rejectClose: false,
    content: `
      <form class="pg-roll-dialog">
        <div class="pg-roll-dialog__field">
          <label for="pg-roll-modifier">Ручной модификатор</label>
          <input id="pg-roll-modifier" name="modifier" type="number" step="1" value="0" autofocus>
        </div>
        ${renderInspirationControl(actor, {
          inputName: "useInspiration",
          label: "Потратить 1 вдохновение на дополнительный куб"
        })}
        <p class="pg-roll-dialog__hint">Выберите вариант броска.</p>
      </form>
    `,
    buttons: [
      {
        action: "normal",
        label: "Обычный",
        callback: (event, button) => ({
          mode: "normal",
          modifier: Number(button.form?.elements?.modifier?.value) || 0,
          useInspiration: Boolean(button.form?.elements?.useInspiration?.checked)
        })
      },
      {
        action: "advantage",
        label: "Преимущество",
        callback: (event, button) => ({
          mode: "advantage",
          modifier: Number(button.form?.elements?.modifier?.value) || 0,
          useInspiration: Boolean(button.form?.elements?.useInspiration?.checked)
        })
      },
      {
        action: "disadvantage",
        label: "Помеха",
        callback: (event, button) => ({
          mode: "disadvantage",
          modifier: Number(button.form?.elements?.modifier?.value) || 0,
          useInspiration: Boolean(button.form?.elements?.useInspiration?.checked)
        })
      }
    ]
  });
}

export async function openConfiguredDamageRollDialog({ title, actor, damageDie } = {}) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: title ?? "Бросок урона" },
    modal: true,
    rejectClose: false,
    content: `
      <form class="pg-roll-dialog">
        <div class="pg-roll-dialog__field">
          <label>Кость урона</label>
          <div class="pg-roll-dialog__value">${String(damageDie ?? "").toUpperCase()}</div>
        </div>
        ${renderInspirationControl(actor, {
          inputName: "useInspiration",
          label: `Потратить 1 вдохновение на дополнительный куб ${String(damageDie ?? "куба").toUpperCase()}`
        })}
        <p class="pg-roll-dialog__hint">Подтвердите бросок урона.</p>
      </form>
    `,
    buttons: [
      {
        action: "roll",
        label: "Бросить урон",
        callback: (event, button) => ({
          useInspiration: Boolean(button.form?.elements?.useInspiration?.checked)
        })
      }
    ]
  });
}

function renderInspirationControl(actor, { inputName = "useInspiration", label } = {}) {
  const inspiration = getActorInspiration(actor);
  if (inspiration < 1) return "";

  return `
    <label class="pg-roll-dialog__checkbox">
      <input type="checkbox" name="${inputName}">
      <span>${label} (доступно: ${inspiration})</span>
    </label>
  `;
}