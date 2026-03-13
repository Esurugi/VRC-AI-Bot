# Discord LLM Bot 実装タスク表

更新日: 2026-03-09  
元仕様: `docs/discord-llm-bot-spec.md`, `docs/discord-llm-bot-requirements.md`  
目的: 独立した LLM セッションがこの文書だけ読んで、設計順を崩さずに実装できる粒度へ分解する。

> 注記: 2026-03-10 以降の再設計は [docs/discord-llm-bot-spec-v2.md](/D:/project/VRC-AI-Bot/docs/discord-llm-bot-spec-v2.md) を優先する。この文書は v1 系の分解として残す。

## この文書の使い方

- 先に「固定前提」と「推奨モジュール境界」を読み、その後にタスク一覧を上から実行する。
- 依存が満たされていないタスクには着手しない。特に `intent`、`control_request_class`、scope、Codex thread 対応は後工程の土台なので先に固定する。
- 各タスクは「このタスクでやること」と「このタスクでやらないこと」を明記している。後工程の責務を先食いしない。
- 既存コードが将来追加されていても、ここに書いた責務境界は維持する。ファイル名だけは実情に合わせてよい。

## 固定前提

### v1 の対象

- Discord の通常投稿を主入口にする。一般利用者向け slash command は持たないが、管理者限定の override/application command は持てる。
- 対象場所は `GUILD_TEXT`、`GUILD_ANNOUNCEMENT`、bot が作成した知見 thread、雑談チャンネル、管理者制御チャンネル。
- 管理者限定 command は guild 内でのみ扱い、configured `admin_control` channel またはその thread でだけ有効とする。
- v1 では Forum、Media、child thread、DM、voice/stage は対象外。
- URL 取得の必須基盤は `@playwright/cli` を `npx playwright-cli` で呼ぶ方式だけに限定する。
- bot は Docker コンテナ内で動作し、Codex App Server に stdio 接続する。
- bot と Codex CLI/App Server は同一コンテナ内で動作する。
- コンテナ内の repo workspace と Codex home は別パスに分離する。
- `CODEX_HOME` は container-private な保存領域を指し、OAuth 認証情報と履歴はそこにだけ保持する。
- repo 内 `.env` は runtime 前提にせず、必要な secret は Docker 外部の env file から環境変数として注入する。
- ホスト側の `~/.codex`、`~/.claude`、個人用 skill は bind mount しない。
- 通常運用でコンテナ受信用ポート公開は行わない。

### 技術スタック

- Node.js 24 LTS
- pnpm 10
- TypeScript 5.9.x
- discord.js 14.25.1
- SQLite + FTS5
- Codex App Server
- GPT-5.4
- Node built-in test runner

### role の固定ルール

- `owner`: `owner_user_ids` に含まれる利用者
- `admin`: owner 以外で Discord の `Administrator` 権限保持者
- `user`: それ以外
- role 判定に失敗した場合は安全側で `user`

### scope の固定ルール

- `server_public`: サーバー内の誰でも見える公開知見
- `channel_family`: 元チャンネルと、その元チャンネルから派生した thread 群だけ
- `conversation_only`: その会話場所だけ
- 既定値:
- 公開知見共有チャンネルは `server_public`
- 制限付き通常チャンネルは `channel_family`
- private thread と管理者制御 thread は `conversation_only`
- LLM は `sensitivity_raise` により scope を厳しくする提案だけできる。広げる提案は不採用。

### sanction と override の固定ルール

- 危険指示 5 回 / 30 日で 24h timeout を試行する。
- timeout に失敗したら 24h bot-local soft-block に切り替える。
- timeout または soft-block 後、90 日以内に再発したら kick を試行する。
- kick に失敗したら 30 日 soft-block に切り替える。
- soft-block 中は bot 要求を実行しない。最初の blocked message だけ簡潔に通知し、同一チャンネルでは 12 時間以内に通知を繰り返さない。
- override の開始/終了は管理者限定の guild application command でのみ受理する。
- override 開始 command は管理者制御 root channel で、owner/admin から来たときだけ有効とする。
- override 開始時は dedicated override thread を開き、終了 command はその thread 内でだけ受理する。
- override は dedicated override thread からの明示終了 command が来るまで継続する。
- 通常の Codex sandbox は `read-only` とし、active override thread では開始者本人の turn 全体を `workspace-write` で扱う。
- bot 停止、再起動、container 再作成後も active override と対応する Codex thread を dedicated override thread 単位で再利用できるようにする。ただし session identity の version/generation が変わった旧 thread は resume しない。
- override 中でも公開漏えいと知見共有範囲の拡大は禁止。

### system が固定するもの

