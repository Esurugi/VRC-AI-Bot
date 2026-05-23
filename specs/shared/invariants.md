# Shared Invariants

この文書は Phase 3 の Shared Invariant Candidates を凍結する。各 invariant は複数 slice / boundary で同じ意味に揃える条件であり、実装詳細ではなくユーザー観測、保存意味、Harness/System 境界を守るための契約である。

## INV-01 Place Capability Source Of Truth

- 条件: place のユーザー向け機能意味は Feature Profile / PlaceFeature assignment が正本であり、Discord channel identity や legacy `mode` を直接の正本にしない。
- 適用範囲: Place Capability Assignment、normal chat、knowledge ingest、forum research、admin override、admin diagnostics、reply routing。
- 破ると壊れる意味: channel / mode 基盤から feature assignment 基盤へ移る `USDM-02` が壊れ、同じ place が二つの正本で異なる振る舞いを持つ。
- 典型違反: `features` ではなく `mode` だけで knowledge/admin/forum の可否を決める。feature policy と legacy mode の矛盾を黙って通常 routing に使う。

## INV-02 Legacy Compatibility Boundary

- 条件: legacy `locations` / `mode` は互換入力または派生ラベルであり、新しい feature policy と二重正本化しない。
- 適用範囲: Place Capability Assignment、migration preservation、configuration compatibility。
- 破ると壊れる意味: migration 後に既存運用を保護しながら、将来の routing 正本を feature assignment に寄せる契約が壊れる。
- 典型違反: legacy mode と PlaceFeature が衝突している設定を「両方有効」として扱う。derived mode を後続の state-owner が primary key として読む。

## INV-03 Reply Target Is Derived, Not Owned By A Standalone Boundary

- 条件: Reply Target は PlaceFeature assignment、thread binding、boundary Event payload、safety result、cursor state の合成で決まる。Reply Target Resolution を独立 state-owner にしない。
- 適用範囲: normal chat same place、URL watch public thread、knowledge follow-up same thread、forum same thread、admin diagnostics management place、admin override origin guide、runtime failure recovery。
- 破ると壊れる意味: 発話元 place、公開応答先、knowledge scope、session binding が collapse し、同じ failure / retry で別 target へ返る。
- 典型違反: source message channel を常に reply target とみなす。knowledge thread follow-up を root channel に返す。forum parent channel と forum post thread を同一視する。

## INV-04 Safety-Before-Publish

- 条件: public Discord publish の前に、根拠、安全、出力境界が確認される。unsafe candidate は先に publish しない。
- 適用範囲: Forum Research Thread Progress、knowledge ingest reply with sources、normal chat reply with sources、reply dispatch readiness。
- 破ると壊れる意味: unsafe candidate や未観測 source が公開され、後段 retry / refusal では取り消せない公開漏えいになる。
- 典型違反: streaming final callback が safety 評価前に Discord へ送信する。references appendix を final safety より先に出す。安全未通過 candidate を一度 publish してから拒否する。

## INV-05 Public Source Eligibility

- 条件: `blocked_urls`、localhost、private IP、`.local`、`file:`、`data:`、`javascript:`、根拠化されていない URL は取得対象にも保存根拠にもならない。`fetchable_public_urls` または same-turn public reconfirmation の結果だけを根拠化材料にできる。
- 適用範囲: Knowledge Thread Binding、Knowledge Ingest、Safety-Before-Publish、public-source fetch。
- 破ると壊れる意味: private / unsafe / unverified source が `server_public` 知見や public reply に混入する。
- 典型違反: chat に貼られた URL を未取得のまま `sources_used` に入れる。blocked URL を fetch しようとする。known source がない stale binding で source を捏造する。

## INV-06 Knowledge Visibility And Known Source Priority

- 条件: `server_public` の知見保存、known source URL、knowledge thread binding は follow-up で優先される。missing / stale のときは捏造せず、無言失敗にしない。
- 適用範囲: Knowledge Thread Binding、knowledge thread follow-up、storage round-trip、migration preservation。
- 破ると壊れる意味: follow-up が文脈を失い、共有知見の visibility や source link が再起動後に壊れる。
- 典型違反: active binding を無視して無関係な公開調査を優先する。stale binding から known source を作ったことにする。knowledge thread follow-up を新規 ingest として扱う。

## INV-07 Thread Type Separation

