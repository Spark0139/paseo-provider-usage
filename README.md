# Paseo Provider Usage

在 Paseo 侧边栏打开 **Provider Usage**，即可查看各个 CLIProxyAPI 实例的 Codex 账号额度、Claude Code 订阅窗口以及 Antigravity 的原生额度报告。展开实例和账号可查看剩余比例、最近有效观测时间以及按设备时区显示的重置时间。CPA 和 Claude 读数也会出现在 Paseo 全局 Usage 中。

## 安装

需要 Paseo 0.17.4 或更高版本。在运行 Agent 的 daemon 主机上，使用有权访问此仓库的 Git 身份，选择一个用于保存插件源码的持久目录。在客户端的 **Settings → Plugins** 为该主机启用插件，然后运行以下命令。

```sh
git clone https://github.com/Spark0139/paseo-provider-usage.git
cd paseo-provider-usage
paseo plugin install "$PWD"
paseo plugin ls paseo-provider-usage
```

状态为 `running` 后，在连接该主机的客户端打开侧边栏的 **Provider Usage → 设置**。请保留这份源码目录，daemon 会从这里加载插件。更新源码后，运行 `paseo plugin reload paseo-provider-usage` 加载新版本。

## 接入数据源

- **CLIProxyAPI v8**。在 **CPA 实例 → 添加实例** 填入名称、服务根地址（如 `https://cpa.example.com`）和该实例的管理密钥，点击 **测试连接** 后保存。密钥存储在 daemon 上。插件自动发现 Codex OAuth 账号，按实例列出启用数、总数以及每个账号的独立额度窗口。读取失败时，已有读数会连同上次观测时间和错误提示一起显示。
- **Claude Code / ReClaude**。在 daemon 上准备 Node.js 22.14 或更高版本，将采集启动器加到原 Claude Provider 的启动命令前，在插件设置中填写对应的 Provider ID 并打开 **被动采集 SDK 额度**。新会话在正常使用中收到额度事件后，五小时和每周窗口会显示实际读数。具体命令见[配置示例](docs/claude-collection.md)。
- **Antigravity**。在 Paseo 中配置好 Antigravity Provider 后，可在插件设置中打开或关闭 **显示 Antigravity 原生额度**。使用独立代理时，把现有包装命令和环境保留在 Provider 配置中，启动参数保留 `acp` 和 `--disable-telemetry`。开启显示后，Paseo 0.17.4 按主机读取原生额度，可能同时更新其他原生来源或复用五分钟缓存，侧栏仅展示其中的 Antigravity 报告。[Paseo Antigravity 配置](https://paseo.sh/docs/supported-providers/antigravity)

## 卸载

如已配置 Claude 采集，先在 Provider 启动命令中移除加上的 Node 和采集脚本路径，保留原命令与参数，使已还原的配置生效。随后在 daemon 主机运行 `paseo plugin remove paseo-provider-usage`。插件自己的设置、管理密钥与额度快照保存在 `$PASEO_HOME/provider-usage/`（默认 `~/.paseo/provider-usage/`）。如需清除，卸载后删除该插件数据目录。

## 许可证

MIT。[许可证](LICENSE) · [第三方归属](THIRD_PARTY_NOTICES.md)
