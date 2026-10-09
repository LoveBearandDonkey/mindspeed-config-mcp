import deepspeedZero3 from "./config-test/ds_z3_config.json?raw";
import hfDeepSeek from "./config-test/hf_deepseekv3_config.json?raw";
import hfMixtral from "./config-test/hf_mixtral_config.json?raw";
import hfQwen from "./config-test/hf_qwen2_7b_config.json?raw";
import llamaFactoryFull from "./config-test/lf_qwen3_full_sft.yaml?raw";
import llamaFactoryLora from "./config-test/lf_qwen3_lora_sft.yaml?raw";
import megatron175b from "./config-test/megatron_175b.sh?raw";
import megatronLlama3 from "./config-test/megatron_llama3_8b_fp8.sh?raw";
import mindFormersDeepSeek from "./config-test/mf_pretrain_deepseek3_671b.yaml?raw";
import mindFormersQwen from "./config-test/mf_pretrain_qwen3_30b_a3b.yaml?raw";
import mixtralShell from "./config-test/mixtral_8x7b.sh?raw";

const quickMixtral = `model-id: Mixtral-8x7B
num-layers: 32
hidden-size: 4096
num-attention-heads: 32
num-key-value-heads: 8
ffn-hidden-size: 14336
vocab-size: 32000
num-experts: 8
moe-router-topk: 2
num-shared-experts: 0
dp: 8
pp: 2
tp: 2
cp: 1
ep: 4
vpp: 1
ep-mode: split
cp-mode: ring
sequence-parallel: true
vocab-embedding-data-parallel: false
expert-tensor-parallel: false
total-ranks: 32
ranks-per-node: 8
card-model: 昇腾 910B
card-memory-gib: 64
micro-batch-size: 1
seq-length: 4096
num-microbatches: 4
compute-dtype: bf16
params-dtype: fp32
recompute-mode: selective
shard-mode: zero1
lora-enabled: false`;

const quickQwen = `model-id: Qwen2-7B
num-layers: 28
hidden-size: 3584
num-attention-heads: 28
num-key-value-heads: 4
ffn-hidden-size: 18944
vocab-size: 152064
num-experts: 0
top-k: 0
num-shared-experts: 0
dp: 2
pp: 2
tp: 2
cp: 1
ep: 1
vpp: 1
ep-mode: split
cp-mode: ring
sequence-parallel: true
vocab-embedding-data-parallel: false
expert-tensor-parallel: false
total-ranks: 8
ranks-per-node: 8
card-model: 昇腾 910B
card-memory-gib: 64
micro-batch-size: 1
seq-length: 4096
num-microbatches: 4
compute-dtype: bf16
params-dtype: fp32
recompute-mode: selective
shard-mode: zero1
lora-enabled: false`;

export const SAMPLE_CATALOG = Object.freeze([
  sample("quick-mixtral", "开箱即用", "quickstart_mixtral_8x7b.yaml", "yaml", "完整 MoE 配置，可直接运行全部 MCP 工具。", quickMixtral, true),
  sample("quick-qwen", "开箱即用", "quickstart_qwen2_7b.yaml", "yaml", "完整 Dense 配置，可直接生成拓扑与容量。", quickQwen, true),
  sample("hf-deepseek", "上游 config-test", "hf_deepseekv3_config.json", "json", "Hugging Face DeepSeek-V3 模型配置。", hfDeepSeek),
  sample("hf-mixtral", "上游 config-test", "hf_mixtral_config.json", "json", "Hugging Face Mixtral 模型配置。", hfMixtral),
  sample("hf-qwen", "上游 config-test", "hf_qwen2_7b_config.json", "json", "Hugging Face Qwen2 模型配置。", hfQwen),
  sample("megatron-175b", "上游 config-test", "megatron_175b.sh", "shell", "Megatron 175B 启动脚本。", megatron175b),
  sample("megatron-llama3", "上游 config-test", "megatron_llama3_8b_fp8.sh", "shell", "Megatron Llama3 8B FP8 启动脚本。", megatronLlama3),
  sample("mixtral-shell", "上游 config-test", "mixtral_8x7b.sh", "shell", "Megatron Mixtral 8x7B 启动脚本。", mixtralShell),
  sample("mf-deepseek", "上游 config-test", "mf_pretrain_deepseek3_671b.yaml", "yaml", "MindFormers DeepSeek3 671B 配置。", mindFormersDeepSeek),
  sample("mf-qwen", "上游 config-test", "mf_pretrain_qwen3_30b_a3b.yaml", "yaml", "MindFormers Qwen3 MoE 配置。", mindFormersQwen),
  sample("lf-full", "上游 config-test", "lf_qwen3_full_sft.yaml", "yaml", "LLaMA-Factory 全参微调配置。", llamaFactoryFull),
  sample("lf-lora", "上游 config-test", "lf_qwen3_lora_sft.yaml", "yaml", "LLaMA-Factory LoRA 微调配置。", llamaFactoryLora),
  sample("ds-zero3", "上游 config-test", "ds_z3_config.json", "json", "DeepSpeed ZeRO-3 配置。", deepspeedZero3),
]);

function sample(id, group, name, format, description, content, complete = false) {
  return Object.freeze({ id, group, name, format, description, content, complete });
}
