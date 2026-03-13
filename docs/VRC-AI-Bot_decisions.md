# VRC-AI-Bot 意思決定ログ

---
- 日時：2026-03-11T04:48:20+09:00
- 事項：常用起動は対話用 `run-bot.ps1` を流用せず、バックグラウンド起動専用の `start-bot.ps1` と repo 直下の `bat` ラッパーを追加する方針を採用した。
- 背景：ユーザーから、PC を起動している時に毎回 Bot を起動できるよう bat ファイルを作ってほしいと依頼された。既存の `scripts/docker/run-bot.ps1` は `--rm -it` で foreground の対話実行を前提にしており、bat からの常用起動や Startup 登録の土台としては扱いにくかった。
- 関連：docs/docker-desktop-setup.md, scripts/docker/run-bot.ps1, scripts/docker/start-bot.ps1, start-vrc-ai-bot.bat
- 代替案：既存の `run-bot.ps1` をそのまま bat から呼ぶ案。bat 内へ `docker run` コマンドを直接埋め込む案。
- 捨てた理由：前者はコンソールを占有する対話実行の性質が残る。後者は Docker 起動待ちや既存コンテナ再利用の分岐が bat に分散し、保守しにくい。
- 影響範囲：日常の bot 起動導線、Docker Desktop 起動直後の待機処理、既存コンテナの再利用方法に影響する。

---
- 日時：2026-03-11T05:10:56+09:00
- 事項：仕様書に基づく Codex multi-agent 実装計画は、全タスクを無制限に並列化するのではなく、依存関係に沿った直列ゲートと「最大 2 レーン」の安全な並列フェーズで構成し、`bot-app.ts`、`database.ts`、`types.ts` などのハブは単独所有にする方針を採用した。
- 背景：ユーザーから、`agents-harness-implementation` を使って仕様書ベースの multi-agent 並列実装計画を SVG にまとめてほしいこと、続けてローカル Git リポジトリも作成してほしいことが依頼された。実装タスク表と現行コードを照合すると、仕様上は並列化可能な箇所があっても、共有エントリポイントや共有型・共有 DB リポジトリを複数 worker が同時編集すると衝突コストが高いことが分かった。
- 関連：implementation/docs/discord-llm-bot-implementation-tasks.md, implementation/docs/discord-llm-bot-requirements.md, implementation/docs/codex-multi-agent-plan.svg, docs/VRC-AI-Bot_decisions.md
- 代替案：仕様タスクを広く同時並行に流し、`bot-app.ts` や `database.ts` の統合も各 worker に任せる案。現行実装の進捗だけに合わせて `T08` 以降の部分図だけを描く案。
- 捨てた理由：前者は shared seam の競合と手戻りが大きい。後者は仕様書ベースの全体ロードマップとしては不完全で、これから multi-agent 実装を回す際の基準図として弱い。
- 影響範囲：今後の Codex multi-agent の spawn 順序、worker ごとの write scope、lead/integrator の責務分担、並列実装時の衝突回避方針に影響する。

---
- 日時：2026-03-11T05:27:32+09:00
- 事項：管理者限定Discord command を自己改造の唯一の入口にし、通常 Codex を read-only、override self-mod session だけ workspace-write にする方針を採用した。
- 背景：ユーザーから、Administrator 権限を持つ人だけが使える bot command を用意し、その command だけ Codex を workspace-write、それ以外は read-only にすれば、権限管理者だけが自己改造指示を出せる仕様を secure に作れると指摘があった。既存仕様では admin_control は diagnostics 専用、自己改造経路は未実装境界のままで、Discord 側の権限制御と Codex 側の sandbox 分離を結び付けた設計へ更新が必要だった。
- 関連：implementation/docs/discord-llm-bot-requirements.md, implementation/docs/discord-llm-bot-spec-delta-v0.4.md, implementation/docs/discord-llm-bot-implementation-tasks.md, AGENTS.md, .gitignore
- 理由：「GitのBot機能側でAdministrator権限を持っている人だけが使えるコマンドを用意して、そのコマンドはCodexをWorkspace-editを許可し、それ以外の場合はRead-onlyで運用すれば権限管理者だけが自己改造指示を出せる仕様がセキュアに作れることに気付いた」
- 代替案：通常会話や admin_control の通常メッセージから owner/admin の明示依頼だけで自己改造を開始する案。Codex を常時 workspace-write で動かし、アプリ側ロジックだけで自己改造要求を拒否する案。
- 捨てた理由：前者は Discord の command 権限で入口を閉じられず、通常会話経路との境界が曖昧に残る。後者は Codex 側の書込み権限が常時開いてしまい、通常 turn の破壊半径が広すぎる。
- 影響範囲：管理者 override の入口、Codex sandbox policy、自己改造の受理条件、実装タスク T05/T13、初回コミット時の repo ドキュメント導線に影響する。

