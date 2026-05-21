# Phase Z 結果

## Slice 構成判断

Phase 0a の UX sequence candidates は最終 slice 境界として固定しなかった。frozen shared と Phase 3 の adopted boundary を読んだ結果、状態所有、保存意味、reply target、invalid / ignored command policy が同じ判断に依存する候補を統合した。

- `Feature Profile Assignment Loads A Place` と `Legacy Watch Location Remains Compatibility Only` は、PlaceFeature assignment と legacy compatibility の二重正本解消が同じ `Place Capability Assignment` に依存するため、`place-capability-assignment.md` に統合した。
- `Normal Chat Reply In Same Place`、`Ambient Chat Sparse Reply`、chat root URL non-ingest は、通常会話の same-place reply と knowledge ingest への非昇格が同じ conversation routing 観測契約に属するため、`conversation-routing.md` に統合した。
- `URL Watch Knowledge Ingest Creates Or Reuses Public Thread`、`Natural Language Knowledge Save Request`、`Knowledge Thread Follow-Up Uses Known Sources` は、public source eligibility、known source priority、Knowledge Thread Binding、visibility 保存意味が共通するため、`knowledge-ingest-and-follow-up.md` に統合した。
- forum starter、mentioned follow-up、non-mention ignore、safety-before-publish、forum recovery は、同じ `Forum Research Thread Progress` と `Thread Cursor And Retry Progress` に依存するため、`forum-research-thread.md` に統合した。最新要求に従い、starter 後の follow-up は mention only 起動、non-mention は no reply / no processing reaction とした。
- admin override start/use/end は、同じ dedicated thread lifecycle、same actor、workspace-write containment に依存するため、`admin-override-lifecycle.md` に統合した。
- admin diagnostics は独立 state-owner boundary にせず、admin place、owner/admin、明示 diagnostics request の観測契約として `admin-diagnostics.md` にした。
- runtime failure recovery、cursor monotonicity、storage round-trip、migration preservation は、複数 slice に横断するが受入観測が一体であるため、`runtime-recovery-and-persistence.md` に統合した。

## Completed Slices

### `specs/slices/place-capability-assignment.md`

完成本文は `specs/slices/place-capability-assignment.md` に配置済み。Phase 0a の feature profile assignment / legacy compatibility 候補を統合し、`Place Capability Assignment` だけを関連する採用済みboundaryとして接続した。

この slice は、Feature Profile / PlaceFeature assignment を place の機能正本にし、legacy `locations` / `mode` を互換入力または派生ラベルに留める。重複 assignment、primary feature 多重、legacy mode との二重正本化は通常 routing の根拠にしない。

### `specs/slices/conversation-routing.md`

完成本文は `specs/slices/conversation-routing.md` に配置済み。通常会話、ambient sparse reply、chat root URL non-ingest を統合し、`Place Capability Assignment` に接続した。

この slice は、通常 chat の same-place reply、ambient chat の過剰反応抑制、通常 chat URL を明示保存要求なしに knowledge thread 化しないことを観測契約にする。

### `specs/slices/knowledge-ingest-and-follow-up.md`

完成本文は `specs/slices/knowledge-ingest-and-follow-up.md` に配置済み。URL watch root ingest、自然文の明示保存要求、knowledge thread follow-up を統合し、`Place Capability Assignment`、`Knowledge Thread Binding`、`Thread Cursor And Retry Progress` に接続した。

この slice は、eligible public source だけを保存根拠にし、URL watch root は public thread を作成または再利用し、knowledge thread follow-up は same thread と known source priority を維持する。自然文の明示保存要求は same place reply を優先し、同一 guild の `server_public` 保存意味を基本にする。

### `specs/slices/forum-research-thread.md`

完成本文は `specs/slices/forum-research-thread.md` に配置済み。forum starter、mentioned follow-up、non-mention ignore、safety-before-publish、forum recovery を統合し、`Place Capability Assignment`、`Forum Research Thread Progress`、`Thread Cursor And Retry Progress` に接続した。

この slice は、starter は mention なしで起動し、starter 後 follow-up は bot mention がある場合だけ起動し、non-mention follow-up は no reply / no processing reaction として ignore する。final public candidate は publish 前 safety を通り、unsafe candidate は先に Discord へ出さない。

### `specs/slices/admin-override-lifecycle.md`

完成本文は `specs/slices/admin-override-lifecycle.md` に配置済み。admin override start/use/end を dedicated override thread lifecycle として統合し、`Place Capability Assignment`、`Admin Override Thread Lifecycle` に接続した。

この slice は、owner/admin の明示管理操作で dedicated override thread を起動し、workspace-write を origin place ではなく同一 actor の dedicated thread 内だけに限定する。終了後は session close と archive が観測され、active override として再利用されない。

### `specs/slices/admin-diagnostics.md`

完成本文は `specs/slices/admin-diagnostics.md` に配置済み。admin diagnostics gate は boundary 名として扱わず、`Place Capability Assignment` に接続する slice 条件として表現した。

この slice は、admin_control / admin_override 管理 place、owner/admin、明示 diagnostics request または管理操作 fact の gate を満たすときだけ diagnostics を返す。通常 admin chat や権限質問は diagnostics JSON にしない。

### `specs/slices/runtime-recovery-and-persistence.md`

完成本文は `specs/slices/runtime-recovery-and-persistence.md` に配置済み。Runtime Failure Recovery、Storage Round-Trip、Migration Preservation を統合し、Phase 3 の 5 boundary すべてに接続した。

この slice は、retry / terminal failure が元 reply target と矛盾しない場所で可視化され、cursor が後退せず、storage / migration 後も knowledge visibility、known source、thread binding、session identity、override session、retry / forum progress のユーザー向け保存意味を保つことを契約にする。

## Coordinatorへの新規slice候補

なし。

## Questions

なし。