- 入口制約、role 判定、scope 判定、sanction、override、Codex sandbox policy、Playwright allowlist、保存形式、retry 方針、出力検証

### LLM に任せるもの

- `intent` 判定
- `control_request_class` 判定
- 要約、タグ、visible knowledge の検索語
- 既存知見だけで足りるか、外部取得が必要かの判断
- 応答文の本文
- 無害な一回限りの軽い表現調整
- repo-local skill/script を使った DB read と追加 Discord facts 取得

### LLM 出力契約

`SEC.01-04` を実装するには、仕様書の JSON 断片に `sources_used` が必要になる。実装では次を正とする。

```json
{
  "intent": "ignore | ingest | thread_answer | chat | mixed | admin_control",
  "control_request_class": "none | harmless_style | policy_change | scope_expand | secret_exfiltration | tool_change | admin_override",
  "public_reply": "string | null",
  "selected_source_ids": ["src_..."],
  "sources_used": ["src_..."],
  "external_fetch_requests": [
    {
      "url": "https://...",
      "reason": "why needed",
      "private_terms_included": false
    }
  ],
  "knowledge_writes": [
    {
      "canonical_url": "https://...",
      "title": "string",
      "summary": "string",
      "tags": ["tag1", "tag2"],
      "content_hash": "sha256:..."
    }
  ],
  "sensitivity_raise": "none | channel_family | conversation_only",
  "response_place_action": "same_place | create_public_thread | no_reply",
  "retry_plan": {
    "kind": "none | retry",
    "reason_category": "timeout | temporary_ai_failure | rate_limit | public_page_unavailable | permission_denied | scope_violation | permanent_failure"
  }
}
```

補足:

- `selected_source_ids` は第 2 段階で本文を読みたい候補。
- `sources_used` は最終応答の根拠に実際に使った source。
- 保存時の最終 scope は `min(current_place_scope, sensitivity_raise)` 相当の厳格側で決める。

## 推奨モジュール境界

以下の境界を前提にタスクを割り当てる。ファイル名は変更可だが、責務は混ぜない。

- `src/config`: env 読み込み、owner ID、watch location 設定、起動時 validation
- `src/domain`: enum、型、schema、共通契約
- `src/storage`: SQLite migration、repository、FTS5
- `src/discord`: event intake、message filter、thread/channel 操作、moderation
- `src/queue`: catch-up/live 統合キュー、dedupe、worker
- `src/policy`: role/scope 判定、soft-block 判定、input packet 構築、出力ガード
- `src/codex`: thread start/resume、turn 実行、output schema 検証、compaction
- `src/playwright`: URL 正規化、公開 URL 判定、allowlist 実行、artifact 収集
- `src/knowledge`: ingest、retrieval、source hydration、dedupe、source_link
- `src/retry`: retry scheduler、再試行状態、失敗通知
- `src/override`: 管理者 override、終了 command、監査ログ、cleanup
- `test`: unit / integration / regression

## 設計順の原則

1. 固定契約を先に作る。分岐の心臓部である `intent`、`control_request_class`、role、scope を先に確定する。
2. 永続化を先に作る。cursor、Codex thread 対応、knowledge dedupe、sanction はすべて DB 前提。
3. adapter を先に作る。Discord/Codex/Playwright の境界がないと feature を実装しても再利用できない。
4. feature は URL ingest を先に通す。thread Q&A や chat は knowledge と Codex session の上に乗る。
5. 安全境界は feature の後付けにしない。少なくとも output guard は Q&A 完成前に入れる。
6. reliability は最後にまとめるが、retry 契約だけは途中から前提にする。

## タスク一覧

