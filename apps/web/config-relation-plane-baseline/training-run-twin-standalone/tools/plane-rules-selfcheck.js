/* ═══════════════════════════════════════════════════════════════════════════
   plane-rules-selfcheck.js —— 共享规则层的自检 / 对拍
   （不入库：tools/ 在 .gitignore 里，与 cro-selfcheck.js 同一约定）

   用法：  node Profiling_Insight_and_Tool/training-run-twin-standalone/tools/plane-rules-selfcheck.js

   什么时候跑：**改了 shared/plane-rules.js 之后**，或改了两页里任何一处口径 /
   校验 / 配色 / 量程之后。它回答一个问题 ——
     「共享层此刻算出来的东西，是否还与两页原先各自的实现逐位相同？」
   原先那两份实现在这里各留了一份**快照副本**（下面 ① ②），所以这个脚本是
   独立的判据，不读页面代码。快照是抽取当时（2026-09-20）的行为基线：如果哪天
   有意要改行为，先改共享层、再把对应快照一起改，并在本文件里记一句为什么。

   四组检查：
     ① vs config-relation-observer.js 的口径函数（epDomain / EDP / dpReplica /
        world / d 轴命名 / DP 换算）
     ② vs rank-intro 的 topoOf（rows / groupRows / groups / dpS / world）
     ③ 约束谓词与两页原判据同真假；rank-intro 侧的错误文案与标红字段逐字相同
     ④ niceStep / heatColor / 专家四色 / 字段量程
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";

const path = require("path");
const PR = require(path.resolve(__dirname, "../../shared/plane-rules.js"));

let checks = 0;
const bad = [];
function eq(name, got, want) {
  checks += 1;
  if (got !== want) bad.push(`${name}: shared=${got} 基线=${want}`);
}

/* ══ ① observer.js 改动前的口径函数（快照） ═══════════════════════════════ */
const ob = {
  epIsOrthogonal: (c) => (c.epMode || "split") === "orthogonal",
  epIsMf: (c) => (c.epMode || "split") === "mf",
  epDomainOf: (c) => (ob.epIsMf(c) ? Math.max(1, c.dp) * Math.max(1, c.tp) : Math.max(1, c.dp)),
  epInWorld: (c) => (ob.epIsOrthogonal(c) ? c.ep : 1),
  expertDataParallel: (c) => (ob.epIsOrthogonal(c) ? c.dp
    : Math.max(1, Math.floor(ob.epDomainOf(c) / Math.max(1, c.ep)))),
  dpReplicaOf: (c) => (ob.epIsOrthogonal(c) ? Math.max(1, c.dp) * Math.max(1, c.ep) : Math.max(1, c.dp)),
  parallelWorld: (c) => c.dp * c.pp * c.tp * c.cp * ob.epInWorld(c),
  dAxisName: (counts) => (counts.epMode !== "orthogonal" && counts.ep > 1 ? "EDP" : "DP"),
  convertDp: (dp, ep, toOrth) => {
    const factor = Math.max(1, ep);
    const next = toOrth ? Math.floor(dp / factor) : dp * factor;
    return Math.min(8192, Math.max(1, next || 1));   // 8192 / 1 = DP 的字段量程
  },
  niceStep: (unitPx, minPx) => {
    if (!(unitPx > 0)) return 1;
    let step = 1; const ladder = [1, 2, 5]; let decade = 1; let i = 0;
    while (step * unitPx < minPx && step < 100000) {
      i += 1; if (i % 3 === 0) decade *= 10; step = ladder[i % 3] * decade;
    }
    return step;
  },
  HEAT_RAMP: [[0.00, 13, 30, 66], [0.22, 38, 86, 178], [0.44, 104, 78, 196],
    [0.64, 176, 66, 148], [0.82, 226, 68, 84], [1.00, 255, 124, 46]],
  heatColor(u) {
    const R = ob.HEAT_RAMP; const t = Math.min(1, Math.max(0, u)); let i = 1;
    while (i < R.length - 1 && t > R[i][0]) i += 1;
    const a = R[i - 1]; const b = R[i]; const f = (t - a[0]) / ((b[0] - a[0]) || 1);
    const mix = (j) => Math.round(a[j] + (b[j] - a[j]) * f);
    return `rgb(${mix(1)},${mix(2)},${mix(3)})`;
  },
};

