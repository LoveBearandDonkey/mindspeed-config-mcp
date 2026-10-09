# MCP 本地模拟验收

没有部署服务器也可以完整验证 MCP。建议分成“自动协议验收”和“人工界面验收”两层。
这两层都只在本机运行，不启动训练，也不依赖 MindSpeed Agent 源仓库。

## 一键自动验收

在项目根目录运行：

```powershell
npm run smoke:http
```

脚本会自动完成以下工作：

1. 生成仅存在于当前进程内的临时 Token；
2. 在 `127.0.0.1` 的随机空闲端口启动 Streamable HTTP 服务；
3. 验证 `/health`；
4. 验证无 Token 调用 `/mcp` 会返回 401；
5. 使用官方 MCP 客户端完成握手，枚举五个计算 Tool 和六个自定义界面入口；
6. 验证六个界面入口均无需输入宿主 JSON 即可打开；
7. 用演示配置真实调用五个分析 Tool；
8. 读取并校验 `ui://mindspeed-config/result-view.html`；
9. 关闭客户端和临时服务。

该命令验证的是“服务、协议、五项计算和界面资源能否连通”，不会打开浏览器。命令退出码为
`0` 表示全部通过，任一断言失败会以非零退出码结束。

## 在浏览器中验收界面

### 1. 启动本地服务

在第一个 PowerShell 窗口运行：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = ([BitConverter]::ToString($bytes)).Replace("-", "")
$env:MCP_BEARER_TOKEN = $token
$token
npm run start:http
```

保存终端打印的 Token，并保持该窗口运行。默认 MCP 地址是
`http://127.0.0.1:3000/mcp`。上述生成方式同时兼容 Windows PowerShell 5.1 和
PowerShell 7。

### 2. 启动 MCP Inspector

打开第二个 PowerShell 窗口，先把刚才保存的 Token 填入环境变量，再运行：

```powershell
$env:MCP_BEARER_TOKEN = "粘贴第一个窗口打印的 Token"
npx @modelcontextprotocol/inspector@latest `
  --server-url http://127.0.0.1:3000/mcp `
  --transport http `
  --header "Authorization: Bearer $env:MCP_BEARER_TOKEN"
```

首次执行 `npx` 需要联网下载 Inspector；当前 Inspector 需要 Node.js 22.19 或更高版本。
打开 Inspector 页面后：

1. 确认服务器连接成功；
2. 打开 **Apps** 标签；
3. 选择统一工作台或任一“打开…”界面入口；
4. 直接点击 **Open App**，该入口不需要填写 JSON；
5. 在中文界面中选择或拖入 YAML、JSON、Shell 文件，也可以粘贴内容；
6. 点击 **解析全部配置**，核对字段来源、冲突和红色缺项；
7. 补齐必填项后，选择校验、Rank 矩阵、修复建议或理论容量；
8. 检查下方的中文结果卡片和表格。

Inspector 的 `--header` 会把静态 Bearer Token 发给本地 MCP 服务，不需要临时关闭鉴权。

## 验收口径

| 层次 | 证明了什么 | 没有证明什么 |
| --- | --- | --- |
| `npm test` | 纯计算、契约、golden、stdio 与 HTTP 回归通过 | 浏览器视觉效果 |
| `npm run smoke:http` | 未部署时，真实 HTTP、鉴权、五个计算 Tool、六个自定义界面入口和 App 资源连通 | 用户看到的排版是否合适 |
| Inspector Apps | App 能在沙箱中渲染，交互和排版可人工检查 | 生产域名、TLS、反向代理和服务器资源配置 |
| 服务器部署后验收 | 真实网络、HTTPS、守护进程和目标 Host 接入 | 训练实测结果；第一版不启动训练 |

## 官方参考

- [MCP Inspector 的服务器配置与自定义请求头](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md)
- [MCP Inspector 的 Apps 标签测试说明](https://github.com/modelcontextprotocol/inspector/blob/main/docs/test-servers.md#mcp-apps)
- [MCP Apps 的本地测试指南](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/testing-mcp-apps.md)
