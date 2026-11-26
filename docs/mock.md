# Run the demo locally

From a source checkout, install the development dependencies with `npm ci`. Use Node 22.14 or later and Paseo CLI 0.17.4 on macOS or Linux. For the browser demo, use a Paseo distribution that includes the bundled web client.

```sh
node scripts/mock-daemon.mjs
node scripts/mock-daemon.mjs --ui
```

The first command starts a temporary loopback daemon, installs the production entry with empty settings and then loads a separate demo installation. It checks the settings actions, quota data, native Usage reports and plugin reload. The second command also serves the Paseo web client. Open the printed local address and select **Provider Usage** in the sidebar. On first launch you can skip Paseo onboarding.

Expand **Personal CPA** to see two enabled accounts out of three. The enabled Plus account has an exhausted five-hour window. **Second CPA** shows a synthetic upstream rejection. Claude shows 77% and 39% remaining. Antigravity shows illustrative native data.

Open **设置** in the usage screen to edit a demo instance. **测试连接** on Personal CPA reports three discovered Codex accounts. For this demo, the URLs are `https://personal.cpa.invalid` and `https://second.cpa.invalid`. The test key is `synthetic-demo-key`. All CPA requests use local fixture responses.

The demo creates a fresh daemon home, provider home and settings directory for each run. Press Ctrl+C in the terminal to close the UI demo and remove its temporary state. When a check fails, the command prints the path of its diagnostic log.