| 順番 | Task ID | フェーズ | 依存 | 主目的 | 主な仕様 ID |
|---|---|---|---|---|---|
| 1 | T00 | 契約固定 | なし | プロジェクト骨格、共通 enum、出力契約を固定する | BOT.01-04, BOT.01-05 |
| 2 | T01 | 永続化 | T00 | SQLite schema と repository を作る | RUN.01-01, MEM.01, AUTH.02, AUTH.03 |
| 3 | T02 | 設定 | T00, T01 | env と watch location の起動設定を固定する | BOT.01-02, CHAT.01-01, AUTH.03-01 |
| 4 | T03 | 入口基盤 | T00, T01, T02 | message filter、catch-up、ordered queue、cursor を実装する | BOT.01-01, RUN.01 |
| 5 | T04 | Policy | T00, T01, T02, T03 | role/scope 判定と block-structured input を実装する | SEC.01, AUTH.01 |
| 6 | T05 | Codex 基盤 | T00, T03, T04 | Codex App Server adapter と schema validation を実装する | BOT.01-04, BOT.01-05 |
| 7 | T06 | Playwright 基盤 | T00 | 公開 URL 判定、allowlist shell、artifact 収集を実装する | ING.01-01, ING.01-04 |
| 8 | T07 | URL知見化 | T01, T03, T05, T06 | public thread 作成、要約、タグ、保存、dedupe を実装する | ING.01, THR.01-01, THR.01-02, MEM.01-03 |
| 9 | T08 | Retrieval | T01, T04, T07 | 2 段階 retrieval と source hydration を実装する | MEM.01-02, MEM.01-05 |
| 10 | T09 | Knowledge-Assisted Conversation | T05, T07, T08 | 全 place での知見参照会話と明示保存依頼を実装する | THR.01-03, THR.01-05, ING.01-02 |
| 11 | T10 | Chat | T05, T07 | chat channel 応答と URL 混在時の ingest 優先分岐を実装する | CHAT.01 |
| 12 | T11 | 出力安全境界 | T04, T08, T09, T10 | scope guard、再生成、公開再確認ルールを実装する | SEC.01-03, SEC.01-05 |
| 13 | T12 | 制裁 | T01, T03, T04 | violation counter、timeout、kick、soft-block を実装する | AUTH.02 |
| 14 | T13 | Override | T01, T03, T04, T05, T06, T12 | 管理者限定 command、override、終了 command、監査ログ、cleanup を実装する | AUTH.03 |
| 15 | T14 | 失敗処理 | T03, T05, T07, T09, T12, T13 | 失敗カテゴリ、通知先、retry scheduler を実装する | ERR.01 |
| 16 | T15 | 仕上げ | T05, T09, T10, T11, T14 | compaction、統合テスト、運用文書を仕上げる | CHAT.01-04, 全体回帰 |

## タスク詳細

### T00: プロジェクト骨格と共通契約

- 対象要求 ID: `BOT.01-04`, `BOT.01-05`, `AUTH.01-02`, `SEC.01-02`
- 目的: すべての実装が依存する enum、型、schema、ディレクトリ骨格、最小実行コマンドを固定する。
- 入力契約:
- Node 24 / pnpm 10 / TypeScript 5.9 を前提にする。
- LLM 出力契約はこの文書の JSON を正とする。
- 出力契約:
- 開発者が `pnpm install`, `pnpm typecheck`, `pnpm test` を叩ける最小骨格
- `intent`, `control_request_class`, role, scope, retry reason, override flag の enum
- LLM output schema validator
- 実装内容:
- `package.json`, `tsconfig`, テスト実行基盤、`src` と `test` の骨格を作る。
- 共通型と schema を `src/domain` に集約する。
- `sources_used` を含む output schema を固定し、JSON schema または型安全な validator を用意する。
- 変更境界:
- このタスクは契約固定だけを行う。Discord 実装、DB 実装、外部接続は作り込まない。
- 完了条件:
- 共通型を import して各タスクが実装を開始できる。
- schema validator が正常入力と逸脱入力を判定できる。
- 非対象:
- 実際の Discord 接続
- 実 DB への保存

### T01: SQLite schema と repository

- 対象要求 ID: `RUN.01-01`, `MEM.01-01`, `MEM.01-03`, `AUTH.02-01`, `AUTH.03-05`
- 目的: 永続化の基盤を作り、再起動後継続、知見保存、制裁、override を支える。
- 入力契約:
- エンティティは `watch_location`, `channel_cursor`, `codex_session`, `knowledge_record`, `knowledge_artifact`, `source_link`, `violation_event`, `sanction_state`, `override_session`
- 出力契約:
- migration
- repository API
- FTS5 index
- 実装内容:
- 各エンティティの create/select/update を持つ repository を作る。
- `knowledge_record` の dedupe 条件は `canonical_url + content_hash + scope` 同一時に artifact 再保存なしとする。
- `canonical_url` が同じでも `content_hash` または `scope` が変われば新 record。
- FTS5 の検索対象は `canonical_url`, `domain`, `title`, `summary`, `tags`。
- 変更境界:
- SQL と repository に責務を限定する。Queue や Discord API を直接呼ばない。
- 完了条件:
- migration 一発で初期 DB が作れる。
- repository 単体テストで dedupe、FTS、sanction/override 保存が通る。
- 非対象:
- queue 処理
- LLM 呼び出し

### T02: 起動設定と watch location bootstrap

