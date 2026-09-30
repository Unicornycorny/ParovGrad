const {
  ArrayField,
  NumberField,
  SchemaField,
  StringField
} = foundry.data.fields;

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

      effects: new ArrayField(
        new SchemaField({
          type: new StringField({ required: true, blank: false, initial: "damage" }),
          label: new StringField({ required: false, initial: "" }),
          formula: new StringField({ required: true, blank: false, initial: "1d4" })
        }),
        {
          required: true,
          initial: [],
          max: 4
        }
      ),

      cost: new NumberField({
        required: true,
        min: 0,
        initial: 0
      }),

      materials: new ArrayField(
        new StringField({
          required: true,
          blank: false
        }),
        {
          required: true,
          initial: []
        }
      ),

      construction: new SchemaField({
        treeUuid: new StringField({ required: false, initial: "" }),
        treeRevision: new NumberField({
          required: true,
          integer: true,
          min: 0,
          initial: 0
        }),
        selectedNodeIds: new ArrayField(
          new StringField({
            required: true,
            blank: false
          }),
          {
            required: true,
            initial: []
          }
        )
      }),

      // Legacy compatibility only. Magic schools are branches of a Magic Tree
      // and are no longer part of the spell itself. Keeping this field prevents
      // older Spell Items from becoming invalid while their old data still exists.
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
