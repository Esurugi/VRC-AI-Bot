# Discord LLM Bot 仕様差分 v0.4

## 仕様テーブル

### 【全体利用】

| ID | 要求文 |
|---|---|
| BOT.01-04 | bot は、LLM が利用者本文、運用制約、会話場所の事実、内部知見への参照経路を混同しないよう、入力情報を出自別に区別して渡す。 |
| 理由 | 利用者本文を system 制約や返信先決定に関わる事実と混同させず、誤った場所への返信や権限逸脱を防ぐため。 |
| 範囲 | `implementation/src/harness/contracts.ts`, `implementation/src/harness/build-harness-request.ts`, `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md` |
| BOT.01-04-01 | system は Codex への入力を `HarnessRequest` 1 つに統一し、`source`, `actor`, `place`, `message`, `capabilities`, `available_context`, `task` を分けて渡す。 |
| BOT.01-04-02 | 利用者本文は `message.content` と `message.urls` にのみ載せる。`place`, `capabilities`, `available_context`, `task` は system facts として扱う。 |
| BOT.01-04-03 | `place` には `guild_id`, `channel_id`, `root_channel_id`, `thread_id`, `mode`, `place_type`, `scope` を載せる。これらは reply target と参照境界の決定に使う。 |
| BOT.01-04-04 | `available_context.thread_context` には `kind`, `source_message_id`, `known_source_urls`, `reply_thread_id`, `root_channel_id` を載せる。これは thread が root channel か plain thread か knowledge thread かを LLM が解釈するための事実である。 |
| BOT.01-04-05 | `available_context` に内部知見候補一覧を毎回注入しない。内部知見の意味づけと利用方針は root `AGENTS.md` と `discord-harness` Skill が補う。 |
| BOT.01-04-06 | system は business intent を先に決めない。system が固定するのは role, scope, reply target rule, URL 安全境界, thread lineage だけとする。 |
| BOT.01-05 | bot は、投稿の解釈を system が固定分類で先決めせず、LLM が会話文脈に応じて解釈できるようにする。 |
| 理由 | 投稿の種類を固定列挙で縛らず、知見スレッド follow-up や将来の会話形を増やしても system 分岐を肥大化させないため。 |
| 範囲 | `implementation/src/harness/contracts.ts`, `implementation/src/harness/harness-runner.ts`, `implementation/src/app/bot-app.ts` |
| BOT.01-05-01 | Harness の出力は `HarnessResponse` に統一し、`outcome`, `public_text`, `reply_mode`, `target_thread_id`, `persist_items`, `diagnostics.notes`, `sensitivity_raise` を返す。 |
| BOT.01-05-02 | `outcome` は `chat_reply`, `knowledge_ingest`, `admin_diagnostics`, `ignore`, `failure` の 5 値とする。system はまずこの値を見て副作用を決める。 |
| BOT.01-05-03 | `reply_mode` と `target_thread_id` は contract には残すが、現行 adapter はこれらを主制御子としては使わない。現行 runtime では `outcome` と Discord facts を優先して返信先を決める。 |
| BOT.01-05-04 | `chat_reply` は same place 返信の通常会話として扱う。 |
| BOT.01-05-05 | `knowledge_ingest` は root 投稿なら public thread 作成、knowledge thread follow-up なら same thread 返信として扱う。 |
| BOT.01-05-06 | `admin_diagnostics` は admin_control place でのみ利用し、運用者向けの JSON diagnostics を same place に返す。 |
| BOT.01-05-07 | `ignore` は返信しない。 |
| BOT.01-05-08 | `failure` は `public_text` があれば same place に返し、無ければ admin_control channel へ permanent failure を通知する。 |
| BOT.01-06 | bot は、投稿に含まれる URL のうち、ローカル資源、私設ネットワーク、実行可能スキームを指す URL を外部取得対象から除外する。 |
| 理由 | bot がローカルファイル、内部ネットワーク、実行可能 URL を読み取り対象にせず、取得境界を決定的に守るため。 |
| 範囲 | `implementation/src/playwright/url-policy.ts`, `implementation/src/harness/build-harness-request.ts`, `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md` |
| BOT.01-06-01 | system は message 内 URL を `fetchable_public_urls` と `blocked_urls` に分けて `available_context` へ渡す。 |
| BOT.01-06-02 | `fetchable_public_urls` に入れるのは `http:` または `https:` で、host が `localhost`, `.local`, loopback, private IP, link-local, unique local IP に該当しない URL のみとする。 |
| BOT.01-06-03 | `blocked_urls` に含まれる URL は、message 内に見えていても直接取得してはならない。 |
| BOT.01-06-04 | 取得禁止対象には `file:`, `data:`, `javascript:`, `localhost`, `.local`, `127.0.0.1`, `::1`, RFC1918 private IPv4, link-local IPv4, link-local IPv6, unique local IPv6 を含める。 |
| BOT.01-06-05 | この判定の目的は prompt injection 判定ではなく、SSRF とローカル資源漏洩防止である。 |
| BOT.01-07 | bot は、LLM が Discord 文脈と安全境界を理解して応答できるよう、Harness 文書を提供する。 |
| 理由 | Discord の ID やメタデータだけでは会話場所や権限の意味が伝わらず、Harness 文書なしでは正しい解釈が安定しないため。 |
| 範囲 | `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md`, `implementation/src/codex/app-server-client.ts` |
| BOT.01-07-01 | root `AGENTS.md` は bot-runtime harness の正本とする。implementation layer の repository rules は `implementation/AGENTS.md` に分離する。 |
| BOT.01-07-02 | `discord-harness` Skill は Discord message facts を `chat_reply / knowledge_ingest / admin_diagnostics / ignore / failure` として解釈するための local runtime instructions とする。 |
| BOT.01-07-03 | Codex App Server に渡す developer instructions は、`AGENTS.md` を runtime 正本として参照し、reply target, blocked URL, persistence advisory, knowledge thread follow-up の解釈規則を補強する。 |
| BOT.01-07-04 | Harness は Discord の副作用を自分で実行した前提で話さない。副作用は system が実行する。 |

