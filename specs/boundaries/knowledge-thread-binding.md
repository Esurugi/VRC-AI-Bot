# Boundary: Knowledge Thread Binding

## 責務

root URL ingest、public source、knowledge record、public thread、known sources の結合状態を所有し、knowledge thread follow-up が same thread と known source priority を維持することを守る。blocked/private/unobserved URL は binding 根拠にしない。

## 関連slice

| Slice | このboundaryが支える意味 |
|---|---|
| URL Watch Knowledge Ingest Creates Or Reuses Public Thread | eligible public source から public thread と knowledge binding が作られる |
| Natural Language Knowledge Save Request | 明示保存要求は公開根拠化された場合だけ保存 handoff へ進める |
| Knowledge Thread Follow-Up Uses Known Sources | active binding の same thread で known sources を優先する |
| Storage Round-Trip Preserves Knowledge And Sessions | thread binding と known source が再起動後も同じ意味で読める |

## 関連USDM要求

| ID | 要求の要旨 | このboundaryで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | knowledge ingest / follow-up の black-box 振る舞いを保つ |
| `USDM-05` | 知見保存、reply routing、persistence boundary を保つ | root ingest と follow-up の reply/persistence 意味を分離する |
| `USDM-06` | storage round-trip、thread cursor、migration preservation | binding identity と known source を再起動後も維持する |

## 前提概念

Knowledge Ingest は通常 chat URL と異なる。URL watch root または明示保存要求で、かつ public source eligibility を満たす場合だけ共有知見化に進む。`knowledge_writes` は System persistence への advisory handoff であり、DB 保存完了と同一ではない。

Knowledge Thread は Forum Research Thread ではない。active binding がある knowledge thread follow-up は、新規 ingest ではなく、known source priority を持つ same-thread chat reply になる。

## State

- `no_binding(source_message_id)`: source message に binding がない。
- `ingest_accepted(source_message_id, eligible_sources)`: root ingest または明示保存要求が公開根拠化され、binding 作成可能。
- `thread_created(thread_id, source_message_id)`: public thread 作成または既存 thread 再利用の事実が確定済み。
- `source_linked(thread_id, knowledge_record_id, known_source_urls)`: knowledge record と known sources が thread に結び付いた。
- `follow_up_active(thread_id, knowledge_record_id, known_source_urls)`: follow-up が same thread / known source priority で解決可能。
- `missing_or_stale(thread_id, reason)`: binding が欠落または古く、known source を根拠として使えない。

## Command

- `AcceptRootUrlIngest(source_message_id, source_facts)`: URL watch root の公開根拠化結果を受理する。
- `AttachPublicThread(thread_result)`: thread 作成または既存 thread 検出の決定済み結果を結び付ける。
- `LinkKnowledgeRecord(record_result, known_source_urls)`: knowledge record と known sources の保存結果 fact を結び付ける。
- `ResolveKnowledgeFollowUp(thread_id, follow_up_message_id)`: follow-up 文脈を解決する。
- `MarkBindingStale(thread_id, reason)`: 欠落、migration 隔離、source 不整合などの stale fact を反映する。

public fetch result、blocked/private 判定、existing binding lookup result、persistence result は外側から渡される Deterministic Context であり、Transition 内で外部取得や DB 読み取りをしない。

## Transition

| Current State | Command | Guard | Next State | Event | Result |
|---|---|---|---|---|---|
| `no_binding(source_message_id)` | `AcceptRootUrlIngest` | source_facts が eligible public source を持つ | `ingest_accepted(source_message_id, eligible_sources)` | `KnowledgeIngestAccepted` | thread binding 作成へ進める |
| `no_binding(source_message_id)` | `AcceptRootUrlIngest` | blocked/private/unobserved/根拠化不能 | `no_binding(source_message_id)` | `KnowledgeBindingRejected` | binding を作らず理由を返す |
| `ingest_accepted(...)` | `AttachPublicThread` | thread_result が作成済みまたは再利用可能 thread を持つ | `thread_created(thread_id, source_message_id)` | `KnowledgeThreadBound` | public thread が binding 候補になる |
| `thread_created(...)` | `LinkKnowledgeRecord` | record_result が保存済みまたは保存 handoff accepted の fact を持つ | `source_linked(thread_id, knowledge_record_id, known_source_urls)` | `KnowledgeSourcesLinked` | known sources を follow-up に渡せる |
| `source_linked(...)` | `ResolveKnowledgeFollowUp` | known_source_urls が空でない | `follow_up_active(thread_id, knowledge_record_id, known_source_urls)` | `KnowledgeFollowUpContextResolved` | same thread / known source priority の文脈を返す |
| `follow_up_active(...)` | `ResolveKnowledgeFollowUp` | active binding が現行 thread と一致 | `follow_up_active(...)` | `KnowledgeFollowUpContextResolved` | 新規 ingest ではなく follow-up context を返す |
| any | `MarkBindingStale` | reason が決定済み | `missing_or_stale(thread_id, reason)` | `KnowledgeBindingMarkedStale` | known source を使わず recovery / explanation へ渡す |
| `missing_or_stale(...)` | `ResolveKnowledgeFollowUp` | 常に | `missing_or_stale(...)` | `KnowledgeBindingRejected` | source を捏造せず、無言失敗にしない材料を返す |

Transition は `Current State + Command + Deterministic Context -> Next State + Events + Result` として読む。thread 作成、fetch、DB write は Transition 内で実行しない。

## Invalid command policy

- 通常 chat の URL は、明示保存要求または URL watch root ingest でない限り binding を作らない。
- `blocked_urls`、private URL、same-turn public reconfirmation のない URL は保存根拠にしない。
- stale / missing binding から known source を捏造しない。
- active binding がある follow-up を新規 ingest として扱わない。
- duplicate ingest は thread 乱立ではなく、既存 binding 再利用または idempotent result として扱う。

## Event / Effect boundary

Event は binding 状態で起きた事実である。

- `KnowledgeIngestAccepted`: source message id、eligible source URLs、scope 候補を含める。
- `KnowledgeThreadBound`: thread id、source message id、再利用か新規作成かの fact を含める。
- `KnowledgeSourcesLinked`: knowledge record id、known source URL set、visibility fact を含める。
- `KnowledgeFollowUpContextResolved`: thread id、known source URL set、reply target fact を含める。
- `KnowledgeBindingRejected` / `KnowledgeBindingMarkedStale`: reason と no fabricated source の意味を含める。

public source fetch、要約、保存 handoff 生成、DB write、Discord thread 作成、返信送信は外側責務である。Effect Handler が必要な thread id、record id、source URL set、reply target は Event payload から得られるようにする。

## 実装時に露出しうる局所論点

thread 名、URL canonicalization の細部、record の内部 schema、保存できない場合の表示文言は局所判断でよい。ただし public source eligibility、visibility、same-thread reply、known source priority は局所論点へ逃がさない。
