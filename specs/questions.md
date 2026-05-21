# Phase 0a Reclassified Observation Items

Phase 0a の Blocking Questions は、ユーザー回答により「ユーザーへ再質問する未回答 blocker」ではなくなった。
後続 Phase 0b では、実装そのものを正解として採用せず、実装観察から `ユーザー目的`、`観測された状態遷移`、`現設計の悪さ/危険` だけを抽出する。

## Q-01: forum final safety-before-publish acceptance

- ID: `Q-01`
- 旧関連 Blocking Issue: `BI-01`
- 再分類: user answered / no longer blocks Phase 0b
- ユーザー回答の扱い: 旧 Q-01 は何を問うているか不明だったため、ユーザー質問として閉じる。Phase 0b では `forum final` の語の範囲を再質問せず、受入条件を具体化する。
- ユーザー目的: forum research の starter 応答と mentioned follow-up 応答が、公開前に安全・根拠・出力境界を満たし、利用者へ危険な final が見えないこと。
- 観測された状態遷移として扱うもの: forum input accepted -> answer/final candidate produced -> safety-before-publish evaluated -> safe final published, or unsafe candidate withheld -> retry/refusal visible in the same forum thread.
- 現設計の悪さ/危険: `final`、`publish`、`appendix` の境界が曖昧なまま実装詳細へ寄せると、Discord send が safety より先に発火しても仕様違反として検出できない。
- Phase 0b への渡し方: `Safety-Before-Publish` と `Forum Research Thread` の invariant 候補として扱う。ユーザー質問は不要。

## Q-02: admin diagnostics / override は command 操作前提

- ID: `Q-02`
- 旧関連 Blocking Issue: `BI-02`
- 再分類: user answered / implementation-observation required / no longer blocks Phase 0b
- ユーザー回答の扱い: admin diagnostics / override は自然文トリガー文言ではなく、管理用 command 操作を前提に再解釈する。
- ユーザー目的: 管理者が明示的に診断または override 操作をしたときだけ管理用応答・workspace-write 導線が開き、通常の管理会話は自然文 chat_reply に残ること。
- 観測された状態遷移として扱うもの: admin command received -> owner/admin and place capability checked -> diagnostics or override action accepted/rejected -> same management place or dedicated override threadに結果が返る。
- 現設計の悪さ/危険: 自然文の語彙リストを正本にすると Harness が担う意味判断を System 側の固定 trigger に寄せやすく、通常会話が diagnostics JSON に誤分類される。
- Phase 0b への渡し方: `Admin Diagnostics` と `Admin Override Thread` の accepted command / rejected command / normal chat invariant を実装観察から抽出する。

## Q-03: forum recovery / thread cursor は実装観察から外部状態だけを抽出

- ID: `Q-03`
- 旧関連 Blocking Issue: `BI-03`
- 再分類: implementation-observation required / no longer blocks Phase 0b
- ユーザー回答の扱い: 実装があるため、内部方式ではなく目的・行動・状態遷移のみを抽出する。
- ユーザー目的: forum starter / mentioned follow-up の処理が失敗や retry を挟んでも、利用者からは同じ forum thread 内で進行、成功、または終端失敗が追えること。
- 観測された状態遷移として扱うもの: message accepted -> processing/retry pending -> completed reply, or terminal failure notification; duplicate or retry input must not move the observable cursor backward.
- 現設計の悪さ/危険: `pending_retry` などの内部名を仕様状態として採用すると DB 実装詳細へ固定される。一方で cursor を仕様外にすると、重複応答、無言失敗、reply target 逸脱を black-box に守れない。
- Phase 0b への渡し方: `Thread Cursor` と `Runtime Failure Recovery` の invariant 候補として、外部観測可能な進捗単位だけを読む。

## Q-04: storage round-trip / migration preservation は保存意味を抽出

- ID: `Q-04`
- 旧関連 Blocking Issue: `BI-04`
- 再分類: implementation-observation required / no longer blocks Phase 0b
- ユーザー回答の扱い: 実装があるため、採用対象は DB schema ではなく、再起動・再読込・migration 後に維持されるべきユーザー向け意味に限る。
- ユーザー目的: 知見、可視性、thread binding、session identity、override session、retry / forum progress が、再起動や migration 後にも利用者から同じ機能として観測できること。
- 観測された状態遷移として扱うもの: persisted state written -> process closed/reopened or migrated -> equivalent public contract rows readable -> reply routing / visibility / active session meaning preserved.
- 現設計の悪さ/危険: 保存対象を DB table 名で確定すると実装詳細テストになる。逆に knowledge record だけへ狭めると、thread follow-up、override write boundary、retry recovery の継続性が壊れる。
- Phase 0b への渡し方: `Persistence Boundary`、`Storage Round-Trip`、`Migration Preservation` の invariant 候補として、保存意味と visibility / identity / lifecycle の関係を読む。

## Q-05: admin override 起動 UI は command から dedicated thread への遷移として読む

- ID: `Q-05`
- 旧関連 Blocking Issue: `BI-05`
- 再分類: user answered / implementation-observation required / no longer blocks Phase 0b
- ユーザー回答の扱い: owner/admin は自然文だけでなく command 操作を前提に dedicated override thread を起動する。実装から目的・行動・状態遷移のみを抽出し、具体 command 名や内部 bootstrap 方式は最終仕様へ採用しない。
- ユーザー目的: 元 place から管理者が明示操作し、repo 改変可能な workspace-write context を通常会話へ漏らさず、dedicated override thread にだけ閉じ込めること。
- 観測された状態遷移として扱うもの: command at allowed origin -> owner/admin accepted -> dedicated override thread created under configured admin_override root -> same actor gains workspace-write only in that thread -> end command closes session and archives thread.
- 現設計の悪さ/危険: 自然文 repo 改変要求をその場で workspace-write に昇格すると境界違反になる。逆に command UI の実装方式を正本化すると、ユーザー目的である write scope containment より操作細部が強くなる。
- Phase 0b への渡し方: `Admin Override Thread` の start/use/end lifecycle と invalid command policy の観察対象として扱う。

## Phase 0b Next Input

SubAgent はユーザーへ追加質問せず、以下を実装観察対象として読む。

- `implementation/test/e2e/discord-behavior-preservation.test.ts`: safety-before-publish、admin diagnostics gate、forum publish 前安全、knowledge thread follow-up の外部観測。
- `implementation/test/integration/cursor-retry-monotonicity.test.ts`: retry / duplicate / cursor の外部進捗境界。
- `implementation/test/integration/storage-roundtrip.test.ts`: reopen 後に維持される public contract rows と保存意味。
- `implementation/test/integration/migration-preservation.test.ts`: legacy data が migration 後に落ちないこと、旧 session が新 runtime binding に誤 reuse されないこと。
- `implementation/src/runtime/admin/admin-command-service.ts`: admin override command の許可条件、dedicated thread 作成、同一 actor、終了と archive の観測行動。
- `implementation/src/codex/app-server-client.ts`: admin diagnostics と normal admin chat の Harness contract 文言。ただし文言そのものは仕様正本にしない。
- `implementation/test-design/behavior-preservation-test-design.md`: 既存テスト設計上の目的、禁止体験、危険の整理。
