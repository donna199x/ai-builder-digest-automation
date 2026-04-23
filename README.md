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

The workflow runs at `01:00 UTC`, which is `09:00 Asia/Shanghai`.

You can also run it manually from GitHub Actions with `workflow_dispatch`.

## Notion Permissions

Share your `draft` database with your Notion integration, otherwise the script cannot create pages.
