const { StringField } = foundry.data.fields;

export class SkillDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      damageDie: new StringField({ required: false, initial: "d4" })
    };
  }
}
