# Phase 2 結果

この文書は Phase 2 の分類結果であり、state-transition boundary の採用確定、統合削除、final boundary 名、slice 生成を行わない。
入力は `USDM-01`..`USDM-07`、Phase 1 結果、および Blocking Issues なし / Phase 0b外新規候補なしという前提で読む。

## C1 State-transition Boundary Candidates

### Place Capability Assignment
- 検討カテゴリ: C1-thin / C7 / C8 / C11 / C14。Feature Profile 単体は C7 Setting/Profile だが、place への assignment lifecycle と invalid policy が残るため C1-thin を検査対象に残す。
- 主分類: C1 State-transition boundary candidate
- 分類理由: 未割当、割当済み、legacy 互換由来、不整合、隔離相などが、設定読み込み・同期・互換変換・有効機能解決の受理可否と結果を変える。重複割当、primary feature 多重、legacy mode との二重正本化を拒否または隔離する否定権が複数 routing の観測意味を支える。
- 分割候補: あり: Feature Profile 定義は C7、設定読み込み手順は C8、migration / compatibility batch は C11、保存された assignment record は C14 に分ける。
- 外へ出す責務: 設定ファイル I/O、migration 実行、Discord place 取得、Feature Profile の詳細定義、owner/admin policy。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-02` feature profile から Discord place へ割当; `USDM-05` reply routing / persistence boundary; `USDM-06` feature policy と legacy mode の二重正本解消、migration preservation
- 確度: 仮説

### Knowledge Thread Binding
- 検討カテゴリ: C1 / C8 / C9 / C10 / C14。public fetch、要約、thread 作成、DB write を外へ出しても、source message / knowledge record / public thread / known sources の結合状態が残る。
- 主分類: C1 State-transition boundary candidate
- 分類理由: binding なし、ingest 受理済み、thread 作成済み、source linked、follow-up active、missing / stale の相が、root URL ingest と knowledge thread follow-up の扱いを変える。active binding では same thread と known source 優先になり、根拠化できない URL や blocked/private URL は binding 根拠として拒否される。
- 分割候補: あり: public source fetch は C10、保存 handoff 生成は Harness contract / C8、Discord thread 作成は C9、保存 record の同一性は C14 に分ける。
- 外へ出す責務: 外部公開取得、要約・保存意図生成、Discord thread 作成、保存 I/O、URL canonicalization の細部。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 知見保存振る舞い保護; `USDM-05` knowledge ingest / follow-up の reply routing と persistence boundary; `USDM-06` storage round-trip、thread cursor、migration preservation
- 確度: 仮説

### Forum Research Thread Progress
- 検討カテゴリ: C1 / C6 / C8 / C9 / C13 / C14。generation、source appendix、safety policy、Discord publish、cursor persistence を外へ出しても、forum thread の進捗と起動可否が残る。
- 主分類: C1 State-transition boundary candidate
- 分類理由: starter pending、research in progress、candidate produced、safety pending、published、retry visible、terminal failure visible、ignored non-mention などの相が、starter / mentioned follow-up / non-mention follow-up の受理可否、公開可否、失敗可視化を変える。safety-before-publish は単体 C1 ではなく、この候補の publish 前 gate / policy として投影する。
- 分割候補: あり: safety-before-publish は C6、長文生成と appendix は Harness contract / C8、Discord publish は C9、retry 実行は C13、進捗保存 record は C14 に分ける。
- 外へ出す責務: Discord message fetch / send、生成・要約・参照 appendix、safety 評価、retry scheduling、保存 I/O、forum parent の feature assignment。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` forum 振る舞い保護; `USDM-03` starter 応答 / follow-up mention only / 文脈保持; `USDM-05` forum reply routing / persistence boundary; `USDM-06` safety-before-publish、forum recovery、thread cursor
- 確度: 仮説

