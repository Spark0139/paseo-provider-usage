# Run the demo locally

From a source checkout, install the development dependencies with `npm ci`. Use Node 22.14 or later and Paseo CLI 0.17.4 on macOS or Linux. For the browser demo, use a Paseo distribution that includes the bundled web client.

```sh
node scripts/mock-daemon.mjs
node scripts/mock-daemon.mjs --ui
```

The first command starts a temporary loopback daemon, installs the production entry with empty settings and then loads a separate demo installation. It checks the settings actions, quota data, native Usage reports and plugin reload. The second command also serves the Paseo web client with a local synthetic agent. Open the printed composer link and click a quota pill, or select **Provider Usage** in the sidebar. On first launch you can skip Paseo onboarding.

The **工作账号** account in **Personal Keeper** opens with its quota rows visible. Two of its three accounts are enabled. Choose **工作账号** in Codex settings to see 82% remaining on the composer pill, or **备用账号** to see its exhausted five-hour window (0%). **Second Keeper** shows a cached collection failure. Claude shows 77% remaining for five hours, 39% for the week and 63% for Fable. The Antigravity card has two quota groups, Gemini and Claude / GPT. Each has a five-hour window and a weekly window. All three product cards show horizontal bars and local reset times inline.

Open the overview or Codex popover to read Keeper’s cache. Click **更新额度** on Personal Keeper once to submit its two enabled accounts in a batch. The mock Keeper accepts one task and reports the other as already pending. The plugin follows both, shows the partial failure and displays the updated five-hour quota for **工作账号** (74% remaining).

Open **设置** to edit a demo instance. **测试连接** on Personal Keeper reports three discovered Codex accounts. Use `https://personal.keeper.invalid` with the demo password `synthetic-demo-password`, or `https://second.keeper.invalid` with a blank password. Both instances use local fixtures.

The demo creates a fresh daemon home, provider home and settings directory for each run. Press Ctrl+C in the terminal to close the UI demo and remove its temporary state. When a check fails, the command prints the path of its diagnostic log.