### 【停止中からの再開】

| ID | 要求文 |
|---|---|
| RUN.01-04 | bot は、live 受信と再開処理が重なっても、同じ Discord message を二重処理しない。 |
| 理由 | 再起動や catch-up の前後で同じ投稿に重複返信、重複保存、重複実行を起こさないため。 |
| 範囲 | `implementation/src/app/bot-app.ts`, `implementation/src/queue/ordered-message-queue.ts`, `implementation/src/storage/database.ts` |
| RUN.01-04-01 | bot は watch location ごとに base channel と active thread の cursor を保持し、初回起動時は最新 message を seed する。 |
| RUN.01-04-02 | bot 再起動時は cursor より後の message だけを catch-up する。 |
| RUN.01-04-03 | live 受信と catch-up は同じ queue に流し、channel 単位の ordering key で順序を保つ。 |
| RUN.01-04-04 | 同じ Discord message の処理開始は `message_processing` で 1 回に制限する。 |
| RUN.01-04-05 | 既に別 worker または別経路で処理中の message は duplicate として処理をスキップし、同じ message に二重返信しない。 |
| RUN.01-04-06 | bot process 自体の多重起動は `app_runtime_lock` で防止し、lease を失った instance は停止する。 |

### 【URL知見化】

| ID | 要求文 |
|---|---|
| ING.01-02 | bot は、公開 URL の内容取得手段を固定せず、LLM が文脈に応じて選べるようにする。 |
| 理由 | URL 内容取得の方法を 1 つの技術に固定せず、会話文脈と取得対象に応じて柔軟に選べるようにするため。 |
| 範囲 | `implementation/src/harness/contracts.ts`, `implementation/src/harness/build-harness-request.ts`, `implementation/src/harness/harness-runner.ts`, `implementation/src/knowledge/knowledge-persistence-service.ts`, `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md` |
| ING.01-02-01 | system は取得手段そのものを固定しない。system が渡すのは `fetchable_public_urls` と `blocked_urls` だけとする。 |
| ING.01-02-02 | root 投稿で URL を含む場合、admin_control 以外では `allow_thread_create = true`, `allow_external_fetch = true`, `allow_knowledge_write = true` を渡せる。 |
| ING.01-02-03 | knowledge thread follow-up で `known_source_urls` が 1 件以上ある場合、message 自体に URL が無くても `allow_external_fetch = true` にできる。 |
| ING.01-02-04 | `knowledge_ingest` が返った場合、root 投稿なら system が public thread を作成し、その thread に共有向け summary を返す。 |
| ING.01-02-05 | thread 内 follow-up で `knowledge_ingest` が返った場合、system は same thread に返信する。 |
| ING.01-02-06 | persistence は `persist_items` を advisory として受け取り、URL 対応が揺れていても source URL と `public_text` から fallback 保存できるようにする。 |
| ING.01-02-07 | knowledge 保存の dedupe は `canonical_url + content_hash + scope` とする。 |
| ING.01-02-08 | `persist_items` の URL 対応は、canonicalized URL 一致、index 対応、単一 item fallback、source URL と `public_text` からの合成の順で解決する。 |
| ING.01-02-09 | `persist_items` が不完全でも、回答生成自体は止めない。 |

