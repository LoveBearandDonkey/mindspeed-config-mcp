# MCP 远程使用

## 当前端点

Streamable HTTP 服务提供两个端点：

| 路径 | 用途 | 是否需要 Token |
| --- | --- | --- |
| `/mcp` | 五个计算 Tool、六个自定义界面入口、结构化结果和 MCP App 资源 | 是 |
| `/health` | 负载均衡和进程探活 | 否 |

健康检查只返回服务名、版本、传输类型、Tool 数量和运行时长，不返回 Token、配置内容
或服务器路径。

## 本机启动

先生成至少 32 字符的随机 Token。PowerShell 示例：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$env:MCP_BEARER_TOKEN = ([BitConverter]::ToString($bytes)).Replace("-", "")
npm run start:http
```

这段写法同时兼容 Windows PowerShell 5.1 和 PowerShell 7。不要使用只在较新 .NET 中提供的
`RandomNumberGenerator.Fill()` 或 `Convert.ToHexString()`。

默认地址：

```text
MCP:    http://127.0.0.1:3000/mcp
Health: http://127.0.0.1:3000/health
```

检查健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

## 服务器监听

需要让反向代理或其他主机连接时：

```powershell
$env:MCP_HTTP_HOST = "0.0.0.0"
$env:MCP_HTTP_PORT = "3000"
$env:MCP_ALLOWED_HOSTS = "mcp.example.com,127.0.0.1"
$env:MCP_BEARER_TOKEN = "由密钥管理系统注入的随机值"
npm run start:http
```

监听 `0.0.0.0` 或 `::` 时，如果未设置 `MCP_ALLOWED_HOSTS`，服务会拒绝启动。允许列表
只填写主机名或 IP，不填写协议和端口。

若浏览器环境会直接连接 `/mcp`，可另外设置逗号分隔的 `MCP_ALLOWED_ORIGINS`。普通
桌面或服务器 MCP 客户端通常不发送 `Origin`，无需配置这一项。

## 客户端参数

远程客户端需要：

- URL：`https://mcp.example.com/mcp`
- 请求头：`Authorization: Bearer <MCP_BEARER_TOKEN>`
- 传输：Streamable HTTP

支持 MCP Apps 的客户端会读取 `ui://mindspeed-config/result-view.html` 并渲染界面；
不支持界面的客户端仍可使用文本和 `structuredContent`。

## 生产安全边界

- 不要把真实 Token 写入 `.env.example`、Git、镜像层或部署日志；
- 公网或跨主机访问必须在反向代理处启用 HTTPS；
- 当前是单一静态 Token，适合第一版受控内部部署，不等同于多用户 OAuth；
- Token 泄露后应立即轮换并重启进程；
- `/health` 可以公开给探活系统，`/mcp` 不允许匿名访问；
- 服务只解析请求中显式提交的配置文本，不根据用户路径读取服务器文件。

## 验证

```powershell
npm run test:http
```

测试会验证无 Token 返回 401、健康检查、公开监听安全门禁，以及带 Token 的官方
Streamable HTTP 客户端能够调用 Tool 和读取 MCP App 资源。
