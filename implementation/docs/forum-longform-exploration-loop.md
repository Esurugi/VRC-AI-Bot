# Forum Longform Exploration Loop

更新日: 2026-03-13

## 目的

- `forum_longform` の answer turn を、単発の回答生成ではなく `work -> checkpoint -> finalize` の探索ループとして実行する。
- System は phase orchestration と hard boundary だけを持ち、検索結果の意味判断と停止判断は Harness に残す。

## 実行モデル

- 対象は `forum_longform` の answer / output-safety retry のみ。
- phase は `acquire`, `integrate`, `verify`, `finalize`。
- 1 iteration は次の 2 turn で構成する。
  - work turn
  - checkpoint turn
- final answer は別の finalize turn で生成する。
- budget は次で固定する。
  - work turn: soft 120s / hard 240s
  - checkpoint turn: soft 30s / hard 60s
  - max iterations: 4
  - total loop budget: 8 minutes
- 2 iteration ごとに `thread/compact/start` を呼ぶ。

## Steering

- `turn/steer` は deterministic trigger でだけ使う。
- idle steer:
  - 30 秒以上 activity がない
- broadening-search steer:
  - `acquire` / `verify` で `webSearch.search` が 3 回以上続き、`openPage` / `findInPage` に進んでいない
- steer は検索結果の良し悪しを判定しない。既存 gap への再フォーカスだけを指示する。

## Runtime Trace

`.tmp/runtime-trace/codex-app-server.ndjson` に次の event を出す。

- `phase_started`
- `phase_completed`
- `checkpoint_received`
- `next_phase_selected`
- `termination_set`
- `compaction_started`
- `retry_finalize_started`
- `turn_steer_requested`

trace payload では semantic な要約ではなく control-plane fact を優先して残す。

## Discord 手動確認

1. forum 初回質問で、検索が必要な問いは複数 phase を通ってから final answer が返ること。
2. 外部観測が不要な問いは、無駄な検索を増やさず早めに finalize へ進むこと。
3. 長い探索でも 2 iteration ごとに compaction が入り、会話継続が破綻しないこと。
4. timeout や output-safety retry が起きても、forum thread の同じ session と explicit prior state を保ったまま finalize されること。
5. citations と `sources_used` の既存 forum 契約が壊れていないこと。
