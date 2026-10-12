/* ══════════════════════════════════════════════════════════════════════════
   config-relation-observer 自检台（规则层 + 容量层，不起页面）
   --------------------------------------------------------------------------
   跑法（在本目录的上一级，即 training-run-twin-standalone/ 下）：

       node tools/cro-selfcheck.js            # 快跑，约 3.6 万状态，~7s
       node tools/cro-selfcheck.js --full     # 全量，约 14.4 万状态，~26s
       node tools/cro-selfcheck.js 8000       # 每种组合走 8000 步

   退出码：全通过 0，有失败 1。失败会逐条打出来（失败样例最多 3 条 —— 打全了
   既撑爆终端也没人读得完）。

   ── 为什么需要这么个东西 ──────────────────────────────────────────────────
   这三个文件是**给浏览器写的全局脚本**（IIFE + window + DOMContentLoaded），
   没有 export、没有模块边界。要在 node 里验它们只有三条路：起浏览器（慢，且这类
   「加减键乱按会不会把页面推进死角」的性质在浏览器里也验不动）、把函数复制一份出来
   验（复制的那份很快就和真代码不一致，验了等于没验）、或者本文件这一套：

     · 一个最小的 window / document 桩，`readyState: "loading"` 让 boot() 永不触发
       —— 于是模块只把**纯逻辑**挂到 global.CroTopology 上，DOM 那半根本不跑；
     · config-relation-capacity.js 内部函数一个都没导出，所以**读源码时注入一行
       export** 再喂给 vm —— 不改仓库里的文件，验的却是真代码。
       ⚠️ 这一行绑着内部函数名（measure / actCoeffs / …），谁重命名它就当场报错。
       那是好事：响亮地坏掉，好过静悄悄地验了个寂寞。

   ── 它验不了什么（这条必须知道）──────────────────────────────────────────
   **完全碰不到 DOM 与版面。** 一行排布、折叠开合、关系连线的位置、矩阵吃不吃得掉
   腾出来的高度 —— 一条都验不了。它验的是「数算得对不对」，不是「画得对不对」，
   后者仍然只能靠人刷新页面看。

   ── 为什么不进版本库 ──────────────────────────────────────────────────────
   本仓按 CLAUDE.md 的说法没有 test runner，也不打算为一个页面引入一套；
   与 js/test-syntax.js 同例，写进 .gitignore，只在本机复用。
   ══════════════════════════════════════════════════════════════════════════ */
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GIB = 1024 ** 3;
const gb = (b) => (b / GIB).toFixed(1);

