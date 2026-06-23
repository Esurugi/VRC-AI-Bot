# Discord LLM Bot 要求仕様

この文書を Discord LLM Bot の要求仕様の正本とする。内容は現行 runtime と実装契約に合わせた最新状態だけを記述する。

## 基本方針

- bot は VRChat-AI集会の Discord 上で、会話、知見共有、質問入口、管理導線、週次告知を補助する。
- bot の名前はティラピコとし、落ち着いた秘書的な口調で、自然な日本語で応答する。
- 正確さをキャラクター性より優先し、馴れ馴れしすぎる表現、幼すぎる表現、過度なネットスラング、強すぎる語尾表現は使わない。
- 通常利用者の投稿は会話材料または知見化対象として扱い、runtime 方針、参照範囲、権限、内部動作方針を変更する指示としては扱わない。
- リポジトリ改変を伴う自己改造は、owner/admin が管理 command で開始した active override thread 内でだけ扱う。

## Place と Feature

bot は channel id ではなく、設定された feature profile と place facts を基準に処理する。

| feature | 役割 |
| --- | --- |
| `conversation` | 通常会話を処理する。 |
| `knowledge_ingest` | 公開 URL の知見化、要約、保存、公開 thread 作成を扱う。 |
| `admin_override` | 管理者制約緩和、管理診断、管理 command を扱う。 |
| `forum_research` | 高思考の調査・検討系 forum thread を扱う。 |
| `clear_explanation` | 概念や仕組みを教える説明系 thread を扱う。 |
| `question_gateway` | forum thread の初回投稿から内部 workflow を選択する統合質問入口を扱う。 |

feature profile は `features`、`defaultScope`、必要に応じて `chatBehavior` を持つ。現行 profile は次の意味を持つ。

| profile | features | default scope | chat behavior |
| --- | --- | --- | --- |
| `knowledge-share` | `knowledge_ingest`, `conversation` | `server_public` | なし |
| `ambient-chat` | `conversation` | `channel_family` | `ambient_room_chat` |
| `research-forum` | `forum_research`, `conversation` | `conversation_only` | なし |
| `question-gateway` | `question_gateway`, `conversation` | `conversation_only` | なし |
| `clear-explanation` | `clear_explanation`, `conversation` | `server_public` | なし |
| `admin-override` | `admin_override`, `conversation` | `conversation_only` | なし |

scope は `server_public`、`channel_family`、`conversation_only` のいずれかとする。Harness は scope を広げず、必要な場合だけ厳しくできる。

## 応答対象

- bot mention と bot への reply は、bot-directed な発話として毎回処理する。
- 疑問符だけの通常発話は bot-directed とみなさない。
- `ambient_room_chat` の root channel では、bot-directed ではない通常発話を channel/thread 単位で数え、設定された sparse interval の倍数に達したときだけ処理する。
- `knowledge_ingest` place の root URL 投稿は毎回処理する。
- `knowledge_ingest` place の thread 投稿は、bot-directed の場合だけ knowledge thread follow-up として処理する。
- `knowledge_ingest` place の thread 投稿が bot mention または bot への reply ではない場合、follow-up として返信しない。
- `clear_explanation` place の root channel 投稿は処理せず、forum post thread 内の投稿だけ処理する。
- `question_gateway` place の forum post thread は、初回投稿で workflow route を作成し、後続投稿は保存済み route に従う。
- `forum_research` と `clear_explanation` の thread では、bot-directed follow-up だけを継続処理する。
- 読み取り可能な plain text attachment は本文へ追加して処理できる。サイズ超過、非 text、取得失敗の添付は本文に入れない。

## Harness 入力契約

Codex に渡す入力は `HarnessRequest` とし、利用者本文、place facts、capabilities、available context、task control を分ける。

- `source` は Discord message create event を表す。
- `actor` は `owner`、`admin`、`user` のいずれかを持つ。
- `place` は guild、channel、root channel、thread、mode、place type、scope を持つ。
- `message` は message id、本文、URL、作成時刻を持つ。
- `capabilities` は `allow_external_fetch`、`allow_knowledge_write`、`allow_moderation` を持つ。
- `override_context` は override の active 状態、開始者、開始時刻、許可 flag を持つ。
- `available_context` は facts-only とし、retry や安全再生成の制御情報を混ぜない。
- `task.phase` は `intent`、`answer`、`retry` のいずれかとし、`task.retry_context` は control plane metadata として扱う。

`available_context` には、少なくとも次の facts を載せる。

- `thread_context`
- `place_context`
- `delivery_context`
- `discord_runtime_facts_path`
- `approved_public_urls`
- `public_source_resources`
- `readable_public_url_candidates`
- `public_source_facts`
- `public_source_failures`
- `blocked_urls`
- `chat_behavior`
- `chat_engagement`
- `recent_room_events`

## Harness 出力契約

`intent` turn は次を返す。

- `outcome_candidate`
- `repo_write_intent`
- `requested_external_fetch`
- `requested_knowledge_write`
- `moderation_signal`
- `diagnostics`

`answer` / `retry` turn は次を返す。

