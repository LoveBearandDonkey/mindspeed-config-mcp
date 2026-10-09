// 内置样例只提供原始文本；字段归一化始终由 parse_training_config 完成。
// “开箱即用”样例是从 config-relation-plane 样例族整理出的完整组合，不承载计算公式。
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

const quickDeepSeek = `model-id: DeepSeek-V3
num-layers: 61
hidden-size: 7168
num-attention-heads: 128
num-key-value-heads: 128
ffn-hidden-size: 18432
moe-ffn-hidden-size: 2048
vocab-size: 129280
first-k-dense-replace: 3
num-experts: 256
moe-router-topk: 8
num-shared-experts: 1
dp: 8
pp: 1
tp: 8
cp: 1
ep: 8
vpp: 1
ep-mode: split
cp-mode: ring
sequence-parallel: true
vocab-embedding-data-parallel: false
expert-tensor-parallel: false
total-ranks: 64
ranks-per-node: 8
card-model: 昇腾 910B
card-memory-gib: 64
micro-batch-size: 1
seq-length: 4096
num-microbatches: 8
compute-dtype: bf16
params-dtype: fp32
recompute-mode: full
shard-mode: zero1
lora-enabled: false`;

const hfMixtral = `{
  "architectures": ["MixtralForCausalLM"],
  "model_type": "mixtral", "num_hidden_layers": 32,
  "hidden_size": 4096, "intermediate_size": 14336,
  "num_attention_heads": 32, "num_key_value_heads": 8,
  "num_local_experts": 8, "num_experts_per_tok": 2,
  "torch_dtype": "bfloat16", "vocab_size": 32000
}`;

const hfDeepSeek = `{
  "model_type": "deepseek_v3", "num_hidden_layers": 61,
  "hidden_size": 7168, "intermediate_size": 18432,
  "moe_intermediate_size": 2048, "num_attention_heads": 128,
  "num_key_value_heads": 128, "first_k_dense_replace": 3,
  "n_routed_experts": 256, "n_shared_experts": 1,
  "num_experts_per_tok": 8, "torch_dtype": "bfloat16", "vocab_size": 129280
}`;

const hfQwen = `{
  "model_type": "qwen2", "num_hidden_layers": 28,
  "hidden_size": 3584, "intermediate_size": 18944,
  "num_attention_heads": 28, "num_key_value_heads": 4,
  "torch_dtype": "bfloat16", "vocab_size": 152064
}`;

const megatron175b = `#!/bin/bash
GPUS_PER_NODE=8
NUM_NODES=16
WORLD_SIZE=$(($GPUS_PER_NODE*$NUM_NODES))
torchrun --nproc_per_node $GPUS_PER_NODE --nnodes $NUM_NODES pretrain_gpt.py \\
  --num-layers 96 --hidden-size 12288 --num-attention-heads 96 \\
  --seq-length 2048 --micro-batch-size 1 --global-batch-size 1536 \\
  --tensor-model-parallel-size 8 --pipeline-model-parallel-size 16 --fp16`;

const mixtralShell = `#!/bin/bash
GPUS_PER_NODE=8
NNODES=8
WORLD_SIZE=$(($GPUS_PER_NODE*$NNODES))
torchrun --nproc_per_node $GPUS_PER_NODE --nnodes $NNODES pretrain_gpt.py \\
  --num-layers 32 --hidden-size 4096 --ffn-hidden-size 14336 \\
  --num-attention-heads 32 --num-query-groups 8 --seq-length 4096 \\
  --num-experts 8 --moe-router-topk 2 --micro-batch-size 1 --global-batch-size 256 \\
  --tensor-model-parallel-size 1 --pipeline-model-parallel-size 4 \\
  --expert-model-parallel-size 8 --sequence-parallel --use-distributed-optimizer --bf16`;

const mindFormersQwen = `parallel_config:
  data_parallel: 1
  model_parallel: 4
  pipeline_stage: 4
  expert_parallel: 4
  micro_batch_num: 16
  use_seq_parallel: true
parallel:
  enable_parallel_optimizer: false
model:
  model_config:
    model_type: qwen3_moe
    num_hidden_layers: 48
    hidden_size: 2048
    intermediate_size: 6144
    num_attention_heads: 32
    num_key_value_heads: 4
    vocab_size: 151936
    num_experts: 128
    num_experts_per_tok: 8
    moe_intermediate_size: 768
    params_dtype: float32
    compute_dtype: bfloat16`;

const llamaFactoryFull = `model_name_or_path: Qwen/Qwen3-4B-Instruct-2507
finetuning_type: full
cutoff_len: 2048
per_device_train_batch_size: 1
gradient_accumulation_steps: 2
bf16: true`;

const llamaFactoryLora = `model_name_or_path: Qwen/Qwen3-4B-Instruct-2507
finetuning_type: lora
lora_rank: 8
cutoff_len: 2048
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
bf16: true`;

const deepspeedZero3 = `{
  "train_batch_size": 32,
  "train_micro_batch_size_per_gpu": 1,
  "gradient_accumulation_steps": 4,
  "bf16": { "enabled": true },
  "zero_optimization": { "stage": 3, "overlap_comm": false }
}`;

export const BUILTIN_CONFIGS = Object.freeze([
  { id: "quick-mixtral", group: "开箱即用", name: "quickstart_mixtral_8x7b.yaml", format: "yaml", description: "完整 MoE 配置，可直接生成拓扑与理论显存", content: quickMixtral },
  { id: "quick-qwen", group: "开箱即用", name: "quickstart_qwen2_7b.yaml", format: "yaml", description: "完整 Dense 配置，可直接运行全部工具", content: quickQwen },
  { id: "quick-deepseek", group: "开箱即用", name: "quickstart_deepseek_v3.yaml", format: "yaml", description: "含 Dense/MoE 分层与 256 专家切片", content: quickDeepSeek },
  { id: "hf-deepseek", group: "原页面样例", name: "hf_deepseekv3_config.json", format: "json", description: "Hugging Face DeepSeek-V3 模型片段", content: hfDeepSeek },
  { id: "hf-mixtral", group: "原页面样例", name: "hf_mixtral_config.json", format: "json", description: "Hugging Face Mixtral 模型片段", content: hfMixtral },
  { id: "hf-qwen", group: "原页面样例", name: "hf_qwen2_7b_config.json", format: "json", description: "Hugging Face Qwen2 模型片段", content: hfQwen },
  { id: "megatron-175b", group: "原页面样例", name: "megatron_175b.sh", format: "shell", description: "Megatron 175B 启动脚本", content: megatron175b },
  { id: "mixtral-shell", group: "原页面样例", name: "mixtral_8x7b.sh", format: "shell", description: "Megatron Mixtral 启动脚本", content: mixtralShell },
  { id: "mf-qwen", group: "原页面样例", name: "mf_pretrain_qwen3_30b_a3b.yaml", format: "yaml", description: "MindFormers Qwen3 MoE 配置片段", content: mindFormersQwen },
  { id: "lf-full", group: "原页面样例", name: "lf_qwen3_full_sft.yaml", format: "yaml", description: "LLaMA-Factory 全参微调片段", content: llamaFactoryFull },
  { id: "lf-lora", group: "原页面样例", name: "lf_qwen3_lora_sft.yaml", format: "yaml", description: "LLaMA-Factory LoRA 微调片段", content: llamaFactoryLora },
  { id: "ds-zero3", group: "原页面样例", name: "ds_z3_config.json", format: "json", description: "DeepSpeed ZeRO-3 配置片段", content: deepspeedZero3 },
]);
