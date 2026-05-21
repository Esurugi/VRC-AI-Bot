# Phase 0a 結果

この棚卸しは Phase 0a の中間成果物であり、最終 slice / boundary を確定しない。
入力 USDM 相当は便宜上 `USDM-01` から `USDM-07` として参照する。

- `USDM-01`: 既存のユーザー向け機能を保護するブラックボックス E2E / 振る舞いテストを作る。
- `USDM-02`: アーキテクチャを channel / mode 基盤ではなく「機能定義 -> Discord place への割当」にする。
- `USDM-03`: forum / research thread は初回 starter では応答し、follow-up は bot mention 時だけ起動し、文脈を保つ。
- `USDM-04`: admin override は owner/admin が元チャンネル/元スレッドから dedicated override thread を起動し、workspace-write はその dedicated thread のみに限定する。
- `USDM-05`: 知見保存、通常会話、admin diagnostics、forum research の reply routing と persistence boundary を保つ。
- `USDM-06`: 既存レビュー P0/P1 を保護する。forum final は safety-before-publish、feature policy と legacy mode の二重正本解消、admin diagnostics gate、forum recovery、thread cursor、storage round-trip、migration preservation。
- `USDM-07`: Phase 0a は候補の棚卸しであり、コード実装や最終 spec 確定をしない。

## UX Sequence Candidates

### Feature Profile Assignment Loads A Place
- 開始契機: 運用者が `featureProfiles` と `assignments` を持つ watch-locations 設定で bot を起動する。
- 観測結果: guild/channel に割り当てられた feature profile に従って、知見保存、通常会話、forum research、admin override などの振る舞いが有効になる。channel 自体は機能の所有者ではなく、機能 profile の割当先として扱われる。
- 関連USDM ID: `USDM-02`, `USDM-05`, `USDM-06`; decision log 2026-05-21 feature profile / assignment; `config/watch-locations.example.json`
- 必ず残す数値・時間・確認要否・禁止体験: 同一 guild/channel の重複割当は禁止候補。primary feature の多重宣言は禁止候補。legacy `locations` / `mode` が新規正本として扱われる体験は禁止候補。
- 実装時に決めてよいこと: 設定ファイルの細かな validation message、内部的な derived mode 名、migration 時の一時フィールド名。

### Legacy Watch Location Remains Compatibility Only
- 開始契機: 旧 `locations` / `mode` 形式の設定が読み込まれる、または既存テスト・既存運用が legacy mode を参照する。
- 観測結果: 旧設定は壊れずに動くが、新しい機能意味の正本は feature profile / assignment に寄る。テスターは legacy mode と feature policy が競合したとき、どちらがユーザー向け機能を決めるかを確認できる。
- 関連USDM ID: `USDM-02`, `USDM-06`
- 必ず残す数値・時間・確認要否・禁止体験: feature policy と legacy mode が別々の正本として発散する状態は禁止候補。互換入力を維持する場合も「正本が二つある」と見えるテスト設計は禁止候補。
- 実装時に決めてよいこと: legacy 入力をいつ削除するか、warning を出すか、migration tool を用意するか。

### Normal Chat Reply In Same Place
- 開始契機: conversation feature を持つ通常会話 place で、利用者が bot 宛ての質問、返信、または通常会話として扱われる発言を行う。
- 観測結果: bot は同じ place に自然文で応答する。通常 chat の URL は自動知見保存や thread 化に進まず、会話材料として扱われる。
- 関連USDM ID: `USDM-01`, `USDM-05`; root `AGENTS.md` reply rule; decision log 2026-03-11 chat root URL policy
- 必ず残す数値・時間・確認要否・禁止体験: URL を貼っただけで knowledge thread が作られる体験は禁止候補。Discord 返信は途中で失われないことが観測対象候補。
- 実装時に決めてよいこと: 返信文言、分割送信の chunk サイズ、通常会話の詳細な engagement 表現。

### Ambient Chat Sparse Reply
- 開始契機: ambient chat behavior の会話場所で、明示 mention / bot への reply / 疑問符なしの普通の雑談が続く。
- 観測結果: bot は全発言へ反応せず、普通の雑談は間引いて応答する。明示呼び出しは通常どおり応答候補になる。
- 関連USDM ID: `USDM-01`, `USDM-05`; decision log 2026-03-13 chat sparse reply
- 必ず残す数値・時間・確認要否・禁止体験: 雑談間引きは 5 件に 1 回という既存仕様候補がある。明示呼び出しで sparse count が不自然にリセットされる体験は禁止候補。
- 実装時に決めてよいこと: 疑問符の具体的な扱い、表示リアクション、カウンタ保存先。

