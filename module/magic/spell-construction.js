function asTrimmedString(value) {
  return String(value ?? "").trim();
}

function normalizeNodeIds(values) {
  if (!Array.isArray(values)) return [];

  const result = [];
  const seen = new Set();
  for (const value of values) {
    const id = asTrimmedString(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function getWorldMagicTrees() {
  return (game.items?.contents ?? [])
    .filter((item) => item?.type === "magicTree")
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export async function resolveMagicTree(uuid) {
  const normalizedUuid = asTrimmedString(uuid);
  if (!normalizedUuid) return null;

  try {
    const document = await fromUuid(normalizedUuid);
    return document?.documentName === "Item" && document?.type === "magicTree"
      ? document
      : null;
  } catch (error) {
    console.warn(`ParovGrad | Failed to resolve magic tree ${normalizedUuid}`, error);
    return null;
  }
}

export function getSpellConstruction(spell) {
  const construction = spell?.system?.construction ?? {};

  return {
    treeUuid: asTrimmedString(construction?.treeUuid),
    treeRevision: Math.max(0, Number(construction?.treeRevision) || 0),
    selectedNodeIds: normalizeNodeIds(construction?.selectedNodeIds)
  };
}

export function buildSpellConstruction(tree, selectedNodeIds) {
  return {
    treeUuid: asTrimmedString(tree?.uuid),
    treeRevision: Math.max(0, Number(tree?.system?.revision) || 0),
    selectedNodeIds: normalizeNodeIds(selectedNodeIds)
  };
}

export async function getSpellConstructionStatus(spell) {
  const construction = getSpellConstruction(spell);

  if (!construction.treeUuid) {
    return {
      hasConstruction: false,
      treeAvailable: false,
      outdated: false,
      treeName: "",
      currentTreeRevision: 0,
      ...construction
    };
  }

  const tree = await resolveMagicTree(construction.treeUuid);
  if (!tree) {
    return {
      hasConstruction: true,
      treeAvailable: false,
      outdated: false,
      treeName: "",
      currentTreeRevision: 0,
      ...construction
    };
  }

  const currentTreeRevision = Math.max(0, Number(tree.system?.revision) || 0);

  return {
    hasConstruction: true,
    treeAvailable: true,
    outdated: currentTreeRevision !== construction.treeRevision,
    treeName: tree.name || construction.treeUuid,
    currentTreeRevision,
    ...construction
  };
}
