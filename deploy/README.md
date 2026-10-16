# 部署

如果只需要让团队先体验页面和五项纯计算能力，可使用
[`github-pages/`](github-pages/) 中的静态体验包。它不连接远程服务，也不提供 MCP 协议端点；
重新生成命令是 `npm run package:github-pages`。

第一版部署目标是无 NPU、无 CANN、无 PyTorch 依赖的 CPU 服务。当前配置面向腾讯云
Ubuntu 24.04 x86_64 服务器：容器端口只发布到宿主机回环地址，由宿主机现有 HTTPS 443
反向代理提供浏览器工作台和 MCP 双入口，不直接开放公网 MCP 端口。

## 服务器预检

```bash
docker version
docker compose version
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
sudo ss -lntp | grep -E ':(3000|3001|3002|8787)\b' || true
df -h /
free -h
```

不得停止、重启或改写现有服务。2026-10-12 实机检查确认 3000 已由 `ascend-tiling-mcp`
占用、3001 已由 Node 服务监听，本服务固定使用宿主机回环端口 3002。

## 创建运行参数

在 `deploy/` 目录执行：

```bash
cp .env.example .env
chmod 600 .env
TOKEN="$(openssl rand -hex 32)"
sed -i "s|replace-with-a-random-token-at-least-32-characters|$TOKEN|" .env
unset TOKEN
```

`.env` 只能保存在服务器上，不提交 Git，也不要把 Token 写入命令历史、镜像层或聊天记录。
浏览器访问码可通过 `MCP_BROWSER_ACCESS_TOKEN` 单独设置；留空时复用
`MCP_BEARER_TOKEN`。面向多人分享时建议使用独立值，方便与 MCP 客户端凭据分别轮换。

## 构建和启动

```bash
sudo docker compose config --quiet
sudo docker compose build --pull
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=100 mcp
```

容器以非 root 用户、只读根文件系统和删除全部 Linux capabilities 的方式运行。UI 在镜像
构建阶段生成；运行时直接启动 `apps/mcp-server/src/http-entry.js`，不会重复构建页面。

## 服务器本机验收

以下命令不会显示 Token：

```bash
curl --fail --silent --show-error http://127.0.0.1:${MCP_HOST_PORT:-3002}/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  http://127.0.0.1:${MCP_HOST_PORT:-3002}/mcp
```

第一条应返回 `status: ok`，第二条应返回 `401`。完整 MCP 握手由本机测试脚本或支持
Streamable HTTP 的客户端携带 Bearer Token 验证。

## 接入现有 HTTPS 443

把 [`nginx-mindspeed-config.conf.example`](nginx-mindspeed-config.conf.example) 中的两个
`location` 放入现有 HTTPS `server` 块，执行 `nginx -t` 后平滑重载。反向代理只连接
`127.0.0.1:3002`，腾讯云安全组不开放 3002。

公网入口：

```text
浏览器工作台: https://42.192.111.92/mindspeed-config/
MCP:          https://42.192.111.92/mindspeed-config/mcp
Health:       https://42.192.111.92/mindspeed-config/health
```

浏览器首次打开时输入访问码，服务端换发 `HttpOnly + Secure + SameSite=Strict` 会话
Cookie；页面不保存长期凭据，五项计算均通过同源 API 在腾讯云服务端执行。

Codex 可使用环境变量保存个人 Token：

```powershell
codex mcp add mindspeedConfig `
  --url https://42.192.111.92/mindspeed-config/mcp `
  --bearer-token-env-var MINDSPEED_CONFIG_MCP_TOKEN
```

## SSH 隧道应急入口

公网 443 故障排查期间，运维人员仍可在自己的电脑执行以下命令，窗口保持运行：

```powershell
ssh -i "$env:USERPROFILE\.ssh\mindspeed_config_mcp" `
  -N -L 13000:127.0.0.1:3002 ubuntu@42.192.111.92
```

应急客户端参数：

```text
URL: http://127.0.0.1:13000/mcp
Authorization: Bearer <MCP_BEARER_TOKEN>
Transport: Streamable HTTP
```

运行参数和安全边界另见 [MCP 服务端配置与运维](../docs/MCP服务端配置与运维.md)。
