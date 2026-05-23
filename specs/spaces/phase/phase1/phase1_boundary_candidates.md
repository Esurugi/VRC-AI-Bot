# Phase 1 結果

この文書は Phase 1 の中間成果物であり、state-owner boundary の採用、final boundary 名、slice 境界、Phase 0a UX sequence の固定を行わない。
Phase 0b の dynamic state-owner candidates を、後続 Phase 2 が分類できる候補レコードへ精緻化する。

## Boundary Refinement Candidates

### Place Capability Assignment

- Phase 0b対応候補: Place Capability Assignment
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-02` channel / mode 基盤ではなく feature profile から Discord place へ割り当てる; `USDM-05` reply routing と persistence boundary を保つ; `USDM-06` feature policy と legacy mode の二重正本解消、migration preservation
- 守る意味: place のユーザー向け機能意味を feature assignment 側に一元化し、legacy mode を互換・派生ラベルに留める保存意味と routing 判断の前提を守る。
- 状態所有の兆候: 未割当、profile 割当済み、legacy 互換入力からの派生、feature / legacy 不整合、再起動後に同じ割当意味で読める状態がある。primary feature の排他性や重複割当の拒否が複数 routing に影響する。
- 外から来る操作意図: 設定を読み込む、place の機能を同期する、legacy 形式を互換変換する、place の有効機能を解決する。
- 状態で変わること: unknown profile、重複割当、primary feature 多重、legacy mode との不整合を受理するか隔離するかが変わる。割当済み状態では chat / knowledge / forum / admin の起動可否の前提が変わる。
- 遷移判断に必要な外部事実: 読み込まれた設定内容、legacy 入力の存在、対象 place の識別子、migration / reopen 時に渡された保存済み割当 snapshot。
- 外へ出す責務: Discord place 取得は Provider、設定ファイル I/O と migration 実行は Application Service / Persistence、Feature Profile 単体は Profile / Data Entity、owner/admin 権限は Policy。
- 隣接候補: Reply Target Resolution、Admin Diagnostics Gate、Forum Research Thread Progress、Knowledge Thread Binding、Persistence Boundary Registry
- 確度: 高

### Reply Target Resolution

- Phase 0b対応候補: Reply Target Resolution
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存ユーザー向け振る舞い保護; `USDM-05` 知見保存、通常会話、admin diagnostics、forum research の reply routing と persistence boundary; `USDM-06` safety-before-publish、forum recovery、thread cursor
- 守る意味: 発話元 place、公開応答先、knowledge persistence scope、session binding を混同しない観測仕様を守る。安全未通過の public final が送信されないことも publish 直前の門番として関係する。
- 状態所有の兆候: 未解決、same place、public thread 作成待ち、作成済み thread binding、既存 thread binding、no reply、失敗通知済みのように、同じ入力でも状態により送信先と結果が変わる。
- 外から来る操作意図: 返信先を決める、public thread を作る、既存 thread に返す、送信を retry する、終端失敗を通知する。
- 状態で変わること: chat URL では thread 作成を拒否し、url_watch root では public thread 作成へ進み、knowledge / forum follow-up では same thread を維持する。safety 未通過なら public send は拒否または保留になる。
- 遷移判断に必要な外部事実: 発話元 place facts、place capabilities、Harness が返した outcome 種別、safety 評価結果、Discord thread 作成 Provider の結果、既存 binding の有無。
- 外へ出す責務: Discord send / thread 作成は Effect Handler / Provider、public wording と source selection は Harness contract、safety 判定そのものは Policy / Harness contract、保存 I/O は Persistence。
- 隣接候補: Knowledge Thread Binding、Forum Research Thread Progress、Thread Cursor And Retry Progress、Admin Override Thread Lifecycle
- 確度: 中

### Knowledge Thread Binding

- Phase 0b対応候補: Knowledge Thread Binding
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存知見保存振る舞い保護; `USDM-05` knowledge ingest と follow-up の reply routing / persistence boundary; `USDM-06` storage round-trip、thread cursor、migration preservation
- 守る意味: URL ingest の根拠、source message、knowledge record、public thread、known sources の同一性をつなぎ、follow-up が same thread と既知 source を優先する保存意味を守る。
- 状態所有の兆候: binding なし、ingest 受理済み、thread 作成済み、source linked、follow-up active、binding missing / stale の相がある。root URL ingest と knowledge thread follow-up は同じ情報を参照するが操作意図が異なる。
- 外から来る操作意図: public thread を作成または再利用する、source message を結び付ける、knowledge write handoff を登録する、follow-up に答える。
- 状態で変わること: blocked / private / unobserved URL は binding 根拠として拒否される。binding active な thread では新規 ingest ではなく known source を使う follow-up になる。binding missing では復旧または説明が必要になる。
- 遷移判断に必要な外部事実: URL の公開取得結果、blocked/private 判定、根拠化結果、source URL / canonical URL、Discord thread 作成または既存 thread 検出結果、保存済み binding snapshot。
- 外へ出す責務: public source fetch は Provider、要約と保存意図の生成は Harness contract、DB write は Persistence、thread 名や Discord 作成は Effect Handler、URL canonicalization の細部は Application Service。
- 隣接候補: Reply Target Resolution、Persistence Boundary Registry、Thread Cursor And Retry Progress
- 確度: 高

### Forum Research Thread Progress

- Phase 0b対応候補: Forum Research Thread Progress
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` forum 既存振る舞い保護; `USDM-03` starter は応答、follow-up は mention only 起動し文脈保持; `USDM-05` forum research reply routing / persistence boundary; `USDM-06` safety-before-publish、forum recovery、thread cursor
- 守る意味: forum starter / mentioned follow-up / non-mention ignore の起動規則、same forum thread reply、publish 前 safety、retry / terminal failure の可視性を守る。
- 状態所有の兆候: starter pending、research in progress、candidate produced、safety pending、published、retry visible、terminal failure visible、ignored non-mention の相がある。starter と follow-up の扱い、重複・retry 時の進捗が thread identity に連続する。
- 外から来る操作意図: starter を受理する、mentioned follow-up を受理する、non-mention follow-up を無視する、研究応答を進める、安全評価結果を反映する、final / refusal を公開可能状態にする。
- 状態で変わること: starter は mention 不要で受理され、starter 後の non-mention は reply / reaction / retry を出さず ignore される。安全未通過の候補は publish されず、retry または refusal の観測へ進む。duplicate / recovery では cursor を戻さない。
- 遷移判断に必要な外部事実: forum parent / post thread / starter message の facts、bot mention の有無、message が starter か follow-up かの facts、thread context snapshot、safety 評価結果、生成候補の公開可否、retry / duplicate の既存進捗。
- 外へ出す責務: Discord message fetch / send は Provider / Effect Handler、長文生成・source appendix 作成は Harness contract、safety policy は Policy、cursor 保存は Persistence、親 forum channel の運用設定は Place Capability Assignment。
- 隣接候補: Reply Target Resolution、Thread Cursor And Retry Progress、Persistence Boundary Registry、Place Capability Assignment
- 確度: 高

