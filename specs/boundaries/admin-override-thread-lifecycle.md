# Boundary: Admin Override Thread Lifecycle

## 責務

owner/admin が origin place から明示 command 操作で dedicated override thread を起動し、workspace-write context を同一 actor の dedicated thread 内に限定し、end/archive 後は再利用できないことを所有する。

## 関連slice

| Slice | このboundaryが支える意味 |
|---|---|
| Admin Override Start From Origin Place | origin place では write を開かず dedicated thread への導線を返す |
| Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread | 同一 actor の dedicated thread turn だけ workspace-write になる |
| Admin Override End Archives Write Context | end command で session を閉じ thread archive を観測できる |
| Storage Round-Trip Preserves Knowledge And Sessions | override session identity が再起動後も漏れずに保たれる |

## 関連USDM要求

| ID | 要求の要旨 | このboundaryで守る意味 |
|---|---|---|
| `USDM-01` | 既存管理導線を保護する | admin override start/use/end の外部観測を保つ |
| `USDM-04` | owner/admin が origin から dedicated override thread を起動し workspace-write を dedicated thread に限定する | write containment と actor identity を守る |
| `USDM-05` | admin routing / persistence boundary を保つ | origin place、dedicated thread、session identity を混同しない |
| `USDM-06` | admin diagnostics gate、storage round-trip、migration preservation | admin 操作と通常会話、保存済み session の意味を保つ |

## 前提概念

Owner/Admin Eligibility は外側 Policy / Provider が決定済み authority fact として渡す。Discord thread 作成/archive、workspace filesystem access、Codex session 実行は外側責務である。

Admin Override Thread は admin_control root や origin place そのものではない。origin place は導線元であり、workspace-write context の所有者ではない。自然文 repo 改変要求を即 workspace-write に昇格しない。

## State

- `no_active_override(origin_place)`: origin から利用できる active override がない。
- `start_requested(origin_place, actor_id)`: eligible actor の開始要求を受理済み。
- `dedicated_thread_active(thread_id, actor_id, origin_place, sandbox_mode)`: dedicated thread と same actor に workspace-write が bind 済み。
- `ending_requested(thread_id, actor_id)`: 同一 actor が終了要求を出した。
- `ended_archived(thread_id, actor_id)`: session 終了と archive が完了済み。
- `stale_or_wrong_actor_rejected(thread_id, reason)`: stale、別 actor、dedicated thread 外などにより拒否済み。

## Command

- `RequestOverrideStart(origin_place, actor_fact)`: origin place から override 開始を要求する。
- `BindDedicatedOverrideThread(thread_creation_result, sandbox_capability)`: thread 作成結果と sandbox capability を bind する。
- `UseWorkspaceWriteInOverrideThread(turn_fact)`: dedicated thread 内 turn の workspace-write 可否を解決する。
- `RequestOverrideEnd(turn_fact)`: active dedicated thread から終了を要求する。
- `ArchiveEndedOverride(archive_result)`: archive 結果 fact を反映する。
- `RejectInvalidOverrideCommand(reason)`: invalid reason を反映する。

actor eligibility fact、origin place fact、configured admin_override root、existing active session lookup、Discord thread creation/archive result、sandbox capability fact は外側から渡される。Transition 内で Discord API、DB、filesystem、環境変数を直接読まない。

## Transition

| Current State | Command | Guard | Next State | Event | Result |
|---|---|---|---|---|---|
| `no_active_override(origin_place)` | `RequestOverrideStart` | actor_fact が owner/admin で configured admin_override root がある | `start_requested(origin_place, actor_id)` | `OverrideStartAccepted` | dedicated thread 作成へ進める |
| `no_active_override` | `RequestOverrideStart` | owner/admin でない、または admin_override root がない | `stale_or_wrong_actor_rejected(origin_place, reason)` | `OverrideCommandRejected` | workspace-write を開かない |
| `start_requested(...)` | `BindDedicatedOverrideThread` | thread_creation_result が dedicated thread id を持つ | `dedicated_thread_active(thread_id, actor_id, origin_place, sandbox_mode)` | `DedicatedOverrideThreadCreated`, `WorkspaceWriteContextBound` | origin place には導線、write は dedicated thread に限定 |
| `dedicated_thread_active(...)` | `UseWorkspaceWriteInOverrideThread` | turn actor が actor_id と同一、かつ turn place が thread_id | `dedicated_thread_active(...)` | `WorkspaceWriteCommandAccepted` | workspace-write context を許可 |
| `dedicated_thread_active(...)` | `UseWorkspaceWriteInOverrideThread` | 別 actor、別 place、または sandbox capability 不一致 | `stale_or_wrong_actor_rejected(thread_id, reason)` | `OverrideCommandRejected` | workspace-write を拒否 |
| `dedicated_thread_active(...)` | `RequestOverrideEnd` | turn actor が actor_id と同一、かつ turn place が thread_id | `ending_requested(thread_id, actor_id)` | `OverrideEndAccepted` | session close / archive へ進める |
| `ending_requested(...)` | `ArchiveEndedOverride` | archive_result が完了 fact を持つ | `ended_archived(thread_id, actor_id)` | `OverrideThreadArchived` | active override として扱わない |
| `ended_archived(...)` | `UseWorkspaceWriteInOverrideThread` | 常に | `stale_or_wrong_actor_rejected(thread_id, "ended")` | `OverrideCommandRejected` | 終了済み thread の再利用を拒否 |

Transition は `Current State + Command + Deterministic Context -> Next State + Events + Result` として読む。thread 作成、archive、workspace-write 実行は Event を受けた外側 Effect が行う。

## Invalid command policy

- owner/admin 以外の start/use/end は拒否する。
- configured admin_override root がない場合は dedicated thread を作らず拒否する。
- origin place 自体を workspace-write context にしない。
- dedicated thread 外、別 actor、終了済み thread、stale session では workspace-write を拒否する。
- TTL による勝手な終了を正本にしない。終了は同一 actor の end command と archive fact で表す。
- 自然文 repo 改変要求を即 workspace-write に昇格しない。

## Event / Effect boundary

Event は override lifecycle で起きた事実である。

- `OverrideStartAccepted`: origin place、actor id、admin_override root fact を含める。
- `DedicatedOverrideThreadCreated`: dedicated thread id、origin place、actor id を含める。
- `WorkspaceWriteContextBound`: thread id、actor id、sandbox capability を含める。
- `WorkspaceWriteCommandAccepted`: thread id、actor id、workspace-write を許可した事実を含める。
- `OverrideEndAccepted` / `OverrideThreadArchived`: thread id、actor id、終了/archived fact を含める。
- `OverrideCommandRejected`: reason、actor id、place fact を含める。

Discord thread 作成/archive、origin place への導線返信、workspace filesystem access、Codex session 実行、session record 保存は外側責務である。Event payload が不足して Effect Handler が権限や thread identity を再推測しないようにする。

## 実装時に露出しうる局所論点

command 名、thread 名、visible copy、bootstrap prompt の文言、session key の内部形式、archive reason は実装時判断でよい。workspace-write containment、same actor、dedicated thread、end/archive 終端性は契約として残す。
