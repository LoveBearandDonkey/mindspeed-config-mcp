GPUS_PER_NODE=8
NNODES=2
WORLD_SIZE=$(($GPUS_PER_NODE*$NNODES))

MODEL_ARGS=(
  --num-layers 31
  --hidden-size 4096
  --num-attention-heads 32
  --num-experts 8
  --moe-router-topk 2
  --tensor-model-parallel-size 3
  --pipeline-model-parallel-size 2
  --data-parallel-size 4
  --sequence-parallel
  --card-model Ascend910B
  --card-memory-gib 64
  --seq-length 4096
  --num-microbatches 4
  --micro-batch-size 1
  --global-batch-size 16
  --compute-dtype bf16
  --params-dtype fp32
  --custom-optimizer-flag on
)

torchrun --nproc-per-node $GPUS_PER_NODE --nnodes $NNODES train.py
