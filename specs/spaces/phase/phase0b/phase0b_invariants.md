# Phase 0b 結果

この文書は Phase 0b の中間成果物であり、final spec / slice / boundary を確定しない。
Phase 0a の UX sequence candidates は slice 境界として使わない。ここでは必要な場合に限り、誤って固定しないための警告としてのみ参照する。

実装観察は `specs/questions.md` の `Phase 0b Next Input` に列挙されたファイルに限定した。実装方式、内部 class 名、DB table 名、command 名、prompt 文言は正解として採用せず、ユーザー目的、観測された状態遷移、現設計の危険だけを抽出した。

## Blocking Issues

なし。

- 旧 Q1-Q5 / BI-01..BI-05 は `specs/questions.md` と Phase 0a の `Blocking Issues Reclassified` により、追加ユーザー質問ではなく実装観察で進める扱いになっている。
- `forum non-mention follow-up` は現行テスト側に ignore 保護の観察があり、別の古い test-design には non-empty follow-up 毎回応答の記述が残る。しかし今回の最新要求は forum follow-up は mention only 起動である。これは stale-doc risk / glossary correction candidate として扱い、Phase 1 を止める blocker にはしない。
- admin diagnostics / override は command 操作前提に更新済みであり、自然文 trigger list の確定は不要である。固定文言リストを正本にしない限り blocker ではない。

## Invariants Draft

### Feature Profile Is The Behavioral Source, Not Legacy Mode

- 条件: ユーザー向け機能の正本は Feature Profile / Place Feature / assignment であり、legacy `mode` は compatibility label または derived label として扱う。
- 適用範囲: Feature Profile、Place Feature、Discord Place、reply routing、admin diagnostics、forum research、knowledge ingest。
- 関連USDM: `USDM-02`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: channel / mode 基盤から feature assignment 基盤へ移る要求が壊れ、同じ place が二つの正本で異なる振る舞いを持つ。
- 典型違反: `features` ではなく `mode` だけで knowledge/admin/forum の可否を決める。legacy `mode` と feature policy の不一致を黙って許す。
- 観測可能な oracle: `features: ["knowledge_ingest"]` の place は URL sharing path になり、chat URL は通常会話に残る。`features: ["admin_override"]` の admin place だけ diagnostics / override gate が成立する。feature と legacy mode が矛盾する設定は新正本として受理されない。

### Place, Reply Target, And Persistence Scope Must Not Collapse

- 条件: 発話元 place、公開応答先 Reply Target、knowledge persistence scope、Codex/session binding は別概念として保持する。
- 適用範囲: Normal chat、URL watch root、knowledge thread follow-up、forum research thread、admin override thread、runtime failure recovery。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: 同じ場所に返すべき通常会話、public thread を作る URL ingest、same-thread follow-up、dedicated override thread が混線する。
- 典型違反: source message channel を reply target と同一視する。knowledge scope を reply thread id から推測する。forum parent channel と forum post thread を同一視する。
- 観測可能な oracle: chat root URL は thread を作らない。url_watch root URL は public thread を作り summary をそこへ送る。knowledge thread follow-up は same thread に visible reply を返す。failure recovery でも元の reply target と矛盾しない場所に成功または終端通知が出る。

### Knowledge Ingest Requires Eligible Public Grounding And Explicit Sharing Path

- 条件: knowledge ingest は、place-owned URL sharing または明示保存要求でのみ共有知見化し、公開根拠化されていない URL / blocked URL / private URL を保存根拠にしない。
- 適用範囲: Knowledge Ingest、Knowledge Thread、Persistence Boundary、public-source reconfirmation。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: 通常 chat の URL 会話が共有知見に混入し、公開可視性と保存根拠の意味が壊れる。
- 典型違反: chat root の URL だけで `server_public` write を作る。`sources_used` に未観測 URL を置く。knowledge thread follow-up を新規 ingest として扱う。
- 観測可能な oracle: url_watch root では public thread と knowledge write handoff が成立する。chat root URL では thread 作成も知見保存も起きない。knowledge thread follow-up は `chat_reply` として同じ thread に返り、既知 source を優先する。

### Safety-Before-Publish Precedes Every Public Final

