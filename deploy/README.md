# 部署

第一版部署目标是无 NPU、无 CANN、无 PyTorch 依赖的 CPU 服务。当前配置面向腾讯云
Ubuntu 24.04 x86_64 服务器的团队内部测试：容器端口只发布到宿主机回环地址，测试人员
通过 SSH 隧道访问，不开放公网 MCP 端口。

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

## 团队成员通过 SSH 隧道访问

在成员自己的电脑执行，窗口保持运行：

```powershell
ssh -i "$env:USERPROFILE\.ssh\mindspeed_config_mcp" `
  -N -L 13000:127.0.0.1:3002 ubuntu@42.192.111.92
```

客户端参数：

```text
URL: http://127.0.0.1:13000/mcp
Authorization: Bearer <MCP_BEARER_TOKEN>
Transport: Streamable HTTP
```

运行参数和安全边界另见 [MCP 远程使用](../docs/MCP远程使用.md)。
