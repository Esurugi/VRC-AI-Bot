# Phase 3 結果

この文書は Phase 3 の中間レビュー成果物であり、最終 `shared/`、`slices/`、`boundaries/` 本文を生成しない。Phase 2 の分類結果を、採用する state-owner boundary、親へ吸収する状態片、外側責務、slice/shared への投影材料へ整理する。

## Summary

- Phase 2 の C1 維持候補 5 件は、いずれも外側責務を取り除いた後にも state-owner として残るため C1 として採用する。
- C1候補数の変化: 5 -> 5。
- 維持: 5 件。`Place Capability Assignment`, `Knowledge Thread Binding`, `Forum Research Thread Progress`, `Admin Override Thread Lifecycle`, `Thread Cursor And Retry Progress`。
- C1/C2再配置: 2 件。`Reply Target Resolution state fragments`, `Persistence Boundary Registry state fragments` は親 boundary と shared invariant へ吸収する。
- 格下げ/外側責務維持: 4 件。`Admin Diagnostics Gate`, `Safety-Before-Publish`, `Feature Profile`, `Owner/Admin Eligibility` は C1 にしない。
- 分割: 8 系統。Phase 2 の split candidates は維持し、state-owner、policy、application service、effect、record、migration へ分けて投影する。
- boundary化するstate-owner数: 5。
- blocking issueの有無: なし。

## Adopted State-owner Boundaries

### Place Capability Assignment
- 元分類: C1 State-transition boundary candidate
- アクション: 維持
- 新分類: C1-thin State-transition boundary
- 理由: `USDM-02`, `USDM-05`, `USDM-06` の中心は channel / legacy `mode` ではなく、Feature Profile / Place Feature を Discord place へ割り当てることにある。未割当、割当済み、legacy 互換由来、不整合隔離の状態相が、同じ place への routing / capability 解決 Command の結果を変える。Feature Profile 定義や設定 I/O を外へ出しても、重複割当、primary feature 多重、legacy mode 二重正本化を拒否する否定権が残る。
- 移行先/統合先: なし
- 分割案: Feature Profile 定義は C7、設定読み込み手順は C8、migration / compatibility batch は C11、保存 record は C14 へ分割する。
- Boundary契約材料:
  - State: `unassigned`, `assigned(profile_id, place_features, primary_feature)`, `legacy_mapped(legacy_mode, derived_place_features)`, `invalid_isolated(reason)`.
  - Command: `LoadPlaceAssignments`, `ApplyLegacyCompatibility`, `ResolvePlaceCapabilities`, `RejectInvalidAssignment`.
  - Transition: valid assignment は `unassigned -> assigned`。legacy input は互換変換後に `legacy_mapped -> assigned` 相当として解決されるが、legacy `mode` を正本に戻さない。duplicate place assignment、primary feature 多重、feature policy と legacy mode の矛盾は `invalid_isolated` または rejection になり、capability 解決に使わない。
  - Event: `PlaceCapabilitiesAssigned`, `LegacyAssignmentMapped`, `PlaceAssignmentRejected`, `PlaceCapabilitiesResolved`.
  - Invalid command policy: `invalid_isolated` の place は通常 chat / knowledge / forum / admin routing の根拠にしない。Discord channel identity や legacy `mode` だけで feature を決定してはいけない。
  - Deterministic Context: 設定入力、legacy migration 入力、既存 assignment record、allowed feature literals。
- 関連slice材料: Feature Profile Assignment Loads A Place、Legacy Watch Location Remains Compatibility Only、全 routing 系 slice の前提。
- Shared invariant材料: Place の機能意味は PlaceFeature / feature profile assignment が正本であり、`mode` は互換・派生ラベルに留める。
- Phase 0b外候補の妥当性: 該当なし
- Questions: なし
- 確度: 確定

