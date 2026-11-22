// Генератор инженерных рисунков для листов ParovGrad (гравюра-чертёж: шестерни,
// паровая машина, штангенциркуль, шкала манометра).
// Результат: assets/ornaments/*.svg — одноцветная графика (чёрное на прозрачном),
// в CSS используется только как mask-image, цвет берётся из токена краски.
//
// Запуск из корня системы:  node tools/build-ornaments.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "assets", "ornaments");
mkdirSync(OUT, { recursive: true });

const r2 = (n) => Math.round(n * 100) / 100;
const P = (cx, cy, r, a) => [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
const pt = ([x, y]) => `${x} ${y}`;
const deg = (d) => (d * Math.PI) / 180;

const STROKE = 'fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"';
const FONT = 'font-family="Georgia, \'Times New Roman\', serif" font-style="italic"';

function svg(w, h, body, defs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>
  <pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="3" stroke="#000" stroke-width="0.7"/>
  </pattern>
  <pattern id="hatch-fine" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    <line x1="0" y1="0" x2="0" y2="2.2" stroke="#000" stroke-width="0.45"/>
  </pattern>
  <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 2 L10 5 L0 8 Z" fill="#000"/>
  </marker>
  ${defs}
</defs>
${body}
</svg>
`;
}

/** Spur gear outline with arc roots and tips. Phase = angle of the first tooth centre. */
function gearPath(cx, cy, z, m, phase = 0) {
  const rp = (z * m) / 2;
  const ro = rp + m;
  const rr = rp - 1.25 * m;
  const pitch = (2 * Math.PI) / z;
  const ht = pitch * 0.17; // half tip width
  const hr = pitch * 0.29; // half root width
  let d = "";
  for (let i = 0; i < z; i++) {
    const a = phase + i * pitch;
    const rootIn = P(cx, cy, rr, a - hr);
    const tipIn = P(cx, cy, ro, a - ht);
    const tipOut = P(cx, cy, ro, a + ht);
    const rootOut = P(cx, cy, rr, a + hr);
    const nextRoot = P(cx, cy, rr, a + pitch - hr);
    d += `${i === 0 ? "M" : "L"}${pt(rootIn)} L${pt(tipIn)} A${ro} ${ro} 0 0 1 ${pt(tipOut)} L${pt(rootOut)} A${rr} ${rr} 0 0 1 ${pt(nextRoot)} `;
  }
  return { d: `${d}Z`, rp, ro, rr };
}

const circle = (cx, cy, r, extra = "") => `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" ${extra}/>`;
const line = (x1, y1, x2, y2, extra = "") => `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" ${extra}/>`;
const annulus = (cx, cy, r1, r2_) =>
  `M${r2(cx + r1)} ${r2(cy)} A${r1} ${r1} 0 1 0 ${r2(cx - r1)} ${r2(cy)} A${r1} ${r1} 0 1 0 ${r2(cx + r1)} ${r2(cy)} Z ` +
  `M${r2(cx + r2_)} ${r2(cy)} A${r2_} ${r2_} 0 1 1 ${r2(cx - r2_)} ${r2(cy)} A${r2_} ${r2_} 0 1 1 ${r2(cx + r2_)} ${r2(cy)} Z`;

/** Dash-dot centre lines through a point. */
function centreLines(cx, cy, r) {
  const s = 'stroke="#000" stroke-width="0.55" stroke-dasharray="9 2.5 1.5 2.5" fill="none"';
  return line(cx - r, cy, cx + r, cy, s) + line(cx, cy - r, cx, cy + r, s);
}

/** Callout bubble with leader line (позиция на чертеже). */
function callout(n, bx, by, tx, ty) {
  return `<g>${line(tx, ty, bx, by, 'stroke="#000" stroke-width="0.6"')}${circle(tx, ty, 1.4, 'fill="#000"')}` +
    `${circle(bx, by, 7.5, 'fill="none" stroke="#000" stroke-width="0.9"')}` +
    `<text x="${bx}" y="${by + 3.4}" text-anchor="middle" font-size="9.5" ${FONT} fill="#000">${n}</text></g>`;
}

/** Engraved gear: outline, rim, web (spokes or holes), hub with keyway, shading. */
function gear({ cx, cy, z, m, phase = 0, web = "spokes", spokes = 6, curved = false, shade = 30 }) {
  const g = gearPath(cx, cy, z, m, phase);
  const rim = g.rr - Math.max(3, m * 0.9);
  const hub = Math.max(7, g.rp * 0.24);
  const bore = hub * 0.48;
  const clipId = `shade-${cx}-${cy}`.replace(/\./g, "_");
  let out = `<path d="${g.d}" ${STROKE} stroke-width="1.25"/>`;
  out += circle(cx, cy, rim, `${STROKE} stroke-width="0.9"`);
  // Rim shading on the lower-right half: engraving volume.
  out += `<clipPath id="${clipId}"><rect x="${cx - g.ro}" y="${cy}" width="${g.ro * 2}" height="${g.ro}" transform="rotate(${shade} ${cx} ${cy})"/></clipPath>`;
  out += `<path d="${annulus(cx, cy, g.rr, rim)}" fill="url(#hatch-fine)" fill-rule="evenodd" clip-path="url(#${clipId})"/>`;
  if (web === "spokes") {
    for (let i = 0; i < spokes; i++) {
      const a = phase + (i * 2 * Math.PI) / spokes + Math.PI / spokes;
      const wh = hub * 0.55; // half-width at hub (as angle via asin)
      const wr = hub * 0.32;
      const ah = Math.asin(Math.min(0.95, wh / (hub + 2)));
      const ar = Math.asin(Math.min(0.95, wr / rim));
      const bend = curved ? 0.35 : 0;
      const h1 = P(cx, cy, hub + 2, a - ah);
      const h2 = P(cx, cy, hub + 2, a + ah);
      const r1 = P(cx, cy, rim, a - ar + bend * 0.25);
      const r2p = P(cx, cy, rim, a + ar + bend * 0.25);
      if (curved) {
        const c1 = P(cx, cy, (hub + rim) / 2, a - ah * 0.5 + bend);
        const c2 = P(cx, cy, (hub + rim) / 2, a + ah * 0.5 + bend);
        out += `<path d="M${pt(h1)} Q${pt(c1)} ${pt(r1)} M${pt(h2)} Q${pt(c2)} ${pt(r2p)}" ${STROKE} stroke-width="0.9"/>`;
      } else {
        out += `<path d="M${pt(h1)} L${pt(r1)} M${pt(h2)} L${pt(r2p)}" ${STROKE} stroke-width="0.9"/>`;
        // Shade one flank of each spoke.
        const s1 = P(cx, cy, hub + 4, a + ah * 0.3);
        const s2 = P(cx, cy, rim - 2, a + ar * 0.3);
        out += line(s1[0], s1[1], s2[0], s2[1], 'stroke="#000" stroke-width="0.45"');
      }
    }
  } else {
    const holes = spokes;
    const rh = (rim - hub) * 0.32;
    const rc = (rim + hub + 2) / 2;
    for (let i = 0; i < holes; i++) {
      const a = phase + (i * 2 * Math.PI) / holes;
      const [hx, hy] = P(cx, cy, rc, a);
      out += circle(hx, hy, rh, `${STROKE} stroke-width="0.85"`);
      out += `<path d="M${r2(hx - rh * 0.7)} ${r2(hy + rh * 0.2)} A${rh * 0.75} ${rh * 0.75} 0 0 0 ${r2(hx + rh * 0.2)} ${r2(hy + rh * 0.72)}" ${STROKE} stroke-width="0.45"/>`;
    }
  }
  // Hub as a cut section (hatched), bore and keyway.
  out += `<path d="${annulus(cx, cy, hub, bore)}" fill="url(#hatch)" fill-rule="evenodd"/>`;
  out += circle(cx, cy, hub, `${STROKE} stroke-width="1"`) + circle(cx, cy, bore, `${STROKE} stroke-width="0.9"`);
  out += `<rect x="${r2(cx - bore * 0.28)}" y="${r2(cy - bore - bore * 0.38)}" width="${r2(bore * 0.56)}" height="${r2(bore * 0.5)}" ${STROKE} stroke-width="0.8"/>`;
  out += centreLines(cx, cy, g.ro + 8);
  return { svg: out, ...g };
}

/** Phase that interleaves gear B with gear A along the line of centres. */
function meshPhase(aPhase, zA, zB, angleAB) {
  const pitchA = (2 * Math.PI) / zA;
  const pitchB = (2 * Math.PI) / zB;
  // Gear A tooth offset relative to the centre line.
  const k = Math.round((angleAB - aPhase) / pitchA);
  const offsetA = angleAB - (aPhase + k * pitchA);
  // B must present a gap where A presents a tooth (rotated by ratio).
  const back = angleAB + Math.PI;
  return back + pitchB / 2 - offsetA * (zA / zB);
}

function dimH(x1, x2, y, label, ext1 = null, ext2 = null) {
  const s = 'stroke="#000" stroke-width="0.6" fill="none"';
  let out = "";
  if (ext1 !== null) out += line(x1, ext1, x1, y - 3, s);
  if (ext2 !== null) out += line(x2, ext2, x2, y - 3, s);
  out += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ${s} marker-start="url(#arrow)" marker-end="url(#arrow)"/>`;
  out += `<text x="${(x1 + x2) / 2}" y="${y - 3}" text-anchor="middle" font-size="9" ${FONT} fill="#000">${label}</text>`;
  return out;
}

/* ---------------------------------------------------------------------------
   1. Gear train — illustration for the stats column of the character sheet.
   --------------------------------------------------------------------------- */
function gearTrain() {
  const W = 220;
  const H = 380;
  const m = 5;
  const g1 = { cx: 116, cy: 128, z: 26, m, phase: deg(-90), web: "spokes", spokes: 6, curved: true, shade: 25 };
  const a12 = deg(58);
  const d12 = ((g1.z + 12) * m) / 2;
  const g2 = { cx: r2(g1.cx + d12 * Math.cos(a12)), cy: r2(g1.cy + d12 * Math.sin(a12)), z: 12, m, web: "holes", spokes: 4, shade: 10 };
  g2.phase = meshPhase(g1.phase, g1.z, g2.z, a12);
  const a23 = deg(122);
  const d23 = ((g2.z + 18) * m) / 2;
  const g3 = { cx: r2(g2.cx + d23 * Math.cos(a23)), cy: r2(g2.cy + d23 * Math.sin(a23)), z: 18, m, web: "spokes", spokes: 5, shade: 40 };
  g3.phase = meshPhase(g2.phase, g2.z, g3.z, a23);

  const G1 = gear(g1);
  const G2 = gear(g2);
  const G3 = gear(g3);

  // Steam pipe down the left margin with flanges, elbow and a hand-wheel valve.
  const px = 20;
  const pipe = [];
  const pw = 5;
  pipe.push(`<path d="M${px - pw} 0 V${H - 40} Q${px - pw} ${H - 22} ${px + 12} ${H - 22} H70 M${px + pw} 0 V${H - 44} Q${px + pw} ${H - 32} ${px + 14} ${H - 32} H70" ${STROKE} stroke-width="1.1"/>`);
  // Pipe shading (cylinder): a few lines along the right flank.
  pipe.push(line(px + 2.5, 0, px + 2.5, H - 46, 'stroke="#000" stroke-width="0.45"'));
  pipe.push(line(px + 3.8, 0, px + 3.8, H - 46, 'stroke="#000" stroke-width="0.45"'));
  for (const fy of [70, 190, 290]) {
    pipe.push(`<rect x="${px - 10}" y="${fy}" width="20" height="6" ${STROKE} stroke-width="1"/>`);
    pipe.push(`<rect x="${px - 10}" y="${fy}" width="20" height="6" fill="url(#hatch-fine)"/>`);
    pipe.push(circle(px - 7, fy + 3, 1.1, 'fill="#000"') + circle(px + 7, fy + 3, 1.1, 'fill="#000"'));
  }
  // Valve body and wheel.
  const vx = 86;
  const vy = H - 27;
  pipe.push(`<path d="M70 ${H - 35} H76 V${H - 19} H70" ${STROKE} stroke-width="1"/>`);
  pipe.push(`<path d="M76 ${H - 38} H96 V${H - 16} H76 Z" ${STROKE} stroke-width="1.1"/>`);
  pipe.push(`<path d="M76 ${H - 38} H96 V${H - 16} H76 Z" fill="url(#hatch-fine)" opacity="0.55"/>`);
  pipe.push(`<path d="M96 ${H - 35} H104 V${H - 19} H96 M104 ${H - 32} H124 M104 ${H - 22} H124" ${STROKE} stroke-width="1"/>`);
  pipe.push(line(vx, vy - 11, vx, vy - 30, `${STROKE} stroke-width="1.6"`));
  pipe.push(`<ellipse cx="${vx}" cy="${vy - 32}" rx="16" ry="4.5" ${STROKE} stroke-width="1.1"/>`);
  pipe.push(`<ellipse cx="${vx}" cy="${vy - 32}" rx="3" ry="1.2" ${STROKE} stroke-width="0.8"/>`);
  for (const a of [0, 60, 120]) {
    const [x1, y1] = [vx + 16 * Math.cos(deg(a)), vy - 32 + 4.5 * Math.sin(deg(a))];
    const [x2, y2] = [vx - 16 * Math.cos(deg(a)), vy - 32 - 4.5 * Math.sin(deg(a))];
    pipe.push(line(x1, y1, x2, y2, 'stroke="#000" stroke-width="0.6"'));
  }

  // Pressure gauge tapped into the pipe.
  const gx = px + 30;
  const gy = 250;
  pipe.push(`<path d="M${px + pw} ${gy} H${gx - 11}" ${STROKE} stroke-width="1"/>`);
  pipe.push(circle(gx, gy, 11, `${STROKE} stroke-width="1.2"`) + circle(gx, gy, 8.5, `${STROKE} stroke-width="0.6"`));
  for (let i = 0; i <= 8; i++) {
    const a = deg(135 + i * 33.75);
    const [x1, y1] = P(gx, gy, 8.5, a);
    const [x2, y2] = P(gx, gy, i % 4 === 0 ? 5.5 : 7, a);
    pipe.push(line(x1, y1, x2, y2, 'stroke="#000" stroke-width="0.55"'));
  }
  const [nx, ny] = P(gx, gy, 6.5, deg(300));
  pipe.push(line(gx, gy, nx, ny, 'stroke="#000" stroke-width="0.9"') + circle(gx, gy, 1.3, 'fill="#000"'));

  // Dimension of the main wheel and drawing notes.
  const dim = dimH(r2(g1.cx - G1.rp), r2(g1.cx + G1.rp), 34, "Ø 130", g1.cy - 6, g1.cy - 6);
  const notes =
    callout(1, 196, 36, g1.cx + 30, g1.cy - 36) +
    callout(2, 206, 250, g2.cx + 12, g2.cy + 14) +
    callout(3, 196, 340, g3.cx + 22, g3.cy + 30) +
    `<text x="${W - 4}" y="${H - 4}" text-anchor="end" font-size="8.5" ${FONT} fill="#000">Черт. № 7 · М 1:4</text>`;

  return svg(W, H, `${pipe.join("")}${G3.svg}${G2.svg}${G1.svg}${dim}${notes}`);
}

/* ---------------------------------------------------------------------------
   2. Steam engine section — art for the title block of the character sheet.
   --------------------------------------------------------------------------- */
function steamEngine() {
  const W = 300;
  const H = 124;
  const o = [];
  const ax = 63; // cylinder axis
  // Ground and bed plate.
  o.push(line(4, 110, 296, 110, `${STROKE} stroke-width="1.2"`));
  for (let x = 8; x < 296; x += 7) o.push(line(x, 110, x - 5, 116, 'stroke="#000" stroke-width="0.5"'));
  o.push(`<rect x="12" y="98" width="276" height="12" ${STROKE} stroke-width="1.1"/>`);
  o.push(`<rect x="12" y="98" width="276" height="12" fill="url(#hatch-fine)" opacity="0.6"/>`);
  for (const bx of [24, 108, 206, 276]) o.push(`<rect x="${bx - 3}" y="94" width="6" height="4" ${STROKE} stroke-width="0.8"/>`);
  // Cylinder supports.
  o.push(`<path d="M30 86 L26 98 M110 86 L114 98" ${STROKE} stroke-width="1"/>`);
  // Cylinder in section: walls hatched.
  o.push(`<rect x="20" y="40" width="100" height="46" ${STROKE} stroke-width="1.3"/>`);
  o.push(`<path d="M20 40 H120 V46 H20 Z M20 80 H120 V86 H20 Z M20 46 H26 V80 H20 Z" fill="url(#hatch)"/>`);
  o.push(`<rect x="26" y="46" width="94" height="34" ${STROKE} stroke-width="0.8"/>`);
  // Piston with rings.
  o.push(`<rect x="58" y="47" width="16" height="32" ${STROKE} stroke-width="1"/>`);
  o.push(`<rect x="58" y="47" width="16" height="32" fill="url(#hatch)" opacity="0.8"/>`);
  for (const ry of [52, 74]) o.push(line(58, ry, 74, ry, 'stroke="#000" stroke-width="0.9"'));
  // Piston rod, gland.
  o.push(`<rect x="74" y="${ax - 2.5}" width="104" height="5" ${STROKE} stroke-width="0.9"/>`);
  o.push(`<rect x="120" y="52" width="12" height="22" ${STROKE} stroke-width="1"/>`);
  o.push(`<rect x="120" y="52" width="12" height="22" fill="url(#hatch-fine)"/>`);
  // Steam chest, inlet pipe, valve wheel.
  o.push(`<rect x="38" y="24" width="74" height="16" ${STROKE} stroke-width="1.1"/>`);
  o.push(`<path d="M50 40 V46 M100 40 V46" ${STROKE} stroke-width="0.8"/>`);
  o.push(`<path d="M98 24 V10 M106 24 V10" ${STROKE} stroke-width="1"/>`);
  o.push(`<rect x="93" y="6" width="18" height="4" ${STROKE} stroke-width="1"/>`);
  o.push(`<ellipse cx="102" cy="3.5" rx="11" ry="2.4" ${STROKE} stroke-width="0.9"/>`);
  // Crosshead guides and crosshead.
  o.push(`<path d="M146 54 H196 M146 72 H196" ${STROKE} stroke-width="1.1"/>`);
  o.push(`<path d="M146 50 V76 M196 50 V76" ${STROKE} stroke-width="0.8"/>`);
  o.push(`<rect x="168" y="55" width="16" height="16" ${STROKE} stroke-width="1"/>`);
  o.push(circle(176, ax, 2.2, `${STROKE} stroke-width="0.9"`));
  // Flywheel.
  const fx = 244;
  const fy = 56;
  o.push(circle(fx, fy, 42, `${STROKE} stroke-width="1.4"`) + circle(fx, fy, 36, `${STROKE} stroke-width="0.9"`));
  o.push(`<path d="${annulus(fx, fy, 42, 36)}" fill="url(#hatch-fine)" fill-rule="evenodd" opacity="0.75"/>`);
  for (let i = 0; i < 6; i++) {
    const a = deg(i * 60 + 15);
    const [x1, y1] = P(fx, fy, 8, a);
    const [x2, y2] = P(fx, fy, 36, a);
    o.push(line(x1, y1, x2, y2, `${STROKE} stroke-width="2.2"`));
  }
  o.push(circle(fx, fy, 8, `${STROKE} stroke-width="1.1"`) + circle(fx, fy, 3, 'fill="#000"'));
  // Crank and connecting rod.
  const [cx2, cy2] = P(fx, fy, 22, deg(200));
  o.push(line(fx, fy, cx2, cy2, `${STROKE} stroke-width="3"`));
  o.push(circle(cx2, cy2, 3, `${STROKE} stroke-width="1"`));
  o.push(line(176, ax, cx2, cy2, `${STROKE} stroke-width="2.6"`));
  // Pedestal.
  o.push(`<path d="M228 98 L236 62 M260 98 L252 62" ${STROKE} stroke-width="1.1"/>`);
  // Centre lines.
  const cl = 'stroke="#000" stroke-width="0.55" stroke-dasharray="9 2.5 1.5 2.5" fill="none"';
  o.push(line(8, ax, 206, ax, cl));
  o.push(centreLines(fx, fy, 50));
  // Dimension: stroke of the piston.
  o.push(dimH(20, 88, 18, "L = 94", 40, 40));
  // Callouts.
  o.push(callout(1, 140, 26, 112, 32) + callout(2, 132, 96, 66, 76) + callout(3, 214, 18, fx - 26, fy - 26));
  return svg(W, H, o.join(""));
}

/* ---------------------------------------------------------------------------
   3. Vernier caliper — art for the title block of item passports.
   --------------------------------------------------------------------------- */
function caliper() {
  const W = 300;
  const H = 110;
  const o = [];
  const by = 34;
  const bh = 14;
  // Beam.
  o.push(`<rect x="14" y="${by}" width="270" height="${bh}" ${STROKE} stroke-width="1.2"/>`);
  for (let i = 0; i <= 60; i++) {
    const x = 40 + i * 4;
    const len = i % 10 === 0 ? 6 : i % 5 === 0 ? 4.2 : 2.6;
    o.push(line(x, by, x, by + len, 'stroke="#000" stroke-width="0.5"'));
    if (i % 10 === 0) o.push(`<text x="${x}" y="${by + 12.5}" text-anchor="middle" font-size="5.5" ${FONT} fill="#000">${i / 10}</text>`);
  }
  // Depth rod.
  o.push(`<path d="M284 ${by + 6} H296 M284 ${by + 8} H296" ${STROKE} stroke-width="0.7"/>`);
  // Fixed jaw (lower long, upper short).
  o.push(`<path d="M14 ${by} V${by - 22} L22 ${by - 26} L26 ${by - 22} V${by} M14 ${by + bh} V${by + 54} L24 ${by + 64} L32 ${by + 54} V${by + bh}" ${STROKE} stroke-width="1.2"/>`);
  o.push(`<path d="M14 ${by + bh} V${by + 54} L24 ${by + 64} L32 ${by + 54} V${by + bh} Z" fill="url(#hatch-fine)" opacity="0.7"/>`);
  // Sliding jaw.
  const sx = 112;
  o.push(`<rect x="${sx}" y="${by - 5}" width="44" height="${bh + 10}" ${STROKE} stroke-width="1.2"/>`);
  o.push(`<path d="M${sx} ${by + bh + 5} V${by + 54} L${sx + 8} ${by + 64} L${sx + 18} ${by + 54} V${by + bh + 5}" ${STROKE} stroke-width="1.2"/>`);
  o.push(`<path d="M${sx} ${by + bh + 5} V${by + 54} L${sx + 8} ${by + 64} L${sx + 18} ${by + 54} V${by + bh + 5} Z" fill="url(#hatch-fine)" opacity="0.7"/>`);
  o.push(`<path d="M${sx} ${by - 5} V${by - 22} L${sx + 4} ${by - 26} L${sx + 12} ${by - 22} V${by - 5}" ${STROKE} stroke-width="1.2"/>`);
  // Vernier scale on the slider.
  for (let i = 0; i <= 10; i++) {
    const x = sx + 6 + i * 3.6;
    o.push(line(x, by + bh + 5, x, by + bh + 5 - (i % 5 === 0 ? 5 : 3), 'stroke="#000" stroke-width="0.45"'));
  }
  // Lock screw and thumb wheel.
  o.push(`<rect x="${sx + 26}" y="${by - 12}" width="8" height="7" ${STROKE} stroke-width="1"/>`);
  o.push(`<rect x="${sx + 24}" y="${by - 15}" width="12" height="3" ${STROKE} stroke-width="1"/>`);
  o.push(circle(sx + 36, by + bh + 14, 6, `${STROKE} stroke-width="1"`));
  for (let k = 0; k < 12; k++) {
    const a = deg(k * 30);
    const [x1, y1] = P(sx + 36, by + bh + 14, 4, a);
    const [x2, y2] = P(sx + 36, by + bh + 14, 6, a);
    o.push(line(x1, y1, x2, y2, 'stroke="#000" stroke-width="0.45"'));
  }
  // Measured part: a hex nut between the jaws, with its centre lines.
  const nx = 72;
  const ny = by + 40;
  const hex = Array.from({ length: 6 }, (_, k) => P(nx, ny, 22, deg(k * 60)));
  o.push(`<path d="M${hex.map(pt).join(" L")} Z" ${STROKE} stroke-width="1.2"/>`);
  o.push(circle(nx, ny, 19, `${STROKE} stroke-width="0.6"`));
  o.push(`<path d="${annulus(nx, ny, 11, 7)}" fill="url(#hatch)" fill-rule="evenodd"/>`);
  o.push(circle(nx, ny, 11, `${STROKE} stroke-width="0.9"`) + circle(nx, ny, 7, `${STROKE} stroke-width="0.9"`));
  o.push(centreLines(nx, ny, 30));
  // Dimension and note.
  o.push(dimH(32, sx, H - 4, "S = 38", null, null));
  o.push(callout(1, 210, 18, sx + 30, by - 13) + callout(2, 220, 84, sx + 42, by + bh + 16));
  o.push(`<text x="${W - 4}" y="${H - 4}" text-anchor="end" font-size="8" ${FONT} fill="#000">цена дел. 0,05</text>`);
  return svg(W, H, o.join(""));
}

/* ---------------------------------------------------------------------------
   4. Gauge dial face — ticks for the manometers (needle and arc are CSS).
   --------------------------------------------------------------------------- */
function gaugeDial() {
  const o = [];
  const c = 50;
  for (let i = 0; i <= 50; i++) {
    const a = deg(135 + i * 5.4);
    const major = i % 5 === 0;
    const [x1, y1] = P(c, c, 44, a);
    const [x2, y2] = P(c, c, major ? 35 : 40, a);
    o.push(line(x1, y1, x2, y2, `stroke="#000" stroke-width="${major ? 1.3 : 0.55}" stroke-linecap="butt"`));
  }
  o.push(`<path d="M${pt(P(c, c, 45.5, deg(135)))} A45.5 45.5 0 1 1 ${pt(P(c, c, 45.5, deg(45)))}" fill="none" stroke="#000" stroke-width="0.8"/>`);
  return svg(100, 100, o.join(""));
}

/* ---------------------------------------------------------------------------
   5. Large single gear — watermark behind the masthead.
   --------------------------------------------------------------------------- */
function bigGear() {
  const G = gear({ cx: 110, cy: 110, z: 32, m: 6, phase: 0, web: "spokes", spokes: 8, curved: true, shade: 20 });
  return svg(220, 220, G.svg);
}

writeFileSync(join(OUT, "gear-train.svg"), gearTrain());
writeFileSync(join(OUT, "steam-engine.svg"), steamEngine());
writeFileSync(join(OUT, "caliper.svg"), caliper());
writeFileSync(join(OUT, "gauge-dial.svg"), gaugeDial());
writeFileSync(join(OUT, "gear-large.svg"), bigGear());
console.log("written to", OUT);