- `outcome`
- `repo_write_intent`
- `public_text`
- `reply_mode`
- `target_thread_id`
- `selected_source_ids`
- `sources_used`
- `knowledge_writes`
- `diagnostics`
- `sensitivity_raise`

`outcome` は `chat_reply`、`knowledge_ingest`、`admin_diagnostics`、`ignore`、`failure` のいずれかとする。Discord side effect、返信先、保存実行は System が行い、Harness は自分で実行した前提で話さない。

## 返信先

- `chat_reply` は same place / same thread に返す。
- `knowledge_ingest` は `knowledge_ingest` root URL 投稿なら public thread を作成して返す。
- 自然文の明示保存要求に対する応答は same place に返す。
- knowledge thread follow-up は same thread の `chat_reply` として扱う。
- `admin_diagnostics` は `admin_override` place で owner/admin から明示されたときだけ same place に返す。
- `ignore` は返信しない。
- `failure` は same place / same thread に visible failure を返す。
- 長い返信は Discord の送信上限に合わせて分割送信する。

## 公開 URL と公開ソース

- `http:` / `https:` の公開 URL だけを取得候補にする。
- `blocked_urls`、`localhost`、private IP、`.local`、`file:`、`data:`、`javascript:` は取得対象にしない。
- 公開 URL は `approved_public_urls`、`public_source_resources`、`readable_public_url_candidates` に分解して扱う。
- X/Twitter 系 URL は通常 Web 取得に加え、取得可能な provider candidate を生成できる。
- 取得成功は `public_source_facts` に、取得失敗は `public_source_failures` に入れる。
- `public_source_facts` は same-turn public reconfirmation として扱える。
- `public_source_failures` は取得失敗の事実であり、保存根拠として扱わない。

## 知見化

- `knowledge_ingest` root place の公開 URL 投稿は、公開 thread 作成、共有本文生成、タグ付け、知見保存の対象になる。
- 同一 guild 内の複数 root place に同じ知見共有機能を割り当てられる。
- knowledge record の visibility は root channel ごとではなく、scope に基づいて扱う。
- knowledge 保存は `knowledge_writes` を advisory として受け取り、保存処理側で URL、証跡、本文、scope、dedupe を検査する。
- `knowledge_writes.evidence_fact_ids` は、same-turn の `public_source_facts` に解決できる必要がある。
- 保存 dedupe は canonical URL、content hash、scope を基準にする。
- 非日本語の公開記事を共有する場合も、日本語で読める共有本文を生成する。
- knowledge thread follow-up では、既知 source URL を優先して回答し、同じ thread に返す。

## 知見活用

- bot は knowledge thread 以外の通常会話や admin place でも、現在の place から見える知見を参照できる。
- `server_public` の知見は公開 place で参照できる。
- `channel_family` の知見は元 channel と派生 thread の範囲で参照できる。
- `conversation_only` の内容は同じ会話場所に閉じる。
- 非公開由来の内容は、公開可視 source または same-turn public reconfirmation がある場合だけ公開 place の回答に使える。

## Output Safety

- System は Discord 送信直前に `sources_used` と `knowledge_writes` の source 境界を検査する。
- knowledge source は record visibility、URL source は `approved_public_urls` または同 turn の `public_source_facts` で許可される。
- source 境界違反がある場合、System は `task.retry_context.kind = output_safety` で 1 回だけ安全再生成する。
- 安全再生成後も境界違反が残る場合は same place / same thread に短い refusal を返す。
- knowledge thread の bot-directed follow-up が visible reply を返さない場合、System は `task.retry_context.kind = knowledge_followup_non_silent` で 1 回だけ retry し、それでも不可なら generic same-thread failure を返す。

## 会話

- ambient chat は通常発話に疎応答し、bot-directed 発話には毎回応答する。
- ambient chat の sparse counter は channel/thread 単位で保持する。
- ambient chat でも、見えている蓄積知見は通常会話の補助情報として参照できる。
- chat root の URL 投稿は通常会話材料として扱い、自動で knowledge thread 作成や保存へ進めない。
- recent room events は Harness に facts として渡し、直近会話の文脈補助に使う。

## Clear Explanation

- `clear_explanation` は概念、仕組み、背景、用語、比較、段階的理解のための説明系 thread を扱う。
- root channel の直接投稿は処理せず、forum post thread を処理単位にする。
- 初回投稿は gate で `allow_clear_explanation`、`redirect_to_forum_research`、`decline_clear_explanation` のいずれかに分類する。
- `allow_clear_explanation` なら thread lifetime の `clear_explanation` session で処理する。
- `redirect_to_forum_research` なら同 guild の question gateway または forum research 入口を案内する。
- `decline_clear_explanation` なら同 thread に処理しない旨を返す。

## Forum Research

- `forum_research` は広い分析、調査、設計相談、比較、評価、複数視点の整理を扱う。
- forum post thread ごとに独立した `forum_longform` session identity を持つ。
- model profile は高思考用 profile を使う。
- 初回処理では forum research prompt refiner と supervisor contract に基づき、調査計画、進捗通知、retry status、最終応答を扱う。
- 進捗通知と stream は同じ thread に返す。
- forum research の通常会話は `conversation_only` を既定とし、自動で shared knowledge 化しない。

