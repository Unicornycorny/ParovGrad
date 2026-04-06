const { StringField, NumberField } = foundry.data.fields;

export class SkillDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      damageDie: new StringField({ required: false, initial: "d4" }),
      cost: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
    };
  }
}
