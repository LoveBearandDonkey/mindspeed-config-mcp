# V2 腾讯云试验实例

V2 在 `main` 开发，腾讯云上单独运行：容器 `mindspeed-config-mcp-v2`、回环端口 `3003`、HTTPS 路径 `/mindspeed-config-v2/`。现行 V1 保持在容器 `mindspeed-config-mcp`、端口 `3002`、路径 `/mindspeed-config/`。两个 MCP 地址需要在 Agent 中配置成不同服务，测试时明确选择 V2。

## 安装或更新

将本次 V2 改动提交并推送至 `origin/main`，在干净的 `main` 工作树运行：

```powershell
npm test
npm run smoke:http
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/deploy-v2.ps1
```

脚本只接受已推送的精确提交，用 Git bundle 在服务器创建独立发布目录，构建 V2 镜像后才切换 V2 容器；构建期间旧 V2 和现行 V1 继续运行。首次安装从现行服务的服务器端 `.env` 复制凭据，后续更新沿用 V2 自己的 `.env.v2`；凭据始终留在服务器，不进入 Git、镜像或脚本输出。若需要单独轮换 V2 凭据，只修改服务器当前 V2 发布目录的 `deploy/.env.v2`，不要改现行 V1 的 `.env`。脚本校验镜像提交标签、V2 健康检查、未授权访问返回 401、V1 镜像不变，并为已有 V2 镜像保留回退标签。

第一次安装时，脚本还会把独立 Nginx 路由加入现有 HTTPS server 的 snippet，运行 `nginx -t` 后平滑重载。公网只开放现有 443；3003 仅绑定服务器回环地址。之后更新只需重复同一命令。

地址：

| 用途 | V2 试验地址 |
| --- | --- |
| 工作台 | `https://42.192.111.92/mindspeed-config-v2/` |
| MCP Streamable HTTP | `https://42.192.111.92/mindspeed-config-v2/mcp` |
| 健康检查 | `https://42.192.111.92/mindspeed-config-v2/health` |

浏览器首次访问输入服务器上配置的浏览器访问码。首次安装复用现行服务访问码；`MCP_BROWSER_ACCESS_TOKEN` 为空时使用 Bearer Token。MCP 客户端使用服务器上的 `MCP_BEARER_TOKEN`，HTTP Header 为 `Authorization: Bearer <token>`。不要把 Token 写入聊天、配置仓库或命令行历史。现有 V1 MCP 客户端配置可以保留，另建名为 `mindspeed-config-v2` 的连接，URL 指向上述 V2 MCP 地址，并通过本机环境变量提供 Token。

## 验证第 1、2 项

1. 在 Agent 会话中确认调用的是 `mindspeed-config-v2`，输入一份有代表性的源配置，问“这套配置最重要的问题是什么，依据和下一步是什么”。核对聊天中直接出现短结论、首要问题、依据和下一步；完整 `structuredContent` 仍可查看。对照 V1 同一输入。
2. 在同一会话说“帮我改一下，总卡数和 EP 不动”。Agent 应先取得原文的 `source_snapshot.sha256`，用锁定字段取得候选，展示将改哪些字段；在用户的工程中修改真实源文件，展示文件差异，重新读取文件后调用 `review_config_change`。核对复查基于新文本，锁定字段未变。MCP 工具本身不写文件。
3. 用故意改动的旧文件或改动锁定字段再试一次，应能看到“基线过期”或“锁定字段变化”提示；不要把页面临时方案当作源文件修改。

可用 `curl` 无凭据检查公开入口：`/mindspeed-config-v2/health` 应返回 `status: ok`，`/mindspeed-config-v2/mcp` 应返回 `401`。每次更新记下脚本输出的提交、镜像 ID 和发布目录，以便复现与回退。