- 条件: final public text は Discord send / thread publish / references appendix より前に、公開可能な根拠・安全・出力境界を満たす必要がある。
- 適用範囲: Forum Research Thread、Knowledge Ingest、normal chat reply with sources、Output Safety、Reply Dispatch。
- 関連USDM: `USDM-03`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: unsafe candidate が公開され、後段 retry/refusal では取り消せない公開漏えいになる。
- 典型違反: streaming final callback が safety 評価前に Discord へ送信する。未観測 source を含む public_text を一度 publish してから安全判定する。appendix を final より先に出す。
- 観測可能な oracle: unsafe public_text は fake Discord sink の送信履歴に現れない。安全 retry または refusal は元 reply target と矛盾しない場所に見える。forum final は same forum thread で安全通過後にだけ公開される。

### Forum Research Activation Is Starter-Or-Mention Only

- 条件: forum_research feature の forum post thread では starter message は起動対象、starter 後 follow-up は bot mention がある場合だけ起動対象、mention なし follow-up は ignore 対象である。
- 適用範囲: Forum Research Thread、Forum Starter Message、Forum Follow-Up、Chat Engagement、Reply Target。
- 関連USDM: `USDM-01`, `USDM-03`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: forum 内の通常会話へ bot が割り込み、または mention された follow-up が無視され、研究 thread の文脈保持が壊れる。
- 典型違反: 古い docs / characterization を根拠に non-mention follow-up を応答対象へ戻す。親 forum channel を通常会話 place として扱う。starter と follow-up を区別しない。
- 観測可能な oracle: starter には same forum thread で応答する。mentioned follow-up には same forum thread で文脈を保って応答する。non-mention follow-up では reply / processing reaction / visible retry が出ない。

### Admin Diagnostics Is Explicit, Admin-Scoped, And Non-Chat-Stealing

- 条件: admin diagnostics は admin_override/admin_control 相当の管理 place で、owner/admin の明示 diagnostics 要求または command 操作に限って成立する。通常の管理会話は chat_reply に残る。
- 適用範囲: Admin Diagnostics、Owner/Admin、Place Feature、Harness outcome、Reply Target。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: 通常の権限質問が diagnostics JSON へ誤分類される、または管理情報が非 admin place へ漏れる。
- 典型違反: TypeScript 側の固定語彙 trigger で diagnostics を決める。admin place 以外で diagnostics outcome を許す。admin command と通常会話を同じ入口にする。
- 観測可能な oracle: admin place の通常権限質問は自然文 chat reply。admin place の明示 diagnostics は同じ管理 place に diagnostics 形式で返る。同じ diagnostics 文言でも chat place では diagnostics にならない。

### Override Workspace-Write Is Contained To The Dedicated Thread And Same Actor

- 条件: workspace-write context は owner/admin が command 操作で開いた dedicated Admin Override Thread のみで有効であり、開始 actor と同じ actor の turn に限定される。終了後は再利用できない。
- 適用範囲: Admin Override Thread、Owner/Admin、Codex session identity、Persistence Boundary、Reply Target。
- 関連USDM: `USDM-01`, `USDM-04`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: repo write 権限が元 place、通常会話、別 actor、終了済み thread へ漏れる。
- 典型違反: 自然文の repo 改変要求をその場で workspace-write に昇格する。origin place を write context にする。TTL 終了を正本にする。別 actor の turn で同じ write session を使う。
- 観測可能な oracle: override-start は configured admin_override root 配下に dedicated thread を作り、origin place には導線だけ返る。同じ actor の dedicated thread turn だけ workspace-write になる。override-end は session を閉じ、thread archive 後は active override として扱われない。

### Thread Cursor Is Monotonic Across Retry, Duplicate, And Recovery

- 条件: thread / channel の観測進捗は後戻りせず、pending retry / processing duplicate は visible cursor を先へ進めない。completed duplicate は現在 cursor より新しいときだけ進めてよい。
- 適用範囲: Thread Cursor、Runtime Failure Recovery、Message Processing、Retry Job、Knowledge Thread、Forum Research Thread。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: 処理中 message が飛ばされる、完了済み message が再投稿される、failure が無言で完了扱いになる。
- 典型違反: `pending_retry` を completed と同じ扱いで cursor advance する。古い duplicate で cursor を巻き戻す。retry 後に reply target を再計算して別 place へ返す。
- 観測可能な oracle: pending retry duplicate では cursor が既存値のまま。古い completed duplicate では cursor が戻らない。新しい completed duplicate では cursor がその message まで進む。terminal failure は元 target と矛盾しない visible notification を持つ。

