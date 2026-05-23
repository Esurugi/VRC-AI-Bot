# Slice: Conversation Routing

## 目的

通常会話は same place に自然文で返し、ambient chat では明示呼び出し以外の雑談へ過剰反応しない。通常 chat に貼られた URL は、明示保存要求がない限り知見保存や thread 作成へ自動昇格しない。

## このsliceで前提とする概念

Discord Place は利用者が bot とやり取りする場所であり、root channel と thread を同一視しない。通常会話の reply target は原則 same place だが、これは channel identity だけで決まるのではなく、PlaceFeature assignment と会話入口の意味から導かれる。

Reply Target は独立 state-owner ではない。通常会話では、PlaceFeature、message の扱い、thread binding の有無、ignore 判定などから公開応答先または no reply が決まる。

Knowledge Ingest は通常 chat の URL 会話とは異なる。URL が含まれていても、URL watch root ingest または明示保存要求でなければ、会話材料として扱う。

## このsliceで守る条件

- 通常会話の起動可否は PlaceFeature assignment に基づき、legacy `mode` や channel identity だけで決めない。
- chat reply は原則 same place に返る。
- 通常 chat の URL は明示保存要求なしに knowledge thread 化しない。
- ambient chat の sparse behavior は明示呼び出しを妨げない。
- Safety-Before-Publish と public source eligibility は、通常会話で source を扱う場合にも破らない。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | conversation capability と ambient behavior の前提になる PlaceFeature を解決する |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | 通常会話と sparse reply の外部観測を壊さない |
| `USDM-05` | 通常会話、知見保存、reply routing を保つ | 通常 chat と knowledge ingest の入口を混同しない |
| `USDM-06` | reply routing と safety / source policy を保護する | URL 会話を未根拠の知見保存や公開 source として扱わない |

## 前提条件

- 対象 place に conversation capability が割り当てられている。
- message が forum research、knowledge thread follow-up、admin override、admin diagnostics の専用入口ではない。
- ambient chat behavior が設定されている場合、その設定は PlaceFeature assignment の一部として解決済みである。

## 結果

通常会話として扱われる発言には、bot が同じ place に自然文で応答する。ambient chat では、明示 mention や bot への reply のような呼び出しは応答候補になり、普通の雑談は必要に応じて no reply になる。

通常 chat に URL が含まれていても、それだけで public thread は作成されず、knowledge write の handoff も発生しない。URL は会話文脈の材料として扱われる。

## 受入基準

- conversation capability を持つ通常会話 place で利用者が bot 宛てに質問したとき、bot は same place に自然文で返答する。
- ambient chat place で明示呼び出しではない雑談が続くとき、bot は全発言へ反応せず、no reply が観測される。
- ambient chat place で利用者が明示 mention または bot への reply を行ったとき、sparse behavior だけを理由に応答候補から外れない。
- 通常会話 place に URL だけが貼られたとき、knowledge thread は作成されず、知見保存完了として扱われない。
- 通常会話で source を参照する返答を行うとき、取得禁止 URL や未根拠 URL を公開 source として扱わない。

## 実装時に露出しうる局所論点

sparse の内部カウント方式、疑問符の扱い、返信文言、分割送信の chunk サイズ、表示リアクションは実装時判断でよい。