### 【スレッド応答】

| ID | 要求文 |
|---|---|
| THR.01-03 | 元の URL 内容と蓄積済み知見を参照して回答を生成する。 |
| 理由 | 元投稿から作成したスレッド内で、参加者の追加質問に文脈を保って答えられるようにするため。 |
| 範囲 | `implementation/src/harness/harness-runner.ts`, `implementation/src/storage/database.ts`, `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md` |
| THR.01-03-01 | thread に紐づく `source_link` が 1 件以上ある場合、その thread は `knowledge_thread` として扱う。 |
| THR.01-03-02 | `knowledge_thread` では `thread_context.kind = knowledge_thread` とし、紐づく `canonical_url` 群を `known_source_urls` として Codex に渡す。 |
| THR.01-03-03 | `knowledge_thread` の follow-up は system 側で固定分類しない。Harness が深掘り回答、追加知見化、ignore, failure を決める。 |
| THR.01-03-04 | root 投稿由来の URL ingest は `channelId:message:messageId` 単位の Codex session を使う。knowledge thread follow-up は `reply_thread_id` 単位の Codex session を使う。 |
| THR.01-05 | 生成した回答をスレッド内に返す。 |
| 理由 | URL を含む元投稿ごとに作成したスレッド内で会話を完結させ、root channel をノイズで汚さないため。 |
| 範囲 | `implementation/src/app/bot-app.ts`, `implementation/src/app/replies.ts` |
| THR.01-05-01 | `knowledge_ingest` の root 投稿では、system が public thread を作成し、その thread に reply を送る。 |
| THR.01-05-02 | `knowledge_thread` follow-up では、system が same thread に reply を送る。 |
| THR.01-05-03 | thread 内 reply の本文は `public_text` を優先し、空なら `persist_items` から summary 群を組み立て、どちらも無ければ固定 fallback 文を返す。 |

### 【雑談利用】

| ID | 要求文 |
|---|---|
| CHAT.01-02 | 発話内容に応じた応答を生成する。 |
| 理由 | 雑談用チャンネルで通常会話に自然に応答できるようにするため。 |
| 範囲 | `implementation/src/harness/contracts.ts`, `implementation/src/harness/harness-runner.ts`, `implementation/src/app/bot-app.ts` |
| CHAT.01-02-01 | `chat` mode の root 投稿で URL を含まない場合、bot は place 単位の Codex session を継続する。 |
| CHAT.01-02-02 | `chat_reply` が返った場合、system は same place に返信する。 |
| CHAT.01-02-03 | `chat` mode でも URL を含む root 投稿は knowledge ingest に進めることができる。 |
| CHAT.01-02-04 | `url_watch` mode は root 投稿に URL がある場合だけ処理対象とする。ただし thread 投稿は URL がなくても処理対象に含める。 |

### 【機密区分】

| ID | 要求文 |
|---|---|
| SEC.01-03 | 機密区分ごとに参照可能な保持データを制限する。 |
| 理由 | 投稿場所の機密区分を超えた知見参照を防ぎ、非公開由来の内容が公開場所へ混入しないようにするため。 |
| 範囲 | `implementation/src/discord/facts.ts`, `implementation/src/harness/build-harness-request.ts`, `AGENTS.md` |
| SEC.01-03-01 | system は message ごとに `scope` を解決し、`place.scope` として Codex に渡す。 |
| SEC.01-03-02 | admin_control と private thread は常に `conversation_only` とする。 |
| SEC.01-03-03 | それ以外の場所は watch location の `defaultScope` を使う。 |
| SEC.01-05 | 非公開由来の内容を明示的な許可なしに公開範囲へ出力しない。 |
| 理由 | 上位機密区分の内容が public thread や一般チャンネルへ漏れるのを防ぐため。 |
| 範囲 | `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md`, `implementation/src/app/bot-app.ts` |
| SEC.01-05-01 | Harness は scope を広げない。`sensitivity_raise` は維持または厳格化だけに使う。 |
| SEC.01-05-02 | Harness は `blocked_urls` を取得対象として扱わない。 |
| SEC.01-05-03 | Harness は Discord の副作用を自分で実行した前提で話さない。reply target と保存実行は system が決める。 |

