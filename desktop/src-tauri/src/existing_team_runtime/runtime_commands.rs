use super::*;

/// The command a reader of the team's data runs, always with the same input (the app's own script
/// in hex, then the request): the pinned container of an existing team, or, on the VPS the app set
/// up itself, its host's wrapper on the python channel the chat uses (only when the wrapper carries
/// the chat's protocol line; the channel reads the attested container and never starts it).
pub(crate) fn read_command_for(
    selected: Option<ActivatedTarget>,
    host: &ExecutionHost,
) -> Result<String, &'static str> {
    match selected {
        Some(target) => python_command(&target.runtime),
        None if matches!(host, ExecutionHost::Vps { .. }) => Ok(crate::direct_chat::REMOTE_PYTHON_STDIN.to_owned()),
        None => Err("existing_team_runtime_required"),
    }
}

pub(crate) fn read_command(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<String, &'static str> {
    read_command_for(selected_or_own(app, scope, host)?, host)
}

/// The container engine of the VPS, chosen the same way by every remote script: Docker when it is
/// there and is Docker, otherwise Podman (a VPS can run the team on rootless Podman, with no
/// `docker` at all; a `docker` that is Podman's shim answers with Podman's shapes, so it is Podman).
/// None of the two: the script stops with `$1`, the exit code the caller reads as «not reachable».
pub(crate) fn engine_selection(exit: u8) -> String {
    format!(
        r#"if command -v docker >/dev/null 2>&1 && ! docker --version 2>/dev/null | grep -qi podman; then JHT_ENGINE=docker
elif command -v podman >/dev/null 2>&1; then JHT_ENGINE=podman
else exit {exit}; fi"#
    )
}

/// Prefixes a source-owned operation with a fresh CID/index/manifest check.
/// The descriptor is intentionally distinct from the container image index.
///
/// Docker (containerd store): the container's image is the index, the descriptor is the platform
/// manifest and `image inspect --platform` names it. Podman has neither: its image id is the
/// config (`sha256:` added, Podman prints it bare), the index is the image's `.Digest` (the one
/// the container records as `.ImageDigest`) and the platform manifest is the image's other
/// RepoDigest of the fixed repository. The same five values are checked again by every command.
pub(crate) fn command(target: &RuntimeTarget, operation: &str) -> Result<String, &'static str> {
    if !valid_target(target) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        r#"set -eu
JHT_CID='{cid}'; JHT_IMAGE='{image}'; JHT_PLATFORM_IMAGE='{platform}'; JHT_REVISION='{revision}'; JHT_DIGEST='{digest}'; JHT_PLATFORM='{os}/{architecture}'
{engine}
if [ "$JHT_ENGINE" = podman ]; then
JHT_CONTAINER="$(podman inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{.ImageDigest}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|${{JHT_IMAGE#sha256:}}|true|$JHT_REVISION|$JHT_DIGEST" ] || exit 70
JHT_DEFAULT="$(podman image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{.Digest}}}}|,{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "${{JHT_IMAGE#sha256:}}")" || exit 70
case "$JHT_DEFAULT" in "${{JHT_IMAGE#sha256:}}|"$JHT_PLATFORM"|$JHT_REVISION|$JHT_DIGEST|"*",ghcr.io/leopu00/jht@$JHT_DIGEST,"*) ;; *) exit 70 ;; esac
case "$JHT_DEFAULT" in *",ghcr.io/leopu00/jht@$JHT_PLATFORM_IMAGE,"*) ;; *) exit 70 ;; esac
else
JHT_CONTAINER="$(docker inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{index .ImageManifestDescriptor "digest"}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|$JHT_IMAGE|true|$JHT_REVISION|$JHT_PLATFORM_IMAGE" ] || exit 70
JHT_DEFAULT="$(docker image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_DEFAULT" in "$JHT_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
JHT_EXPLICIT="$(docker image inspect --platform "$JHT_PLATFORM" --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_EXPLICIT" in "$JHT_PLATFORM_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
fi
{operation}"#,
        engine = engine_selection(70),
        cid = target.container_id,
        image = target.image_id,
        platform = target.platform_image_id,
        revision = target.oci_revision,
        digest = target.digest,
        os = target.os,
        architecture = target.architecture
    ))
}

