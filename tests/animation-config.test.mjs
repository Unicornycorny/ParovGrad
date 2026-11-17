import test from "node:test";
import assert from "node:assert/strict";
import { importModule } from "./helpers/import-module.mjs";

class ApplicationV2 {
  constructor() { this.id = "animation-test"; this.rendered = false; }
  async _prepareContext() { return {}; }
  _attachPartListeners() {}
  async render() { this.context = await this._prepareContext({}); this.rendered = true; return this; }
  async close() { this.rendered = false; }
  bringToFront() { this.focused = true; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } }
};
const warnings = [];
globalThis.ui = { notifications: { warn: (message) => warnings.push(message), error() {} } };
globalThis.game = {};
const { openAnimationConfig, animationHeaderControl } = await importModule(
  new URL("../module/apps/animation-config.js", import.meta.url)
);

function item(overrides = {}) {
  return {
    id: "item", name: "Ледяная стрела", type: "spell", isOwner: true,
    flags: { ParovGrad: { animation: { enabled: true, projectile: "jb2a.arrow.physical.blue" } } },
    writes: [],
    async update(patch) {
      this.writes.push(structuredClone(patch));
      this.flags.ParovGrad.animation = patch["flags.ParovGrad.animation"];
    },
    ...overrides
  };
}

function controls(values = {}) {
  const fields = Object.fromEntries(Object.entries({
    enabled: true, cast: "", projectile: "jb2a.arrow.physical.blue", hit: "", miss: "",
    healing: "", area: "", scale: "1.5", opacity: "0.75", ...values
  }).map(([key, value]) => [key, {
    value, checked: value, disabled: false, reportValidity: () => true
  }]));
  return {
    querySelector: (selector) => fields[selector.match(/name="([^"]+)"/)?.[1]] ?? null,
    querySelectorAll: () => Object.values(fields)
  };
}

test("configuration works before optional modules are installed and saves only animation flags", async () => {
  game.parovgrad = undefined;
  const target = item();
  const app = await openAnimationConfig(target);
  assert.equal(app.context.hasEntries, false);
  assert.equal(app.context.preset.projectile, "jb2a.arrow.physical.blue");
  assert.equal(app.context.fields.some(({ key }) => key === "persistent"), false);
  await app._save(controls({ hit: " modules/JB2A_DnD5e/Library/impact.webm " }));
  assert.equal(target.writes.length, 1);
  assert.deepEqual(Object.keys(target.writes[0]), ["flags.ParovGrad.animation"]);
  assert.equal(target.flags.ParovGrad.animation.hit, "modules/JB2A_DnD5e/Library/impact.webm");
  assert.equal(target.flags.ParovGrad.animation.scale, 1.5);
  assert.equal(target.flags.ParovGrad.animation.opacity, .75);
  assert.equal(app.rendered, false);
});

test("catalog suggestions stay within JB2A and effect items expose persistent aura", async () => {
  game.parovgrad = { animations: { listEntries: () => [
    "jb2a.fireball", "other.animation", "jb2a.fireball", { key: "jb2a.aura.blue" }
  ] } };
  const target = item({ type: "effect" });
  const app = await openAnimationConfig(target);
  assert.deepEqual(app.context.entries, ["jb2a.aura.blue", "jb2a.fireball"]);
  assert.equal(app.context.fields.some(({ key }) => key === "persistent"), true);
  await app._save(controls({ persistent: "jb2a.aura.blue" }));
  assert.equal(target.flags.ParovGrad.animation.persistent, "jb2a.aura.blue");
});

test("an open configuration rechecks editing permission before saving", async () => {
  let editable = true;
  const target = item();
  const sheet = { document: target, get isEditable() { return editable; } };
  const header = animationHeaderControl(sheet);
  assert.equal(header.visible(), true);
  const app = await header.onClick();
  editable = false;
  assert.equal(header.visible(), false);
  await app._save(controls());
  assert.deepEqual(target.writes, []);
  assert.equal(app.rendered, true);
  assert.equal(warnings.length, 1);
});

test("closing without saving leaves the existing preset intact", async () => {
  const target = item();
  const app = await openAnimationConfig(target);
  assert.equal(await openAnimationConfig(target), app);
  assert.equal(app.focused, true);
  await app.close();
  assert.deepEqual(target.writes, []);
  const reopened = await openAnimationConfig(target);
  assert.equal(reopened.context.preset.projectile, "jb2a.arrow.physical.blue");
});
