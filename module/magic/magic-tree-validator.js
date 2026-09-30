import {
  MAGIC_TREE_NODE_TYPE_LABELS,
  MAGIC_TREE_NODE_TYPES
} from "./magic-tree-constants.js";

const VALID_NODE_TYPES = new Set(Object.values(MAGIC_TREE_NODE_TYPES));

function hasDirectedCycle(nodes, edges) {
  const adjacency = new Map(Object.keys(nodes).map((nodeId) => [nodeId, []]));

  for (const edge of Object.values(edges)) {
    if (!adjacency.has(edge?.from) || !adjacency.has(edge?.to)) continue;
    adjacency.get(edge.from).push(edge.to);
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(nodeId) {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visiting.add(nodeId);

    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (visit(nextId)) return true;
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  for (const nodeId of adjacency.keys()) {
    if (visit(nodeId)) return true;
  }

  return false;
}

export function validateMagicTreeStructure(system) {
  const branches = system?.branches ?? {};
  const nodes = system?.nodes ?? {};
  const edges = system?.edges ?? {};
  const errors = [];
  const warnings = [];

  for (const [nodeId, node] of Object.entries(nodes)) {
    const branchId = String(node?.branchId ?? "").trim();
    const type = String(node?.type ?? "").trim();

    if (!branchId) {
      warnings.push(`Узел «${node?.name || nodeId}» не привязан к ветке.`);
    } else if (!Object.hasOwn(branches, branchId)) {
      errors.push(`Узел «${node?.name || nodeId}» ссылается на отсутствующую ветку «${branchId}».`);
    }

    if (!VALID_NODE_TYPES.has(type)) {
      errors.push(`Узел «${node?.name || nodeId}» имеет неизвестный тип «${type || "—"}».`);
    }
  }

  for (const [edgeId, edge] of Object.entries(edges)) {
    const from = String(edge?.from ?? "").trim();
    const to = String(edge?.to ?? "").trim();

    if (!Object.hasOwn(nodes, from)) {
      errors.push(`Связь «${edgeId}» начинается в отсутствующем узле «${from || "—"}».`);
    }

    if (!Object.hasOwn(nodes, to)) {
      errors.push(`Связь «${edgeId}» заканчивается в отсутствующем узле «${to || "—"}».`);
    }

    if (from && from === to) {
      errors.push(`Связь «${edgeId}» замыкает узел на самого себя.`);
    }
  }

  if (hasDirectedCycle(nodes, edges)) {
    errors.push("В требованиях дерева обнаружен цикл. Прогрессия должна оставаться направленной без возврата к предыдущим узлам.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeTypeLabels: MAGIC_TREE_NODE_TYPE_LABELS
  };
}