---
- 日時：2026-03-11T05:40:00+09:00
- 事項：管理者 override の終了条件は時間ベースの TTL ではなく、同じ place からの明示終了 command を正本とし、bot 再起動時は fail-closed で read-only へ戻す方針を採用した。
- 背景：ユーザーから、`AUTH.03.02` を時間で扱うのは command 管理を思いつく前の制約であり、今はそれを行わず、その代わりに明示的に終了できる方法を持つべきだと修正要求があった。直前の仕様では管理者限定 command の導入後も「30 分または 5 bot turn」で override が失効する設計が残っていた。
- 関連：implementation/docs/discord-llm-bot-requirements.md, implementation/docs/discord-llm-bot-spec-delta-v0.4.md, implementation/docs/discord-llm-bot-implementation-tasks.md, implementation/docs/codex-multi-agent-plan.svg, docs/VRC-AI-Bot_decisions.md
- 理由：「AUTH0302を時間で扱うのはコマンド管理を思いつく前の制約だったのでこれを行なわない。その代わりに、明示的に終了出来る方法を持つべき」
- 代替案：30 分または 5 turn の TTL を維持する案。TTL と終了 command を両方持つ案。
- 捨てた理由：前者は command ベースの明示運用と整合しない。後者は「どちらが正本の終了条件か」を増やして運用判断を曖昧にする。
- 影響範囲：AUTH.03.02 の終了条件、`src/override` の責務、T13 の完了条件、運用者が認識する sandbox 状態の扱いに影響する。

---
- 日時：2026-03-11T07:05:00+09:00
- 事項：自己改造要求は 1 turn 目を常に read-only thread で分類し、`repo_write_intent` が true かつ active override がある場合だけ、place-local な別の workspace-write thread へ切り替えて再実行する方針を採用した。
- 背景：現行実装の `CodexAppServerClient.startThread()` は通常会話も含めて常に `workspace-write` で thread を開始しており、AUTH.03/AUTH.04 の「通常は read-only」に反していた。単純に 1 本の thread に対して sandbox を都度切り替える案もあったが、通常会話と自己改造の履歴を同じ thread に混ぜると、override 終了後も write 用の実行文脈が残りやすかった。
- 関連：implementation/src/codex/app-server-client.ts, implementation/src/harness/contracts.ts, implementation/src/harness/build-harness-request.ts, implementation/src/harness/harness-runner.ts, implementation/src/app/bot-app.ts
- 代替案：1 本の thread を使い続け、turn ごとに sandbox だけ read-only / workspace-write へ切り替える案。owner/admin の通常メッセージは最初から workspace-write thread に流す案。
- 捨てた理由：前者は read-only 会話と write 実行の履歴境界が曖昧になる。後者は active override がない turn や単なる相談・レビューまで write 用 thread に寄ってしまい、通常経路の安全境界が弱い。
- 影響範囲：Codex session key の切り方、override なし自己改造要求の拒否方法、admin_control 内の self-mod 実行経路、T05/T13 のテスト観点に影響する。

---
- 日時：2026-03-11T18:25:00+09:00
- 事項：`admin_control` の通常会話は diagnostics JSON に落とさず、`admin_diagnostics` は明示的な運用診断要求だけに限定し、権限確認のような会話は `chat_reply` へ正規化する方針を採用した。
- 背景：実 Discord 試験で、`/override-start` 後に「今の貴方の権限は？」と質問すると、期待した自然文ではなく `admin_diagnostics` JSON が same place に返った。仕様上 `admin_diagnostics` は admin_control で使えるが、通常会話まで JSON 応答に落ちると運用者の確認操作が不自然になり、会話系確認と明示診断要求の境界が曖昧になる。
- 関連：implementation/src/codex/app-server-client.ts, implementation/src/harness/harness-runner.ts, implementation/test/harness-runner.test.ts, scripts/docker/start-bot.ps1
- 代替案：Codex 側 instruction の文言だけを修正して再発防止を期待する案。`admin_control` の全応答を引き続き JSON diagnostics 寄りにする案。
- 捨てた理由：前者はモデルの選択が再度ぶれる余地を残す。後者は明示診断と通常会話の使い分けが利用者視点で悪く、権限確認やポリシー確認の UX を落とす。
- 影響範囲：admin_control の会話 UX、`admin_diagnostics` の発火条件、Discord 実機試験時の確認手順、通常再起動導線の `start-bot.ps1` 安定性に影響する。

---
- 日時：2026-03-11T21:10:00+09:00
- 事項：管理者 override は admin_control root から開く dedicated thread-local session を正本とし、終了 command で Discord thread と workspace-write Codex thread を同時に閉じる方針を採用した。
- 背景：ユーザーから、open command 実行時に dedicated thread を開き、その thread に書込み権限を持つ Codex を対応付け、thread 内 close で thread と Codex の両方を終了する形へ要求を見直して実装も修正してほしいと指示があった。直前の正史と実装は place-local override と bot 起動時 fail-closed cleanup を前提にしていた。
- 関連：AUTH.03-02, AUTH.04-01, implementation/docs/discord-llm-bot-spec-delta-v0.4.md, implementation/src/app/bot-app.ts, implementation/src/harness/harness-runner.ts, implementation/src/codex/app-server-client.ts
- 理由：「「そうすれば、ボットがシャットダウンされた後や再起動後も、スレッド単位でコーデックスを保持できて見分けられるので、シャットダウン時にわざわざ終了させる必要もなくなります。」」
- 代替案：place-local override を維持しつつ bot 起動/停止時に fail-closed cleanup する案。write 権限用 Codex を thread ではなく command 実行 place 全体に結び付ける案。
- 捨てた理由：前者は restart 後に dedicated self-mod context を再利用できず、明示 close より先に bot lifecycle 側の都合で override が失効する。後者は Discord thread と Codex write session の境界が一致せず、どの write context を閉じるべきかが曖昧になる。
- 影響範囲：AUTH.03/AUTH.04 の適用範囲、T05/T13 の完了条件、Discord command の受理場所、Codex thread archive/unsubscribe、起動時 fail-closed cleanup の扱いに影響する。