### Knowledge Thread Binding
- 元分類: C1 State-transition boundary candidate
- アクション: 維持
- 新分類: C1-thin State-transition boundary
- 理由: public fetch、要約、Discord thread 作成、DB write を外へ出しても、source message / public source / knowledge record / public thread / known sources の結合状態が root URL ingest と knowledge thread follow-up の受理可否を変える。active binding では same thread reply と known source 優先が観測仕様になり、blocked/private/根拠化不能 URL は binding 根拠にできない。
- 移行先/統合先: なし
- 分割案: public source fetch は C10、要約と保存意図生成は Harness contract / C8、Discord thread 作成は C9、record persistence は C14 へ分割する。
- Boundary契約材料:
  - State: `no_binding`, `ingest_accepted(source_message, eligible_sources)`, `thread_created(thread_id)`, `source_linked(knowledge_record_id, known_source_urls)`, `follow_up_active`, `missing_or_stale(reason)`.
  - Command: `AcceptRootUrlIngest`, `AttachPublicThread`, `LinkKnowledgeRecord`, `ResolveKnowledgeFollowUp`, `MarkBindingStale`.
  - Transition: eligible public source を持つ root ingest は `no_binding -> ingest_accepted -> thread_created -> source_linked/follow_up_active`。既存 binding がある duplicate ingest は新規 thread 乱立ではなく既存 binding 再利用候補になる。knowledge thread follow-up は active binding からのみ known source 優先文脈を得る。blocked/private/根拠化不能 URL は binding 作成に進めない。
  - Event: `KnowledgeIngestAccepted`, `KnowledgeThreadBound`, `KnowledgeSourcesLinked`, `KnowledgeFollowUpContextResolved`, `KnowledgeBindingRejected`, `KnowledgeBindingMarkedStale`.
  - Invalid command policy: 通常 chat の URL は明示保存または URL watch root ingest でない限り binding を作らない。`blocked_urls`、private URL、same-turn public reconfirmation のない URL は保存根拠にしない。stale binding から known source を捏造しない。
  - Deterministic Context: place capability、source eligibility、public fetch result、existing binding lookup result、known source URL set、persistence result as fact。
- 関連slice材料: URL Watch Knowledge Ingest Creates Or Reuses Public Thread、Natural Language Knowledge Save Request、Knowledge Thread Follow-Up Uses Known Sources。
- Shared invariant材料: public source eligibility、knowledge visibility `server_public`、normal URL chat は自動保存しない、known source priority。
- Phase 0b外候補の妥当性: 該当なし
- Questions: なし
- 確度: 確定

### Forum Research Thread Progress
- 元分類: C1 State-transition boundary candidate
- アクション: 維持
- 新分類: C1 State-transition boundary
- 理由: generation、source appendix、safety 判定、Discord publish、retry scheduling を外へ出しても、forum research thread 内の starter / mentioned follow-up / non-mention follow-up の起動可否と、final candidate の publish 可否を変える進捗状態が残る。`Safety-Before-Publish` は単体 C1 ではなく、この boundary と reply dispatch へ投影される policy / gate として扱う。
- 移行先/統合先: なし
- 分割案: safety-before-publish は C6/C12、生成と appendix は Harness contract / C8、Discord publish は C9、retry execution は C13、progress record は C14 へ分割する。
- Boundary契約材料:
  - State: `thread_ready(starter_message_id)`, `starter_processing`, `follow_up_processing(message_id)`, `candidate_produced`, `safety_pending`, `published(message_id, reply_target)`, `retry_visible`, `terminal_failure_visible`, `non_mention_ignored`.
  - Command: `AcceptForumStarter`, `AcceptMentionedFollowUp`, `IgnoreNonMentionFollowUp`, `SubmitFinalCandidateForSafety`, `PublishSafeForumReply`, `WithholdUnsafeCandidate`, `MarkForumRetryVisible`, `MarkForumTerminalFailure`.
  - Transition: starter message は mention なしで `thread_ready -> starter_processing` へ進める。starter 以外は bot mention がある場合だけ `follow_up_processing` へ進める。non-mention follow-up は `non_mention_ignored` event で終わり、処理中リアクションや reply を出さない。candidate は `safety_pending` を通過し、safe result だけが `published` へ進む。unsafe candidate は publish されず retry / refusal / terminal visible outcome へ進む。
  - Event: `ForumStarterAccepted`, `ForumMentionedFollowUpAccepted`, `ForumNonMentionFollowUpIgnored`, `ForumCandidateProduced`, `ForumSafetyPassed`, `ForumUnsafeCandidateWithheld`, `ForumReplyPublished`, `ForumRetryVisible`, `ForumTerminalFailureVisible`.
  - Invalid command policy: forum parent channel 自体では research reply を開始しない。starter 以外の non-mention は無応答。safety 未通過 candidate は Discord publish 不可。retry / duplicate は Thread Cursor And Retry Progress の単調性に従う。
  - Deterministic Context: forum place capability、starter/follow-up facts、mention fact、conversation context snapshot、safety result、reply target fact、cursor state fact。
