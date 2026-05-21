# Slice: Admin Diagnostics

## 目的

admin_control / admin_override の管理 place で、owner/admin が明示的に diagnostics を要求したときだけ管理用結果を返す。通常の admin 会話や権限質問を diagnostics JSON に奪わず、管理情報を非 admin place へ漏らさない。

## このsliceで前提とする概念

Admin Diagnostics は管理 place で明示 diagnostics request または管理操作の事実がある turn だけ発生する結果である。固定文言 trigger list を System の正本にせず、明示 intent または操作 fact と authority / place gate を分けて扱う。

Owner/Admin は authority fact として扱う。admin place にいることだけ、または owner/admin であることだけでは diagnostics にはならない。

Reply Target は diagnostics の場合 same management place である。通常 admin chat は diagnostics outcome ではなく chat reply として扱う。

## このsliceで守る条件

- diagnostics は admin_control / admin_override 管理 place、owner/admin、明示 diagnostics request または管理操作 fact の gate を通る。
- 固定文言 trigger list を最終 UX 契約にしない。
- 通常の権限質問、管理 place の雑談、override 操作結果、terminal failure notification を diagnostics JSON と混同しない。
- admin diagnostics を非 admin place に出さない。
- facts plane と control plane を混ぜず、retry metadata を利用者入力や診断本文として扱わない。

## 関連する採用済みboundary

| Boundary | このsliceで依存する契約 |
|---|---|
| Place Capability Assignment | admin_control / admin_override 相当の管理 place capability を解決する |

## 関連USDM要求

| ID | 要求の要旨 | このsliceで守る意味 |
|---|---|---|
| `USDM-01` | 既存ユーザー向け機能を保護する | admin diagnostics と通常 admin chat の外部観測を保つ |
| `USDM-05` | admin diagnostics の reply routing と persistence boundary を保つ | diagnostics は管理 place だけに返し、通常会話を奪わない |
| `USDM-06` | admin diagnostics gate を保護する | owner/admin、管理 place、明示要求の gate を破らない |

## 前提条件

- 対象 place が admin_control / admin_override 相当の管理 place として解決されている。
- actor の owner/admin eligibility が authority fact として渡されている。
- diagnostics の明示 intent または管理操作 fact が、通常会話とは別の事実として渡されている。

## 結果

条件を満たす diagnostics request では、bot は same management place に診断結果を返す。条件を満たさない場合は、通常会話として返るか、権限・場所の不足が観測され、diagnostics 情報は公開されない。

## 受入基準

- owner/admin が admin_control / admin_override 管理 place で明示 diagnostics を要求したとき、bot は same management place に diagnostics 結果を返す。
- owner/admin が管理 place で通常の質問や権限確認をしたとき、それは diagnostics JSON として返らず通常会話として扱われる。
- admin place ではない場所で diagnostics を求められたとき、管理診断情報はその場所へ出ない。
- owner/admin ではない actor が diagnostics を求めたとき、diagnostics 結果は返らない。
- diagnostics の可否が固定文言リストだけで決まっているような外部観測にならない。

## 実装時に露出しうる局所論点

diagnostics の表示 field、通常会話との境界テストの phrasing、読み取り projection の内部構成、管理操作 UI の細部は実装時判断でよい。
