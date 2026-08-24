import { ScorerApiWorker } from "./scorer-worker.js";
import { runStructuredRoleCli } from "./structured-role-cli.js";

await runStructuredRoleCli({
  label: "Scorer",
  fixtureName: "scorer-input.synthetic.json",
  runtimeName: "scorer",
  createWorker: (profile, runtimeDir, liveEnabled) =>
    new ScorerApiWorker(profile, { runtimeDir, liveEnabled }),
});
