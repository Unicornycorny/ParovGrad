const TEMPLATE_TYPES = new Set(["circle", "cone", "ray", "rect"]);

export const SPELL_TEMPLATE_TYPE_LABELS = Object.freeze({
  circle: "Круг",
  cone: "Конус",
  ray: "Линия",
  rect: "Квадрат"
});

function normalizeNumber(value, fallback = 0, { min = 0, max = null } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  let result = Math.max(min, parsed);
  if (Number.isFinite(max)) result = Math.min(max, result);
  return result;
}

export function getSpellTemplateConfig(item) {
  const source = item?.system?.template ?? {};
  const type = TEMPLATE_TYPES.has(source.type) ? source.type : "circle";

  return {
    enabled: Boolean(source.enabled),
    type,
    distance: normalizeNumber(source.distance, 0),
    width: normalizeNumber(source.width, 0),
    angle: normalizeNumber(source.angle, 90, { min: 1, max: 360 })
  };
}

export function hasSpellTemplate(item) {
  const config = getSpellTemplateConfig(item);
  return config.enabled && config.distance > 0;
}

function getTemplateDistance(config) {
  // Foundry's native rectangle stores the diagonal length. In the spell sheet the
  // configured distance is intentionally the side of a square, which is easier for
  // a game author to reason about.
  if (config.type === "rect") return Math.hypot(config.distance, config.distance);
  return config.distance;
}

function buildTemplateData({ actor, item }) {
  const config = getSpellTemplateConfig(item);
  const gridDistance = Number(canvas?.dimensions?.distance) || 1;
  const width = config.width > 0 ? config.width : gridDistance;

  const data = {
    author: game.user.id,
    t: config.type,
    x: 0,
    y: 0,
    distance: getTemplateDistance(config),
    direction: config.type === "rect" ? 45 : 0,
    fillColor: game.user.color,
    flags: {
      ParovGrad: {
        spellTemplate: {
          actorUuid: actor?.uuid ?? null,
          itemUuid: item.uuid,
          itemName: item.name,
          configuredType: config.type,
          configuredDistance: config.distance,
          configuredWidth: width,
          configuredAngle: config.angle,
          targetTokenUuids: [],
          targetNames: []
        }
      }
    }
  };

  if (config.type === "cone") data.angle = config.angle;
  if (config.type === "ray") data.width = width;

  return data;
}

function getTokenCenter(token) {
  if (token?.center) return token.center;
  const document = token?.document ?? token;
  if (!document) return null;

  const gridSize = Number(canvas?.dimensions?.size) || 1;
  const width = Math.max(1, Number(document.width) || 1) * gridSize;
  const height = Math.max(1, Number(document.height) || 1) * gridSize;

  return {
    x: (Number(document.x) || 0) + width / 2,
    y: (Number(document.y) || 0) + height / 2
  };
}

function isEligibleTarget(token) {
  const document = token?.document ?? token;
  if (!document?.actor) return false;
  if (document.hidden && !game.user.isGM) return false;
  return true;
}

export function getTargetsForSpellTemplate(templateObject) {
  if (!templateObject?.testPoint) return [];

  // In Foundry V13 createEmbeddedDocuments resolves before the freshly created
  // canvas placeable has necessarily been drawn. testPoint() expects its shape
  // to exist and otherwise throws when accessing shape.contains(). Compute the
  // native geometry immediately, rather than waiting for an unrelated render.
  if (!templateObject.shape) {
    const shape = templateObject._computeShape?.();
    if (!shape) {
      console.warn("ParovGrad | Не удалось определить геометрию шаблона заклинания", templateObject);
      return [];
    }
    templateObject.shape = shape;
  }

  return (canvas.tokens?.placeables ?? []).filter((token) => {
    if (!isEligibleTarget(token)) return false;
    const center = getTokenCenter(token);
    return center ? templateObject.testPoint(center) : false;
  });
}

export function setUserTargets(tokens) {
  for (const target of Array.from(game.user.targets ?? [])) {
    target?.setTarget?.(false, { releaseOthers: false });
  }

  for (const token of tokens) {
    token?.setTarget?.(true, { releaseOthers: false });
  }
}

async function saveTemplateTargets(templateDocument, targets) {
  if (!templateDocument) return;

  const targetTokenUuids = targets
    .map((token) => token?.document?.uuid ?? token?.uuid ?? null)
    .filter(Boolean);
  const targetNames = targets
    .map((token) => token?.document?.name ?? token?.name ?? "")
    .filter(Boolean);

  await templateDocument.update({
    "flags.ParovGrad.spellTemplate.targetTokenUuids": targetTokenUuids,
    "flags.ParovGrad.spellTemplate.targetNames": targetNames
  });
}

