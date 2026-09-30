import {
  MAGIC_TREE_EDGE_TYPES,
  MAGIC_TREE_NODE_TYPES
} from "../../magic/magic-tree-constants.js";

const {
  ArrayField,
  NumberField,
  SchemaField,
  StringField,
  TypedObjectField
} = foundry.data.fields;

function createBranchField() {
  return new SchemaField({
    name: new StringField({ required: true, blank: false, initial: "Новая ветка" }),
    order: new NumberField({ required: true, integer: true, initial: 0 })
  });
}

function createMilestoneField() {
  return new SchemaField({
    name: new StringField({ required: true, blank: false, initial: "Новый этап" }),
    level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
    x: new NumberField({ required: true, initial: 0 })
  });
}

function createNodeField() {
  return new SchemaField({
    name: new StringField({ required: true, blank: false, initial: "Новый узел" }),
    description: new StringField({ required: false, initial: "" }),
    branchId: new StringField({ required: false, initial: "" }),
    level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
    type: new StringField({
      required: true,
      blank: false,
      initial: MAGIC_TREE_NODE_TYPES.INFLUENCE
    }),
    cost: new NumberField({ required: true, min: 0, initial: 0 }),
    position: new SchemaField({
      x: new NumberField({ required: true, initial: 0 }),
      y: new NumberField({ required: true, initial: 0 })
    }),
    output: new SchemaField({
      name: new StringField({ required: false, initial: "" }),
      value: new StringField({ required: false, initial: "" }),
      effectType: new StringField({ required: false, initial: "" })
    }),
    materials: new ArrayField(
      new StringField({ required: true, blank: false }),
      { required: true, initial: [] }
    )
  });
}

function createEdgeField() {
  return new SchemaField({
    from: new StringField({ required: true, blank: false }),
    to: new StringField({ required: true, blank: false }),
    type: new StringField({
      required: true,
      blank: false,
      initial: MAGIC_TREE_EDGE_TYPES.REQUIREMENT
    })
  });
}

export class MagicTreeDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      revision: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
      branches: new TypedObjectField(createBranchField(), {
        required: true,
        initial: {}
      }),
      milestones: new TypedObjectField(createMilestoneField(), {
        required: true,
        initial: {}
      }),
      nodes: new TypedObjectField(createNodeField(), {
        required: true,
        initial: {}
      }),
      edges: new TypedObjectField(createEdgeField(), {
        required: true,
        initial: {}
      })
    };
  }
}
