# AI Builder Digest Automation

Runs a daily cloud automation that:

1. Fetches `follow-builders` public feeds from GitHub.
2. Generates a concise Chinese + English digest with GitHub Models.
3. Creates or updates today's page in your Notion `draft` database.

This is designed for GitHub Actions, so it can run even when your computer is off.

## Required GitHub Secrets

Add these in your GitHub repo:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`

For your current draft database, use this as `NOTION_DATABASE_ID`:

```text
33b9ade00ff480a1a83ffe1aedcee90a
```

## Optional GitHub Variable

- `GITHUB_MODEL`, default: `openai/gpt-4.1-mini,openai/gpt-4.1`

## Schedule

There are now two cloud layers:

1. `Daily AI Builders Digest`
   - Primary daily run at `09:17 Asia/Shanghai`
   - Backup daily run at `09:47 Asia/Shanghai`

2. `Digest Watchdog`
   - Hourly backfill checks from `09:11` through `23:11 Asia/Shanghai`
   - If today's page already exists, it exits without changing anything
   - If today's page is missing, it creates it

You can also run either workflow manually from GitHub Actions with `workflow_dispatch`.

## Notion Permissions

Share your `draft` database with your Notion integration, otherwise the script cannot create pages.