- 対象要求 ID: `BOT.01-02`, `CHAT.01-01`, `AUTH.03-01`
- 目的: bot がどこを監視し、どの channel/thread がどの mode かを起動時に安全に確定できるようにする。
- 入力契約:
- 必須 env: Discord token、application/client ID、owner user IDs、Codex App Server 接続情報、DB path
- watch location は mode ごとに `url_watch`, `chat`, `admin_control`
- 出力契約:
- 起動時 validation
- `watch_location` seed または config loader
- mode と default scope を引ける API
- 実装内容:
- 設定ファイルまたは env から watch location を読み、DB に反映する。
- `chat` と `admin_control` は明示設定された場所だけ有効。
- 無効な channel ID や mode の重複を起動時に検出する。
- 変更境界:
- 実際の message 処理はしない。設定確定まで。
- 完了条件:
- 起動時に監視対象一覧が確定し、以後の処理が DB/API 経由で参照できる。
- 非対象:
- live event 受信

### T03: Discord 入口、catch-up、ordered queue、cursor

- 対象要求 ID: `BOT.01-01`, `RUN.01-01`, `RUN.01-02`, `RUN.01-03`
- 目的: live と履歴を一つの直列キューへ統合し、二重処理を防ぐ。
- 入力契約:
- 対象メッセージは human 送信、bot 可視、本文または URL を持つもの
- bot 投稿、Webhook、system 通知、本文も URL もない投稿は無視
- 初回起動では過去全件を処理せず、最新メッセージを cursor に記録して開始
- 出力契約:
- live/historical 共通の queue item
- message id 昇順の単一 worker
- 重複排除つき queue
- 実装内容:
- Discord event intake と履歴取得を作る。
- `last_processed_message_id` より後ろだけを catch-up 対象にする。
- catch-up 中は worker 1 本で先頭から処理し、live 投稿は backlog の後ろへ積む。
- 同一 `message_id` は queue へ 1 回しか入れない。
- cursor は「処理完了」または「permanent failure 通知完了」の時点で更新し、transient retry 予定のものでは進めない。
- 変更境界:
- queue は「仕事を順序通り渡す」まで。LLM や Playwright の詳細は知らない。
- 完了条件:
- 初回起動、再起動、履歴 + live 重複、停止中 3 件 + 起動後 2 件のテストが通る。
- 非対象:
- message の意味解釈

### T04: role/scope 判定と block-structured input

- 対象要求 ID: `SEC.01-01`, `SEC.01-02`, `AUTH.01-01`, `AUTH.01-04`, `BOT.01-04`
- 目的: system 側が固定する安全境界をコード化し、LLM へ渡す入力ブロックを作る。
- 入力契約:
- block は `system_policy`, `message_context`, `visible_candidates`, `current_task`
- 利用者本文は必ず `message_context.user_message` にだけ入れる
- 出力契約:
- role resolver
- place -> scope resolver
- input packet builder
- soft-block / override 状態の参照 API
- 実装内容:
- owner/admin/user 判定を実装する。
- channel/thread 種別と watch location から default scope を決める。
- current place の scope で visible candidates を事前 filter する入口を作る。
- 一般利用者の本文から policy や allowlist を変更しない仕組みを固定する。
- 変更境界:
- 実 LLM 呼び出しはしない。packet 生成まで。
- 完了条件:
- role 判定 4 ケースと代表 3 種 scope で unit test が通る。
- 利用者本文が policy block に混ざらないことを確認できる。
- 非対象:
- Codex 接続

### T05: Codex App Server adapter、session policy、output schema validation

- 対象要求 ID: `BOT.01-04`, `BOT.01-05`, `THR.01-03`, `CHAT.01-02`
- 目的: Discord の reply target と分離した `session identity` で Codex thread を管理し、start/resume/turn を安全に実行する。
- 入力契約:
- `SessionPolicyResolver` が `workload_kind + binding_kind + binding_id + actor_id + sandbox_mode + model_profile + runtime_contract_version + lifecycle_policy` を返す
- URL ingest root、thread follow-up、通常会話、override thread は place ではなく session policy で分岐する
- 通常 turn の Codex sandbox は `read-only`
- active override session の自己改造 turn だけ `workspace-write` を選べる
- 出力契約:
- `thread/start`
- `thread/resume`
- `turn`
- `compaction`
- place ごとの sandbox selector
- schema validation と reject path
- 実装内容:
- `codex_session_binding` repository を使って `session_identity -> codex_thread_id` を保存する。
- `runtime_contract_version` が一致する binding だけ resume し、不一致なら新規 session を開始する。
- `skills/changed` 通知を reusable session invalidation signal として扱い、同一 process 中でも stale binding を使い回さない。
- override thread の close 時は対応する `workspace-write` Codex thread を archive し、必要なら unsubscribe する。
- knowledge ingest で public thread を作成した場合は、作成後の thread conversation identity を同じ Codex thread へ bind する。
- start/resume/turn では session identity から sandbox policy を決定し、global config の常設変更に依存しない。
- `turn` の返り値を T00 の validator で検証し、不正なら安全失敗へ落とす。
- compaction は後工程で使えるよう API だけ作ってよい。
- 変更境界:
- Playwright 実行や Discord 返信までは持たない。Codex 接続責務に限定。
- 完了条件:
- 新規 identity、既存 identity、skills/changed invalidation、schema 逸脱の 4 ケースをテストできる。
- 非対象:
- knowledge 保存