---
- 日時：2026-03-11T21:40:00+09:00
- 事項：active override thread では、開始者本人の turn 全体を常時 workspace-write context に載せ、repo_write_intent で read-only を挟まない方針へ切り替えた。
- 背景：ユーザーから、override thread に入っている間は常に write context で会話したい、それが正しい実装だと明示要求があった。直前の実装は override thread でもまず read-only turn を走らせ、repo_write_intent が true のときだけ workspace-write thread へ再実行していた。
- 関連：AUTH.03.05, AUTH.03-02-05, AUTH.03-02-06, implementation/src/harness/harness-runner.ts, implementation/test/harness-runner.test.ts
- 理由：「「もうスレッドに入っている間は常にライトコンテキストで会話したいです。そして、そちらの方が正しい実装です。」」
- 代替案：override thread 内でも従来どおり read-only turn を先に実行し、repo_write_intent が true のときだけ workspace-write に上げる案。override thread の全 actor を常時 workspace-write にする案。
- 捨てた理由：前者は thread を開いても会話コンテキストが read-only と workspace-write に分断され、運用者が write thread を明示的に開いた意味と一致しない。後者は override を開始していない別 actor まで write context に載せてしまい、最小権限を崩す。
- 影響範囲：override thread の会話継続性、Harness の routeMessage 分岐、AUTH.03/AUTH.04 の説明文、回帰テストの期待値に影響する。

---
- 日時：2026-03-11T21:55:00+09:00
- 事項：active override thread の開始者本人には Harness capability を全て true で渡し、開始メッセージも常時 workspace-write 前提へ更新する方針を採用した。
- 背景：ユーザーから、active override thread で bot が external fetch / knowledge write / thread create を false と説明しているのは過剰であり、全て true であるべきだと修正要求があった。あわせて、override 開始時の案内文がまだ「通常会話は read-only、明示的な repo 改変要求の turn だけ workspace-write」と古い仕様を案内していると指摘があった。
- 関連：AUTH.03.05a, AUTH.03-02-06a, implementation/src/harness/harness-runner.ts, implementation/src/app/bot-app.ts, implementation/test/build-harness-request.test.ts
- 理由：「「全部tureであるべきだし、全体的に実装が制約多そうな実装になっていそう。」」
- 代替案：workspace-write sandbox だけを広げ、Harness capability は従来どおり turn ごとに絞る案。開始メッセージだけ直して capability は変えない案。
- 捨てた理由：前者は active override thread を開いた管理者の期待と実際の capability 表示が一致しない。後者は UI 文言だけ直っても、実際に bot が capability false を自己申告する不整合が残る。
- 影響範囲：override thread 内の capability 表示、Codex の自己認識、AUTH.03 の仕様文、回帰テスト、運用者の期待値に影響する。

---
- 日時：2026-03-11T00:00:00+09:00
- 事項：Discord thread 作成を Harness capability から外し、allow_external_fetch と allow_knowledge_write は turn-local capability として維持する方針に修正した。
- 背景：ユーザー指摘どおり、read-only と capability の説明が混線し、allow_thread_create だけが Discord 副作用なのに capability として生えていた。仕様の system-thin 原則にも反していた。
- 関連：BOT.01-04-06, ING.01-02-02, AUTH.03-02-06a, implementation/src/harness/contracts.ts, implementation/src/harness/build-harness-request.ts, implementation/src/codex/app-server-client.ts
- 理由：「LLMの自由度を保ってシステムを薄くするって書いてるよな仕様に」
- 代替案：allow_thread_create を残したまま説明だけ直す案もあるが、contract 自体が Discord 副作用を capability 化しており過剰。
- 捨てた理由：thread 作成を capability として維持する案は、仕様の薄い system 境界と Discord side effect の system 所有原則に反するため却下。
- 影響範囲：今後の権限説明で thread 作成可否を能力列挙に含めず、URL ingest と knowledge ingest は outcome と available_context 中心で表現される。
- 検証：pnpm typecheck; pnpm test; docker restart vrc-ai-bot

---
- 日時：2026-03-11T00:00:00+09:00
- 事項：chat root の URL 投稿は会話材料として扱い、自動知見化は url_watch に限定する方針へ戻した。
- 背景：ユーザー指摘どおり、雑談チャンネルで URL を貼っただけで要約 thread 化するのはプロダクト意図に反する。場所ごとの役割を system が守るべきだった。
- 関連：CHAT.01.04, CHAT.01-02-03, BOT.01-05-05, ING.01-02-02, implementation/src/harness/harness-runner.ts, implementation/src/codex/app-server-client.ts
- 理由：「何のためにその機能を実装しているのか、ユーザーストーリーとしてどう動いてくれるのが理想なのか」
- 代替案：LLM の判断だけで chat と url_watch を出し分ける案もあるが、場所の意味というプロダクト境界は system が固定した方が再発しにくい。
- 捨てた理由：chat でも URL があれば自動 knowledge_ingest に進める案は、雑談 UX を壊し、知見共有チャンネルの存在意義も曖昧にするため却下。
- 影響範囲：chat root では URL を含んでも thread 作成と知見保存を行わず、必要なら会話として読むだけに留める。url_watch と knowledge thread だけが共有知見の入口になる。
- 検証：pnpm typecheck; pnpm test; docker restart vrc-ai-bot

