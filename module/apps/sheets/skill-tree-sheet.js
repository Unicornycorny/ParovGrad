import { attachItemPortraitListener } from "./item-portrait.js";
import { MagicTreeGraphView } from "../components/magic-tree-graph.js";
import { validateSkillTreeStructure } from "../../skills/skill-tree-validator.js";

const SKILL_TREE_EDGE_TYPE = "requirement";

function objectEntries(value) {
  return Object.entries(value ?? {});
}

function getRandomId() {
  return foundry.utils.randomID();
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

async function resolveSkill(uuid) {
  if (!uuid) return null;
  try {
    const document = await foundry.utils.fromUuid(uuid);
    return document?.documentName === "Item" && document.type === "skill" ? document : document ?? null;
  } catch (error) {
    console.warn(`ParovGrad | Failed to resolve skill-tree node ${uuid}`, error);
    return null;
  }
}

export class ParovGradSkillTreeSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.DocumentSheetV2
) {
  _isEditMode = false;
  _selectedNodeId = "";
  _selectedEdgeId = "";
  _edgeCreationMode = false;
  _edgeStartNodeId = "";
  _viewState = null;
  _graphView = null;
  _selectedSkillUuid = "";

  static DEFAULT_OPTIONS = {
    classes: ["pg-item-window", "ParovGrad", "sheet", "item", "skill-tree"],
    position: { width: 1220, height: 860 },
    window: {
      title: "ParovGrad: Skill Tree",
      resizable: true
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: "systems/ParovGrad/templates/sheet/item-skill-tree.hbs",
      scrollable: [".pg-magic-tree-inspector"]
    }
  };

  get title() {
    return `Древо навыков: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.canEditPortrait = this.isEditable;

    const system = this.document.system;
    const branchEntries = objectEntries(system?.branches);
    const nodeEntries = objectEntries(system?.nodes);
    const milestoneEntries = objectEntries(system?.milestones);
    const edgeEntries = objectEntries(system?.edges);

    const skillUuids = [...new Set(nodeEntries.map(([, node]) => String(node?.skillUuid ?? "")).filter(Boolean))];
    const resolvedPairs = await Promise.all(skillUuids.map(async (uuid) => [uuid, await resolveSkill(uuid)]));
    const resolvedSkills = new Map(resolvedPairs);
    const validation = validateSkillTreeStructure(system, resolvedSkills);

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

    const nodes = nodeEntries.map(([id, node]) => {
      const skillUuid = String(node?.skillUuid ?? "");
      const skill = resolvedSkills.get(skillUuid) ?? null;
      const validSkill = skill?.documentName === "Item" && skill.type === "skill";
      const damageDie = validSkill ? String(skill.system?.damageDie ?? "").trim().toUpperCase() : "";
      const cost = validSkill ? Number(skill.system?.cost ?? 0) : null;

      return {
        id,
        ...node,
        x: Number(node?.position?.x ?? 0),
        y: Number(node?.position?.y ?? 0),
        skillUuid,
        skillName: validSkill ? skill.name : "Навык не найден",
        skillImg: validSkill ? skill.img : "icons/svg/hazard.svg",
        skillDescription: validSkill ? String(skill.system?.description ?? "") : "Ссылка на навык недоступна или ведёт на сущность другого типа.",
        skillDamageDie: damageDie || "—",
        skillCost: Number.isFinite(cost) ? cost : "—",
        skillMissing: !validSkill,
        branchName: branchNameById.get(node?.branchId) ?? "Без ветки",
        branchOptions: [
          { value: "", label: "— Без ветки —", selected: !node?.branchId },
          ...branchOptions.map((option) => ({
            ...option,
            selected: option.value === node?.branchId
          }))
        ],
        selected: id === this._selectedNodeId,
        connectionSource: id === this._edgeStartNodeId
      };
    });

    const nodeNameById = new Map(nodes.map((node) => [node.id, node.skillName || node.id]));
    const edges = edgeEntries.map(([id, edge]) => ({
      id,
      ...edge,
      fromLabel: nodeNameById.get(edge?.from) ?? edge?.from ?? "—",
      toLabel: nodeNameById.get(edge?.to) ?? edge?.to ?? "—",
      selected: id === this._selectedEdgeId
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
    const markerSafeId = String(this.id ?? this.document.id ?? "skill-tree").replace(/[^A-Za-z0-9_-]/g, "-");

    const availableSkills = game.items
      .filter((item) => item.type === "skill")
      .map((item) => ({ uuid: item.uuid, name: item.name, img: item.img }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    // This dropdown is UI state, not document data. Preserve the user's
    // selection when the ApplicationV2 form is rerendered by other changes.
    if (!availableSkills.some((skill) => skill.uuid === this._selectedSkillUuid)) {
      this._selectedSkillUuid = availableSkills[0]?.uuid ?? "";
    }
    for (const skill of availableSkills) {
      skill.selected = skill.uuid === this._selectedSkillUuid;
    }

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
    context.availableSkills = availableSkills;
    context.hasAvailableSkills = availableSkills.length > 0;
    context.graph = {
      width: graphSize.width,
      height: graphSize.height,
      markerId: `pg-skill-tree-arrow-${markerSafeId}`,
      connectionMode: this._edgeCreationMode,
      connectionSourceId: this._edgeStartNodeId,
      connectionSourceName: connectionSource?.skillName ?? "",
      connectionInstruction: this._edgeStartNodeId
        ? `Исходный навык: ${connectionSource?.skillName ?? this._edgeStartNodeId}. Выберите целевой навык.`
        : "Выберите исходный навык связи."
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
    attachItemPortraitListener(this, htmlElement);

    this._mountGraph(htmlElement);
    this._bindGraphNavigation(htmlElement);
    this._bindOpenSkillActions(htmlElement);

    htmlElement.querySelectorAll(".pg-magic-tree-edge-select").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const edgeId = button.dataset.edgeId;
        if (edgeId) await this._selectEdge(edgeId);
      });
    });

    if (!this._isEditMode) return;

    this._bindSkillDrop(htmlElement);
    const skillSelect = htmlElement.querySelector(".pg-skill-tree-skill-select");
    skillSelect?.addEventListener("change", (event) => {
      // submitOnChange on DocumentSheetV2 would otherwise rerender the form
      // and reset the native select to its first option.
      event.stopPropagation();
      this._selectedSkillUuid = skillSelect.value;
    });
    this._bindAddButton(htmlElement, ".pg-skill-tree-add-skill", async () => {
      const select = htmlElement.querySelector(".pg-skill-tree-skill-select");
      const skillUuid = select instanceof HTMLSelectElement ? select.value : this._selectedSkillUuid;
      if (!skillUuid) {
        ui.notifications?.warn("Сначала выберите навык из списка или перетащите его на полотно.");
        return;
      }

      const center = this._graphView?.getViewportCenterWorldPosition() ?? { x: 180, y: 180 };
      await this._addSkillNode(skillUuid, { x: Math.max(0, center.x - 90), y: Math.max(0, center.y - 60) });
    });
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-branch", () => this._addBranch());
    this._bindAddButton(htmlElement, ".pg-magic-tree-add-milestone", () => this._addMilestone());

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

    htmlElement.querySelectorAll("[data-skill-tree-delete]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const collection = button.dataset.skillTreeDelete;
        const id = button.dataset.entryId;
        if (!collection || !id) return;

        await this._deleteEntry(collection, id);
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
      onMilestoneMove: async (milestoneId, x) => this._moveMilestone(milestoneId, x),
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

  _bindOpenSkillActions(htmlElement) {
    htmlElement.querySelectorAll("[data-open-skill-uuid]").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const uuid = element.dataset.openSkillUuid;
        if (uuid) await this._openSkill(uuid);
      });
    });

    htmlElement.querySelectorAll(".pg-magic-tree-node[data-skill-uuid]").forEach((node) => {
      node.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const uuid = node.dataset.skillUuid;
        if (uuid) await this._openSkill(uuid);
      });
    });
  }

  _bindSkillDrop(htmlElement) {
    const viewport = htmlElement.querySelector(".pg-magic-tree-viewport");
    if (!(viewport instanceof HTMLElement)) return;

    viewport.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      viewport.classList.add("is-skill-drop-target");
    });

    viewport.addEventListener("dragleave", (event) => {
      if (event.relatedTarget instanceof Node && viewport.contains(event.relatedTarget)) return;
      viewport.classList.remove("is-skill-drop-target");
    });

    viewport.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      viewport.classList.remove("is-skill-drop-target");

      const data = foundry.applications.ux.TextEditor.getDragEventData(event);
      if (data?.type !== "Item" && !data?.uuid) return;

      let item = null;
      try {
        item = await Item.implementation.fromDropData(data);
      } catch (error) {
        console.warn("ParovGrad | Failed to resolve dropped skill", error);
      }

      if (!item || item.documentName !== "Item" || item.type !== "skill") {
        ui.notifications?.warn("В древо навыков можно добавлять только сущности типа «Навык». ");
        return;
      }

      if (item.parent?.documentName === "Actor") {
        ui.notifications?.warn("Добавьте в древо навык из каталога предметов мира или компендиума, а не копию навыка с персонажа.");
        return;
      }

      const position = this._graphView?.clientToWorldPosition(event.clientX, event.clientY) ?? { x: 180, y: 180 };
      await this._addSkillNode(item.uuid, { x: Math.max(0, position.x - 92), y: Math.max(0, position.y - 48) });
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

  async _openSkill(uuid) {
    const skill = await resolveSkill(uuid);
    if (!skill || skill.documentName !== "Item" || skill.type !== "skill") {
      ui.notifications?.error("Связанный навык больше не найден.");
      return;
    }
    await skill.sheet.render({ force: true });
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

  async _moveMilestone(milestoneId, x) {
    if (!this._isEditMode || !Object.hasOwn(this.document.system?.milestones ?? {}, milestoneId)) return;
    await this.document.update({
      [`system.milestones.${milestoneId}.x`]: Math.max(0, Math.round(Number(x) || 0)),
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
      ui.notifications?.warn("Нельзя создать связь навыка с самим собой.");
      return;
    }

    const edges = this.document.system?.edges ?? {};
    const duplicate = Object.values(edges).some((edge) => edge?.from === from && edge?.to === to);
    if (duplicate) {
      ui.notifications?.warn("Такая связь уже существует.");
      return;
    }

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
        type: SKILL_TREE_EDGE_TYPE
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

  async _addSkillNode(skillUuid, position = null) {
    if (!this._isEditMode) return;

    const skill = await resolveSkill(skillUuid);
    if (!skill || skill.documentName !== "Item" || skill.type !== "skill") {
      ui.notifications?.error("Выбранная сущность не является навыком или больше недоступна.");
      return;
    }
    if (skill.parent?.documentName === "Actor") {
      ui.notifications?.warn("Добавьте в древо навык из каталога предметов мира или компендиума, а не копию навыка с персонажа.");
      return;
    }

    const existingNode = Object.entries(this.document.system?.nodes ?? {}).find(([, node]) => node?.skillUuid === skill.uuid);
    if (existingNode) {
      this._selectedNodeId = existingNode[0];
      this._selectedEdgeId = "";
      await this.render({ force: true });
      this._graphView?.focusNode(existingNode[0]);
      ui.notifications?.info(`Навык «${skill.name}» уже есть в этом древе.`);
      return;
    }

    const id = getRandomId();
    const firstBranchId = Object.keys(this.document.system?.branches ?? {})[0] ?? "";
    const x = Math.max(0, Math.round(Number(position?.x) || 0));
    const y = Math.max(0, Math.round(Number(position?.y) || 0));

    this._selectedNodeId = id;
    this._selectedEdgeId = "";

    await this.document.update({
      [`system.nodes.${id}`]: {
        skillUuid: skill.uuid,
        branchId: firstBranchId,
        level: 1,
        position: { x, y }
      },
      "system.revision": Number(this.document.system?.revision ?? 1) + 1
    });
  }

  async _deleteEntry(collection, id) {
    if (!["branches", "milestones", "nodes", "edges"].includes(collection)) return;

    const current = this.document.system?.[collection] ?? {};
    if (!Object.hasOwn(current, id)) return;

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