### Admin Override Thread Lifecycle

- Phase 0b対応候補: Admin Override Thread Lifecycle
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存管理導線保護; `USDM-04` owner/admin が origin place から dedicated override thread を起動し workspace-write を dedicated thread に限定; `USDM-05` admin routing / persistence boundary; `USDM-06` admin diagnostics gate、storage round-trip、migration preservation
- 守る意味: workspace-write context が origin place、通常会話、別 actor、終了済み thread へ漏れないことを、dedicated thread の lifecycle と actor identity で守る。
- 状態所有の兆候: active override なし、開始要求、dedicated thread 作成済み、同一 actor に対して active、終了要求、終了・archive 済み、stale / wrong actor の相がある。start / use / end / archive に順序と終端性がある。
- 外から来る操作意図: override を開始する、dedicated thread に bootstrap する、active override を解決する、override を終了する、thread を archive する。
- 状態で変わること: owner/admin 以外、configured admin_override root なし、dedicated thread 外、別 actor、終了済み thread では workspace-write を拒否する。active same actor thread だけ workspace-write context として扱う。
- 遷移判断に必要な外部事実: actor の owner/admin eligibility、origin place facts、configured admin_override root、Discord thread 作成 / archive Provider の結果、現在 turn の actor id、保存済み active override snapshot。
- 外へ出す責務: Discord thread 作成 / archive は Effect Handler、権限解決は Policy / Provider、workspace filesystem access は System boundary、Codex session 実行は Application Service、thread 名や visible copy は UI / Harness wording。
- 隣接候補: Reply Target Resolution、Persistence Boundary Registry、Admin Diagnostics Gate
- 確度: 高

