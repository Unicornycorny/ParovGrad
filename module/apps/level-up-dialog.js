const ROOT_FOLDER_ID = "__root__";

const SKILL_POINTS_BY_LEVEL = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2,
  7: 2,
  8: 3,
  9: 3,
  10: 3,
  11: 3,
  12: 4,
  13: 4,
  14: 4,
  15: 4,
  16: 5,
  17: 5,
  18: 5,
  19: 5,
  20: 5,
  21: 5,
  22: 5,
  23: 5,
  24: 5,
  25: 5
};

export async function openActorLevelUpDialog(actor) {
  const currentLevel = Number(actor.system?.level) || 0;
  const nextLevel = currentLevel + 1;
  const gainedSkillPoints = getSkillPointsForLevel(nextLevel);

  if (gainedSkillPoints === null) {
    ui.notifications?.warn(`Для уровня ${nextLevel} не задано количество очков навыков.`);
    return;
  }

  const currentSkillPoints = Number(actor.system?.skillPoints) || 0;
  const totalSkillPoints = currentSkillPoints + gainedSkillPoints;

  const proceed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Повышение уровня" },
    modal: true,
    rejectClose: false,
    ok: {
      label: "Далее"
    },
    cancel: {
      label: "Отмена"
    },
    content: `
      <div class="pg-level-up-dialog">
        <p>Персонаж перейдёт с уровня <strong>${currentLevel}</strong> на уровень <strong>${nextLevel}</strong>.</p>
        <p>За этот уровень персонаж получает <strong>${gainedSkillPoints}</strong> ${pluralizeSkillPoints(gainedSkillPoints)}.</p>
        <p>Сейчас у персонажа <strong>${currentSkillPoints}</strong> ${pluralizeSkillPoints(currentSkillPoints)}, после повышения будет <strong>${totalSkillPoints}</strong>.</p>
      </div>
    `
  });

  if (!proceed) return;

  const catalogue = await loadSkillCompendiumCatalogue(actor);
  const selection = await openSkillPurchaseDialog({
    actor,
    catalogue,
    currentLevel,
    nextLevel,
    gainedSkillPoints,
    totalSkillPoints
  });

  if (!selection) return;

  const updates = {
    "system.level": nextLevel,
    "system.skillPoints": totalSkillPoints - selection.totalSpent
  };

  if (selection.skillSources.length) {
    await actor.createEmbeddedDocuments("Item", selection.skillSources);
  }

  await actor.update(updates);

  ui.notifications?.info(
    selection.skillSources.length
      ? `Уровень персонажа повышен до ${nextLevel}. Куплено навыков: ${selection.skillSources.length}.`
      : `Уровень персонажа повышен до ${nextLevel}. Очки навыков начислены.`
  );
}

function getSkillPointsForLevel(level) {
  return SKILL_POINTS_BY_LEVEL[level] ?? null;
}

async function openSkillPurchaseDialog({ actor, catalogue, currentLevel, nextLevel, gainedSkillPoints, totalSkillPoints }) {
  const rows = [];
  const canChooseSkills = catalogue.packs.length > 0;

  if (canChooseSkills) {
    rows.push(createEmptyRow(catalogue));
  }

  return foundry.applications.api.DialogV2.wait({
    window: { title: "Повышение уровня: покупка навыков" },
    modal: true,
    rejectClose: false,
    content: '<div class="pg-level-up-root"></div>',
    buttons: [
      {
        action: "confirm",
        label: "Завершить повышение",
        callback: () => buildDialogResult(actor, catalogue, rows, totalSkillPoints)
      },
      {
        action: "cancel",
        label: "Отмена"
      }
    ],
    render: (_event, dialog) => {
      const root = dialog.element.querySelector(".pg-level-up-root");
      if (!root) return;

      const rerender = () => {
        const summary = summarizeSelection(actor, catalogue, rows, totalSkillPoints);
        root.innerHTML = renderPurchaseStepContent({
          currentLevel,
          nextLevel,
          gainedSkillPoints,
          totalSkillPoints,
          catalogue,
          rows,
          summary
        });

        bindPurchaseStepListeners({
          actor,
          dialog,
          catalogue,
          rows,
          totalSkillPoints,
          rerender
        });
      };

      rerender();
    }
  });
}

