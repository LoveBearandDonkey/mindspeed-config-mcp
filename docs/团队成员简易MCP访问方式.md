# MindSpeed Config MCP 访问方式

MindSpeed Config MCP 当前提供两种正式访问方式：浏览器工作台和标准 MCP 客户端。普通体验用户不需要 SSH 账号、SSH 公私钥、Node.js、Docker 或本地脚本。

## 一、浏览器工作台

适合没有 Codex、VS Code MCP 或其他 MCP 客户端的用户。

访问地址：

```text
https://42.192.111.92/mindspeed-config/
```

使用步骤：

1. 在浏览器地址栏打开上述 HTTPS 地址；
2. 输入管理员通过安全渠道提供的浏览器访问码；
3. 登录后导入或填写训练配置；
4. 页面通过同源 HTTPS API 调用腾讯云上的 MindSpeed Config 服务并展示结果。

浏览器访问码对应服务器环境变量 `MCP_BROWSER_ACCESS_TOKEN`。验证成功后，服务器只向浏览器下发 `HttpOnly + Secure + SameSite=Strict` 会话 Cookie；访问码不会写入 URL、页面脚本或 `localStorage`。

浏览器工作台不是静态离线体验包。配置解析、校验、Rank 拓扑、修复建议和理论容量估算均由腾讯云服务端执行，并与 MCP Tool 共用 `packages/config-core/` 中的计算规则。

## 二、MCP 客户端

适合 Codex、VS Code 或其他支持 Streamable HTTP 的 MCP 客户端。

连接参数：

| 项目 | 值 |
| --- | --- |
| 传输协议 | Streamable HTTP |
| MCP URL | `https://42.192.111.92/mindspeed-config/mcp` |
| 请求头 | `Authorization: Bearer <MCP_BEARER_TOKEN>` |

在客户端中新增 HTTP MCP 服务时，填写上面的 URL，并把管理员单独提供的 MCP Bearer token 放入 `Authorization` 请求头。不要在 token 前重复添加两个 `Bearer`，也不要把 token 写入项目仓库或聊天记录。

客户端连接成功后，可以枚举并调用配置校验、Rank 拓扑、配置修复建议、原始配置解析和理论容量估算等 Tool。支持 MCP Apps 的客户端还可以读取 `ui://mindspeed-config/result-view.html` 并渲染工作台界面。

### Codex 示例

先通过当前终端的环境变量提供 token，再登记远程 MCP：

```powershell
$env:MINDSPEED_CONFIG_MCP_TOKEN = "<管理员提供的 MCP Bearer token>"
codex mcp add mindspeedConfig `
  --url https://42.192.111.92/mindspeed-config/mcp `
  --bearer-token-env-var MINDSPEED_CONFIG_MCP_TOKEN
```

重新启动或刷新 Codex 后，确认工具列表中出现 `mindspeedConfig`。环境变量需要在启动 Codex 的进程环境中可见。

### VS Code 示例

在可信工作区的 `.vscode/mcp.json` 中使用密码输入框，不把 token 直接写进文件：

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "mindspeed-config-token",
      "description": "输入 MindSpeed Config MCP token，不要添加 Bearer",
      "password": true
    }
  ],
  "servers": {
    "mindspeedConfig": {
      "type": "http",
      "url": "https://42.192.111.92/mindspeed-config/mcp",
      "headers": {
        "Authorization": "Bearer ${input:mindspeed-config-token}"
      }
    }
  }
}
```

## 三、两类凭据不要混用

| 凭据 | 用途 | 普通浏览器用户是否需要 |
| --- | --- | --- |
| 浏览器访问码 | 登录公网浏览器工作台 | 需要 |
| MCP Bearer token | MCP 客户端调用 `/mcp` | 不需要 |
| SSH 私钥 | 服务器部署、维护和故障诊断 | 不需要 |

浏览器访问码与 MCP Bearer token 已分离。分享浏览器体验时只提供浏览器地址和浏览器访问码，不提供 MCP token 或 SSH 凭据。

## 四、健康检查与故障排查

健康检查地址：

```text
https://42.192.111.92/mindspeed-config/health
```

正常时会返回包含以下字段的 JSON：

```json
{
  "status": "ok",
  "service": "mindspeed-config-mcp"
}
```

常见问题：

- 页面和健康检查都打不开：部分公司代理会拦截直接访问公网 IP。关闭代理、为 `42.192.111.92` 配置代理绕过规则，或切换手机热点后重试；
- 页面能打开但提示访问码错误：确认输入的是浏览器访问码，而不是 MCP Bearer token；
- MCP 客户端返回 `401 Unauthorized`：检查 Bearer token 是否正确、是否已轮换，以及请求头是否为 `Authorization: Bearer <token>`；
- 健康检查正常但页面异常：使用无痕窗口重试，并把浏览器控制台错误交给管理员；
- 客户端能调用 Tool 但看不到界面：该客户端可能不支持 MCP Apps，仍可使用文本结果和 `structuredContent`。

## 五、安全要求

- 访问码和 token 只通过受控渠道发送，不提交到 Git；
- 不把凭据放在 URL 查询参数、截图、公开文档或共享脚本中；
- 多人共用同一浏览器访问码时，任何一人泄露都会影响全部使用者；
- 凭据泄露后立即轮换，并使旧会话失效；
- 腾讯云服务只通过公网 HTTPS 入口暴露，后端 `3002` 端口继续绑定 `127.0.0.1`；
- SSH 仅供部署和运维人员使用，不再作为普通用户的体验流程。
