# Run the demo locally

From a source checkout, install the development dependencies with `npm ci`. Use Node 22.14 or later and Paseo CLI 0.17.4 on macOS or Linux. For the browser demo, use a Paseo distribution that includes the bundled web client.

```sh
node scripts/mock-daemon.mjs
node scripts/mock-daemon.mjs --ui
```

The first command starts a temporary loopback daemon, installs the production entry with empty settings and then loads a separate demo installation. It checks the settings actions, quota data, native Usage reports and plugin reload. The second command also serves the Paseo web client. Open the printed local address and select **Provider Usage** in the sidebar. On first launch you can skip Paseo onboarding.

The **工作账号** account in **Personal Keeper** opens with its quota rows visible. Two of its three accounts are enabled. The enabled Plus account **备用账号** has an exhausted five-hour window. **Second Keeper** shows a cached collection failure. Claude shows 77% remaining for five hours, 39% for the week and 63% for Fable. Antigravity shows six windows. Gemini Pro and Gemini Flash each have their own readings in this fixture. Claude Sonnet and GPT-OSS use a shared group, and the catalog also includes a model with no separate reading. Hover, focus or tap a reset time to see the full local date and UTC offset.

Click **重新读取** to read the cached values. Click **更新额度** on Personal Keeper to submit two enabled accounts in one batch. The mock Keeper accepts one task and reports one already pending. The fixed observation timestamps and quotas stay available for repeatable checks.

Open **设置** to edit a demo instance. **测试连接** on Personal Keeper reports three discovered Codex accounts. Use `https://personal.keeper.invalid` with the demo password `synthetic-demo-password`, or `https://second.keeper.invalid` with a blank password. Both instances use local fixtures.

The demo creates a fresh daemon home, provider home and settings directory for each run. Press Ctrl+C in the terminal to close the UI demo and remove its temporary state. When a check fails, the command prints the path of its diagnostic log.