### 【権限制御】

| ID | 要求文 |
|---|---|
| AUTH.03-02 | bot は、管理者限定 command による一時緩和を place と時間で限定して扱い、終了後に通常制約へ戻す。 |
| 理由 | Discord 側では Administrator だけが使える command を入口にし、Codex 側では通常 read-only / 緩和時のみ workspace-write を分離して自己改造権限を閉じ込めるため。 |
| 範囲 | `implementation/src/discord`, `implementation/src/override`, `implementation/src/codex`, `implementation/src/storage/database.ts`, `implementation/docs/discord-llm-bot-implementation-tasks.md` |
| AUTH.03-02-01 | 管理者緩和の入口は guild 内の管理者限定 application command とし、command 定義の default permissions では非管理者に開かない。 |
| AUTH.03-02-02 | bot は command 実行時にも actor role を再評価し、`owner` または `admin` 以外の実行を拒否する。 |
| AUTH.03-02-03 | command は configured `admin_control` channel またはその thread でだけ有効とし、対応 scope は常に `conversation_only` とする。 |
| AUTH.03-02-04 | command で開始した override session は `guild_id + channel_id/thread_id + actor_id` 単位で保存し、有効期限は 30 分または 5 bot turn の早い方とする。 |
| AUTH.03-02-05 | 通常の `chat_reply`, `knowledge_ingest`, knowledge thread follow-up, `admin_diagnostics` は Codex `read-only` sandbox で動かす。 |
| AUTH.03-02-06 | override session 中の自己改造 turn だけは Codex `workspace-write` sandbox で開始または resume し、global `config.toml` を書き換えて常設化しない。 |
| AUTH.03-02-07 | override session の失効時または終了 command 実行時は read-only へ戻し、`who`, `when`, `place`, `sandbox`, `started_at`, `ended_at` を audit log に残す。 |
| AUTH.03-02-08 | `allow_moderation` は actor role が `owner` または `admin` の場合にのみ true にできる。 |
| AUTH.04-01 | bot は、リポジトリ改変を伴う自己改造を通常会話経路から開始させず、管理者限定 command で開始した active override session でだけ扱う。 |
| 理由 | Discord 側の command 権限と Codex 側の sandbox mode を二段で分離し、通常利用者の会話や URL ingest を repo 変更経路へ接続しないため。 |
| 範囲 | `implementation/src/discord`, `implementation/src/override`, `implementation/src/codex`, `implementation/src/app/bot-app.ts`, `implementation/docs/discord-llm-bot-implementation-tasks.md` |
| AUTH.04-01-01 | repo 変更要求を扱えるのは actor role が `owner` または `admin` で、かつ明示依頼と同じ place の active override session がある場合だけとする。 |
| AUTH.04-01-02 | `chat_reply`, `knowledge_ingest`, `admin_diagnostics` の通常経路と root 投稿からの thread 作成経路は repo 変更を起動しない。 |
| AUTH.04-01-03 | `owner` または `admin` であっても active override session がない turn は Codex `read-only` sandbox のままとし、repo 書込みを許可しない。 |
| AUTH.04-01-04 | 非管理者の要求または command 権限検証失敗では Codex を `workspace-write` へ切り替えない。 |
| AUTH.04-01-05 | active override は place-local とし、他 channel/thread/guild の Codex session へ波及させない。 |

### 【コンテナ運用】

