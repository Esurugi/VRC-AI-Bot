# Boundary: Place Capability Assignment

## 責務

Discord Place のユーザー向け機能意味を Feature Profile / PlaceFeature assignment から決め、legacy `mode` を互換・派生ラベルに留める。重複割当、primary feature 多重、feature policy と legacy mode の矛盾を通常 routing の根拠にしない。

## 関連slice

| Slice | このboundaryが支える意味 |
|---|---|
| Feature Profile Assignment Loads A Place | guild/channel に割り当てられた Feature Profile から PlaceFeature が有効になる |
| Legacy Watch Location Remains Compatibility Only | legacy `locations` / `mode` は互換入力であり、機能正本へ戻らない |
| Normal Chat / Knowledge / Forum / Admin routing 系 slice | 各 routing の起動可否は channel identity ではなく PlaceFeature assignment を前提にする |

## 関連USDM要求

| ID | 要求の要旨 | このboundaryで守る意味 |
|---|---|---|
| `USDM-02` | channel / mode 基盤ではなく「機能定義 -> Discord place への割当」にする | Feature Profile / PlaceFeature assignment を機能正本にする |
| `USDM-05` | reply routing と persistence boundary を保つ | routing の前提 capability を一貫して解決する |
| `USDM-06` | feature policy と legacy mode の二重正本解消、migration preservation | legacy mode との矛盾を通常 state に混ぜない |

## 前提概念

Feature Profile は feature set を持つ設定概念であり、状態所有者ではない。Discord channel は Feature Profile を所有せず、assignment の対象である。PlaceFeature は feature literal 単体ではなく、profile、assignment、place と結合して観測意味を持つ。

legacy `mode` は compatibility input または derived label である。`mode` だけを routing の正本に戻すと、knowledge/admin/forum/chat の可否が feature assignment と発散する。

## State

- `unassigned(place_id)`: 対象 place に有効 assignment がない。
- `assigned(place_id, profile_id, place_features, primary_feature)`: Feature Profile 由来の有効 features が解決済み。
- `legacy_mapped(place_id, legacy_mode, derived_place_features)`: legacy 入力を互換変換したが、正本は derived PlaceFeature 側にある。
- `invalid_isolated(place_id, reason)`: 重複割当、unknown profile、primary feature 多重、legacy/features 矛盾などにより routing 根拠から隔離された。

## Command

- `LoadPlaceAssignments(config_snapshot)`: 決定済み設定 snapshot から assignment を読み込む。
- `ApplyLegacyCompatibility(legacy_snapshot, mapping_rules)`: legacy 入力を PlaceFeature へ互換変換する。
- `ResolvePlaceCapabilities(place_id)`: place の有効 capabilities を解決する。
- `RejectInvalidAssignment(place_id, reason)`: 外側 validation または migration で確定した invalid reason を反映する。

遷移判断に必要な設定内容、legacy 入力、既存 assignment record、allowed feature literals は Command または Deterministic Context として渡される。Transition は設定ファイル、DB、Discord API、環境変数を直接読まない。

## Transition

| Current State | Command | Guard | Next State | Event | Result |
|---|---|---|---|---|---|
| `unassigned(place_id)` | `LoadPlaceAssignments` | config に対象 place の profile assignment があり、profile と features が有効 | `assigned(place_id, profile_id, place_features, primary_feature)` | `PlaceCapabilitiesAssigned` | capability 解決に使える |
| `unassigned(place_id)` | `ApplyLegacyCompatibility` | legacy mode が mapping_rules で PlaceFeature に変換可能 | `legacy_mapped(place_id, legacy_mode, derived_place_features)` | `LegacyAssignmentMapped` | derived PlaceFeature として解決可能、legacy mode は正本ではない |
| `legacy_mapped(...)` | `ResolvePlaceCapabilities` | derived features が allowed feature literals と primary feature 制約を満たす | `assigned(place_id, derived_profile_id, derived_place_features, primary_feature)` | `PlaceCapabilitiesResolved` | compatibility 由来として capability を返す |
| `unassigned` / `assigned` / `legacy_mapped` | `RejectInvalidAssignment` | reason が決定済み invalid reason | `invalid_isolated(place_id, reason)` | `PlaceAssignmentRejected` | routing 根拠に使わない |
| `assigned(place_id, ...)` | `ResolvePlaceCapabilities` | state が invalid でない | `assigned(place_id, ...)` | `PlaceCapabilitiesResolved` | 有効 PlaceFeature set を返す |
| `invalid_isolated(place_id, reason)` | `ResolvePlaceCapabilities` | 常に | `invalid_isolated(place_id, reason)` | `PlaceAssignmentRejected` | capability を返さず、拒否理由を返す |

Transition は `Current State + Command + Deterministic Context -> Next State + Events + Result` として読む。duplicate place assignment、primary feature 多重、feature policy と legacy mode の矛盾は、決定済み context として渡された時点で `invalid_isolated` または rejection へ進む。

## Invalid command policy

- `invalid_isolated` の place は通常 chat、knowledge ingest、forum research、admin override、admin diagnostics の routing 根拠にしない。
- Discord channel identity や legacy `mode` だけで PlaceFeature を決定してはいけない。
- unknown profile、allowed feature 外の feature、primary feature 多重は、黙って fallback せず rejection または isolation にする。
- legacy 入力の互換変換後も、後続 boundary へ渡す正本は PlaceFeature assignment であり、legacy mode ではない。

## Event / Effect boundary

Event は assignment 状態で起きた事実である。

- `PlaceCapabilitiesAssigned`: place id、profile id、features、primary feature を payload に含める。
- `LegacyAssignmentMapped`: legacy mode、derived features、compatibility 由来である事実を payload に含める。
- `PlaceAssignmentRejected`: place id、reason、routing に使えない事実を payload に含める。
- `PlaceCapabilitiesResolved`: place id、有効 features、primary feature を payload に含める。

設定ファイル I/O、migration 実行、DB 保存、Discord place 取得は Effect Handler / Application Service / Provider の責務である。Event payload 不足を理由に後続 routing が legacy mode や channel identity を読み直して意味判断してはいけない。

## 実装時に露出しうる局所論点

profile id の命名、validation message、compatibility mapping の内部表現、assignment record の保存形式は、上記契約を保つ限り実装時判断でよい。
