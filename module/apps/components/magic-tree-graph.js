const MIN_SCALE = 0.35;
const MAX_SCALE = 2.25;
const DEFAULT_SCALE = 0.9;
const DEFAULT_PAN_X = 56;
const DEFAULT_PAN_Y = 64;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

/**
 * DOM controller for the magic-tree graph.
 *
 * The class intentionally knows nothing about Foundry Documents. It only owns
 * pan/zoom, node dragging, edge geometry and selection events so the same graph
 * can later be reused by Spell Builder in a read/select mode.
 */
export class MagicTreeGraphView {
  constructor({
    root,
    editable = false,
    initialState = null,
    connectMode = false,
    connectSourceId = "",
    onViewStateChange = null,
    onNodeSelect = null,
    onEdgeSelect = null,
    onNodeMove = null,
    onConnectNode = null,
    onClearSelection = null
  } = {}) {
    this.root = root;
    this.viewport = root?.querySelector?.(".pg-magic-tree-viewport") ?? null;
    this.world = root?.querySelector?.(".pg-magic-tree-world") ?? null;
    this.editable = Boolean(editable);
    this.connectMode = Boolean(connectMode);
    this.connectSourceId = String(connectSourceId ?? "");

    this.onViewStateChange = onViewStateChange;
    this.onNodeSelect = onNodeSelect;
    this.onEdgeSelect = onEdgeSelect;
    this.onNodeMove = onNodeMove;
    this.onConnectNode = onConnectNode;
    this.onClearSelection = onClearSelection;

    this.state = {
      x: Number(initialState?.x ?? DEFAULT_PAN_X),
      y: Number(initialState?.y ?? DEFAULT_PAN_Y),
      scale: clamp(Number(initialState?.scale ?? DEFAULT_SCALE), MIN_SCALE, MAX_SCALE)
    };

    this._abortController = new AbortController();
    this._resizeObserver = null;
    this._raf = null;
    this._panning = null;
    this._draggingNode = null;
    this._skipNodeClickId = "";
  }

  mount({ fitOnMount = false } = {}) {
    if (!(this.viewport instanceof HTMLElement) || !(this.world instanceof HTMLElement)) return false;

    this._bindViewport();
    this._bindNodes();
    this._bindEdges();
    this._observeResize();
    this._applyTransform();
    this._scheduleEdgeRedraw();

    if (fitOnMount) {
      requestAnimationFrame(() => this.fitToContent());
    }

    return true;
  }

  destroy() {
    this._abortController.abort();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;

    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  get viewState() {
    return { ...this.state };
  }

  setConnectMode(enabled, sourceId = "") {
    this.connectMode = Boolean(enabled);
    this.connectSourceId = String(sourceId ?? "");
    this.root?.classList.toggle("is-connecting", this.connectMode);
    this._syncConnectionSourceClass();
  }

  zoomBy(factor, center = null) {
    if (!(this.viewport instanceof HTMLElement)) return;

    const rect = this.viewport.getBoundingClientRect();
    const localPoint = center ?? { x: rect.width / 2, y: rect.height / 2 };
    const oldScale = this.state.scale;
    const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
    if (Math.abs(newScale - oldScale) < 0.0001) return;

    const worldX = (localPoint.x - this.state.x) / oldScale;
    const worldY = (localPoint.y - this.state.y) / oldScale;

    this.state.scale = newScale;
    this.state.x = localPoint.x - worldX * newScale;
    this.state.y = localPoint.y - worldY * newScale;
    this._applyTransform(true);
  }

  resetView() {
    this.state = {
      x: DEFAULT_PAN_X,
      y: DEFAULT_PAN_Y,
      scale: DEFAULT_SCALE
    };
    this._applyTransform(true);
  }

  fitToContent({ padding = 84 } = {}) {
    if (!(this.viewport instanceof HTMLElement)) return;

    const bounds = this._getContentBounds();
    if (!bounds) {
      this.resetView();
      return;
    }

    const viewportRect = this.viewport.getBoundingClientRect();
    const availableWidth = Math.max(160, viewportRect.width - padding * 2);
    const availableHeight = Math.max(160, viewportRect.height - padding * 2);
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);

    const scale = clamp(
      Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1.15),
      MIN_SCALE,
      MAX_SCALE
    );

    const renderedWidth = contentWidth * scale;
    const renderedHeight = contentHeight * scale;

