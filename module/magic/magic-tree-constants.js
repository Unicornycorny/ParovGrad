export const MAGIC_TREE_NODE_TYPES = Object.freeze({
  RANGE: "range",
  SHAPE: "shape",
  INFLUENCE: "influence",
  MODIFIER: "modifier"
});

export const MAGIC_TREE_NODE_TYPE_LABELS = Object.freeze({
  [MAGIC_TREE_NODE_TYPES.RANGE]: "Дальность",
  [MAGIC_TREE_NODE_TYPES.SHAPE]: "Форма",
  [MAGIC_TREE_NODE_TYPES.INFLUENCE]: "Влияние",
  [MAGIC_TREE_NODE_TYPES.MODIFIER]: "Модификатор"
});

export const MAGIC_TREE_EDGE_TYPES = Object.freeze({
  REQUIREMENT: "requirement"
});