### URL Watch Knowledge Ingest Creates Or Reuses Public Thread
- 開始契機: knowledge_ingest feature を持つ URL watch root に、共有知見化できる公開 URL が投稿される。
- 観測結果: bot は URL を根拠化し、知見保存結果を public thread に投稿する。root の URL ingest では public thread を作り、knowledge thread follow-up では同じ thread に返す。
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`; root `AGENTS.md` reply rule; `USDM-06` storage round-trip / migration preservation
- 必ず残す数値・時間・確認要否・禁止体験: `blocked_urls`、private URL、根拠化されていない URL を保存根拠にする体験は禁止候補。保存 scope は `server_public` を基本候補として残す。
- 実装時に決めてよいこと: thread 名、保存完了メッセージの文言、URL canonicalization の詳細。

### Natural Language Knowledge Save Request
- 開始契機: 利用者が同一 guild 内で、URL 貼り付けに限らない自然文として「この公開情報を知見として保存してほしい」と明示する。
- 観測結果: bot は明示保存要求として扱い、可能なら公開情報を根拠化して `server_public` の知見保存 advisory handoff を返す。返信先は same place を優先する。
- 関連USDM ID: `USDM-01`, `USDM-05`; root `AGENTS.md` natural language knowledge save rule
- 必ず残す数値・時間・確認要否・禁止体験: 明示保存要求なしの通常 URL 会話を自動保存する体験は禁止候補。不完全な保存材料でも回答自体を止めないことを候補として残す。
- 実装時に決めてよいこと: 保存できない場合の案内文、追加公開調査の手順、タグ生成方針。

### Knowledge Thread Follow-Up Uses Known Sources
- 開始契機: knowledge thread 内で利用者が follow-up 質問を行う。
- 観測結果: bot は同じ thread に返答し、既知ソース URL を優先して文脈を保つ。必要な場合だけ追加公開取得を行う。
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`; root `AGENTS.md` knowledge thread follow-up; `USDM-06` thread cursor / recovery
- 必ず残す数値・時間・確認要否・禁止体験: follow-up が root channel に漏れる体験は禁止候補。known source を無視して無関係な回答へ逸れる体験は禁止候補。無言失敗は禁止候補。
- 実装時に決めてよいこと: thread context の提示量、参照 appendix の形式、retry 時の内部 job 表現。

### Forum Research Starter Reply
- 開始契機: forum_research feature が割り当てられた forum post thread で、post starter message が作られる。
- 観測結果: bot は starter に応答する。利用者から見ると、研究・長文相談の最初の入力に対して high-thinking 系の長文応答が同じ forum thread に返る。
- 関連USDM ID: `USDM-01`, `USDM-03`, `USDM-05`, `USDM-06`; decision log 2026-03-13 forum_longform
- 必ず残す数値・時間・確認要否・禁止体験: 親 forum channel 自体では応答しない候補。starter への初回応答は安全確認後に publish されるべき候補。利用者に hidden preprocessing の完全 prompt が露出する体験は禁止候補。
- 実装時に決めてよいこと: starter 判定の内部手段、model profile 名、参照 appendix の書式。

### Forum Research Mentioned Follow-Up Reply
- 開始契機: forum_research thread の starter 以外の message で、利用者が bot を mention する。
- 観測結果: bot は同じ forum thread に応答し、前後の文脈を保つ。bot mention がない follow-up は起動しない。
- 関連USDM ID: `USDM-01`, `USDM-03`, `USDM-05`, `USDM-06`
- 必ず残す数値・時間・確認要否・禁止体験: starter 以外の無 mention 発言で起動する体験は禁止候補。forum thread の文脈が失われる体験は禁止候補。final response が safety-before-publish を通らず投稿される体験は禁止候補。
- 実装時に決めてよいこと: 文脈の取得件数、mention 判定の詳細、長文応答の chunking。