---
- 日時：2026-03-11T23:35:00+09:00
- 事項：LLM との turn 完了待ちに人工 timeout を置かず、Discord 返信は切り捨てではなく分割送信で扱う方針へ切り替えた。
- 背景：ユーザーから、文字数制限や timeout のような LLM とのコミュニケーションを阻害する制約を足すべきではなく、既存のものも捨てるべきだと修正要求があった。直前の実装には Codex turn 完了待ちの 120 秒 timeout と、Discord 返信本文を 1900 文字単位で打ち切る経路が残っていた。
- 関連：implementation/src/codex/app-server-client.ts, implementation/src/app/replies.ts, implementation/src/app/bot-app.ts, implementation/src/harness/harness-runner.ts, implementation/docs/discord-llm-bot-requirements.md, implementation/docs/discord-llm-bot-spec-delta-v0.4.md
- 理由：「あらゆる実装で、文字数を切るとか、タイムアウトを設定するとか、LLMとのコミュニケーションを阻害する制約を足すな。今あるものは全て唾棄し」
- 代替案：Codex turn に長めの timeout を残す案。Discord 返信は従来どおり 1900 文字で truncate する案。
- 捨てた理由：前者は長い翻訳や deep follow-up を人工的に失敗へ寄せる。後者は海外記事を日本語で詳しく共有したい要求と両立せず、出力を途中で失う。
- 影響範囲：Codex App Server client の turn completion 待機、Discord reply の送信方式、knowledge thread follow-up の UX、長文知見共有の可視性に影響する。
- 検証：pnpm typecheck; pnpm test; docker restart vrc-ai-bot

---
- 日時：2026-03-11T23:59:00+09:00
- 事項：T08 retrieval では knowledge schema を v2 に再構築し、可視境界は `scope` だけでなく `visibility_key` でも保持し、hydration 本文は `knowledge_source_text` に分離する方針を採用した。
- 背景：現行 schema は `knowledge_record.scope` しか持たず、`channel_family` と `conversation_only` の再利用境界を正しく復元できなかった。加えて `knowledge_artifact.snapshot_path` は locator であり、retrieval で読む本文の保存先としては責務が違っていた。
- 関連：MEM.01.02, MEM.01.03, T08 Retrieval, migrations/005_knowledge_retrieval_v2.sql, implementation/src/storage/database.ts, implementation/src/knowledge/knowledge-persistence-service.ts, implementation/src/knowledge/knowledge-retrieval-service.ts
- 理由：「DB関連なのでアンチパターンが排除できているかよく自己確認して」
- 代替案：`scope` だけで検索可否を決める案。`knowledge_artifact` に本文列を足して metadata と hydration を同居させる案。既存 knowledge を推定 backfill する案。
- 捨てた理由：前者は channel/thread 境界をまたいだ誤再利用を防げない。2 つ目は artifact locator と retrieval 本文が混ざり、将来 Playwright artifact が濃くなったときの責務分離が崩れる。3 つ目は既存 row から正しい visibility を復元できず、静かに漏えいリスクを持ち込む。
- 影響範囲：knowledge ingest の保存形、FTS 検索、source hydration、既存 knowledge データの扱い、T09 thread Q&A の前提に影響する。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-11T23:59:30+09:00
- 事項：知見活用は knowledge thread 専用にせず全 place へ広げ、自然文の明示保存依頼は URL 貼付がなくても公開情報を保存できる方針に更新した。
- 背景：ユーザーから、共有知見は thread 以外の雑談や質問でも引けるべきであり、URL を貼らなくても「調べて保存して」と頼める柔軟性が必要だと指摘があった。一方で、chat の URL 投稿を貼っただけで自動知見化される挙動は維持したくないという意図も明確だった。
- 関連：AGENTS.md, .agents/skills/discord-harness/SKILL.md, implementation/docs/discord-llm-bot-requirements.md, implementation/docs/discord-llm-bot-spec-delta-v0.4.md, implementation/docs/discord-llm-bot-implementation-tasks.md
- 理由：「Threadでなくても共有知見は普通の雑談や質問とかでもデータを引っ張ってくれて良い」「URLとして提示されたものでなくてもLLMに頼んだらBotがその場でDBSMを操作して追加出来るくらいの柔軟性がほしい」
- 代替案：knowledge thread だけに retrieval を閉じる案。chat の URL 投稿も自動保存対象へ広げる案。
- 捨てた理由：前者は蓄積知見の再利用価値を unnecessarily 狭める。後者は雑談 UX を壊し、明示保存と自動知見化の境界を曖昧にする。
- 影響範囲：runtime harness の解釈、T09 の責務、same-place knowledge save の扱い、自然文保存の persistence scope が同一 guild の `server_public` であることに影響する。

