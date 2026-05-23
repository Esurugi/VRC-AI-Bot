# Slice: Knowledge Ingest And Follow-Up

## 目的

公開情報の知見保存、URL watch root ingest、自然文の明示保存要求、knowledge thread follow-up を一貫した保存意味と reply target で扱う。保存根拠は公開かつ根拠化された source に限り、follow-up では known source と same thread の文脈を優先する。

## このsliceで前提とする概念

Knowledge Ingest は公開情報を根拠化し、共有知見として保存または返信する機能である。URL watch root の URL 投稿、自然文の明示保存要求、既存 knowledge thread の follow-up は入口が異なるが、public source eligibility と visibility の意味を共有する。

Knowledge Thread は URL ingest などから作成または再利用される public thread である。thread id、source message、root channel、knowledge record、known source URL set の結合が文脈を作る。

`knowledge_writes` は System persistence への advisory handoff であり、DB 保存完了そのものではない。保存 handoff が不完全でも、回答自体を無条件に止める理由にはしない。

## このsliceで守る条件

- `blocked_urls`、localhost、private IP、`.local`、`file:`、`data:`、`javascript:`、根拠化されていない URL は取得対象にも保存根拠にもならない。
- URL watch root の ingest は public thread を作成または再利用し、knowledge thread follow-up は same thread に返る。
- 自然文の明示保存要求は same place reply を優先し、同一 guild の `server_public` 保存意味を基本にする。
- active binding がある follow-up では known source を優先し、stale / missing binding から source を捏造しない。
- storage round-trip / migration 後も visibility、known source、thread binding のユーザー向け意味を保つ。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | knowledge ingest capability と通常 chat との入口分離を支える |
| Knowledge Thread Binding | root ingest、public thread、knowledge record、known source、follow-up active の結合を所有する |
| Thread Cursor And Retry Progress | follow-up retry / terminal failure が same thread と cursor 単調性を失わないことを支える |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | 知見保存、public thread、follow-up の外部観測を保つ |
| `USDM-05` | 知見保存、通常会話、reply routing、persistence boundary を保つ | root ingest、自然文保存、follow-up、通常 URL 会話を混同しない |
| `USDM-06` | storage round-trip、thread cursor、migration preservation を保護する | known source、thread binding、visibility、retry recovery を再起動後も維持する |

## 前提条件

- URL watch root、knowledge thread、または明示保存要求がある通常 place のいずれかである。
- 対象 URL または公開情報について、取得許可または same-turn public reconfirmation の結果が外側から事実として渡される。
- binding / known source / visibility の保存状態は、観測可能な保存意味として解決されている。

## 結果

URL watch root の eligible public source は、public thread の作成または再利用と、known source を持つ knowledge binding へ進む。保存結果の返信は public thread に現れ、後続 follow-up は same thread で known source を優先する。

自然文の明示保存要求では、bot は same place に返答し、可能な範囲で公開情報を根拠化して `server_public` の保存 handoff を返す。不完全な材料がある場合でも、何が保存意味として成立していないかを無言にしない。

## 受入基準

- knowledge ingest capability を持つ URL watch root に eligible public URL が投稿されたとき、bot は public thread を作成または再利用し、保存結果をその thread で観測できる。
- URL watch root に blocked/private/unobserved URL が投稿されたとき、その URL は保存根拠にならず、source を捏造した knowledge binding は作られない。
- 通常 conversation place で URL が貼られただけのとき、明示保存要求がなければ knowledge thread や knowledge write は発生しない。
- 利用者が同一 guild 内で自然文として公開情報の保存を明示したとき、bot は same place に返答し、公開根拠化できた範囲だけを `server_public` 保存意味として扱う。
- active binding を持つ knowledge thread で follow-up が投稿されたとき、bot は same thread に返答し、known source を優先する。
- stale / missing binding の knowledge thread で follow-up が投稿されたとき、bot は known source を捏造せず、無言失敗にもならない。
- retry や再起動をまたいだ follow-up でも、reply target は root channel へ漏れず、same thread の文脈が維持される。

## 実装時に露出しうる局所論点

thread 名、保存完了文言、URL canonicalization、タグ生成、保存できない場合の説明文、読み取りモデルの schema は実装時判断でよい。