- 関連slice材料: Forum Research Starter Reply、Forum Research Mentioned Follow-Up Reply、Forum Research Non-Mention Follow-Up Is Ignored、Runtime Failure Recovery Keeps Reply Target。
- Shared invariant材料: safety-before-publish、forum post thread と parent channel の分離、mention-only follow-up、publish 前安全。
- Phase 0b外候補の妥当性: 該当なし
- Questions: なし
- 確度: 確定

### Admin Override Thread Lifecycle
- 元分類: C1 State-transition boundary candidate
- アクション: 維持
- 新分類: C1 State-transition boundary
- 理由: actor eligibility、Discord thread 作成、workspace 実行、session persistence を外へ出しても、dedicated override thread の start/use/end/archive lifecycle と invalid command policy が workspace-write 可否を決める。owner/admin 以外、dedicated thread 外、別 actor、終了済み thread で write context を拒否する契約は `USDM-04`, `USDM-05`, `USDM-06` の観測仕様を守る。
- 移行先/統合先: なし
- 分割案: actor eligibility は C6、Discord thread 作成 / archive は C9、Codex execution は C8/C10、session record は C14 へ分割する。
- Boundary契約材料:
  - State: `no_active_override`, `start_requested(origin_place, actor)`, `dedicated_thread_active(thread_id, actor_id, origin_place, sandbox_mode)`, `ending_requested`, `ended_archived`, `stale_or_wrong_actor_rejected(reason)`.
  - Command: `RequestOverrideStart`, `BindDedicatedOverrideThread`, `UseWorkspaceWriteInOverrideThread`, `RequestOverrideEnd`, `ArchiveEndedOverride`, `RejectInvalidOverrideCommand`.
  - Transition: eligible owner/admin の明示 command が allowed origin で実行されると `no_active_override -> start_requested -> dedicated_thread_active`。workspace-write は同一 actor かつ dedicated thread 内のみ受理する。end command は同一 actor かつ active thread でだけ `ending_requested -> ended_archived` へ進む。終了済み thread は active override として再利用しない。
  - Event: `OverrideStartAccepted`, `DedicatedOverrideThreadCreated`, `WorkspaceWriteContextBound`, `WorkspaceWriteCommandAccepted`, `OverrideEndAccepted`, `OverrideThreadArchived`, `OverrideCommandRejected`.
  - Invalid command policy: 自然文 repo 改変要求を即 workspace-write に昇格しない。owner/admin 以外、元 place での直接 write、別 actor 利用、dedicated thread 外利用、終了済み thread 利用は拒否する。TTL 終了を正本にしない。
  - Deterministic Context: actor eligibility fact、origin place fact、configured admin_override root、existing active session lookup、Discord thread creation/archive result、sandbox capability fact。
- 関連slice材料: Admin Override Start From Origin Place、Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread、Admin Override End Archives Write Context。
- Shared invariant材料: workspace-write containment、owner/admin authority、dedicated thread identity、System side effect と Harness meaning の分離。
- Phase 0b外候補の妥当性: 該当なし
- Questions: なし
- 確度: 確定

### Thread Cursor And Retry Progress
- 元分類: C1 State-transition boundary candidate
- アクション: 維持
- 新分類: C1-thin State-transition boundary
- 理由: retry scheduling、Discord notification、storage I/O、failure wording を外へ出しても、message / thread / reply target ごとの進捗単調性、duplicate handling、terminal failure visibility が残る。これを shared invariant だけに落とすと、同じ Command の再送、pending retry duplicate、completed duplicate、terminal failure notification の観測契約が消える。
- 移行先/統合先: なし
- 分割案: retry scheduling は C13/C8、Discord notification は C9、progress record は C14、failure wording は Harness contract へ分割する。
- Boundary契約材料:
  - State: `unseen`, `observed(message_id, reply_target)`, `processing`, `retry_pending(attempt, reply_target)`, `completed(reply_message_id)`, `terminal_failure_notified(reply_target)`.
  - Command: `ObserveThreadMessage`, `StartProcessing`, `ScheduleRetry`, `MarkCompleted`, `MarkTerminalFailureNotified`, `HandleDuplicateProgressCommand`.
  - Transition: new eligible message は `unseen -> observed -> processing`。recoverable failure は `processing -> retry_pending`。successful reply は `processing/retry_pending -> completed`。terminal failure は `processing/retry_pending -> terminal_failure_notified`。completed duplicate は巻き戻さず existing completed として扱う。pending retry duplicate は visible cursor を進めず、同じ reply target で recovery を待つ。
  - Event: `ThreadMessageObserved`, `ThreadProcessingStarted`, `ThreadRetryScheduled`, `ThreadProgressCompleted`, `ThreadTerminalFailureNotified`, `ThreadDuplicateIgnoredOrReused`.
  - Invalid command policy: cursor は後退しない。terminal failure を無言完了として扱わない。retry 後に reply target を変えない。control-plane retry metadata を `available_context` に混ぜない。
  - Deterministic Context: current progress state、message/thread identity、reply target fact、retry attempt fact、operation outcome fact。