---
- 日時：2026-03-12T17:10:00+09:00
- 事項：T11 は本文の意味分類ではなく、`sources_used` と source visibility を根拠にした薄い output safety guard として実装する方針を採用した。
- 背景：session policy と knowledge-assisted conversation が通ったことで、次に必要なのは新 workload を足しても共通に効く出力境界だった。一方で、ユーザーは一貫して「System は事実・境界・副作用だけを持ち、意味解釈は Harness に残す」ことを重視しており、T11 でも TypeScript が本文の意味を広く判定する設計は避ける必要があった。
- 関連：SEC.01.03, SEC.01.04, SEC.01.05, implementation/src/harness/output-safety-guard.ts, implementation/src/harness/harness-runner.ts, implementation/src/harness/contracts.ts, implementation/src/codex/app-server-client.ts
- 理由：「T11 は、Harness の意味解釈を TypeScript が奪わずに、最終出力の直前で source 境界だけを検査する薄い System guard として実装する」
- 代替案：本文パターンや固有表現を System が広く検査する DLP 風ガード案。違反時に即拒否し再生成しない案。
- 捨てた理由：前者は意味解釈を System 側へ戻し、境界原則に反する。後者は安全性は満たせても、Harness に公開可能な根拠だけで答え直す余地を与えず UX を悪化させる。
- 影響範囲：System は `sources_used`、record visibility、`fetchable_public_urls`、blocked/private URL、安全再生成 1 回、fixed refusal だけを持つ。DB query wording、save intent、retrieval strategy は T11 では決めない。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T01:15:00+09:00
- 事項：DB 検索語や保存意図の意味解釈は System の TypeScript heuristic で持たず、repo-local skills と scripts を正規運用経路として Harness 主導に戻す方針を採用した。
- 背景：ユーザーから、System と Harness の境界として重要なのは「DB 内の情報から欲しい情報を抜き取る精度が System 側に依存していないこと」であり、クエリ保存や検索語決定まで System が担うと精度の大部分が単純検索機能に依存してしまうと指摘があった。さらに、Harness とは必要な情報を必要な瞬間に最小コストで届ける外部構造であり、LLM が DB や Discord の運用手順を実装読解なしで使えるべきだという原則が再提示された。
- 関連：AGENTS.md, .agents/skills/discord-harness/SKILL.md, .agents/skills/knowledge-runtime-ops/SKILL.md, implementation/src/harness/contracts.ts, implementation/src/harness/harness-runner.ts, implementation/src/discord/message-utils.ts, implementation/src/codex/mcp-config.ts, implementation/src/knowledge/runtime-ops.ts, implementation/src/discord/runtime-facts.ts
- 理由：「Harnessとは『モデルを包み、コンテキスト供給・ツール実行・制御・品質・観測を統合する外部構造』。目標は必要な情報を必要な瞬間に最小コストで届けること」
- 代替案：`knowledge-intent.ts` のような System heuristic を維持しつつ DB query shaping を続ける案。MCP server を増やして DB read や Discord facts 取得を肩代わりさせる案。
- 捨てた理由：前者は意味解釈の主導権が System に戻り、ユーザーが重視する境界原則に反する。後者はこの repo の runtime 前提を複雑化し、ローカル artifact と skill で完結する最小コスト経路より重い。
- 影響範囲：runtime contract からの precomputed retrieval 撤去、`knowledge_writes` への保存 handoff 統一、Discord facts artifact の導入、skills 有効化、今後の実装計画時のセルフチェック基準に影響する。
---
- 日時：2026-03-12T13:55:00+09:00
- 事項：Discord 実地検証の観測経路は Docker 直接参照ではなく、repo-local の runtime trace と Discord facts artifact を正本にする方針を採用した。
- 背景：今回のユーザー要求は、実際の Discord から知見保存と再検索が正しく動いているかを確認しつつ、「LLM が DB を直接触っていない」「skills と scripts を使って URL を復元している」ことまで証明できる観測が必要だった。一方で、この環境では Docker CLI の直接観測が安定せず、実行中 container の app-server 行動履歴をそのまま読む経路に依存すると検証が不安定になる。
- 関連：implementation/src/codex/app-server-client.ts, implementation/src/knowledge/knowledge-persistence-service.ts, implementation/src/observability/runtime-trace.ts, implementation/src/discord/runtime-facts.ts, .tmp/runtime-trace/, .tmp/discord-runtime/
- 理由：「Codex App Serverのログ(セッション行動履歴)をあなたが確認できる状態にしておいて」
- 代替案：Docker logs や container 内 stdout/stderr のみを観測経路にする案。
- 捨てた理由：実地検証の成否がホスト Docker 事情に引きずられ、repo 内から再現可能な証跡として残りにくい。runtime trace を repo-local に残した方が、Discord facts・knowledge persistence・Codex JSON-RPC の三者を同じ場所で突き合わせられる。
- 影響範囲：今後の Discord 実地検証では `.tmp/runtime-trace/codex-app-server.ndjson`、`.tmp/runtime-trace/knowledge-persistence.ndjson`、`.tmp/discord-runtime/*.json` を一次観測とする。Docker 直接観測は補助経路に下げる。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T16:10:00+09:00
- 事項：Codex thread の再利用単位を place-based key から versioned session identity へ切り替え、legacy `codex_session` は runtime から切り離す方針を採用した。
- 背景：Discord 実地検証で、`knowledge-runtime-ops` skill 自体は有効なのに、旧 chat thread を `thread/resume` した結果だけ stale な skill set を引きずり、同じ place の会話で必要な skill が見えない問題が発生した。原因は「返信先の場所」と「どの runtime contract / skill set / sandbox / model で作られた thread か」を place key に押し込んでいたことだった。
- 関連：BOT.01.04, BOT.01-08, THR.01-03-04, AUTH.03.07, AUTH.03-02-08, implementation/src/codex/session-policy.ts, implementation/src/codex/session-manager.ts, implementation/src/harness/harness-runner.ts, implementation/src/app/bot-app.ts, implementation/src/storage/database.ts, migrations/006_codex_session_binding_v1.sql
- 理由：「App Server側のセッションどれ使うかは、この先色んな機能を追加していくうえでもっと抽象レイヤーで管理しないとダメそう」
- 代替案：既存 `place_id -> codex_thread_id` を維持したまま、skill 変更時だけ resume 失敗を契機に新規 thread を切る案。workload ごとに ad-hoc な key 文字列を増やす案。legacy `codex_session` を自動移行して互換 resume する案。
- 捨てた理由：前者は stale thread を成功裏に resume してしまうケースを防げず、今回の不具合を再発させる。2 つ目は playground や AI news のような将来 workload を増やすたびに key 規約が散らばる。3 つ目は旧 binding に runtime contract/version の情報が無く、安全に resume 可否を判定できない。
- 影響範囲：session identity は `workload_kind + binding_kind + binding_id + actor_id + sandbox_mode + model_profile + runtime_contract_version + lifecycle_policy` を正本にする。`skills/changed` 通知は reusable session invalidation signal として扱い、同一 process 中でも stale binding を再利用しない。knowledge ingest で public thread を作成した後は、作成された thread conversation identity を同じ Codex thread に bind する。override 終了時の archive 対象も resolver/manager 経由で決める。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T16:20:00+09:00
- 事項：Codex thread の再利用単位を `place` から versioned `session identity` へ切り替え、旧 `codex_session` は legacy 扱いとして runtime から切り離す方針を採用した。
- 背景：Discord 実地検証で、同じ会話場所を再利用しているつもりでも、skill 追加後に古い Codex thread を `thread/resume` してしまい、新しい `knowledge-runtime-ops` がその thread からは見えない stale context が発生した。reply target の場所と、どの runtime contract / skills / sandbox / model で生まれた session かを place だけで一緒くたに持つ設計が限界だった。
- 関連：implementation/src/codex/session-policy.ts, implementation/src/codex/session-manager.ts, implementation/src/storage/database.ts, migrations/006_codex_session_binding_v1.sql, implementation/src/app/bot-app.ts, implementation/src/harness/harness-runner.ts, implementation/src/codex/app-server-client.ts
- 理由：「App Server側のセッションどれ使うかは、この先色んな機能を追加していくうえでもっと抽象レイヤーで管理しないとダメそう」
- 代替案：`place_id -> codex_thread_id` を維持しつつ、skills 更新時だけ手動で session を掃除する案。runtime contract hash を自動生成して hidden key に混ぜる案。
- 捨てた理由：前者は stale thread 再利用を運用手順に押し付けるだけで、今後追加する playground / AI news / ArXiv news のような workload 差分を吸収できない。後者は change boundary が不透明になり、いつ resume を切るかが人間に説明しづらい。

