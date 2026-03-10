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
