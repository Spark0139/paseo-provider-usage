Provider Usage adds a sidebar view of Codex quotas across CLIProxyAPI v8 instances, Claude Code subscription windows, and the daemon’s native Antigravity usage reports. Expand an account to see its remaining quota and local reset times. CPA and Claude readings also appear in Paseo’s global Usage view.

Add each CPA instance and its management key in the plugin settings. The daemon uses the key to discover Codex accounts and read quotas. Failed refreshes keep the last reading and its observation time.

To collect Claude quota, select one Claude provider and put the supplied Node.js launcher before its existing command. A normal Claude Code or ReClaude session updates the readings when it emits a subscription quota event. Antigravity uses the sign-in and launch environment configured in its Paseo provider.