---
- 日時：2026-03-12T18:25:00+09:00
- 事項：T12 へ進む前に、T11 の capability gate と same-turn public reconfirmation の実装修正を先に完了させる方針を採用した。
- 背景：並列コードレビューで、`allow_knowledge_write` の factual gate 漏れ、`sources_used` に skill/script 風文字列を入れたときの境界抜け道、public reconfirmation の観測根拠が緩いことが見つかった。これらはどれも共有ハーネス層の安全境界に属し、未修正のまま T12 制裁や T14 失敗処理へ進むと downstream workload 全体へ不整合が波及する状態だった。
- 関連：implementation/src/harness/capability-resolver.ts, implementation/src/harness/output-safety-guard.ts, implementation/src/codex/app-server-client.ts, implementation/test/harness-runner.test.ts, implementation/test/output-safety-guard.test.ts, implementation/test/app-server-client.test.ts
- 理由：「次の機能実装を先に進めるべきではありません」「共有ハーネス層の安全境界と capability gate に関わるため」
- 代替案：T11 の欠陥を抱えたまま T12 制裁を先に進める案。T11 修正と T12 実装を同時並列に進める案。
- 捨てた理由：前者は不正な knowledge write や reconfirmation 観測が制裁ロジックへ流れ込み、誤判定の土台を広げる。後者は共有境界の修正と下流 feature 実装が同じファイル群で衝突し、レビューと切り分けが難しくなる。
- 影響範囲：今回は仕様変更ではなく実装修正として扱い、T11 の factual gate、source boundary、public reconfirmation 観測だけを正したうえで次の T12 へ進む。`sources_used` の許可根拠は record id と fetchable/reconfirmed public URL に限定し、reconfirmation は same-turn の authoritative command execution と構造化出力だけを根拠にする。
- 検証：pnpm typecheck; pnpm test
- 影響範囲：session identity は `workload_kind + binding_kind + binding_id + actor_id + sandbox_mode + model_profile + runtime_contract_version + lifecycle_policy` を正本にする。`skills/changed` は reusable session invalidation signal とする。knowledge ingest root から public thread を作った後は、その thread conversation identity を同じ Codex thread に bind する。旧 `codex_session` は `codex_session_legacy` へ退避し、新 runtime は resume に使わない。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T18:30:00+09:00
- 事項：T11 後続修正では、後方互換を残さず `intent -> answer -> optional retry` の 2 段階 turn と `task.retry_context` を正本にし、same-turn public reconfirmation は repo-local `public-source-fetch` skill の構造化出力だけを authoritative evidence とする方針を採用した。
- 背景：T11 初版の実装後、same-turn public reconfirmation が死んでいること、retry metadata が `available_context` に混ざって facts-only 原則を崩していること、knowledge thread 無言救済で System が意味解釈していること、`allow_external_fetch` / `allow_knowledge_write` が広すぎることが未解決として残った。さらにユーザーから「後方互換性は徹底して廃する」と明示された。
- 関連：AGENTS.md, implementation/src/harness/contracts.ts, implementation/src/harness/build-harness-request.ts, implementation/src/harness/harness-runner.ts, implementation/src/harness/capability-resolver.ts, implementation/src/harness/output-safety-guard.ts, implementation/src/codex/app-server-client.ts, implementation/src/knowledge/public-source-fetch.ts, .agents/skills/public-source-fetch/SKILL.md
- 理由：「same-turn public reconfirmation、retry metadata の置き場、Harness/System 境界の食い込み、capability の広さについても対処」「後方互換性は徹底して廃する」
- 代替案：`persist_items` や `available_context.output_safety` を残したまま新 contract を併存させる案。same-turn reconfirmation を model 自己申告や `sources_used` だけで認める案。knowledge thread 無言時に System が意味解釈付き fallback 文を返し続ける案。
- 捨てた理由：1 つ目は contract を二重化し、Harness と System の境界を曖昧にする。2 つ目は reconfirmation の authoritative evidence が崩れる。3 つ目は System が意味解釈を肩代わりしてしまい、境界原則に反する。
- 影響範囲：`available_context` は facts-only に固定され、retry 制御は `task.retry_context` に分離される。Harness は `intent` turn で必要 capability を宣言し、System は factual gate を通った `answer` turn にだけ付与する。same-turn public reconfirmation は `public-source-fetch` skill の成功出力から `observed_public_urls` を構成した場合だけ成立する。knowledge thread follow-up の無言救済は semantic fallback ではなく control-plane retry と generic failure に置き換わる。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T19:40:00+09:00
- 事項：T12 では violation の正本を Harness の `moderation_signal` に限定し、System は通常応答の後段で violation 記録・制裁評価・Discord 制裁実行・admin_control 通知だけを行う方針を採用した。
- 背景：T11 までで source boundary と capability gate は System facts に基づく薄い境界として整理できた。次の T12 では dangerous/prohibited の意味解釈まで TypeScript に戻さず、Harness が `intent` turn で危険判定し、System はその結果を append-only 監査ログと Discord 側の制裁へ変換するだけに留める必要があった。また、ユーザー体験としては current message の通常応答を潰さず、その後に sanction を適用する運用が自然だった。
- 関連：implementation/src/harness/contracts.ts, implementation/src/codex/app-server-client.ts, implementation/src/app/sanction-policy-service.ts, implementation/src/app/moderation-integration.ts, implementation/src/app/bot-app.ts, implementation/src/discord/moderation-executor.ts, migrations/007_sanction_v1.sql
- 理由：「Harness 主導の violation 記録と Discord 制裁」「current message の通常応答を潰さず、応答送信後に適用する」
- 代替案：blocked URL や output safety guard 違反も System 側で violation に加算する案。通常応答の前に sanction 判定を行い、該当 turn 自体を握りつぶす案。owner/admin や override suspension でも countable violation として扱う案。
- 捨てた理由：1 つ目は危険意味解釈を System に戻してしまい、境界原則に反する。2 つ目は利用者から見ると bot が無言で制裁だけ行う形になり UX が悪い。3 つ目は管理者検証や override 作業を制裁カウンタと混同してしまう。
- 影響範囲：`intent` turn の `moderation_signal` だけが violation 記録の根拠になる。owner/admin と `suspend_violation_counter_for_current_thread` は audit-only row を残し、countable threshold や sanction へ進まない。soft-block は guild-wide per user で preflight し、same channel で 12 時間通知抑制する。state change のみ admin_control へ JSON 通知する。
- 検証：pnpm typecheck; pnpm test

