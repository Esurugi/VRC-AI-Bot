# VRC-AI-Bot 意思決定ログ


---
- 日時：2026-03-09T20:05:00+09:00
- 事項：Discord LLM Bot の実装タスク表を、契約固定→永続化/入口→adapter→URL知見化→Q&A/chat→安全境界→運用制御→仕上げの順で構成し、LLM 出力契約に sources_used を追加して出力検証可能にする方針を採用した。
- 背景：ユーザーから docs/spec を読んで実装順を考え、小タスクへ分離した docs 内のタスク表を作るよう依頼された。独立した LLM セッションがタスク表だけで正しい仕様確認と実装を進められること、また設計順を意識することが求められた。仕様書には SEC.01-04 で sources_used による検証が必要と読める一方、提示された JSON 契約にはその項目がなかった。
- 関連：docs/discord-llm-bot-spec.md, docs/discord-llm-bot-requirements.md, docs/discord-llm-bot-implementation-tasks.md
- 理由：「「また設計順をちゃんと意識して考えてください。」」
- 代替案：仕様書の章立て順にフラットな TODO を並べる案。sources_used を追加せず selected_source_ids のみで済ませる案。
- 捨てた理由：章立て順の TODO では依存の強い契約と安全境界が後ろに回り、独立セッションが誤った順で実装しやすい。selected_source_ids だけでは最終応答で実際に使った source の範囲検証ができず SEC.01-04 を満たしにくい。
- 影響範囲：docs/discord-llm-bot-implementation-tasks.md の構成、タスク依存順、T00/T11 の契約、以後の実装担当セッションの作業順に影響する。

---
- 日時：2026-03-09T21:15:00+09:00
- 事項：初回基盤実装では `channel_cursor` を監視親チャンネル単位ではなく実投稿場所単位で保持し、起動時 catch-up で監視チャンネル本体に加えて active thread も走査する方針を採用した。
- 背景：`T03-T05` を実装する過程で、監視設定は親チャンネル単位だが live 処理対象は派生 thread も含むことが分かった。親チャンネルの cursor だけでは、停止中に thread で発生した投稿を再起動後に再取得できない。
- 関連：docs/discord-llm-bot-spec.md, src/storage/database.ts, src/app/bot-app.ts
- 代替案：cursor を親チャンネル単位だけで持つ案。thread の catch-up は初回実装では諦める案。
- 捨てた理由：親チャンネル cursor だけでは thread の再開整合性が壊れ、仕様上の `channel_family` / `conversation_only` の運用境界に対して見落としが残る。
- 影響範囲：`channel_cursor` の運用単位、起動時の catch-up 実装、Discord チャンネル列挙ロジックに影響する。

---
- 日時：2026-03-09T21:45:00+09:00
- 事項：pnpm 10 の build-script 制御には `pnpm-workspace.yaml` の `onlyBuiltDependencies` を使い、`better-sqlite3` と `esbuild` を明示許可する方針を採用した。
- 背景：初回インストール時に pnpm 10 が build scripts を保留し、`better-sqlite3` の native binding が生成されず storage test が失敗した。
- 関連：pnpm-workspace.yaml, package.json, src/storage/database.ts
- 代替案：毎回手動で `approve-builds` を行う案。SQLite 実装自体を別ライブラリへ差し替える案。
- 捨てた理由：手動承認は CI や独立セッション再現性が低い。ライブラリ差し替えは `T00-T05` の到達点に対して変更範囲が大きい。
- 影響範囲：依存インストールの再現性、`better-sqlite3` の native build、Node 24 での test 実行に影響する。