### T06: 公開 URL 判定と Playwright allowlist shell

- 対象要求 ID: `ING.01-01`, `ING.01-02`, `ING.01-03`, `ING.01-04`, `AUTH.03-02`
- 目的: URL 取得の安全境界を system 側で固定する。
- 入力契約:
- 通常許可: `open`, `goto`, `snapshot`, `eval`, `network`, `screenshot`, `reload`, `close`
- 通常禁止: `run-code`, `state-load`, `state-save`, `cookie-set`, `localstorage-set`, `sessionstorage-set`, `upload`, `route`, persistent/headed
- override 時のみ headed/persistent 可
- 対象 URL は `http` / `https` の公開 Web ページだけ
- 出力契約:
- URL validator
- canonicalizer
- allowlist command runner
- artifact metadata
- 実装内容:
- `localhost`、private address、`mailto`、`file:` を拒否する。
- `canonical_url` は `final_url` から fragment を除いたものを基本とし、query は保持する。
- 通常時は isolated/headless 相当で実行し、profile を残さない。
- artifact として snapshot path、必要時 screenshot/network log path を返せるようにする。
- 変更境界:
- このタスクは「安全に URL を読む」まで。要約生成はしない。
- 完了条件:
- 対象 URL と対象外 URL、通常時と override 時で動作が分かれる。
- 非対象:
- Discord thread 作成

### T07: URL ingest、public thread 作成、知見保存

- 対象要求 ID: `ING.01-05`, `ING.01-06`, `ING.01-07`, `THR.01-01`, `THR.01-02`, `MEM.01-03`, `MEM.01-04`
- 目的: URL を見つけたメッセージから知見 thread を 1 本作り、要約とタグを保存する。
- 入力契約:
- 元メッセージに公開 URL が 1 つ以上ある場合、元メッセージから public thread を 1 本だけ作る。
- 同一メッセージ内に URL が複数あっても thread は 1 本。
- 知見 thread 内の追加 URL は同じ thread へ追加ソースとして取り込む。
- 要約は `何のページか / 重要点 / 後から役立つ見方 / 不明点または注意点`
- タグは 3〜8 個、短語、重複なし、ドメインだけのタグは 1 個まで
- 出力契約:
- source message -> reply thread 対応
- knowledge record 保存
- source_link 保存
- 元 thread への応答本文
- 実装内容:
- URL 抽出、public thread 作成、Playwright artifact 取得、Codex で要約とタグ生成、DB 保存を直列で結ぶ。
- `canonical_url + content_hash + scope` 同一なら artifact 再保存を避け、source_link だけ追加する。
- 短文ページでは「情報が少ない」を要約へ明示する。
- 変更境界:
- thread Q&A の質問応答はまだ持たない。初回 ingest まで。
- 完了条件:
- 1 URL / 3 URL / 既存知見 thread 追加 URL / 重複 URL のケースで期待通り保存される。
- 非対象:
- 2 段階 retrieval

### T08: 2 段階 retrieval と source hydration

- 対象要求 ID: `MEM.01-01`, `MEM.01-02`, `MEM.01-05`, `SEC.01-03`
- 目的: scope を守りつつ、最初は軽い候補だけを LLM に見せる。
- 入力契約:
- 第 1 段階では最大 30 件
- 第 1 段階で渡すのは `title`, `summary`, `tags`, `scope`, `recency`, `canonical_url` などの軽量情報だけ
- 第 2 段階では `selected_source_ids` に入った source だけ本文 snapshot や抜粋を読む
- 出力契約:
- candidate selector
- source hydration API
- scope-filtered search
- 実装内容:
- FTS5 を使って metadata 検索を行う。
- current place の scope で filter してから候補を LLM へ渡す。
- 第 2 段階で必要な snapshot / screenshot / network log を取得できるようにする。
- 変更境界:
- 最終応答文はまだ作らない。検索と本文供給まで。
- 完了条件:
- URL、題名、要約語、タグで検索できる。
- 範囲外 source が候補に出ない。
- 非対象:
- 公開再確認ルール

### T09: Knowledge-Assisted Conversation

