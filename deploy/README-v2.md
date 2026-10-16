# V2 腾讯云试验实例

V2 在 `main` 开发，腾讯云上单独运行：容器 `mindspeed-config-mcp-v2`、回环端口 `3003`、HTTPS 路径 `/mindspeed-config-v2/`。现行 V1 保持在容器 `mindspeed-config-mcp`、端口 `3002`、路径 `/mindspeed-config/`。两个 MCP 地址需要在 Agent 中配置成不同服务，测试时明确选择 V2。

## 安装或更新

将本次 V2 改动提交并推送至 `origin/main`，在干净的 `main` 工作树运行：

```powershell
npm test
npm run smoke:http
powershell -ExecutionPolicy Bypass -File deploy/deploy-v2.ps1
```

脚本只接受已推送的精确提交，用 Git bundle 在服务器创建独立发布目录，构建 V2 镜像后才切换 V2 容器；构建期间旧 V2 和现行 V1 继续运行。首次安装从现行服务的服务器端 `.env` 复制凭据，后续更新沿用 V2 自己的 `.env.v2`；凭据始终留在服务器，不进入 Git、镜像或脚本输出。若需要单独轮换 V2 凭据，只修改服务器当前 V2 发布目录的 `deploy/.env.v2`，不要改现行 V1 的 `.env`。脚本校验镜像提交标签、V2 健康检查、未授权访问返回 401、V1 镜像不变，还会实际调用第 1、2 项涉及的 MCP 工具；已有 V2 镜像会保留回退标签。

第一次安装时，脚本还会把独立 Nginx 路由加入现有 HTTPS server 的 snippet，运行 `nginx -t` 后平滑重载。公网只开放现有 443；3003 仅绑定服务器回环地址。之后更新只需重复同一命令。

地址：

| 用途 | V2 试验地址 |
| --- | --- |
| 工作台 | `https://42.192.111.92/mindspeed-config-v2/` |
| MCP Streamable HTTP | `https://42.192.111.92/mindspeed-config-v2/mcp` |
| 健康检查 | `https://42.192.111.92/mindspeed-config-v2/health` |

浏览器首次访问输入服务器上配置的浏览器访问码。首次安装复用现行服务访问码；`MCP_BROWSER_ACCESS_TOKEN` 为空时使用 Bearer Token。MCP 客户端使用服务器上的 `MCP_BEARER_TOKEN`，HTTP Header 为 `Authorization: Bearer <token>`。不要把 Token 写入聊天、配置仓库或命令行历史。可给 V2 单独轮换 MCP Token，并保留原浏览器访问码。直接用浏览器打开 `/mcp` 会因为没有 Bearer Token 返回 `Unauthorized`，这是鉴权生效的表现；浏览器工作台应打开上表中的 `/mindspeed-config-v2/`。

### VS Code 中的 Codex

Codex CLI 与 VS Code Codex 扩展共用 MCP 配置。在本机有 `codex` 命令时运行：

```powershell
codex mcp add mindspeed-config-v2 `
  --url https://42.192.111.92/mindspeed-config-v2/mcp `
  --bearer-token-env-var MINDSPEED_CONFIG_V2_MCP_TOKEN
codex mcp list
```

把 V2 专用 Bearer Token 存在本机用户环境变量 `MINDSPEED_CONFIG_V2_MCP_TOKEN`；不要写进 Git 或 `config.toml`。VS Code 必须在取得该环境变量后重新启动，Codex 扩展也要重新加载 MCP 连接。Codex 的 MCP 服务器列表中应能看到 `mindspeed-config-v2`；保留原有 V1 连接即可并行对比。此配置只把工具提供给 Agent；真正的文件修改由 Codex 对本地工程执行，MCP 服务器只接受源文本并返回只读分析和复查结果。

## 验证第 1、2 项

1. 在 Agent 会话中确认调用的是 `mindspeed-config-v2`，输入一份有代表性的源配置，问“这套配置最重要的问题是什么，依据和下一步是什么”。核对聊天中直接出现短结论、首要问题、依据和下一步；完整 `structuredContent` 仍可查看。对照 V1 同一输入。
2. 在同一会话说“帮我改一下，总卡数和 EP 不动”。Agent 应先取得原文的 `source_snapshot.sha256`，用锁定字段取得候选，展示将改哪些字段；在用户的工程中修改真实源文件，展示文件差异，重新读取文件后调用 `review_config_change`。核对复查基于新文本，锁定字段未变。MCP 工具本身不写文件。
3. 用故意改动的旧文件或改动锁定字段再试一次，应能看到“基线过期”或“锁定字段变化”提示；不要把页面临时方案当作源文件修改。

可用 `curl` 无凭据检查公开入口：`/mindspeed-config-v2/health` 应返回 `status: ok`，`/mindspeed-config-v2/mcp` 应返回 `401`。每次更新记下脚本输出的提交、镜像 ID 和发布目录，以便复现与回退。
