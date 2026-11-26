# Paseo Provider Usage

在已有会话的输入框旁点击 **Codex**、**Claude** 或 **Antigravity** 额度入口，即可就地查看详情。侧边栏的 **Provider Usage** 汇总这台主机的所有读数。每个窗口显示剩余百分比和设备当地的重置时间。悬停、键盘聚焦或轻点时间，可查看完整中文日期和时区。Codex 和 Claude 的读数也会出现在 Paseo 全局 Usage 中。

![Paseo 中的 Codex、Claude 和 Antigravity 额度卡片，使用演示数据](docs/images/usage-overview.png)

## 安装

需要 Paseo 0.17.4 或更高版本。在客户端为目标主机启用插件，打开 **设置 → 插件 → … → 从来源安装**，粘贴 `https://github.com/Spark0139/paseo-provider-usage.git`。也可以在运行 Agent 的 daemon 主机上使用 CLI 安装。

```sh
paseo plugin install github:Spark0139/paseo-provider-usage
```

安装后，在侧边栏打开 **Provider Usage → 设置** 配置数据源。通过仓库地址安装的插件可用 `paseo plugin update paseo-provider-usage` 更新。

## 接入数据源

- **Codex**。在 **设置 → Codex → 添加 Keeper 实例** 填入名称和 Keeper 地址（如 `https://keeper.example.com/usage`）。开启登录的实例还需填写密码，密码保存在 daemon 上。点击 **测试连接** 后保存。账号优先显示 Keeper 中设置的别名，其次显示账号备注的首行。添加多个实例时可按实例查看启用数和额度。插件已验证 Keeper v2.1.2。[安装 CPA Usage Keeper](https://github.com/Willxup/cpa-usage-keeper/tree/v2.1.2)
- **更新 Codex 额度**。活跃账号的普通请求带回额度时，Keeper 会更新缓存。打开额度总览或 Codex 浮卡时，插件每分钟同步最新读数。要立即查询，点击该实例的 **更新额度** 一次，完成后会自动显示结果。需要定期主动查询时，可在 Keeper 的 **巡检 → 齿轮 → 定时刷新** 设置周期。
- **Claude**。在 **设置 → Claude** 选择平时用于聊天的启动配置，打开 **采集额度**。在 daemon 上把 Node.js 22.14+ 和采集脚本加到原有 Claude Code 或 ReClaude 命令前。应用后新开一次 Chat 并正常发消息，**检查接入** 会显示启动器和额度事件的状态。[ReClaude 配置示例](docs/claude-collection.md)
- **Antigravity**。先在 Paseo 中配置 Antigravity Provider，再在插件设置中打开 **显示额度**。使用代理时，沿用现有包装命令和环境，保留 `acp` 与 `--disable-telemetry` 参数。卡片按 Paseo 返回的额度组显示各自的剩余比例与重置时间，例如 Gemini 的五小时和每周窗口。[Paseo Antigravity 配置](https://paseo.sh/docs/supported-providers/antigravity)

## 卸载

如已配置 Claude 采集，先在 Provider 启动命令中移除加上的 Node 和采集脚本路径，保留原命令与参数，使已还原的配置生效。随后在 daemon 主机运行 `paseo plugin remove paseo-provider-usage`。插件自己的设置、Keeper 登录密码与额度快照保存在 `$PASEO_HOME/provider-usage/`（默认 `~/.paseo/provider-usage/`）。如需清除，卸载后删除该插件数据目录。

## 许可证

MIT。[许可证](LICENSE) · [第三方归属](THIRD_PARTY_NOTICES.md)
