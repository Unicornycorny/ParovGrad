const { SchemaField, NumberField, StringField } = foundry.data.fields;

export class NpcDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const statField = () =>
      new NumberField({ required: true, integer: true, min: 1, max: 20, initial: 10 });

    return {
      // (опционально) роль NPC — если тебе нужно оставить
      role: new StringField({ required: false, initial: "enemy" }),

      // 5 характеристик (1..20)
      stats: new SchemaField({
        constitution: statField(),
        awareness: statField(),
        movement: statField(),
        thinking: statField(),
        will: statField()
      }),

      // Прочие показатели
      inspiration: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      experience: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),

      // Здоровье
      health: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
        max:   new NumberField({ required: true, integer: true, min: 0, initial: 10 })
      })
    };
  }
}