/* ══ ② rank-intro 改动前的 topoOf 与案例四的口径（快照） ══════════════════ */
const ri = {
  topoOf(D, o) {
    o = o || {};
    const mode = o.mode || "split";
    const dpS = mode === "ortho" ? D.dp * D.ep : D.dp;
    const rows = dpS * D.tp;
    const groupRows = mode === "mf" ? D.ep : D.ep * D.tp;
    return { dp: dpS, rows, groupRows, groups: Math.max(1, Math.round(rows / groupRows)) };
  },
  dpS: (c) => (c.mode === "ortho" ? c.dp * c.ep : c.dp),
  world: (c) => ri.dpS(c) * c.tp * c.pp * c.cp,
  SETC: ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"],
  SET_NEUTRAL: "#64748B",
  setColorOf: (col, paintOn) => (paintOn && !col.dense ? ri.SETC[col.layer % 4] : ri.SET_NEUTRAL),
  /* 案例四 validate 的原实现（文案 + 标红字段） */
  validate(c) {
    const errs = []; const marked = {};
    if (c.layers % c.pp) { errs.push(`Total Layer ${c.layers} 必须被 PP ${c.pp} 整除`); marked.layers = marked.pp = true; }
    if (c.mode === "split" && c.dp % c.ep) { errs.push(`DP ${c.dp} 必须被 EP ${c.ep} 整除（切出口径：EP 组是从 DP 里切出来的）`); marked.dp = marked.ep = true; }
    if (c.mode === "mf" && (c.dp * c.tp) % c.ep) { errs.push(`DP × TP = ${c.dp * c.tp} 必须被 EP ${c.ep} 整除（MindFormers：EP 在 dp × mp 域上切）`); marked.dp = marked.tp = marked.ep = true; }
    if (c.routed % c.ep) { errs.push(`Routed Expert ${c.routed} 必须被 EP ${c.ep} 整除`); marked.routed = marked.ep = true; }
    if (c.topk > c.routed) { errs.push(`Top-K ${c.topk} 不能超过 Routed Expert ${c.routed}`); marked.topk = marked.routed = true; }
    if (ri.world(c) % 8) { errs.push(`Total Rank ${ri.world(c)} 不是整机 8 卡的整数倍`); marked.totalRank = true; }
    return { errs, bad: Object.keys(marked).sort() };
  },
  /* 案例四 F 的原字面量 */
  F: {
    layers: { lb: "Total Layer", min: 1, max: 256 }, dp: { lb: "DP", min: 1, max: 8192, pow2: true },
    pp: { lb: "PP", min: 1, max: 128, pow2: true }, tp: { lb: "TP", min: 1, max: 16, pow2: true },
    cp: { lb: "CP", min: 1, max: 16, pow2: true }, routed: { lb: "Routed Expert", min: 1, max: 1024, pow2: true },
    topk: { lb: "Top-K", min: 1, max: 64 }, shared: { lb: "Share Expert", min: 0, max: 8 },
    ep: { lb: "EP", min: 1, max: 1024, pow2: true }, totalRank: { lb: "Total Rank", min: 8, max: 65536, pow2: true },
    mbs: { lb: "Micro Batch", min: 1, max: 64 }, seq: { lb: "Seq Length", min: 128, max: 262144, pow2: true },
  },
};