/// The team id (the account's user id) arrives on stdin and stays on stdin: `printf` is a
/// builtin of the VPS shell, so the pipe into the engine's `exec -i` puts it on no argument list,
/// which anyone who lists the host's processes could read.
pub(crate) fn team_probe_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        r#"IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
printf '%s\n' "$JHT_EXPECTED_TEAM" | "$JHT_ENGINE" exec -i "$JHT_CID" node -e '
const fs=require("fs"), expected=fs.readFileSync(0,"utf8").replace(/\n$/,"");
let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1"); console.log("providerConfigured="+(configured?"1":"0")); console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0")); console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0")); console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' || exit $?
if "$JHT_ENGINE" exec "$JHT_CID" tmux has-session -t CAPITANO 2>/dev/null; then JHT_CAPTAIN=1; else JHT_CAPTAIN=0; fi
if "$JHT_ENGINE" exec "$JHT_CID" tmux has-session -t ASSISTENTE 2>/dev/null; then JHT_ASSISTANT=1; else JHT_ASSISTANT=0; fi
printf 'captainRunning=%s\nassistantRunning=%s\n' "$JHT_CAPTAIN" "$JHT_ASSISTANT""#,
    )
}

/// Starts the ASSISTENTE session inside the pinned container. It is the script the CLI's
/// `jht team start assistente` runs in a container (`/app/.launcher/start-agent.sh assistente`),
/// reached through `command`, so the container, image, platform and digest are verified first
/// (exit 70 otherwise) and the default container is never named. The script is idempotent
/// (a lock per session, an exact `tmux has-session`), opens the team's provider and injects the
/// one-shot welcome message, which spends the provider account's tokens.
pub(crate) fn assistant_start_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        "\"$JHT_ENGINE\" exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash /app/.launcher/start-agent.sh assistente </dev/null",
    )
}

pub(super) const PYTHON_STDIN_EXEC: &str = "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'";

pub(crate) fn python_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, PYTHON_STDIN_EXEC)
}

/// The same read WITHOUT the checks of `command`: only the engine and `exec` on the container's whole
/// id (64 hex digits, checked here before it goes into the command). It is for a target whose checks
/// passed a few seconds ago (see `read_amortising_checks`): a container that was replaced has another
/// id, and `exec` on the old one fails closed.
pub(crate) fn python_command_unchecked(target: &RuntimeTarget) -> Result<String, &'static str> {
    if !valid_target(target) || !hex(&target.container_id, 64) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        "set -eu\nJHT_CID='{cid}'\n{engine}\n{operation}",
        cid = target.container_id,
        engine = engine_selection(70),
        operation = PYTHON_STDIN_EXEC
    ))
}

pub(crate) fn delivery_command(
    target: &RuntimeTarget,
    session: &str,
) -> Result<String, &'static str> {
    if !chat_session_ok(session) {
        return Err("invalid_agent");
    }
    command(
        target,
        &format!(
            "\"$JHT_ENGINE\" exec -i \"$JHT_CID\" sh -c 'msg=$(cat); exec jht-tmux-send {session} \"$msg\"'"
        ),
    )
}

pub(crate) fn snapshot_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "\"$JHT_ENGINE\" exec \"$JHT_CID\" node -e 'const fs=require(\"fs\"); let c={}; try{c=JSON.parse(fs.readFileSync(\"/jht_home/jht.config.json\",\"utf8\"))}catch{}; const p=String(c.active_provider||\"\").toLowerCase(); const marker={claude:\"/jht_home/.claude/.credentials.json\",anthropic:\"/jht_home/.claude/.credentials.json\",codex:\"/jht_home/.codex/auth.json\",openai:\"/jht_home/.codex/auth.json\",kimi:\"/jht_home/.kimi/credentials/kimi-code.json\",moonshot:\"/jht_home/.kimi/credentials/kimi-code.json\"}[p]; const ok=[\"claude\",\"anthropic\",\"codex\",\"openai\",\"kimi\",\"moonshot\"].includes(p); console.log(\"runtimeInstalled=1\\ncontainerRunning=1\\nproviderConfigured=\"+(ok?\"1\":\"0\")+\"\\nproviderAuthenticated=\"+(marker&&fs.existsSync(marker)?\"1\":\"0\")+\"\\nprofileReady=\"+(fs.existsSync(\"/jht_home/profile/ready.flag\")?\"1\":\"0\")+\"\\nassistantWelcomed=\"+(fs.existsSync(\"/jht_home/profile/welcomed.flag\")?\"1\":\"0\"));'")
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}
