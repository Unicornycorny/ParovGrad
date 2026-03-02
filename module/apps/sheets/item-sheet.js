export class ParovGradItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.DocumentSheetV2
) {
    static DEFAULT_OPTIONS = {
        id: "parovgrad-item-sheet",
        classes: ["ParovGrad", "sheet", "item"],
        position: { width: 650, height: 500 },
        window: { title: "ParovGrad: Item", resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "systems/ParovGrad/templates/sheet/item-item.hbs",
            scrollable: [""]
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        return context;
    }
}