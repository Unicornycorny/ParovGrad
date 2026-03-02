export class ParovGradItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.DocumentSheetV2
) {
    static DEFAULT_OPTIONS = {
        id: "parovgrad-item-sheet",
        classes: ["ParovGrad", "sheet", "item"],
        position: { width: 650, height: 500 },
        window: { title: "ParovGrad: Item" },
        form: {
            handler: this.#onSubmit,
            submitOnChange: true,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        main: { template: "systems/ParovGrad/templates/sheet/item-item.hbs" }
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