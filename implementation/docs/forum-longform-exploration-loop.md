# Forum Longform Supervisor Path

更新日: 2026-03-15

## 目的

- `forum_longform` の公開調査回答を `prompt refinement -> high supervisor -> low parallel workers -> high final` で実行する。
- System は session / side effect / interrupt / visible retry / persistence だけを持ち、意味判断は Harness に残す。
- persisted state は evidence facts のみを保持し、`十分だった` のような semantic judgement は保存しない。

## 実行モデル

- 初回 high turn は `forum_research_prompt_refiner`、次の high turn は `forum_research_supervisor`。
- supervisor は次を返す。
  - `progress_notice`
  - `worker_tasks`
  - `interrupts`
  - `next_action`
  - `final_brief`
- prompt refiner は次を返す。
  - `refined_prompt`
  - `progress_notice`
  - `prompt_rationale_summary`
- low worker は単一 subquestion だけを扱い、最大 4 本まで並列で走る。
- worker 完了または interrupt 後に supervisor を再度呼び、続行・追加 worker・停止・finalize を判断する。
- final answer は bound forum session 上の high turn で生成する。

## Facts / Control

- facts plane:
  - starter message facts
  - evidence items
  - source catalog
  - distinct source list
  - active/completed/failed/interrupted worker facts
- control plane:
  - task kind / phase
  - supervisor decision envelope
  - turn ids
  - interrupt requests
  - retry kind
  - stream state

## Runtime Notes

- fixed phase budget や planner fallback は持たない。
- forum retry は generic scheduler row を正本にせず、same-request visible retry と streaming を優先する。
- references appendix は本文と別メッセージで送る。
- `refined_prompt` は evidence state に混ぜず、別の hidden prompt artifact として保存する。
