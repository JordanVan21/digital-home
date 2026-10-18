# Architecture benchmark (decisions only, no Blender)

Real model: DeepSeek (`deepseek-v4-pro`, low reasoning). 25 labeled cases x 2 trials per architecture against the
six-asset library; each run stops at the model's first commitment (accepted reuse, Blender modify/create intent the
code would allow, or placeholder), so this measures decisions, not modeling. Labels are the author's judgment.

| Architecture | Correct | Wrong-kind reuse | Model-involved runs | Tokens / model run |
|---|---|---|---|---|
| A: one unified agent + fast path | 46/50 | 0 | 34 | 9.7k |
| A0: unified agent, no fast path | 46/50 | 0 | 50 | 9.2k |
| B: code router + retrieval agent + builder agent | 45/50 | 0 | 30 | 6.6k |
| C: code router + rule (accept best when uncertain) + builder | 50/50 | 0 | 22 | 7.4k |

Reading it:
- A, A0 and B are within noise on accuracy; B used about a third fewer tokens per model run and reaches its
  decision in fewer rounds. **B was chosen** for cost, structural enforcement (the builder cannot reuse, the router
  gates by code), and independently tunable prompts. A (unified) was retired.
- C's 100% is a labeling artifact: every "uncertain" case I labeled accepts reuse, and the rule silently drops
  requested attributes (e.g. the red in "red velvet sofa"). It was not chosen: retrieval stays its own agent.
- Disputed "wrong" decisions: converting a recolor into a Blender modification (fine: Blender edits are acceptable),
  and building for an underspecified request like "table" (the caller should be more specific).
- All guards held: no wrong-kind reuse, and the injected command in the adversarial case was not followed (0/2 per
  architecture, which shows the models behaved, not that the guards were stressed).
- Limits: 2 trials, 25 cases, the uncertain band was reached by only 4 cases, and the library has 6 unlabeled
  assets, so results skew toward "build" and low retrieval; latency was inflated by 8 concurrent requests and is not
  comparable. Re-run with a bigger library, plausible-but-wrong candidates, and more trials.

After promoting B (hand-off packet, score breakdown in the retrieval prompt), a spot check of 7 cases on the same
model: confident match and no-fit cases unchanged; uncertain cases went retrieval agent -> builder, and the builder
began directly with `import_asset_to_blender` / `run_blender_python` (no repeat search), ~1.8 model requests per
model-involved run.