### Storage Round-Trip Preserves User-Visible Meaning, Not Table Shapes

- 条件: 再起動、reopen、migration 後も、knowledge visibility、source link、thread binding、session identity、override session、retry job、forum progress のユーザー向け意味が保持される。
- 適用範囲: Persistence Boundary、Storage Round-Trip、Migration Preservation、Knowledge Ingest、Admin Override Thread、Forum Research Thread、Thread Cursor。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 破ると壊れる意味: 保存済み知見が見えなくなる、private / conversation-only が public に漏れる、旧 session が新 runtime binding として誤再利用される、forum progress / retry が失われる。
- 典型違反: DB table 名や migration 番号を仕様正本にする。legacy `codex_session` を新 runtime session として resume する。visibility key の欠落を silent loss にする。
- 観測可能な oracle: reopen 後に public contract rows が等価に読める。legacy knowledge rows は drop されず compatibility visibility または quarantine を持つ。legacy session は legacy 隔離され、新 runtime binding に誤 reuse されない。retry / forum progress rows は pending user-visible recovery を失わない。

### Facts Plane And Control Plane Stay Separated

- 条件: `available_context` は place、features、thread、known source、recent events など facts-only に保つ。`task.phase`、`task.retry_context`、budgets、retry/safety regeneration は control plane として分離する。
- 適用範囲: HarnessRequest、Codex App Server contract、Output Safety retry、knowledge follow-up non-silent retry、forum recovery。
- 関連USDM: `USDM-05`, `USDM-06`
- 破ると壊れる意味: Harness が user-visible facts と retry 指示を混同し、ユーザー入力として retry metadata を解釈する。
- 典型違反: `available_context` に retry_count や safety regeneration instruction を混ぜる。System が no_reply の意味を quality heuristic で決める。timeout を terminal semantic failure と扱う。
- 観測可能な oracle: retry turn では `task.retry_context` にだけ retry metadata が存在し、`available_context` に retry/control fields がない。knowledge follow-up no-reply retry は same-thread visible reply を作るが、retry_context をユーザー本文として扱わない。

## Dynamic State-Owner Candidates

以下は Phase 1 へ渡す候補であり、state-owner boundary として採用済みではない。

### Place Capability Assignment

- 守る不変条件: Feature Profile Is The Behavioral Source, Not Legacy Mode
- なぜ状態所有者候補か: 設定読み込み、legacy compatibility、assignment persistence、migration をまたいで place の有効 feature が変化しうる。複数 routing 判断が同じ feature state を参照する。
- 状態相の兆候: unassigned / assigned by profile / legacy-compatible / invalid mismatch / persisted and reopened.
- command の兆候: load config、sync assignment、migrate legacy location、resolve place features。
- invalid command policy の兆候: unknown profile、duplicate assignment、multiple primary feature、legacy mode/features mismatch は受理しないか compatibility として隔離する必要がある。
- 根拠USDM: `USDM-02`, `USDM-05`, `USDM-06`
- 確度: 高

### Reply Target Resolution

- 守る不変条件: Place, Reply Target, And Persistence Scope Must Not Collapse; Safety-Before-Publish Precedes Every Public Final
- なぜ状態所有者候補か: same place、created public thread、existing knowledge thread、same forum thread、no reply、admin override thread 導線が、message origin と outcome によって変わる。failure/retry 後も最初の target 意味を保つ必要がある。
- 状態相の兆候: unresolved / same-place / create-public-thread-pending / created-thread-bound / existing-thread-bound / no-reply / failed-notified.
- command の兆候: route reply、create public thread、send reply、retry dispatch、terminal failure notify。
- invalid command policy の兆候: chat URL で public thread を作らない。knowledge follow-up を root へ返さない。safety 未通過の final を send しない。
- 根拠USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 確度: 中

### Knowledge Thread Binding

- 守る不変条件: Knowledge Ingest Requires Eligible Public Grounding And Explicit Sharing Path; Place, Reply Target, And Persistence Scope Must Not Collapse
- なぜ状態所有者候補か: root URL ingest で source message / knowledge record / reply thread が結び付き、follow-up は同じ thread と known sources を参照する。保存と reply routing をまたぐ identity を一箇所で守る必要がある。
- 状態相の兆候: no binding / ingest accepted / thread created / source linked / follow-up active / binding missing or stale.
- command の兆候: create or reuse public thread、insert knowledge write handoff、link source message、answer follow-up。
- invalid command policy の兆候: blocked/private/unobserved URL を binding 根拠にしない。knowledge thread follow-up で新規 ingest にしない。root URL ingest と normal chat URL を混同しない。
- 根拠USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 確度: 高

