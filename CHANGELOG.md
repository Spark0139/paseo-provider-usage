# Changelog

## 0.1.0

- Added CPA Usage Keeper integration for multiple instances, with Codex account discovery, enabled counts, per-account cached quota windows and their original observation times.
- Added an explicit per-instance action to queue a batch quota update in Keeper. Opening the panel, reading it again or opening Paseo Usage reads cached Keeper values.
- Added passive Claude Code quota collection for a selected provider, including ReClaude launch commands.
- Grouped the overview into Codex, Claude and Antigravity cards with product icons. Codex uses Keeper aliases or account notes and groups accounts by instance when more than one is configured.
- Added model details to Antigravity quotas and distinguished individually reported windows from shared allowances. Claude includes the Fable weekly window when reported.
- Displayed remaining percentages and Chinese reset times in the device time zone, with exact dates on hover, focus or tap. Registered Keeper and Claude quotas with Paseo global Usage.
- Added settings for Keeper URLs and optional daemon-held login passwords, connection testing, Claude collection and display preferences.