### Admin Override Thread Lifecycle
- 検討カテゴリ: C1 / C6 / C8 / C9 / C10 / C14。権限解決、thread 作成、workspace 実行を外へ出しても、dedicated override thread の start/use/end/archive lifecycle と invalid policy が残る。
- 主分類: C1 State-transition boundary candidate
- 分類理由: active なし、開始要求、dedicated thread 作成済み、同一 actor active、終了要求、終了済み、stale / wrong actor の相が、workspace-write context の受理可否を変える。owner/admin 以外、dedicated thread 外、別 actor、終了済み thread では write context を拒否する契約が観測仕様を守る。
- 分割候補: あり: actor eligibility は C6、Discord thread 作成 / archive は C9、Codex session 実行は C8 / C10、保存 record は C14 に分ける。
- 外へ出す責務: 権限取得、Discord thread 作成・archive、workspace filesystem access、Codex session 実行、thread 名や visible copy。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 管理導線保護; `USDM-04` dedicated override thread と workspace-write 限定; `USDM-05` admin routing / persistence boundary; `USDM-06` admin diagnostics gate、storage round-trip、migration preservation
- 確度: 仮説

### Thread Cursor And Retry Progress
- 検討カテゴリ: C1 / C8 / C9 / C13 / C14。retry scheduling、通知、保存 I/O を外へ出しても、message / thread / reply target に対する進捗相と単調性が残る。
- 主分類: C1 State-transition boundary candidate
- 分類理由: 未観測、取得済み、処理中、retry 待ち、完了、終端失敗通知済みの相が、duplicate / retry / recovery の Command 結果を変える。pending retry duplicate は visible cursor を進めず、完了済み duplicate は巻き戻さず、終端失敗は元 reply target と矛盾しない通知を必要とする。
- 分割候補: あり: retry scheduling は C13 / C8、Discord 通知は C9、保存 record は C14、failure wording は Harness contract に分ける。
- 外へ出す責務: retry 実行、Discord 通知、保存 I/O、retry metadata の control plane 管理、ユーザー向け説明文。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` failure recovery 保護; `USDM-05` reply routing / persistence boundary; `USDM-06` forum recovery、thread cursor、storage round-trip
- 確度: 仮説

## C2 Absorbed-into-parent Candidates

### Reply Target Resolution state fragments
- 検討カテゴリ: C2 / C8 / C12 / C6 / C9。重要な候補だが、send side effect、safety gate、thread binding、cursor を外へ出すと、独立した状態所有者としての厚みは弱い。
- 主分類: C2 Absorbed-into-parent candidate
- 分類理由: same place、created public thread、existing thread、no reply、failure notification などの状態片は、Knowledge Thread Binding、Forum Research Thread Progress、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress の親状態に吸収される方が自然である。Reply Target Resolution 自体は複数 source state と policy を合成して destination command / effect を組む C8/C12 に近い。
- 分割候補: あり: destination resolution 手順、safety-before-publish gate、Discord send / thread creation、parent boundary の reply target state fragment に分ける。
- 外へ出す責務: Discord send / thread creation、public wording、source selection、safety policy、保存 I/O。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 振る舞い保護; `USDM-05` reply routing / persistence boundary; `USDM-06` safety-before-publish、forum recovery、thread cursor
- 確度: 仮説

### Persistence Boundary Registry state fragments
- 検討カテゴリ: C2 / C11 / C14 / C6。registry 名義では広すぎるが、保存意味の一部は個別 parent boundary の state fragment として残る。
- 主分類: C2 Absorbed-into-parent candidate
- 分類理由: knowledge visibility、thread binding、session identity、override session、retry / forum progress の保存意味は重要だが、registry 単体で自然な domain Command と一貫した状態相を持つというより、Knowledge Thread Binding、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress、Forum Research Thread Progress、Place Capability Assignment に吸収される。DB table や migration 番号は契約化しない。
- 分割候補: あり: 保存対象ごとの record boundary、migration batch、visibility policy、reopen / round-trip invariant に分ける。
- 外へ出す責務: 実 DB schema、migration 手順、repository method、保存 I/O。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 保存済み機能保護; `USDM-05` persistence boundary; `USDM-06` storage round-trip、migration preservation、thread cursor
- 確度: 仮説

## C3-C14 Outer Responsibilities

### Reply Target Resolution
- 検討カテゴリ: C8 / C12 / C6 / C9 / C2。C1-thin は厳しく検査したが、独自の永続 state と自然な Command lifecycle が薄く、状態片は親候補に吸収される。
- 主分類: C8 Application Service / C12 Readiness gate
- 分類理由: 発話元 place、place capability、Harness outcome、safety 結果、既存 binding、provider 結果を合成し、Discord send / thread creation へ渡す手順に近い。状態による送信先変化は重要だが、その状態の所有元は knowledge / forum / admin / cursor 側であり、Resolution 自体が state-owner になるとはまだ言えない。
- 分割候補: あり: C2 に記録
- 外へ出す責務: C9 Discord send / thread creation、C6 safety-before-publish policy、Harness wording / source selection、Persistence I/O。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-05` reply routing と persistence boundary; `USDM-06` safety-before-publish、forum recovery、thread cursor
- 確度: 仮説