| ID | 要求文 |
|---|---|
| OPS.01-01 | bot は、VRC-AI-Bot リポジトリを Docker コンテナ内の workspace として実行し、Codex CLI/App Server も同一コンテナ内で動作させる。 |
| 理由 | ホスト側の個人 skill、認証情報、会話履歴を bot runtime から切り離しつつ、Codex には当該リポジトリ全体だけを見せるため。 |
| 範囲 | `Dockerfile`, `scripts/docker/*.ps1`, `scripts/docker/docker-entrypoint.sh`, `implementation/src/config/load-config.ts`, `implementation/src/codex/app-server-client.ts` |
| OPS.01-01-01 | runtime の作業ディレクトリは repo workspace とし、Codex は当該リポジトリ全体を参照対象にできる。 |
| OPS.01-01-02 | Codex CLI/App Server は bot process と同一コンテナ内で動作する。 |
| OPS.01-01-03 | ホスト側の `~/.codex`、`~/.claude`、個人用 skill、他リポジトリは bind mount しない。 |
| OPS.02-01 | bot は、repo workspace と Codex home を別パスとして扱う。 |
| 理由 | repo を Codex の作業対象にしつつ、OAuth 認証成果物と履歴保存先を workspace から分離するため。 |
| 範囲 | `implementation/src/domain/types.ts`, `implementation/src/config/load-config.ts`, `implementation/src/codex/app-server-client.ts`, `implementation/src/codex/mcp-config.ts`, `Dockerfile`, `scripts/docker/*.ps1` |
| OPS.02-01-01 | 設定契約に `CODEX_HOME` を追加し、bot runtime は process env から受け取る。 |
| OPS.02-01-02 | Codex App Server 起動時は `CODEX_HOME` を子 process に引き継ぐ。 |
| OPS.02-01-03 | Codex config の既定探索先は `CODEX_HOME/config.toml` を優先し、未指定時だけ `~/.codex/config.toml` を使う。 |
| OPS.02-01-04 | コンテナ運用では `HOME=/codex-home`、`CODEX_HOME=/codex-home/.codex` を既定とし、workspace とは別 volume に置く。 |
| SEC.02-01 | bot は、repo 内 `.env` を runtime 前提にせず、秘密情報を Docker 外部から注入された環境変数として読む。 |
| 理由 | Codex が repo を読んでも secret file を発見できない状態を運用既定にするため。 |
| 範囲 | `implementation/src/config/load-config.ts`, `implementation/src/tools/print-discord-invite.ts`, `Dockerfile`, `scripts/docker/*.ps1` |
| SEC.02-01-01 | `loadConfig` は repo root `.env` を読まず、`process.env` だけを設定入力として扱う。 |
| SEC.02-01-02 | Discord application ID のような補助ツール入力も `.env` 前提にしない。 |
| SEC.03-01 | ChatGPT OAuth 認証成果物と Codex 会話履歴は、container-private な Codex home にだけ保存する。 |
| 理由 | ホスト PC 側に `auth.json`、`history.jsonl`、`sessions/`、state DB 相当を残さないようにするため。 |
| 範囲 | `Dockerfile`, `scripts/docker/*.ps1`, `implementation/src/codex/app-server-client.ts`, `implementation/src/codex/mcp-config.ts` |
| SEC.03-01-01 | 初回 login は同じ Docker image / volume を使った `codex login` で行い、認証成果物は Codex home volume にだけ残す。 |
| SEC.03-01-02 | bot 実行時も同じ Codex home volume を使い、host bind mount 側へ auth/history を出さない。 |
| SEC.03-01-03 | Codex home volume を削除すると OAuth 認証情報と履歴をまとめて破棄できる。 |
| NET.01-01 | Docker 運用では、bot の通常運用に受信用ポート公開を必須にしない。 |
| 理由 | host 側ポート露出を増やさず、Discord outbound 通信中心の運用に固定するため。 |
| 範囲 | `scripts/docker/*.ps1`, `AGENTS.md`, `.agents/skills/discord-harness/SKILL.md` |
| NET.01-01-01 | 提供する Docker 実行スクリプトは `-p/--publish` を使わない。 |
| NET.01-01-02 | `localhost`、private IP、LAN、Docker 管理 endpoint、host port を Codex の取得対象として扱わない。 |
| NET.01-01-03 | private/LAN 宛先の outbound 制限は Docker 単体では十分に強制できないため、v0.4 では runtime policy と no-publish を実装し、厳格な egress 制御は別途 infra で補完する前提とする。 |

### 【失敗時】

| ID | 要求文 |
|---|---|
| ERR.01-03 | 生成した内容を対象の会話場所に通知する。 |
| 理由 | 処理失敗時に利用者側と運用者側のどちらへ何を返すかを一定に保つため。 |
| 範囲 | `implementation/src/app/bot-app.ts`, `implementation/src/app/replies.ts` |
| ERR.01-03-01 | queue item 失敗時、通常場所には内部 raw error を直接出さない。 |
| ERR.01-03-02 | 対象 guild に admin_control watch location がある場合、そこへ `permanent_failure` JSON code block を送る。 |
| ERR.01-03-03 | `permanent_failure` には `message_id`, `place_mode`, `channel_id`, `error` を含める。 |
| ERR.01-03-04 | `admin_diagnostics` が成功した場合は same place に diagnostics JSON code block を返す。 |
| ERR.01-03-05 | diagnostics JSON には `message_id`, `place_mode`, `actor_role`, `resolved_scope`, `codex_thread_id`, `notes` を含める。 |
