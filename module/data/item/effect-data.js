const { StringField, NumberField } = foundry.data.fields;

export class EffectDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
      effectType: new StringField({ required: false, initial: "" }),
      impact: new StringField({ required: false, initial: "" }),
      removal: new StringField({ required: false, initial: "" }),
      changes: new StringField({ required: false, initial: "[]" })
    };
  }
}