### Persistence Boundary Registry
- 検討カテゴリ: C14 / C11 / C6 / C2。保存意味は強いが、registry 単体を C1 にすると広すぎ、個別 record / migration / visibility invariant を束ねる名前になりやすい。
- 主分類: C14 Data Entity/Record Boundary / C11 Import/Batch boundary
- 分類理由: 保存対象の同一性、visibility、source link、thread binding、session identity、retry / forum progress、legacy 隔離は user-visible な保存意味を守る。ただし Command 受理可否や遷移先を registry 自身の状態相が決めるより、各 parent boundary と migration / round-trip invariant が決める。DB table や migration 番号、repository method は仕様契約にしない。
- 分割候補: あり: C2 に記録
- 外へ出す責務: Persistence 実装、migration 実行、保存形式、repository API、round-trip fixture の粒度。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 保存済み機能保護; `USDM-05` persistence boundary; `USDM-06` storage round-trip、migration preservation、thread cursor
- 確度: 仮説

### Admin Diagnostics Gate
- 検討カテゴリ: C6 / C12 / C8 / C4。重要な gate だが、C1-thin の条件は満たしきらない。explicit diagnostics requested は per-turn deterministic context であり、永続 lifecycle ではない。
- 主分類: C6 Cross-cutting policy / C12 Readiness gate
- 分類理由: admin place、owner/admin eligibility、明示 diagnostics intent を合成し、diagnostics と通常 chat を分ける許可・拒否規則である。normal admin chat、accepted diagnostics、rejected outside admin place は外部観測上重要だが、状態所有者というより情報漏えい防止と normal-chat-stealing 防止の policy / gate として扱う。
- 分割候補: あり: diagnostics 情報収集は C8 / System boundary、表示結果は C4、actor eligibility は C6、reply delivery は C9。
- 外へ出す責務: actor eligibility、diagnostics 情報収集、通常会話の意味判断と文言、Discord send。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-01` 管理診断振る舞い保護; `USDM-05` admin diagnostics reply routing / persistence boundary; `USDM-06` admin diagnostics gate、feature policy と legacy mode の二重正本解消
- 確度: 仮説

### Safety-Before-Publish
- 検討カテゴリ: C6 / C12。Phase 1 とユーザー指示に従い、単体 C1 にはしない。
- 主分類: C6 Cross-cutting policy
- 分類理由: final response を Discord に公開する前の根拠・安全・出力境界の gate であり、Forum Research Thread Progress と Reply Target Resolution の公開可否に投影する材料である。publish side effect は C9、意味・根拠・sources_used は Harness contract 側に置く。
- 分割候補: なし
- 外へ出す責務: safety 判定実装、Discord publish、retry / refusal wording。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-06` safety-before-publish; `USDM-03` forum starter / mentioned follow-up; `USDM-05` reply routing
- 確度: 確定

