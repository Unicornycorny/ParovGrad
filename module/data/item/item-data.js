const { StringField, NumberField, ArrayField, SchemaField } = foundry.data.fields;

export class ItemDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
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
