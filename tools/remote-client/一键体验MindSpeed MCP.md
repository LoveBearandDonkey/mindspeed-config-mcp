# 一键体验 MindSpeed MCP

适用于 Windows。无需克隆源码，无需安装 Node.js 或 Docker。

> 当前建议先按本文的“手动启动”流程体验。`Start-MindSpeed-MCP.cmd` 暂时只作为试验入口，
> 不把“自动打开 MCP UI”作为它的成功标准。

## 0. 准备体验客户端

1. 获取完整的 `remote-client` 文件夹；需要传递时，将整个文件夹压缩成 ZIP；
2. 通过团队文件盘或 U 盘传递并完整解压；
3. 安装最新版 VS Code，并登录具备 Chat/Agent 权限的账号；
4. 通过安全渠道向管理员取得 `MCP_BEARER_TOKEN`。

成功：解压后的目录同时包含以下四个文件：

```text
Start-MindSpeed-MCP.cmd
connect-mindspeed-mcp.ps1
open-tunnel.cmd
一键体验MindSpeed MCP.md
```

失败：缺少任一脚本时，重新复制整个文件夹。不要把私钥或 Token 放进 ZIP。

## 1. 首次使用：准备 SSH 密钥

这一步每台新电脑只做一次。打开 PowerShell，执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh"
$key = "$env:USERPROFILE\.ssh\mindspeed_config_mcp"
Test-Path $key
```

- 返回 `True`：不要覆盖现有私钥，继续复制公钥；
- 返回 `False`：执行下面的命令生成密钥，再复制公钥。

```powershell
ssh-keygen -t ed25519 -a 64 -f $key -C "your-name@mindspeed-config"
Get-Content "$key.pub" | Set-Clipboard
```

把 `your-name` 换成自己的姓名或工号。只把剪贴板中的 `.pub` 公钥交给管理员，请管理员在线绑定到
`ubuntu@42.192.111.92`。私钥不能发送给任何人。

管理员确认绑定后执行：

```powershell
ssh -o IdentitiesOnly=yes -i $key ubuntu@42.192.111.92
```

成功：看到类似 `ubuntu@VM-0-11-ubuntu:~$`，再执行 `exit` 退出。

失败：

- `Identity file ... not accessible`：执行 `Test-Path $key`，确认私钥路径存在；
- `Permission denied (publickey)`：让管理员核对 `.pub` 公钥是否绑定到正确服务器和 `ubuntu` 用户；
- `Connection timed out`：更换网络，仍失败则让管理员检查腾讯云 `22` 端口。

## 2. 推荐：手动启动

手动流程分为四步：建立 SSH 隧道、确认远端服务健康、在独立 VS Code 工作区配置并启动 MCP、
最后在 Agent 会话中调用 UI 工具。这样可以明确知道问题停在哪一步。

### 2.1 建立 SSH 隧道

在 `remote-client` 文件夹中双击：

```text
open-tunnel.cmd
```

如果出现私钥口令提示，输入生成密钥时设置的口令。标题为
`MindSpeed Config MCP - Keep This Window Open` 的窗口必须保持开启。

如需完全使用命令行，也可以打开一个新的 PowerShell 窗口执行：

```powershell
$key = "$env:USERPROFILE\.ssh\mindspeed_config_mcp"
ssh.exe -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=60 -o ServerAliveCountMax=3 `
  -i $key -N -L 13000:127.0.0.1:3002 ubuntu@42.192.111.92
```

该命令连接成功后通常不会继续输出，也不会返回命令提示符，这是正常现象；保持窗口开启即可。

### 2.2 确认服务健康

另开一个 PowerShell 窗口执行：

```powershell
Invoke-RestMethod http://127.0.0.1:13000/health | ConvertTo-Json
```

成功时应看到以下关键字段：

```json
{
  "status": "ok",
  "service": "mindspeed-config-mcp"
}
```

如果这里失败，先不要打开 VS Code：

- `Connection refused`：SSH 隧道没有成功建立，查看隧道窗口的错误；
- `Permission denied (publickey)`：让管理员核对公钥绑定；
- 本机 `13000` 端口已占用：执行
  `Get-NetTCPConnection -LocalPort 13000 -ErrorAction SilentlyContinue` 查明占用程序；
- 隧道已连接但健康检查失败：联系管理员检查远端 `127.0.0.1:3002` 服务。

### 2.3 在独立 VS Code 工作区配置 MCP

执行以下命令创建专用文件夹，并在**新窗口**中打开它；这不会替换正在编码的 VS Code 窗口：

```powershell
$client = "$env:USERPROFILE\mindspeed-mcp-client"
New-Item -ItemType Directory -Force "$client\.vscode"
code --new-window $client
```

如果系统找不到 `code` 命令，就手动打开 VS Code，选择“文件 → 新建窗口”，再选择
“文件 → 打开文件夹”，打开 `C:\Users\用户名\mindspeed-mcp-client`。