### Forum Research Thread Progress

- 守る不変条件: Forum Research Activation Is Starter-Or-Mention Only; Safety-Before-Publish Precedes Every Public Final; Thread Cursor Is Monotonic Across Retry, Duplicate, And Recovery
- なぜ状態所有者候補か: starter、mentioned follow-up、research progress、evidence/source catalog、final safety、visible recovery が同じ forum thread identity に連続する。
- 状態相の兆候: starter pending / research in progress / candidate produced / safety pending / published / retry visible / terminal failure visible / ignored non-mention.
- command の兆候: accept starter、accept mentioned follow-up、ignore non-mention、refine prompt、advance evidence/progress、evaluate safety、publish final/refusal。
- invalid command policy の兆候: non-mention follow-up を起動しない。parent forum channel に返さない。unsafe candidate を publish しない。duplicate/retry で cursor を戻さない。
- 根拠USDM: `USDM-01`, `USDM-03`, `USDM-05`, `USDM-06`
- 確度: 高

### Admin Override Thread Lifecycle

- 守る不変条件: Override Workspace-Write Is Contained To The Dedicated Thread And Same Actor; Storage Round-Trip Preserves User-Visible Meaning, Not Table Shapes
- なぜ状態所有者候補か: start/use/end/archive の lifecycle が workspace-write の可否を決め、actor identity と dedicated thread identity をまたいで保存される。
- 状態相の兆候: no active override / start requested / dedicated thread created / active for same actor / end requested / ended archived / stale or wrong actor.
- command の兆候: override-start、bootstrap prompt handoff、resolve active override、override-end、archive session/thread。
- invalid command policy の兆候: non-owner/admin reject、no configured admin_override root reject、wrong actor reject、outside dedicated thread reject、ended thread reject。
- 根拠USDM: `USDM-01`, `USDM-04`, `USDM-05`, `USDM-06`
- 確度: 高

### Thread Cursor And Retry Progress

- 守る不変条件: Thread Cursor Is Monotonic Across Retry, Duplicate, And Recovery; Facts Plane And Control Plane Stay Separated
- なぜ状態所有者候補か: acquired / processing / pending retry / completed / terminal failure の進捗が、startup recovery、duplicate detection、retry job、visible notification にまたがる。
- 状態相の兆候: unseen / acquired / processing / pending_retry / completed / terminal_failure_notified.
- command の兆候: try acquire、mark pending retry、schedule retry、mark completed、notify terminal failure、advance cursor。
- invalid command policy の兆候: pending retry duplicate は cursor advance しない。old completed duplicate は rewind しない。retry metadata を user facts に混ぜない。
- 根拠USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 確度: 高

### Persistence Boundary Registry

- 守る不変条件: Storage Round-Trip Preserves User-Visible Meaning, Not Table Shapes; Knowledge Ingest Requires Eligible Public Grounding And Explicit Sharing Path
- なぜ状態所有者候補か: knowledge visibility、thread binding、session identity、override session、retry job、forum progress が保存・reopen・migration をまたいで一貫した public contract を保つ必要がある。
- 状態相の兆候: transient only / persisted / reopened equivalent / migrated compatible / quarantined legacy / stale unsafe.
- command の兆候: write public contract row、read visible record、migrate legacy row、isolate legacy session、preserve retry/forum state。
- invalid command policy の兆候: legacy rows を silent drop しない。legacy session を新 runtime binding として誤 reuse しない。visibility key なしの public leakage を許さない。
- 根拠USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 確度: 中

### Admin Diagnostics Gate

- 守る不変条件: Admin Diagnostics Is Explicit, Admin-Scoped, And Non-Chat-Stealing; Facts Plane And Control Plane Stay Separated
- なぜ状態所有者候補か: 状態相は薄いが、accepted/rejected/normal-chat の invalid command policy が外部観測と管理情報漏えいを決める。
- 状態相の兆候: normal admin chat / explicit diagnostics requested / accepted diagnostics / rejected outside admin place.
- command の兆候: classify explicit diagnostics request、return diagnostics、return normal chat。
- invalid command policy の兆候: admin place 外では diagnostics 不成立。通常権限質問は diagnostics JSON にしない。固定文言だけを System 正本にしない。
- 根拠USDM: `USDM-01`, `USDM-05`, `USDM-06`
- 確度: 中