/* ── 加载台 ──────────────────────────────────────────────────────────────── */
function boot() {
  const noop = () => {};
  const stubEl = () => ({
    style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    append: noop, appendChild: noop, setAttribute: noop, addEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const doc = {
    readyState: "loading",          // ← 关键：boot() 因此永不触发
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: stubEl, createElementNS: stubEl,
    body: null, documentElement: null,
  };
  const win = {
    document: doc, location: { search: "" }, console,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    requestAnimationFrame: noop, setTimeout: noop, clearTimeout: noop,
    localStorage: { getItem: () => null, setItem: noop },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    CustomEvent: function CustomEvent() {},
  };
  win.window = win;
  const ctx = vm.createContext(win);

  const run = (file, transform) => {
    const p = path.join(ROOT, "js", file);
    let src = fs.readFileSync(p, "utf8");
    if (transform) src = transform(src, p);
    vm.runInContext(src, ctx, { filename: file });
  };

  run("config-relation-observer.js");

  // 导入通路（行 20）：解析层与 DOM 无关，整块导出到 croImport，直接拿来撞样本
  run("config-relation-import.js");

  // capacity 的内部函数没有导出口，注入一行（见文件头的说明）
  run("config-relation-capacity.js", (src, p) => {
    const marker = "global.croCapacityBox = { build: buildBox, THRESHOLD };";
    if (src.indexOf(marker) < 0) {
      throw new Error(`注入点不见了（${p}）：找不到 croCapacityBox 那一行，`
        + `capacity.js 的导出方式变了，本文件的注入行要跟着改`);
    }
    return src.replace(marker, marker + "\n  global.__capTest = { measure, actCoeffs,"
      + " actUnitsOfStage, recomputeModeOf, recomputedLayersOf, shardPlan, paramsOfStage,"
      + " loraParamsOfStage, loraOn, syncBasis, basisHtml, verdictText, BASIS, THRESHOLD, precisionBytes, inflightRaw, inflightMicroBatches, microBatchNumOf };");
  });

  // yaml 同理：buildYamlLines 是内部函数
  run("config-relation-yaml.js", (src, p) => {
    const marker = "  const doc = global.document;";
    if (src.indexOf(marker) < 0) throw new Error(`注入点不见了（${p}）`);
    return src.replace(marker, marker
      + "\n  global.__yamlTest = { lines: (t) => buildYamlLines(t).map((l) => l.text) };");
  });

  return { T: win.CroTopology, C: win.__capTest, Y: win.__yamlTest, I: win.croImport };
}

const { T, C, Y, I } = boot();

/* ── 断言 ────────────────────────────────────────────────────────────────── */
let fails = 0;
const log = [];
function ok(cond, name, extra) {
  if (cond) return;
  fails += 1;
  console.log("FAIL " + name + (extra !== undefined ? "  :: " + extra : ""));
}
const note = (s) => log.push(s);

function cfgOf(model, over) {
  return Object.assign({ model, moeOrthogonal: false }, T.MODEL_PRESETS[model].defaults, over || {});
}
function topoOf(model, over) {
  const c = cfgOf(model, over);
  T.reconcile(c, null);
  return T.derive(c);
}
function measure(topo, stage) { C.syncBasis(topo); return C.measure(topo, stage); }
function peak(topo) {
  let best = null;
  for (let s = 0; s < topo.counts.pp; s += 1) {
    const m = measure(topo, s);
    if (!best || m.ratio > best.ratio) best = m;
  }
  return best;
}

/* ── 1. 基线数字：改口径时最先该响的警报 ─────────────────────────────────────
   这几个数被各轮落地记录反复引用（「与行 15 记录逐位相同」）。把那句人工声明
   变成断言 —— 谁不小心动了口径，这里当场响，而不是等下一轮才发现。 */
function checkBaseline() {
  const topo = topoOf("openpangu-flash");
  ok(topo.config.recomputeMode === "full", "默认 recomputeMode = full", topo.config.recomputeMode);
  ok(topo.config.shardMode === "zero1", "默认 shardMode = zero1", topo.config.shardMode);
  ok(topo.config.lora === false, "默认 lora = 关");
  ok(topo.counts.vpp === 1, "默认 VPP = 1（46 层连 PP4 都除不尽）");

  const m = peak(topo);
  note(`默认档峰值 ${gb(m.total)} GB / ${Math.round(m.ratio * 100)}%`
    + ` · 权重 ${gb(m.values.weight)} / 梯度 ${gb(m.values.grad)}`
    + ` / 优化器 ${gb(m.values.optim)} / 激活 ${gb(m.values.act)}`);
  ok(gb(m.total) === "10.9" && Math.round(m.ratio * 100) === 17,
    "默认档 10.9 GB / 17%（行 10 / 15 / 17 记录）", `${gb(m.total)} / ${Math.round(m.ratio * 100)}%`);

  [["none", "25.0"], ["zero1", "10.9"], ["fsdp2", "7.7"]].forEach(([mode, want]) => {
    const got = gb(peak(topoOf("openpangu-flash", { shardMode: mode })).total);
    ok(got === want, `权重分片 ${mode} 峰值 ${want} GB（行 15 记录）`, got);
  });
}

/* ── 2. 激活系数四档（行 19）──────────────────────────────────────────────
   来源 Korthikanti et al. 2022 §4：每层 34 = attention 11 + FFN 19 + LN 4，
   其中 10 为 TP 复制、24 为 TP 可切。自洽性：TP=1 时三档收敛成 34 / 17 / 2。 */
function checkRecompute() {
  const a = C.actCoeffs(topoOf("openpangu-flash", { tp: 1, seqParallel: false }));
  ok(a.none === 34 && a.selective === 17 && a.full === 2, "TP=1 系数 34/17/2", JSON.stringify(a));
  const b = C.actCoeffs(topoOf("openpangu-flash", { tp: 1, seqParallel: true }));
  ok(JSON.stringify(a) === JSON.stringify(b), "TP=1 时 SP 不改变系数", JSON.stringify(b));

  [1, 2, 4, 8, 16].forEach((tp) => [true, false].forEach((sp) => {
    const co = C.actCoeffs(topoOf("openpangu-flash", { tp, dp: 512 / tp, seqParallel: sp }));
    ok(co.full < co.selective && co.selective < co.none,
      `系数单调 tp=${tp} sp=${sp}`, JSON.stringify(co));
    if (!sp) {
      ok(co.none === 10 * tp + 24 && co.selective === 9 * tp + 8 && co.full === 2 * tp,
        `关 SP 系数式 tp=${tp}`, JSON.stringify(co));
    }
  }));

  const act = (over) => peak(topoOf("openpangu-flash", Object.assign({ tp: 1 }, over))).values.act;
  const none = act({ recomputeMode: "none" });
  const sel = act({ recomputeMode: "selective" });
  const full = act({ recomputeMode: "full" });
  note(`激活 GB：关 ${gb(none)} / 选择性 ${gb(sel)} / 全开 ${gb(full)}`);
  ok(Math.abs(sel / none - 17 / 34) < 1e-9, "选择性正好是关的一半", sel / none);
  ok(Math.abs(full / none - 2 / 34) < 1e-9, "全开是关的 2/34", full / none);

  for (let n = 1; n <= 12; n += 1) {
    const v = act({ recomputeMode: "layers", recomputeLayers: n });
    ok(v <= none && v >= full, `按层数 N=${n} 落在两端之间`, gb(v));
  }
  const s0 = (over) => measure(topoOf("openpangu-flash", Object.assign({ tp: 1 }, over)), 0).values.act;
  ok(Math.abs(s0({ recomputeMode: "layers", recomputeLayers: 12 })
    - s0({ recomputeMode: "full" })) < 1e-6, "N = 本段层数时等价于全开");
  note("各 stage 激活（N=4）："
    + [0, 1, 2, 3].map((s) => gb(measure(
      topoOf("openpangu-flash", { tp: 1, recomputeMode: "layers", recomputeLayers: 4 }), s).values.act)).join(" / ")
    + "；（关）" + [0, 1, 2, 3].map((s) => gb(measure(
      topoOf("openpangu-flash", { tp: 1, recomputeMode: "none" }), s).values.act)).join(" / "));
}

/* ── 3. LoRA（行 18）：权重与激活不动，梯度与优化器只跟 adapter 走 ────────── */
function checkLora() {
  ["openpangu-flash", "qwen2-7b"].forEach((model) => {
    const stage = peak(topoOf(model)).stage;
    const base = measure(topoOf(model), stage);
    [8, 16, 64, 128].forEach((r) => {
      const m = measure(topoOf(model, { lora: true, loraRank: r }), stage);
      ok(Math.abs(m.values.act - base.values.act) < 1e-6, `${model} LoRA r=${r} 激活逐位不变`);
      ok(m.values.weight >= base.values.weight, `${model} LoRA 权重不减`);
      ok(m.values.grad < base.values.grad * 0.05, `${model} LoRA r=${r} 梯度塌`, gb(m.values.grad));
      ok(m.values.optim < base.values.optim * 0.05, `${model} LoRA r=${r} 优化器塌`, gb(m.values.optim));
      ok(m.total < base.total, `${model} LoRA 总量下降`);
    });
    const r16 = measure(topoOf(model, { lora: true, loraRank: 16 }), stage);
    const r32 = measure(topoOf(model, { lora: true, loraRank: 32 }), stage);
    ok(Math.abs(r32.values.grad / r16.values.grad - 2) < 1e-6, `${model} 梯度 ∝ rank`);
    note(`${model} LoRA r=16：总 ${gb(r16.total)} GB（原 ${gb(base.total)}）`
      + ` · 权重 ${gb(r16.values.weight)} / 梯度 ${gb(r16.values.grad)}`
      + ` / 优化器 ${gb(r16.values.optim)} / 激活 ${gb(r16.values.act)}`
      + ` · 可训练 ${(r16.trainable / 1e6).toFixed(2)}M / ${(r16.params / 1e6).toFixed(0)}M`);
  });
}

/* ── 4. 各档组合下六段合法、两个文本视图不抛 ─────────────────────────────── */
function checkRender() {
  const modes = ["none", "selective", "layers", "full"];
  const shard = ["none", "zero1", "fsdp2"];
  ["openpangu-flash", "qwen2-7b"].forEach((model) => {
    modes.forEach((rm) => shard.forEach((sm) => [false, true].forEach((lora) => {
      const topo = topoOf(model, { recomputeMode: rm, shardMode: sm, lora, recomputeLayers: 4 });
      for (let s = 0; s < topo.counts.pp; s += 1) {
        const m = measure(topo, s);
        Object.keys(m.values).forEach((k) => {
          ok(Number.isFinite(m.values[k]) && m.values[k] >= 0,
            `段合法 ${model}/${rm}/${sm}/lora=${lora} ${k}`, m.values[k]);
        });
        C.basisHtml(topo, s);
        C.verdictText(m, topo);
      }
      const yaml = Y.lines(topo).join("\n");
      ok(yaml.indexOf("recompute_config:") >= 0, `yaml 有 recompute_config ${model}/${rm}`);
      ok((yaml.indexOf("pet_config:") >= 0) === lora, `yaml 的 pet_config 与 LoRA 同步 ${model}`);
    })));
  });
  // 四档各自写出去的样子（人工核对用，不断言字面）
  modes.forEach((rm) => {
    const t = topoOf("openpangu-flash", { recomputeMode: rm, recomputeLayers: 4 });
    note(`yaml[${rm}]  ` + Y.lines(t).filter((l) => /^ {2}(recompute|select_recompute)/.test(l))
      .map((l) => l.split("#")[0].trim()).join(" | "));
  });
}

/* ── 5. 加减键随机游走：这页的命门 ───────────────────────────────────────────
   全部卖点是「怎么按都落在自洽态上」，而这类性质读代码看不出来，只能撞。
   行 16 那轮就是这么撞出一个真 bug 的（联动修出 CP=3 → Total Rank 再也配不平）。
   ⚠️ 断言一律聚合成计数器，**不逐步打日志** —— 十几万行既撑爆终端也没人读。 */
function checkWalk(steps) {
  const FIELDS = Object.keys(T.FIELD_SPECS).filter((f) => f !== "node");
  const FLAGS = Object.keys(T.FLAG_SPECS);
  const models = ["openpangu-flash", "qwen2-7b"];
  const cards = ["910b-32", "910b-64", "950"];
  const bad = {
    报错态: 0, world乘积: 0, Ulysses头数: 0, Ring序列: 0, VPP无流水: 0, VPP层数: 0,
    DP除不尽EP: 0, 置灰未归位: 0, 重算层数越界: 0, 六段非法: 0, 可训练超总量: 0, 矩阵格子数: 0,
  };
  const cover = { lora: 0, layers: 0, selective: 0, vpp: 0, ring: 0, warn: 0 };
  let states = 0;
  let seed = 20260826;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  let shown = 0;

  // 行 23 之后是三档，不是两档 —— 走查必须把 mf 那一档也撞进去（它改的是编址几何）
  models.forEach((model) => ["split", "orthogonal", "mf"].forEach((epMode) => cards.forEach((card) => {
    const ortho = epMode === "orthogonal";
    const cfg = cfgOf(model, { card });
    cfg.epMode = epMode;
    cfg.moeOrthogonal = ortho;
    if (ortho) cfg.dp = Math.max(1, Math.floor(cfg.dp / cfg.ep));
    T.reconcile(cfg, null);
    for (let i = 0; i < steps; i += 1) {
      if (i % 20 === 19) {
        // 每 20 步随机拨一枚开关 / 档位
        const flag = pick(FLAGS);
        const spec = T.FLAG_SPECS[flag];
        cfg[flag] = spec.options ? pick(spec.options).value : rnd() < 0.5;
        T.reconcile(cfg, flag);
      } else {
        const field = pick(FIELDS);
        const next = T.stepValue(field, cfg[field], rnd() < 0.5 ? 1 : -1, cfg);
        if (next !== cfg[field]) { cfg[field] = next; T.reconcile(cfg, field); }
      }
      states += 1;

      const topo = T.derive(cfg);
      if (topo.errors.length) {
        bad.报错态 += 1;
        if (shown < 3) { shown += 1; console.log("  ↳ " + topo.errors.join(" / ") + "  " + JSON.stringify(cfg)); }
        continue;
      }
      const c = topo.counts;
      const heads = topo.preset.heads || 1;
      if (c.dp * c.pp * c.tp * c.cp * (ortho ? c.ep : 1) !== c.totalRank) bad.world乘积 += 1;
      if (c.cp > 1 && (cfg.cpMode || "ulysses") === "ulysses" && heads % (c.tp * c.cp) !== 0) bad.Ulysses头数 += 1;
      if (c.cp > 1 && cfg.cpMode === "ring" && cfg.seqLen % (2 * c.cp) !== 0) bad.Ring序列 += 1;
      if (c.vpp > 1 && c.pp <= 1) bad.VPP无流水 += 1;
      if (c.vpp > 1 && c.totalLayer % (c.pp * c.vpp) !== 0) bad.VPP层数 += 1;
      // 切出档看 DP，mf 档看 DP×MP 域（行 23）
      if (!ortho && (c.dp * (epMode === "mf" ? c.tp : 1)) % c.ep !== 0) bad.DP除不尽EP += 1;
      Object.keys(T.FLAG_SPECS).forEach((flag) => {
        const spec = T.FLAG_SPECS[flag];
        if (spec.enabledWhen && !spec.enabledWhen(cfg) && spec.disabledValue !== undefined
          && cfg[flag] !== spec.disabledValue) bad.置灰未归位 += 1;
      });
      const maxStage = Math.max.apply(null, topo.stages.map((s) => s.count));
      if (cfg.recomputeLayers > maxStage || cfg.recomputeLayers < 1) bad.重算层数越界 += 1;
      if (c.ranksPerStage * c.pp !== c.totalRank) bad.矩阵格子数 += 1;
      for (let s = 0; s < c.pp; s += 1) {
        const m = measure(topo, s);
        Object.keys(m.values).forEach((k) => {
          if (!Number.isFinite(m.values[k]) || m.values[k] < 0) bad.六段非法 += 1;
        });
        if (!(m.trainable > 0) || m.trainable > m.params + 1e-6) bad.可训练超总量 += 1;
      }

      if (cfg.lora) cover.lora += 1;
      if (cfg.recomputeMode === "layers") cover.layers += 1;
      if (cfg.recomputeMode === "selective") cover.selective += 1;
      if (c.vpp > 1) cover.vpp += 1;
      if (cfg.cpMode === "ring") cover.ring += 1;
      if (topo.warnings.length) cover.warn += 1;
    }
  })));

  const pct = (n) => (n / states * 100).toFixed(1) + "%";
  note(`随机游走 ${states} 个状态；覆盖 LoRA ${pct(cover.lora)} / 按层数 ${pct(cover.layers)}`
    + ` / 选择性 ${pct(cover.selective)} / VPP>1 ${pct(cover.vpp)} / Ring ${pct(cover.ring)}`
    + ` / 软警告 ${pct(cover.warn)}`);
  note("断言：" + JSON.stringify(bad));
  Object.keys(bad).forEach((k) => ok(bad[k] === 0, "随机游走 " + k, bad[k]));
}

/* ── 6. 导入通路（行 20）：拿 config-test/ 的真配置逐份撞 ─────────────────
   这一批（行 20–32）的验收标准本来就是这些文件，不该只能靠人点着页面试。
   逐份断言四件事：
     · 解析不抛、认对方言；
     · **要紧的键有落点**（每份至少接住几项并行度 / 批次）；
     · 导入后的 config 仍然自洽（validate 为空）—— 导入不该把页面推进报错态；
     · 每个键都有归宿（落表单 / 缺口 / 结构 / 不建模 / 未识别，五者之和 = 总键数）
       —— 这条是行 20 的核心承诺：**不静默吞键**。 */
function checkImport(fs2, path2) {
  if (!I) { ok(false, "croImport 未导出"); return; }
  const dir = path2.join(ROOT, "config-test");
  if (!fs2.existsSync(dir)) { note("config-test/ 不存在，跳过导入检查"); return; }
  const files = fs2.readdirSync(dir).filter((f) => /\.(ya?ml|sh|json)$/.test(f));
  ok(files.length >= 11, "样本数 ≥ 11", files.length);

  /* 面板目录中的每个文件都必须真实存在，否则用户会先碰到 404。磁盘允许额外保留
     不进入预置目录的稀疏解析夹具，供下面的逐份回归检查使用。 */
  if (I.SAMPLES) {
    const listed = I.SAMPLES.reduce((all, g) => all.concat(g.items.map((i) => i.file)), []);
    listed.forEach((f) => ok(files.indexOf(f) >= 0, `下拉目录里的 ${f} 在 config-test/ 里存在`));
    ok(listed.length === 8, "用户可见样本数 = 8", listed.length);
    I.SAMPLES.forEach((g) => g.items.forEach((i) => {
      ok(!!i.source && !!i.note, `${i.file} 带来源与代表性说明`);
      ok(!!i.label, `${i.file} 有名字`);
    }));
  }

  /* 每份至少该接住的字段（少于这个数就是解析或映射退化了）。
     ⚠️ 这是**回归下界**不是期望值：接得更多是好事，接得更少要当场知道。 */
  const MIN_MAPPED = {
    "mf_pretrain_deepseek3_671b.yaml": 10, "mf_pretrain_qwen3_30b_a3b.yaml": 10,
    "mixtral_8x7b.sh": 10, "megatron_175b.sh": 5, "megatron_llama3_8b_fp8.sh": 8,
    "hf_deepseekv3_config.json": 4, "hf_mixtral_config.json": 3, "hf_qwen2_7b_config.json": 1,
    "lf_qwen3_full_sft.yaml": 3, "lf_qwen3_lora_sft.yaml": 4, "ds_z3_config.json": 1,
  };

  files.forEach((f) => {
    const text = fs2.readFileSync(path2.join(dir, f), "utf8");
    let r = null;
    try { r = I.analyze(text, f, { model: "openpangu-flash" }); }
    catch (e) { ok(false, `解析不抛 ${f}`, e.message); return; }

    const c = r.counts;
    const total = c.total;
    const accounted = c.accounted;
    ok(total > 0, `${f} 解析出键`, total);
    ok(c.mapped >= (MIN_MAPPED[f] || 1), `${f} 落到表单的字段数 ≥ ${MIN_MAPPED[f] || 1}`, r.mapped.length);
    // 不静默吞键：没落到前四堆的必须被「不建模」那几条（含折叠计数）交代掉
    ok(accounted === total, `${f} 每个键都有归宿（不静默吞键）`,
      `逐键数出 ${accounted} ≠ 总键数 ${total}`);

    // 导入后仍自洽：走一遍真正的 importConfig
    const ctl = T.createController({ model: "openpangu-flash" });
    const res = ctl.importConfig(r.partial);
    const errs = T.validate(ctl.config);
    ok(errs.length === 0, `${f} 导入后配置自洽`, errs.join(" / "));
    const adjusted = I.diffApplied(r.partial, res.before, res.after);
    note(`导入 ${f}：落 ${r.mapped.length} / 缺口 ${r.gaps.length} / 结构 ${r.structural.length}`
      + ` / 不建模 ${r.ignored.length} / 未识别 ${r.unknown.length}`
      + (adjusted.length ? ` · 配平改了 ${adjusted.map((a) => `${a.field} ${a.want}→${a.got}`).join("、")}` : " · 配平未改动"));
  });

  /* 逐字核对两份最要紧的：deepseek3（并行度最全）与 mixtral（唯一给得出总卡数的） */
  const ds = I.analyze(fs2.readFileSync(path2.join(dir, "mf_pretrain_deepseek3_671b.yaml"), "utf8"),
    "mf_pretrain_deepseek3_671b.yaml", { model: "openpangu-flash" });
  const want = { totalLayer: 61, dp: 4, tp: 8, pp: 8, ep: 32, vpp: 2, seqLen: 4096,
    seqParallel: true, shardMode: "zero1", recomputeMode: "full" };
  Object.keys(want).forEach((k) => ok(ds.partial[k] === want[k],
    `deepseek3 ${k} = ${want[k]}`, ds.partial[k]));
  ok(ds.gaps.some((g) => g.row === 23 || g.key.endsWith("max_device_memory")),
    "deepseek3 报出缺口");
  ok(ds.structural.some((s) => s.field === "hidden" && s.value === 7168),
    "deepseek3 的 hidden 7168 进结构常量栏（不覆盖预设）");

  const mx = I.analyze(fs2.readFileSync(path2.join(dir, "mixtral_8x7b.sh"), "utf8"),
    "mixtral_8x7b.sh", { model: "openpangu-flash" });
  ok(mx.partial.totalRank === 8, "mixtral 总卡数 = GPUS_PER_NODE × NNODES", mx.partial.totalRank);
  ok(mx.partial.dp === 2, "mixtral 的 DP 由 world/(TP×PP×CP) 反推", mx.partial.dp);

  // Megatron 的变量引用必须解开：落到表单的值不能是 "$TP_SIZE" 这种字符串
  const l3 = I.analyze(fs2.readFileSync(path2.join(dir, "megatron_llama3_8b_fp8.sh"), "utf8"),
    "megatron_llama3_8b_fp8.sh", { model: "openpangu-flash" });
  l3.mapped.forEach((m) => ok(typeof m.value !== "string" || !/^\$/.test(m.value),
    `llama3 ${m.field} 的变量已解引用`, m.value));
}


/* ── 7. 精度档（行 21）与微批数（行 22）─────────────────────────────────────
   两条都是「新增一个维度、旧结论不动」型的改动，所以断言分两半：先验新维度自己的
   性质（字节口径、夹取），再验**默认档逐位不变**（那一半在 checkBaseline 里）。 */
function checkPrecision() {
  /* 字节口径表。合计一栏是这一档最容易被误解的地方：主权重两档**总量相同**，
     变的只是哪一段扛着那份 fp32 master。 */
  const want = {
    "bf16/bf16": [2, 2, 12], "fp16/bf16": [2, 2, 12], "fp8/bf16": [1, 2, 12],
    "bf16/fp32": [4, 4, 8], "fp16/fp32": [4, 4, 8], "fp8/fp32": [5, 4, 8],
  };
  Object.keys(want).forEach((key) => {
    const [dtype, paramsDtype] = key.split("/");
    const b = C.precisionBytes({ dtype, paramsDtype });
    const got = [b.weight, b.grad, b.optim];
    ok(String(got) === String(want[key]), `精度字节口径 ${key} = ${want[key]}`, String(got));
  });
  ok(C.precisionBytes({ dtype: "bf16", paramsDtype: "bf16" }).weight
    + C.precisionBytes({ dtype: "bf16", paramsDtype: "bf16" }).grad
    + C.precisionBytes({ dtype: "bf16", paramsDtype: "bf16" }).optim === 16, "bf16 主权重合计 16 B");
  ok(C.precisionBytes({ dtype: "bf16", paramsDtype: "fp32" }).weight
    + C.precisionBytes({ dtype: "bf16", paramsDtype: "fp32" }).grad
    + C.precisionBytes({ dtype: "bf16", paramsDtype: "fp32" }).optim === 16, "fp32 主权重合计也是 16 B");

  ["openpangu-flash", "qwen2-7b"].forEach((model) => {
    const base = peak(topoOf(model));
    const s = base.stage;
    const at = (over) => measure(topoOf(model, over), s);

    // FP8：权重段正好减半，其余段一个字节不动
    const fp8 = at({ dtype: "fp8" });
    const bf16 = measure(topoOf(model), s);
    ok(Math.abs(fp8.values.weight / bf16.values.weight - 0.5) < 1e-9,
      `${model} FP8 权重段减半`, fp8.values.weight / bf16.values.weight);
    ["grad", "optim", "act"].forEach((k) => ok(Math.abs(fp8.values[k] - bf16.values[k]) < 1e-6,
      `${model} FP8 不动 ${k} 段`));

    // 主权重 fp32：权重与梯度翻倍、优化器 ×8/12；关档下三段之和不变
    const none32 = at({ paramsDtype: "fp32", shardMode: "none" });
    const none16 = at({ shardMode: "none" });
    ok(Math.abs(none32.values.weight / none16.values.weight - 2) < 1e-9, `${model} fp32 权重段翻倍`);
    ok(Math.abs(none32.values.optim / none16.values.optim - 8 / 12) < 1e-9, `${model} fp32 优化器段 ×8/12`);
    const sum = (m) => m.values.weight + m.values.grad + m.values.optim;
    ok(Math.abs(sum(none32) - sum(none16)) < 1e-6,
      `${model} 关档下两档主权重合计相同（16 B）`, `${gb(sum(none32))} vs ${gb(sum(none16))}`);
    // ZeRO-1 下反过来：fp32 档留在卡上的更多（能切走的从 12 B 掉到 8 B）
    const z1_32 = at({ paramsDtype: "fp32", shardMode: "zero1" });
    const z1_16 = at({ shardMode: "zero1" });
    ok(sum(z1_32) > sum(z1_16), `${model} ZeRO-1 下 fp32 档更吃亏`, `${gb(sum(z1_32))} vs ${gb(sum(z1_16))}`);
    // 激活与精度无关（本页刻意留白，见口径浮层）
    ["fp8", "fp16"].forEach((d) => [undefined, "fp32"].forEach((pd) => {
      const m = at(pd ? { dtype: d, paramsDtype: pd } : { dtype: d });
      ok(Math.abs(m.values.act - bf16.values.act) < 1e-6, `${model} 激活不随精度档变 ${d}/${pd || "bf16"}`);
    }));
    note(`${model} 精度：bf16 权重 ${gb(bf16.values.weight)} / fp8 ${gb(fp8.values.weight)}`
      + ` · 主权重 fp32（关档）三段合计 ${gb(sum(none32))} = bf16 的 ${gb(sum(none16))}`
      + ` · ZeRO-1 下 ${gb(sum(z1_32))} vs ${gb(sum(z1_16))}`);
  });
}

function checkMicroBatchNum() {
  ["openpangu-flash", "qwen2-7b"].forEach((model) => {
    const base = topoOf(model);
    const s = peak(base).stage;
    const full = C.inflightRaw(base, 0);
    // 默认值 ≥ 公式值 → 一个字节都不动
    ok(base.config.microBatchNum >= full,
      `${model} 默认微批数 ${base.config.microBatchNum} ≥ Stage0 公式值 ${full}`);
    const big = measure(topoOf(model, { microBatchNum: 1024 }), s);
    const def = measure(base, s);
    ok(Math.abs(big.values.act - def.values.act) < 1e-6, `${model} 微批数调大激活逐位不变`);
    // 小于公式值 → 严格变矮，且正好按 min 夹
    for (let n = 1; n < full; n += 1) {
      const m = measure(topoOf(model, { microBatchNum: n }), 0);
      ok(m.inflight === n, `${model} 微批数 ${n} 时 Stage0 在飞 = ${n}`, m.inflight);
      ok(m.values.act < def.values.act, `${model} 微批数 ${n} 激活变小`);
    }
    // PP=1：怎么拨都不动（在飞恒为 1）
    const pp1 = (n) => measure(topoOf(model, { pp: 1, microBatchNum: n }), 0);
    ok(Math.abs(pp1(1).values.act - pp1(512).values.act) < 1e-6, `${model} PP=1 时微批数不改激活`);
    // 交错档：夹取同样生效
    const inter = topoOf(model, { totalLayer: 48, pp: 4, vpp: 2, microBatchNum: 2 });
    if (inter.counts.vpp > 1) {
      ok(measure(inter, 0).inflight <= 2, `${model} 交错档下夹取生效`, measure(inter, 0).inflight);
    }
    // 软警告：少于 PP×VPP 时必须响
    const warned = T.derive(cfgAfter(model, { microBatchNum: 1 })).warnings.join(" ");
    // 控件名已由「微批数」改成下划线全名 micro_batch_num（那三个字太像 Micro Batch
    //  的简称），软警告文案跟着走 —— 这条断言认的是控件此刻对外的名字。
    ok(/micro_batch_num/.test(warned), `${model} micro_batch_num 不足时给软警告`, warned.slice(0, 40));
    // yaml：那一格是输入，不再是派生值
    const t = topoOf(model, { microBatchNum: 7 });
    const y = Y.lines(t).join("\n");
    ok(/micro_batch_num: 7\b/.test(y), `${model} yaml 的 micro_batch_num 跟着控件走`);
    const gbs = t.config.microBatch * t.counts.dp * 7;
    ok(new RegExp("batch_size: " + gbs + "\\b").test(y), `${model} yaml 的全局 batch = MBS×DP×微批数`, gbs);
    note(`${model} 微批数：默认 ${base.config.microBatchNum} · Stage0 公式值 ${full}`
      + ` · 夹到 1 时激活 ${gb(measure(topoOf(model, { microBatchNum: 1 }), 0).values.act)} GB`
      + `（默认 ${gb(measure(base, 0).values.act)} GB）`);
  });
}

/* 只要一份**配平过**的 config（不 derive）—— 软警告读的是 config 不是 topology */
function cfgAfter(model, over) {
  const c = cfgOf(model, over);
  T.reconcile(c, null);
  return c;
}
/* ── 8. EP 口径第三档 · MindFormers 的 DP×MP 域（行 23）───────────────────
   这一档改的是**编址几何**，是本页最容易静默画错的一处：TP 被 EP 那一维吃掉了，
   照抄另两档的 ranksPerEp = TP×CP 会把每个 stage 撑成 TP 倍。所以断言的重点是
   两条不变式（rank ↔ 坐标一一对应、格子数 == Total Rank），而不是几个数字。 */
function checkEpMf() {
  const mfCfg = (over) => {
    const c = Object.assign(cfgOf("openpangu-flash"), { epMode: "mf", moeOrthogonal: false }, over || {});
    return c;
  };

  /* deepseek3 那份配置：dp:4 / mp:8 / pp:8 / ep:32 —— 两档都接不住，正是行 23 的由来 */
  const ds = { totalLayer: 61, dp: 4, tp: 8, pp: 8, cp: 1, ep: 32, routedExpert: 256,
    topK: 8, sharedExpert: 1, totalRank: 4 * 8 * 8, vpp: 1 };
  const split = Object.assign(cfgOf("openpangu-flash"), ds, { epMode: "split", moeOrthogonal: false });
  ok(T.validate(split).some((e) => /不能被 EP/.test(e)), "deepseek3 的并行度在切出档下报错（行 23 的由来）",
    T.validate(split).join(" / "));
  const mf = Object.assign(cfgOf("openpangu-flash"), ds, { epMode: "mf", moeOrthogonal: false });
  ok(T.validate(mf).length === 0, "同一份并行度在 mf 档下自洽", T.validate(mf).join(" / "));
  const topo = T.derive(mf);
  ok(topo.counts.edp === 4 * 8 / 32, "mf 档 EDP = DP×TP/EP", topo.counts.edp);
  ok(topo.counts.dpReplica === 4, "mf 档非专家权重的复制份数仍是 DP", topo.counts.dpReplica);
  note(`mf 档（deepseek3 并行度）：world ${topo.counts.totalRank} = DP4×PP8×TP8×CP1`
    + ` · EDP ${topo.counts.edp} · 每 stage ${topo.counts.ranksPerStage} 卡`);

  /* 三档 × 若干并行度：编址必须是双射，且格子数恒等于 Total Rank */
  ["split", "orthogonal", "mf"].forEach((mode) => {
    [{ dp: 8, tp: 1, cp: 1, ep: 8 }, { dp: 4, tp: 8, cp: 1, ep: 32 }, { dp: 8, tp: 2, cp: 2, ep: 4 },
      { dp: 16, tp: 4, cp: 1, ep: 8 }].forEach((over) => {
      const cfg = Object.assign(cfgOf("openpangu-flash"), { pp: 2, vpp: 1, epMode: mode,
        moeOrthogonal: mode === "orthogonal" }, over);
      T.reconcile(cfg, null);
      const t = T.derive(cfg);
      if (t.errors.length) { ok(false, `${mode} ${JSON.stringify(over)} 配平后仍报错`, t.errors[0]); return; }
      const c = t.counts;
      const tag = `${mode} dp${c.dp}/tp${c.tp}/cp${c.cp}/ep${c.ep}`;
      ok(c.ranksPerStage * c.pp === c.totalRank, `${tag} 格子数 == Total Rank`,
        `${c.ranksPerStage}×${c.pp} vs ${c.totalRank}`);
      // rank ↔ 坐标双射：每个 rank 恰好被访问一次，且反查回得来
      const seen = new Set();
      for (let s = 0; s < c.pp; s += 1) {
        for (let d = 0; d < c.edp; d += 1) {
          for (let e = 0; e < c.ep; e += 1) {
            for (let inner = 0; inner < c.ranksPerEp; inner += 1) {
              const rank = t.rankOf(s, d, e, inner);
              seen.add(rank);
              const co = t.coordsOfRank(rank);
              if (co.stage !== s || co.dpIdx !== d || co.epIdx !== e || co.inner !== inner) {
                ok(false, `${tag} rank ${rank} 反查不一致`, JSON.stringify(co));
              }
              if (!(co.tpIdx >= 0 && co.tpIdx < c.tp) || !(co.cpIdx >= 0 && co.cpIdx < c.cp)) {
                ok(false, `${tag} rank ${rank} 的 TP/CP 分片号越界`, `${co.tpIdx}/${co.cpIdx}`);
              }
            }
          }
        }
      }
      ok(seen.size === c.totalRank, `${tag} 每个 rank 恰好被编址一次`, `${seen.size} vs ${c.totalRank}`);
      // 容量六段仍合法
      for (let s = 0; s < c.pp; s += 1) {
        const m = measure(t, s);
        Object.keys(m.values).forEach((k) => ok(Number.isFinite(m.values[k]) && m.values[k] >= 0,
          `${tag} 段合法 ${k}`, m.values[k]));
      }
      C.basisHtml(t, 0);
      Y.lines(t);
    });
  });

  /* 切出档与 mf 档在 TP=1 时是同一件事（域就是 DP）—— 两档所有数字必须逐位相同 */
  [{ dp: 8, tp: 1, cp: 1, ep: 4 }, { dp: 16, tp: 1, cp: 2, ep: 8 }].forEach((over) => {
    const a = T.derive(Object.assign(cfgOf("openpangu-flash"), { pp: 2, epMode: "split" }, over));
    const b = T.derive(Object.assign(cfgOf("openpangu-flash"), { pp: 2, epMode: "mf" }, over));
    ok(a.counts.edp === b.counts.edp && a.counts.ranksPerStage === b.counts.ranksPerStage,
      `TP=1 时切出档与 mf 档同形 ${JSON.stringify(over)}`,
      `${a.counts.edp}/${a.counts.ranksPerStage} vs ${b.counts.edp}/${b.counts.ranksPerStage}`);
    ok(gb(peak(a).total) === gb(peak(b).total), `TP=1 时两档容量逐位相同 ${JSON.stringify(over)}`,
      `${gb(peak(a).total)} vs ${gb(peak(b).total)}`);
  });

  /* 导入 deepseek3 / qwen3：口径自动落到 mf，且不再被配平改掉 EP（行 23 的验收） */
  if (I) {
    const fs2 = require("fs"); const path2 = require("path");
    [["mf_pretrain_deepseek3_671b.yaml", 32], ["mf_pretrain_qwen3_30b_a3b.yaml", 4]].forEach(([file, ep]) => {
      const dir = path2.join(ROOT, "config-test");
      if (!fs2.existsSync(path2.join(dir, file))) return;
      const r = I.analyze(fs2.readFileSync(path2.join(dir, file), "utf8"), file, { model: "openpangu-flash" });
      ok(r.partial.epMode === "mf", `${file} 的 EP 口径落到 mf`, r.partial.epMode);
      const ctl = T.createController({ model: "openpangu-flash" });
      const res = ctl.importConfig(r.partial);
      ok(res.after.ep === ep, `${file} 导入后 EP 仍是 ${ep}（不再被配平收走）`, res.after.ep);
      ok(T.validate(ctl.config).length === 0, `${file} 导入后自洽`, T.validate(ctl.config).join(" / "));
    });
  }
}
/* ── 主流程 ──────────────────────────────────────────────────────────────── */
const arg = process.argv[2];
const steps = arg === "--full" ? 12000 : (Number(arg) > 0 ? Number(arg) : 3000);

const t0 = Date.now();
checkBaseline();
checkRecompute();
checkLora();
checkRender();
checkImport(fs, path);
checkPrecision();
checkMicroBatchNum();
checkEpMf();
checkWalk(steps);

log.forEach((line) => console.log(line));
console.log(fails === 0
  ? `\n全部通过（${((Date.now() - t0) / 1000).toFixed(1)}s；每种组合 ${steps} 步，--full 走 12000）`
  : `\n失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
