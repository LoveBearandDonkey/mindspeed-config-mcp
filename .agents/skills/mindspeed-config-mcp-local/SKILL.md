---
name: mindspeed-config-mcp-local
description: "This skill should be used when the user asks to start, launch, preview, open, refresh, restart, stop, or inspect the local MindSpeed Config MCP service, its standalone page preview, or its browser-based MCP Inspector, including Chinese requests such as ‘拉起服务’, ‘预览页面’, ‘刷新服务’, ‘打开配置工作台’, ‘服务状态’ or ‘停止本地服务’."
---

# MindSpeed Config MCP 本地服务

把本地 MCP、MCP Inspector、独立预览页面和中文配置工作台作为一个整体管理。用户不需要
手工生成 Token、占用多个终端或寻找带临时令牌的浏览器链接。

## 意图映射

| 用户表达 | 动作 |
| --- | --- |
| 拉起服务、启动服务、打开工作台 | `Start` |
| 预览页面、打开页面预览、只看界面 | `Preview` |
| 刷新服务、重启服务、更新后看效果 | `Refresh` |
| 查看状态、服务正常吗 | `Status` |
| 停止服务、关闭本地服务 | `Stop` |

## 执行

使用本 Skill 的 `scripts/manage-local.ps1`。脚本默认从 Skill 所在位置自动识别
`mindspeed-config-mcp` 项目根目录；若用户设置了 `MINDSPEED_CONFIG_MCP_ROOT`，优先使用
该值。不要修改 `compute-graph-viewer-wzh`。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill目录>\scripts\manage-local.ps1 -Action Start
```

将 `Start` 替换为 `Preview`、`Refresh`、`Status` 或 `Stop`。每次 `Start` 或
`Refresh` 都会先停止该 Skill 上一次记录的进程，再执行以下步骤：

1. 构建最新 MCP App；
2. 在回环地址上后台启动 Streamable HTTP MCP；
3. 后台启动官方 MCP Inspector；
4. 自动选择未占用端口，不终止无法确认归属的进程；
5. 生成临时 Token，并打开已经自动连接到 `open_config_workbench` 的浏览器页面。

`Preview` 同样会先停止上一次记录的进程，先生成带时间戳的生产单文件，再用 Vite Preview 在固定地址
`http://127.0.0.1:4174/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html?preview=1`
启动并打开改造版页面。该固定 URL 由预览服务映射到当次带时间戳的真实 HTML，与 MCP Resource 读取的内容相同；
它不启动 MCP Server 或 Inspector，不能用于验收 MCP 协议通信。原始基线页面单独使用 4173 端口。
若 4174 被非本 Skill 管理的进程占用，应明确报错，不要结束未知进程。

脚本运行后应核对退出码和摘要。失败时读取摘要给出的日志路径，不要让用户重新手工走完整
验收文档。若用户只要求查看状态，不要隐式重启服务。

## 边界

- 只用于本机开发，服务仅监听 `127.0.0.1`；不代替服务器部署。
- `Start`、`Preview`、`Refresh` 和 `Stop` 只结束该脚本状态文件记录且启动时间一致的进程，
  不按端口盲目杀进程。
- Token 只在本次本地进程中使用，不写入 Git 或项目配置。
- 打开浏览器是 `Start`、`Preview`、`Refresh` 的预期动作；用户说“不打开浏览器”时追加
  `-NoBrowser`。
- 最终只需告诉用户动作是否完成、MCP/Inspector 地址和如何再次触发本 Skill；不要回显完整 Token。