- 関連slice材料: Knowledge Thread Follow-Up Uses Known Sources、Forum Research Starter Reply、Forum Research Mentioned Follow-Up Reply、Runtime Failure Recovery Keeps Reply Target、Storage Round-Trip Preserves Knowledge And Sessions。
- Shared invariant材料: cursor monotonicity、same reply target recovery、control plane と facts plane の分離、terminal failure visibility。
- Phase 0b外候補の妥当性: 該当なし
- Questions: なし
- 確度: 確定

## Absorbed Into Parent

### Reply Target Resolution state fragments
- 元分類: C2 / C8 / C12 / C6 / C9
- アクション: C1/C2再配置
- 新分類: C2 Absorbed-into-parent + C8/C12 outer responsibility
- 理由: same place、created public thread、existing thread、no reply、failure notification は重要だが、それぞれの状態所有元は `Knowledge Thread Binding`, `Forum Research Thread Progress`, `Admin Override Thread Lifecycle`, `Thread Cursor And Retry Progress` にある。Resolution 自身は発話元 place、capability、Harness outcome、safety result、binding、cursor を合成して Discord effect に渡す application service / readiness gate であり、独立した永続 lifecycle を持たない。
- 移行先/統合先: parent state fragment は上記 4 boundary へ、横断不変条件は shared へ、送信手順は C8/C9 へ。
- Boundary契約材料: 独立 boundary としてはなし。各 parent boundary の Event payload に `reply_target`, `source_place`, `thread_id`, `no_reply_reason` を含める材料として残す。
- 関連slice材料: 通常 chat は same place、URL watch root ingest は public thread、knowledge thread follow-up は same thread、forum research は same forum thread、admin diagnostics は admin place、admin override start は origin place に導線、override use/end は dedicated thread。
- Shared invariant材料: reply target は channel identity / legacy mode から直接決めず、PlaceFeature assignment、thread binding、boundary event、safety result の合成で決める。
- Questions: なし
- 確度: 確定

### Persistence Boundary Registry state fragments
- 元分類: C2 / C11 / C14 / C6
- アクション: C1/C2再配置
- 新分類: C2 Absorbed-into-parent + C14/C11 outer responsibility
- 理由: knowledge visibility、thread binding、session identity、override session、retry / forum progress、migration preservation は保存意味として重要だが、`Registry` 単体は広すぎ、自然な domain Command と一貫した状態相を持たない。保存対象ごとの identity と availability は各 state-owner boundary と shared invariant へ局所再掲する。
- 移行先/統合先: `Knowledge Thread Binding`, `Forum Research Thread Progress`, `Admin Override Thread Lifecycle`, `Thread Cursor And Retry Progress`, `Place Capability Assignment`、および shared storage / migration invariant。
- Boundary契約材料: 独立 boundary としてはなし。各 parent boundary の State identity、Event payload、Invalid command policy に永続同一性と round-trip 保存意味を含める。
- 関連slice材料: Storage Round-Trip Preserves Knowledge And Sessions、URL Watch Knowledge Ingest Creates Or Reuses Public Thread、Knowledge Thread Follow-Up Uses Known Sources、Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread、Runtime Failure Recovery Keeps Reply Target。
- Shared invariant材料: DB schema / migration number を正本にせず、reopen / restart / migration 後も visibility、thread binding、session identity、progress monotonicity が同じ観測意味を保つ。
- Questions: なし
- 確度: 確定

## Outer Responsibilities

