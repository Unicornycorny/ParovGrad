const { SchemaField, NumberField, StringField } = foundry.data.fields;

export class NpcDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      role: new StringField({ required: false, initial: "enemy" }),
      hp: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 5 }),
        max:   new NumberField({ required: true, integer: true, min: 0, initial: 5 })
      })
    };
  }
}