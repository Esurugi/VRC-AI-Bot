import { createInterface } from "node:readline";

// Protocol peer only: acquisition, provenance, safety and persistence run in
// production code. Generated wording here is not summary-quality evidence.
let ordinal = 0;
let turn;
let savedCursor;
const turns = new Map();
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => send({ method, params });
const sourceUrl = "https://arxiv.org/abs/2504.01990";
createInterface({ input: process.stdin }).on("line", (line) => {
  const rpc = JSON.parse(line);
  if (rpc.method === "initialize") return send({ id: rpc.id, result: {} });
  if (rpc.method === "thread/start") {
    if (!rpc.params.dynamicTools?.some((tool) => tool.name === "vrc_public_source_fetch")) return send({ id: rpc.id, error: { message: "missing public source tool" } });
    return send({ id: rpc.id, result: { thread: { id: `thread-${++ordinal}` } } });
  }
  if (rpc.method === "thread/read") return send({ id: rpc.id, result: { thread: { turns: [turns.get(rpc.params.threadId)] } } });
  if (rpc.method === "turn/start") {
    turn = { id: `turn-${++ordinal}`, threadId: rpc.params.threadId, request: JSON.parse(rpc.params.input[0].text), facts: [] };
    send({ id: rpc.id, result: { turn: { id: turn.id } } });
    notify("turn/started", { threadId: turn.threadId, turn: { id: turn.id } });
    if (turn.request.task.phase === "intent") return finish({ outcome_candidate: "knowledge_ingest", repo_write_intent: false, requested_external_fetch: "public_research", requested_knowledge_write: true, moderation_signal: { violation_category: "none", control_request_class: null, notes: null }, diagnostics: { notes: null } });
    if (turn.request.task.phase === "retry") {
      turn.facts = turn.request.available_context.public_source_facts;
      return finish(summary());
    }
    return call(turn.request.message.content === "stale-cursor" ? savedCursor : undefined);
  }
  if (rpc.method) {
    if (rpc.id !== undefined) send({ id: rpc.id, result: {} });
    return;
  }
  if (rpc.id?.startsWith?.("tool-")) {
    if (!rpc.result.success) return finish({ ...summary(), outcome: "failure", public_text: rpc.result.contentItems[0].text, knowledge_writes: [], sources_used: [] });
    const output = JSON.parse(rpc.result.contentItems[0].text);
    turn.facts.push(...output.facts);
    if (output.next_cursor) {
      savedCursor = output.next_cursor;
      return call(output.next_cursor);
    }
    finish(summary());
  }
});
function call(cursor) {
  send({ id: `tool-${++ordinal}`, method: "item/tool/call", params: { threadId: turn.request.message.content === "foreign-thread" ? "another-thread" : turn.threadId, turnId: turn.id, callId: `call-${ordinal}`, tool: "vrc_public_source_fetch", arguments: { url: sourceUrl, ...(cursor ? { cursor } : {}) } } });
}
function summary() {
  const text = turn.facts.map((fact) => fact.text).join("");
  return { outcome: "knowledge_ingest", repo_write_intent: false, public_text: text, reply_mode: "create_public_thread", target_thread_id: null, selected_source_ids: [], sources_used: [sourceUrl, ...(turn.request.message.content === "retry" && turn.request.task.phase !== "retry" ? ["https://unobserved.example/source"] : [])], knowledge_writes: [{ source_url: sourceUrl, canonical_url: sourceUrl, title: "Foundation Agents", summary: text, tags: [], content_hash: null, normalized_text: text, source_kind: "webpage", evidence_fact_ids: turn.facts.map((fact) => fact.fact_id) }], diagnostics: { notes: null }, sensitivity_raise: "none" };
}
function finish(value) {
  const item = { id: `answer-${ordinal}`, type: "agentMessage", text: JSON.stringify(value) };
  turns.set(turn.threadId, { id: turn.id, items: [item] });
  notify("item/completed", { threadId: turn.threadId, turnId: turn.id, item });
  notify("turn/completed", { threadId: turn.threadId, turn: { id: turn.id, status: "completed" } });
}