---
- 日時：2026-03-09T21:51:29+09:00
- 事項：Discord 実機導入試験では、通常チャンネルの stub reply と admin_control の診断応答までを確認対象に限定し、thread 一覧取得失敗は警告で吸収して起動継続する方針を採用した。
- 背景：ユーザーから「実際にDiscordにBotを導入してみる試験をします」と依頼された。現実装は T00-T05 の基盤段階であり、通常回答機能は未実装だが、Discord 接続・queue・Codex turn・監視チャンネル応答は確認可能な状態だった。
- 関連：docs/discord-live-test-runbook.md, src/app/bot-app.ts, src/tools/print-discord-invite.ts
- 影響範囲：実機試験の合格条件、必要 Discord 権限、起動時の失敗耐性、運用手順書に影響する。

---
- 日時：2026-03-10T00:00:00+09:00
- 事項：Discord gateway intents を最小化し、`GuildMembers` intent を削除して `MessageContent` のみを privileged intent として要求する方針を採用した。
- 背景：試験用 Discord server 上で起動確認したところ、Gateway 接続時に `Used disallowed intents` で停止した。現実装の role 判定は `messageCreate` 上の `message.member.permissions` を使っており、`GuildMembers` intent を直接必要としていなかった。ユーザーは本導入前の別サーバーで完成させ、その後に持っていく意図を示した。
- 関連：src/app/bot-app.ts, docs/discord-live-test-runbook.md
- 代替案：Discord Developer Portal 側で `SERVER MEMBERS INTENT` を追加で有効化する案。
- 捨てた理由：現実装で使っていない privileged intent を要求し続ける必要がなく、試験導入時の設定負荷と失敗要因を増やすため。
- 影響範囲：Discord Developer Portal 側の必須設定、起動可否、試験手順書に影響する。

---
- 日時：2026-03-10T01:35:00+09:00
- 事項：Codex 最終出力の一次取得元を `thread/read` 単独から live notification 優先へ変更し、`codex/event/task_complete.msg.last_agent_message` を優先、`item/completed.item.text` を補助、`thread/read` はリトライ fallback とする方針を採用した。
- 背景：実 Discord 試験で通常チャンネル投稿時に `codex thread/read did not contain an agent message` が発生し、admin_control チャンネルへ permanent failure が通知された。実 app-server probe では最終 JSON は event stream 上の `task_complete` / `item/completed` に出る一方、`thread/read` は completed turn でも agentMessage を欠くケースが観測された。
- 関連：src/codex/app-server-client.ts
- 代替案：`thread/read` だけを信頼してリトライ回数だけ増やす案。`turn/completed` の payload だけで完結させる案。
- 捨てた理由：`thread/read` 単独は保存反映タイミング差に弱く、今回すでに実例で破綻した。`turn/completed` は同期シグナルとしては使えるが最終メッセージ本文は含まない。
- 影響範囲：Codex adapter の安定性、Discord 実機試験の成功率、permanent failure の発生頻度に影響する。

---
- 日時：2026-03-10T01:42:00+09:00
- 事項：OpenAI に渡す Structured Outputs schema から `format: "uri"` を除去し、URL 妥当性はローカルの Zod 検証で維持する方針を採用した。
- 背景：admin_control チャンネルの permanent failure で `invalid_json_schema` が返り、`'uri' is not a valid format` と明示された。`codex app-server` は `text.format.schema` 経由で OpenAI Structured Outputs に schema を渡しており、受理される JSON Schema subset に合わせる必要があった。
- 関連：src/domain/codex-output.ts, test/codex-output.test.ts
- 代替案：URL 項目の妥当性検証自体を捨てる案。Structured Outputs 側の schema 変更を待つ案。
- 捨てた理由：妥当性検証を完全に捨てる必要はなく、ローカル parse 後検証へ寄せれば整合が取れる。外部仕様変更待ちは試験継続を止めるだけになる。
- 影響範囲：Codex turn 開始時の schema 受理可否、出力契約の安定性、Discord 実機試験の継続可否に影響する。

