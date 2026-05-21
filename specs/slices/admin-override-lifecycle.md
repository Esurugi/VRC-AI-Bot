# Slice: Admin Override Lifecycle

## 目的

owner/admin が origin place から明示的な管理操作で dedicated override thread を起動し、workspace-write context を同一 actor の dedicated thread 内だけに閉じ込める。終了操作後は write context を閉じ、thread archive によって active override として再利用されないことを保証する。

## このsliceで前提とする概念

Admin Override Thread は owner/admin が起動する dedicated thread であり、workspace-write context を許可する唯一の場所である。origin place は導線元であり、write context の所有者ではない。

Owner/Admin は authority fact として外側から渡される。actor eligibility の取得自体は state transition ではなく、boundary 内では決定済みの事実として扱う。

workspace-write は同一 actor かつ active dedicated thread 内の turn に限定される。自然文の repo 改変要求を、その場で workspace-write に昇格しない。

## このsliceで守る条件

- owner/admin の明示管理操作だけが dedicated override thread 作成へ進む。
- workspace-write は origin place では開かず、configured admin_override root 配下の dedicated thread に閉じ込める。
- 同一 actor 以外、dedicated thread 外、終了済み thread、stale session では workspace-write を拒否する。
- 終了は同一 actor の明示操作と archive fact で観測され、TTL による勝手な終了を正本にしない。
- session identity は restart / migration 後も漏れず、旧 session を新 runtime binding として誤 reuse しない。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | admin_override capability と origin / management place の前提を解決する |
| Admin Override Thread Lifecycle | start/use/end/archive lifecycle と invalid command policy を所有する |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存管理導線を保護する | override start/use/end の外部観測を保つ |
| `USDM-04` | owner/admin が元チャンネル/元スレッドから dedicated override thread を起動し、workspace-write を dedicated thread のみに限定する | write containment、same actor、dedicated thread identity を保証する |
| `USDM-05` | admin routing と persistence boundary を保つ | origin place、dedicated thread、session identity を混同しない |
| `USDM-06` | admin diagnostics gate、storage round-trip、migration preservation を保護する | 通常 admin 会話や旧 session から workspace-write が漏れない |

## 前提条件

- actor の owner/admin eligibility が authority fact として解決されている。
- origin place と configured admin_override root が外側から事実として渡される。
- dedicated thread 作成、archive、sandbox capability、active session lookup の結果は外側責務から渡される。

## 結果

有効な開始操作では、origin place に dedicated override thread への導線が返る。workspace-write は origin place ではなく dedicated thread にだけ bound される。

dedicated thread 内で同一 actor が作業する turn は workspace-write context として扱われる。終了操作後は session が閉じられ、thread archive が観測され、以後その thread は active override として扱われない。

## 受入基準

- owner/admin が allowed origin から明示的に override 開始を行ったとき、origin place には dedicated thread への導線が返り、origin place 自体は workspace-write にならない。
- owner/admin 以外が override 開始を行ったとき、dedicated thread は作られず workspace-write も開かれない。
- active dedicated thread 内で開始 actor が turn を行ったとき、その turn だけが workspace-write context として扱われる。
- active dedicated thread 内でも別 actor が turn を行ったとき、workspace-write context は拒否される。
- dedicated thread 外で repo 改変を求める自然文が投稿されたとき、その場で workspace-write に昇格しない。
- 同一 actor が active dedicated thread 内で終了操作を行ったとき、session close と thread archive が観測される。
- 終了済み thread や stale session が再利用されそうなとき、active override として扱われない。

## 実装時に露出しうる局所論点

管理操作の UI、thread 名、origin place へ返す導線文、bootstrap prompt の文言、session key の内部形式、archive reason は実装時判断でよい。