## Glossary Correction Candidates

### Non-blocking Addition / Clarification

#### `mode`

- 補正候補: `mode` は legacy compatibility / derived label と明記する。新しい機能意味の正本ではない。
- 理由: Phase 0a glossary の方向性は妥当だが、後続実装者が `mode` を primary routing key に戻す危険が高い。
- 関連USDM: `USDM-02`, `USDM-06`

#### `features` / `PlaceFeature`

- 補正候補: `features` は place に割り当てられた user-facing capability set。`PlaceFeature` は feature literal 単体ではなく、assignment / profile / place と結合して観測意味を持つ、と明確化する。
- 理由: `features` を単なる flags と見ると primary feature の排他性、secondary feature、legacy mode との整合が抜ける。
- 関連USDM: `USDM-02`, `USDM-05`, `USDM-06`

#### `Forum Research Thread`

- 補正候補: starter は mention 不要、starter 後 follow-up は mention only 起動、non-mention follow-up は ignore と明記する。古い docs の「non-empty follow-up 毎回応答」記述は stale-doc risk として隔離する。
- 理由: 最新要求は mention only 起動であり、これだけで blocker にはしないが、後続 Phase で古い docs を正本として採用すると forum 体験が衝突する。
- 関連USDM: `USDM-03`, `USDM-05`, `USDM-06`

#### `Admin Override Thread`

- 補正候補: dedicated override thread は command 起動で作られ、workspace-write を許可する唯一の場所候補である。origin place は導線元であり write context 所有者ではない。
- 理由: 自然文 repo 改変要求の即時 workspace-write 昇格を防ぎ、同一 actor / end / archive の lifecycle を Phase 1 で扱えるようにする。
- 関連USDM: `USDM-04`, `USDM-05`, `USDM-06`

#### `Persistence Boundary`

- 補正候補: DB schema ではなく、再起動・reopen・migration をまたいで維持されるユーザー向け保存意味の境界と定義する。knowledge write handoff と DB 保存完了は分ける。
- 理由: table 名や migration 番号を正本化すると実装詳細テストになり、逆に保存意味を狭めると follow-up / override / retry / forum progress が壊れる。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`

#### `Thread Cursor`

- 補正候補: cursor は内部 DB row 名ではなく、message 処理の観測上の進捗境界と定義する。pending retry、completed、terminal failure visible の違いを Phase 1 で精緻化する。
- 理由: cursor を仕様外にすると duplicate / retry / recovery の black-box oracle がなくなる。一方で内部 state 名の正本化も避ける必要がある。
- 関連USDM: `USDM-01`, `USDM-05`, `USDM-06`

#### `Safety-Before-Publish`

- 補正候補: `final` は公開候補であって、Discord publish 済み本文ではないと明確化する。publish は safety 通過後の side effect として扱う。
- 理由: `final` と `publish` が曖昧だと、streaming final や references appendix が safety より先に出る違反を検出できない。
- 関連USDM: `USDM-03`, `USDM-05`, `USDM-06`

### Blocking Split / Contradiction

なし。

- `forum non-mention follow-up` に関する古い docs との衝突は、今回の最新要求で解消可能な stale-doc risk として扱う。Phase 1 は最新要求の mention only 起動を優先し、古い approval evidence 記述を boundary 正本にしないこと。

## Implementation Observation Notes

### Observation Scope

- 読んだ入力: `specs/spaces/phase/phase0a/phase0a_inventory.md` の `USDM-01`..`USDM-07` と `## Glossary Draft`、`specs/questions.md`、Phase 0a の `Blocking Issues Reclassified` / `Phase 0b Next Input`。
- 読んだ override layer: `implementation/AGENTS.md`、`implementation/references/agents-harness-boundary-patterns.md`。
- 読んだ実装観察対象: `implementation/test/e2e/discord-behavior-preservation.test.ts`、`implementation/test/integration/cursor-retry-monotonicity.test.ts`、`implementation/test/integration/storage-roundtrip.test.ts`、`implementation/test/integration/migration-preservation.test.ts`、`implementation/src/runtime/admin/admin-command-service.ts`、`implementation/src/codex/app-server-client.ts`、`implementation/test-design/behavior-preservation-test-design.md`。