### Reply Target Resolution
- 分類: C8 Application Service / C12 Readiness gate / C9 effect handoff
- 投影先: parent boundary Event payload、slice reply observation、shared reply-target invariant。
- 残す意味: `chat_reply` は原則 same place、URL watch root ingest は public thread、knowledge thread follow-up は same thread、forum research は same forum thread、natural language knowledge save は same place、admin diagnostics は admin_control/admin_override 管理 place、invalid / ignored cases は no reply を観測できる。

### Persistence Boundary Registry
- 分類: C14 Data Entity/Record Boundary / C11 migration batch
- 投影先: parent boundary identity、shared storage invariant、Storage Round-Trip slice。
- 残す意味: 保存済み knowledge、known source、thread binding、override session、retry/forum progress、legacy compatibility data は migration / restart 後も user-visible contract を失わない。DB table 名や repository method は契約化しない。

### Admin Diagnostics Gate
- 分類: C6 Cross-cutting policy / C12 Readiness gate
- 投影先: Admin Diagnostics Explicit Request Only slice、shared admin gate invariant、Reply Target Resolution の admin 管理 place 材料。
- 残す意味: owner/admin かつ admin_control / admin_override 管理 place かつ明示 diagnostics request の turn だけ diagnostics を返す。通常の権限質問や admin place の通常会話を diagnostics JSON に落とさない。固定文言 trigger list は System 正本化しない。command 操作または明示要求の事実を Deterministic Context として渡し、意味判断は Harness contract 側に残す。

### Safety-Before-Publish
- 分類: C6 Cross-cutting policy / C12 Readiness gate
- 投影先: shared invariant、Forum Research Thread Progress、Reply Target Resolution / dispatch、forum research slice。
- 残す意味: final public reply は Discord publish 前に根拠・安全・出力境界の確認を通る。unsafe candidate は公開せず、同じ reply target で retry / refusal / terminal visible outcome に進む。単体 C1 にはしない。

### Feature Profile
- 分類: C7 Setting/Profile
- 投影先: Place Capability Assignment、shared glossary / invariant。
- 残す意味: feature set、default scope、chat behavior の設定概念。state-owner は profile 定義ではなく place assignment lifecycle 側にある。

### Owner/Admin Eligibility
- 分類: C6 Cross-cutting policy / external actor fact
- 投影先: Admin Override Thread Lifecycle、Admin Diagnostics Gate、shared admin authority invariant。
- 残す意味: owner/admin fact は System が authority fact として提供し、workspace-write や diagnostics の受理可否に使う。actor eligibility 取得自体は boundary 内の状態遷移ではない。

### Public Source Fetch / External Provider Results
- 分類: C10 External provider contract
- 投影先: Knowledge Thread Binding、Safety-Before-Publish、knowledge ingest slice。
- 残す意味: `fetchable_public_urls` と same-turn public reconfirmation の結果だけを根拠化材料にする。blocked/private/local URL は取得対象にも保存根拠にもならない。

### Discord Effects
- 分類: C9 External side effect
- 投影先: parent boundary Events、Reply Target Resolution、slice observation。
- 残す意味: send、thread create、thread archive、notification は System side effect。boundary Event は「起きた事実」を出し、Effect Handler が Discord 副作用を行う。

### Retry Scheduler / Async Job
- 分類: C13 Async job / control plane
- 投影先: Thread Cursor And Retry Progress、Forum Research Thread Progress、Runtime Failure Recovery slice。
- 残す意味: retry metadata は control plane に置き、`available_context` へ混ぜない。retry scheduling は状態遷移の結果 Event を解釈して実行する外側責務。

## Split Results

- `Place Capability Assignment`: `Feature Profile` 定義、assignment lifecycle、legacy compatibility batch、assignment record に分割。boundary は assignment lifecycle と invalid policy だけを所有する。
- `Knowledge Thread Binding`: binding identity / follow-up eligibility、public source fetch、summarization/save intent、Discord public thread creation、record persistence に分割。boundary は binding identity と follow-up eligibility を所有する。
- `Forum Research Thread Progress`: activation/progress/publishable state、safety-before-publish policy、generation/appendix、retry job、Discord publish、progress persistence に分割。boundary は thread progress と activation/publishability を所有する。
- `Admin Override Thread Lifecycle`: lifecycle state、actor eligibility policy、Discord thread create/archive、workspace-write execution、session persistence に分割。boundary は start/use/end/archive lifecycle を所有する。
- `Thread Cursor And Retry Progress`: monotonic progress state、retry execution、failure notification effect、progress record、failure wording に分割。boundary は progress state と duplicate/retry/terminal policy を所有する。
- `Reply Target Resolution`: parent reply target fragment、destination resolution service、safety readiness gate、Discord send/thread creation effect に分割。独立 C1 にはしない。
- `Persistence Boundary Registry`: registry 名義を廃止し、knowledge visibility、thread binding、session identity、override session、retry/forum progress、migration preservation の保存意味へ分割する。
- `Admin Diagnostics Gate`: eligibility / explicit intent gate、diagnostics collection、read projection、normal chat fallback、reply delivery に分割。C6/C12 として残し、固定文言 trigger を正本化しない。

