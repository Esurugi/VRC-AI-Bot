# Slice: Place Capability Assignment

## 目的

Discord channel や legacy `mode` ではなく、Feature Profile / PlaceFeature assignment を place の機能意味の正本として扱う。既存の legacy 設定は互換入力として保護しつつ、新しい routing と capability 解決が二重正本に戻らないことを保証する。

## このsliceで前提とする概念

Feature Profile は bot のユーザー向け機能集合、default scope、chat behavior をまとめる設定概念である。profile id や具体名は実装上の識別子であり、ユーザー向け機能の成立は Discord Place への assignment と結合して初めて決まる。

PlaceFeature は `conversation`、`knowledge_ingest`、`forum_research`、`admin_override` などの capability である。feature literal 単体ではなく、Feature Profile、assignment、Discord Place の組み合わせとして routing、reply target、保存 eligibility の前提になる。

legacy `locations` / `mode` は互換入力または派生ラベルである。旧設定が読み込めることは保護するが、legacy `mode` を新しい機能判断の正本として復活させない。

## このsliceで守る条件

- place の機能意味は Feature Profile / PlaceFeature assignment が正本であり、Discord channel identity や legacy `mode` だけで決めない。
- legacy 入力は互換変換後も二重正本化しない。
- 重複 place assignment、primary feature 多重、feature policy と legacy mode の矛盾は通常 routing の根拠にしない。
- migration / restart 後も、legacy compatibility data は silent drop せず、ユーザー向け機能の保存意味を保つ。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | assignment lifecycle、legacy mapping、invalid isolation、capability resolution を所有する |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-02` | channel / mode 基盤ではなく「機能定義 -> Discord place への割当」にする | Feature Profile / PlaceFeature assignment を routing と capability 解決の正本にする |
| `USDM-05` | 知見保存、通常会話、admin diagnostics、forum research の reply routing と persistence boundary を保つ | 各機能の入口が同じ assignment 解決に従う |
| `USDM-06` | feature policy と legacy mode の二重正本解消、migration preservation を保護する | legacy 互換は残すが、新旧の機能正本が発散した状態を通常動作に混ぜない |

## 前提条件

- Feature Profile と assignment を含む設定入力、または legacy 形式の互換入力が存在する。
- Discord Place の identity が guild、root channel、channel/thread、place type として解決されている。
- allowed PlaceFeature と primary feature 制約が外側から決定済みの事実として渡される。

## 結果

有効な assignment を持つ place では、利用者から見える通常会話、知見保存、forum research、admin override / diagnostics の起動可否が PlaceFeature に従う。legacy 入力由来の場合でも、後続の routing は derived PlaceFeature を読む。

不整合な assignment は通常 routing から隔離される。利用者や運用者から見ると、矛盾した設定が片方の意味だけで黙って動くことはなく、機能正本が一つに保たれる。

## 受入基準

- Feature Profile / assignment が有効な place で bot が起動されたとき、その place では割り当て済み PlaceFeature に応じたユーザー向け機能だけが有効になる。
- legacy `locations` / `mode` 形式の設定が読み込まれたとき、旧運用は壊れず、後続の機能判断は legacy `mode` ではなく互換変換された PlaceFeature に基づく。
- 同一 guild/channel の重複割当があるとき、その place は通常 chat、knowledge、forum、admin routing の根拠として使われない。
- primary feature が複数宣言されたとき、bot は片方を任意に選んで通常 routing へ進まない。
- feature policy と legacy mode が矛盾するとき、テストでは二つの正本が同時に機能を決めている状態として観測されない。

## 実装時に露出しうる局所論点

profile id の命名、validation message、legacy 互換変換の内部表現、設定ファイルの warning 表示は実装時判断でよい。
