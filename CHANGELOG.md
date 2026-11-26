# Changelog

## 0.1.0

- Added CPA Usage Keeper integration for multiple instances, with Codex account discovery, enabled counts, per-account cached quota windows and their original observation times.
- Added an explicit per-instance action to queue a batch quota update in Keeper. Opening the panel, reading it again or opening Paseo Usage reads cached Keeper values.
- Added passive Claude Code quota collection for a selected provider, including ReClaude launch commands.
- Added a compact quota overview with per-window remaining percentages, Chinese reset times in the device time zone and exact dates on hover, focus or tap. The panel shows every reported Antigravity model-group window and the Fable weekly allowance when Claude reports it. Keeper and Claude quotas are registered with Paseo global Usage.
- Added settings for Keeper URLs and optional daemon-held login passwords, connection testing, Claude collection and display preferences.
