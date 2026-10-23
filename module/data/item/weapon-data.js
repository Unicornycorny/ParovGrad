const { StringField, ArrayField, SchemaField, NumberField } = foundry.data.fields;

import { damageSchema } from "../../damage/damage-types.js";

export class WeaponDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new StringField({ required: false, initial: "" }),
      damage: damageSchema(),
      damageDie: new StringField({ required: false, initial: "d4" }),
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