---
- 日時：2026-03-10T01:55:00+09:00
- 事項：Discord 実機試験の `chat` / `admin_control` 経路は一度 structured output と会話継続を外し、各投稿ごとに新規 Codex thread を作成して、Discord 本文をそのまま Codex へ渡し、生テキスト応答をそのまま返す最短経路へ切り替える方針を採用した。
- 背景：ユーザーから「まずはシンプルに、投げられたメッセージを取得してそれをそのままCodex App Serverに投げてみないかい」と提案があり、その前段で同一 place の継続 thread と structured output を同時に扱っていたため、transport 由来の不具合と契約由来の不具合が混線していた。
- 関連：src/app/bot-app.ts, src/codex/app-server-client.ts, src/app/replies.ts
- 理由：「「まずはシンプルに、投げられたメッセージを取得してそれをそのままCodex App Serverに投げてみないかい？」」
- 代替案：既存の structured output 経路を維持したまま thread 管理だけ修正する案。
- 捨てた理由：transport 自体の健全性が未確定な状態で structured output と thread 継続を同時に維持すると、失敗原因の切り分けが遅い。
- 影響範囲：Discord 実機試験時の返信内容、`codex_session` の運用意味、`chat` / `admin_control` の応答方式に影響する。

---
- 日時：2026-03-10T02:25:00+09:00
- 事項：`pnpm dev` を「既存の同一 repo Bot プロセスを停止してから 1 個だけ起動する」再起動経路に変更し、通常の手動起動を単一起動前提へ統一した。
- 背景：実 Discord 試験中に、固定 stub と Codex 生応答が同じタイミング帯で観測され、旧プロセスと新プロセスの並走が疑われた。ユーザーから「毎回そうして」と、再起動前の既存プロセス整理を恒常化する指示があった。
- 関連：package.json, scripts/restart-dev-bot.ps1, docs/discord-live-test-runbook.md
- 理由：「「毎回そうして」」
- 代替案：運用で毎回手動停止を徹底する案。`pnpm dev:restart` を別名で追加し、`pnpm dev` は据え置く案。
- 捨てた理由：手動停止は再発しやすい。別名追加だけでは習慣的に古い `pnpm dev` を叩いたときに同じ事故が残る。
- 影響範囲：ローカル起動手順、実 Discord 試験時の多重応答リスク、Runbook の記述に影響する。

---
- 日時：2026-03-10T02:40:00+09:00
- 事項：実 Discord 試験では、受信直後に `👀` リアクションを付け、実処理中は Discord 標準の typing indicator を best-effort で継続送信する方針を採用した。
- 背景：ユーザーから、正常に通ったか観測しづらいため、まず目の絵文字リアクションを返し、その後は Bot が処理中であることを UI 上で見えるようにしたいという要望があった。
- 関連：src/app/bot-app.ts
- 理由：「「目の絵文字でリアクションをまず返す、次に挙動中は『AIの集会botが入力中.....』の表示を出して欲しい」」
- 代替案：処理完了まで何も返さず最終 reply のみで示す案。独自の進捗メッセージを先に投稿する案。
- 捨てた理由：最終 reply のみでは処理中か失敗か見分けづらい。進捗メッセージはチャンネルを汚しやすく、試験中のノイズが増える。
- 影響範囲：Discord 上の観測性、必要権限として `Add Reactions` の有無、処理中 UI の見え方に影響する。

---
- 日時：2026-03-10T02:50:00+09:00
- 事項：plain text の live 試験経路は維持したまま、Codex へ渡す入力を生の本文文字列から最小 `PolicyPacket` JSON へ戻し、返答だけを引き続き plain text に保つ方針を採用した。
- 背景：transport の疎通確認は取れたため、本題に戻って入力契約を段階的に再導入する必要があった。一方で structured output まで同時に戻すと、再び schema と transport の故障が混線する。
- 関連：src/app/bot-app.ts, src/policy/build-policy-packet.ts, src/codex/app-server-client.ts, src/domain/types.ts
- 代替案：引き続き本文文字列だけを渡す案。structured output と分類も同時に戻す案。
- 捨てた理由：本文文字列だけでは policy 境界の再導入が進まない。structured output 同時復帰は切り分け順として早すぎる。
- 影響範囲：Codex への入力形式、`current_task.requested_behavior` 契約、次段の structured output 復帰作業に影響する。

