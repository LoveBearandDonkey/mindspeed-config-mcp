/* ═══════════════════════════════════════════════════════════════════════════
   plane-rules.js —— 「rank × layer 展平视图」的共享规则层

   本文件只保存与画法无关的稳定语义：EP 口径换算、约束谓词、字段量程、
   配色与刻度梯子。DOM 渲染继续由 config-relation-plane.js 与
   config-relation-observer.js 负责，错误文案和修复建议也留在各自控制器中。

   部分兼容谓词和别名用于读取历史配置；即使当前页面不主动生成这些输入，
   也不能在没有迁移测试的情况下静默改变其含义。

   ── 改完请跑一遍自检 ────────────────────────────────────────────────────
     node Profiling_Insight_and_Tool/training-run-twin-standalone/tools/plane-rules-selfcheck.js
   它拿规则抽取前的实现快照对拍本层的每一项（约 23 万项），所以能直接回答
   「这次改动有没有顺手动到别的行为」。有意改行为时，把它里面对应的快照基线一起
   改掉并记一句为什么。（tools/ 在 .gitignore 里，与 cro-selfcheck.js 同一约定。）

   ── 加载方式 ────────────────────────────────────────────────────────────
   经典全局脚本（与本仓 js/ 下那一套同风格，不是 ES module），挂
   window.PTOPlaneRules。必须排在读它的脚本之前：
     config-relation-plane.html      → 在 config-relation-observer.js 之前
     config-relation-observer.html   → 同上（该页自己没有展平画布，引它只为
                                       observer.js 跑得起来）
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ══ 一、数值小工具 ═══════════════════════════════════════════════════════ */

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* 量尺刻度的 1/2/5 梯子：给定「一格在屏幕上多少像素」与「刻度之间至少要隔开
     多少像素」，返回该隔几格标一次。
     ⚠️ 与规则抽取前的实现逐位相同（含 `step < 100000` 这个防跑飞的上界）。 */
  function niceStep(unitPx, minPx) {
    if (!(unitPx > 0)) return 1;
    var step = 1;
    var ladder = [1, 2, 5];
    var decade = 1;
    var i = 0;
    while (step * unitPx < minPx && step < 100000) {
      i += 1;
      if (i % 3 === 0) decade *= 10;
      step = ladder[i % 3] * decade;
    }
    return step;
  }

  /* ══ 二、EP 口径 ══════════════════════════════════════════════════════════
     三档：
       split       切出 —— EP 组从 DP 里切，不进 world 的乘积（主流）
       orthogonal  正交 —— EP 独占 rank、是 DP 之外的一根轴，进 world 的乘积
       mf          MindFormers —— EP 在 dp×mp（= dp×tp）域上切，同样不进乘积
     历史配置也可能使用 'ortho' 简写，本层同时识别并归一。 */

  var EP_SPLIT = "split";
  var EP_ORTHOGONAL = "orthogonal";
  var EP_MF = "mf";
  var EP_MODES = [EP_SPLIT, EP_ORTHOGONAL, EP_MF];

  function normalizeEpMode(mode) {
    if (mode === EP_ORTHOGONAL || mode === "ortho") return EP_ORTHOGONAL;
    if (mode === EP_MF) return EP_MF;
    return EP_SPLIT;
  }

  /* ── 输入归一 ──────────────────────────────────────────────────────────
     历史 config 字段名与当前字段名不同，本层兼容两种拼写：
       层数      totalLayer | layers
       路由专家  routedExpert | routed
       Top-K     topK | topk
       EP 口径   epMode | mode（另兼容 observer 的老字段 moeOrthogonal）
     取值一律过 Math.max(1, …)，与 observer 里那批 `Math.max(1, config.x || 1)`
     同一个防御口径（0 / undefined 不该把除法炸成 Infinity）。 */
  function read(config) {
    var c = config || {};
    var mode = c.epMode !== undefined ? c.epMode
      : c.mode !== undefined ? c.mode
        : (c.moeOrthogonal ? EP_ORTHOGONAL : EP_SPLIT);
    return {
      mode: normalizeEpMode(mode),
      layers: num(c.totalLayer !== undefined ? c.totalLayer : c.layers, 1),
      dp: num(c.dp, 1),
      pp: num(c.pp, 1),
      tp: num(c.tp, 1),
      cp: num(c.cp, 1),
      ep: num(c.ep, 1),
      routed: num(c.routedExpert !== undefined ? c.routedExpert : c.routed, 1),
      topk: num(c.topK !== undefined ? c.topK : c.topk, 1),
    };
  }

  function num(v, lo) {
    var n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.floor(n)) : lo;
  }

  function isOrthogonal(config) { return read(config).mode === EP_ORTHOGONAL; }
  function isMf(config) { return read(config).mode === EP_MF; }

  /* ══ 三、拓扑标量 ═════════════════════════════════════════════════════════
     这一段是本文件的**核心**：把历史实现中算法写法不同但结果恒等的标量集中起来。
     恒等性逐条验算见每个函数上面的注释 —— 收进来的前提就是它。 */

  /* EP 从哪个域里切出来。正交档没有「切出」这回事，返回 dp 只是让调用方不必分支
     （正交档的整除校验本来就不看这个数）。 */
  function epDomain(config) {
    var c = read(config);
    if (c.mode === EP_MF) return c.dp * c.tp;
    return c.dp;
  }

  /* EP 进不进 world 的乘积：只有正交档进。 */
  function epInWorld(config) {
    var c = read(config);
    return c.mode === EP_ORTHOGONAL ? c.ep : 1;
  }

  /* Total Rank / World Size。
     ── 恒等性验算 ──
       正交 → dp*ep*tp*pp*cp ≡ dp*pp*tp*cp*ep   ✓
       切出/mf → dp*tp*pp*cp ≡ dp*pp*tp*cp*1    ✓ */
  function parallelWorld(config) {
    var c = read(config);
    return c.dp * c.pp * c.tp * c.cp * epInWorld(config);
  }

  /* 「切出口径下的 DP」—— 也就是一份**非专家**权重在数据并行域里复制了多少份
     （ZeRO / FSDP 的分母）。三档：
       切出  dp
       正交  dp×ep   （每个 DP 副本横跨全部 EP rank）
       mf    dp       ← 不能写成 EDP×EP：那会把 TP 那一维重复算进来
     三档均与并行口径定义逐项一致。 */
  function dpReplica(config) {
    var c = read(config);
    return c.mode === EP_ORTHOGONAL ? c.dp * c.ep : c.dp;
  }

  /* EDP —— 「一整套完整专家」共有几个副本，也就是集群矩阵 / 展平图 d 轴的组数：
       正交  EDP = DP        （EP 是另一根轴，每个 DP 副本自带一整套专家）
       切出  EDP = DP ÷ EP
       mf    EDP = DP×TP ÷ EP
     ── 恒等性验算 ──
         正交 → (dp*ep*tp)/(ep*tp) = dp          ✓
         切出 → (dp*tp)/(ep*tp)    = dp/ep       ✓
         mf   → (dp*tp)/ep                       ✓

     ── ⚠️ 除不尽时的取整做成显式参数 ────────────────────────────────────
     整除性由校验（RULES.epDomainDivisibleByEp）去拦，所以**凡是画得出来的
     配置这里都除得尽**，取整方式落不到实处 —— 对拍 20 万项的结论是：合法配置上
     合法配置上无分歧，差异只出现在校验会拦掉的配置上（如 DP 3 ÷ EP 2）。
     为兼容历史快照，这里保留 floor 与 round 两种取整；默认 floor，topology 使用
     round，两者都夹下界 1。 */
  function expertDataParallel(config, opts) {
    var c = read(config);
    if (c.mode === EP_ORTHOGONAL) return c.dp;
    var exact = epDomain(config) / c.ep;
    var rounding = opts && opts.rounding === "round" ? Math.round : Math.floor;
    return Math.max(1, rounding(exact));
  }

  /* 一个 EDP 副本组在展平图上占几行（一行 = 一个 rank）：
       mf      ep        （EP 已吃掉 mp 维）
       其余    ep × tp
     三档均与 topology 的分组语义一致。 */
  function epGroupRows(config) {
    var c = read(config);
    return c.mode === EP_MF ? c.ep : c.ep * c.tp;
  }

  /* 一个 PP stage 内有几行 rank（展平图的纵轴长度）。 */
  function ranksPerStage(config) {
    return dpReplica(config) * read(config).tp;
  }

  /* d 轴对人显示的名字。切出 / mf 档下矩阵的一行是 EDP 而不是 DP —— 表单写着
     DP 512、矩阵左侧却标 DP0–7，是两个不同的量重名，必须分开叫。EP=1（稠密）时
     EDP ≡ DP，仍叫 DP，不给没有专家的模型平添一个新词。
     ── 与 observer 的 dAxisName 判据相同（那边读 counts，这里读 config）✓ */
  function dAxisName(config) {
    var c = read(config);
    return c.mode !== EP_ORTHOGONAL && c.ep > 1 ? "EDP" : "DP";
  }

  /* 切换 EP 口径时按 EP 换算 DP，使 Total Rank 不变（同一份卡的两种读法：
     切出档读作 DP 512、正交档读作 DP 8）。上下界夹在 DP 的字段量程内。
     ── 与 observer 的 convertDpAcrossEpMode 相同 ✓ */
  function convertDpAcrossEpMode(dp, ep, toOrthogonal) {
    var spec = FIELD_SPECS.dp;
    var factor = Math.max(1, ep);
    var next = toOrthogonal ? Math.floor(dp / factor) : dp * factor;
    return Math.min(spec.max, Math.max(spec.min, next || 1));
  }

  /* 一次算齐展平图要的那批数。config-relation-plane 侧同名的量散在 counts 里，
     逐个取用。groups 取 round 以兼容历史快照，理由见 expertDataParallel。 */
  function topology(config) {
    var c = read(config);
    return {
      mode: c.mode,
      orthogonal: c.mode === EP_ORTHOGONAL,
      mf: c.mode === EP_MF,
      dp: dpReplica(config),            // 切出口径的 DP（= 每段行数 ÷ TP）
      pp: c.pp,
      tp: c.tp,
      cp: c.cp,
      ep: c.ep,
      rows: ranksPerStage(config),      // 一个 stage 内的行数
      groupRows: epGroupRows(config),   // 一个 EDP 副本组占几行
      groups: expertDataParallel(config, { rounding: "round" }), // EDP：副本组共几个
      world: parallelWorld(config),
      dAxis: dAxisName(config),
    };
  }

  /* ══ 四、约束谓词 ═════════════════════════════════════════════════════════
     只答「成不成立、涉及哪几个字段、相关的数是多少」，**不产文案**：
     控制器还要靠 label 子串去标红对应的 stepper，所以这里仅返回事实与字段，
     文案由调用方组织。

     返回 null = 这条约束此刻不成立（没有错）；返回对象 = 违反了，对象里带着
     写文案要用的那几个数与 fields（该标红哪几格）。 */

  var RULES = {
    /* 路由专家必须能均分到 EP rank。与历史快照口径相同。 */
    routedDivisibleByEp: function (config) {
      var c = read(config);
      if (c.routed % c.ep === 0) return null;
      return { rule: "routedDivisibleByEp", fields: ["routedExpert", "ep"],
               routed: c.routed, ep: c.ep, remainder: c.routed % c.ep };
    },

    /* EP 组必须凑得齐：切出档看 DP，mf 档看 DP×TP 域，正交档不受这条管
       （那里每个 DP 副本自带一整套专家，DP 与 EP 之间无须整除）。
       与历史快照口径相同 —— 这也是本层最值钱的一条：三档的域怎么取，
       以后只在 epDomain 一处改。 */
    epDomainDivisibleByEp: function (config) {
      var c = read(config);
      if (c.mode === EP_ORTHOGONAL) return null;
      var domain = epDomain(config);
      if (domain % c.ep === 0) return null;
      return { rule: "epDomainDivisibleByEp",
               fields: c.mode === EP_MF ? ["dp", "tp", "ep"] : ["dp", "ep"],
               mode: c.mode, dp: c.dp, tp: c.tp, ep: c.ep,
               domain: domain, remainder: domain % c.ep };
    },

    /* Top-K 不能超过路由专家总数。 */
    topKWithinRouted: function (config) {
      var c = read(config);
      if (c.topk <= c.routed) return null;
      return { rule: "topKWithinRouted", fields: ["topK", "routedExpert"],
               topk: c.topk, routed: c.routed };
    },

    /* ── 层数与 PP：并排保留两种具名口径 ─────────────────────────────────
       当前页面允许不均分 —— openPangu 的 46 层配 PP 4
       会摆成 12,12,11,11，它只要求每个 stage 至少有 1 层；
       历史等长分块口径要求整除。谁调用哪一条，由调用方自己定。 */
    layersAtLeastPp: function (config) {          // observer 侧用这条
      var c = read(config);
      if (c.layers >= c.pp) return null;
      return { rule: "layersAtLeastPp", fields: ["totalLayer", "pp"],
               layers: c.layers, pp: c.pp };
    },
    layersDivisibleByPp: function (config) {      // 历史等长分块口径
      var c = read(config);
      if (c.layers % c.pp === 0) return null;
      return { rule: "layersDivisibleByPp", fields: ["totalLayer", "pp"],
               layers: c.layers, pp: c.pp, remainder: c.layers % c.pp };
    },

    /* 并行度的乘积必须等于 Total Rank（observer 侧：Total Rank 是可输入的一格）。 */
    worldMatchesTotalRank: function (config, totalRank) {
      var world = parallelWorld(config);
      if (world === totalRank) return null;
      return { rule: "worldMatchesTotalRank", fields: ["totalRank"],
               world: world, totalRank: totalRank, epInWorld: epInWorld(config) !== 1 };
    },

    /* 卡数必须是整机的整数倍。 */
    worldMultipleOfNode: function (config, ranksPerNode) {
      var per = Math.max(1, ranksPerNode || 8);
      var world = parallelWorld(config);
      if (world % per === 0) return null;
      return { rule: "worldMultipleOfNode", fields: ["totalRank"],
               world: world, ranksPerNode: per, remainder: world % per };
    },
  };

  /* ══ 五、专家权重着色 ═════════════════════════════════════════════════════
     颜色说的是**这一层的专家权重是哪一份**：索引只取 层号 % 4，左右相邻换层就
     换色。副本号**不参与** —— 上下两个 EDP 副本持的是同一份权重（步末在 EDP 组里
     all-reduce 对齐），换色会被读成「两套不同的专家」。副本边界交给行距与左量尺。
     色值取 training-run-twin.css 里 .ep-tint-N 那套的前四色，不另造色板。
     config-relation-plane.css 的 --crop-set-0..3 与此处保持同一组十六进制值；
     索引使用 `layer % 4`，Dense 层退到中性灰。 */
  var SET_TINTS = 4;
  var SET_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"];
  /* 着色**关掉**时（以及 Dense 层）退到的那一色。必须是真中性的灰蓝：退到 MoE 的
     语义色（橙红）会让满屏读起来像一片告警，而这一档的本意恰恰是「不表达分组」。 */
  var SET_NEUTRAL = "#64748B";

  function setTintIndex(layer) {
    return ((layer % SET_TINTS) + SET_TINTS) % SET_TINTS;
  }

  /* opts.dense = 这一列是 Dense 层（没有专家，不参与着色）
     opts.paint = 「按层给专家权重着色」开着吗（关掉就整幅退到中性灰） */
  function setColorOf(layer, opts) {
    var o = opts || {};
    if (o.dense || o.paint === false) return SET_NEUTRAL;
    return SET_COLORS[setTintIndex(layer)];
  }

  /* ══ 六、热力色阶 ═════════════════════════════════════════════════════════
     冷蓝 → 火红，中途**绕开绿**：绿在这套色板里是「安全 / 正常」的语义色，热力图
     中段出现一片绿会被读成一档状态，而它其实只是「不冷不热」。
     config-relation-plane.js 使用同一张表和同一套插值算法。heatColor 接受可选
     ramp 参数，默认使用这张深色表。 */
  var HEAT_RAMP = [
    [0.00, 13, 30, 66],
    [0.22, 38, 86, 178],
    [0.44, 104, 78, 196],
    [0.64, 176, 66, 148],
    [0.82, 226, 68, 84],
    [1.00, 255, 124, 46],
  ];

  function heatColor(u, ramp) {
    var R = ramp || HEAT_RAMP;
    var t = clamp(u, 0, 1);
    var i = 1;
    while (i < R.length - 1 && t > R[i][0]) i += 1;
    var a = R[i - 1];
    var b = R[i];
    var f = (t - a[0]) / ((b[0] - a[0]) || 1);
    var mix = function (j) { return Math.round(a[j] + (b[j] - a[j]) * f); };
    return "rgb(" + mix(1) + "," + mix(2) + "," + mix(3) + ")";
  }

  function heatRampCss(ramp) {
    var R = ramp || HEAT_RAMP;
    return "linear-gradient(90deg, " + R.map(function (s) {
      return "rgb(" + s[1] + "," + s[2] + "," + s[3] + ") " + Math.round(s[0] * 100) + "%";
    }).join(", ") + ")";
  }

  /* ══ 七、字段量程 ═════════════════════════════════════════════════════════
     这里是**规范值**（口径来自 config-relation-observer.js 的 FIELD_SPECS）。
     调用方可以用 specOf(field, overrides) 显式覆盖 min/max 与 label。
     ⚠️ routedExpert / sharedExpert 使用 observer 的 "Routed" / "Shared" 写法；
     emit() 会通过这些 label 的子串匹配决定标红哪一枚 stepper，因此不能随意改名。
       pow2  加减键按 2 的幂走（手输仍可以是任意整数）
       已稳定的量程（Total Layer 1..256、DP 1..8192、PP 1..128、Top-K 1..64、
       Shared 0..8、Routed / EP 1..1024、Total Rank 上界 65536）从此只有这一处。 */
  var FIELD_SPECS = {
    totalLayer:   { label: "Total Layer",    min: 1,   max: 256,   step: 1 },
    dp:           { label: "DP",             min: 1,   max: 8192,  pow2: true },
    pp:           { label: "PP",             min: 1,   max: 128,   pow2: true },
    tp:           { label: "TP",             min: 1,   max: 64,    pow2: true },
    cp:           { label: "CP",             min: 1,   max: 64,    pow2: true },
    ep:           { label: "EP",             min: 1,   max: 1024,  pow2: true },
    routedExpert: { label: "Routed",         min: 1,   max: 1024,  pow2: true },
    topK:         { label: "Top-K",          min: 1,   max: 64,    step: 1 },
    sharedExpert: { label: "Shared",         min: 0,   max: 8,     step: 1 },
    totalRank:    { label: "Total Rank",     min: 1,   max: 65536, pow2: true },
    microBatch:   { label: "Micro Batch",    min: 1,   max: 64,    step: 1 },
    seqLen:       { label: "Seq Length",     min: 128, max: 131072, pow2: true },
  };

  /* 取一个字段的规格，可就地覆盖（只覆盖传进来的键，其余沿用规范值）。 */
  function specOf(field, overrides) {
    var base = FIELD_SPECS[field];
    if (!base) return null;
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (overrides) for (k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) out[k] = overrides[k];
    return out;
  }

  /* ══ 导出 ═════════════════════════════════════════════════════════════════ */
  var API = {
    /* 小工具 */
    gcd: gcd, clamp: clamp, niceStep: niceStep,
    /* EP 口径 */
    EP_SPLIT: EP_SPLIT, EP_ORTHOGONAL: EP_ORTHOGONAL, EP_MF: EP_MF, EP_MODES: EP_MODES,
    normalizeEpMode: normalizeEpMode, readConfig: read,
    isOrthogonal: isOrthogonal, isMf: isMf,
    /* 拓扑标量 */
    epDomain: epDomain, epInWorld: epInWorld, parallelWorld: parallelWorld,
    dpReplica: dpReplica, expertDataParallel: expertDataParallel,
    epGroupRows: epGroupRows, ranksPerStage: ranksPerStage,
    dAxisName: dAxisName, convertDpAcrossEpMode: convertDpAcrossEpMode,
    topology: topology,
    /* 约束谓词 */
    RULES: RULES,
    /* 专家着色 */
    SET_TINTS: SET_TINTS, SET_COLORS: SET_COLORS, SET_NEUTRAL: SET_NEUTRAL,
    setTintIndex: setTintIndex, setColorOf: setColorOf,
    /* 热力色阶 */
    HEAT_RAMP: HEAT_RAMP, heatColor: heatColor, heatRampCss: heatRampCss,
    /* 字段量程 */
    FIELD_SPECS: FIELD_SPECS, specOf: specOf,
  };

  global.PTOPlaneRules = API;
  if (typeof module === "object" && module && module.exports) module.exports = API;
}(typeof globalThis !== "undefined" ? globalThis : this));
