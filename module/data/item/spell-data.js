const { StringField, NumberField, ArrayField } = foundry.data.fields;

export class SpellDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),

      range: new StringField({
        required: false,
        initial: ""
      }),

      shape: new StringField({
        required: false,
        initial: ""
      }),

      influences: new ArrayField(
        new StringField({
          required: true,
          blank: false
        }),
        {
          required: true,
          initial: [],
          max: 4
        }
      ),

      school: new StringField({
        required: false,
        initial: ""
      }),

      level: new NumberField({
        required: true,
        integer: true,
        min: 0,
        initial: 1
      })
    };
  }
}