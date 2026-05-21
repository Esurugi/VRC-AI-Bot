# Shared Glossary

この文書は複数 slice / boundary で同じ意味として使う概念境界を凍結する。短い用語辞書ではなく、実装時に混同すると reply routing、保存意味、workspace-write 境界、retry recovery が壊れる同一性、ライフサイクル、所有/参照関係、隣接概念境界を残す。

## Feature Profile

bot のユーザー向け機能集合、default scope、chat behavior をまとめた設定概念。`Feature Profile` 自体は状態所有者ではなく、Discord Place へ割り当てられて初めて routing / capability 解決の意味を持つ。

同一性は profile id と feature set で表す。例として `knowledge-share`、`ambient-chat`、`research-forum`、`admin-override` のような profile id がありうるが、具体名そのものを仕様正本にしない。

Feature Profile は Discord channel や legacy `mode` の所有物ではない。Place Capability Assignment boundary が、読み込まれた profile と assignment を結合して、place の有効 PlaceFeature を決める。

## PlaceFeature

`conversation`、`knowledge_ingest`、`forum_research`、`admin_override` など、place に割り当てられたユーザー向け capability の最小単位。feature literal 単体ではなく、Feature Profile、assignment、Discord Place と結合して観測意味を持つ。

PlaceFeature は routing、reply target、knowledge save eligibility、forum activation、admin override / diagnostics gate の前提になる。primary feature の多重宣言や同一 guild/channel への重複 assignment は、複数の挙動を同時に壊すため、互換処理または invalid isolation の対象になる。

legacy `WatchMode` / `mode` は PlaceFeature の正本ではない。互換入力または派生ラベルとして扱い、新しい機能意味を `mode` へ戻さない。

## Discord Place

利用者が bot とやり取りする Discord 上の場所。guild text channel、announcement channel、public/private thread、forum post thread などを含む。

同一性は少なくとも guild id、root channel id、channel/thread id、place type で決まる。thread は作成、archive、starter message、follow-up というライフサイクルを持つため、root channel と同一視しない。

Discord Place は Feature Profile の assignment 先であり、機能そのものの所有者ではない。knowledge thread、forum research thread、admin override thread はいずれも thread だが、同じ lifecycle や reply policy を持たない。

## Reply Target

bot の公開応答、終端失敗通知、admin 導線を出す場所。same place、created public thread、existing knowledge thread、same forum thread、dedicated override thread、no reply などの候補がある。

Reply Target は発話元 place と常に同じではない。URL watch root の knowledge ingest は public thread を作成または再利用し、knowledge thread follow-up は same thread に返し、admin override start は origin place に導線を返しつつ workspace-write は dedicated thread に閉じ込める。

Reply Target Resolution は独立 state-owner boundary ではない。PlaceFeature assignment、thread binding、boundary Event payload、safety result、cursor state を Application Service / readiness gate が合成し、Discord side effect へ渡す外側責務である。

## Persistence Boundary

DB schema や repository method 名ではなく、再起動、reopen、migration をまたいで保持されるユーザー向け保存意味の境界。knowledge visibility、known source URL、thread binding、session identity、override session、retry job、forum progress、legacy compatibility data を含む。

System は DB I/O と persistence integrity を所有する。Harness は保存意図、source selection、要約、`knowledge_writes` の advisory handoff を返す。`knowledge_writes` と実際の DB 保存完了は同一視しない。

Persistence Boundary Registry は独立 boundary にしない。保存対象ごとの同一性と round-trip 意味は、Place Capability Assignment、Knowledge Thread Binding、Forum Research Thread Progress、Admin Override Thread Lifecycle、Thread Cursor And Retry Progress、および shared invariant へ投影する。

## Knowledge Ingest

公開情報を根拠化し、共有知見として保存または返信するユーザー向け機能。入口は URL watch root の URL 投稿、自然文の明示保存要求、既存 knowledge thread の follow-up で異なる。

保存根拠にできるのは、取得許可された公開 URL、または same-turn public reconfirmation で根拠化された公開情報である。`blocked_urls`、localhost、private IP、`.local`、`file:`、`data:`、`javascript:`、根拠化されていない URL は取得対象にも保存根拠にもならない。

通常 chat の URL は、明示保存要求がない限り会話材料であり、自動で知見保存や thread 化に進めない。