### Forum Research Non-Mention Follow-Up Is Ignored
- 開始契機: forum_research thread で starter ではない message が投稿され、bot mention が含まれない。
- 観測結果: bot は応答しない。利用者は bot が forum 内の全会話へ割り込まないことを観測できる。
- 関連USDM ID: `USDM-03`, `USDM-05`
- 必ず残す数値・時間・確認要否・禁止体験: 無 mention follow-up に処理中リアクションや reply が出る体験は禁止候補。
- 実装時に決めてよいこと: ignore のログ粒度、テストでの bot mention 生成方法。

### Admin Override Start From Origin Place
- 開始契機: owner/admin が元チャンネルまたは元スレッドから repo 改変・調査を含む override 開始操作を行う。
- 観測結果: workspace-write は元 place では直接開かれず、configured `admin_override` root 配下に dedicated override thread が作成される。元 place には thread への導線が返る。
- 関連USDM ID: `USDM-01`, `USDM-04`, `USDM-05`, `USDM-06`; decision log 2026-05-21 admin override; decision log 2026-03-11 dedicated thread
- 必ず残す数値・時間・確認要否・禁止体験: owner/admin 以外が開始できる体験は禁止候補。元チャンネル/元スレッド自体が workspace-write になる体験は禁止候補。thread 作成先が admin_override root 以外になる体験は禁止候補。
- 実装時に決めてよいこと: slash command / natural language handoff の UI、thread 名、初回 prompt copy の文言。

### Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread
- 開始契機: override を開始した owner/admin 本人が dedicated override thread 内で会話する。
- 観測結果: その thread 内の同一 actor の turn は workspace-write context として扱われる。dedicated thread 外の通常会話は read-only / usual capability boundary に留まる。
- 関連USDM ID: `USDM-04`, `USDM-05`; decision log 2026-03-11 active override thread
- 必ず残す数値・時間・確認要否・禁止体験: 別 actor が同じ write context を使える体験は禁止候補。override thread 外に workspace-write が漏れる体験は禁止候補。thread 内で capability 表示が実態と矛盾する体験は禁止候補。
- 実装時に決めてよいこと: capability 表示の具体文、bootstrap 時の visible copy、Codex session key の内部表現。

### Admin Override End Archives Write Context
- 開始契機: override を開始した owner/admin 本人が dedicated override thread 内で終了操作を行う。
- 観測結果: workspace-write context が閉じられ、thread は archive される。以後は同 thread で active override として扱われない。
- 関連USDM ID: `USDM-04`, `USDM-05`; decision log 2026-03-11 override end
- 必ず残す数値・時間・確認要否・禁止体験: TTL による勝手な終了を正本にする体験は禁止候補。別 place から終了できる体験は禁止候補。終了後も write session が再利用される体験は禁止候補。
- 実装時に決めてよいこと: archive reason、終了 reply 文言、終了済み thread に対する再実行時の案内。

### Admin Diagnostics Explicit Request Only
- 開始契機: admin_override / admin_control の管理場所で、owner/admin が明示的に運用診断を要求する。
- 観測結果: bot は diagnostics として観測できる形式の情報を同じ管理 place に返す。権限確認や通常質問は diagnostics JSON ではなく通常会話として扱われる。
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`; root `AGENTS.md` admin_diagnostics rule; decision log 2026-03-11 admin diagnostics
- 必ず残す数値・時間・確認要否・禁止体験: admin_control 以外で admin diagnostics が出る体験は禁止候補。通常会話が diagnostics JSON に落ちる体験は禁止候補。
- 実装時に決めてよいこと: 明示診断要求の文言セット、diagnostics の field 表示、通常会話との境界テストの phrasing。

### Runtime Failure Recovery Keeps Reply Target
- 開始契機: Discord send、thread fetch、Codex runtime、storage など System-owned runtime failure が発生し、後で retry または終端 failure 通知が行われる。
- 観測結果: 利用者または管理者は、失敗理由と再試行または終端通知を、元の reply target と矛盾しない場所で確認できる。回復後に重複応答や cursor 飛びが起きない。
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`; decision log 2026-03-12 T14 failure recovery
- 必ず残す数値・時間・確認要否・禁止体験: `pending_retry` 相当の message が completed と誤認される体験は禁止候補。retry 後に same place / same thread の返信先が変わる体験は禁止候補。無言で処理済みになる体験は禁止候補。
- 実装時に決めてよいこと: retry 間隔、public category の表示文、admin 通知の詳細。