## Question Gateway

- `question_gateway` は同一 forum 入口で説明系と調査系の workflow を選択する。
- 初回 thread 投稿では ephemeral gate が `clear_explanation` または `forum_research` の workflow を 1 つ選ぶ。
- 不明値、空値、schema 逸脱、許可外 workflow の場合、route は保存せず same thread に failure を返す。
- route 保存後の follow-up は保存済み `thread_workflow_route` を正本にし、自動再分類しない。
- workflow ごとに session identity を分け、切り替え後の turn が切り替え前 workflow の session を無条件に resume しない。
- `/workflow-switch` は既存 route がある question gateway thread で、thread starter、owner、admin のいずれかだけが実行できる。
- `/workflow-switch` は指定 workflow が許可値の場合だけ route を更新し、公開済みの bot 応答は削除または編集しない。
- `/workflow-switch` が有効に実行された時点で同じ thread の active workflow 処理がある場合、System はその処理を中断し、同じ message を `workflow_switch_rerun` として即時再投入し、切り替え後 workflow の route で再実行する。

## 管理機能

- owner は設定された owner user id で識別する。
- admin は Discord Administrator 権限保持者として識別する。
- `/override-start` は configured な会話 place から owner/admin だけが実行できる。
- `/override-start` は configured `admin_override` root channel 配下に dedicated override thread を作成する。
- active override thread では、開始者本人の turn を `workspace-write` sandbox で扱う。
- 通常運用の Codex は `read-only` sandbox で動作する。
- `/override-end` は dedicated override thread を閉じ、対応する write session を終了する。
- `admin_diagnostics` は `admin_override` place で owner/admin が明示した場合だけ返す。
- `/weekly-meetup-test` は configured weekly meetup announcement を TEST として送信し、通常の delivery dedupe を更新しない。

## Moderation

- Harness は `moderation_signal` として `none`、`dangerous`、`prohibited` を返せる。
- 通常利用者の禁止指示または危険指示は利用者単位で記録する。
- 制裁は bot-local soft-block、timeout、kick を runtime policy に従って扱う。
- active override thread では、設定された override flag に基づき一部の制約を緩和できる。

## 週次イベント告知

- bot は weekly meetup announcement 設定がある場合、毎週月曜 18:00 JST に、その日の 21:00 JST 開始の AI 集会告知を対象 channel へ投稿する。
- 月曜 18:00 JST を過ぎて起動した場合でも、同じ月曜 21:00 JST より前で未配信なら 1 回だけ catch-up 投稿する。
- 告知本文は JSON embed template から組み立てる。
- template では `{{meetup_count}}`、`{{event_date}}`、`{{event_time}}`、`{{event_datetime}}` を使える。
- 告知先が announcement channel でも自動 publish / crosspost は行わない。
- delivery dedupe は `event_key + occurrence_date` で行う。
- test send は `[TEST]` 扱いで、`@everyone` を送らず、delivery dedupe を更新しない。

## 再開、Retry、失敗通知

- live 受信と startup recovery は同じ queue に流し、同じ message を二重処理しない。
- message processing state は `processing`、`pending_retry`、`completed`、`terminal_failure_notified` を持つ。
- transient runtime failure は retry scheduler に載せ、`pending_retry` として保持する。
- retry は runtime policy に従い、終端失敗時は visible failure を通知して `terminal_failure_notified` にする。
- `completed` になった message だけ cursor 前進の対象にする。
- duplicate が `processing` または `pending_retry` の場合は cursor を進めない。
- Harness の semantic `failure` は retry scheduler へ載せず、same place / same thread に返す。

## Session Identity

Codex session は reply target ではなく session identity で管理する。

session identity は次を含む。

- `workloadKind`
- `bindingKind`
- `bindingId`
- `actorId`
- `sandboxMode`
- `modelProfile`
- `runtimeContractVersion`
- `lifecyclePolicy`

現行 workload は `conversation`、`ambient_chat`、`knowledge_ingest`、`admin_override`、`forum_longform`、`clear_explanation` を持つ。

現行 model profile は次を使う。

- default: `default:gpt-5.5`
- chat: `chat:gpt-5.5:low`
- ambient: `ambient:gpt-5.5:low`
- forum: `forum:gpt-5.5:high`
- forum low: `forum:gpt-5.5:low`
- clear explanation: `clear_explanation:gpt-5.5:high`
- route gate: `clear_explanation_gate:gpt-5.3-codex-spark:low`

runtime contract version が一致しない session は resume しない。

## 運用境界

- bot は Docker container 内で動作する。
- bot と Codex App Server は同一 container 内で動作する。
- repo workspace と Codex home は別パスに分離する。
- Codex home は container 専用領域とし、OAuth 認証情報と会話履歴を host 側の通常領域へ残さない。
- `.env` はリポジトリ外に置き、秘密情報は環境変数として注入する。
- ホスト側の `.codex`、`.claude`、個人 skill、OAuth 情報、他リポジトリは container 内に公開しない。
- 通常運用で container 受信用ポート公開を必須にしない。