function bindPurchaseStepListeners({ actor, dialog, catalogue, rows, totalSkillPoints, rerender }) {
  dialog.element.querySelector("[data-level-up-action='add-row']")?.addEventListener("click", (event) => {
    event.preventDefault();
    rows.push(createEmptyRow(catalogue, rows.at(-1)?.packId ?? null));
    rerender();
  });

  dialog.element.querySelector("[data-level-up-action='remove-row']")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!rows.length) return;
    rows.pop();
    rerender();
  });

  dialog.element.querySelectorAll(".pg-level-up-purchase-row").forEach((rowElement) => {
    const rowId = rowElement.dataset.rowId;
    const rowState = rows.find((row) => row.id === rowId);
    if (!rowState) return;

    rowElement.querySelector("[data-field='packId']")?.addEventListener("change", (event) => {
      const packId = event.currentTarget.value;
      applyPackSelection(catalogue, rowState, packId);
      rerender();
    });

    rowElement.querySelector("[data-field='folderId']")?.addEventListener("change", (event) => {
      const folderId = event.currentTarget.value;
      applyFolderSelection(catalogue, rowState, folderId);
      rerender();
    });

    rowElement.querySelector("[data-field='skillId']")?.addEventListener("change", (event) => {
      rowState.skillId = event.currentTarget.value || "";
      rerender();
    });
  });

  const summary = summarizeSelection(actor, catalogue, rows, totalSkillPoints);
  const confirmButton = dialog.element.querySelector("button[data-action='confirm']");
  if (confirmButton instanceof HTMLButtonElement) {
    confirmButton.disabled = summary.errors.length > 0;
    confirmButton.title = summary.errors.join("\n");
  }
}

function renderPurchaseStepContent({ currentLevel, nextLevel, gainedSkillPoints, totalSkillPoints, catalogue, rows, summary }) {
  const rowsHtml = rows.length
    ? rows.map((row) => renderPurchaseRow(catalogue, row, summary.selectedSkillMap)).join("")
    : '<div class="pg-effect-modifier-empty">Навыки пока не выбраны. Можно завершить повышение уровня без покупки навыков.</div>';

  const errorHtml = summary.errors.length
    ? `
      <div class="pg-level-up-errors">
        ${summary.errors.map((message) => `<div class="pg-level-up-errors__item">${escapeHtml(message)}</div>`).join("")}
      </div>
    `
    : "";

  const noPacksHtml = catalogue.packs.length
    ? ""
    : '<p class="pg-form-hint">Доступных навыков в видимых компендиумах не найдено. Уровень можно повысить только с начислением очков навыков.</p>';

  return `
    <div class="pg-level-up-dialog">
      <p>Повышение с уровня <strong>${currentLevel}</strong> до уровня <strong>${nextLevel}</strong>.</p>
      <p>Получено очков навыков: <strong>${gainedSkillPoints}</strong>. Всего доступно для траты сейчас: <strong>${totalSkillPoints}</strong>.</p>

      <div class="pg-level-up-summary-grid">
        <div class="pg-level-up-summary-card">
          <div class="pg-level-up-summary-card__label">Доступно</div>
          <div class="pg-level-up-summary-card__value">${totalSkillPoints}</div>
        </div>
        <div class="pg-level-up-summary-card">
          <div class="pg-level-up-summary-card__label">Выбрано</div>
          <div class="pg-level-up-summary-card__value">${summary.totalSpent}</div>
        </div>
        <div class="pg-level-up-summary-card">
          <div class="pg-level-up-summary-card__label">Останется</div>
          <div class="pg-level-up-summary-card__value">${summary.remainingPoints}</div>
        </div>
      </div>

      ${noPacksHtml}

      <div class="pg-level-up-toolbar">
        <button type="button" data-level-up-action="add-row" ${catalogue.packs.length ? "" : "disabled"}>+</button>
        <button type="button" data-level-up-action="remove-row" ${rows.length ? "" : "disabled"}>-</button>
      </div>

      <div class="pg-level-up-row-list">
        ${rowsHtml}
      </div>

      ${errorHtml}
    </div>
  `;
}

