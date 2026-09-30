import { MagicTreeGraphView } from "../components/magic-tree-graph.js";
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

function compareBranches(a, b) {
  return Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

function compareMilestones(a, b) {
  return Number(a.level ?? 0) - Number(b.level ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0);
}

function getWorldSize(nodes, milestones) {
  const nodeXs = nodes.map((node) => Math.max(0, Number(node.position?.x ?? 0)));
  const nodeYs = nodes.map((node) => Math.max(0, Number(node.position?.y ?? 0)));
  const milestoneXs = milestones.map((milestone) => Math.max(0, Number(milestone.x ?? 0)));

  const maxX = Math.max(0, ...nodeXs, ...milestoneXs);
  const maxY = Math.max(0, ...nodeYs);

  return {
    width: Math.max(2400, Math.ceil(maxX + 720)),
    height: Math.max(1600, Math.ceil(maxY + 520))
  };
}

function hasPath(edges, startNodeId, targetNodeId) {
  const adjacency = new Map();

  for (const edge of Object.values(edges ?? {})) {
    const from = String(edge?.from ?? "");
    const to = String(edge?.to ?? "");
    if (!from || !to) continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }

  const queue = [startNodeId];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (current === targetNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return false;
}

export class ParovGradMagicTreeSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;
  _selectedNodeId = "";
  _selectedEdgeId = "";
  _edgeCreationMode = false;
  _edgeStartNodeId = "";
  _viewState = null;
  _graphView = null;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "sheet", "item", "magic-tree"],
    position: { width: 1220, height: 860 },
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
      scrollable: [".pg-magic-tree-inspector"]
    }
  };

  get title() {
    return `Древо магии: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const branchEntries = objectEntries(system?.branches);
    const nodeEntries = objectEntries(system?.nodes);
    const milestoneEntries = objectEntries(system?.milestones);
    const edgeEntries = objectEntries(system?.edges);
    const validation = validateMagicTreeStructure(system);

    const branches = branchEntries
      .map(([id, branch]) => ({ id, ...branch }))
      .sort(compareBranches);

    const milestones = milestoneEntries
      .map(([id, milestone]) => ({ id, ...milestone }))
      .sort(compareMilestones);

    const branchOptions = branches.map((branch) => ({
      value: branch.id,
      label: branch.name || branch.id
    }));

    const branchNameById = new Map(branchOptions.map((option) => [option.value, option.label]));
    const nodeNameById = new Map(nodeEntries.map(([id, node]) => [id, node?.name || id]));

    const nodes = nodeEntries.map(([id, node]) => ({
      id,
      ...node,
      x: Number(node?.position?.x ?? 0),
      y: Number(node?.position?.y ?? 0),
      typeLabel: MAGIC_TREE_NODE_TYPE_LABELS[node?.type] ?? node?.type ?? "—",
      branchName: branchNameById.get(node?.branchId) ?? "Без ветки",
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
      })),
      selected: id === this._selectedNodeId,
      connectionSource: id === this._edgeStartNodeId
    }));

    const nodeOptions = nodes.map((node) => ({ value: node.id, label: node.name || node.id }));
    const edges = edgeEntries.map(([id, edge]) => ({
      id,
      ...edge,
      fromLabel: nodeNameById.get(edge?.from) ?? edge?.from ?? "—",
      toLabel: nodeNameById.get(edge?.to) ?? edge?.to ?? "—",
      selected: id === this._selectedEdgeId,
      fromOptions: nodeOptions.map((option) => ({ ...option, selected: option.value === edge?.from })),
      toOptions: nodeOptions.map((option) => ({ ...option, selected: option.value === edge?.to }))
    }));

    if (this._selectedNodeId && !nodes.some((node) => node.id === this._selectedNodeId)) {
      this._selectedNodeId = "";
    }
    if (this._selectedEdgeId && !edges.some((edge) => edge.id === this._selectedEdgeId)) {
      this._selectedEdgeId = "";
    }
    if (this._edgeStartNodeId && !nodes.some((node) => node.id === this._edgeStartNodeId)) {
      this._edgeStartNodeId = "";
    }

    const selectedNode = nodes.find((node) => node.id === this._selectedNodeId) ?? null;
    const selectedEdge = edges.find((edge) => edge.id === this._selectedEdgeId) ?? null;
    const connectionSource = nodes.find((node) => node.id === this._edgeStartNodeId) ?? null;
    const graphSize = getWorldSize(nodes, milestones);
    const markerSafeId = String(this.id ?? this.document.id ?? "magic-tree").replace(/[^A-Za-z0-9_-]/g, "-");

    context.system = system;
    context.isEditMode = this._isEditMode;
    context.validation = validation;
    context.hasValidationMessages = Boolean(validation.errors.length || validation.warnings.length);
    context.branches = branches;
    context.milestones = milestones;
    context.nodes = nodes;
    context.edges = edges;
    context.selectedNode = selectedNode;
    context.selectedEdge = selectedEdge;
    context.graph = {
      width: graphSize.width,
      height: graphSize.height,
      markerId: `pg-magic-tree-arrow-${markerSafeId}`,
      connectionMode: this._edgeCreationMode,
      connectionSourceId: this._edgeStartNodeId,
      connectionSourceName: connectionSource?.name ?? "",
      connectionInstruction: this._edgeStartNodeId
        ? `Исходный узел: ${connectionSource?.name ?? this._edgeStartNodeId}. Выберите целевой узел.`
        : "Выберите исходный узел связи."
    };
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
        this._edgeCreationMode = false;
        this._edgeStartNodeId = "";
        await this.render({ force: true });
      }
    });

    return controls;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    this._mountGraph(htmlElement);
    this._bindGraphNavigation(htmlElement);

    htmlElement.querySelectorAll(".pg-magic-tree-edge-select").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const edgeId = button.dataset.edgeId;
        if (edgeId) await this._selectEdge(edgeId);
      });
    });

    if (!this._isEditMode) return;

    this._bindAddButton(htmlElement, ".pg-magic-tree-add-branch", () => this._addBranch());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-milestone", () => this._addMilestone());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-node", () => {
      const center = this._graphView?.getViewportCenterWorldPosition() ?? { x: 180, y: 180 };
      return this._addNode({ x: Math.max(0, center.x - 90), y: Math.max(0, center.y - 60) });
    });

    this._bindAddButton(htmlElement, ".pg-magic-tree-toggle-edge-mode", async () => {
      this._edgeCreationMode = !this._edgeCreationMode;
      this._edgeStartNodeId = "";
      await this.render({ force: true });
    });

    this._bindAddButton(htmlElement, ".pg-magic-tree-cancel-edge-mode", async () => {
      this._edgeCreationMode = false;
      this._edgeStartNodeId = "";
      await this.render({ force: true });
    });

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

  _mountGraph(htmlElement) {
    const hadViewState = Boolean(this._viewState);
    this._graphView?.destroy();

    this._graphView = new MagicTreeGraphView({
      root: htmlElement,
      editable: this._isEditMode,
      initialState: this._viewState,
      connectMode: this._edgeCreationMode,
      connectSourceId: this._edgeStartNodeId,
      onViewStateChange: (state) => {
        this._viewState = state;
      },
      onNodeSelect: async (nodeId) => this._selectNode(nodeId),
      onEdgeSelect: async (edgeId) => this._selectEdge(edgeId),
      onNodeMove: async (nodeId, position) => this._moveNode(nodeId, position),
      onConnectNode: async (nodeId) => this._handleConnectionNode(nodeId),
      onClearSelection: async () => this._clearSelection()
    });

    this._graphView.mount({ fitOnMount: !hadViewState });
  }

  _bindGraphNavigation(htmlElement) {
    this._bindButton(htmlElement, ".pg-magic-tree-fit", () => this._graphView?.fitToContent());
    this._bindButton(htmlElement, ".pg-magic-tree-reset-view", () => this._graphView?.resetView());
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-in", () => this._graphView?.zoomBy(1.15));
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-out", () => this._graphView?.zoomBy(1 / 1.15));
    this._bindButton(htmlElement, ".pg-magic-tree-focus-selected", () => {
      if (this._selectedNodeId) this._graphView?.focusNode(this._selectedNodeId);
    });
  }

  _bindButton(htmlElement, selector, callback) {
    const button = htmlElement.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) return;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback();
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

  async _selectNode(nodeId) {
    if (!nodeId || this._selectedNodeId === nodeId) return;
    this._selectedNodeId = nodeId;
    this._selectedEdgeId = "";
    await this.render({ force: true });
  }

  async _selectEdge(edgeId) {
    if (!edgeId || this._selectedEdgeId === edgeId) return;
    this._selectedEdgeId = edgeId;
    this._selectedNodeId = "";
    await this.render({ force: true });
  }

  async _clearSelection() {
    if (!this._selectedNodeId && !this._selectedEdgeId) return;
    this._selectedNodeId = "";
    this._selectedEdgeId = "";
    await this.render({ force: true });
  }

  async _moveNode(nodeId, position) {
    if (!this._isEditMode || !Object.hasOwn(this.document.system?.nodes ?? {}, nodeId)) return;

    this._selectedNodeId = nodeId;
    this._selectedEdgeId = "";

    await this.document.update({
      [`system.nodes.${nodeId}.position.x`]: Math.max(0, Math.round(Number(position?.x) || 0)),
      [`system.nodes.${nodeId}.position.y`]: Math.max(0, Math.round(Number(position?.y) || 0)),
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _handleConnectionNode(nodeId) {
    if (!this._isEditMode || !this._edgeCreationMode) return;
    if (!Object.hasOwn(this.document.system?.nodes ?? {}, nodeId)) return;

    if (!this._edgeStartNodeId) {
      this._edgeStartNodeId = nodeId;
      this._selectedNodeId = nodeId;
      this._selectedEdgeId = "";
      await this.render({ force: true });
      return;
    }

    const from = this._edgeStartNodeId;
    const to = nodeId;

    if (from === to) {
      ui.notifications?.warn("Нельзя создать связь узла с самим собой.");
      return;
    }

    const edges = this.document.system?.edges ?? {};
    const duplicate = Object.values(edges).some((edge) => edge?.from === from && edge?.to === to);
    if (duplicate) {
      ui.notifications?.warn("Такая связь уже существует.");
      return;
    }

    // Adding from -> to creates a cycle when to can already reach from.
    if (hasPath(edges, to, from)) {
      ui.notifications?.error("Эта связь создаст цикл в прогрессии дерева.");
      return;
    }

    const edgeId = getRandomId();
    this._edgeCreationMode = false;
    this._edgeStartNodeId = "";
    this._selectedNodeId = "";
    this._selectedEdgeId = edgeId;

    await this.document.update({
      [`system.edges.${edgeId}`]: {
        from,
        to,
        type: MAGIC_TREE_EDGE_TYPES.REQUIREMENT
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
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
    const center = this._graphView?.getViewportCenterWorldPosition() ?? { x: 0, y: 0 };

    await this.document.update({
      [`system.milestones.${id}`]: {
        name: "Новый этап",
        level: 1,
        x: Math.max(0, Math.round(Number(center.x) || 0))
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _addNode(position = null) {
    const id = getRandomId();
    const firstBranchId = Object.keys(this.document.system?.branches ?? {})[0] ?? "";
    const x = Math.max(0, Math.round(Number(position?.x) || 0));
    const y = Math.max(0, Math.round(Number(position?.y) || 0));

    this._selectedNodeId = id;
    this._selectedEdgeId = "";

    await this.document.update({
      [`system.nodes.${id}`]: {
        name: "Новый узел",
        description: "",
        branchId: firstBranchId,
        level: 1,
        type: MAGIC_TREE_NODE_TYPES.INFLUENCE,
        cost: 0,
        position: { x, y },
        output: { name: "", value: "" },
        materials: []
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _deleteEntry(collection, id) {
    if (!["branches", "milestones", "nodes", "edges"].includes(collection)) return;

    const current = this.document.system?.[collection] ?? {};
    if (!Object.hasOwn(current, id)) return;

    // Foundry updates objects recursively. Sending the same object without one key
    // therefore does not delete that key. The "-=key" syntax explicitly removes
    // a property during Document#update, which is required for TypedObjectField.
    const update = {
      [`system.${collection}.-=${id}`]: null,
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    };

    if (collection === "branches") {
      for (const [nodeId, node] of Object.entries(this.document.system?.nodes ?? {})) {
        if (node?.branchId !== id) continue;
        update[`system.nodes.${nodeId}.branchId`] = "";
      }
    }

    if (collection === "nodes") {
      const deletedEdgeIds = new Set();

      for (const [edgeId, edge] of Object.entries(this.document.system?.edges ?? {})) {
        if (edge?.from !== id && edge?.to !== id) continue;
        update[`system.edges.-=${edgeId}`] = null;
        deletedEdgeIds.add(edgeId);
      }

      if (this._selectedNodeId === id) this._selectedNodeId = "";
      if (this._edgeStartNodeId === id) {
        this._edgeStartNodeId = "";
        this._edgeCreationMode = false;
      }
      if (this._selectedEdgeId && deletedEdgeIds.has(this._selectedEdgeId)) {
        this._selectedEdgeId = "";
      }
    }

    if (collection === "edges" && this._selectedEdgeId === id) {
      this._selectedEdgeId = "";
    }

    await this.document.update(update);
  }
}