### Feature Profile
- 検討カテゴリ: C7 / C14。単体では state-transition boundary にしない。
- 主分類: C7 Setting/Profile
- 分類理由: bot の機能集合、default scope、chat behavior を定義する設定・profile であり、Command 受理可否を自前の lifecycle で変える主体ではない。assignment lifecycle と invalid policy は Place Capability Assignment 側で検査する。
- 分割候補: なし
- 外へ出す責務: profile id / feature list / default scope の設定値管理。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-02` feature profile から place への割当; `USDM-06` legacy mode との二重正本解消
- 確度: 確定

### Owner/Admin Eligibility
- 検討カテゴリ: C6 / C10。単体では状態所有者ではない。
- 主分類: C6 Cross-cutting policy
- 分類理由: admin override と admin diagnostics の起動可否に使う actor eligibility policy である。actor facts は外から渡され、Admin Override Thread Lifecycle や Admin Diagnostics Gate の受理可否に投影される。
- 分割候補: なし
- 外へ出す責務: Discord 権限取得、owner 設定、actor facts 提供。
- Phase 0b外理由の検査: 該当なし
- USDM参照: `USDM-04` owner/admin の override 起動; `USDM-05` admin diagnostics / routing
- 確度: 確定

## Split Candidates

- Place Capability Assignment: Feature Profile 定義、assignment lifecycle、legacy compatibility batch、保存 record を分ける。
- Reply Target Resolution: parent boundary の reply target state fragment、destination resolution service、safety gate、Discord send / thread creation effect を分ける。
- Knowledge Thread Binding: binding identity / follow-up eligibility、public fetch、summarization / save intent、thread creation、record persistence を分ける。
- Forum Research Thread Progress: activation / progress / publishable state、safety-before-publish policy、generation / appendix、retry job、Discord publish、cursor persistence を分ける。
- Admin Override Thread Lifecycle: lifecycle state、actor eligibility policy、Discord thread creation / archive effect、workspace-write execution、session persistence を分ける。
- Thread Cursor And Retry Progress: monotonic progress state、retry job execution、failure notification effect、record persistence、failure wording を分ける。
- Persistence Boundary Registry: registry 名義で束ねず、knowledge visibility、thread binding、session identity、override session、retry / forum progress、migration preservation の保存意味へ分ける。
- Admin Diagnostics Gate: eligibility / explicit intent gate、diagnostics collection、read projection、normal chat fallback、reply delivery を分ける。

## Blocking Issues

なし

## Phase 3への申し送り

- C1維持を厳しく検査すべき候補: `Place Capability Assignment` は Feature Profile 単体へ寄せると C7 になるため、assignment lifecycle と invalid policy が本当に残るか確認する。
- C1維持を厳しく検査すべき候補: `Knowledge Thread Binding` は fetch / summarization / DB write / thread creation を外へ出した後も、binding identity と follow-up eligibility が残るか確認する。
- C1維持を厳しく検査すべき候補: `Forum Research Thread Progress` は safety / generation / retry / publish effect を外へ出した後も、starter / follow-up / non-mention / publishable progress の状態表が残るか確認する。
- C1維持を厳しく検査すべき候補: `Admin Override Thread Lifecycle` は authority policy と workspace execution を外へ出した後も、start/use/end/archive の順序と invalid command policy が残るか確認する。
- C1維持を厳しく検査すべき候補: `Thread Cursor And Retry Progress` は retry scheduling と persistence 実装を外へ出した後も、進捗単調性と duplicate / terminal failure policy が残るか確認する。
- 親boundaryへ吸収できそうな候補: `Reply Target Resolution` の状態片は knowledge / forum / admin / cursor 側へ吸収し、Resolution 自体は C8/C12 として扱えるか確認する。
- 親boundaryへ吸収できそうな候補: `Persistence Boundary Registry` は registry boundary として残さず、個別保存意味と migration / round-trip invariant へ分けられるか確認する。
- 外側責務との分割が重要な候補: `Admin Diagnostics Gate` は C6/C12 として残し、通常会話の意味判断を System の固定文言 trigger に寄せない。
- 外側責務との分割が重要な候補: `Safety-Before-Publish` は単体 C1 にせず、Forum Research Thread Progress と Reply Target Resolution への gate / policy 投影として扱う。
- 状態相×Command表が必要そうな候補: `Place Capability Assignment`, `Knowledge Thread Binding`, `Forum Research Thread Progress`, `Admin Override Thread Lifecycle`, `Thread Cursor And Retry Progress`。