- 条件: knowledge thread、forum research thread、admin override thread、plain thread は同じ Discord thread でも異なる activation、reply policy、保存意味、workspace-write 可否を持つ。
- 適用範囲: Knowledge Thread Binding、Forum Research Thread Progress、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress。
- 破ると壊れる意味: forum follow-up が knowledge follow-up として扱われる、override write context が通常 thread に漏れる、plain thread に research reply が出る。
- 典型違反: thread id だけで thread 種別を推測する。forum post thread と parent forum channel を同一視する。admin override thread を admin_control root と混同する。

## INV-08 Admin Authority And Workspace-Write Containment

- 条件: owner/admin fact は authority fact として扱い、workspace-write は dedicated override thread と同一 actor に閉じ込める。origin place は導線元であり write context ではない。
- 適用範囲: Admin Override Thread Lifecycle、Admin Diagnostics Gate、admin routing、storage round-trip。
- 破ると壊れる意味: repo write 権限が元 place、通常会話、別 actor、終了済み thread に漏れる。
- 典型違反: 自然文の repo 改変要求をその場で workspace-write に昇格する。別 actor が同じ override session を使う。end/archive 後も active override として扱う。

## INV-09 Admin Diagnostics Gate

- 条件: diagnostics は admin_control / admin_override 管理 place、owner/admin、明示 diagnostics request または command fact の gate を通る。固定文言 trigger list を System 正本にしない。
- 適用範囲: Admin Diagnostics、Place Capability Assignment、normal admin chat、reply routing。
- 破ると壊れる意味: 通常の権限質問が diagnostics JSON に落ちる、または管理情報が非 admin place に漏れる。
- 典型違反: TypeScript 側の固定語彙だけで diagnostics を決める。admin place 外で diagnostics outcome を許す。admin command と通常会話を同じ入口にする。

## INV-10 Cursor Monotonicity

- 条件: cursor / progress は後退しない。pending retry duplicate、completed duplicate、terminal failure notification を区別する。
- 適用範囲: Thread Cursor And Retry Progress、Forum Research Thread Progress、Knowledge Thread Binding、runtime failure recovery。
- 破ると壊れる意味: 処理中 message が飛ばされる、完了済み message が再投稿される、failure が無言で完了扱いになる。
- 典型違反: `pending_retry` を completed と同じ扱いで cursor advance する。古い completed duplicate で cursor を巻き戻す。retry 後に reply target を再計算して別 place へ返す。

## INV-11 Persistence Preservation Is User-Visible Meaning

- 条件: DB schema ではなく、visibility、source link、thread binding、session identity、override session、retry/forum progress、legacy compatibility data のユーザー向け保存意味を restart / migration 後も保つ。
- 適用範囲: Place Capability Assignment、Knowledge Thread Binding、Forum Research Thread Progress、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress、migration preservation。
- 破ると壊れる意味: 保存済み知見が見えなくなる、private / conversation-only が public に漏れる、旧 session が新 runtime binding として誤再利用される、forum progress / retry が失われる。
- 典型違反: DB table 名や migration 番号を仕様正本にする。legacy rows を silent drop する。legacy `codex_session` を新 runtime session として resume する。

## INV-12 Facts Plane And Control Plane Separation

- 条件: `available_context` は place、features、thread、known sources、recent events など facts-only に保つ。`task.phase`、`task.retry_context`、budgets、retry/safety regeneration は control plane として分離する。
- 適用範囲: Harness request、knowledge follow-up retry、forum recovery、output safety retry、Thread Cursor And Retry Progress。
- 破ると壊れる意味: Harness が user-visible facts と retry 指示を混同し、retry metadata を利用者入力や会話本文として解釈する。
- 典型違反: `available_context` に retry_count や safety regeneration instruction を混ぜる。timeout を terminal semantic failure と扱う。System が no_reply の意味を品質 heuristic で決める。

## INV-13 Event-Effect Separation

- 条件: boundary Event は状態遷移で起きた事実であり、Discord send、thread create/archive、DB write、external fetch、retry scheduling は Effect Handler / Application Service の責務である。
- 適用範囲: すべての boundary、reply dispatch、persistence、external provider、retry scheduler。
- 破ると壊れる意味: 状態遷移が外部 API、DB、現在時刻、環境変数へ直接依存し、replay / retry / test が非決定になる。
- 典型違反: Transition 内で Discord API を呼んで成否を決める。Event payload が不足し、Effect Handler が boundary 内部状態を読み直して推測する。DB write 成功を domain state の唯一の根拠にする。