---
- 日時：2026-03-10T03:05:00+09:00
- 事項：Discord の重複 reply 対策は restart スクリプト依存ではなく、SQLite に `message_processing` lease を持たせて同一 `message_id` の処理権を 1 回だけ取得できる方式を採用した。
- 背景：ユーザーの実機試験で、同一投稿に対して reply が 3 つ返る一方、`👀` リアクションは 1 つしか付かない事象が起きた。これは旧プロセス残留や再起動競合を完全には排除できていない兆候であり、process 外の永続的な重複防止が必要だった。
- 関連：migrations/002_message_processing.sql, src/storage/database.ts, src/app/bot-app.ts, test/storage.test.ts
- 代替案：restart スクリプトの kill 条件だけ強化する案。in-memory queue の dedupe に頼る案。
- 捨てた理由：process 側対策だけでは再起動タイミングや別インスタンス競合を止めきれない。in-memory dedupe は単一プロセス内でしか効かない。
- 影響範囲：同一 Discord message の多重 reply 防止、再起動時の安全性、将来の crash recovery 方針に影響する。

---
- 日時：2026-03-10T03:20:00+09:00
- 事項：`BOT.01-05` の structured output 復帰は全経路一括ではなく、`admin_control` チャンネルだけを先に復帰させ、`intent` と `control_request_class` を診断 JSON で観測できる形にした。
- 背景：仕様書では LLM が `intent` と `control_request_class` を返し、system がそれで分岐することが early phase の心臓部とされている。一方、`chat` 経路はようやく transport が安定した段階であり、そこへ structured output を同時復帰させると再び切り分けが難しくなる。
- 関連：docs/discord-llm-bot-spec.md, src/app/bot-app.ts, src/app/replies.ts, src/codex/app-server-client.ts
- 代替案：`chat` と `admin_control` を同時に structured output へ戻す案。引き続き全経路 plain text のままにする案。
- 捨てた理由：同時復帰は故障面が広い。全経路 plain text のままだと `BOT.01-05` の契約検証が前へ進まない。
- 影響範囲：`admin_control` の live 試験方法、Codex session の使い分け、次段の `chat` 分岐復帰手順に影響する。

---
- 日時：2026-03-10T03:30:00+09:00
- 事項：`pnpm dev` の単一起動保証を強化するため、既存プロセス検出を `tsx src/main.ts` 文字列だけでなく、`tsx/dist/cli.mjs`、loader/preflight 形式、`restart-dev-bot.ps1`、`pnpm dev` を含む PowerShell / cmd 連鎖まで広げた。
- 背景：実機試験で `admin_control` だけ current process が「duplicate」と判定し、別プロセスが先に同じ message を処理していることが分かった。Windows 上の `tsx` 起動形態が複数あり、従来の kill 条件では旧 Bot を取りこぼしていた。
- 関連：scripts/restart-dev-bot.ps1, src/app/bot-app.ts
- 代替案：Bot 側の DB lease だけで対処する案。毎回手動で Task Manager 相当の整理をする案。
- 捨てた理由：DB lease は多重 reply を止めるが、期待と違う経路で返信する旧プロセス自体は残る。手動整理は再現性が低い。
- 影響範囲：live 試験時の単一起動保証、`chat` / `admin_control` の分岐観測の信頼性、Windows 上の開発運用手順に影響する。

