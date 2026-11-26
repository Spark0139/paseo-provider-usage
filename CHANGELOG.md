# Changelog

## Unreleased

- Claude quota collection now attaches automatically when the selected Claude Code or ReClaude provider starts a Chat on Paseo 0.17.5 or later. Upgrading from manual launcher setup requires restoring the original provider command once.
- Claude capture diagnostics report launch wrapper conflicts and collector startup failures.
- The visible Claude composer pill and popover update from the daemon's last captured reading.

## 0.1.0

- Added CPA Usage Keeper integration for multiple instances, with Codex account discovery, enabled counts, per-account cached quota windows and their original observation times.
- Added a per-instance Keeper update that follows queued account tasks and displays the result automatically. The visible Codex composer pill, popover and overview reread Keeper’s existing cache every minute.
- Added passive Claude Code quota collection for a selected provider, including ReClaude launch commands.
- Added a Claude provider picker and capture diagnostics that distinguish opening a matching chat, connecting the launcher and receiving a quota event.
- Grouped the overview into Codex, Claude and Antigravity cards with product icons. Codex uses Keeper aliases or account notes and groups accounts by instance when more than one is configured.
- Adapted the Usage Monitor Codex card grid, quota rows and horizontal meters for all three products. Antigravity displays the host’s quota pools and reset periods. Claude includes the Fable weekly window when reported.
- Added composer pills for configured products in existing conversations. Choose a Keeper account to show its remaining Codex quota directly beside the composer. Tap a product for its quota windows and observation time.
- Displayed remaining percentages and inline Chinese reset times in the device time zone. Registered Keeper and Claude quotas with Paseo global Usage.
- Added settings for Keeper URLs and optional daemon-held login passwords, connection testing, Claude collection and display preferences.
