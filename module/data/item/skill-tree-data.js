const {
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
    skillUuid: new StringField({ required: true, blank: false }),
    branchId: new StringField({ required: false, initial: "" }),
    level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
    position: new SchemaField({
      x: new NumberField({ required: true, initial: 0 }),
      y: new NumberField({ required: true, initial: 0 })
    })
  });
}

function createEdgeField() {
  return new SchemaField({
    from: new StringField({ required: true, blank: false }),
    to: new StringField({ required: true, blank: false }),
    type: new StringField({ required: true, blank: false, initial: "requirement" })
  });
}

export class SkillTreeDataModel extends foundry.abstract.TypeDataModel {
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
