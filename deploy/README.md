# 部署

第一版部署目标是无 NPU、无 CANN、无 PyTorch 依赖的 CPU 服务。

当前已具备：

- Streamable HTTP `/mcp`；
- 无敏感信息的 `/health`；
- 启动时强制检查的静态 Bearer Token；
- 公网监听时强制要求的 Host 允许列表。

生产服务器的系统、CPU 架构、TLS/反向代理和进程托管方式尚未确定，因此暂不提交
Dockerfile 或 systemd 单元，避免把错误的平台假设固化进部署包。运行参数见
[MCP 远程使用](../docs/MCP远程使用.md)。