## Slice Projection Materials

- Feature Profile Assignment Loads A Place / Legacy Watch Location Remains Compatibility Only:
  - PlaceFeature / feature profile assignment が正本で、legacy `mode` は互換・派生ラベルであることを受入前提にする。
  - 重複 place assignment、primary feature 多重、legacy mode との二重正本化は拒否または隔離される。
- Normal Chat Reply In Same Place / Ambient Chat Sparse Reply:
  - 通常 chat の URL は明示保存要求がない限り会話材料であり、自動 knowledge thread 化しない。
  - same place reply と sparse behavior は PlaceFeature assignment に基づく。
- URL Watch Knowledge Ingest Creates Or Reuses Public Thread:
  - eligible public source だけが knowledge binding を作れる。
  - root URL ingest は public thread を作成または再利用し、保存結果と reply target が一致する。
- Natural Language Knowledge Save Request:
  - 明示保存要求は same place reply を優先し、保存 handoff が不完全でも回答自体を止めない。
  - 保存 scope は同一 guild の `server_public` を基本にする。
- Knowledge Thread Follow-Up Uses Known Sources:
  - active binding がある thread では same thread reply と known source priority を維持する。
  - stale/missing binding では known source を捏造せず、無言失敗にしない。
- Forum Research Starter Reply:
  - starter は mention なしで処理を開始できる。
  - final public reply は safety-before-publish を通過してから same forum thread に publish される。
- Forum Research Mentioned Follow-Up Reply:
  - starter 後の follow-up は bot mention がある場合だけ処理を開始し、文脈を保持する。
  - unsafe candidate は公開せず、retry/refusal/terminal visible outcome を同じ thread で観測できる。
- Forum Research Non-Mention Follow-Up Is Ignored:
  - non-mention follow-up は no reply / no processing reaction として観測できる。
- Admin Override Start From Origin Place:
  - owner/admin の明示 command だけが dedicated override thread 作成へ進む。
  - workspace-write は origin place では開かれず、origin place には dedicated thread への導線を返す。
- Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread:
  - 同一 actor かつ dedicated override thread 内だけが workspace-write context になる。
  - 別 actor、別 place、終了済み thread は拒否される。
- Admin Override End Archives Write Context:
  - 同一 actor の end command で session を閉じ、thread archive を観測できる。
  - TTL による勝手な終了を正本にしない。
- Admin Diagnostics Explicit Request Only:
  - admin_control / admin_override 管理 place で owner/admin が明示 diagnostics を要求したときだけ diagnostics を返す。
  - 通常 admin 会話や権限質問は diagnostics JSON にしない。
- Runtime Failure Recovery Keeps Reply Target:
  - retry / terminal failure は元 reply target と矛盾しない場所で可視化される。
  - duplicate / retry で cursor が戻らず、無言完了にしない。
- Storage Round-Trip Preserves Knowledge And Sessions:
  - knowledge visibility、thread binding、session identity、override session、retry/forum progress は restart / migration 後も同じ観測意味を保つ。

## Shared Invariant Candidates