- 対象要求 ID: `THR.01-03`, `THR.01-04`, `THR.01-05`, `ING.01-02`
- 目的: knowledge thread に限らず、通常 chat、knowledge thread、admin_control の全 place で visible knowledge を使って会話できるようにする。あわせて自然文の明示保存依頼を扱う。
- 入力契約:
- knowledge thread は thread ごとに Codex thread を 1 本持ち、初回要約と以後の質問で同じ thread を resume
- 通常 chat と admin_control は place ごとに Codex thread を継続する
- thread 内の bot/system 発話は質問候補にしない
- 短い指示語だけなら直近 3〜5 発話を補助文脈へ含める
- 既存知見で足りるなら外部取得しない
- 不足時だけ `external_fetch_requests` を返す
- 明示的な知見保存依頼では、貼り付け URL がなくても公開情報を取得して `knowledge_ingest` を返せる
- 自然文保存の persistence scope は同一 guild の `server_public` に固定する
- 出力契約:
- same place / same thread reply 本文
- `selected_source_ids`
- `sources_used`
- 必要時のみ `external_fetch_requests`
- 必要時のみ `knowledge_writes`
- 実装内容:
- T08 の retrieval storage を背後に持ちつつ、query wording は Harness が決め、repo-local skill/script で current place から見える visible sources を引く。
- knowledge thread では thread lineage と `known_source_urls` を優先ヒントとして使うが、guild 内の可視知見も併用できるようにする。
- 通常 chat や admin_control でも、関連する visible knowledge があれば same place reply に混ぜる。
- LLM が追加取得を要求した場合のみ T06 を通して公開ページを取得し、同一 turn または再投入で回答を補強する。
- 明示保存依頼では、URL がなくても外部公開情報を調べ、same place へ応答しつつ `server_public` へ保存する。
- System は save intent や retrieval query を TypeScript heuristic で先決めしない。DB read は skill/script の read-only route、DB write は `knowledge_writes` handoff 経由に限定する。
- 返信構成は `結論 -> 根拠 -> source 一覧`。
- 無用な mention は送らない。
- 変更境界:
- chat root の URL 自動知見化は持たない。保存は明示依頼時だけ。
- 完了条件:
- 通常 chat、knowledge thread、admin_control の各 place で visible knowledge を使った回答が通る。
- 通常質問、指示語だけ、bot 発話、system 発話、追加外部取得あり/なしのケースが通る。
- URL なしの自然文保存依頼で same place reply と `server_public` 保存が通る。
- 非対象:
- soft-block や sanction

### T10: chat channel 応答

- 対象要求 ID: `CHAT.01-01`, `CHAT.01-02`, `CHAT.01-03`
- 目的: 雑談チャンネルでだけ inline 会話を継続し、URL が混在しても自動知見化へは切り替えない。
- 入力契約:
- plain message への雑談応答は chat channel のみ
- `workload=conversation + binding_kind=place` の session identity ごとに Codex thread 1 本
- 公開 URL を含んでも chat root では知見 thread を自動作成しない
- 出力契約:
- inline chat reply
- `workload=conversation + binding_kind=place` の session 継続
- 実装内容:
- chat mode の message を T05 へ流し、URL があっても inline 応答または ignore に留める。
- visible knowledge の参照自体は T09 に委ね、T10 は chat の UX と reply style に責務を絞る。
- persona は「親しみやすいが落ち着いた秘書」を守る。
- 変更境界:
- compaction は次タスクへ回す。ここでは通常会話継続まで。
- 完了条件:
- chat channel 内外の同じ plain message で片方だけ応答する。
- 雑談 / URL / URL+質問 の 3 ケースで、いずれも chat として自然に扱える。
- 非対象:
- 長会話 compaction

### T11: scope guard、再生成、公開再確認

