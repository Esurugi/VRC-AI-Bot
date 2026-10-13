import { createInterface } from "node:readline";

// Only the model/RPC peer is scripted. Host acquisition, evidence ownership,
// orchestration, persistence and citation publication remain production code.
let ordinal = 0;
let lastFact;
let failNextStart = false;
const turns = new Map();
const requests = new Map();
const calls = new Map();
const researchMemory = new Map();
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => send({ method, params });
const source = "https://example.com/research";
createInterface({ input: process.stdin }).on("line", line => {
  const rpc = JSON.parse(line);
  if (rpc.method === "initialize") return send({ id: rpc.id, result: {} });
  if (rpc.method === "thread/start") {
    if (failNextStart) { failNextStart = false; return send({ id: rpc.id, error: { code: -32000, message: "worker launch failed" } }); }
    return send({ id: rpc.id, result: { thread: { id: `thread-${++ordinal}` } } });
  }
  if (rpc.method === "thread/read") return send({ id: rpc.id, result: { thread: { turns: [turns.get(rpc.params.threadId)] } } });
  if (rpc.method === "turn/start") {
    // The provider rejected a real RAG handoff at this message-size boundary.
    if (rpc.params.input[0].text.length > 1_048_576) return send({ id: rpc.id, error: { code: -32602, message: "Input exceeds the maximum length of 1048576 characters." } });
    const turn = { id: `turn-${++ordinal}`, threadId: rpc.params.threadId, payload: JSON.parse(rpc.params.input[0].text), facts: [] };
    requests.set(turn.threadId, turn);
    send({ id: rpc.id, result: { turn: { id: turn.id } } });
    notify("turn/started", { threadId: turn.threadId, turn: { id: turn.id } });
    const p = turn.payload;
    if (p.forum_research_context?.execution_mode === "single") {
      if (p.request.message.id === "foreign") return call(turn, "vrc_read_research_evidence", { fact_id: lastFact }, "single-foreign");
      return call(turn, "vrc_public_source_fetch", { url: source }, "page");
    }
    if (p.kind === "forum_research_prompt_refiner") return finish(turn, { refined_prompt: "auxiliary prompt", progress_notice: null, prompt_rationale_summary: "test" });
    if (p.kind === "forum_research_supervisor") {
      if (p.original_request.message.id === "lead" && p.active_workers.length + p.completed_workers.length === 0) {
        return call(turn, "vrc_public_source_fetch", { url: "https://example.com/lead" }, "lead");
      }
      const foreign = p.original_request.message.id === "foreign";
      if (p.active_workers.length + p.completed_workers.length === 0) {
        failNextStart = p.original_request.message.id === "start-failure";
        return finish(turn, decision("launch_workers", (foreign ? ["foreign"] : failNextStart ? ["launch-fail", "research", "slow", "fail"] : ["research", "slow", "fail", "unknown"]).map(worker_id => ({ worker_id, question: worker_id, search_focus: worker_id, must_cover: [], min_sources: 1, max_sources: 5 }))));
      }
      if (p.worker_progress.length && p.active_workers.some(w => w.worker_id === "slow" && w.state === "running")) {
        return finish(turn, { ...decision("wait_for_workers"), interrupts: ["slow"], progress_notice: { message: "原文の条件を確認できました。適用範囲の疑問を調べています。", evidence_fact_ids: p.current_source_catalog.flatMap(s => s.evidence_fact_ids) } });
      }
      return finish(turn, { ...decision(p.active_workers.some(w => w.state === "running") ? "wait_for_workers" : "finalize"), final_brief: researchMemory.get(turn.threadId) ?? "preserve conditions" });
    }
    if (p.kind === "forum_research_worker") {
      if (p.task.worker_id === "research") return call(turn, "vrc_public_source_fetch", { url: source }, "page");
      if (p.task.worker_id === "foreign") return call(turn, "vrc_read_research_evidence", { fact_id: lastFact }, "foreign");
      return; // Controlled in-flight cohort, released by a supervisor interrupt.
    }
    const ids = p.forum_research_context.source_catalog.flatMap(s => s.evidence_fact_ids);
    if (ids.length) return call(turn, "vrc_read_research_evidence", { fact_id: ids.at(-1) }, "final");
    return finish(turn, "今回の取得根拠はありません。", true);
  }
  if (rpc.method === "turn/interrupt") {
    send({ id: rpc.id, result: {} });
    const turn = requests.get(rpc.params.threadId);
    notify("turn/completed", { threadId: turn.threadId, turn: { id: turn.id, status: "interrupted" } });
    if (turn.payload.task?.worker_id === "slow") {
      for (const worker of requests.values()) {
        if (worker.payload.request?.message.id !== turn.payload.request.message.id) continue;
        const id = worker.payload.task?.worker_id;
        if (id === "research") { lastFact = worker.facts[0].fact_id; finish(worker, packet(worker, worker.facts.map(f => f.fact_id))); }
        if (id === "unknown") finish(worker, packet(worker, ["unacquired-fact"]));
        if (id === "fail") notify("turn/completed", { threadId: worker.threadId, turn: { id: worker.id, status: "failed", error: { message: "scripted worker failure" } } });
      }
    }
    return;
  }
  if (rpc.method) { if (rpc.id !== undefined) send({ id: rpc.id, result: {} }); return; }
  const callState = calls.get(rpc.id);
  if (!callState) return;
  calls.delete(rpc.id);
  const { turn, stage } = callState;
  const single = turn.payload.forum_research_context?.execution_mode === "single";
  if (stage === "single-foreign") {
    if (rpc.result.success) throw new Error("history became current evidence");
    return finish(turn, "訂正を受け取りました。過去の根拠は今回の取得事実ではありません。", true);
  }
  if (single && stage === "page" && !rpc.result.success) return finish(turn, "今回の取得根拠はありません。", true);
  if (single && stage === "progress") {
    lastFact = turn.facts[0].fact_id;
    return call(turn, "vrc_read_research_evidence", { fact_id: turn.facts.at(-1).fact_id }, "single-final");
  }
  if (stage === "foreign") {
    if (rpc.result.success) throw new Error("cross-run evidence became readable");
    return finish(turn, packet(turn, [lastFact]));
  }
  if (stage === "lead" && !rpc.result.success) return finish(turn, decision("finalize"));
  if (!rpc.result.success) throw new Error(rpc.result.contentItems[0].text);
  const output = JSON.parse(rpc.result.contentItems[0].text);
  if (stage === "single-final") {
    if (!output.text.includes("END CONDITION")) throw new Error("source tail lost");
    return finish(turn, `原文の末尾条件を保持。[[source:${output.fact_id}]]\n\n${"説明を保つ。".repeat(450)}\n再引用。[[source:${turn.facts[0].fact_id}]]`, true);
  }
  if (stage === "final") {
    if (!output.text.includes("END CONDITION")) throw new Error("source tail lost at the evidence reader");
    const ids = turn.payload.forum_research_context.source_catalog.flatMap(s => s.evidence_fact_ids);
    return finish(turn, `原文の末尾条件を保持。[[source:${output.fact_id}]]\n\n${"説明を保つ。".repeat(450)}\n同じ資料の再引用。[[source:${ids[0]}]]`, true);
  }
  if (stage === "lead") {
    researchMemory.set(turn.threadId, output.facts[0].text);
    return finish(turn, decision("launch_workers", ["research", "slow", "fail", "unknown"].map(worker_id => ({ worker_id, question: worker_id, search_focus: worker_id, must_cover: [], min_sources: 1, max_sources: 5 }))));
  }
  if (stage === "page") {
    turn.facts.push(...output.facts);
    if (output.next_cursor) return call(turn, "vrc_public_source_fetch", { url: source, cursor: output.next_cursor }, "page");
    return call(turn, "vrc_public_source_fetch", { url: "https://example.com/unavailable" }, "failure");
  }
  if (stage === "failure") return call(turn, "vrc_report_research_progress", { message: "原文の末尾条件を確認。", evidence_fact_ids: turn.facts.map(f => f.fact_id) }, "progress");
});
function call(turn, tool, args, stage) {
  const id = `tool-${++ordinal}`;
  calls.set(id, { turn, stage });
  send({ id, method: "item/tool/call", params: { threadId: turn.threadId, turnId: turn.id, callId: id, tool, arguments: args } });
}
function packet(turn, ids) {
  return { worker_id: turn.payload.task.worker_id, subquestion: turn.payload.task.question, evidence_items: [{ claim: "原文の末尾条件を保持", evidence_fact_ids: ids, source_urls: ["https://model-only.example/not-fetched"] }], citations: [{ url: "https://model-only.example/not-fetched", claim: "unauthoritative" }], applicability: ["conditions"], limitations: ["limitations"], unresolved_questions: ["unresolved"] };
}
function decision(next_action, worker_tasks = []) { return { next_action, worker_tasks, interrupts: [], progress_notice: null, final_brief: "preserve conditions" }; }
function finish(turn, value, plain = false) {
  const item = { id: `answer-${++ordinal}`, type: "agentMessage", text: plain ? value : JSON.stringify(value) };
  turns.set(turn.threadId, { id: turn.id, items: [item] });
  notify("item/completed", { threadId: turn.threadId, turnId: turn.id, item });
  notify("turn/completed", { threadId: turn.threadId, turn: { id: turn.id, status: "completed" } });
}
