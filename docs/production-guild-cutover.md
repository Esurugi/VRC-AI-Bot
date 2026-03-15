# 本番Guild切替メモ

- guild: `VRChat-AI集会` (`1365199027322486856`)
- `url_watch`: `知見共有` (`1365210270661869618`)
- `chat`: `雑談-総合` (`1365210184657670207`)
- `forum_longform`: `なんでも質問` (`1365209960396361738`)
- `forum_longform`: `ai-tech質問` (`1365210135324135497`)
- `admin_control`: `moderator-only` (`1365201887095427166`)
- `weekly_meetup_announcement`: `イベント情報` (`1365203546919927880`)

運用確認:
- 同一Bot application を本番Guildへ招待済みであること。
- Discord Developer Portal 側で、現行コードが要求する privileged intents が有効であること。
- `/weekly-meetup-test` は `moderator-only` で実行すること。
- `/override-start` は `chat` または `forum_longform` の post thread から開始し、作成先 thread は `moderator-only` 配下に集約されることを確認する。

補足:
- `url_watch` は本番Guildの `知見共有` を採用した。
- 本番切替では新規DBを使い、試験用Guildの cursor / retry / scheduled delivery を引き継がない。