---
- 日時：2026-03-10T03:50:00+09:00
- 事項：Discord の message queue は全体単一ワーカーから「place ごとの順序保証 + place 間並列」へ変更し、同時に SQLite の `app_runtime_lock` で Bot の単一起動を実行時に強制する方針を採用した。
- 背景：ユーザーの実機試験では `admin_control` の診断 JSON と `chat` の通常応答は分岐できていた一方、コミュニティ利用を前提にすると複数チャンネルの投稿を全体直列で処理する現状は遅すぎた。また旧プロセス残留時の誤経路返信は `message_processing` だけでは「二重返信を減らす」までで、古い Bot 自体の生存は止めきれなかった。
- 関連：src/queue/ordered-message-queue.ts, src/app/bot-app.ts, src/storage/database.ts, migrations/003_app_runtime_lock.sql, test/queue.test.ts, test/storage.test.ts
- 理由：「「同時に複数のチャットに対応できないのはコミュニティで使うBotだから不便すぎるしエラーも治して」」
- 代替案：全体単一ワーカーのまま worker 数だけ増やす案。restart スクリプトと `message_processing` lease だけで多重起動を抑える案。
- 捨てた理由：worker 数だけ増やすと同一 channel/thread の順序保証が崩れる。restart スクリプトと `message_processing` だけでは、別プロセスが先に返信経路を握る問題は残る。
- 影響範囲：複数チャンネル同時処理時の待ち時間、同一 place 内の順序保証、Bot の単一起動保証、live 試験時の返信安定性に影響する。

---
- 日時：2026-03-10T04:20:00+09:00
- 事項：`T06/T07` の URL 取得基盤は、古い `@playwright/cli` ではなく現行の `@playwright/mcp` が提供する `playwright-cli` コマンドをローカル依存として固定し、Bot からはその binary を直接呼び出す方針を採用した。
- 背景：仕様書は `@playwright/cli` 前提だが、現行の実コマンド体系 `open/goto/snapshot/eval/network/screenshot` は `npx --package @playwright/mcp playwright-cli --help` で確認でき、これが実装可能な公式系経路だった。単に `npx --package ...` を毎回叩くと lockfile 固定と実行再現性が弱い。
- 関連：package.json, src/config/load-config.ts, src/playwright/playwright-cli-runner.ts
- 代替案：`npx --package @playwright/mcp playwright-cli` を毎回都度実行する案。Playwright library へ直接切り替える案。
- 捨てた理由：都度 `npx` は依存固定と実行安定性が弱い。library 直利用は仕様の「CLI allowlist」を崩しやすい。
- 影響範囲：URL 取得実装の再現性、ローカル binary 解決、Runbook の依存前提に影響する。

---
- 日時：2026-03-10T04:25:00+09:00
- 事項：`chat` の会話継続は `plain` Codex thread、URL あり投稿のルーティング判定は別の `structured` Codex thread に分離し、`ingest/mixed` のときだけ public thread 作成と知見保存へ委譲する方針を採用した。
- 背景：`chat` の通常会話は生テキスト応答で安定している一方、URL 混在時だけ `intent` 判定が必要だった。1 本の Codex thread に `plain` と `structured` を混在させると thread 起動時の developerInstructions 前提がぶつかる。
- 関連：src/app/bot-app.ts, src/knowledge/knowledge-ingest-service.ts, src/codex/app-server-client.ts
- 代替案：`chat` を全面的に structured output へ戻す案。URL 投稿でも plain 経路のまま ingest 判定を行わず即取り込みする案。
- 捨てた理由：全面 structured 復帰は切り分け面が広い。即取り込みでは `chat` チャンネル内の URL 付き雑談を誤って thread 化しやすい。
- 影響範囲：`chat` の文脈継続、URL 付き投稿の intent 分岐、Codex session の place ID 設計に影響する。