### Thread Cursor And Retry Progress

- Phase 0b対応候補: Thread Cursor And Retry Progress
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存 failure recovery 保護; `USDM-05` reply routing / persistence boundary; `USDM-06` forum recovery、thread cursor、storage round-trip
- 守る意味: thread / channel の処理進捗が後戻りせず、pending retry や duplicate が無言完了・重複応答・別 target 返信を生まない保存意味を守る。
- 状態所有の兆候: 未観測、取得済み、処理中、retry 待ち、完了、終端失敗通知済みの相がある。duplicate / retry / recovery が同じ message id と reply target に対して進捗を進めるか止めるかを変える。
- 外から来る操作意図: message を取得する、retry 待ちにする、retry を予定する、完了にする、終端失敗を通知する、cursor を進める。
- 状態で変わること: retry 待ち duplicate は visible cursor を進めない。古い完了 duplicate は巻き戻さない。新しい完了だけが進める候補になる。終端失敗は元 reply target と矛盾しない visible notification を必要とする。
- 遷移判断に必要な外部事実: message id / thread id / reply target、既存進捗 snapshot、処理結果の成功・retry 可能・終端失敗の区別、retry scheduling の決定結果、failure category、保存済み retry job の存在。
- 外へ出す責務: retry scheduling の実行は Application Service、Discord 通知は Effect Handler、DB I/O は Persistence、retry metadata は Control Plane、ユーザー向け説明文は Harness wording。
- 隣接候補: Reply Target Resolution、Forum Research Thread Progress、Knowledge Thread Binding、Persistence Boundary Registry
- 確度: 高

### Persistence Boundary Registry

- Phase 0b対応候補: Persistence Boundary Registry
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存保存済み機能保護; `USDM-05` knowledge / chat / admin / forum の persistence boundary; `USDM-06` storage round-trip、migration preservation、thread cursor
- 守る意味: table 形状ではなく、knowledge visibility、source link、thread binding、session identity、override session、retry job、forum progress が reopen / migration 後も同じユーザー向け意味を保つことを守る。
- 状態所有の兆候: transient only、persisted、reopened equivalent、migrated compatible、quarantined legacy、stale unsafe の相がある。保存対象ごとに意味が異なるため、registry 的候補は広すぎる可能性がある。
- 外から来る操作意図: public contract を保存する、可視 record を読む、legacy record を移行する、legacy session を隔離する、retry / forum progress を保全する。
- 状態で変わること: legacy rows を silent drop するか quarantine / compatibility として読めるようにするかが変わる。visibility key が欠けた保存物は public leakage を避けるため拒否または隔離になる。legacy session は新 runtime binding として誤 reuse しない。
- 遷移判断に必要な外部事実: 保存対象種別、移行前 snapshot、移行後に期待される visibility / binding / session 意味、legacy record の由来、read / reopen 結果。
- 外へ出す責務: 実 DB schema、migration SQL、repository method は Persistence / Application Service、個別保存対象の同一性は Knowledge Thread Binding / Admin Override Thread Lifecycle / Thread Cursor And Retry Progress 側、Harness の保存意図は advisory handoff。
- 隣接候補: Knowledge Thread Binding、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress、Forum Research Thread Progress、Place Capability Assignment
- 確度: 中

### Admin Diagnostics Gate

