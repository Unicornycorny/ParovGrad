const { StringField } = foundry.data.fields;

export class WeaponDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      damageDie: new StringField({ required: false, initial: "d4" })
    };
  }
}