---
- 日時：2026-03-10T04:35:00+09:00
- 事項：`app_runtime_lock` は lease 時間だけでなく `owner_pid` の生死も見て奪取可能とし、強制停止後の stale lock で `pnpm dev` が 30 秒詰まる挙動を防ぐ方針を採用した。
- 背景：Windows の restart スクリプトは旧 Bot を `Stop-Process` で落とすため、正常終了時の `release()` が走らない。lease 満了待ちだけにすると、毎回の再起動で「別インスタンスが動作中」と判定される時間帯が残る。
- 関連：src/storage/database.ts, test/storage.test.ts, scripts/restart-dev-bot.ps1
- 代替案：restart スクリプト側で 30 秒待つ案。DB lock を release する専用コマンドを別途持つ案。
- 捨てた理由：待機は開発体験が悪い。外部 release コマンドはロックの意味を弱めやすい。
- 影響範囲：開発時の再起動速度、stale lock 回復性、単一起動保証に影響する。

---
- 日時：2026-03-10T04:45:00+09:00
- 事項：`playwright-cli eval` の結果は必須入力にせず、空文字や失敗時は snapshot artifact の可視テキストを読み、それでも不足なら `Page Title + finalUrl` へ段階的に fallback する方針を採用した。
- 背景：実機 URL ingest で public thread 自体は作成できたが、`playwright-cli eval did not return result text` により ingest 全体が permanent failure になった。CLI の `eval` 出力はページ差で空になる可能性があり、ここを hard failure にすると URL ingest の成功率が不必要に下がる。
- 関連：src/playwright/playwright-cli-runner.ts, src/playwright/snapshot-text.ts, test/snapshot-text.test.ts
- 代替案：`eval` が空なら即 permanent failure にする案。`eval` を複数回 retry する案。
- 捨てた理由：即失敗は brittle で、snapshot を既に取得できているのに捨てるのが不合理。retry は空ページや JS 側事情では改善しない。
- 影響範囲：URL ingest の堅牢性、Playwright artifact の利用方針、failure 通知の頻度に影響する。

---
- 日時：2026-03-10T06:10:00+09:00
- 事項：URL ingest の主経路を `Playwright CLI orchestration` から `Codex native web retrieval + HarnessRequest/HarnessResponse` へ切り替え、Discord Bot は thin adapter として再構成する方針を採用した。
- 背景：実機試験で連続した permanent failure の主因は model 能力不足ではなく、system 側の過剰制御だった。特に URL 対応付け、artifact shape 前提、Playwright parser 前提が brittle で、仕様書が意図していた「LLM に自由にやらせる」設計と逆方向へ倒れていた。Codex 自体が web retrieval を使えるため、Playwright を通常経路の必須条件にする合理性が薄れた。
- 関連：docs/discord-llm-bot-spec-v2.md, src/harness/contracts.ts, src/harness/build-harness-request.ts, src/harness/harness-runner.ts, src/codex/app-server-client.ts, src/knowledge/knowledge-persistence-service.ts, src/app/bot-app.ts
- 代替案：Playwright を残したまま fallback を積み増す案。旧 `PolicyPacket` / `CodexTurnOutput` 系を温存しながら局所修正する案。
- 捨てた理由：どちらも wrapper の複雑さを増やし、失敗面の本質を温存する。必要なのは局所修正ではなく、責務の置き場所の変更だった。
- 影響範囲：主契約、URL ingest の実装方針、実機 runbook、以降の retrieval / thread_answer 実装順に影響する。

