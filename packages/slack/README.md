# Slack

Full Slack integration for Drift with channels, messages, and threads.

## Features

- Browse and search channels, DMs, and group conversations
- Send messages, reply in threads, and add reactions
- Edit and delete your own messages
- Mark conversations as read
- Search across all messages
- List workspace members

## Authentication

Connect via OAuth (recommended) or paste a Slack bot token in Settings.

**Required OAuth scopes:** `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `users:read`, `reactions:write`, `search:read`

## Entity Types

- **slack_channel** — Channels, DMs, and group conversations
- **slack_message** — Individual messages with thread support
