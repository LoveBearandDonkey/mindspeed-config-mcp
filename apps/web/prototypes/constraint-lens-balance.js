import { parallelWorld } from "../../../packages/config-core/src/page-rules.js";
import { validateParallelConfig } from "../../../packages/config-core/src/validate-parallel-config.js";

/**
 * Experimental prototype interaction policy. It does not extend config-core or MCP.
 * Rule source: compute-graph-viewer-wzh:shared/plane-rules.js@1e6bb6e.
 * Every candidate is checked with validateParallelConfig; search order is a UI
 * preference, not an additional MindSpeed training rule.
 */
export const REBALANCE_FIELD_LIMITS = Object.freeze({
  dp: 1024, pp: 1024, tp: 1024, cp: 1024, ep: 1024, ranks: 65536,
});

const FACTOR_FIELDS = Object.freeze(["dp", "pp", "tp", "cp", "ep"]);
const MAX_CANDIDATES = 25000;

function read(config, field) {
  return field === "ranks" ? config.cluster.total_ranks : config.parallel[field];
}

function write(config, field, value) {
  if (field === "ranks") config.cluster.total_ranks = value;
  else config.parallel[field] = value;
}

function divisors(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1) return [];
  const output = new Set();
  for (let part = 1; part * part <= value; part += 1) {
    if (value % part !== 0) continue;
    if (part <= maximum) output.add(part);
    if (value / part <= maximum) output.add(value / part);
  }
  return [...output];
}

function distance(before, after) {
  return Math.abs(Math.log2(after / before));
}

function candidateValues(config, field, limits) {
  const current = read(config, field);
  const maximum = limits[field];
  const values = new Set([1, current - 1, current + 1]);
  for (let value = 1; value <= maximum; value *= 2) values.add(value);
  const hints = [config.cluster.total_ranks];
  if (field === "pp") hints.push(config.model.total_layers);
  if (field === "tp") hints.push(config.model.num_attention_heads, config.model.ffn_hidden_size);
  if (field === "cp") hints.push(config.batch.sequence_length);
  if (field === "ep") hints.push(config.model.routed_experts, config.parallel.dp);
  if (field === "dp") hints.push(config.parallel.ep);
  for (const hint of hints) {
    for (const value of divisors(hint, maximum)) values.add(value);
  }
  return [...values].filter((value) => Number.isSafeInteger(value)
    && value >= 1 && value <= maximum && value !== current)
    .sort((left, right) => distance(current, left) - distance(current, right) || left - right);
}

function candidateOrder(left, right) {
  return left.changes.length - right.changes.length
    || left.distance - right.distance
    || Number(left.changes.some(({ field }) => field === "ranks"))
      - Number(right.changes.some(({ field }) => field === "ranks"))
    || left.key.localeCompare(right.key);
}

