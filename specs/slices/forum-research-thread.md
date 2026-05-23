# Slice: Forum Research Thread

## 目的

forum research thread では starter に応答し、starter 後の follow-up は bot mention がある場合だけ起動する。non-mention follow-up には割り込まず、公開 reply は publish 前に安全確認を通過してから same forum thread に出る。

## このsliceで前提とする概念

Forum Research Thread は `forum_research` PlaceFeature が割り当てられた forum parent 配下の post thread である。parent forum channel 自体を会話単位や reply target として扱わない。

Forum Starter Message は forum post thread の初回投稿であり、mention なしで起動対象になる。Forum Follow-Up は starter 後の message であり、最新要求では bot mention がある場合だけ起動する。

Safety-Before-Publish は単体 boundary ではなく、final public candidate を Discord に送る前に根拠、安全、出力境界を確認する横断条件である。unsafe candidate は先に公開しない。

## このsliceで守る条件

- forum research の起動可否は forum post thread、starter/follow-up facts、mention fact、PlaceFeature assignment に基づく。
- starter は mention なしで応答対象になる。
- starter 後の follow-up は mention only 起動であり、non-mention は no reply / no processing reaction として ignore する。
- final public reply は safety 通過後に same forum thread へ publish される。
- retry、duplicate、terminal failure は cursor 単調性と同じ reply target を守る。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | forum_research capability の前提を解決する |
| Forum Research Thread Progress | starter、mentioned follow-up、non-mention ignore、safety pending、publish / withhold の進捗を所有する |
| Thread Cursor And Retry Progress | retry / duplicate / terminal failure で cursor と reply target を保つ |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | forum research の starter 応答、follow-up 応答、ignore、recovery の外部観測を保つ |
| `USDM-03` | forum / research thread は starter で応答し、follow-up は bot mention 時だけ起動し文脈を保つ | mention only 起動と same forum thread 文脈を保証する |
| `USDM-05` | forum research の reply routing と persistence boundary を保つ | parent forum channel、forum post thread、reply target、progress 保存意味を混同しない |
| `USDM-06` | forum final safety-before-publish、forum recovery、thread cursor を保護する | unsafe publish、無言失敗、cursor 後退を防ぐ |

## 前提条件

- 対象 place は forum_research capability を持つ forum post thread である。
- starter message id、follow-up message facts、bot mention の有無が外側から決定済み事実として渡される。
- conversation context snapshot、safety result、reply target fact、cursor state fact は control / facts の境界を分けて渡される。

## 結果

starter message には、研究・長文相談の最初の入力として same forum thread に応答が返る。starter 後の mentioned follow-up では、同じ forum thread の文脈を保った応答が返る。

non-mention follow-up は処理されず、reply も processing reaction も観測されない。unsafe candidate は Discord に公開されず、retry、refusal、または terminal visible outcome が same forum thread と矛盾しない場所で観測される。

## 受入基準

- forum_research capability を持つ forum post thread で starter message が作られたとき、bot は mention なしでも処理を開始し、safe reply を same forum thread に publish する。
- starter に対する final public candidate が unsafe のとき、その candidate は Discord に先に送られず、retry / refusal / terminal visible outcome が same forum thread で観測される。
- starter 後の follow-up に bot mention があるとき、bot は同じ forum thread の文脈を使って応答する。
- starter 後の follow-up に bot mention がないとき、bot は応答せず、処理中リアクションも出さない。
- forum parent channel に投稿された通常 message は、forum research reply の対象として扱われない。
- retry または duplicate が発生したとき、同じ forum thread の reply target が維持され、cursor は後退しない。

## 実装時に露出しうる局所論点

starter 判定の内部手段、文脈取得件数、context snapshot の保存形式、appendix 表示形式、長文応答の chunking、retry 文言は実装時判断でよい。