function renderPurchaseRow(catalogue, row, selectedSkillMap) {
  const pack = getPackState(catalogue, row.packId);
  const folders = pack?.folders ?? [];
  const folder = getFolderState(catalogue, row.packId, row.folderId) ?? folders[0] ?? null;
  const skillOptions = folder?.skills ?? [];
  const selectedSkill = getSelectedSkill(catalogue, row) ?? null;
  const selectedSkillKey = selectedSkill ? buildSkillKey(row.packId, selectedSkill.id) : null;
  const isDuplicate = selectedSkillKey ? selectedSkillMap.get(selectedSkillKey) > 1 : false;

  return `
    <div class="pg-level-up-purchase-row" data-row-id="${row.id}">
      <div class="pg-form-field">
        <label>Компендиум</label>
        <select data-field="packId">
          ${catalogue.packs.map((entry) => `
            <option value="${escapeHtml(entry.id)}" ${entry.id === row.packId ? "selected" : ""}>${escapeHtml(entry.title)}</option>
          `).join("")}
        </select>
      </div>

      <div class="pg-form-field">
        <label>Папка</label>
        <select data-field="folderId" ${folders.length ? "" : "disabled"}>
          ${folders.map((entry) => `
            <option value="${escapeHtml(entry.id)}" ${entry.id === row.folderId ? "selected" : ""}>${escapeHtml(entry.name)}</option>
          `).join("")}
        </select>
      </div>

      <div class="pg-form-field">
        <label>Навык</label>
        <select data-field="skillId" ${skillOptions.length ? "" : "disabled"}>
          <option value="">— не выбран —</option>
          ${skillOptions.map((entry) => `
            <option value="${escapeHtml(entry.id)}" ${entry.id === row.skillId ? "selected" : ""}>${escapeHtml(entry.name)} (${entry.cost})</option>
          `).join("")}
        </select>
      </div>

      <div class="pg-level-up-purchase-meta">
        <span>Стоимость: <strong>${selectedSkill?.cost ?? 0}</strong></span>
        ${selectedSkill?.alreadyOwned ? '<span class="pg-level-up-purchase-warning">Уже есть у персонажа</span>' : ""}
        ${isDuplicate ? '<span class="pg-level-up-purchase-warning">Навык выбран повторно</span>' : ""}
      </div>
    </div>
  `;
}

function summarizeSelection(actor, catalogue, rows, totalSkillPoints) {
  const selectedSkills = rows
    .map((row) => getSelectedSkill(catalogue, row))
    .filter(Boolean);

  const selectedSkillMap = new Map();
  for (const skill of selectedSkills) {
    selectedSkillMap.set(skill.key, (selectedSkillMap.get(skill.key) ?? 0) + 1);
  }

  const totalSpent = selectedSkills.reduce((sum, skill) => sum + skill.cost, 0);
  const remainingPoints = totalSkillPoints - totalSpent;

  const errors = [];
  if (remainingPoints < 0) {
    errors.push("Недостаточно очков навыков для покупки выбранных навыков.");
  }

  if (selectedSkills.some((skill) => skill.alreadyOwned)) {
    errors.push("Среди выбранных навыков есть навык, который уже есть у персонажа.");
  }

  if (Array.from(selectedSkillMap.values()).some((count) => count > 1)) {
    errors.push("Один и тот же навык нельзя выбрать несколько раз в рамках одного повышения уровня.");
  }

  return {
    totalSpent,
    remainingPoints,
    selectedSkills,
    selectedSkillMap,
    errors
  };
}

function buildDialogResult(actor, catalogue, rows, totalSkillPoints) {
  const summary = summarizeSelection(actor, catalogue, rows, totalSkillPoints);
  if (summary.errors.length) {
    ui.notifications?.warn(summary.errors[0]);
    return null;
  }

  return {
    totalSpent: summary.totalSpent,
    skillSources: summary.selectedSkills.map((skill) => buildOwnedSkillSource(skill.document, skill.key))
  };
}