export function rebalanceParallelConfig(input, {
  field,
  value,
  editableFields = [...FACTOR_FIELDS, "ranks"],
  lockedFields = [],
  fieldLimits = REBALANCE_FIELD_LIMITS,
} = {}) {
  const limits = Object.fromEntries(Object.entries(REBALANCE_FIELD_LIMITS)
    .map(([name, maximum]) => [name, Math.min(maximum, fieldLimits[name] ?? maximum)]));
  const visible = new Set(editableFields);
  const locked = new Set(lockedFields);
  if (!visible.has(field) || !Object.hasOwn(REBALANCE_FIELD_LIMITS, field)
    || !Number.isSafeInteger(value) || value < 1 || value > limits[field]) {
    return { status: "unavailable", reason: "输入超出当前原型的整数范围。", selection: null, changes: [] };
  }

  const requested = structuredClone(input);
  write(requested, field, value);
  const original = Object.fromEntries([...visible].map((name) => [name, read(input, name)]));
  const editable = [...visible].filter((name) => name !== field && !locked.has(name));
  const factors = FACTOR_FIELDS.filter((name) => visible.has(name) && editable.includes(name));
  const rankEditable = editable.includes("ranks");
  let best = null;
  let considered = 0;
  let searchExhausted = false;

  function consider(config) {
    if (considered >= MAX_CANDIDATES) { searchExhausted = true; return; }
    const world = parallelWorld(config);
    if (!Number.isSafeInteger(world) || world !== config.cluster.total_ranks) return;
    const changes = editable.filter((name) => read(config, name) !== original[name])
      .map((name) => ({ field: name, old_value: original[name], new_value: read(config, name) }));
    const magnitude = changes.reduce((sum, change) => sum
      + distance(change.old_value, change.new_value), 0);
    const candidate = {
      changes,
      distance: magnitude,
      key: changes.map(({ field: name, new_value: next }) => `${name}:${next}`).join("|"),
    };
    if (best && candidateOrder(candidate, best) >= 0) return;
    considered += 1;
    const validation = validateParallelConfig(config);
    if (validation.status !== "valid") return;
    best = { ...candidate, config: structuredClone(config) };
  }

  consider(requested);
  if (!best || best.changes.length) {
    const working = structuredClone(requested);
    if (rankEditable) {
      const world = parallelWorld(working);
      if (Number.isSafeInteger(world) && world >= 1
        && world <= limits.ranks) {
        working.cluster.total_ranks = world;
        consider(working);
      }
      working.cluster.total_ranks = requested.cluster.total_ranks;
    }

    const productFields = requested.parallel.ep_mode === "orthogonal"
      ? FACTOR_FIELDS : FACTOR_FIELDS.filter((name) => name !== "ep");
    const target = requested.cluster.total_ranks;
    const productWorking = structuredClone(requested);

    function searchProduct(index, remaining, changed) {
      if (searchExhausted || (best && changed > best.changes.length)) return;
      if (index === productFields.length) {
        if (remaining !== 1) return;
        if (requested.parallel.ep_mode !== "orthogonal" && factors.includes("ep")) {
          const currentEp = requested.parallel.ep;
          const epOptions = [currentEp, ...candidateValues(productWorking, "ep", limits)];
          for (const ep of epOptions) {
            productWorking.parallel.ep = ep;
            consider(productWorking);
            if (searchExhausted) break;
          }
          productWorking.parallel.ep = currentEp;
        } else consider(productWorking);
        return;
      }
      const name = productFields[index];
      const before = read(requested, name);
      const choices = factors.includes(name)
        ? divisors(remaining, limits[name])
          .sort((left, right) => Number(left !== before) - Number(right !== before)
            || distance(before, left) - distance(before, right) || left - right)
        : [before];
      for (const next of choices) {
        if (remaining % next !== 0) continue;
        productWorking.parallel[name] = next;
        searchProduct(index + 1, remaining / next, changed + Number(next !== before));
        if (searchExhausted) break;
      }
      productWorking.parallel[name] = before;
    }
    searchProduct(0, target, 0);

    if (rankEditable && (!best || best.changes.length >= 2)) {
      const rankWorking = structuredClone(requested);
      const rankFactors = factors;
      function searchWithRank(start, changesLeft) {
        if (searchExhausted) return;
        const world = parallelWorld(rankWorking);
        if (Number.isSafeInteger(world) && world >= 1
          && world <= limits.ranks) {
          rankWorking.cluster.total_ranks = world;
          consider(rankWorking);
        }
        if (changesLeft === 0 || (best && best.changes.length <= 1)) return;
        for (let index = start; index < rankFactors.length; index += 1) {
          const name = rankFactors[index];
          const before = read(requested, name);
          for (const next of candidateValues(rankWorking, name, limits)) {
            rankWorking.parallel[name] = next;
            searchWithRank(index + 1, changesLeft - 1);
            if (searchExhausted) break;
          }
          rankWorking.parallel[name] = before;
          if (searchExhausted) break;
        }
      }
      searchWithRank(0, 2);
    }
  }

  if (!best) return {
    status: "unavailable",
    reason: searchExhausted
      ? "当前搜索范围内未找到同时满足锁定字段与静态约束的组合，已保留原值。"
      : "这个数值无法与未锁字段组成通过静态校验的配置，已保留原值。",
    selection: original,
    changes: [],
    search_exhausted: searchExhausted,
  };
  return {
    status: "balanced",
    selection: Object.fromEntries([...visible].map((name) => [name, read(best.config, name)])),
    changes: best.changes,
    search_exhausted: searchExhausted,
  };
}
