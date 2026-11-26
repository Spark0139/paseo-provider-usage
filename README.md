# Paseo Provider Usage

在 Paseo 中统一查看 CLIProxyAPI、Claude Code 和 Antigravity 的订阅剩余额度。

## 功能

- **CLIProxyAPI**：多实例、启用账号统计、逐账号额度和重置时间。
- **Claude Code**：在正常 Agent 使用期间被动采集 SDK 额度事件，支持通过 ReClaude 启动的原生 CC。
- **Antigravity**：复用 Paseo 原生额度源，沿用 Provider 的代理和登录环境。
- **统一界面**：侧边栏、图形化配置、原生 Usage 集成、本地时区显示。

## 使用方式

插件安装在运行 Agent 的 Paseo Daemon 上，连接该 Daemon 的桌面、移动及 Web 客户端共用界面与配置。

当前处于 v0.1.0 开发准备阶段。安装命令和界面截图将在首个可用版本完成后补充。

## 开发

使用 TypeScript 和 Paseo 插件 SDK。开发测试使用 [Mock 数据](fixtures/)。

## License

MIT · [LICENSE](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
