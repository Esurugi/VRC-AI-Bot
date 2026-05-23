# Boundary: Thread Cursor And Retry Progress

## 責務

message / thread / reply target ごとの処理進捗を単調に保ち、retry、duplicate、terminal failure が無言完了、重複応答、reply target 逸脱を生まないようにする。

## 関連slice

| Slice | このboundaryが支える意味 |
|---|---|
| Knowledge Thread Follow-Up Uses Known Sources | follow-up retry が same thread と known source 文脈を失わない |
| Forum Research Starter Reply | starter 処理の retry / failure が同じ forum thread で追える |
| Forum Research Mentioned Follow-Up Reply | mentioned follow-up の duplicate / retry が cursor を戻さない |
| Runtime Failure Recovery Keeps Reply Target | 成功、retry、terminal failure が元 reply target と矛盾しない |
| Storage Round-Trip Preserves Knowledge And Sessions | retry/forum progress が restart / migration 後も失われない |

## 関連USDM要求

| ID | 要求の要旨 | このboundaryで守る意味 |
|---|---|---|
| `USDM-01` | 既存 failure recovery を保護する | 無言失敗、重複応答、cursor 飛びを防ぐ |
| `USDM-05` | reply routing / persistence boundary を保つ | retry 後も reply target と progress identity を維持する |
| `USDM-06` | forum recovery、thread cursor、storage round-trip | pending retry / completed / terminal failure を区別する |

## 前提概念

Thread Cursor は内部 DB row 名ではなく、message 処理の観測上の進捗境界である。retry metadata は control plane に置き、`available_context` へ混ぜない。reply target は外側で解決済み fact として渡され、retry 後に勝手に再計算しない。

retry scheduling、Discord notification、DB I/O、failure wording は外側責務である。この boundary は、どの状態からどの Event を出せるか、duplicate をどう扱うかを所有する。

## State

- `unseen(thread_id, message_id)`: message が未観測。
- `observed(message_id, reply_target)`: 処理対象として観測され、reply target fact が固定済み。
- `processing(message_id, reply_target)`: 処理中。
- `retry_pending(message_id, attempt, reply_target)`: recoverable failure 後、retry 待ち。
- `completed(message_id, reply_message_id, reply_target)`: 完了済み。
- `terminal_failure_notified(message_id, reply_target)`: 終端失敗が可視化済み。

## Command

- `ObserveThreadMessage(message_fact, reply_target_fact)`: message と reply target を観測する。
- `StartProcessing(operation_fact)`: 処理開始 fact を反映する。
- `ScheduleRetry(operation_outcome, retry_attempt_fact)`: retry 可能 failure を retry pending にする。
- `MarkCompleted(operation_outcome, reply_message_fact)`: 成功 reply を完了として反映する。
- `MarkTerminalFailureNotified(operation_outcome, notification_fact)`: 終端失敗通知 fact を反映する。
- `HandleDuplicateProgressCommand(duplicate_fact)`: 同じ message / 古い progress / retry duplicate を処理する。

current progress state、message/thread identity、reply target fact、retry attempt fact、operation outcome fact は外から渡される Deterministic Context である。Transition 内で DB、Discord API、現在時刻、環境変数を直接読まない。

## Transition

| Current State | Command | Guard | Next State | Event | Result |
|---|---|---|---|---|---|
| `unseen(thread_id, message_id)` | `ObserveThreadMessage` | reply_target_fact が決定済み | `observed(message_id, reply_target)` | `ThreadMessageObserved` | 処理開始可能 |
| `observed(...)` | `StartProcessing` | operation_fact が同じ message | `processing(message_id, reply_target)` | `ThreadProcessingStarted` | worker / harness 実行へ進める |
| `processing(...)` | `ScheduleRetry` | operation_outcome が recoverable failure | `retry_pending(message_id, attempt, reply_target)` | `ThreadRetryScheduled` | 同じ reply target で retry 待ち |
| `processing` / `retry_pending` | `MarkCompleted` | operation_outcome が success かつ reply target が同じ | `completed(message_id, reply_message_id, reply_target)` | `ThreadProgressCompleted` | cursor はこの message まで進められる |
| `processing` / `retry_pending` | `MarkTerminalFailureNotified` | operation_outcome が terminal failure かつ notification target が同じ | `terminal_failure_notified(message_id, reply_target)` | `ThreadTerminalFailureNotified` | 無言完了にしない |
| `retry_pending(...)` | `HandleDuplicateProgressCommand` | duplicate が pending retry と同じ message | `retry_pending(...)` | `ThreadDuplicateIgnoredOrReused` | visible cursor を進めない |
| `completed(...)` | `HandleDuplicateProgressCommand` | duplicate が同じまたは古い completed message | `completed(...)` | `ThreadDuplicateIgnoredOrReused` | cursor を巻き戻さない |
| `terminal_failure_notified(...)` | `HandleDuplicateProgressCommand` | duplicate が同じ terminal failure | `terminal_failure_notified(...)` | `ThreadDuplicateIgnoredOrReused` | failure visibility を保持する |

Transition は `Current State + Command + Deterministic Context -> Next State + Events + Result` として読む。retry scheduling や通知送信は Event を受けた外側 Effect が行う。

## Invalid command policy

- cursor は後退しない。
- pending retry duplicate は completed 扱いにせず、visible cursor を進めない。
- old completed duplicate は cursor を巻き戻さない。
- terminal failure を無言完了として扱わない。
- retry 後に reply target を再計算して別 place へ返さない。
- control-plane retry metadata を `available_context` に混ぜない。

## Event / Effect boundary

Event は progress state で起きた事実である。

- `ThreadMessageObserved`: thread id、message id、reply target fact を含める。
- `ThreadProcessingStarted`: message id、attempt identity を含める。
- `ThreadRetryScheduled`: message id、attempt、reply target、retry reason fact を含める。
- `ThreadProgressCompleted`: message id、reply message id、reply target を含める。
- `ThreadTerminalFailureNotified`: message id、reply target、failure category fact を含める。
- `ThreadDuplicateIgnoredOrReused`: duplicate の扱い、cursor を進める/進めない理由を含める。

retry job 作成、Discord 通知、DB 保存、failure wording は外側責務である。Effect Handler が reply target や retry attempt を推測し直さないよう、Event payload に必要な事実を残す。

## 実装時に露出しうる局所論点

retry interval、attempt id の内部形式、failure message の文言、progress record の schema は実装時判断でよい。cursor monotonicity、same reply target recovery、facts/control plane separation は契約として残す。
