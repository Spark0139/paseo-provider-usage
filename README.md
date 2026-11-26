# Paseo Provider Usage

在 Paseo 侧边栏打开 **Provider Usage**，即可查看 Codex、Claude 和 Antigravity 的剩余额度。每个窗口显示剩余百分比和设备当地的重置时间。悬停、键盘聚焦或轻点时间，可查看完整中文日期和时区。Codex 和 Claude 的读数也会出现在 Paseo 全局 Usage 中。

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

- **Codex**。在 **设置 → Codex → 添加 Keeper 实例** 填入名称和 Keeper 地址（如 `https://keeper.example.com/usage`）。开启登录的实例还需填写密码，密码保存在 daemon 上。点击 **测试连接** 后保存。账号优先显示 Keeper 中设置的别名，其次显示账号备注的首行。添加多个实例时可按实例查看启用数和额度。插件已验证 Keeper v2.1.2。[安装 CPA Usage Keeper](https://github.com/Willxup/cpa-usage-keeper/tree/v2.1.2)
- **更新 Codex 额度**。打开页面或点击 **重新读取** 查看缓存。要获取新读数，点击目标实例的 **更新额度**。Keeper 会接收该实例已启用账号的批量任务，处理后重新读取即可。
- **Claude**。在 daemon 上使用 Node.js 22.14 或更高版本，将采集启动器加到原有 Claude Code 或 ReClaude 命令前。在 **设置 → Claude** 编辑关联的 Provider ID，打开 **采集额度**。新会话收到额度事件后显示五小时、每周及该账号上报的 Fable 周额度。[启动命令示例](docs/claude-collection.md)
- **Antigravity**。先在 Paseo 中配置 Antigravity Provider，再在插件设置中打开 **显示额度**。使用代理时，沿用现有包装命令和环境，保留 `acp` 与 `--disable-telemetry` 参数。每个有单独额度的模型显示自己的读数，共用额度的模型组显示一份剩余比例和重置时间。只在模型目录中出现的型号列在「未单列额度」。[Paseo Antigravity 配置](https://paseo.sh/docs/supported-providers/antigravity)

## 卸载

如已配置 Claude 采集，先在 Provider 启动命令中移除加上的 Node 和采集脚本路径，保留原命令与参数，使已还原的配置生效。随后在 daemon 主机运行 `paseo plugin remove paseo-provider-usage`。插件自己的设置、Keeper 登录密码与额度快照保存在 `$PASEO_HOME/provider-usage/`（默认 `~/.paseo/provider-usage/`）。如需清除，卸载后删除该插件数据目录。

## 许可证

MIT。[许可证](LICENSE) · [第三方归属](THIRD_PARTY_NOTICES.md)