- Place capability source of truth: Place の機能意味は Feature Profile / PlaceFeature assignment が正本であり、Discord channel identity や legacy `mode` を直接の正本にしない。
- Legacy compatibility boundary: legacy `locations` / `mode` は互換入力または派生ラベルとして扱い、feature policy と二重正本化しない。
- Reply target derivation: reply target は place capability、thread binding、boundary event、safety result、cursor state の合成で決まる。Reply Target Resolution を独立 state-owner にしない。
- Safety-before-publish: public Discord publish の前に、根拠・安全・出力境界が確認される。unsafe candidate を先に publish しない。
- Public source eligibility: `blocked_urls`、localhost、private IP、`.local`、`file:`, `data:`, `javascript:`、根拠化されていない URL は取得・保存根拠にしない。
- Knowledge visibility and known source priority: `server_public` の知見保存、known source URL、knowledge thread binding は follow-up で優先され、stale/missing のときは捏造しない。
- Thread type separation: knowledge thread、forum research thread、admin override thread、plain thread を混同しない。
- Admin authority and containment: owner/admin fact は authority fact として扱い、workspace-write は dedicated override thread と同一 actor に閉じ込める。
- Admin diagnostics gate: diagnostics は管理 place と明示 diagnostics request の gate を通る。固定文言 trigger を System 正本にしない。
- Cursor monotonicity: cursor / progress は後退せず、pending retry duplicate、completed duplicate、terminal failure の観測結果を区別する。
- Persistence preservation: DB schema ではなく、visibility、thread binding、session identity、progress、legacy compatibility data の user-visible 保存意味を restart / migration 後も保つ。
- Facts plane / control plane separation: `available_context` は facts-only に保ち、retry metadata、budget、safety regeneration control は混ぜない。
- Event-effect separation: boundary Event は状態遷移で起きた事実であり、Discord send、thread create/archive、DB write、external fetch、retry scheduling は Effect Handler / Application Service の責務である。

## Blocking Issues

なし

## Integrationへの申し送り

- frozen sharedへ入れるべき不変条件:
  - PlaceFeature / feature profile assignment が正本で、legacy `mode` は互換・派生ラベルに留まる。
  - Safety-before-publish は shared policy/invariant として Forum Research Thread Progress と Reply Target Resolution / dispatch へ投影する。単体 boundary にはしない。
  - Reply target と persistence registry は独立 boundary に戻さず、親 boundary の state fragment、shared invariant、outer responsibility として扱う。
  - admin diagnostics は C6/C12 gate として残し、固定文言 trigger list を System 正本にしない。
  - facts plane / control plane separation、cursor monotonicity、storage round-trip preservation、public source eligibility を shared invariant として凍結する。
- Phase Zでslice本文へ局所再掲すべき前提:
  - 通常 chat、knowledge ingest、knowledge follow-up、forum research、admin override、admin diagnostics、runtime failure recovery、storage round-trip の各 slice に、関連 boundary 名、reply target、保存意味、invalid / ignored command の観測結果を局所再掲する。
  - Forum research slice は starter / mentioned follow-up / non-mention ignore を同一ユースケース内の受入基準として統合候補にする。
  - Admin override slice は start/use/end を lifecycle として一体で扱い、workspace-write containment を受入基準にする。
  - Knowledge slice は root URL ingest、natural language save、thread follow-up を分けて観測しつつ、Knowledge Thread Binding と public source eligibility を共通前提にする。
- Final integrationでboundary本文へ入れるべきState/Command/Transition/Event材料:
  - `Place Capability Assignment`: assignment state、legacy mapping、invalid isolation、capability resolution events。
  - `Knowledge Thread Binding`: binding identity、thread/source/record link、follow-up active、blocked/private rejection、reuse duplicate policy。
  - `Forum Research Thread Progress`: starter / mentioned follow-up / non-mention、candidate safety pending、publish/withhold/retry/terminal visible events。
  - `Admin Override Thread Lifecycle`: no active / active / ended states、same actor dedicated thread policy、start/use/end/archive events。
  - `Thread Cursor And Retry Progress`: unseen / processing / retry pending / completed / terminal notified states、duplicate and monotonic policy。
- C3-C14の外側責務から最終specへ残すべき意味と投影先:
  - C8/C12 Reply Target Resolution は slice reply observation と parent Event payload へ。
  - C14/C11 Persistence は shared storage invariant と parent identity へ。
  - C6/C12 Admin Diagnostics Gate は admin diagnostics slice と shared admin gate invariant へ。
  - C6 Safety-Before-Publish は shared invariant、forum boundary、dispatch readiness へ。
  - C7 Feature Profile は shared glossary と Place Capability Assignment へ。
  - C6 Owner/Admin Eligibility は shared authority invariant と admin boundary/gate へ。
  - C10 Public Source Fetch は knowledge boundary と source eligibility invariant へ。
  - C9 Discord Effects と C13 Retry Scheduler は Event-Effect boundary と runtime failure slice へ。
- Questionsへ送るべき未確定事項:
  - なし。
