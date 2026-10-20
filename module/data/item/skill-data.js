const { StringField, NumberField, ArrayField, SchemaField, BooleanField } = foundry.data.fields;

export class SkillDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      template: new SchemaField({
        enabled: new BooleanField({
          required: true,
          initial: false
        }),
        type: new StringField({
          required: true,
          blank: false,
          initial: "circle",
          choices: ["circle", "cone", "ray", "rect"]
        }),
        distance: new NumberField({
          required: true,
          min: 0,
          initial: 0
        }),
        width: new NumberField({
          required: true,
          min: 0,
          initial: 0
        }),
        angle: new NumberField({
          required: true,
          min: 1,
          max: 360,
          initial: 90
        })
      }),

      damageDie: new StringField({ required: false, initial: "d4" }),
      cost: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      effectCheckDie: new StringField({ required: false, initial: "" }),
      effectRanges: new ArrayField(
        new SchemaField({
          from: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
          to: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
          effect: new StringField({ required: false, initial: "" })
        }),
        { required: true, initial: [] }
      )
    };
  }
}
