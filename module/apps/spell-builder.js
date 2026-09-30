import { MagicTreeGraphView } from "./components/magic-tree-graph.js";
import {
  MAGIC_TREE_NODE_TYPE_LABELS
} from "../magic/magic-tree-constants.js";
import { MagicTreeCompiler } from "../magic/magic-tree-compiler.js";
import {
  buildSpellConstruction,
  getSpellConstruction,
  getWorldMagicTrees,
  resolveMagicTree
} from "../magic/spell-construction.js";

function objectEntries(value) {
  return Object.entries(value ?? {});
}

function compareBranches(a, b) {
  return Number(a.order ?? 0) - Number(b.order ?? 0)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

function compareMilestones(a, b) {
  return Number(a.level ?? 0) - Number(b.level ?? 0)
    || Number(a.x ?? 0) - Number(b.x ?? 0);
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

function safeMarkerId(value) {
  return String(value ?? "spell-builder").replace(/[^A-Za-z0-9_-]/g, "-");
}

export class ParovGradSpellBuilder extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  spell;
  _treeUuid = "";
  _treeDocument = null;
  _selectedNodeIds = new Set();
  _viewState = null;
  _graphView = null;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "pg-spell-builder", "pg-magic-tree-sheet"],
    position: { width: 1280, height: 860 },
    window: {
      title: "Конструктор заклинания",
      resizable: true
    }
  };

  static PARTS = {
    main: {
      template: "systems/ParovGrad/templates/apps/spell-builder.hbs",
      scrollable: [".pg-spell-builder-preview"]
    }
  };

  constructor(spell, options = {}) {
    super(options);

    if (!spell || spell.documentName !== "Item" || spell.type !== "spell") {
      throw new Error("ParovGradSpellBuilder requires a Spell Item document.");
    }

    this.spell = spell;

    const construction = getSpellConstruction(spell);
    const worldTrees = getWorldMagicTrees();
    this._treeUuid = String(options.treeUuid ?? construction.treeUuid ?? worldTrees[0]?.uuid ?? "");

    if (this._treeUuid && this._treeUuid === construction.treeUuid) {
      this._selectedNodeIds = new Set(construction.selectedNodeIds);
    }
  }

  get title() {
    return `Конструктор: ${this.spell.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tree = await this._resolveCurrentTree();
    const construction = getSpellConstruction(this.spell);
    const worldTrees = getWorldMagicTrees();

    const treeOptions = worldTrees.map((item) => ({
      uuid: item.uuid,
      name: item.name || item.uuid,
      selected: item.uuid === this._treeUuid,
      missing: false
    }));

    if (tree && !treeOptions.some((option) => option.uuid === tree.uuid)) {
      treeOptions.push({
        uuid: tree.uuid,
        name: tree.name || tree.uuid,
        selected: true,
        missing: false
      });
      treeOptions.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    if (this._treeUuid && !tree && !treeOptions.some((option) => option.uuid === this._treeUuid)) {
      treeOptions.unshift({
        uuid: this._treeUuid,
        name: `Недоступно: ${this._treeUuid}`,
        selected: true,
        missing: true
      });
    }

    context.spell = this.spell;
    context.treeOptions = treeOptions;
    context.hasTreeOptions = treeOptions.length > 0;
    context.selectedTreeUuid = this._treeUuid;
    context.treeMissing = Boolean(this._treeUuid && !tree);

    if (!tree) {
      context.tree = null;
      context.branches = [];
      context.milestones = [];
      context.nodes = [];
      context.edges = [];
      context.graph = {
        width: 2400,
        height: 1600,
        markerId: `pg-spell-builder-arrow-${safeMarkerId(this.id)}`
      };
      context.compilation = {
        valid: false,
        errors: [this._treeUuid ? "Выбранное древо магии недоступно." : "Выберите древо магии."],
        warnings: [],
        components: [],
        modifiers: [],
        costBreakdown: [],
        spell: { range: "", shape: "", influences: [], effects: [], cost: 0, materials: [] },
        meta: { selectedCount: 0, maxSelectedNodeLevel: 0 }
      };
      context.canApply = false;
      context.hasSelectedNodes = false;
      context.sourceStatus = this._buildSourceStatus(construction, null);
      return context;
    }

    const system = tree.system;
    const branchEntries = objectEntries(system?.branches);
    const nodeEntries = objectEntries(system?.nodes);
    const milestoneEntries = objectEntries(system?.milestones);
    const edgeEntries = objectEntries(system?.edges);

    // A stored construction can reference nodes which were later removed from the
    // tree. Keep the compiler authoritative, but do not render phantom selections.
    const existingNodeIds = new Set(nodeEntries.map(([id]) => id));
    for (const id of Array.from(this._selectedNodeIds)) {
      if (!existingNodeIds.has(id)) this._selectedNodeIds.delete(id);
    }

    const branches = branchEntries
      .map(([id, branch]) => ({ id, ...branch }))
      .sort(compareBranches);
    const milestones = milestoneEntries
      .map(([id, milestone]) => ({ id, ...milestone }))
      .sort(compareMilestones);
    const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name || branch.id]));

    const nodes = nodeEntries.map(([id, node]) => ({
      id,
      ...node,
      x: Number(node?.position?.x ?? 0),
      y: Number(node?.position?.y ?? 0),
      typeLabel: MAGIC_TREE_NODE_TYPE_LABELS[node?.type] ?? node?.type ?? "—",
      branchName: branchNameById.get(node?.branchId) ?? "Без ветки",
      selected: this._selectedNodeIds.has(id)
    }));

    const edges = edgeEntries.map(([id, edge]) => ({ id, ...edge }));
    const graphSize = getWorldSize(nodes, milestones);
    const compilation = MagicTreeCompiler.compile(tree, Array.from(this._selectedNodeIds));

    compilation.components = compilation.components.map((component) => ({
      ...component,
      branchName: branchNameById.get(component.branchId) ?? "Без ветки"
    }));

    context.tree = tree;
    context.branches = branches;
    context.milestones = milestones;
    context.nodes = nodes;
    context.edges = edges;
    context.graph = {
      width: graphSize.width,
      height: graphSize.height,
      markerId: `pg-spell-builder-arrow-${safeMarkerId(this.id)}`
    };
    context.compilation = compilation;
    context.canApply = compilation.valid && Boolean(tree.uuid);
    context.hasSelectedNodes = this._selectedNodeIds.size > 0;
    context.sourceStatus = this._buildSourceStatus(construction, tree);

    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    this._mountGraph(htmlElement);
    this._bindGraphNavigation(htmlElement);

    const treeSelect = htmlElement.querySelector(".pg-spell-builder-tree-select");
    if (treeSelect instanceof HTMLSelectElement) {
      treeSelect.addEventListener("change", async () => {
        await this._changeTree(treeSelect.value);
      });
    }

    this._bindButton(htmlElement, ".pg-spell-builder-clear", async () => {
      if (!this._selectedNodeIds.size) return;
      this._selectedNodeIds.clear();
      await this.render({ force: true });
    });

    this._bindButton(htmlElement, ".pg-spell-builder-restore", async () => {
      const construction = getSpellConstruction(this.spell);
      if (!this._treeUuid || construction.treeUuid !== this._treeUuid) return;
      this._selectedNodeIds = new Set(construction.selectedNodeIds);
      await this.render({ force: true });
    });

    this._bindButton(htmlElement, ".pg-spell-builder-apply", async () => {
      await this._applyToSpell();
    });
  }

  _mountGraph(htmlElement) {
    const graphRoot = htmlElement.querySelector(".pg-spell-builder-graph");
    if (!(graphRoot instanceof HTMLElement)) return;

    const hadViewState = Boolean(this._viewState);
    this._graphView?.destroy();

    this._graphView = new MagicTreeGraphView({
      root: graphRoot,
      editable: false,
      initialState: this._viewState,
      onViewStateChange: (state) => {
        this._viewState = state;
      },
      onNodeSelect: async (nodeId) => this._toggleNode(nodeId)
    });

    this._graphView.mount({ fitOnMount: !hadViewState });
  }

  _bindGraphNavigation(htmlElement) {
    this._bindButton(htmlElement, ".pg-magic-tree-fit", () => this._graphView?.fitToContent());
    this._bindButton(htmlElement, ".pg-magic-tree-reset-view", () => this._graphView?.resetView());
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-in", () => this._graphView?.zoomBy(1.15));
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-out", () => this._graphView?.zoomBy(1 / 1.15));
  }

  _bindButton(htmlElement, selector, callback) {
    const button = htmlElement.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) return;

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await callback();
    });
  }

  async _toggleNode(nodeId) {
    const tree = await this._resolveCurrentTree();
    if (!tree || !Object.hasOwn(tree.system?.nodes ?? {}, nodeId)) return;

    if (this._selectedNodeIds.has(nodeId)) {
      this._selectedNodeIds.delete(nodeId);
    } else {
      this._selectedNodeIds.add(nodeId);
    }

    await this.render({ force: true });
  }

  async _changeTree(uuid) {
    const nextUuid = String(uuid ?? "");
    if (nextUuid === this._treeUuid) return;

    this._treeUuid = nextUuid;
    this._treeDocument = null;
    this._viewState = null;

    const construction = getSpellConstruction(this.spell);
    this._selectedNodeIds = nextUuid && nextUuid === construction.treeUuid
      ? new Set(construction.selectedNodeIds)
      : new Set();

    await this.render({ force: true });
  }

  async _resolveCurrentTree() {
    if (!this._treeUuid) {
      this._treeDocument = null;
      return null;
    }

    if (this._treeDocument?.uuid === this._treeUuid) return this._treeDocument;

    this._treeDocument = await resolveMagicTree(this._treeUuid);
    return this._treeDocument;
  }

  _buildSourceStatus(construction, tree) {
    const sameTree = Boolean(tree?.uuid && construction.treeUuid === tree.uuid);
    const currentRevision = Math.max(0, Number(tree?.system?.revision) || 0);

    return {
      hasSavedConstruction: Boolean(construction.treeUuid),
      sameTree,
      savedRevision: construction.treeRevision,
      currentRevision,
      outdated: sameTree && construction.treeRevision !== currentRevision,
      canRestore: sameTree && construction.selectedNodeIds.length > 0,
      savedNodeCount: construction.selectedNodeIds.length
    };
  }

  async _applyToSpell() {
    const tree = await this._resolveCurrentTree();
    if (!tree) {
      ui.notifications?.error("Выбранное древо магии недоступно.");
      return;
    }

    const selectedNodeIds = Array.from(this._selectedNodeIds);
    const compilation = MagicTreeCompiler.compile(tree, selectedNodeIds);

    if (!compilation.valid) {
      ui.notifications?.warn(compilation.errors[0] ?? "Невозможно собрать заклинание из выбранных узлов.");
      return;
    }

    await this.spell.update({
      "system.range": compilation.spell.range,
      "system.shape": compilation.spell.shape,
      "system.influences": compilation.spell.influences,
      "system.effects": compilation.spell.effects.map(({ type, label, formula }) => ({ type, label, formula })),
      "system.cost": compilation.spell.cost,
      "system.materials": compilation.spell.materials,
      "system.construction": buildSpellConstruction(tree, selectedNodeIds)
    });

    ui.notifications?.info(`Заклинание «${this.spell.name}» пересобрано из древа «${tree.name}».`);
    await this.render({ force: true });
  }
}