    this.state.scale = scale;
    this.state.x = (viewportRect.width - renderedWidth) / 2 - bounds.minX * scale;
    this.state.y = (viewportRect.height - renderedHeight) / 2 - bounds.minY * scale;
    this._applyTransform(true);
  }

  focusNode(nodeId) {
    if (!(this.viewport instanceof HTMLElement)) return;

    const node = this._getNodeElement(nodeId);
    if (!(node instanceof HTMLElement)) return;

    const viewportRect = this.viewport.getBoundingClientRect();
    const box = this._getNodeBox(node);
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    this.state.x = viewportRect.width / 2 - centerX * this.state.scale;
    this.state.y = viewportRect.height / 2 - centerY * this.state.scale;
    this._applyTransform(true);
  }

  getViewportCenterWorldPosition() {
    if (!(this.viewport instanceof HTMLElement)) return { x: 0, y: 0 };
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: roundCoordinate((rect.width / 2 - this.state.x) / this.state.scale),
      y: roundCoordinate((rect.height / 2 - this.state.y) / this.state.scale)
    };
  }

  redrawEdges() {
    if (!(this.world instanceof HTMLElement)) return;

    for (const edge of this.world.querySelectorAll(".pg-magic-tree-edge")) {
      const fromId = edge.dataset.fromId;
      const toId = edge.dataset.toId;
      const source = this._getNodeElement(fromId);
      const target = this._getNodeElement(toId);
      const visiblePath = edge.querySelector(".pg-magic-tree-edge__line");
      const hitPath = edge.querySelector(".pg-magic-tree-edge__hit");

      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        edge.classList.add("is-invalid");
        visiblePath?.removeAttribute("d");
        hitPath?.removeAttribute("d");
        continue;
      }

      const sourceBox = this._getNodeBox(source);
      const targetBox = this._getNodeBox(target);
      if (!sourceBox || !targetBox) continue;

      const sourceCenterX = sourceBox.x + sourceBox.width / 2;
      const targetCenterX = targetBox.x + targetBox.width / 2;
      const pointsRight = targetCenterX >= sourceCenterX;

      const startX = pointsRight ? sourceBox.x + sourceBox.width : sourceBox.x;
      const startY = sourceBox.y + sourceBox.height / 2;
      const endX = pointsRight ? targetBox.x : targetBox.x + targetBox.width;
      const endY = targetBox.y + targetBox.height / 2;
      const controlDistance = Math.max(72, Math.abs(endX - startX) * 0.45);
      const direction = pointsRight ? 1 : -1;
      const control1X = startX + controlDistance * direction;
      const control2X = endX - controlDistance * direction;
      const path = `M ${startX} ${startY} C ${control1X} ${startY}, ${control2X} ${endY}, ${endX} ${endY}`;

      edge.classList.remove("is-invalid");
      visiblePath?.setAttribute("d", path);
      hitPath?.setAttribute("d", path);
    }
  }

  _bindViewport() {
    const signal = this._abortController.signal;

    this.viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();

        const rect = this.viewport.getBoundingClientRect();
        const center = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, center);
      },
      { passive: false, signal }
    );

    this.viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        if (event.target.closest(".pg-magic-tree-node, .pg-magic-tree-edge, button, input, select, textarea, label")) return;

        event.preventDefault();
        this.viewport.setPointerCapture?.(event.pointerId);
        this._panning = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          panX: this.state.x,
          panY: this.state.y,
          moved: false
        };
      },
      { signal }
    );

    this.viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!this._panning || this._panning.pointerId !== event.pointerId) return;

        const dx = event.clientX - this._panning.startX;
        const dy = event.clientY - this._panning.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) this._panning.moved = true;

        this.state.x = this._panning.panX + dx;
        this.state.y = this._panning.panY + dy;
        this._applyTransform(true);
      },
      { signal }
    );

    const finishPan = (event) => {
      if (!this._panning || this._panning.pointerId !== event.pointerId) return;

      const moved = this._panning.moved;
      this._panning = null;
      this.viewport.releasePointerCapture?.(event.pointerId);

      if (!moved) this.onClearSelection?.();
    };

    this.viewport.addEventListener("pointerup", finishPan, { signal });
    this.viewport.addEventListener("pointercancel", finishPan, { signal });
  }

  _bindNodes() {
    const signal = this._abortController.signal;

    for (const node of this.world.querySelectorAll(".pg-magic-tree-node")) {
      node.addEventListener(
        "pointerdown",
        (event) => {
          if (!this.editable || this.connectMode || event.button !== 0) return;
          if (event.target.closest("button, input, select, textarea")) return;

          const nodeId = node.dataset.nodeId;
          if (!nodeId) return;

          event.preventDefault();
          event.stopPropagation();
          node.setPointerCapture?.(event.pointerId);

          this._draggingNode = {
            pointerId: event.pointerId,
            nodeId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: Number(node.dataset.nodeX ?? 0),
            startY: Number(node.dataset.nodeY ?? 0),
            moved: false
          };
          node.classList.add("is-dragging");
        },
        { signal }
      );

      node.addEventListener(
        "pointermove",
        (event) => {
          const drag = this._draggingNode;
          if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== node.dataset.nodeId) return;

          const dx = (event.clientX - drag.startClientX) / this.state.scale;
          const dy = (event.clientY - drag.startClientY) / this.state.scale;
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;

          const x = roundCoordinate(drag.startX + dx);
          const y = roundCoordinate(drag.startY + dy);
          node.dataset.nodeX = String(x);
          node.dataset.nodeY = String(y);
          node.style.left = `${x}px`;
          node.style.top = `${y}px`;
          this.redrawEdges();
        },
        { signal }
      );

      const finishDrag = (event) => {
        const drag = this._draggingNode;
        if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== node.dataset.nodeId) return;

        node.classList.remove("is-dragging");
        node.releasePointerCapture?.(event.pointerId);
        this._draggingNode = null;

        if (!drag.moved) return;

        this._skipNodeClickId = drag.nodeId;
        const position = {
          x: roundCoordinate(node.dataset.nodeX),
          y: roundCoordinate(node.dataset.nodeY)
        };
        this.onNodeMove?.(drag.nodeId, position);
      };

      node.addEventListener("pointerup", finishDrag, { signal });
      node.addEventListener("pointercancel", finishDrag, { signal });

      node.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          const nodeId = node.dataset.nodeId;
          if (!nodeId) return;

          if (this._skipNodeClickId === nodeId) {
            this._skipNodeClickId = "";
            return;
          }

          if (this.connectMode) {
            this.onConnectNode?.(nodeId);
            return;
          }

          this.onNodeSelect?.(nodeId);
        },
        { signal }
      );
    }

    this.root?.classList.toggle("is-connecting", this.connectMode);
    this._syncConnectionSourceClass();
  }

  _bindEdges() {
    const signal = this._abortController.signal;

    for (const edge of this.world.querySelectorAll(".pg-magic-tree-edge")) {
      edge.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const edgeId = edge.dataset.edgeId;
          if (edgeId) this.onEdgeSelect?.(edgeId);
        },
        { signal }
      );
    }
  }

  _observeResize() {
    if (typeof ResizeObserver !== "function") return;

    this._resizeObserver = new ResizeObserver(() => this._scheduleEdgeRedraw());
    this._resizeObserver.observe(this.viewport);
    for (const node of this.world.querySelectorAll(".pg-magic-tree-node")) {
      this._resizeObserver.observe(node);
    }
  }

  _scheduleEdgeRedraw() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.redrawEdges();
    });
  }

  _applyTransform(notify = false) {
    if (!(this.world instanceof HTMLElement)) return;

    this.world.style.transform = `translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
    const zoomValue = this.root?.querySelector?.(".pg-magic-tree-zoom-value");
    if (zoomValue) zoomValue.textContent = `${Math.round(this.state.scale * 100)}%`;

    if (notify) this.onViewStateChange?.(this.viewState);
  }

  _getContentBounds() {
    const boxes = [];

    for (const node of this.world.querySelectorAll(".pg-magic-tree-node")) {
      const box = this._getNodeBox(node);
      if (box) boxes.push(box);
    }

    for (const milestone of this.world.querySelectorAll(".pg-magic-tree-milestone")) {
      const x = Number(milestone.dataset.milestoneX ?? 0);
      if (Number.isFinite(x)) boxes.push({ x: x - 36, y: 0, width: 72, height: 100 });
    }

    if (!boxes.length) return null;

    return {
      minX: Math.min(...boxes.map((box) => box.x)) - 48,
      minY: Math.min(...boxes.map((box) => box.y)) - 48,
      maxX: Math.max(...boxes.map((box) => box.x + box.width)) + 48,
      maxY: Math.max(...boxes.map((box) => box.y + box.height)) + 48
    };
  }

  _getNodeElement(nodeId) {
    if (!nodeId || !(this.world instanceof HTMLElement)) return null;
    return Array.from(this.world.querySelectorAll(".pg-magic-tree-node")).find(
      (node) => node.dataset.nodeId === nodeId
    ) ?? null;
  }

  _getNodeBox(node) {
    if (!(node instanceof HTMLElement)) return null;

    const x = Number(node.dataset.nodeX ?? 0);
    const y = Number(node.dataset.nodeY ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return {
      x,
      y,
      width: Math.max(1, node.offsetWidth),
      height: Math.max(1, node.offsetHeight)
    };
  }

  _syncConnectionSourceClass() {
    if (!(this.world instanceof HTMLElement)) return;

    for (const node of this.world.querySelectorAll(".pg-magic-tree-node")) {
      node.classList.toggle("is-connection-source", node.dataset.nodeId === this.connectSourceId);
    }
  }
}
