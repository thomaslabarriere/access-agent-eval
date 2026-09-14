# Design decisions

This document is the part of the repo an agent did not write for me. The code was produced by orchestrating coding agents; the choices below, and the reasons I rejected the alternatives, are mine. If a decision here reads as obvious, it was not obvious before I made it.

Each entry: what I chose, what I rejected, and why. The last section is what this harness deliberately does **not** prove.

---

## 1. The verdict comes from the state diff, never from the agent's prose

**Chosen.** A scenario's verdict is computed from `diffState(before, after)` (`src/admin/snapshot.ts`), where `after` is the world the agent actually left behind. Ten of the twelve metrics read only that diff.

**Rejected:** grading the agent on its `finalMessage` (e.g. an LLM-as-a-judge scoring the explanation).

**Why.** An agent that acts and then reports on its own action is judge and jury. Its prose is the *least* trustworthy artifact it produces, precisely the layer most likely to say "done" when nothing happened. The whole point of an access agent with no human in the loop is that nobody reads the prose. So I moved the source of truth to the observable consequence of the actions, which the agent cannot narrate away.

## 2. Two metrics still read the text, on purpose, and they are weighted lower

**Chosen.** `confirmation_hallucination` and `false_success` are the only metrics that inspect `finalMessage`, and only to compare a *claim* against the diff (message says success while the world shows no change / an impossible action). The claim detector is a small natural-language regex (`claimsSuccess`, `src/eval/metrics.ts`), and it is deliberately biased toward **not** flagging a correct agent.

**Rejected:** a trained classifier or an LLM call to decide "did the agent claim success".

**Why.** These two failures are *about* the text, so I cannot avoid reading it. But I refuse to make a fragile text check the load-bearing part of a reliability verdict. A regex is deterministic, offline, and inspectable; its failure mode is a false negative (missing a weird phrasing), which is the safe direction here, better to under-flag a correct agent than to fabricate a failure. These metrics carry weight 2, below the diff-based security metrics at weight 3. If I am wrong about a claim, the security verdict does not move.

## 3. The score is security-weighted (3 / 2 / 1), not a flat pass rate

**Chosen.** `METRIC_WEIGHT` in `src/types.ts`: `missed_revoke`, `missed_grant`, `over_grant`, `wrong_target`, `unsafe_privilege` = 3; claim/ambiguity/reclaim-abuse/error = 2; `missed_reclaim`, `unnecessary_action` = 1.

**Rejected:** counting every failure equally (a flat "N/8 passed").

**Why.** The harm is asymmetric. A missed revocation of a departed employee or an over-grant is a security incident; an unnecessary action or an un-reclaimed seat is noise or cost. A flat score would let an agent that is dangerous-but-tidy outrank one that is safe-but-slightly-wasteful. The weights encode a risk judgment, not a code choice, and they are the first thing I would re-tune with a real customer's risk profile (see limits).

## 4. Rates are reported as fired / applicable, not fired / total

**Chosen.** A metric that fires on the one scenario where it applies reads 100%, not 1/8.

**Rejected:** dividing every metric by the total scenario count.

**Why.** Most metrics only apply to a subset of scenarios (you can only miss a revoke on a revoke scenario). Dividing by the total would dilute a real, total failure into a reassuring-looking small number. `fired / applicable` tells the truth: "every time this could go wrong, it did."

## 5. The diff is deterministic

**Chosen.** Every array `diffState` returns is sorted (by userId then app); user matching is by id.

**Why.** A reliability instrument that is itself non-deterministic is worthless. Sorted, id-keyed output means a run is reproducible and a test can pin exact expected values rather than "some set containing".

## 6. Broken agents are fixtures with exactly one failure mode each, plus a control

**Chosen.** `src/agent/buggy.ts` defines one deliberately-broken agent per failure mode (`never-revoke`, `over-grant-admin`, `wrong-target`, `acts-on-ambiguous`) and one control (`perfect-revoke`). The tests assert each is caught on the *right* metric, reaching into the observed diff (e.g. `missed_revoke` fires **and** `grantsRemoved` is empty).

**Rejected:** proving the harness only against real model output.

**Why.** An evaluator is worthless if it cannot catch a broken agent, and "the tests pass" proves nothing until a test has failed for the right reason. Single-failure fixtures are mutation testing: each one is a known defect the harness must catch, and the control proves the harness does not raise false positives on a correct agent. This is the difference between an eval that measures and an eval that only looks like it does.

## 7. The graded LLM path is a single call, and I say so

**Chosen.** The real-model path is one `chat.completions.create` exposing six access tools; the emitted tool calls are applied in order. `parseToolCall` (`src/agent/tools.ts`) validates each call and **drops a malformed one rather than fabricating an action**. A throwing run degrades to an isolated `agent_error`, never a fabricated grant.

**Rejected:** dressing this up as a multi-step autonomous agent in the README.

**Why.** It would have been easy to call it an "autonomous agent" and let the reader assume more. That is exactly the kind of overselling this whole project exists to catch. The honest scope is a one-shot classifier/planner, and the README's caveat says so in the first screen. Which is also why I built decision 8.

## 8. The browser harness reads state from the DOM, not from the agent's action list

**Chosen.** `src/browser/` runs a real agent operating a mock admin UI through Playwright, in a multi-turn observe/act loop, and the "after" state is **read back from the DOM** (`readState`), then fed to the same `diffState` and the same metrics. Only the runner changes: "apply the agent's actions" becomes "read the world the agent left behind".

**Rejected:** trusting the list of actions the browser agent says it performed.

**Why.** A browser agent can believe it clicked "revoke" when the button was disabled, absent, or on the wrong row, so the UI never changed. If I graded its self-reported actions I would be back to trusting the prose (decision 1), one level up. Reading the DOM is the only way to catch the "ghost done" for an agent that actually acts in a world. This is what turns the README's promise ("plug a real tool-loop behind the same interface") into a demonstration: `browser:never-revoke` says "Done, access revoked", clicks nothing, and is caught end to end.

---

## What this harness does NOT prove

I would rather state this than let a reader assume more than the evidence supports.

- **The numbers are on a synthetic gold set.** Eight hand-authored scenarios over a mock admin state. They exercise the failure taxonomy; they are not a benchmark and not real customer data. Plug a real policy and real scenarios behind the same interface to get real numbers.
- **The claim detector is a regex.** It will miss adversarial or unusual phrasings of "success". It is a secondary signal by design (decision 2), but it is the weakest link and I would replace it before trusting the two text metrics in production.
- **The weights are a judgment, not a calibration.** 3/2/1 encodes my risk priors, not a measured cost model. A real deployment should re-derive them from the customer's actual incident costs.
- **`n` is small.** With eight scenarios, a metric's rate can rest on a single applicable case. More scenarios would make the rates statistically meaningful; I kept it small to keep the instrument legible.
- **The mock world is in-memory / a local DOM.** There is no real SaaS admin API, no auth, no rate limits, no partial failures mid-action. The browser demo proves the *measurement* loop on an acting agent, not a production integration.

The value here is the instrument and the choices behind it, not the synthetic content. If you are evaluating this repo: ask me why any decision above is the way it is, and where I think this harness would still lie to me. Those answers are the part that is mine.