---
- 日時：2026-03-10T11:45:00+09:00
- 事項：Playwright orchestration と `PolicyPacket` / `CodexTurnOutput` を runtime から撤去し、常設 harness artifact を `AGENTS.md` と project local skill `discord-harness` に寄せたうえで、`HarnessRequest/HarnessResponse` を最小 contract に縮小した。
- 背景：URL ingest と follow-up の失敗原因が継続して system 側の過剰制御に集中していた。特に message ごとの `visible_candidates` 注入、`thread_plan/knowledge_ops/retry_plan` のような詳細 orchestration、Playwright parser 前提が brittle だった。ユーザーからは「不要な実装を削除して、implementation に基づいて実装計画」と明示的に削減リファクタを求められた。
- 関連：AGENTS.md, .claude/skills/discord-harness/SKILL.md, src/harness/contracts.ts, src/harness/build-harness-request.ts, src/harness/harness-runner.ts, src/codex/app-server-client.ts, src/knowledge/knowledge-persistence-service.ts, src/app/bot-app.ts, docs/discord-llm-bot-spec-v2.md
- 代替案：旧 contract を残したまま局所修正だけを続ける案。Playwright orchestration を fallback として温存する案。
- 捨てた理由：局所修正では「system が LLM の行動計画を細かく拘束する」構造が残る。fallback 温存もコードと失敗面を増やし、責務境界を再び曖昧にする。
- 影響範囲：Codex への入力 shape、admin diagnostics の中身、knowledge persistence の fallback 方針、project-local harness artifact の置き場所、以後の spec/runbook の source of truth に影響する。

---
- 日時：2026-03-11T00:50:00+09:00
- 事項：repository root の `AGENTS.md` を Codex 向け bot-runtime harness の正本に切り替え、従来の実装指針は `implementation/AGENTS.md` へ退避した。`CLAUDE.md` は mirror として残す。
- 背景：ユーザーから「Codex は `CLAUDE.md` ではなく `AGENTS.md` を正とする」「実装フォルダと Bot として動作するフォルダを分ける」と明示された。runtime harness と実装向け repository rules を同じ root `AGENTS.md` に同居させると、Codex app-server が読む文書と実装者向け制約が衝突する。
- 関連：AGENTS.md, CLAUDE.md, implementation/AGENTS.md, src/codex/app-server-client.ts, docs/discord-llm-bot-spec-v2.md, docs/discord-llm-bot-spec-delta-v0.4.md
- 代替案：root `AGENTS.md` を実装指針のままにして `CLAUDE.md` を bot-runtime harness の正本に維持する案。root `AGENTS.md` に runtime と implementation の両方を同居させる案。
- 捨てた理由：前者は Codex の参照先と runtime harness がずれる。後者は空コンテキストの実行者が読むべき bot-runtime policy と、人間/実装者向け repository rules が混線する。
- 影響範囲：Codex app-server への常設コンテキスト参照先、spec 上の harness artifact 表記、今後の implementation 文書の置き場に影響する。

---
- 日時：2026-03-11T01:05:00+09:00
- 事項：bot-runtime layer と implementation layer を物理的に分離するため、実装コードとテストを `implementation/src` と `implementation/test` へ移動し、root は runtime harness と運用資産を置く形へ再編した。
- 背景：`root AGENTS.md` を runtime harness に切り替えただけでは、実際の bot mechanism が依然として root `src/` に存在し、層分離が概念上に留まっていた。ユーザーからは「LLMがBotアプリケーションとして作動するために必要な層」と「実際にBotの仕組みが実装されている層」を分けるよう明示的に要求された。
- 関連：AGENTS.md, implementation/AGENTS.md, implementation/README.md, implementation/src/main.ts, implementation/test, package.json, tsconfig.json, scripts/restart-dev-bot.ps1
- 代替案：root `src/` のまま文書だけで層境界を説明する案。runtime 専用フォルダだけを追加し、実装コードは root に残す案。
- 捨てた理由：どちらも空コンテキストの実行者から見ると「runtime harness と implementation が同じ層に見える」状態を解消できない。物理的な配置差を付ける方が境界として明確だった。
- 影響範囲：起動スクリプト、TypeScript build/test path、Codex runtime が参照する repository layering の理解、今後の実装追加時の置き場所に影響する。

