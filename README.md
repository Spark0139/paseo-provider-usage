# Paseo Provider Usage

在 Paseo 侧边栏打开 **Provider Usage**，即可查看各个 CPA Usage Keeper 实例缓存的 Codex 账号额度、Claude Code 订阅窗口以及 Antigravity 的原生额度报告。展开实例和账号可查看剩余比例、最近额度观测时间以及按设备时区显示的重置时间。Keeper 和 Claude 读数也会出现在 Paseo 全局 Usage 中。

## 安装

需要 Paseo 0.17.4 或更高版本。在运行 Agent 的 daemon 主机上，使用有权访问此仓库的 Git 身份，选择一个用于保存插件源码的持久目录。在客户端的 **Settings → Plugins** 为该主机启用插件，然后运行以下命令。

```sh
git clone https://github.com/Spark0139/paseo-provider-usage.git
cd paseo-provider-usage
paseo plugin install "$PWD"
paseo plugin ls paseo-provider-usage
```

状态为 `running` 后，在连接该主机的客户端打开侧边栏的 **Provider Usage → 设置**。请保留这份源码目录，daemon 会从这里加载插件。更新源码后，运行 `paseo plugin reload paseo-provider-usage` 加载新版本。

从早期直连 CPA 的开发版升级时，请重新添加 Keeper 实例及其登录密码。升级会沿用 Claude 采集设置、Claude 快照和显示选项。旧 CPA 地址、密钥和额度保留在原数据文件中。

## 接入数据源

- **CPA Usage Keeper**。在 **CPA Usage Keeper 实例 → 添加实例** 填入实例名称和 Keeper 服务地址（如 `https://keeper.example.com`，含反向代理前缀时请保留该路径）。开启登录的实例还需填写 Keeper 登录密码，免登录实例可留空。点击 **测试连接** 查看发现的 Codex 账号数，再保存。密码保存在 daemon 上。插件已验证 Keeper v2.1.2。[安装 CPA Usage Keeper](https://github.com/Willxup/cpa-usage-keeper/tree/v2.1.2)
- **读取和更新 Keeper 额度**。打开面板或点击 **重新读取** 可查看 Keeper 缓存。每个账号的最近观测时间来自 Keeper。需要采集新读数时，在目标实例点击 **更新 Keeper 额度**，一次提交该实例启用的 Codex 账号。Keeper 接受任务后，稍后点击 **重新读取** 查看结果。
- **Claude Code / ReClaude**。在 daemon 上准备 Node.js 22.14 或更高版本，将采集启动器加到原 Claude Provider 的启动命令前，在插件设置中填写对应的 Provider ID 并打开 **被动采集 SDK 额度**。新会话在正常使用中收到额度事件后，五小时和每周窗口会显示实际读数。具体命令见[配置示例](docs/claude-collection.md)。
- **Antigravity**。在 Paseo 中配置好 Antigravity Provider 后，可在插件设置中打开或关闭 **显示 Antigravity 原生额度**。使用独立代理时，把现有包装命令和环境保留在 Provider 配置中，启动参数保留 `acp` 和 `--disable-telemetry`。开启显示后，Paseo 0.17.4 按主机读取原生额度，可能同时更新其他原生来源或复用五分钟缓存，侧栏仅展示其中的 Antigravity 报告。[Paseo Antigravity 配置](https://paseo.sh/docs/supported-providers/antigravity)

## 卸载

如已配置 Claude 采集，先在 Provider 启动命令中移除加上的 Node 和采集脚本路径，保留原命令与参数，使已还原的配置生效。随后在 daemon 主机运行 `paseo plugin remove paseo-provider-usage`。插件自己的设置、Keeper 登录密码与额度快照保存在 `$PASEO_HOME/provider-usage/`（默认 `~/.paseo/provider-usage/`）。如需清除，卸载后删除该插件数据目录。

## 许可证

MIT。[许可证](LICENSE) · [第三方归属](THIRD_PARTY_NOTICES.md)