---
- 日時：2026-03-12T21:20:00+09:00
- 事項：T14 では失敗処理を Harness の semantic failure と System-owned runtime failure に分離し、retry は DB-backed scheduler と `message_processing = pending_retry` を正本にする方針を採用した。
- 背景：T11/T12 までで source boundary、capability gate、sanction の責務は整理できたが、失敗処理だけは permanent failure 通知と catch-all error handling に寄っており、再起動をまたぐ transient failure の再試行、cursor 停止条件、Harness `failure` の扱いが仕様上あいまいだった。ユーザー要求でも「失敗理由と再試行予定を出す形」が明示されており、semantic failure まで scheduler に載せると Harness/System 境界が崩れる状態だった。
- 関連：implementation/src/app/failure-classifier.ts, implementation/src/app/retry-scheduler-service.ts, implementation/src/app/bot-app.ts, implementation/src/app/replies.ts, implementation/src/storage/database.ts, migrations/008_retry_scheduler_v1.sql
- 理由：「DB 永続化された scheduler」「semantic Harness failure not retried」
- 代替案：runtime failure も semantic failure も同じ catch-all 経路で permanent failure に落とす案。in-memory timer だけで retry し、`message_processing` は従来どおり binary に保つ案。
- 捨てた理由：前者は transient failure の自動回復余地を失い、Harness が明示した user-facing failure まで infra retry に巻き込んでしまう。後者は再起動後に retry が継続せず、cursor と duplicate 判定も `pending_retry` を区別できない。
- 影響範囲：System-owned runtime failure は固定 public category へ分類し、transient failure だけを `5分 -> 30分 -> 2時間` の最大 3 回で再試行する。retry 中の message は `message_processing = pending_retry` に留まり、success または終端 failure まで completed にならない。Harness `outcome = failure` は semantic な終端結果として same place / same thread に返し、retry scheduler へ載せない。
- 検証：pnpm typecheck; pnpm test
## 2026-03-13: forum 長文対話、雑談間引き、週次告知の仕様を追加

