# Local Scorer spike (M5)

This is an **experimental, one-role spike** for running the Scorer against a
local OpenAI-compatible endpoint. It does not make Job Hunter Team a zero-cloud
system: every other role still uses `active_provider`, and optional cloud sync,
Telegram, sourcing sites, and the public web plane retain their existing
network behavior.

The safe default is `shadow`: the worker scores queued positions and prints
validated results, but does not write to SQLite or advance the queue.

## Runtime contract

The adapter works with a locally hosted server that implements
`POST /v1/chat/completions`. This includes suitably configured Ollama and
llama.cpp servers; installing and selecting a model remains an operator choice.
JHT does not download a model automatically.

The runtime container reaches a server on the host through
`host.docker.internal`. Configure `~/.jht/jht.config.json` without changing the
normal team provider:

```json
{
  "active_provider": "openai",
  "providers": {
    "openai": {"name": "openai", "auth_method": "subscription"}
  },
  "team": {
    "local_scorer": {
      "enabled": true,
      "backend": "openai_compatible",
      "base_url": "http://host.docker.internal:11434/v1",
      "model": "the-model-name-exposed-by-your-local-server",
      "mode": "shadow",
      "timeout_seconds": 120,
      "poll_seconds": 120
    }
  },
  "channels": {},
  "workspace": "/jht_user"
}
```

For a llama.cpp server on port 8080, use
`http://host.docker.internal:8080/v1`. The adapter rejects HTTPS and non-local
hostnames/IPs so the adapter cannot be configured directly with a remote
service while being described as local.

Before launching the team, verify the server from the same network boundary as
JHT:

```bash
docker exec jht curl -fsS http://host.docker.internal:11434/v1/models
docker exec jht python3 /app/shared/skills/local_scorer.py once
```

The launcher checks `team.local_scorer.enabled` only when starting a Scorer.
Other roles continue to launch the configured Claude, Codex, or Kimi CLI.

## Shadow, then write

Keep `mode: "shadow"` while collecting paired results. The process remembers
the positions it evaluated during that run so it does not loop on the first
queued row. Restarting it clears that in-memory shadow set; this is intentional
because shadow output is not source-of-truth state.

Set `mode: "write"` only after reviewing the paired evaluation. In write mode,
each response must pass deterministic checks before existing DB skills are
called:

- every rubric component is an integer in its documented range;
- `total_score` equals the five components minus explicit penalties;
- the `scored`/`excluded` decision matches the existing 40-point threshold;
- the interactive 0–25 experience component is normalized to the DB's 0–10
  persistence range at one audited boundary;
- malformed output leaves the position in `checked`.

This spike does **not** yet reproduce the interactive Scorer's live URL check or
feedback-derived multiplier. That is why write mode is experimental and why a
distribution match alone is not a promotion gate.

## Quality harness

The repository case studies expose score distributions, not paired judgments
on the same candidate and positions. They can detect gross calibration drift,
but cannot establish scoring quality:

```bash
python3 scripts/analysis/m5_score_quality.py distribution \
  --local /tmp/local-total-scores.json \
  --baseline web/data/case-studies/betaB-kimi-run.json
```

The command labels its output `distribution_only_not_quality_validation`.
For a meaningful comparison, score exactly the same positions with the
reference Scorer and the local model, then provide rows shaped like the fixture
in `tests/fixtures/m5-paired-scores.json`:

```bash
python3 scripts/analysis/m5_score_quality.py paired \
  --input tests/fixtures/m5-paired-scores.json \
  --provenance fixture
```

Use `--provenance hardware` only for data actually produced on the hardware
being reported. Even then, output remains labeled as not independently
validated. The harness calculates MAE, RMSE, tolerance rates, and agreement at
the exclusion threshold; it deliberately does not invent an acceptance
threshold.

## Hardware requirements and measurement

No hardware configuration has been validated by this repository yet. In
particular, the deterministic test fixture is **not a benchmark**, and this
guide makes no tokens-per-second, latency, or minimum-RAM claim.

Functional prerequisites are:

1. A CPU architecture supported by the chosen local runtime and model format.
2. Enough system RAM and/or accelerator memory for model weights, KV cache,
   runtime workspace, the JHT container, and the operating system at the same
   time.
3. An OpenAI-compatible server bound to the host and reachable from the JHT
   container.
4. Enough context capacity for the candidate profile, one full position, the
   rubric, and the generated JSON response.
5. Sustained thermals and free disk space appropriate to the operator's chosen
   model and quantization.

Memory must be sized from the actual model artifact, not its marketing
parameter count:

```text
required working memory
  = model artifact resident bytes
  + KV cache at the configured context
  + runtime/compute workspace
  + JHT container and OS headroom
```

Record at least these fields for a reproducible hardware run:

| Field | Required evidence |
|---|---|
| Host | OS, CPU, RAM, accelerator and accelerator memory |
| Runtime | Ollama/llama.cpp version and launch arguments |
| Model | exact model identifier, artifact hash/size, quantization, context |
| Dataset | paired position IDs and reference provenance |
| Performance | cold/warm latency, tokens/s if exposed, peak RAM/VRAM, failures |
| Quality | raw harness JSON and the tested commit SHA |

Until a row with that evidence is committed, hardware support remains
**unvalidated**, not implicitly green.

## Current exit criteria for the spike

- Adapter, JSON parsing, range checks, persistence mapping, and quality math
  remain green in deterministic tests.
- A real paired dataset is collected on the target hardware.
- The missing URL and feedback behavior is implemented or explicitly accepted
  as a narrower Scorer contract.
- Only then may M5 progress from “one-role spike” toward additional local roles.
