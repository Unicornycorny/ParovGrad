const { StringField } = foundry.data.fields;

export class ItemDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" })
    };
  }
}