- 対象要求 ID: `SEC.01-03`, `SEC.01-04`, `SEC.01-05`, `AUTH.01-05`
- 目的: 範囲外 source の混入や private 由来情報の公開漏えいを防ぐ。
- 入力契約:
- turn は `intent -> answer -> optional retry` の 2 段階基本フローとし、System は `intent` で意味解釈を追加しない
- `available_context` は facts-only に保ち、retry 制御情報は `task.retry_context` に載せる
- Harness は `intent` で `requested_external_fetch` / `requested_knowledge_write` を宣言し、System は factual gate を通った `answer` turn にだけ capability を付与する
- System は意味解釈を行わず、source 境界だけを検査する
- 最終応答では `sources_used` を authoritative input として検査する
- knowledge source は record visibility、URL source は `fetchable_public_urls` または同 turn の公開再確認に一致するものだけを許可する
- 同 turn の公開再確認は repo-local skill `public-source-fetch` の構造化出力だけを authoritative evidence とする
- private 由来の事実を公開場所へ出せるのは、同じ事実が `server_public` source にあるか、同 turn の公開 Web で独立再確認できた場合だけ
- 出力契約:
- output guard
- 1 回だけの安全再生成
- fallback refusal
- reply target は変えない
- 実装内容:
- `intent` turn では `allow_external_fetch=false`, `allow_knowledge_write=false` を基本にして Harness の要求を受ける。
- `CapabilityResolver` で `message_urls`, `known_thread_sources`, `public_research`, `knowledge_write` を事実境界だけで grant し、`answer` turn に反映する。
- `sources_used` に範囲外 source があれば Discord 投稿前に reject する。
- source 境界違反時は `task.retry_context.kind = output_safety` で 1 回だけ安全再生成し、それでも直らなければ「この場所では扱えない」と返す。
- knowledge thread の non-empty follow-up が visible reply を返さない場合は `task.retry_context.kind = knowledge_followup_non_silent` で 1 回だけ retry し、それでも不可なら generic same-thread failure を返す。
- 一般利用者の要求で上位機密参照や browser mode 拡大を行わない。
- 変更境界:
- moderation 実行は持たない。出力安全に限定。
- 完了条件:
- 範囲外 source 混入、private only の事実、public 再確認可能な事実の 3 系列で挙動が分かれる。
- 非対象:
- timeout / kick

### T12: violation counter、timeout、kick、soft-block

- 対象要求 ID: `AUTH.02-01`, `AUTH.02-02`, `AUTH.02-03`, `AUTH.02-04`, `AUTH.02-05`
- 目的: 危険指示の累積を利用者単位で記録し、Discord 制裁または soft-block を適用する。
- 入力契約:
- `guild_id + user_id` 単位で violation を集計
- owner/admin は sanction 対象外だが監査ログは残す
- timeout 失敗時は 24h soft-block
- kick 失敗時は 30 日 soft-block
- soft-block 中の通知は 12 時間抑制
- 出力契約:
- violation recorder
- sanction evaluator
- moderation executor
- soft-block checker
- 実装内容:
- `control_request_class` から危険カテゴリを記録する。
- Discord の `MODERATE_MEMBERS`、`KICK_MEMBERS`、role hierarchy の失敗を拾って fallback する。
- 管理者制御チャンネルへの通知フックを用意する。
- 変更境界:
- override 自体の発行は持たない。制裁だけ。
- 完了条件:
- 5 回到達時 timeout 試行、権限不足時 soft-block、90 日再発時 kick 試行、通知抑制が通る。
- 非対象:
- override の明示終了

### T13: 管理者限定 command、override thread、終了 command、監査ログ

- 対象要求 ID: `AUTH.03-01`, `AUTH.03-02`, `AUTH.03-03`, `AUTH.03-04`, `AUTH.03-05`
- 目的: 管理者限定 application command を入口に、override thread 限定の一時緩和と versioned session identity を安全に扱う。
- 入力契約:
- 入口は guild の管理者限定 application command
- 開始 command は管理者制御 root channel のみ、終了 command は bot が開いた dedicated override thread のみ
- 許可 flag は `allow_playwright_headed`, `allow_playwright_persistent`, `allow_prompt_injection_test`, `suspend_violation_counter_for_current_thread`, `allow_external_fetch_in_private_context_without_private_terms`
- override は dedicated override thread からの明示終了 command が来るまで active
- 通常 sandbox は `read-only`、active override thread では開始者本人の turn 全体を `workspace-write`
- active override thread の開始者本人には Harness capability のうち `allow_external_fetch`, `allow_knowledge_write`, `allow_moderation` を true で渡す
- override 中でも公開漏えい禁止
- 出力契約:
- command registration/update
- dedicated override thread create/archive
- interaction permission check
- override session 管理
- sandbox mode selector
- explicit end command handler
- audit log
- 実装内容:
- 管理者限定 application command を登録し、Discord 側の default permissions と runtime の role 再判定を二重で適用する。
- owner/admin の command だけを制御命令として受理する。
- 開始 command では configured `admin_control` root channel 配下に dedicated override thread を作り、その thread ID を override scope とする。
- override を dedicated override thread 単位に限定し、bot 全体へ波及させない。
- active override thread では開始者本人の turn を常に Codex `workspace-write` sandbox に載せ、同時に Harness capability のうち `allow_external_fetch`, `allow_knowledge_write`, `allow_moderation` を true にする。Discord thread 作成は system 側の reply-routing で扱い、通常場所と非該当 actor の turn は `read-only` に保つ。
- 明示終了 command で active override を閉じ、対応する Codex write thread を archive し、Discord thread も archive する。
- bot 再起動後も dedicated override thread と Codex write thread の対応を維持し、session identity の version が一致する場合だけ同じ thread では resume を使う。
- 終了時に headed/persistent session を閉じ、`who / when / scope / flags / started_at / ended_at` を記録する。
- 変更境界:
- moderation のしきい値計算は持たない。
- 完了条件:
- 制御チャンネル root の管理者限定 command だけが override thread を開始でき、終了 command はその thread 内でだけ実行できる。
- 通常 message からは repo 書込み可能な sandbox へ切り替わらない。
- 終了 command 実行後に thread と write session の両方が閉じ、再起動後も未終了 thread は再利用できる。
- 非対象:
- 一般利用者の chat 応答