async function loadSkillCompendiumCatalogue(actor) {
  const ownedSkillKeys = new Set();
  const ownedSkillNames = new Set();

  for (const item of actor.items.filter((entry) => entry.type === "skill")) {
    const storedKey = item.getFlag("ParovGrad", "sourceSkillKey");
    if (storedKey) ownedSkillKeys.add(String(storedKey));
    if (item.name) ownedSkillNames.add(String(item.name).trim().toLocaleLowerCase("ru"));
  }

  const packs = Array.from(game.packs)
    .filter((pack) => pack.documentName === "Item" && pack.visible)
    .sort((left, right) => left.title.localeCompare(right.title, "ru"));

  const catalogue = {
    packs: [],
    skillLookup: new Map()
  };

  for (const pack of packs) {
    let documents = [];

    try {
      documents = await pack.getDocuments({ type: "skill" });
    } catch (error) {
      console.error(`ParovGrad | Failed to load skills from compendium ${pack.collection}`, error);
      continue;
    }

    const skills = documents.filter((entry) => entry.type === "skill");
    if (!skills.length) continue;

    const folders = new Map();

    for (const document of skills) {
      const folderId = document.folder?.id ?? ROOT_FOLDER_ID;
      const skillKey = buildSkillKey(pack.collection, document.id);
      const alreadyOwned = ownedSkillKeys.has(skillKey)
        || ownedSkillNames.has(String(document.name).trim().toLocaleLowerCase("ru"));

      if (!folders.has(folderId)) {
        folders.set(folderId, {
          id: folderId,
          name: document.folder ? buildFolderPath(document.folder) : "Без папки",
          skills: []
        });
      }

      const skillEntry = {
        id: document.id,
        key: skillKey,
        name: document.name,
        cost: Math.max(0, Number(document.system?.cost) || 0),
        document,
        alreadyOwned
      };

      folders.get(folderId).skills.push(skillEntry);
      catalogue.skillLookup.set(skillKey, skillEntry);
    }

    const packEntry = {
      id: pack.collection,
      title: pack.title,
      folders: Array.from(folders.values())
        .map((folder) => ({
          ...folder,
          skills: folder.skills.sort((left, right) => left.name.localeCompare(right.name, "ru"))
        }))
        .sort((left, right) => {
          if (left.id === ROOT_FOLDER_ID) return -1;
          if (right.id === ROOT_FOLDER_ID) return 1;
          return left.name.localeCompare(right.name, "ru");
        })
    };

    catalogue.packs.push(packEntry);
  }

  return catalogue;
}

function createEmptyRow(catalogue, preferredPackId = null) {
  const preferredPack = preferredPackId ? getPackState(catalogue, preferredPackId) : null;
  const pack = preferredPack ?? catalogue.packs[0] ?? null;
  const folder = pack?.folders[0] ?? null;

  return {
    id: foundry.utils.randomID(),
    packId: pack?.id ?? "",
    folderId: folder?.id ?? ROOT_FOLDER_ID,
    skillId: ""
  };
}

function applyPackSelection(catalogue, row, packId) {
  row.packId = packId;

  const pack = getPackState(catalogue, packId);
  const nextFolder = pack?.folders[0] ?? null;

  row.folderId = nextFolder?.id ?? ROOT_FOLDER_ID;
  row.skillId = "";
}

function applyFolderSelection(catalogue, row, folderId) {
  row.folderId = folderId;
  row.skillId = "";

  const folder = getFolderState(catalogue, row.packId, folderId);
  if (!folder) {
    const pack = getPackState(catalogue, row.packId);
    row.folderId = pack?.folders[0]?.id ?? ROOT_FOLDER_ID;
  }
}

function getSelectedSkill(catalogue, row) {
  if (!row.packId || !row.skillId) return null;
  return catalogue.skillLookup.get(buildSkillKey(row.packId, row.skillId)) ?? null;
}

function getPackState(catalogue, packId) {
  return catalogue.packs.find((entry) => entry.id === packId) ?? null;
}

function getFolderState(catalogue, packId, folderId) {
  return getPackState(catalogue, packId)?.folders.find((entry) => entry.id === folderId) ?? null;
}

function buildSkillKey(packId, skillId) {
  return `${packId}:${skillId}`;
}

function buildFolderPath(folder) {
  const names = [...folder.ancestors].reverse().map((entry) => entry.name);
  names.push(folder.name);
  return names.join(" / ");
}

function buildOwnedSkillSource(document, sourceSkillKey) {
  const source = document.toObject();
  delete source._id;
  delete source.folder;
  delete source.sort;

  source.flags = foundry.utils.mergeObject(
    foundry.utils.deepClone(source.flags ?? {}),
    {
      core: {
        sourceId: document.uuid
      },
      ParovGrad: {
        sourceSkillKey,
        sourceSkillUuid: document.uuid
      }
    },
    { inplace: false }
  );

  return source;
}

function pluralizeSkillPoints(value) {
  const amount = Math.abs(Number(value)) % 100;
  const remainder = amount % 10;

  if (amount > 10 && amount < 20) return "очков навыков";
  if (remainder > 1 && remainder < 5) return "очка навыков";
  if (remainder === 1) return "очко навыков";
  return "очков навыков";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}