/* 共享层现在的 validate 组装法（与 rank-intro 页内那段逐行同形） */
const BAD_KEY = { totalLayer: "layers", routedExpert: "routed", topK: "topk" };
function validateViaShared(c) {
  const errs = []; const marked = {}; const R = PR.RULES; let h;
  const mark = (hit) => hit.fields.forEach((f) => { marked[BAD_KEY[f] || f] = true; });
  if ((h = R.layersDivisibleByPp(c))) { errs.push(`Total Layer ${h.layers} 必须被 PP ${h.pp} 整除`); mark(h); }
  if ((h = R.epDomainDivisibleByEp(c))) {
    errs.push(h.mode === "mf"
      ? `DP × TP = ${h.domain} 必须被 EP ${h.ep} 整除（MindFormers：EP 在 dp × mp 域上切）`
      : `DP ${h.dp} 必须被 EP ${h.ep} 整除（切出口径：EP 组是从 DP 里切出来的）`);
    mark(h);
  }
  if ((h = R.routedDivisibleByEp(c))) { errs.push(`Routed Expert ${h.routed} 必须被 EP ${h.ep} 整除`); mark(h); }
  if ((h = R.topKWithinRouted(c))) { errs.push(`Top-K ${h.topk} 不能超过 Routed Expert ${h.routed}`); mark(h); }
  if ((h = R.worldMultipleOfNode(c, 8))) { errs.push(`Total Rank ${h.world} 不是整机 8 卡的整数倍`); mark(h); }
  return { errs, bad: Object.keys(marked).sort() };
}

/* ══ 扫参数 ═══════════════════════════════════════════════════════════════ */
const DPS = [1, 2, 3, 4, 8, 15, 16, 64, 512, 1024];
const PPS = [1, 2, 3, 4, 8];
const TPS = [1, 2, 4, 8];
const CPS = [1, 2, 4];
const EPS = [1, 2, 4, 7, 8, 64];

for (const mode of ["split", "orthogonal", "mf"]) {
  const riMode = mode === "orthogonal" ? "ortho" : mode;
  for (const dp of DPS) for (const pp of PPS) for (const tp of TPS) for (const cp of CPS) for (const ep of EPS) {
    const C = { epMode: mode, dp, pp, tp, cp, ep, totalLayer: 48, routedExpert: 64, topK: 8 };
    const tag = `${mode} dp${dp} pp${pp} tp${tp} cp${cp} ep${ep}`;

    /* ① */
    eq(`epDomain ${tag}`, PR.epDomain(C), ob.epDomainOf(C));
    eq(`epInWorld ${tag}`, PR.epInWorld(C), ob.epInWorld(C));
    eq(`EDP ${tag}`, PR.expertDataParallel(C), ob.expertDataParallel(C));
    eq(`dpReplica ${tag}`, PR.dpReplica(C), ob.dpReplicaOf(C));
    eq(`world ${tag}`, PR.parallelWorld(C), ob.parallelWorld(C));
    eq(`dAxis ${tag}`, PR.dAxisName({ epMode: mode, ep }), ob.dAxisName({ epMode: mode, ep }));
    eq(`convertDp→正交 ${tag}`, PR.convertDpAcrossEpMode(dp, ep, true), ob.convertDp(dp, ep, true));
    eq(`convertDp→切出 ${tag}`, PR.convertDpAcrossEpMode(dp, ep, false), ob.convertDp(dp, ep, false));

    /* ② */
    const T = PR.topology({ mode: riMode, dp, pp, tp, cp, ep, layers: 48 });
    const B = ri.topoOf({ dp, pp, tp, cp, ep, layers: 48 }, { mode: riMode });
    eq(`rows ${tag}`, T.rows, B.rows);
    eq(`groupRows ${tag}`, T.groupRows, B.groupRows);
    eq(`groups(EDP) ${tag}`, T.groups, B.groups);
    eq(`dpS ${tag}`, T.dp, B.dp);
    eq(`world(ri) ${tag}`, T.world, ri.world({ mode: riMode, dp, pp, tp, cp, ep }));

    /* ③ 谓词真假 */
    eq(`rule routed%ep ${tag}`, !!PR.RULES.routedDivisibleByEp(C), 64 % ep !== 0);
    eq(`rule epDomain%ep ${tag}`, !!PR.RULES.epDomainDivisibleByEp(C),
      mode !== "orthogonal" && ob.epDomainOf(C) % ep !== 0);
    eq(`rule layers<pp ${tag}`, !!PR.RULES.layersAtLeastPp(C), 48 < pp);
    eq(`rule layers%pp ${tag}`, !!PR.RULES.layersDivisibleByPp(C), 48 % pp !== 0);
    eq(`rule world%8 ${tag}`, !!PR.RULES.worldMultipleOfNode(C, 8), ob.parallelWorld(C) % 8 !== 0);
  }
}

