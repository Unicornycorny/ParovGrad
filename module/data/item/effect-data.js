const { StringField, NumberField, ArrayField, SchemaField } = foundry.data.fields;

export class EffectDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
      effectType: new StringField({ required: false, initial: "" }),
      impact: new StringField({ required: false, initial: "" }),
      removal: new StringField({ required: false, initial: "" }),
      modifiers: new ArrayField(
        new SchemaField({
          target: new StringField({ required: true, initial: "constitution" }),
          value: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        { required: true, initial: [] }
      ),
      // Legacy JSON field kept for backward compatibility with older effect items.
      changes: new StringField({ required: false, initial: "[]" })
    };
  }
}
