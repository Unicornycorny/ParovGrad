/** Visual skill-tree browser for learning a copy of a world Skill Item. */
import { MagicTreeGraphView } from "./components/magic-tree-graph.js";
import {
  canObserveDocument,
  resolveAccessibleSkill,
  getSkillNodeLearningState,
  isActorLearningSkill,
  learnSkillFromTree
} from "../skills/skill-learning.js";

function sortedBranches(branches) {
  return Object.entries(branches ?? {})
    .map(([id, branch]) => ({ id, ...branch }))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
}

function worldSize(nodes, milestones) {
  const maxX = Math.max(0, ...nodes.map((node) => Number(node.x) || 0),
    ...milestones.map((milestone) => Number(milestone.x) || 0));
  const maxY = Math.max(0, ...nodes.map((node) => Number(node.y) || 0));
  return {
    width: Math.max(2400, Math.ceil(maxX + 720)),
    height: Math.max(1600, Math.ceil(maxY + 520))
  };
}

function safeMarkerId(value) {
  return String(value ?? "learn-skill").replace(/[^A-Za-z0-9_-]/g, "-");
}

function isAccessibleTree(item) {
  return item?.documentName === "Item" && item.type === "skillTree" &&
    item.parent?.documentName !== "Actor" && canObserveDocument(item);
}

/**
 * Uses the same read-only graph controller and Handlebars ApplicationV2
 * architecture as Spell Builder. Skill selection is done by clicking nodes,
 * not by selecting a row from a potentially enormous dropdown.
 */
export class ParovGradLearnSkillTreeApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  actor;
  _treeUuid = "";
  _selectedNodeId = "";
  _viewState = null;
  _graphView = null;
  _searchText = "";
  _learning = false;
  _documentHooks = [];
  _sourceTree = null;

  static DEFAULT_OPTIONS = {
    classes: ["ParovGrad", "pg-item-window", "pg-tree-window", "pg-magic-tree-sheet", "pg-learn-skill-window"],
    position: { width: 1240, height: 820 },
    window: { title: "Изучить навык из древа", resizable: true }
  };

  static PARTS = {
    main: {
      template: "systems/ParovGrad/templates/apps/learn-skill-tree.hbs",
      scrollable: [".pg-learn-skill-preview"]
    }
  };

  constructor(actor, options = {}) {
    const { treeUuid, sourceTree, ...applicationOptions } = options;
    super(applicationOptions);
    if (actor?.documentName !== "Actor" || actor.type !== "Player") {
      throw new Error("ParovGradLearnSkillTreeApp requires a Player Actor.");
    }
    this.actor = actor;
    // Compendium trees can be browsed directly without importing or modifying them.
    this._sourceTree = sourceTree?.pack || sourceTree?.compendium ? sourceTree : null;
    this._treeUuid = treeUuid ?? sourceTree?.uuid ?? this._getAvailableTrees()[0]?.uuid ?? "";
    const refresh = () => {
      if (this.rendered) this.render({ force: true }).catch((error) => console.error("ParovGrad | Could not refresh skill learning", error));
    };
    this._documentHooks.push(["updateActor", Hooks.on("updateActor", (document) => {
      if (document.uuid === this.actor.uuid) refresh();
    })]);
    this._documentHooks.push(["parovgradSkillLearningComplete", Hooks.on("parovgradSkillLearningComplete", (document) => {
      if (document?.uuid === this.actor.uuid) refresh();
    })]);
    for (const hook of ["createItem", "updateItem", "deleteItem"]) {
      this._documentHooks.push([hook, Hooks.on(hook, (document) => {
        if (hook === "deleteItem" && document.uuid === this._sourceTree?.uuid) this._sourceTree = null;
        const isSource = Object.values(this._getTree()?.system?.nodes ?? {}).some((node) => node.skillUuid === document.uuid);
        if (document.type === "skillTree" || document.parent?.uuid === this.actor.uuid || isSource) refresh();
      })]);
    }
  }

  get title() {
    return `Изучить навык — ${this.actor.name}`;
  }

  _getTree() {
    return this._getAvailableTrees().find((item) => item.uuid === this._treeUuid) ?? null;
  }

  _getAvailableTrees() {
    const trees = game.items.filter(isAccessibleTree);
    if (isAccessibleTree(this._sourceTree) && !trees.some((tree) => tree.uuid === this._sourceTree.uuid)) trees.push(this._sourceTree);
    return trees;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const trees = this._getAvailableTrees()
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!trees.some((tree) => tree.uuid === this._treeUuid)) {
      this._treeUuid = trees[0]?.uuid ?? "";
      this._selectedNodeId = "";
      this._viewState = null;
    }

    const tree = this._getTree();
    const branches = sortedBranches(tree?.system?.branches);
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name || branch.id]));
    const milestones = Object.entries(tree?.system?.milestones ?? {})
      .map(([id, milestone]) => ({ id, ...milestone }))
      .sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0));
    const entries = Object.entries(tree?.system?.nodes ?? {});
    const skillUuids = [...new Set(entries.map(([, node]) => String(node?.skillUuid ?? "")).filter(Boolean))];
    const skills = new Map(await Promise.all(skillUuids.map(async (uuid) => [uuid, await resolveAccessibleSkill(uuid)])));
    const nodes = entries.map(([id, node]) => {
      const skillUuid = String(node?.skillUuid ?? "");
      const skill = skills.get(skillUuid) ?? null;
      const learningState = getSkillNodeLearningState({ actor: this.actor, tree, nodeId: id, resolvedSkills: skills });
      return {
        id,
        ...learningState,
        skillUuid,
        skill,
        skillName: skill?.name ?? "Навык недоступен",
        skillImg: skill?.img || "icons/svg/hazard.svg",
        description: String(skill?.system?.description ?? ""),
        branchId: String(node?.branchId ?? ""),
        branchName: branchNames.get(node?.branchId) ?? "Без ветки",
        level: Number(node?.level ?? 1),
        x: Number(node?.position?.x ?? 0),
        y: Number(node?.position?.y ?? 0),
        cost: skill ? Number(skill.system?.cost ?? 0) : null,
        damageDie: skill ? (String(skill.system?.damageDie ?? "").trim().toUpperCase() || "—") : "—",
        missing: !skill,
        selected: id === this._selectedNodeId
      };
    });

    if (!nodes.some((node) => node.id === this._selectedNodeId)) this._selectedNodeId = "";
    const selectedNode = nodes.find((node) => node.id === this._selectedNodeId) ?? null;
    const graphSize = worldSize(nodes, milestones);

    context.actor = this.actor;
    context.tree = tree;
    context.treeOptions = trees.map((item) => ({
      uuid: item.uuid, name: item.name, selected: item.uuid === this._treeUuid
    }));
    context.branches = branches;
    context.milestones = milestones;
    context.nodes = nodes;
    context.edges = Object.entries(tree?.system?.edges ?? {}).map(([id, edge]) => ({ id, ...edge }));
    context.selectedNode = selectedNode;
    context.canLearn = Boolean(selectedNode?.available && !this._learning && !isActorLearningSkill(this.actor));
    context.skillPoints = Number(this.actor.system?.skillPoints ?? 0);
    context.actorLevel = Number(this.actor.system?.level ?? 0);
    context.searchText = this._searchText;
    context.graph = {
      width: graphSize.width,
      height: graphSize.height,
      markerId: `pg-learn-skill-arrow-${safeMarkerId(this.id)}`
    };
    return context;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    this._mountGraph(htmlElement);

    const treeSelect = htmlElement.querySelector(".pg-learn-skill-tree-select");
    treeSelect?.addEventListener("change", async () => {
      const nextUuid = treeSelect.value;
      if (nextUuid === this._treeUuid) return;
      this._treeUuid = nextUuid;
      this._selectedNodeId = "";
      this._viewState = null;
      this._searchText = "";
      await this.render({ force: true });
    });

    const search = htmlElement.querySelector(".pg-learn-skill-search");
    if (search) {
      search.addEventListener("input", () => {
        this._searchText = search.value;
        this._highlightMatches(htmlElement);
      });
      search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const first = htmlElement.querySelector(".pg-magic-tree-node.is-search-match");
        if (first) this._graphView?.focusNode(first.dataset.nodeId);
      });
      this._highlightMatches(htmlElement);
    }

    this._bindButton(htmlElement, ".pg-magic-tree-fit", () => this._graphView?.fitToContent());
    this._bindButton(htmlElement, ".pg-magic-tree-reset-view", () => this._graphView?.resetView());
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-in", () => this._graphView?.zoomBy(1.15));
    this._bindButton(htmlElement, ".pg-magic-tree-zoom-out", () => this._graphView?.zoomBy(1 / 1.15));
    this._bindButton(htmlElement, ".pg-learn-skill-focus-selected", () => {
      if (this._selectedNodeId) this._graphView?.focusNode(this._selectedNodeId);
    });
    this._bindButton(htmlElement, ".pg-learn-skill-apply", () => this._learnSelectedSkill());
    this._bindButton(htmlElement, ".pg-learn-skill-cancel", () => this.close());
  }

  _mountGraph(htmlElement) {
    const graphRoot = htmlElement.querySelector(".pg-learn-skill-graph");
    if (!(graphRoot instanceof HTMLElement)) return;
    const hadViewState = Boolean(this._viewState);
    this._graphView?.destroy();
    this._graphView = new MagicTreeGraphView({
      root: graphRoot,
      editable: false,
      initialState: this._viewState,
      onViewStateChange: (state) => { this._viewState = state; },
      onNodeSelect: (nodeId) => this._selectNode(nodeId)
    });
    this._graphView.mount({ fitOnMount: !hadViewState });
  }

  _highlightMatches(htmlElement) {
    const query = this._searchText.trim().toLocaleLowerCase("ru");
    const nodes = htmlElement.querySelectorAll(".pg-learn-skill-graph .pg-magic-tree-node");
    for (const node of nodes) {
      const match = Boolean(query) && String(node.dataset.searchText ?? "").toLocaleLowerCase("ru").includes(query);
      node.classList.toggle("is-search-match", match);
      node.classList.toggle("is-search-dimmed", Boolean(query) && !match);
    }
  }

  _bindButton(htmlElement, selector, callback) {
    const button = htmlElement.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      await callback();
    });
  }

  async _selectNode(nodeId) {
    if (!Object.hasOwn(this._getTree()?.system?.nodes ?? {}, nodeId)) return;
    this._selectedNodeId = this._selectedNodeId === nodeId ? "" : nodeId;
    await this.render({ force: true });
  }

  async _learnSelectedSkill() {
    if (this._learning) return;
    this._learning = true;
    try {
      const { created, cost } = await learnSkillFromTree({ actor: this.actor, tree: this._getTree(), nodeId: this._selectedNodeId });
      ui.notifications?.info(`«${created[0].name}» изучен персонажем «${this.actor.name}». Потрачено очков навыков: ${cost}.`);
    } catch (error) {
      console.error("ParovGrad | Failed to learn skill from tree", error);
      ui.notifications?.warn(error.message || "Не удалось добавить навык персонажу. Подробности в консоли.");
    } finally {
      this._learning = false;
      if (this.rendered) await this.render({ force: true });
    }
  }

  _onClose(options) {
    this._graphView?.destroy();
    this._graphView = null;
    for (const [hook, id] of this._documentHooks) Hooks.off(hook, id);
    this._documentHooks = [];
    super._onClose(options);
  }
}

export async function openLearnSkillFromTreeDialog(actor, options = {}) {
  if (!actor || actor.documentName !== "Actor" || actor.type !== "Player") return;
  if (!actor.isOwner) {
    ui.notifications?.warn("Недостаточно прав для изменения навыков персонажа.");
    return;
  }
  let sourceTree = options.sourceTree ?? null;
  if (options.treeUuid && sourceTree?.uuid !== options.treeUuid) {
    try { sourceTree = await foundry.utils.fromUuid(options.treeUuid); }
    catch { sourceTree = null; }
  }
  if ((options.treeUuid || sourceTree) && !isAccessibleTree(sourceTree)) {
    ui.notifications?.warn("Выбранное древо навыков недоступно для просмотра.");
    return;
  }
  if (!sourceTree && !game.items.filter(isAccessibleTree).length) {
    ui.notifications?.warn("Нет доступных для просмотра древ навыков в каталоге предметов мира.");
    return;
  }
  const application = new ParovGradLearnSkillTreeApp(actor, { ...options, sourceTree });
  try { await application.render({ force: true }); }
  catch (error) {
    for (const [hook, id] of application._documentHooks) Hooks.off(hook, id);
    application._documentHooks = [];
    throw error;
  }
  return application;
}