---
- 日時：2026-03-11T03:39:15+09:00
- 事項：Docker 隔離は `1 コンテナ方式` を採用し、repo workspace と container-private な `CODEX_HOME` を分離したうえで、bot と Codex CLI/App Server を同一コンテナ内で動かす方針を採用した。
- 背景：ユーザーから、VRC-AI-Bot リポジトリ自体を Docker 上に置き、その中で Codex も動かしたいこと、Codex からホスト側のローカル skill やポートを見せたくないこと、`.env` は Docker 外側に置いて環境変数としてのみ渡したいこと、ChatGPT OAuth 認証と会話履歴もホスト PC に残したくないことが明示された。
- 関連：AGENTS.md, .agents/skills/discord-harness/SKILL.md, implementation/docs/discord-llm-bot-requirements.md, implementation/docs/discord-llm-bot-spec-delta-v0.4.md, implementation/src/config/load-config.ts, implementation/src/codex/app-server-client.ts, implementation/src/codex/mcp-config.ts, Dockerfile, scripts/docker
- 理由：「Codexのローカルのスキルが覗けないように、ポートが見えないようにしたい。その手段として他の観点でも健全で都合がいいためDockerを使う」
- 影響範囲：runtime の設定契約は `.env` 読み込み前提から `process.env` 前提へ変わり、Docker image / env-file / named volume による運用手順、Codex OAuth 保存先、履歴破棄手順、runtime harness の自己改造境界に影響する。

---
- 日時：2026-03-11T04:05:00+09:00
- 事項：初回 Docker 導入支援は「この repo 専用の閉じた手順」ではなく、Windows へ Docker Desktop をグローバル導入したうえで本 repo の `scripts/docker` を使う運用として整理し、`codex-login.ps1` は env file なしでも実行できるようにする方針を採用した。
- 背景：ユーザーから、今後も Docker を使う機会があるためグローバル導入を前提にしたいこと、加えて Docker サポートは Context7 ベースの公式情報に基づいて行うことが明示された。現状の `codex-login.ps1` は bot 起動に不要な env file を必須にしており、Docker Desktop 導入直後の初回ログイン導線として不自然だった。
- 関連：docs/docker-desktop-setup.md, scripts/docker/codex-login.ps1, scripts/docker/run-bot.ps1, implementation/src/config/load-config.ts
- 理由：「今後もDocker使いたい機会はあるだろうから、グローバルで入れたい。サポートは常にContext7に基づいて行う」
- 代替案：project ローカルの Docker 実行手順だけを案内する案。`codex-login.ps1` でも env file 必須のままにする案。
- 捨てた理由：前者は Docker 自体の再利用性が低く、ユーザー意図と合わない。後者は初回セットアップ時に不要な秘密情報ファイル準備を先に強制してしまう。
- 影響範囲：Docker Desktop の導入順序、初回 Codex login の手順、project の onboarding 文書に影響する。

---
- 日時：2026-03-11T04:25:00+09:00
- 事項：Docker runtime は image build 時だけ `node` 権限へ chown する構成では不十分と判断し、entrypoint を root で開始して mounted volume の所有権を整えた後に `node` ユーザーへ降格する方針を採用した。併せて `corepack prepare pnpm@10.6.5 --activate` で初回起動の対話プロンプトを排除する。
- 背景：Docker Desktop 導入後に `scripts/docker/run-bot.ps1` で実起動したところ、named volume を mount した `/workspace/node_modules` に対して `pnpm install` が `EACCES: permission denied, mkdir '/workspace/node_modules/.pnpm'` で失敗した。また同時に `pnpm` shim の初回ダウンロード確認が対話待ちを発生させ、無人起動経路として不安定だった。
- 関連：Dockerfile, scripts/docker/docker-entrypoint.sh, scripts/docker/run-bot.ps1, docs/docker-desktop-setup.md
- 代替案：コンテナ全体を root のまま動かす案。`node_modules` volume をやめて bind mount に寄せる案。毎回手動で `pnpm` プロンプトへ応答する案。
- 捨てた理由：常時 root 実行は不要な権限を広げる。bind mount では host 側との混線が増える。手動応答は運用再現性がない。
- 影響範囲：Docker 起動時の所有権補正、`pnpm install` の安定性、初回 bot 起動の自動化に影響する。
