import {
  MAGIC_TREE_EDGE_TYPES,
  MAGIC_TREE_NODE_TYPE_LABELS,
  MAGIC_TREE_NODE_TYPES
} from "../../magic/magic-tree-constants.js";
import { validateMagicTreeStructure } from "../../magic/magic-tree-validator.js";

function objectEntries(value) {
  return Object.entries(value ?? {});
}

function getRandomId() {
  return foundry.utils.randomID();
}

function normalizeMaterialsText(value) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export class ParovGradMagicTreeSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "magic-tree"],
    position: { width: 900, height: 800 },
    window: {
      title: "ParovGrad: Magic Tree",
      resizable: true
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-magic-tree.hbs",
      scrollable: [".sheet-body"]
    }
  };

  get title() {
    return `Древо магии: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const branches = objectEntries(system?.branches);
    const nodes = objectEntries(system?.nodes);
    const milestones = objectEntries(system?.milestones);
    const edges = objectEntries(system?.edges);
    const validation = validateMagicTreeStructure(system);

    const branchOptions = branches.map(([id, branch]) => ({
      value: id,
      label: branch?.name || id
    }));

    const nodeOptions = nodes.map(([id, node]) => ({
      value: id,
      label: node?.name || id
    }));

    context.system = system;
    context.isEditMode = this._isEditMode;
    context.validation = validation;
    context.hasValidationMessages = Boolean(validation.errors.length || validation.warnings.length);

    context.branches = branches
      .map(([id, branch]) => ({ id, ...branch }))
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || a.name.localeCompare(b.name));

    context.milestones = milestones
      .map(([id, milestone]) => ({ id, ...milestone }))
      .sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0));

    const branchNameById = new Map(branchOptions.map((option) => [option.value, option.label]));
    const nodeNameById = new Map(nodeOptions.map((option) => [option.value, option.label]));

    context.nodes = nodes.map(([id, node]) => ({
      id,
      ...node,
      typeLabel: MAGIC_TREE_NODE_TYPE_LABELS[node?.type] ?? node?.type ?? "—",
      branchName: branchNameById.get(node?.branchId) ?? "—",
      materialsText: Array.isArray(node?.materials) ? node.materials.join("\n") : "",
      branchOptions: [
        { value: "", label: "— Без ветки —", selected: !node?.branchId },
        ...branchOptions.map((option) => ({
          ...option,
          selected: option.value === node?.branchId
        }))
      ],
      typeOptions: Object.entries(MAGIC_TREE_NODE_TYPE_LABELS).map(([value, label]) => ({
        value,
        label,
        selected: value === node?.type
      }))
    }));

    context.edges = edges.map(([id, edge]) => ({
      id,
      ...edge,
      fromLabel: nodeNameById.get(edge?.from) ?? edge?.from ?? "—",
      toLabel: nodeNameById.get(edge?.to) ?? edge?.to ?? "—",
      fromOptions: nodeOptions.map((option) => ({
        ...option,
        selected: option.value === edge?.from
      })),
      toOptions: nodeOptions.map((option) => ({
        ...option,
        selected: option.value === edge?.to
      }))
    }));

    context.counts = {
      branches: branches.length,
      milestones: milestones.length,
      nodes: nodes.length,
      edges: edges.length
    };

    return context;
  }

  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);

    if (this._isEditMode) {
      foundry.utils.setProperty(
        submitData,
        "system.revision",
        Number(this.document.system?.revision ?? 1) + 1
      );
    }

    return submitData;
  }

  _getHeaderControls() {
    const controls = super._getHeaderControls();

    controls.unshift({
      action: "toggleEditMode",
      icon: this._isEditMode ? "fa-solid fa-lock-open" : "fa-solid fa-pen-to-square",
      label: this._isEditMode ? "Завершить редактирование" : "Редактировать",
      visible: () => this.isEditable,
      onClick: async () => {
        this._isEditMode = !this._isEditMode;
        await this.render({ force: true });
      }
    });

    return controls;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (!this._isEditMode) return;

    this._bindAddButton(htmlElement, ".pg-magic-tree-add-branch", () => this._addBranch());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-milestone", () => this._addMilestone());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-node", () => this._addNode());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-edge", () => this._addEdge());

    htmlElement.querySelectorAll("[data-magic-tree-delete]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const collection = button.dataset.magicTreeDelete;
        const id = button.dataset.entryId;
        if (!collection || !id) return;

        await this._deleteEntry(collection, id);
      });
    });

    htmlElement.querySelectorAll(".pg-magic-tree-materials").forEach((textarea) => {
      textarea.addEventListener("change", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const nodeId = textarea.dataset.nodeId;
        if (!nodeId) return;

        await this.document.update({
          [`system.nodes.${nodeId}.materials`]: normalizeMaterialsText(textarea.value),
          "system.revision": Number(this.document.system?.revision ?? 1) + 1
        });
      });
    });
  }

  _bindAddButton(htmlElement, selector, callback) {
    const button = htmlElement.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) return;

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await callback();
    });
  }

  async _addBranch() {
    const id = getRandomId();
    const branches = this.document.system?.branches ?? {};

    await this.document.update({
      [`system.branches.${id}`]: {
        name: "Новая ветка",
        order: Object.keys(branches).length
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _addMilestone() {
    const id = getRandomId();

    await this.document.update({
      [`system.milestones.${id}`]: {
        name: "Новый этап",
        level: 1,
        x: 0
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _addNode() {
    const id = getRandomId();
    const firstBranchId = Object.keys(this.document.system?.branches ?? {})[0] ?? "";

    await this.document.update({
      [`system.nodes.${id}`]: {
        name: "Новый узел",
        description: "",
        branchId: firstBranchId,
        level: 1,
        type: MAGIC_TREE_NODE_TYPES.INFLUENCE,
        cost: 0,
        position: { x: 0, y: 0 },
        output: { name: "", value: "" },
        materials: []
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _addEdge() {
    const nodeIds = Object.keys(this.document.system?.nodes ?? {});

    if (nodeIds.length < 2) {
      ui.notifications?.warn("Для создания связи в древе должно быть как минимум два узла.");
      return;
    }

    const id = getRandomId();

    await this.document.update({
      [`system.edges.${id}`]: {
        from: nodeIds[0],
        to: nodeIds[1],
        type: MAGIC_TREE_EDGE_TYPES.REQUIREMENT
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _deleteEntry(collection, id) {
    if (!["branches", "milestones", "nodes", "edges"].includes(collection)) return;

    const current = foundry.utils.deepClone(this.document.system?.[collection] ?? {});
    if (!Object.hasOwn(current, id)) return;

    delete current[id];

    const update = {
      [`system.${collection}`]: current,
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    };

    if (collection === "branches") {
      const nodes = foundry.utils.deepClone(this.document.system?.nodes ?? {});
      for (const node of Object.values(nodes)) {
        if (node?.branchId === id) node.branchId = "";
      }
      update["system.nodes"] = nodes;
    }

    if (collection === "nodes") {
      const edges = foundry.utils.deepClone(this.document.system?.edges ?? {});
      for (const [edgeId, edge] of Object.entries(edges)) {
        if (edge?.from === id || edge?.to === id) delete edges[edgeId];
      }
      update["system.edges"] = edges;
    }

    await this.document.update(update);
  }
}