## Knowledge Thread

URL ingest などから作成または再利用される public thread。共有知見の返信、known source URL、follow-up 文脈の場である。

同一性は thread id、source message id、root channel id、knowledge record id、known source URL set の結合で決まる。active binding がある thread の follow-up は same thread に返し、known source を優先する。missing / stale binding のときは known source を捏造しない。

Knowledge Thread は Forum Research Thread や Admin Override Thread ではない。どれも Discord thread だが、activation、保存意味、workspace-write 可否が異なる。

## Forum Research Thread

`forum_research` PlaceFeature が割り当てられた forum parent 配下の post thread。長文研究、深掘り相談、文脈保持を目的とする。

同一性は forum post thread id、starter message id、root forum channel id で決まる。starter message は mention なしで起動対象になり、starter 後の follow-up は bot mention がある場合だけ起動対象になる。non-mention follow-up は no reply / no processing reaction として ignore される。

forum parent channel 自体を会話単位にしない。公開 final は Safety-Before-Publish を通過してから same forum thread に publish される。

## Safety-Before-Publish

final public candidate を Discord に公開する前に、根拠、安全、出力境界を確認する横断 gate。単体の state-owner boundary ではない。

`final` は公開候補であり、publish 済み本文ではない。publish は safety 通過後の System side effect である。unsafe candidate、未観測 source を含む candidate、公開不可の出力境界を越える candidate は先に Discord へ送らない。

Forum Research Thread Progress と reply dispatch readiness に投影される。投稿後 moderation や admin diagnostics と混同しない。

## Admin Override Thread

owner/admin が origin place から明示 command 操作で起動する dedicated thread。workspace-write context を許可する唯一の場所である。

同一性は guild id、dedicated thread id、origin place、actor id、sandbox capability、開始時点の active session で決まる。workspace-write は同一 actor かつ dedicated thread 内の turn に限定される。origin place は導線元であり write context の所有者ではない。

end command により session を閉じ thread archive へ進む。TTL による勝手な終了は正本にしない。終了済み thread、別 actor、dedicated thread 外では active override として扱わない。

## Owner/Admin

override と admin diagnostics に必要な authority fact を持つ actor。owner user id または Discord Administrator 権限などの解決結果として扱う。

Owner/Admin Eligibility の取得は外側の Policy / Provider / System boundary の責務であり、state-owner boundary 内で Discord API を読んで決めない。boundary には決定済み authority fact が Deterministic Context として渡される。

## Admin Diagnostics

admin_control / admin_override 相当の管理 place で、owner/admin が明示 diagnostics request または command 操作を行ったときだけ返す管理用結果。

固定文言 trigger list を System 正本にしない。通常の管理会話、権限確認、override 操作結果、terminal failure notification と混同しない。明示 diagnostics intent は Harness contract 側の意味判断または command fact として渡され、admin place と authority fact の gate を通る。

## Thread Cursor

thread / channel 内で、どの message が observed、processing、retry pending、completed、terminal failure notified であるかを区別する観測上の進捗境界。

内部 DB row 名ではない。message id、thread id、reply target、processing status、retry attempt などを結合して、重複処理、retry、recovery の外部観測を守る。

cursor は後退しない。pending retry duplicate は visible cursor を進めず、completed duplicate は巻き戻さず、terminal failure は無言完了として扱わない。

## Storage Round-Trip / Migration Preservation

保存した state が再読込、再起動、migration 後にも同じユーザー向け意味を保つこと。対象は knowledge visibility、source link、thread binding、session identity、override session、retry job、forum progress、legacy compatibility data である。

DB table 名、migration 番号、repository method は仕様正本にしない。legacy rows は silent drop せず、互換 visibility または quarantine として扱う。legacy session を新 runtime binding として誤 reuse しない。

## Event / Effect

Event は状態遷移の結果として起きた事実であり、副作用命令ではない。`ForumReplyPublished` や `OverrideThreadArchived` のような名前は、boundary が所有する状態がその事実を発行したことを表す。

Discord send、thread create/archive、DB write、external fetch、retry scheduling、UI 更新は Effect Handler / Application Service / Provider の責務である。Event payload は後続 Effect が必要な reply target、source place、thread id、record id、actor id などの事実を持つが、Effect Handler が boundary 内部状態を推測する設計にしない。