### Boundary Gate Working Notes

| Requirement | Owner | Why not the other side |
| --- | --- | --- |
| Discord send/reply/thread creation/archive order | System boundary | Harness may choose outcome and wording, but side effects, authority, and exact Discord target mechanics are operational boundaries. |
| User intent, retrieval strategy, source choice, public wording, ignore/chat/ingest/admin outcome meaning | Harness contract | Encoding meaning in TypeScript would steal semantic responsibility and reintroduce mode/channel heuristics. |
| `task.phase`, retry metadata, safety retry, non-silent retry | Control plane | These coordinate execution and must not appear as user-visible facts. |
| `available_context` place, features, thread kind, known sources, recent events | Facts plane | These are facts supplied to Harness and must not contain hidden control instructions. |
| DB durability, cursor monotonicity, migration preservation, override session integrity | System boundary | Persistence integrity and idempotency are operational correctness, not model judgment. |

Stop-trigger note: timeout, truncation, forced fallback, semantic retry, quality gating, and routing by legacy mode are not adopted as Phase 0b invariants. If future implementation changes touch them, boundary review must run again.

### Extracted Purpose And Behavior

- E2E behavior preservation shows desired external oracles: URL watch root creates exactly one public knowledge thread; chat URL remains same-place conversation; knowledge thread no-reply/ignore becomes same-thread visible retry; unsafe output is not published before refusal/retry; admin diagnostics is explicit and admin-place scoped; forum streaming final is not sent before safety and dispatch.
- Cursor retry integration shows user-visible progress must be monotonic: pending retry duplicate does not advance cursor; old completed duplicate does not rewind; newer completed duplicate may advance.
- Storage round-trip integration shows preservation targets are public contract meanings: place capabilities, Codex session identity, knowledge visibility, source artifacts/text, source links, retry job, forum research progress, override session.
- Migration preservation shows legacy rows must not be silently dropped, pending visible retry must survive table rebuild, forum v1 progress must preserve enough continuation payload, and legacy Codex sessions must remain isolated from new runtime bindings.
- Admin command service observation shows override start checks owner/admin and configured admin_override root, creates dedicated thread, records same actor workspace-write session, can bootstrap an initial prompt into that thread, and override end requires the same actor inside the dedicated thread before ending and archiving.
- App server client instructions show the Harness contract already states feature capabilities should be preferred over legacy mode, admin diagnostics should be explicit/admin-scoped, knowledge thread follow-up should not be silent, `ignore` is model-owned, and active override same-actor thread has workspace-write context. These are observed as contract direction, not final spec wording.
- Test-design notes contain a stale-doc conflict around forum non-mention follow-up. Latest user requirement overrides it: mention only起動を優先し、古い記述は non-blocking stale-doc risk とする。

### Not Adopted As Specification

- Slash command names such as `/override-start` and `/override-end` are not adopted as final UI contract names in Phase 0b.
- DB table names, repository method names, internal states such as `pending_retry`, and migration numbers are not adopted as final glossary terms.
- Exact Harness developer instruction wording is not adopted as final spec text.
- Existing UX sequence candidates are not adopted as final slice boundaries.

## Phase 1への申し送り

- Blocking split/contradiction はないため、Phase 1 は開始可能。
- 優先的に精緻化すべき動的候補: `Admin Override Thread Lifecycle`、`Forum Research Thread Progress`、`Thread Cursor And Retry Progress`、`Knowledge Thread Binding`、`Place Capability Assignment`。
- 薄い state-owner 候補として検査すべきもの: `Reply Target Resolution`、`Admin Diagnostics Gate`、`Persistence Boundary Registry`。状態相が少なくても invalid command policy / identity / idempotency が外部観測に出る。
- state-owner ではなく Policy/Profile/Data Entity に見える候補: `Owner/Admin` は actor eligibility policy に見える。`Feature Profile` 単体は profile data に見えるが、assignment と migration を含むと state-owner 候補になる。`Safety-Before-Publish` 単体は gate/policy に見えるが、publication pending と retry/refusal を含める場合は Reply Target / Forum Progress 側へ吸収されうる。
- Phase 1 で誤って固定しないこと: Phase 0a の UX sequence candidates を slice 境界にしない。forum non-mention follow-up の古い docs を正本にしない。実装内部名を State/Command/Event 名として確定しない。