/* ③ 文案与标红字段逐字对拍 */
for (const mode of ["split", "ortho", "mf"]) {
  for (const layers of [46, 48, 64]) for (const dp of [1, 2, 3, 4, 8, 15, 16, 64]) for (const pp of [1, 2, 3, 4, 8]) {
    for (const tp of [1, 2, 4]) for (const ep of [1, 2, 4, 7, 8]) for (const routed of [63, 64, 1024]) for (const topk of [8, 65]) {
      const c = { mode, layers, dp, pp, tp, cp: 1, ep, routed, topk };
      const a = ri.validate(c); const b = validateViaShared(c);
      checks += 1;
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        bad.push(`validate ${JSON.stringify(c)}\n      基线 ${JSON.stringify(a)}\n      现在 ${JSON.stringify(b)}`);
      }
    }
  }
}

/* ④ niceStep / heatColor / 四色 / 量程 */
for (let i = 0; i <= 200; i += 1) {
  const px = i / 7 + 0.01;
  for (const m of [10, 16, 22, 42, 92]) eq(`niceStep(${px},${m})`, PR.niceStep(px, m), ob.niceStep(px, m));
}
for (let i = 0; i <= 1000; i += 1) eq(`heatColor(${i / 1000})`, PR.heatColor(i / 1000), ob.heatColor(i / 1000));
for (let L = 0; L < 64; L += 1) {
  for (const dense of [false, true]) for (const paint of [false, true]) {
    eq(`setColor L${L} dense=${dense} paint=${paint}`,
      PR.setColorOf(L, { dense, paint }), ri.setColorOf({ layer: L, dense }, paint));
  }
}
const SPEC_MAP = {
  layers: ["totalLayer", null], dp: ["dp", null], pp: ["pp", null],
  tp: ["tp", { max: 16 }], cp: ["cp", { max: 16 }],
  routed: ["routedExpert", null, "Routed Expert"], topk: ["topK", null],
  shared: ["sharedExpert", null, "Share Expert"], ep: ["ep", null],
  totalRank: ["totalRank", { min: 8 }], mbs: ["microBatch", null], seq: ["seqLen", { max: 262144 }],
};
for (const key of Object.keys(ri.F)) {
  const [field, over, lb] = SPEC_MAP[key];
  const s = PR.specOf(field, over) || {};
  eq(`F.${key}.lb`, lb || s.label, ri.F[key].lb);
  eq(`F.${key}.min`, s.min, ri.F[key].min);
  eq(`F.${key}.max`, s.max, ri.F[key].max);
  eq(`F.${key}.pow2`, !!s.pow2, !!ri.F[key].pow2);
}

/* ══ 结果 ═════════════════════════════════════════════════════════════════ */
console.log(`共享规则层自检：${checks} 项`);
if (bad.length) {
  console.log(`\n❌ 与基线不符 ${bad.length} 项，前 20：`);
  bad.slice(0, 20).forEach((s) => console.log("  " + s));
  console.log("\n若这是**有意**的行为改动：改共享层的同时，把本文件里对应的快照基线一起改，并记一句为什么。");
  process.exit(1);
}
console.log("✅ 全部与两页改动前的实现逐位一致");
