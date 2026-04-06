import { buildActorInfluenceState } from "../../effects/effect-utils.js";

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

  prepareDerivedData() {
    const actor = this.parent;
    const influenceState = buildActorInfluenceState(actor);

    this.externalInfluences = influenceState.entriesByTarget;
    this.externalInfluenceTotals = influenceState.totalsByTarget;
    this.externalInfluenceTooltips = influenceState.tooltipsByTarget;

    const baseStats = {
      constitution: Number(this.stats?.constitution) || 0,
      awareness: Number(this.stats?.awareness) || 0,
      movement: Number(this.stats?.movement) || 0,
      thinking: Number(this.stats?.thinking) || 0,
      will: Number(this.stats?.will) || 0
    };

    this.effectiveStats = {
      constitution: baseStats.constitution + influenceState.totalsByTarget.constitution,
      awareness: baseStats.awareness + influenceState.totalsByTarget.awareness,
      movement: baseStats.movement + influenceState.totalsByTarget.movement,
      thinking: baseStats.thinking + influenceState.totalsByTarget.thinking,
      will: baseStats.will + influenceState.totalsByTarget.will
    };

    this.derivedHealthBaseMax = Number(this.health?.max) || 0;
    this.derivedHealthMax = Math.max(0, this.derivedHealthBaseMax + influenceState.totalsByTarget.healthMax);
    this.derivedHealthInfluenceTooltip = influenceState.tooltipsByTarget.healthMax;
  }
}
