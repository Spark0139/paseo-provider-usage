# Observe Claude Code quota

Enable **Claude collection** in Provider Usage and enter the exact ID of the Claude provider whose login you want to track. One provider and one login supply the shared global quota.

On the daemon, find this plugin's installation directory with `paseo plugin ls paseo-provider-usage`. In that Claude provider's Paseo configuration, put the absolute Node.js executable and the plugin's launcher before your existing command. Preserve all existing launcher arguments and provider environment settings. For example, an existing `reclaude` provider could use this command array.

```json
{
  "agents": {
    "providers": {
      "reclaude": {
        "extends": "claude",
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

Apply the provider configuration on your daemon and open a new session with that provider. The next normal turn that emits subscription utilization updates the last observation time and quota windows. A session can run for a while before Claude sends a new reading. Reopen the session after changing providers, toggling collection, or reloading the plugin.

The launcher observes normal SDK stdout and sends the five-hour and weekly measurements to a private local socket. The daemon stores the latest quota snapshot. A refresh displays the last known observation without starting Claude. Removing the two prepended arguments restores the original provider command.
