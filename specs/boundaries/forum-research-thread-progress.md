# Boundary: Forum Research Thread Progress

## 責務

forum research thread 内の starter / mentioned follow-up / non-mention follow-up の起動可否、final candidate の safety-before-publish 通過、same forum thread での retry / refusal / terminal visible outcome を所有する。

## 関連slice

| Slice | このboundaryが支える意味 |
|---|---|
| Forum Research Starter Reply | starter は mention なしで処理開始し、same forum thread に安全通過後 publish される |
| Forum Research Mentioned Follow-Up Reply | starter 後 follow-up は bot mention がある場合だけ文脈付きで処理される |
| Forum Research Non-Mention Follow-Up Is Ignored | non-mention follow-up は reply / processing reaction なしで ignore される |
| Runtime Failure Recovery Keeps Reply Target | retry / terminal failure が同じ forum thread と矛盾しない場所で可視化される |

## 関連USDM要求

| ID | 要求の要旨 | このboundaryで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | forum research の外部観測を維持する |
| `USDM-03` | starter は応答、follow-up は mention 時だけ起動し文脈保持 | 起動規則と文脈単位を state transition として固定する |
| `USDM-05` | forum research の reply routing / persistence boundary を保つ | same forum thread と progress 保存意味を守る |
| `USDM-06` | safety-before-publish、forum recovery、thread cursor | unsafe publish と cursor 後退を防ぐ |

## 前提概念

Forum Research Thread は forum parent channel 配下の post thread であり、parent channel 自体を research conversation の reply target にしない。starter message は mention 不要で起動対象、starter 後の follow-up は bot mention がある場合だけ起動対象である。

Safety-Before-Publish は単体 boundary ではなく、この boundary の `safety_pending` から publish へ進む gate として扱う。長文生成、source appendix、safety 評価実装、Discord publish は外側責務である。

## State

- `thread_ready(thread_id, starter_message_id)`: forum post thread と starter が確定済み。
- `starter_processing(message_id, reply_target)`: starter を処理中。
- `follow_up_processing(message_id, reply_target)`: mentioned follow-up を処理中。
- `candidate_produced(message_id, candidate_id)`: 公開候補が生成済み。
- `safety_pending(candidate_id, reply_target)`: publish 前 safety gate 待ち。
- `published(reply_message_id, reply_target)`: safe reply が公開済み。
- `retry_visible(reply_target, reason)`: retry / refusal が利用者に見える状態。
- `terminal_failure_visible(reply_target, reason)`: 終端失敗が無言でなく可視化済み。
- `non_mention_ignored(message_id)`: non-mention follow-up を ignore 済み。

## Command

- `AcceptForumStarter(message_facts)`: starter message を処理対象として受理する。
- `AcceptMentionedFollowUp(message_facts)`: bot mention 付き follow-up を受理する。
- `IgnoreNonMentionFollowUp(message_facts)`: non-mention follow-up を ignore として記録する。
- `SubmitFinalCandidateForSafety(candidate_fact)`: 生成済み candidate を publish 前 gate に渡す。
- `PublishSafeForumReply(safety_result, reply_fact)`: safety 通過済み reply fact を反映する。
- `WithholdUnsafeCandidate(safety_result)`: unsafe candidate を公開せず保留/拒否へ進める。
- `MarkForumRetryVisible(retry_fact)`: retry / refusal の可視化 fact を反映する。
- `MarkForumTerminalFailure(failure_fact)`: 終端失敗可視化 fact を反映する。

starter/follow-up 判定、mention fact、conversation context snapshot、safety result、reply target fact、cursor state fact は外側から渡す。Transition 内で Discord fetch、現在時刻、生成器、safety evaluator、DB を直接読まない。

## Transition

| Current State | Command | Guard | Next State | Event | Result |
|---|---|---|---|---|---|
| `thread_ready(...)` | `AcceptForumStarter` | message_facts が starter と一致 | `starter_processing(message_id, reply_target)` | `ForumStarterAccepted` | 研究応答生成へ進める |
| `thread_ready` / `published` / `retry_visible` | `AcceptMentionedFollowUp` | starter 以外で bot mention あり | `follow_up_processing(message_id, reply_target)` | `ForumMentionedFollowUpAccepted` | context snapshot を使う応答生成へ進める |
| any active forum state | `IgnoreNonMentionFollowUp` | starter 以外で bot mention なし | `non_mention_ignored(message_id)` | `ForumNonMentionFollowUpIgnored` | no reply / no processing reaction |
| `starter_processing` / `follow_up_processing` | `SubmitFinalCandidateForSafety` | candidate_fact が対象 message と一致 | `safety_pending(candidate_id, reply_target)` | `ForumCandidateProduced` | publish はまだ不可 |
| `safety_pending(...)` | `PublishSafeForumReply` | safety_result が safe で reply_fact が同じ reply_target | `published(reply_message_id, reply_target)` | `ForumSafetyPassed`, `ForumReplyPublished` | same forum thread に公開済み |
| `safety_pending(...)` | `WithholdUnsafeCandidate` | safety_result が unsafe または publish 不可 | `retry_visible(reply_target, safety_result.reason)` | `ForumUnsafeCandidateWithheld`, `ForumRetryVisible` | unsafe candidate は公開されない |
| `starter_processing` / `follow_up_processing` / `safety_pending` | `MarkForumRetryVisible` | retry_fact が同じ reply_target | `retry_visible(reply_target, reason)` | `ForumRetryVisible` | 同じ target で retry / refusal が見える |
| `starter_processing` / `follow_up_processing` / `safety_pending` / `retry_visible` | `MarkForumTerminalFailure` | failure_fact が terminal かつ同じ reply_target | `terminal_failure_visible(reply_target, reason)` | `ForumTerminalFailureVisible` | 無言失敗にしない |

Transition は `Current State + Command + Deterministic Context -> Next State + Events + Result` として読む。Safety-Before-Publish は `safety_result` として渡される決定済み材料であり、Transition 内で評価しない。

## Invalid command policy

- forum parent channel 自体では research reply を開始しない。
- starter 以外の non-mention follow-up は no reply / no processing reaction として ignore する。
- safety 未通過 candidate は Discord publish 不可。
- unsafe candidate を publish してから retry/refusal にすることは禁止する。
- retry / duplicate / recovery は Thread Cursor And Retry Progress の単調性に従い、reply target を変えない。

## Event / Effect boundary

Event は forum progress で起きた事実である。

- `ForumStarterAccepted` / `ForumMentionedFollowUpAccepted`: message id、thread id、reply target、context snapshot id を含める。
- `ForumNonMentionFollowUpIgnored`: message id、no reply の意味を含める。
- `ForumCandidateProduced`: candidate id、対象 message id、publish 前である事実を含める。
- `ForumSafetyPassed` / `ForumUnsafeCandidateWithheld`: safety result と publish 可否を含める。
- `ForumReplyPublished` / `ForumRetryVisible` / `ForumTerminalFailureVisible`: reply target、visible outcome、関連 cursor fact を含める。

長文生成、source appendix 作成、safety 判定、Discord send、retry scheduling、progress record 保存は Effect Handler / Application Service / Provider の責務である。Event payload に reply target と candidate / message identity がないために Effect Handler が forum state を読み直して推測する設計にしない。

## 実装時に露出しうる局所論点

context snapshot の保存形式、appendix 表示形式、retry 文言、chunking、内部 job 名は実装時判断でよい。starter / mention-only / non-mention ignore、publish 前 safety、same-thread visibility は契約として残す。