- Phase 0b対応候補: Admin Diagnostics Gate
- Phase 0bで見落とされた理由: 該当なし
- 根拠USDM: `USDM-01` 既存管理診断振る舞い保護; `USDM-05` admin diagnostics の reply routing / persistence boundary; `USDM-06` admin diagnostics gate、feature policy と legacy mode の二重正本解消
- 守る意味: admin diagnostics が admin place かつ owner/admin の明示操作に限って成立し、通常の管理会話を diagnostics JSON に奪わない観測仕様を守る。
- 状態所有の兆候: normal admin chat、explicit diagnostics requested、accepted diagnostics、rejected outside admin place の薄い相がある。状態相は少ないが、invalid command policy と情報漏えい防止が外部観測に出る。
- 外から来る操作意図: diagnostics を要求する、diagnostics 結果を返す、通常会話として返す。
- 状態で変わること: admin place 外では diagnostics を拒否し、通常 chat として扱うか権限外応答になる。admin place でも明示 diagnostics でない通常質問は chat reply に残る。固定文言だけで System が意味判定する形は採らない。
- 遷移判断に必要な外部事実: place capability / admin scope、actor の owner/admin eligibility、Harness が解釈した明示 diagnostics intent、現在の reply target。
- 外へ出す責務: actor eligibility は Policy / Provider、diagnostics 情報収集は System boundary / Application Service、通常会話の意味判断と文言は Harness contract、Discord send は Effect Handler。
- 隣接候補: Place Capability Assignment、Reply Target Resolution、Admin Override Thread Lifecycle
- 確度: 中

## Phase 0b外の新規候補

なし。

- `Safety-Before-Publish` は単体 boundary 候補として追加しない。publish 前の gate / policy として、主に `Reply Target Resolution` と `Forum Research Thread Progress` の状態遷移材料へ渡す。
- `Owner/Admin` は状態所有者ではなく actor eligibility policy として扱う。
- `Feature Profile` 単体は Profile / Data Entity であり、assignment / migration / invalid command policy を含む `Place Capability Assignment` 側にだけ候補性がある。

## Blocking Issues

なし。

- Phase 0b の Blocking Issues は「なし」として入力されている。
- forum non-mention follow-up の古い docs 衝突は stale-doc risk であり、最新要求の mention only 起動を前提にするため Phase 2 を止めない。
- Phase 0b 候補を分裂・否定しないと正しい境界を立てられない候補は見つからなかった。

## Phase 2への申し送り

- 分類が難しそうな候補: `Reply Target Resolution` は boundary / Effect Handler / policy の混合に見えるため、send side effect を外へ逃がし、reply target の同一性と invalid command policy だけが state-owner かを確認する。
- 分類が難しそうな候補: `Persistence Boundary Registry` は registry として広すぎる。Phase 2 では個別 boundary に吸収する shared invariant か、薄い state-owner として残すかを慎重に分ける。
- 分類が難しそうな候補: `Admin Diagnostics Gate` は状態相が薄い。情報漏えい防止と normal-chat-stealing 防止の invalid command policy が boundary 契約として十分か、Policy に逃がすだけで足りるかを確認する。
- 外側責務との分割が必要そうな候補: `Forum Research Thread Progress` は research generation、source appendix、safety policy、Discord publish、cursor persistence を混ぜやすい。state-owner として残すなら thread progress / activation / publish 可否の順序に限定する。
- 外側責務との分割が必要そうな候補: `Knowledge Thread Binding` は public fetch、summarization、knowledge write、thread creation を外へ逃がし、binding identity と follow-up eligibility に絞る。
- 純粋な状態遷移にするため外から渡すべき外部事実: 設定内容、place facts、actor eligibility、bot mention / starter facts、public URL grounding 結果、safety 評価結果、Discord thread 作成 / archive 結果、保存済み snapshot、retry scheduling 結果。
- USDM証拠が弱い候補: `Admin Diagnostics Gate` と `Persistence Boundary Registry` は Phase 0b の薄い候補であり、採用する場合は外部観測可能な invalid command policy / 保存意味に限定する。
