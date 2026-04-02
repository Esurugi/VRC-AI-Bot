# Security Policy

This repository is prepared for public publication. Do not commit runtime secrets,
local operational data, or internal prompt and working materials.

## Keep Private

- `.env` and any environment-specific variants
- Local databases such as `*.sqlite` and `*.db`
- Discord server-specific runtime config in `config/watch-locations.json`,
  `config/chat-runtime-controls.json`, and
  `config/weekly-meetup-announcement.json`
- Private agent assets under `.agents/`
- Internal prompt material in
  `implementation/src/runtime/forum/forum-research-prompt-refiner-contract.md`
- Internal working documents under `docs/` and `implementation/docs/`
- Temporary and trace artifacts under `.tmp/`

## Public Templates

- `.env.example`
- `config/watch-locations.example.json`
- `config/chat-runtime-controls.example.json`
- `config/weekly-meetup-announcement.example.json`
- `config/weekly-meetup-embed.template.json`

## Before Publishing

1. Confirm `git status --ignored` does not show secrets staged for commit.
2. Confirm tracked private files have been removed from the Git index.
3. Rotate any secret that may already have been committed before publication.

## Reporting

If you discover a security issue in the published repository, report it privately
to the repository owner instead of opening a public issue with exploit details.