### T14: 失敗カテゴリ、通知先、retry scheduler

- 対象要求 ID: `ERR.01-01`, `ERR.01-02`, `ERR.01-03`, `ERR.01-04`
- 目的: 失敗を内部詳細と利用者通知へ分離し、transient failure だけ自動再試行する。
- 入力契約:
- Harness の `outcome = failure` は semantic な終端結果として same place / same thread に返し、retry scheduler へ載せない。
- 利用者向け失敗カテゴリは `公開ページではない`, `取得がタイムアウトした`, `権限不足で読めない`, `AI処理に失敗した`, `この場所では扱えない`, `再試行上限に達した`
- retry 対象は transient failure のみ
- retry 間隔は 5 分後、30 分後、2 時間後の最大 3 回
- 403/404/非公開ページ/範囲違反は permanent failure
- thread 作成前の失敗は元メッセージの場所へ、作成後は同じ thread へ通知
- moderation/override 失敗の詳細は管理者制御チャンネルへ通知
- 出力契約:
- failure classifier
- retry scheduler
- `message_processing.state = processing | pending_retry | completed`
- user notification builder
- admin notification builder
- 実装内容:
- raw error と利用者向けカテゴリを分離する。
- retry 予定のジョブは DB-backed scheduler 管理へ回し、`message_processing` を `pending_retry` にして cursor を進めない。
- 利用者向けには stack trace を出さない。
- 変更境界:
- feature 本体は持たない。失敗後の後始末だけ。
- 完了条件:
- transient/permanent、thread 作成前後、moderation/override 失敗の通知先が分かれる。
- 非対象:
- compaction

### T15: compaction、統合テスト、運用文書

- 対象要求 ID: `CHAT.01-04` と全体回帰
- 目的: 長会話継続性と、ここまでの仕様が壊れていないことを確認する。
- 入力契約:
- chat Codex thread が肥大化したら compaction を実行する
- compaction 後も thread 自体は切り替えない
- 出力契約:
- compaction trigger
- end-to-end regression test
- operator README
- 実装内容:
- chat 長会話の compaction 条件を設ける。
- 代表シナリオの統合テストを作る。
- 起動方法、必要権限、watch location 設定、override の使い方、既知の非対象を文書化する。
- 変更境界:
- 新機能追加はしない。運用仕上げだけ。
- 完了条件:
- 長会話後も文脈継続が崩れない。
- URL ingest、knowledge-assisted conversation、chat、scope guard、sanction、override、retry の回帰テストが揃う。
- 非対象:
- v2 機能追加

## 並列化の指針

- `T05` と `T06` は `T03` と `T04` の境界が固まれば並列化できる。
- `T09` と `T10` は `T07` 完了後に並列化できる。
- `T12` と `T13` は `T04` と `T01` が終わっていれば並列化できる。
- `T14` と `T15` は最後にまとめてもよいが、失敗通知と統合テストはできるだけ早く差し込む。

## 見落としやすい罠

- scope filter だけで安心し、投稿直前の `sources_used` 検証を省く。
- catch-up と live の競合で同じ message を二重処理する。
- URL ごとに thread を作ってしまい、「元メッセージにつき public thread 1 本」を破る。
- override を bot 全体に効かせてしまい、place 限定にしない。
- override を明示終了できず、管理者が sandbox 状態を閉じられないままにする。
- `workspace-write` を global `config.toml` に常設してしまい、通常 turn まで書込み可能にする。
- moderation の role hierarchy 失敗を拾わず soft-block fallback を欠く。
- persistent/headed セッションの cleanup と audit log を忘れる。
- retrieval で最初から本文全部を LLM に渡し、2 段階 retrieval を崩す。

## 実装開始の推奨単位

- 最初の 1 セッションで `T00` と `T01` を終える。
- 次の 1 セッションで `T02` と `T03` を終える。
- その後は `T04` から `T06` を adapter/境界ごとに分割する。
- end-to-end で最初に通すべき縦切りは `T07 -> T08 -> T09`。`T09` では thread 限定ではなく、全 place の知見参照会話を最初に通す。