class ParovGradSpellTemplatePreview extends foundry.canvas.placeables.MeasuredTemplate {
  #moveTime = 0;
  #initialLayer = null;
  #events = null;
  #previousContextMenu = null;
  #previousWheel = null;

  static fromSpell({ actor, item }) {
    if (!hasSpellTemplate(item) || !canvas?.scene) return null;

    const documentClass = CONFIG.MeasuredTemplate.documentClass;
    const document = new documentClass(buildTemplateData({ actor, item }), {
      parent: canvas.scene
    });

    return new this(document);
  }

  async drawPreview() {
    this.#initialLayer = canvas.activeLayer;

    await this.draw();
    this.layer.activate();
    this.layer.preview.addChild(this);

    return this.#activatePreviewListeners();
  }

  #activatePreviewListeners() {
    return new Promise((resolve) => {
      const view = canvas.app.view;

      this.#previousContextMenu = view.oncontextmenu;
      this.#previousWheel = view.onwheel;
      this.#events = {
        move: this.#onMovePlacement.bind(this),
        confirm: this.#onConfirmPlacement.bind(this),
        cancel: this.#onCancelPlacement.bind(this),
        rotate: this.#onRotatePlacement.bind(this),
        resolve
      };

      canvas.stage.on("mousemove", this.#events.move);
      canvas.stage.on("mouseup", this.#events.confirm);
      view.oncontextmenu = this.#events.cancel;
      view.onwheel = this.#events.rotate;
    });
  }

  async #finishPlacement(event) {
    this.layer.clearPreviewContainer();
    canvas.stage.off("mousemove", this.#events.move);
    canvas.stage.off("mouseup", this.#events.confirm);

    const view = canvas.app.view;
    view.oncontextmenu = this.#previousContextMenu;
    view.onwheel = this.#previousWheel;

    this.#initialLayer?.activate?.();
    event?.stopPropagation?.();
  }

  #onMovePlacement(event) {
    event.stopPropagation();

    const now = Date.now();
    if (now - this.#moveTime <= 20) return;

    const center = event.data.getLocalPosition(this.layer);
    const position = this.getSnappedPosition(center);
    this.document.updateSource(position);
    this.refresh();
    this.#moveTime = now;
  }

  #onRotatePlacement(event) {
    if (this.document.t === "circle" || this.document.t === "rect") return;

    if (event.ctrlKey) event.preventDefault();
    event.stopPropagation();

    const baseSnap = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
    const snap = event.shiftKey ? baseSnap : 5;
    const direction = this.document.direction + (snap * Math.sign(event.deltaY));

    this.document.updateSource({ direction });
    this.refresh();
  }

  async #onConfirmPlacement(event) {
    if (event.button !== undefined && event.button !== 0) return;

    await this.#finishPlacement(event);

    const destination = canvas.templates.getSnappedPoint({
      x: this.document.x,
      y: this.document.y
    });
    this.document.updateSource(destination);

    const created = await canvas.scene.createEmbeddedDocuments(
      "MeasuredTemplate",
      [this.document.toObject()]
    );

    this.#events.resolve(created?.[0] ?? null);
  }

  async #onCancelPlacement(event) {
    event?.preventDefault?.();
    await this.#finishPlacement(event);
    this.#events.resolve(null);
  }
}

export async function placeSpellTemplate({ actor, item, targetTokens = true } = {}) {
  if (!item || item.type !== "spell") return null;

  if (!hasSpellTemplate(item)) {
    ui.notifications?.warn("Для этого заклинания шаблон не настроен.");
    return null;
  }

  if (!canvas?.ready || !canvas.scene || !canvas.templates || !canvas.tokens) {
    ui.notifications?.warn("Для размещения шаблона откройте сцену.");
    return null;
  }

  const preview = ParovGradSpellTemplatePreview.fromSpell({ actor, item });
  if (!preview) return null;

  const templateDocument = await preview.drawPreview();
  if (!templateDocument) return null;

  const templateObject = canvas.templates.get(templateDocument.id) ?? templateDocument.object;
  const targets = templateObject ? getTargetsForSpellTemplate(templateObject) : [];

  if (targetTokens) setUserTargets(targets);
  await saveTemplateTargets(templateDocument, targets);

  return {
    templateDocument,
    templateObject,
    targets
  };
}