在该文件夹中创建 `.vscode\mcp.json`，内容如下：

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "mindspeed-config-token",
      "description": "只输入 MindSpeed Config MCP Token，不要添加 Bearer",
      "password": true
    }
  ],
  "servers": {
    "mindspeedConfig": {
      "type": "http",
      "url": "http://127.0.0.1:13000/mcp",
      "headers": {
        "Authorization": "Bearer ${input:mindspeed-config-token}"
      }
    }
  }
}
```

然后按以下顺序操作：

1. VS Code 询问是否信任文件夹时，确认路径正确并选择信任；
2. 按 `Ctrl+Shift+P`，执行 `MCP: List Servers`；
3. 选择 `mindspeedConfig → Start Server`；
4. 弹出 Token 输入框后，只粘贴 Token 本身，不要添加 `Bearer `；
5. 再次进入 `MCP: List Servers`，确认 `mindspeedConfig` 已处于运行状态；
6. 打开该服务器的工具列表，确认其中能看到 `open_config_workbench`。

如果第 6 步看不到工具，先执行 `mindspeedConfig → Show Output` 排查，不要直接去 Chat 里反复发送提示词。

### 2.4 在当前 Agent 会话中启用工具并打开 UI

1. 在 VS Code 中新建一个 Chat 会话，并切换到 **Agent** 模式；
2. 打开聊天框旁的“配置工具/Configure Tools”；
3. 找到并勾选 `mindspeedConfig`，至少确认 `open_config_workbench` 已启用；
4. 在这个新会话中发送：

```text
请直接调用 mindspeedConfig 的 open_config_workbench 工具打开配置工作台，不要只给操作说明。
```

成功：Agent 产生一次 `open_config_workbench` 工具调用，MindSpeed 配置工作台以内嵌 MCP App 的形式
显示在 Chat 中。它不是一个自动弹出的独立编辑器标签页。

如果仍然反馈“当前环境中没有可用的 `open_config_workbench` 工具”：

1. 不要继续在这个旧会话里重试，先确认 `MCP: List Servers` 中服务器正在运行；
2. 确认“配置工具”中确实列出了并勾选了 `mindspeedConfig`；
3. 执行 `MCP: Reset Cached Tools`；
4. 执行 `MCP: List Servers → mindspeedConfig → Restart Server`；
5. 新建 Agent Chat 会话，再检查一次工具列表；
6. 如果新会话仍然只有“本地会话历史”等工具，切换到支持 Agent 工具调用的模型或 Chat 提供方后重试。

常见鉴权问题：

- `401 Unauthorized`：Token 错误或已轮换。把 `mcp.json` 中的输入 ID
  `mindspeed-config-token` 改成一个新 ID，例如 `mindspeed-config-token-v2`，保存并重启服务器，
  让 VS Code 重新询问 Token；
- 其他错误：执行 `MCP: List Servers → mindspeedConfig → Show Output`，把完整输出交给管理员。

## 3. 可选：试验一键启动

完成手动流程、确认 MCP 工具能够正常使用后，可以再试验：

```text
Start-MindSpeed-MCP.cmd
```

脚本会检查健康状态、生成专用客户端配置，并尝试在新的 VS Code 窗口里创建 Agent Chat。
已有 VS Code 窗口不会被替换。当前阶段如果脚本没有自动调用 `open_config_workbench`，
请继续按第 2.4 节手动启用和调用工具，不把它视为服务端故障。

脚本本身启动失败时，根据最后一条错误处理：

- `No SSH private key was found`：返回第 1 节创建密钥；
- `Cannot reach 42.192.111.92:22`：检查网络，或联系管理员检查腾讯云防火墙；
- `Local port 13000 is already used`：关闭占用本机 `13000` 端口的程序后重试；
- `health check did not succeed`：查看 SSH 隧道窗口中的错误。

## 4. 以后每次手动使用

1. 双击 `open-tunnel.cmd` 并保持隧道窗口开启；
2. 验证 `http://127.0.0.1:13000/health`；
3. 在新的 VS Code 窗口打开 `C:\Users\用户名\mindspeed-mcp-client`；
4. 执行 `MCP: List Servers → mindspeedConfig → Start Server`；
5. 新建 Agent Chat，在“配置工具”中启用 `mindspeedConfig`；
6. 调用 `open_config_workbench`。

Token 通常只需首次输入。结束体验时，关闭 SSH 隧道窗口。

## 5. 服务器升级后

地址、端口和 Token 不变时，仍按第 4 节手动启动，不需要重新安装或修改 `mcp.json`。

如果升级后工具没有刷新：

1. 执行 `MCP: Reset Cached Tools`；
2. 执行 `MCP: List Servers → mindspeedConfig → Restart Server`；
3. 新建 Chat 会话。

如果 Token、服务器地址或端口改变，以管理员的新通知为准。

## 安全要求

- 只分发整个 `remote-client` 文件夹，不分发任何私钥；
- Token 只输入 VS Code 的密码输入框，不写入脚本或聊天记录；
- 不要自行开放服务器的 `3002` 公网端口。
