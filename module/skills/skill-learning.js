/** Shared skill identity, progression rules and purchase flow. */
const learningActors = new Set();

export function canObserveDocument(document) {
  if (!document) return false;
  if (game.user?.isGM) return true;
  if (document.compendium && !document.compendium.visible) return false;
  return Boolean(document.testUserPermission?.(game.user, "OBSERVER"));
}

export function getSkillSourceKey(skill) {
  let pack = skill?.pack ?? skill?.compendium?.collection;
  const uuid = String(skill?.uuid ?? "");
  if (!pack && uuid.startsWith("Compendium.")) {
    const parts = uuid.slice(11).split(".");
    parts.pop();
    if (parts.at(-1) === "Item") parts.pop();
    pack = parts.join(".");
  }
  return pack && skill?.id ? `${pack}:${skill.id}` : uuid;
}

function sourceReferences(skill) {
  return new Set([
    skill?.uuid,
    getSkillSourceKey(skill),
    skill?.flags?.ParovGrad?.sourceSkillUuid,
    skill?.flags?.ParovGrad?.sourceSkillKey,
    skill?.flags?.ParovGrad?.skillTreeSourceUuid,
    skill?.flags?.core?.sourceId,
    skill?._stats?.compendiumSource,
    ...(Array.isArray(skill?.flags?.ParovGrad?.sourceSkillReferences) ? skill.flags.ParovGrad.sourceSkillReferences : [])
  ].filter(Boolean).map(String));
}

export function isKnownSkill(actor, skill) {
  const sources = sourceReferences(skill);
  return Array.from(actor?.items ?? []).some((item) => item.type === "skill" &&
    [...sourceReferences(item)].some((source) => sources.has(source)));
}

export function createOwnedSkillSource(skill, { treeUuid = "", nodeId = "", sourceSkillKey = getSkillSourceKey(skill) } = {}) {
  const data = skill.toObject();
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  data.flags ??= {};
  data.flags.core = { ...data.flags.core, sourceId: skill._stats?.compendiumSource || skill.flags?.core?.sourceId || skill.uuid };
  data.flags.ParovGrad = {
    ...data.flags.ParovGrad,
    sourceSkillUuid: skill.uuid,
    sourceSkillKey,
    sourceSkillReferences: [...sourceReferences(skill)]
  };
  if (treeUuid) {
    data.flags.ParovGrad.skillTreeSourceUuid = skill.uuid;
    data.flags.ParovGrad.skillTreeUuid = treeUuid;
    data.flags.ParovGrad.skillTreeNodeId = nodeId;
  }
  return data;
}

export async function resolveAccessibleSkill(uuid) {
  if (!uuid) return null;
  try {
    const item = await foundry.utils.fromUuid(uuid);
    return item?.documentName === "Item" && item.type === "skill" &&
      item.parent?.documentName !== "Actor" && canObserveDocument(item) ? item : null;
  } catch (error) {
    console.warn("ParovGrad | Cannot resolve an accessible skill", error);
    return null;
  }
}

/** No names from inaccessible source documents are returned to the UI. */
export function getSkillNodeLearningState({ actor, tree, nodeId, resolvedSkills }) {
  const nodes = tree?.system?.nodes ?? {};
  const edges = Object.values(tree?.system?.edges ?? {});
  const node = nodes[nodeId];
  const skill = node ? resolvedSkills.get(String(node.skillUuid ?? "")) ?? null : null;
  const known = Boolean(skill && isKnownSkill(actor, skill));
  const reasons = [];
  const requiredSkills = [];
  const cost = Number(skill?.system?.cost ?? 0);

  if (!node) reasons.push("Узел больше не находится в древе.");
  if (!skill) reasons.push("Исходный навык недоступен.");
  if (!actor?.isOwner) reasons.push("Недостаточно прав для изменения персонажа.");
  if (tree?.documentName !== "Item" || tree.type !== "skillTree" || tree.parent?.documentName === "Actor") reasons.push("Выбрано некорректное древо навыков.");
  if (!canObserveDocument(tree)) reasons.push("Древо недоступно для просмотра.");
  if (known) reasons.push("Навык уже изучен.");
  if (!Number.isSafeInteger(cost) || cost < 0) reasons.push("У навыка указана некорректная стоимость изучения.");

  const level = Number(node?.level ?? 0);
  const points = Number(actor?.system?.skillPoints ?? 0);
  if (!Number.isSafeInteger(points) || points < 0) reasons.push("У персонажа указано некорректное количество очков навыков.");
  if (!Number.isSafeInteger(level) || level < 0) reasons.push("У узла указан некорректный уровень.");
  else if (Number(actor?.system?.level ?? 0) < level) reasons.push(`Требуется ${level} уровень персонажа.`);
  if (points < cost) reasons.push(`Недостаточно очков навыков: требуется ${cost}.`);

  // Walk all ancestors as well: a damaged or cyclic requirement graph must not
  // unlock a skill simply because one immediate prerequisite happens to be owned.
  const visiting = new Set();
  const visited = new Set();
  let invalidGraph = false;
  function visit(id) {
    if (visiting.has(id)) { invalidGraph = true; return; }
    if (visited.has(id)) return;
    if (!nodes[id]) { invalidGraph = true; return; }
    visiting.add(id);
    for (const edge of edges.filter((entry) => entry.to === id)) {
      if (!nodes[edge.from]) { invalidGraph = true; continue; }
      const prerequisite = resolvedSkills.get(String(nodes[edge.from].skillUuid ?? "")) ?? null;
      if (!prerequisite) invalidGraph = true;
      visit(edge.from);
    }
    visiting.delete(id);
    visited.add(id);
  }
  if (node) visit(nodeId);
  if (invalidGraph) reasons.push("Требования древа повреждены, содержат цикл или недоступный навык. Обратитесь к ведущему.");

  const prerequisiteIds = new Set(edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from));
  for (const id of prerequisiteIds) {
    const prerequisite = nodes[id] ? resolvedSkills.get(String(nodes[id].skillUuid ?? "")) ?? null : null;
    const entry = { nodeId: id, name: prerequisite?.name ?? "Недоступный навык", known: Boolean(prerequisite && isKnownSkill(actor, prerequisite)) };
    requiredSkills.push(entry);
    if (!entry.known) reasons.push(`Сначала изучите: ${entry.name}.`);
  }
  return { skill, known, cost, requiredSkills, reasons, available: reasons.length === 0, locked: !known && reasons.length > 0 };
}

