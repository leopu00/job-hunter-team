import {
  AssistantApiWorker,
  CaptainApiWorker,
  CriticApiWorker,
  DoctorApiWorker,
  MaintainerApiWorker,
  MentorApiWorker,
  SentinelApiWorker,
  WriterApiWorker,
} from "./prototype-roles.js";
import { runStructuredRoleCli } from "./structured-role-cli.js";

const definitions = {
  writer: WriterApiWorker,
  critic: CriticApiWorker,
  assistant: AssistantApiWorker,
  mentor: MentorApiWorker,
  captain: CaptainApiWorker,
  sentinel: SentinelApiWorker,
  doctor: DoctorApiWorker,
  maintainer: MaintainerApiWorker,
} as const;

const role = process.argv[2] as keyof typeof definitions | undefined;
if (!role || !(role in definitions)) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "CLI_CONFIGURATION", message: "A supported API role is required." } })}\n`,
  );
  process.exitCode = 1;
} else {
  process.argv.splice(2, 1);
  const Worker = definitions[role];
  await runStructuredRoleCli({
    label: role[0]!.toUpperCase() + role.slice(1),
    fixtureName: "prototype-inputs.synthetic.json",
    fixtureKey: role,
    runtimeName: role,
    createWorker: (profile, runtimeDir, liveEnabled) =>
      new Worker(profile, { runtimeDir, liveEnabled }) as InstanceType<
        typeof Worker
      >,
  });
}