- 事項：追加要求として、設定済み forum 親 channel 配下の post thread を高思考の長文対話場所として扱う `forum_longform`、雑談用デフォルトモードの 5 件間引き応答、毎週月曜 18:00 JST の AI 集会告知を正史仕様へ反映する方針を採用した。
- 背景：ユーザーから、high thinking を普段使えない参加者向けの長文対話場所、全発言反応だと使いにくい雑談モードの間引き、毎週の AI 集会告知が求められた。要求整理では、forum 初回入力変換は利用者に見せない、雑談の間引きは 5 回に 1 回、明示呼び出しではカウントをリセットしない、告知は JST 固定で当日 catch-up を許す、announcement channel でも auto publish はしない、という前提が確認された。
- 理由：Discord Forum は `GUILD_FORUM` 親 channel 直下では会話せず post が thread として扱われるため、会話場所は親 channel ではなく各 post thread として扱うのが自然だった。長文対話は session policy に `workload_kind=forum_longform` と `model_profile=forum:gpt-5.4:high` を追加し、初回だけ hidden preprocessing と別 `codex exec` 変換を挟む構成が、利用者へ完全 prompt を露出させずに要件を満たす。雑談の常時反応条件は `mention`、`reply to bot`、`?`、`？` の deterministic rule に固定し、意味解釈を System に戻さない。週次告知はローカル PC 常駐前提に合わせ、外部 scheduler を増やさず in-process scheduler と delivery 記録で足りる。
- 代替案：forum channel 自体を bot が新規作成する案。forum 初回入力をそのまま App Server に渡す案。雑談の疑問文判定を意味ベースで Harness に寄せる案。告知先が announcement channel の場合に auto publish まで行う案。
- 影響範囲：要件文書には `FOR.01`、`CHAT.02`、`EVT.01` の具体化を追加し、仕様差分には `forum_longform` watch mode、`forum_post_thread` place type、週次告知設定 `weekly_meetup_announcement`、`chat_channel_counter` と `scheduled_delivery` の DB state を追加する。実装タスク表では `T10` を雑談間引き込みへ広げ、`T10a Forum Longform` と `T10b Weekly Meetup Announcement` を追加する。
- 関連：Discord Forum/Threads 仕様は `GUILD_FORUM` が thread-only channel であること、親 channel ではなく post thread を会話単位に扱うことを前提にする。OpenAI reasoning は `reasoning.effort = high` を正本にする。

---
- 日時：2026-03-13T22:40:00+09:00
- 事項：`.codex` 会話履歴から抽出した境界逸脱と再発防止知見を、repo 固有の反省文ではなく汎用 `Agents Harness Boundary Patterns` reference として implementation 配下に追加する方針を採用した。
- 背景：実装とレビューの往復で、System が意味解釈や query shaping を持ち始める、facts と control plane が混ざる、source authority が弱い自己申告で成立してしまう、stale session を place 単位で再利用する、repo-local operational contract が不足して Harness が実装依存になる、といった失敗が繰り返し表面化した。これらはこの repo 固有の不具合ではなく、今後の Agents Harness 混在設計でも再発しやすい抽象パターンだった。
- 理由：境界原則は AGENTS に短く残っていたが、次の実装で再利用できる失敗パターンと代替パターンは別の Harness-facing reference として持つ方が有効だった。人間向けの経緯説明ではなく、LLM が直接読む operational memory として `Do / Avoid / Prefer / Smell` 形式に落とすことで、次の設計判断にそのまま使える。
- 代替案：repo 固有の postmortem 文書として追加する案。AGENTS.md へ長文で追記する案。
- 捨てた理由：前者は将来の Agents Harness 設計へ持ち回りにくく、後者は canonical rule と失敗パターン集が同居して AGENTS の役割を濁す。
- 影響範囲：`implementation/references/agents-harness-boundary-patterns.md` を追加し、`implementation/AGENTS.md` から導線を付ける。内容は `System は境界・権限・副作用・永続化・可視性だけを堅く持つ`、`Harness(LLM) は意味理解・探索方針・知見利用・応答生成の主役であるべき`、`System で仕組みを入れるのではなく、System の使い方を Harness で残す` を canonical phrasing として保持する。
