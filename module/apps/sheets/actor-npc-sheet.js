export class ParovGradNpcSheet extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.DocumentSheetV2
) {
    static DEFAULT_OPTIONS = {
        id: "parovgrad-npc-sheet",
        classes: ["ParovGrad", "sheet", "actor", "NPC"],
        position: { width: 720, height: 600 },
        window: { title: "ParovGrad: NPC" },
        form: {
            handler: this.#onSubmit,
            submitOnChange: true,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        main: { template: "systems/ParovGrad/templates/sheet/actor-npc.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        return context;
    }

    static async #onSubmit(event, form, formData) {
        await this.document.update(formData.object);
    }
}