export function isActorLearningSkill(actor) {
  return learningActors.has(actor.uuid ?? actor);
}

/** All local skill purchase entry points share this lock, acquired before awaits. */
export async function withActorSkillLock(actor, callback) {
  const lockKey = actor?.uuid ?? actor;
  if (learningActors.has(lockKey)) throw new Error("Дождитесь завершения текущего изучения навыка.");
  learningActors.add(lockKey);
  try {
    return await callback();
  } finally {
    learningActors.delete(lockKey);
    try { globalThis.Hooks?.callAll?.("parovgradSkillLearningComplete", actor); }
    catch (error) { console.warn("ParovGrad | Could not refresh skill learning windows", error); }
  }
}

export async function learnSkillFromTree({ actor, tree, nodeId }) {
  if (!actor || actor.type !== "Player" || !actor.isOwner) throw new Error("Недостаточно прав для изучения навыков персонажа.");
  return withActorSkillLock(actor, async () => {
    const uuids = [...new Set(Object.values(tree?.system?.nodes ?? {}).map((node) => String(node.skillUuid ?? "")).filter(Boolean))];
    const resolvedSkills = new Map(await Promise.all(uuids.map(async (uuid) => [uuid, await resolveAccessibleSkill(uuid)])));
    const state = getSkillNodeLearningState({ actor, tree, nodeId, resolvedSkills });
    if (!state.available) throw new Error(state.reasons[0]);
    const pointsBefore = Number(actor.system.skillPoints ?? 0);
    const source = createOwnedSkillSource(state.skill, { treeUuid: tree.uuid, nodeId });
    const transactionId = foundry.utils.randomID();
    source.flags.ParovGrad.skillLearningTransactionId = transactionId;
    const refund = async () => {
      const refundedPoints = Number(actor.system.skillPoints ?? 0) + state.cost;
      try { await actor.update({ "system.skillPoints": refundedPoints }); }
      catch (error) { if (Number(actor.system.skillPoints) !== refundedPoints) throw error; }
      if (Number(actor.system.skillPoints) !== refundedPoints) throw new Error("Возврат очков навыков был отменён.");
    };
    // Charge first so a failed debit never grants a free skill. Restore the exact
    // debit if Foundry rejects embedded creation; no document is deleted on failure.
    if (state.cost) {
      try {
        await actor.update({ "system.skillPoints": pointsBefore - state.cost });
        if (Number(actor.system.skillPoints) !== pointsBefore - state.cost) throw new Error("Не удалось списать очки навыков.");
      } catch (error) {
        if (Number(actor.system.skillPoints) === pointsBefore - state.cost) {
          try { await refund(); }
          catch (refundError) {
            console.error("ParovGrad | Failed to refund a rejected debit", refundError);
            throw new Error(`Навык не создан. Не удалось вернуть ${state.cost} очк. навыков — обратитесь к ведущему.`);
          }
        }
        throw error;
      }
    }
    let created;
    try {
      created = await actor.createEmbeddedDocuments("Item", [source]);
      if (!created?.length) throw new Error("Создание навыка было отменено.");
    } catch (error) {
      // A server/hook error can arrive after persistence. Observe the unique
      // purchase marker before refunding so a persisted skill is never free.
      const persisted = Array.from(actor.items).find((item) => item.flags?.ParovGrad?.skillLearningTransactionId === transactionId);
      if (persisted) return { created: [persisted], cost: state.cost };
      if (state.cost) {
        try {
          await refund();
        } catch (refundError) {
          console.error("ParovGrad | Failed to refund skill points", refundError);
          throw new Error(`Навык не создан. Не удалось вернуть ${state.cost} очк. навыков — обратитесь к ведущему.`);
        }
      }
      throw error;
    }
    return { created, cost: state.cost };
  });
}
