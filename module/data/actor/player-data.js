const { SchemaField, NumberField } = foundry.data.fields;

export class PlayerDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const statField = () =>
      new NumberField({ required: true, integer: true, min: 1, max: 20, initial: 10 });

    return {
      // 5 характеристик (1..20)
      stats: new SchemaField({
        constitution: statField(), // Телосложение
        awareness: statField(),    // Внимание
        movement: statField(),     // Движение
        thinking: statField(),     // Мышление
        will: statField()          // Воля
      }),

      // Прочие показатели
      lifePath: new NumberField({ required: true, integer: true, min: 1, max: 5, initial: 1 }),
      inspiration: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      experience: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      level: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),

      // Здоровье (текущее/макс)
      health: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
        max:   new NumberField({ required: true, integer: true, min: 0, initial: 10 })
      })
    };
  }
}