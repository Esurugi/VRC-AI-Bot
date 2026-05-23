# Slice: Runtime Recovery And Persistence

## 目的

Discord send、thread fetch、runtime、storage、migration をまたぐ失敗や再起動があっても、利用者から見える reply target、cursor、保存済み knowledge / session / progress の意味を保つ。無言完了、重複応答、reply target 逸脱、保存意味の silent loss を防ぐ。

## このsliceで前提とする概念

Thread Cursor は内部 DB row 名ではなく、message が observed、processing、retry pending、completed、terminal failure notified のどこまで進んだかを表す観測上の進捗境界である。cursor は後退しない。

Persistence Boundary は DB schema ではなく、restart / migration 後にも維持されるユーザー向け保存意味である。knowledge visibility、source link、thread binding、session identity、override session、retry / forum progress、legacy compatibility data を含む。

Control plane と facts plane は分離する。retry metadata、budgets、safety regeneration は control plane であり、`available_context` の user-visible facts に混ぜない。

## このsliceで守る条件

- retry / terminal failure は元 reply target と矛盾しない場所で可視化される。
- pending retry、completed、terminal failure notification は区別され、cursor は後退しない。
- terminal failure を無言完了として扱わない。
- retry 後に reply target を再計算して別 place へ返さない。
- restart / migration 後も visibility、source link、thread binding、session identity、override session、retry / forum progress、legacy compatibility data のユーザー向け意味を保つ。
- DB table 名、migration 番号、具体 repository 名を最終 UX 契約にしない。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | legacy compatibility data と migration 後の capability 意味を保つ |
| Knowledge Thread Binding | known source、thread binding、visibility の round-trip 意味を保つ |
| Forum Research Thread Progress | forum retry / refusal / terminal visible outcome と progress 保存意味を支える |
| Admin Override Thread Lifecycle | override session identity と ended / archived の保存意味を支える |
| Thread Cursor And Retry Progress | retry、duplicate、terminal failure、cursor monotonicity を所有する |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | failure recovery と保存済み状態の black-box 振る舞いを保つ |
| `USDM-05` | reply routing と persistence boundary を保つ | 返信先、保存 scope、session identity を failure / restart 後も混同しない |
| `USDM-06` | thread cursor、storage round-trip、migration preservation、forum recovery を保護する | cursor 単調性、無言失敗防止、保存意味維持を保証する |

## 前提条件

- 対象 message / thread / reply target / operation outcome が外側から事実として渡される。
- recoverable failure、terminal failure、success の分類は operation outcome fact として渡される。
- 保存済み state の読み出し、再起動、migration 後の結果は、table 名ではなくユーザー向け意味として比較される。

## 結果

recoverable failure では retry pending として進捗が残り、同じ reply target で recovery を待つ。terminal failure では、元 reply target と矛盾しない場所に可視化され、無言で処理済みにはならない。

restart / migration 後も、knowledge follow-up は known source と thread binding を保ち、admin override は session identity と ended / archived 状態を保ち、forum research は progress と reply target を保つ。legacy compatibility data は silent drop されない。

## 受入基準

- message 処理中に recoverable failure が発生したとき、進捗は retry pending として残り、visible cursor は completed として進まない。
- retry 後に reply が成功したとき、reply target は最初に解決された場所と矛盾しない。
- terminal failure が発生したとき、利用者または管理者は元 reply target と矛盾しない場所で終端失敗を確認できる。
- completed duplicate が到着したとき、cursor は巻き戻らず、重複応答が発生しない。
- pending retry duplicate が到着したとき、visible cursor は進まず、同じ reply target で recovery を待つ。
- restart 後、knowledge thread binding と known source は follow-up で同じ意味として読める。
- migration 後、legacy compatibility data は silent drop されず、旧 session が新 runtime binding として誤 reuse されない。
- retry metadata や safety regeneration instruction が `available_context` の会話 facts として利用者入力扱いされない。

## 実装時に露出しうる局所論点

retry interval、attempt id、failure 文言、progress record の内部 schema、migration の具体手順、round-trip fixture の粒度は実装時判断でよい。