### Storage Round-Trip Preserves Knowledge And Sessions
- 開始契機: knowledge ingest、knowledge thread binding、override session、forum conversation、migration 後の再起動をまたぐ運用が行われる。
- 観測結果: 保存した知見、thread binding、reply routing、session identity が再起動後も観測上維持される。migration 後に既存ユーザー向け機能が壊れない。
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`; decision log 2026-03-12 session identity / storage; storage round-trip / migration preservation
- 必ず残す数値・時間・確認要否・禁止体験: stale session を place 単位だけで誤 reuse する体験は禁止候補。migration 後に旧データが silent loss する体験は禁止候補。reply thread binding が失われる体験は禁止候補。
- 実装時に決めてよいこと: migration の具体 SQL、compat table 名、round-trip fixture の粒度。

## Glossary Draft

### Feature Profile
- 定義: bot のユーザー向け機能集合、default scope、chat behavior をまとめた機能定義。channel / mode の代わりに先に定義され、Discord place へ assignment される。
- 同一性: profile id で識別する候補。例: `knowledge-share`, `ambient-chat`, `research-forum`, `admin-override`。
- ライフサイクル/時刻基準: 設定読み込み時に assignment と結合される。migration / compatibility 期間では legacy mode との関係が重要。
- 所有/参照関係: Discord channel は Feature Profile を所有せず、Feature Profile が place へ割り当てられる。
- 隣接概念との境界: legacy `WatchMode`、Discord channel、Place Feature と混同しない。
- 使われる場所: Feature Profile Assignment Loads A Place; Legacy Watch Location Remains Compatibility Only
- 未確定点: legacy mode を最終 contract 上どこまで露出するか。

### Place Feature
- 定義: `conversation`, `knowledge_ingest`, `admin_override`, `forum_research` など、place に割り当てられたユーザー向け機能の最小単位。
- 同一性: feature literal と assignment の組み合わせで観測意味が決まる候補。
- ライフサイクル/時刻基準: 設定読み込み時に normalize される候補。primary feature の多重宣言は禁止候補。
- 所有/参照関係: Feature Profile が feature 配列を保持し、Discord place は assignment 経由で参照する。
- 隣接概念との境界: `WatchMode` は互換・派生ラベル候補であり、feature 意味の正本にしない。
- 使われる場所: すべての routing candidates
- 未確定点: primary feature と secondary feature の仕様上の名前付け。

### Discord Place
- 定義: guild text、announcement、public/private thread、forum post thread など、利用者が bot とやり取りする Discord 上の場所。
- 同一性: guild id、root channel id、channel/thread id、place type の組み合わせが必要。
- ライフサイクル/時刻基準: thread は作成、archive、starter message、follow-up を持つ。
- 所有/参照関係: Feature Profile の assignment 先。knowledge thread / override thread / forum post thread は root channel から派生する。
- 隣接概念との境界: channel と thread、root channel と reply target、forum parent channel と forum post thread を混同しない。
- 使われる場所: Normal Chat Reply In Same Place; URL Watch Knowledge Ingest Creates Or Reuses Public Thread; Forum Research Starter Reply; Admin Override Start From Origin Place
- 未確定点: unconfigured origin から override-start した場合の UX を最終仕様でどこまで許すか。

### Reply Target
- 定義: bot の公開応答を送る場所。same place、created public thread、existing thread、no reply の候補がある。
- 同一性: channel id と thread id の組み合わせ。
- ライフサイクル/時刻基準: failure recovery / retry では元の reply target を維持する必要がある。
- 所有/参照関係: Harness response は希望 reply mode を返すが、Discord side effect は System 側が実行する。
- 隣接概念との境界: source message place、knowledge persistence scope、Codex session identity と混同しない。
- 使われる場所: 知見保存、通常会話、admin diagnostics、forum research、failure recovery
- Phase 0b 観察点: safety-before-publish が Discord publish 前に成立する観測点を、send order と refusal / retry の外部挙動から具体化する。

### Persistence Boundary
- 定義: knowledge write、session binding、override session、retry cursor など、再起動や migration をまたいで維持すべき保存境界。
- 同一性: record id、scope、visibility key、thread binding、session identity、message id などの組み合わせが候補。
- ライフサイクル/時刻基準: create、retry pending、success、terminal failure、archive、migration の状態が観測に影響する。
- 所有/参照関係: System が DB I/O と persistence integrity を所有し、Harness は保存意図や意味づけを advisory handoff として返す。
- 隣接概念との境界: Harness の `knowledge_writes` と実際の DB 保存完了、reply routing と persistence scope を混同しない。
- 使われる場所: URL Watch Knowledge Ingest Creates Or Reuses Public Thread; Storage Round-Trip Preserves Knowledge And Sessions
- 未確定点: Phase 0a では DB schema / migration の採用は確定しない。

### Knowledge Ingest
- 定義: 公開情報を bot が根拠化し、共有知見として保存・返信するユーザー向け機能。
- 同一性: source URL / canonical URL / content hash / scope / guild visibility が候補。
- ライフサイクル/時刻基準: root URL ingest、knowledge thread follow-up、natural language save request で入口が異なる。
- 所有/参照関係: `knowledge_writes` は System persistence への advisory handoff。保存が不完全でも回答自体を止めない。
- 隣接概念との境界: 通常 chat の URL 会話、forum research の参照 appendix、external fetch と混同しない。
- 使われる場所: URL Watch Knowledge Ingest Creates Or Reuses Public Thread; Natural Language Knowledge Save Request; Knowledge Thread Follow-Up Uses Known Sources
- 未確定点: 自然文保存要求で URL がない場合の観測可能な成功条件。

### Knowledge Thread
- 定義: URL ingest などから作成・利用される public thread。共有知見の返信と follow-up の場。
- 同一性: thread id、source message id、known source URLs、root channel id。
- ライフサイクル/時刻基準: root 投稿から作成され、follow-up は same thread に続く。
- 所有/参照関係: source URL と Codex session binding を参照する候補。
- 隣接概念との境界: forum research thread、plain thread、admin override thread と混同しない。
- 使われる場所: URL Watch Knowledge Ingest Creates Or Reuses Public Thread; Knowledge Thread Follow-Up Uses Known Sources
- Phase 0b 観察点: thread cursor と recovery は内部名ではなく、same-thread reply、無言失敗防止、cursor が戻らないことから具体化する。

### Forum Research Thread
- 定義: forum_research feature が割り当てられた forum parent 配下の post thread。長文研究・深掘り相談の場。
- 同一性: forum post thread id、starter message id、root forum channel id。
- ライフサイクル/時刻基準: starter message では応答し、starter 後の follow-up は bot mention があるときだけ起動する。
- 所有/参照関係: conversation context と sources_used / reference appendix を持つ候補。
- 隣接概念との境界: knowledge thread ではない。親 forum channel 自体で会話するのではなく post thread が会話単位。
- 使われる場所: Forum Research Starter Reply; Forum Research Mentioned Follow-Up Reply; Forum Research Non-Mention Follow-Up Is Ignored
- Phase 0b 観察点: forum recovery、thread cursor、safety-before-publish のチェックポイントを実装観察から抽出する。

### Forum Starter Message
- 定義: forum post thread の初回投稿として扱われる message。
- 同一性: message id が thread id と一致する場合、または fetched starter message id と一致する場合が候補。
- ライフサイクル/時刻基準: thread 作成時の最初の入力。starter のみ mention 不要で bot 起動候補になる。
- 所有/参照関係: Forum Research Thread に属する。
- 隣接概念との境界: follow-up message と混同しない。
- 使われる場所: Forum Research Starter Reply
- 未確定点: starter fetch 失敗時の観測仕様。

### Forum Follow-Up
- 定義: forum starter 後に同じ forum research thread へ投稿される message。
- 同一性: message id、thread id、bot mention の有無。
- ライフサイクル/時刻基準: bot mention がある場合だけ起動候補。無 mention は ignore 候補。
- 所有/参照関係: Forum Research Thread の会話文脈を参照する。
- 隣接概念との境界: knowledge thread follow-up、plain thread message、starter message と混同しない。
- 使われる場所: Forum Research Mentioned Follow-Up Reply; Forum Research Non-Mention Follow-Up Is Ignored
- 未確定点: 文脈保持の観測基準。

### Safety-Before-Publish
- 定義: final response を Discord に公開する前に、根拠・安全・出力境界の確認を済ませるべきという P0/P1 要求候補。
- 同一性: 対象 response、allowed sources、disallowed sources、retry context、publish target の組み合わせが候補。
- ライフサイクル/時刻基準: final generation 後、Discord send 前に成立する必要がある候補。
- 所有/参照関係: System は publish side effect を所有し、Harness は意味・根拠・sources_used を所有する。
- 隣接概念との境界: 投稿後の moderation、admin diagnostics、runtime retry と混同しない。
- 使われる場所: Forum Research Starter Reply; Forum Research Mentioned Follow-Up Reply; URL Watch Knowledge Ingest Creates Or Reuses Public Thread
- Phase 0b 観察点: forum starter / mentioned follow-up の final public reply を対象に、unsafe candidate が公開されず retry / refusal が同じ thread で観測されることを具体化する。

### Admin Override Thread
- 定義: owner/admin が開く dedicated thread。workspace-write context を許可する唯一の場所候補。
- 同一性: guild id、scope place id / thread id、actor id、started_at、sandbox mode。
- ライフサイクル/時刻基準: start command / bootstrap で作成され、end command で archive される。TTL 終了は正本にしない候補。
- 所有/参照関係: admin_override root channel 配下に作成され、開始者 actor と workspace-write Codex session に結び付く。
- 隣接概念との境界: admin_control root、元チャンネル/元スレッド、通常会話 thread と混同しない。
- 使われる場所: Admin Override Start From Origin Place; Admin Override Conversation Stays Workspace-Write Only In Dedicated Thread; Admin Override End Archives Write Context
- Phase 0b 観察点: command 起動から dedicated override thread start/use/end までの lifecycle と invalid command policy を抽出する。自然文 repo 改変要求の即時 workspace-write 昇格は採用しない。

### Owner/Admin
- 定義: override や管理診断を実行できる管理権限 actor。
- 同一性: owner user id または Discord Administrator 権限。
- ライフサイクル/時刻基準: message / interaction ごとに解決される候補。
- 所有/参照関係: override thread は開始 actor に紐づく。
- 隣接概念との境界: 一般 user、override thread 内の別 actor と混同しない。
- 使われる場所: Admin Override Start From Origin Place; Admin Diagnostics Explicit Request Only
- 未確定点: owner と admin の観測上の差分が必要か。

### Admin Diagnostics
- 定義: admin place で明示的な運用診断要求に対して返す管理用結果。
- 同一性: request message、place、actor role、session identity、diagnostic notes が候補。
- ライフサイクル/時刻基準: explicit diagnostics request の turn のみ発生候補。
- 所有/参照関係: admin_control / admin_override 管理場所に限定される候補。
- 隣接概念との境界: 通常会話、権限確認、override 操作結果、permanent failure notification と混同しない。
- 使われる場所: Admin Diagnostics Explicit Request Only
- Phase 0b 観察点: command / explicit diagnostics と normal admin chat の分離を観測する。固定トリガー文言リストは正本化しない。

### Thread Cursor
- 定義: thread 内でどの message まで処理済み・retry pending・失敗済みかを区別する観測上の進捗境界。
- 同一性: message id、thread id、processing status、retry job id が候補。
- ライフサイクル/時刻基準: pending、pending_retry、success、terminal failure の区別が候補。
- 所有/参照関係: reply target と persistence boundary を参照する。
- 隣接概念との境界: Codex session cursor、Discord thread archive state、chat sparse counter と混同しない。
- 使われる場所: Knowledge Thread Follow-Up Uses Known Sources; Runtime Failure Recovery Keeps Reply Target; Storage Round-Trip Preserves Knowledge And Sessions
- 未確定点: Phase 0a では cursor の state model を確定しない。

### Storage Round-Trip
- 定義: 保存した state が再読込・再起動・migration 後にも同じ観測意味を保つこと。
- 同一性:保存対象ごとに異なる。knowledge record、artifact、session binding、override session、retry job、chat counter など。
- ライフサイクル/時刻基準: write -> read -> restart -> migrate -> read のような観測列が候補。
- 所有/参照関係: System-owned persistence integrity。Harness の意味判断を DB schema に固定しすぎない必要がある。
- 隣接概念との境界: 単なる unit-level serialization、migration preservation、reply dispatch success と混同しない。
- 使われる場所: Storage Round-Trip Preserves Knowledge And Sessions
- Phase 0b 観察点: round-trip 対象は table 名ではなく、knowledge visibility、thread binding、session identity、override session、retry / forum progress の保存意味として読む。

### Migration Preservation
- 定義: feature policy 移行、session identity 移行、knowledge schema 移行などで、既存ユーザー向け機能と保存済み可視性を壊さないこと。
- 同一性: migration version、before/after data、observable feature behavior。
- ライフサイクル/時刻基準: migration 実行前後、bot 再起動後。
- 所有/参照関係: storage round-trip と reply routing を参照する。
- 隣接概念との境界: 後方互換を無制限に残すことではない。legacy mode を正本として残すこととも違う。
- 使われる場所: Legacy Watch Location Remains Compatibility Only; Storage Round-Trip Preserves Knowledge And Sessions
- Phase 0b 観察点: legacy data は user-visible record loss 防止、retry / forum progress preservation、旧 session の新 runtime binding 誤 reuse 防止の保存意味として読む。

## Blocking Issues Reclassified

ユーザー回答により、以下は Phase 0b を止める未回答 blocker ではなくなった。
ただし実装そのものを正解として採用せず、Phase 0b SubAgent は実装観察から `ユーザー目的`、`観測された状態遷移`、`現設計の悪さ/危険` を分離して読む。

### BI-01: `forum final` と safety-before-publish の観測契約
- 関連USDM ID: `USDM-03`, `USDM-05`, `USDM-06`
- 再分類: user answered / no longer blocks Phase 0b
- ユーザー回答: 旧 Q1 は何を問うているか不明だったため、ユーザー質問として閉じる。Phase 0b では `forum final` の語義を再質問せず、forum starter と mentioned follow-up の final public reply が publish 前 safety を通る受入条件として具体化する。
- 実装観察で読む目的: forum research の公開 final が safety-before-publish より先に Discord に出ないこと。unsafe candidate は同じ forum thread で retry または refusal として観測されること。
- 観測された状態遷移候補: forum input accepted -> final candidate produced -> safety evaluated -> safe publish, or unsafe candidate withheld -> retry/refusal visible.
- 現設計の悪さ/危険: `final`、`publish`、`appendix` を曖昧にしたまま実装詳細へ寄せると、send order の違反を仕様で捕捉できない。
- Phase 0b への影響: `Safety-Before-Publish` と `Forum Research Thread` の invariant 候補へ進める。

### BI-02: admin diagnostics / override の入口
- 関連USDM ID: `USDM-05`, `USDM-06`
- 再分類: user answered / implementation-observation required / no longer blocks Phase 0b
- ユーザー回答: admin diagnostics / override はトリガー文言ではなく command 操作前提として扱う。
- 実装観察で読む目的: 管理用操作だけが diagnostics / override を開き、通常の admin 会話や権限質問は chat_reply に残ること。
- 観測された状態遷移候補: admin command or explicit diagnostics request -> place and actor eligibility checked -> diagnostics/override accepted or rejected -> same management place / dedicated override thread に結果が返る。
- 現設計の悪さ/危険: System 側の固定文言 trigger を正本にすると、Harness の意味判断を奪い、通常会話を diagnostics JSON に誤分類する。
- Phase 0b への影響: `Admin Diagnostics` の accepted/rejected/normal-chat invariant と、`Admin Override Thread` の command lifecycle へ進める。

### BI-03: forum recovery / thread cursor の外部観測単位
- 関連USDM ID: `USDM-03`, `USDM-05`, `USDM-06`
- 再分類: implementation-observation required / no longer blocks Phase 0b
- ユーザー回答: 実装があるため、目的・行動・状態遷移のみを抽出する。
- 実装観察で読む目的: forum starter / mentioned follow-up の処理が retry や duplicate を挟んでも、利用者は同じ reply target で成功または終端失敗を観測でき、cursor が戻らないこと。
- 観測された状態遷移候補: message accepted -> processing/retry pending -> completed reply or terminal notification; completed duplicate may advance only forward; pending retry duplicate does not advance visible cursor.
- 現設計の悪さ/危険: 内部名を最終仕様 state にすると DB 実装へ固定される。cursor を仕様外にすると重複応答、無言失敗、reply target 逸脱を守れない。
- Phase 0b への影響: `Thread Cursor`、`Runtime Failure Recovery`、`Reply Target` の invariant 候補へ進める。

### BI-04: storage round-trip / migration preservation の保存意味
- 関連USDM ID: `USDM-01`, `USDM-05`, `USDM-06`
- 再分類: implementation-observation required / no longer blocks Phase 0b
- ユーザー回答: 実装があるため、DB schema ではなく保存意味を抽出する。
- 実装観察で読む目的: 知見、可視性、thread binding、session identity、override session、retry job、forum state が reopen / migration 後も同じユーザー向け意味を保つこと。
- 観測された状態遷移候補: state written -> process closed/reopened or legacy data migrated -> equivalent public contract rows readable -> visibility / reply routing / session lifecycle preserved.
- 現設計の悪さ/危険: table 名や migration 番号を仕様正本にすると実装詳細テストになる。一方で保存意味を narrow にしすぎると、知見 follow-up、override containment、retry recovery の継続性が落ちる。
- Phase 0b への影響: `Persistence Boundary`、`Storage Round-Trip`、`Migration Preservation` の invariant 候補へ進める。

### BI-05: 元 place からの admin override 起動 UI
- 関連USDM ID: `USDM-04`
- 再分類: user answered / implementation-observation required / no longer blocks Phase 0b
- ユーザー回答: command 操作で dedicated override thread を起動する前提に更新する。
- 実装観察で読む目的: owner/admin が元 place から明示操作し、workspace-write context を元 place や通常会話へ漏らさず dedicated override thread だけに閉じ込めること。
- 観測された状態遷移候補: command at allowed origin -> owner/admin accepted -> dedicated override thread created under configured admin_override root -> same actor gains workspace-write only in that thread -> end command closes session and archives thread.
- 現設計の悪さ/危険: 自然文 repo 改変要求を即 workspace-write に昇格すると Harness/System 境界違反になる。command 名や bootstrap 実装を正本化すると、write containment というユーザー目的より UI 細部が固定される。
- Phase 0b への影響: `Admin Override Thread` の start/use/end lifecycle と invalid command policy へ進める。

## Phase 0b Next Input

Phase 0b SubAgent はユーザーへ追加質問せず、以下を実装観察対象として読む。

- `implementation/test/e2e/discord-behavior-preservation.test.ts`: safety-before-publish、admin diagnostics gate、forum publish 前安全、knowledge thread follow-up の外部観測。
- `implementation/test/integration/cursor-retry-monotonicity.test.ts`: retry / duplicate / cursor の外部進捗境界。
- `implementation/test/integration/storage-roundtrip.test.ts`: reopen 後に維持される public contract rows と保存意味。
- `implementation/test/integration/migration-preservation.test.ts`: legacy data preservation と旧 session の新 runtime binding 誤 reuse 防止。
- `implementation/src/runtime/admin/admin-command-service.ts`: admin override command の許可条件、dedicated thread 作成、同一 actor、終了と archive の観測行動。
- `implementation/src/codex/app-server-client.ts`: admin diagnostics と normal admin chat の Harness contract 文言。ただし文言そのものは仕様正本にしない。
- `implementation/test-design/behavior-preservation-test-design.md`: 既存テスト設計上の目的、禁止体験、危険の整理。

## Coordinatorへの申し送り

- UX sequence の分割/統合が迷わしい箇所:
  - knowledge ingest root、natural language save、knowledge thread follow-up は別 candidate としたが、最終 slice では persistence boundary と reply routing の共有度で統合候補になる。
  - forum starter、forum mentioned follow-up、forum non-mention ignore は Phase 0a では分けた。Phase Z では forum research 体験として統合するか、starter/follow-up の受入基準を分けるか再判断が必要。
  - admin override start / conversation / end は連続 UX だが、workspace-write 限定と archive 終了の観測が異なるため候補を分けた。
- glossary 上の多義語・未確定語:
  - `mode` は legacy compatibility / derived label 候補であり、feature policy の正本ではない。後続で二重正本に戻さないこと。
  - `thread` は knowledge thread、forum research thread、admin override thread、plain thread を分けて扱う必要がある。
  - `final`, `publish`, `safety` は P0/P1 の中核語であり、Phase 0b では実装観察から publish 前 safety と unsafe candidate 非公開の invariant へ落とす。
- Phase 0b への申し送り:
  - 旧 blocking questions はユーザー再質問ではなく、実装観察から invariant 候補へ進める。
  - admin diagnostics / override は command 操作前提として読む。自然文 trigger list を正本化しない。
  - forum safety-before-publish は starter / mentioned follow-up の final public reply が Discord publish 前に安全確認される受入条件として読む。
  - forum recovery / thread cursor は内部 state 名ではなく、reply target 維持、重複応答防止、cursor が戻らないこと、終端失敗が無言にならないことを読む。
  - storage round-trip / migration preservation は DB schema ではなく、knowledge visibility、thread binding、session identity、override session、retry / forum progress の保存意味を読む。
