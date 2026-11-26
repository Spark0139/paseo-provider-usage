# 接入 Claude Code 或 ReClaude 额度

在 **Provider Usage → 设置 → Claude** 选择运行 Claude Code 的 Paseo 启动配置，并打开 **采集额度**。在目标 daemon 主机上执行 `paseo provider ls`，第一列 `PROVIDER` 就是 ID。比如，`agents.providers.claude` 的命令可以是 `reclaude`，对应的 ID 仍然是 `claude`。插件按一个启动配置记录额度。

如果你平时在 **Terminal** 中点击名为 **Claude Code** 的快捷方式，它会在终端运行交互式 CC。额度事件来自 Paseo 的 Agent SDK 会话。请在下面配置好 **Agent Provider**，然后从 **Chat** 打开它。

在运行会话的 daemon 主机上，用 `paseo plugin ls paseo-provider-usage` 查看插件安装目录。用 `command -v node` 和 `command -v reclaude` 查找可执行文件。编辑所选 Provider 的启动命令，在原命令前加上 **Node.js 22.14+ 的绝对路径**和**插件目录下的 `server/sources/claude-launch.cjs` 的绝对路径**。下面以 ID 为 `claude`、命令为 `reclaude` 为例。请替换示例中的三处路径，保留原有参数、环境和其他配置。

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": [
          "/absolute/path/to/node",
          "/absolute/path/to/paseo-provider-usage/server/sources/claude-launch.cjs",
          "/absolute/path/to/reclaude"
        ]
      }
    }
  }
}
```

应用 Provider 配置后，等当前回合结束，在使用该 Provider 的原 Chat 标签页菜单选择 **重新加载 Agent**。这会保留聊天历史，并用新配置重启会话。也可以用该 Provider 新建 Chat。使用 CLI 时，运行 `paseo agent reload <Agent ID>`，将占位符替换为 `paseo ls` 中该 Chat 的 Agent ID。

在 Chat 中正常发送消息。Claude Code 的 SDK 发出额度事件后，插件会显示读数及观测时间，可能需要多个回合。切换配置、重新开启采集或重新加载插件后，也需要重新加载对应的 Agent 或新建 Chat。

回到 **设置 → Claude → 检查接入** 查看进度。如果显示「会话已匹配，尚未收到启动器连接」，请核对所选 Provider 的启动命令和脚本路径。如果显示「启动器已连接，等待额度事件」，接入已生效，在这个 Chat 继续使用即可。

通过 Git 仓库地址安装时，Paseo 会为更新后的版本分配新的源码目录。更新插件后用 `paseo plugin ls paseo-provider-usage` 核对 `DIRECTORY`，将 Provider 中的采集脚本路径指向当前版本。

采集器从该进程的 SDK 输出中提取五小时、每周和 Fable 周额度，通过私有本地套接字交给 daemon。每个窗口在 SDK 上报后显示。卸载时移除启动命令最前面加上的两项即可恢复原命令。
