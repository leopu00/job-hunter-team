//! Behavioural tests of the in-app registration of an existing team. Nothing
//! here reaches a network or a VPS: a scripted runner records EVERY command it
//! is given and answers like the server would; the clock is a counter the
//! runner advances; the account data lives in a private temporary directory.

use crate::{
    account_scope::AccountScope,
    existing_team_register::{
        choice_failure, classify, discover_choosing, discover_with, parse_details, parse_discovery, receipt_clear, receipt_for, receipt_store,
        register_hooked, register_outcome, register_with, settle_register, Budget,
        ExistingTeamRegisterRequest, Found, Receipt, Registered, CHOICE_GONE, DETAILS_SCRIPT, DISCOVERY_SCRIPT,
        SELECTION_MISMATCH,
    },
    existing_team_runtime::{self as runtime, CandidateWrite, RuntimeTarget},
    onboarding::{existing_team_readonly_connect_with, existing_team_reopen_with, OnboardingNativeState, SNAPSHOT_TIMEOUT},
    runtime_host::{ExecutionHost, ProcessResult, ValidatedHost},
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

const TEAM: &str = "synthetic-team-id-0001";
const OTHER_TEAM_PROBE_EXIT: i32 = 72;
static SANDBOXES: AtomicUsize = AtomicUsize::new(0);

// ---------------------------------------------------------------- fixtures

fn hexs(tag: u8, seed: u8) -> String {
    format!("{tag:02x}{seed:02x}").repeat(16)
}

fn container_id(n: u8) -> String {
    hexs(0xc0, n)
}

fn image_id(n: u8) -> String {
    format!("sha256:{}", hexs(0x1a, n))
}

fn descriptor(n: u8) -> String {
    format!("sha256:{}", hexs(0xde, n))
}

fn ghcr(n: u8) -> String {
    format!("ghcr.io/leopu00/jht@sha256:{}", hexs(0x9d, n))
}

fn revision(n: u8) -> String {
    format!("{:02x}", 0x70 + n).repeat(20)
}

#[derive(Clone)]
struct Image {
    id: String,
    readable: bool,
    os_arch: String,
    revision: Option<String>,
    digests: Vec<String>,
}

#[derive(Clone)]
struct Cont {
    id: String,
    image: String,
    running: bool,
    descriptor: Option<String>,
}

#[derive(Clone, Default)]
struct World {
    images: Vec<Image>,
    conts: Vec<Cont>,
}

impl World {
    /// A container of the fixed repository, with everything `command()` checks.
    fn jht(mut self, n: u8) -> Self {
        self.images.push(Image {
            id: image_id(n),
            readable: true,
            os_arch: "linux/amd64".into(),
            revision: Some(revision(n)),
            digests: vec![ghcr(n)],
        });
        self.conts.push(Cont {
            id: container_id(n),
            image: image_id(n),
            running: true,
            descriptor: Some(descriptor(n)),
        });
        self
    }

    /// A container of someone else's image (the default `jht` name included).
    fn other(mut self, n: u8, digests: &[&str]) -> Self {
        self.images.push(Image {
            id: image_id(n),
            readable: true,
            os_arch: "linux/amd64".into(),
            revision: None,
            digests: digests.iter().map(|d| (*d).to_owned()).collect(),
        });
        self.conts.push(Cont {
            id: container_id(n),
            image: image_id(n),
            running: true,
            descriptor: None,
        });
        self
    }

    fn with_digests(mut self, n: u8, digests: Vec<String>) -> Self {
        for image in &mut self.images {
            if image.id == image_id(n) {
                image.digests = digests.clone();
            }
        }
        self
    }

    fn edit_image(mut self, n: u8, edit: impl Fn(&mut Image)) -> Self {
        for image in &mut self.images {
            if image.id == image_id(n) {
                edit(image);
            }
        }
        self
    }

    fn edit_cont(mut self, n: u8, edit: impl Fn(&mut Cont)) -> Self {
        for cont in &mut self.conts {
            if cont.id == container_id(n) {
                edit(cont);
            }
        }
        self
    }

    fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for cont in &self.conts {
            out.push(format!("P|{}|{}|{}", cont.id, cont.image, cont.running));
        }
        let mut seen = Vec::new();
        for cont in &self.conts {
            if seen.contains(&cont.image) {
                continue;
            }
            seen.push(cont.image.clone());
            let image = self.images.iter().find(|i| i.id == cont.image).expect("image");
            if image.readable {
                let digests = if image.digests.is_empty() {
                    "-".to_owned()
                } else {
                    format!("{},", image.digests.join(","))
                };
                out.push(format!(
                    "I|{}|{}|{}|{}",
                    image.id,
                    image.os_arch,
                    image.revision.clone().unwrap_or_else(|| "-".into()),
                    digests
                ));
            } else {
                out.push(format!("I|{}|-|-|-", image.id));
            }
        }
        let mut described = 0;
        for cont in &self.conts {
            let image = self.images.iter().find(|i| i.id == cont.image).expect("image");
            if image.readable && image.digests.iter().any(|d| d.starts_with("ghcr.io/leopu00/jht@sha256:")) {
                out.push(format!("D|{}|{}", cont.id, cont.descriptor.clone().unwrap_or_else(|| "-".into())));
                described += 1;
            }
        }
        let distinct = seen.len();
        out.push(format!("END|{}|{}|{}", self.conts.len(), distinct, described));
        out
    }

    fn reply(&self) -> ProcessResult {
        text(&self.lines())
    }
}

fn text(lines: &[String]) -> ProcessResult {
    ProcessResult { code: 0, stdout: format!("{}\n", lines.join("\n")).into_bytes() }
}

fn probe_ok(captain: bool, assistant: bool) -> ProcessResult {
    ProcessResult {
        code: 0,
        stdout: format!(
            "runtimeInstalled=1\ncontainerRunning=1\nproviderConfigured=1\nproviderAuthenticated=1\nprofileReady=1\nassistantWelcomed=0\ncaptainRunning={}\nassistantRunning={}\n",
            u8::from(captain),
            u8::from(assistant)
        )
        .into_bytes(),
    }
}

fn exit(code: i32) -> ProcessResult {
    ProcessResult { code, stdout: Vec::new() }
}

fn clone_result(result: &ProcessResult) -> ProcessResult {
    ProcessResult { code: result.code, stdout: result.stdout.clone() }
}

#[derive(Clone, Debug)]
struct Call {
    command: String,
    input: Option<Vec<u8>>,
    timeout: Duration,
}

/// The server: answers the discovery script and the probe of each container.
struct Server {
    calls: RefCell<Vec<Call>>,
    clock: Cell<Duration>,
    discovery: RefCell<Result<ProcessResult, &'static str>>,
    probes: RefCell<HashMap<String, Result<ProcessResult, &'static str>>>,
    /// What the details script answers; by default what a VPS without it would (exit 71).
    details: RefCell<Result<ProcessResult, &'static str>>,
    discovery_cost: Duration,
    probe_cost: Duration,
}

impl Server {
    fn new(world: &World) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            clock: Cell::new(Duration::ZERO),
            discovery: RefCell::new(Ok(world.reply())),
            probes: RefCell::new(HashMap::new()),
            details: RefCell::new(Ok(exit(71))),
            discovery_cost: Duration::from_millis(300),
            probe_cost: Duration::from_millis(300),
        }
    }

    fn probe(self, n: u8, result: ProcessResult) -> Self {
        self.probes.borrow_mut().insert(container_id(n), Ok(result));
        self
    }

    fn answer(&self, command: &str, input: Option<&[u8]>, timeout: Duration) -> Result<ProcessResult, &'static str> {
        self.calls.borrow_mut().push(Call {
            command: command.to_owned(),
            input: input.map(<[u8]>::to_vec),
            timeout,
        });
        if command == DISCOVERY_SCRIPT {
            self.clock.set(self.clock.get() + self.discovery_cost);
            return match &*self.discovery.borrow() {
                Ok(result) => Ok(clone_result(result)),
                Err(error) => Err(*error),
            };
        }
        self.clock.set(self.clock.get() + self.probe_cost);
        if command == DETAILS_SCRIPT {
            return match &*self.details.borrow() {
                Ok(result) => Ok(clone_result(result)),
                Err(error) => Err(*error),
            };
        }
        let id = command
            .split("JHT_CID='")
            .nth(1)
            .map(|rest| rest[..64].to_owned())
            .unwrap_or_default();
        match self.probes.borrow().get(&id) {
            Some(Ok(result)) => Ok(clone_result(result)),
            Some(Err(error)) => Err(*error),
            None => Ok(exit(OTHER_TEAM_PROBE_EXIT)),
        }
    }

    fn commands(&self) -> Vec<String> {
        self.calls.borrow().iter().map(|call| call.command.clone()).collect()
    }

    fn count(&self) -> usize {
        self.calls.borrow().len()
    }
}

struct Sandbox {
    root: PathBuf,
    scope: AccountScope,
}

impl Sandbox {
    fn new() -> Self {
        let n = SANDBOXES.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("jht-f6-{}-{n}", std::process::id()));
        let scope = AccountScope::synthetic_local(format!("f6-test-{n}").as_bytes());
        let sandbox = Self { root, scope };
        sandbox.make_private_dir(&sandbox.account());
        sandbox
    }

    fn make_private_dir(&self, path: &Path) {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new().recursive(true).mode(0o700).create(path).expect("dir");
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("mode");
    }

    fn account(&self) -> PathBuf {
        self.root.join("accounts").join(self.scope.digest())
    }

    fn candidate(&self) -> PathBuf {
        self.account().join("existing-team-runtime-candidate.json")
    }

    fn selection(&self) -> PathBuf {
        self.account().join("existing-team-runtime-selection.json")
    }

    fn other_scope(&self) -> (AccountScope, PathBuf) {
        let scope = AccountScope::synthetic_local(b"f6-other-scope");
        let dir = self.root.join("accounts").join(scope.digest());
        self.make_private_dir(&dir);
        fs::write(dir.join("existing-team-runtime-candidate.json"), b"someone else's bytes").expect("other");
        (scope, dir)
    }

    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.account())
            .expect("account dir")
            .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn host() -> ExecutionHost {
    ExecutionHost::Vps {
        address: "203.0.113.7".into(),
        user: "jht".into(),
        port: 22,
        key_path: "/tmp/synthetic-key".into(),
    }
}

fn validated(sandbox: &Sandbox) -> ValidatedHost {
    ValidatedHost::Vps {
        address: "203.0.113.7".into(),
        user: "jht".into(),
        port: 22,
        key_path: PathBuf::from("/tmp/synthetic-key"),
        known_hosts: sandbox.account().join("pin"),
    }
}

fn write_pin(sandbox: &Sandbox) {
    use std::os::unix::fs::PermissionsExt;
    let path = sandbox.account().join("pin");
    fs::write(&path, "[203.0.113.7]:22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f\n").expect("pin");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("mode");
}

fn budget_of<'a>(total: Duration, clock: &'a dyn Fn() -> Duration) -> Budget<'a> {
    Budget { total, elapsed: clock }
}

fn discover(sandbox: &Sandbox, server: &Server, total: Duration) -> Result<Found, &'static str> {
    let clock = || server.clock.get();
    discover_with(
        &sandbox.root,
        &sandbox.scope,
        &host(),
        TEAM,
        &mut || Ok(validated(sandbox)),
        &mut |_, command, input, timeout| server.answer(command, input, timeout),
        &budget_of(total, &clock),
    )
}

fn receipt_of(sandbox: &Sandbox, found: &Found) -> Receipt {
    Receipt {
        scope_digest: sandbox.scope.digest().to_owned(),
        host: host(),
        team_id: TEAM.to_owned(),
        candidate_sha256: found.candidate_sha256.clone(),
        replaces_sha256: found.replaces.as_ref().map(|base| base.candidate_sha256.clone()),
        chosen: None,
        at: Instant::now(),
    }
}

fn register(sandbox: &Sandbox, server: &Server, receipt: &Receipt) -> Result<Registered, &'static str> {
    let clock = || server.clock.get();
    register_with(
        &sandbox.root,
        &sandbox.scope,
        receipt,
        &mut || Ok(validated(sandbox)),
        &mut |_, command, input, timeout| server.answer(command, input, timeout),
        &budget_of(Duration::from_secs(60), &clock),
    )
}

/// The team's container is container 1; the rest is noise a real VPS has.
fn team_world() -> World {
    World::default()
        .jht(1)
        .jht(2)
        .other(3, &["docker.io/library/redis@sha256:aaaa"])
        .other(4, &[])
}

fn team_server(world: &World) -> Server {
    Server::new(world).probe(1, probe_ok(true, false))
}

fn target_of(world: &World, n: u8) -> RuntimeTarget {
    let cont = world.conts.iter().find(|c| c.id == container_id(n)).expect("container");
    RuntimeTarget {
        container_id: cont.id.clone(),
        image_id: cont.image.clone(),
        platform_image_id: cont.descriptor.clone().expect("descriptor"),
        oci_revision: revision(n),
        digest: format!("sha256:{}", hexs(0x9d, n)),
        os: "linux".into(),
        architecture: "amd64".into(),
    }
}

// ------------------------------------------------------------------- tests

#[test]
fn t0_baseline_a_new_scope_with_a_pin_cannot_reach_a_selection_today() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let server = Server::new(&World::default());
    let persisted = Cell::new(0);
    let result = existing_team_readonly_connect_with(
        &sandbox.root,
        &sandbox.scope,
        &host(),
        TEAM,
        &mut || Ok(validated(&sandbox)),
        &mut || {
            persisted.set(persisted.get() + 1);
            Ok(())
        },
        &mut |_, command, input, timeout| server.answer(command, input, timeout),
    );
    assert_eq!(result.expect_err("no candidate").code, "existing_team_runtime_candidate_required");
    assert_eq!(server.count(), 0, "refused before any SSH call");
    assert_eq!(persisted.get(), 0);
    assert_eq!(
        runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).err(),
        Some("existing_team_runtime_selection_required")
    );
}

#[test]
fn t1_the_whole_cycle_of_a_new_profile_reaches_a_selection_and_a_read() {
    for assistant in [false, true] {
        let sandbox = Sandbox::new();
        write_pin(&sandbox);
        let world = team_world();
        let server = Server::new(&world).probe(1, probe_ok(true, assistant));
        let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("discovered");
        assert_eq!(found.readiness, assistant);
        assert_eq!(found.runtime, target_of(&world, 1));
        assert!(found.fingerprint.as_deref().is_some_and(|f| f.starts_with("SHA256:")));
        assert!(!sandbox.candidate().exists(), "discover writes nothing");
        assert_eq!(sandbox.entries(), vec!["pin".to_owned()]);

        let receipt = receipt_of(&sandbox, &found);
        assert_eq!(register(&sandbox, &server, &receipt), Ok(Registered::New(CandidateWrite::Written)));
        let bytes = fs::read(sandbox.candidate()).expect("candidate");
        assert_eq!(runtime::sha256(&bytes), found.candidate_sha256);
        assert_eq!(bytes, found.candidate);
        runtime::parse_candidate_bytes(&bytes).expect("read back by the rules of every read");
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(sandbox.candidate()).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(sandbox.entries(), vec!["existing-team-runtime-candidate.json".to_owned(), "pin".to_owned()]);

        // the existing read-only connection, unchanged, now goes all the way
        let persisted = Cell::new(0);
        let connected = existing_team_readonly_connect_with(
            &sandbox.root,
            &sandbox.scope,
            &host(),
            TEAM,
            &mut || Ok(validated(&sandbox)),
            &mut || {
                persisted.set(persisted.get() + 1);
                Ok(())
            },
            &mut |_, command, input, timeout| server.answer(command, input, timeout),
        )
        .expect("connected");
        assert_eq!(connected.readiness, assistant);
        assert_eq!(persisted.get(), 1);
        let selected = runtime::selected_at(&sandbox.root, &sandbox.scope, &host())
            .expect("selection")
            .expect("some");
        assert_eq!(selected.runtime, found.runtime);
        // the view is named by its connection: this account scope and this candidate (host, team, container)
        assert_eq!(connected.connection_key.as_deref(), Some(runtime::connection_key(&sandbox.scope, &selected).as_str()));
        // a read goes through the pinned python command of the selected target
        let read = runtime::python_command(&selected.runtime).expect("read command");
        assert!(read.contains("exit 70") && read.contains(&found.runtime.container_id));

        // T2: nothing but the discovery, the team probe of a validated target, nothing that starts or sends
        let allowed: Vec<String> = [1u8, 2]
            .iter()
            .map(|n| runtime::team_probe_command(&target_of(&world, *n)).expect("probe"))
            .collect();
        for command in server.commands() {
            assert!(command == DISCOVERY_SCRIPT || allowed.contains(&command), "unexpected command: {command}");
            assert!(!command.contains("start-agent") && !command.contains("jht-tmux-send"));
        }
    }
}

#[test]
fn t1_a_team_with_its_agents_off_is_found_and_registers_nothing_by_itself() {
    // T124: the identity is enough; the sessions are reported, never required.
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = Server::new(&world).probe(1, probe_ok(false, false));
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found with its agents off");
    assert!(!found.readiness);
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()], "a discovery writes nothing");
}

#[test]
fn t2_every_command_is_the_discovery_or_the_probe_of_a_validated_target() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = team_server(&world);
    discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let allowed: Vec<String> = [1u8, 2]
        .iter()
        .map(|n| runtime::team_probe_command(&target_of(&world, *n)).expect("probe"))
        .collect();
    let commands = server.commands();
    assert_eq!(commands.len(), 3, "one listing and one probe per validated container");
    assert_eq!(commands[0], DISCOVERY_SCRIPT);
    for command in &commands[1..] {
        assert!(allowed.contains(command));
        assert_eq!(command.matches("\"$JHT_ENGINE\" exec").count(), 3, "the fixed probe script, nothing else");
    }
    // containers that are not the team's repository are never entered
    for command in &commands {
        assert!(!command.contains(&container_id(3)) && !command.contains(&container_id(4)));
    }
    // the discovery script itself is read-only and holds no variable part
    for verb in [" start ", " stop ", " restart ", " run ", " rm ", " kill ", " cp ", " pull ", " exec ", "tmux", " create "] {
        assert!(!DISCOVERY_SCRIPT.contains(verb), "{verb}");
    }
    assert!(!DISCOVERY_SCRIPT.contains(TEAM));
}

#[test]
fn t3_choosing_the_container_is_unambiguous_or_refused() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let go = |_world: World, server: Server| {
        let result = discover(&sandbox, &server, Duration::from_secs(40));
        (result, server)
    };
    // two containers of the team: ambiguous, even if only one has the captain
    let world = World::default().jht(1).jht(2);
    let server = Server::new(&world).probe(1, probe_ok(true, false)).probe(2, probe_ok(false, false));
    assert_eq!(go(world, server).0.expect_err("ambiguous"), "existing_team_ambiguous");
    // no JHT container at all, and the default-named one is a foreign image never entered
    let world = World::default().other(1, &["docker.io/library/jht@sha256:aaaa"]).other(2, &[]);
    let (result, server) = go(world.clone(), Server::new(&world));
    assert_eq!(result.expect_err("none"), "existing_team_container_not_found");
    assert_eq!(server.count(), 1);
    // JHT containers of other teams only
    let world = World::default().jht(1).jht(2);
    let (result, _) = go(world.clone(), Server::new(&world));
    assert_eq!(result.expect_err("not ours"), "existing_team_not_found");
    // mixed: one other team (72), one ours: success
    let world = World::default().jht(1).jht(2).jht(3);
    let (result, _) = go(world.clone(), Server::new(&world).probe(2, probe_ok(true, true)));
    assert_eq!(result.expect("ours").runtime.container_id, container_id(2));
    // a probe that fails with the pin exit (70) stops everything
    let world = World::default().jht(1).jht(2);
    let server = Server::new(&world).probe(1, exit(70)).probe(2, probe_ok(true, false));
    let (result, server) = go(world, server);
    assert_eq!(result.expect_err("70"), "existing_team_unavailable");
    assert_eq!(server.count(), 2, "stopped at the failing probe");
    // identity passes with no captain: found all the same (T124)
    let world = World::default().jht(1);
    let (result, _) = go(world.clone(), Server::new(&world).probe(1, probe_ok(false, false)));
    assert_eq!(result.expect("found with its agents off").runtime.container_id, container_id(1));
    // four JHT containers are examined, a fifth is refused without entering any
    let mut world = World::default();
    for n in 1..=4 {
        world = world.jht(n);
    }
    let (result, server) = go(world.clone(), Server::new(&world).probe(4, probe_ok(true, false)));
    assert_eq!(result.expect("fourth").runtime.container_id, container_id(4));
    assert_eq!(server.count(), 5);
    let world = world.jht(5);
    let (result, server) = go(world.clone(), Server::new(&world).probe(5, probe_ok(true, false)));
    assert_eq!(result.expect_err("five"), "existing_team_ambiguous");
    assert_eq!(server.count(), 1, "no exec for a fifth");
}

#[test]
fn t4_the_filter_is_the_exact_repository_with_one_valid_digest() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let d = hexs(0x9d, 1);
    let lookalikes = [
        format!("ghcr.io/leopu00/jht-x@sha256:{d}"),
        format!("ghcr.io/leopu00/jht/sub@sha256:{d}"),
        format!("xghcr.io/leopu00/jht@sha256:{d}"),
        format!("GHCR.IO/leopu00/jht@sha256:{d}"),
        format!("ghcr.io/leopu00/jht:tag@sha256:{d}"),
        format!("docker.io/ghcr.io/leopu00/jht@sha256:{d}"),
    ];
    for entry in lookalikes {
        let world = team_world().with_digests(1, vec![entry.clone()]);
        let server = team_server(&world);
        let found = discover(&sandbox, &server, Duration::from_secs(40));
        assert_ne!(found.as_ref().map(|f| f.runtime.container_id.clone()).ok(), Some(container_id(1)), "{entry}");
    }
    // a prefix with a malformed digest is an unusable JHT image, never a match
    for entry in [format!("ghcr.io/leopu00/jht@sha256:{}", d.to_uppercase()), "ghcr.io/leopu00/jht@sha256:abc".to_owned()] {
        let world = World::default().jht(1).with_digests(1, vec![entry]);
        let server = Server::new(&world).probe(1, probe_ok(true, false));
        assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("unusable"), "existing_team_unavailable");
        assert_eq!(server.count(), 1);
    }
    // two different valid digests on one image: not attested
    let world = team_world().with_digests(1, vec![ghcr(1), ghcr(9)]);
    let server = team_server(&world);
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("two"), "existing_team_image_unattested");
    assert_eq!(server.count(), 1);
    // one valid and a stranger, the stranger first: fine, and the digest is the ghcr one
    let world = team_world().with_digests(1, vec!["docker.io/library/x@sha256:ff".into(), ghcr(1)]);
    let found = discover(&sandbox, &team_server(&world), Duration::from_secs(40)).expect("one valid");
    assert_eq!(found.runtime.digest, format!("sha256:{}", hexs(0x9d, 1)));
    // the same digest listed twice is still one
    let world = team_world().with_digests(1, vec![ghcr(1), ghcr(1)]);
    assert!(discover(&sandbox, &team_server(&world), Duration::from_secs(40)).is_ok());
}

#[test]
fn t5_a_partial_or_inconsistent_listing_is_never_read_as_complete() {
    let world = team_world();
    let good = world.lines();
    assert!(parse_discovery(&text(&good)).is_ok());
    // cut after K records, for every K: no END, refused
    for k in 0..good.len() - 1 {
        assert_eq!(parse_discovery(&text(&good[..k])), Err("existing_team_unavailable"), "K={k}");
    }
    // the last newline missing is a cut line
    let mut cut = text(&good);
    cut.stdout.pop();
    assert_eq!(parse_discovery(&cut), Err("existing_team_unavailable"));
    // the shell exited non-zero (even with every record present)
    let mut failed = text(&good);
    failed.code = 71;
    assert_eq!(parse_discovery(&failed), Err("existing_team_unavailable"));
    // counts that disagree with the records
    for (a, b, c) in [(5, 4, 2), (4, 5, 2), (4, 4, 3), (3, 4, 2), (4, 4, 0)] {
        let altered: Vec<String> = good.iter().map(|l| if l.starts_with("END") { format!("END|{a}|{b}|{c}") } else { l.clone() }).collect();
        assert_eq!(parse_discovery(&text(&altered)), Err("existing_team_unavailable"), "{a} {b} {c}");
    }
    // a container, an image or a descriptor missing, duplicated or foreign
    let without = |prefix: &str| -> Vec<String> { good.iter().filter(|l| !l.starts_with(prefix)).cloned().collect() };
    let first = |prefix: &str| good.iter().find(|l| l.starts_with(prefix)).cloned().expect("line");
    let mut cases: Vec<Vec<String>> = Vec::new();
    let mut c = good.clone();
    c.remove(0);
    cases.push(c); // P missing but END says 4
    let mut c = good.clone();
    c.insert(1, first("P|"));
    cases.push(c); // P duplicated
    let mut c = good.clone();
    c.insert(c.len() - 1, first("I|"));
    cases.push(c); // I duplicated
    let mut c = good.clone();
    c.insert(c.len() - 1, format!("I|{}|linux/amd64|-|-", image_id(99)));
    cases.push(c); // I for an image no container uses
    let mut c = good.clone();
    c.insert(c.len() - 1, first("D|"));
    cases.push(c); // D duplicated
    let mut c = good.clone();
    c.insert(c.len() - 1, format!("D|{}|{}", container_id(3), descriptor(3)));
    cases.push(c); // D for a container with no ghcr image
    let mut c = without("D|");
    for line in &mut c {
        if line.starts_with("END") {
            *line = "END|4|4|0".into();
        }
    }
    cases.push(c); // D missing for ghcr containers
    for case in cases {
        let inconsistent = parse_discovery(&text(&case)).is_err();
        assert!(inconsistent, "{case:?}");
    }
    // records out of order
    let mut c = good.clone();
    c.swap(0, 4);
    assert!(parse_discovery(&text(&c)).is_err());
    // something after END
    let mut c = good.clone();
    c.push("P|x".into());
    assert!(parse_discovery(&text(&c)).is_err());
}

#[test]
fn t5_the_caps_hold_at_the_edge_and_one_past_it() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    // 32 containers: 31 foreign + the team's. 33: refused by the server's own marker
    let mut world = World::default();
    for n in 1..=31 {
        world = world.other(n, &["docker.io/library/redis@sha256:aaaa"]);
    }
    let world32 = world.clone().jht(32);
    let server = Server::new(&world32).probe(32, probe_ok(true, false));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect("32").runtime.container_id, container_id(32));
    assert_eq!(server.count(), 2, "only the JHT container was entered");
    let overflow = ProcessResult { code: 0, stdout: b"OVERFLOW|33\n".to_vec() };
    assert_eq!(parse_discovery(&overflow), Err("existing_team_too_many_containers"));
    for bad in ["OVERFLOW|32\n", "OVERFLOW|x\n", "OVERFLOW|33\nEND|0|0|0\n", "OVERFLOW|\n"] {
        let reply = ProcessResult { code: 0, stdout: bad.as_bytes().to_vec() };
        assert_eq!(parse_discovery(&reply), Err("existing_team_unavailable"), "{bad}");
    }
    // a 33rd record is never accepted even if the script were lying
    let world33 = world32.clone().other(33, &[]);
    assert_eq!(parse_discovery(&world33.reply()), Err("existing_team_unavailable"));
    // zero containers: END|0|0|0 is complete and means "not found"
    let empty = World::default();
    assert_eq!(empty.lines(), vec!["END|0|0|0".to_owned()]);
    assert_eq!(discover(&sandbox, &Server::new(&empty), Duration::from_secs(40)).expect_err("empty"), "existing_team_container_not_found");
    // lines, line length and reply bytes: N accepted, N+1 refused
    let huge = ProcessResult { code: 0, stdout: vec![b'P'; 65537] };
    assert_eq!(parse_discovery(&huge), Err("existing_team_unavailable"));
    let many: Vec<String> = (0..101).map(|_| "X".to_owned()).collect();
    assert_eq!(parse_discovery(&text(&many)), Err("existing_team_unavailable"));
    let wide = vec![format!("P|{}", "a".repeat(2049))];
    assert_eq!(parse_discovery(&text(&wide)), Err("existing_team_unavailable"));
}

#[test]
fn t6_a_hostile_listing_is_refused_whole_and_never_reaches_the_runner() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let base = team_world();
    let good = base.lines();
    let index = |prefix: &str| good.iter().position(|l| l.starts_with(prefix)).expect("line");
    let mut hostile: Vec<(&str, Vec<String>)> = Vec::new();
    for bad_id in ["a;b".to_owned(), format!("$(touch /x){}", "a".repeat(50)), "A".repeat(64), "a".repeat(63), "".to_owned()] {
        let mut c = good.clone();
        c[0] = format!("P|{bad_id}|{}|true", image_id(1));
        hostile.push(("id", c));
    }
    let mut c = good.clone();
    c[0] = format!("P|{}|{}|true|extra", container_id(1), image_id(1));
    hostile.push(("extra field", c));
    let mut c = good.clone();
    c[0] = format!("P|{}|{}", container_id(1), image_id(1));
    hostile.push(("missing field", c));
    let mut c = good.clone();
    c[0] = format!("P|{}|{}|maybe", container_id(1), image_id(1));
    hostile.push(("running", c));
    let mut c = good.clone();
    c[0] = format!("P|{}|sha256:{}|true", container_id(1), "zz");
    hostile.push(("image", c));
    let at = index("I|");
    for (label, line) in [
        ("pipe in the revision", format!("I|{}|linux/amd64|{}|extra|{},", image_id(1), revision(1), ghcr(1))),
        ("empty revision", format!("I|{}|linux/amd64||{},", image_id(1), ghcr(1))),
        ("empty digests", format!("I|{}|linux/amd64|{}|", image_id(1), revision(1))),
        ("digest with a space", format!("I|{}|linux/amd64|{}|a b,", image_id(1), revision(1))),
        ("digest without the trailing comma", format!("I|{}|linux/amd64|{}|{}", image_id(1), revision(1), ghcr(1))),
        ("empty os/arch", format!("I|{}||{}|{},", image_id(1), revision(1), ghcr(1))),
    ] {
        let mut c = good.clone();
        c[at] = line;
        hostile.push((label, c));
    }
    let at = index("D|");
    for (label, line) in [("descriptor", format!("D|{}|sha256:xyz", container_id(1))), ("descriptor id", "D|nothex|-".to_owned())] {
        let mut c = good.clone();
        c[at] = line;
        hostile.push((label, c));
    }
    for (label, lines) in hostile {
        assert!(parse_discovery(&text(&lines)).is_err(), "{label}: {lines:?}");
    }
    let mut utf8 = text(&good);
    utf8.stdout.splice(0..0, [0xff, 0xfe]);
    assert_eq!(parse_discovery(&utf8), Err("existing_team_unavailable"));
    // and through discover: refused, and only the one listing call was made
    let mut lines = good.clone();
    lines[0] = format!("P|{};id|{}|true", container_id(1), image_id(1));
    let server = Server::new(&base);
    *server.discovery.borrow_mut() = Ok(text(&lines));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("hostile"), "existing_team_unavailable");
    assert_eq!(server.count(), 1);
}

#[test]
fn t7_pins_the_local_file_gates_the_network_and_a_changed_remote_key_stops_at_the_handshake() {
    let sandbox = Sandbox::new();
    let world = team_world();
    let server = team_server(&world);
    // (a) local pin absent or unreadable: nothing is called
    for code in ["host_key_missing", "host_key_mismatch"] {
        let clock = || server.clock.get();
        let result = discover_with(
            &sandbox.root,
            &sandbox.scope,
            &host(),
            TEAM,
            &mut || Err(code),
            &mut |_, command, input, timeout| server.answer(command, input, timeout),
            &budget_of(Duration::from_secs(40), &clock),
        );
        assert_eq!(result.expect_err("no pin"), code);
    }
    assert_eq!(server.count(), 0);
    // (b) the remote key changed: ssh itself fails at the handshake (exit 255)
    write_pin(&sandbox);
    let server = team_server(&world);
    *server.discovery.borrow_mut() = Ok(exit(255));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("handshake"), "existing_team_unavailable");
    assert_eq!(server.count(), 1, "one attempt, no authentication, no remote command after it");
    assert_eq!(server.commands(), vec![DISCOVERY_SCRIPT.to_owned()]);
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()], "nothing written locally");
    // a runner that cannot even start ssh
    let server = team_server(&world);
    *server.discovery.borrow_mut() = Err("ssh_unavailable");
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("no ssh"), "existing_team_unavailable");
    // (c) the SSH arguments come only from ssh_base_args: strict, batch, the scope's own known_hosts
    let args = crate::runtime_host::ssh_base_args(&validated(&sandbox)).expect("args");
    let joined: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
    for needed in ["StrictHostKeyChecking=yes", "BatchMode=yes", "GlobalKnownHostsFile=/dev/null"] {
        assert!(joined.iter().any(|a| a == needed), "{needed}");
    }
    assert!(joined.iter().any(|a| a.starts_with("UserKnownHostsFile=") && a.contains(sandbox.scope.digest())));
    let source = include_str!("existing_team_register.rs").split("#[cfg(test)]").next().unwrap();
    for forbidden in ["accept-new", "StrictHostKeyChecking=no", "UpdateHostKeys", "onboarding_ssh_host_key", "scan_host_key", "ssh-keyscan"] {
        assert!(!source.lines().filter(|l| !l.trim_start().starts_with("//")).any(|l| l.contains(forbidden)), "{forbidden}");
    }
}

#[test]
fn t8_the_total_duration_is_an_absolute_deadline() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = World::default().jht(1).jht(2);
    // the listing takes 38 s of a 40 s budget: no probe is started with less than 2 s left
    let mut server = Server::new(&world).probe(1, probe_ok(true, false));
    server.discovery_cost = Duration::from_millis(38_500);
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("late"), "existing_team_discovery_timeout");
    assert_eq!(server.count(), 1);
    // no call gets more than the residual, the listing 20 s, a probe 12 s
    let mut server = Server::new(&world).probe(1, probe_ok(true, false));
    server.discovery_cost = Duration::from_secs(25);
    server.probe_cost = Duration::from_secs(5);
    let result = discover(&sandbox, &server, Duration::from_secs(40));
    let calls = server.calls.borrow();
    assert_eq!(calls[0].timeout, Duration::from_secs(20));
    assert_eq!(calls[1].timeout, Duration::from_secs(12));
    assert_eq!(calls[2].timeout, Duration::from_secs(10), "the residual of 40 - 25 - 5");
    assert!(calls.iter().all(|call| call.timeout >= Duration::from_secs(2)));
    drop(calls);
    assert!(result.is_ok());
    // the time can run out right after the last probe: then nothing is written
    let mut server = Server::new(&World::default().jht(1)).probe(1, probe_ok(true, false));
    server.probe_cost = Duration::from_secs(40);
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("spent"), "existing_team_discovery_timeout");
    // register's rediscovery counts inside its own 60 s
    let world = team_world();
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let receipt = receipt_of(&sandbox, &found);
    let mut slow = team_server(&world);
    slow.discovery_cost = Duration::from_secs(59);
    assert_eq!(register(&sandbox, &slow, &receipt), Err("existing_team_discovery_timeout"));
    assert!(!sandbox.candidate().exists());
}

#[test]
fn t9_the_team_id_travels_only_on_stdin_of_the_probe() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = team_server(&world);
    discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    for call in server.calls.borrow().iter() {
        assert!(!call.command.contains(TEAM), "never in a command");
        if call.command == DISCOVERY_SCRIPT {
            assert!(call.input.is_none());
        } else {
            assert_eq!(call.input.as_deref(), Some(format!("{TEAM}\n").as_bytes()));
        }
    }
}

#[test]
fn t10_a_scope_that_already_has_a_candidate_or_a_selection_is_refused_before_any_call() {
    use std::os::unix::fs::symlink;
    let make: [(&str, Box<dyn Fn(&Sandbox)>, &str); 6] = [
        ("valid", Box::new(|s| fs::write(s.candidate(), b"{}").unwrap()), "existing_team_runtime_candidate_exists"),
        ("empty", Box::new(|s| fs::write(s.candidate(), b"").unwrap()), "existing_team_runtime_candidate_exists"),
        ("dangling symlink", Box::new(|s| symlink("/nonexistent/synthetic", s.candidate()).unwrap()), "existing_team_runtime_candidate_exists"),
        ("directory", Box::new(|s| fs::create_dir(s.candidate()).unwrap()), "existing_team_runtime_candidate_exists"),
        ("selection file", Box::new(|s| fs::write(s.selection(), b"{}").unwrap()), "existing_team_runtime_already_selected"),
        ("selection symlink", Box::new(|s| symlink("/nonexistent/synthetic", s.selection()).unwrap()), "existing_team_runtime_already_selected"),
    ];
    for (label, create, expected) in make {
        let sandbox = Sandbox::new();
        write_pin(&sandbox);
        create(&sandbox);
        let before = sandbox.entries();
        let server = team_server(&team_world());
        assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err(label), expected, "{label}");
        assert_eq!(server.count(), 0, "{label}: no SSH");
        assert_eq!(sandbox.entries(), before, "{label}: nothing written");
    }
    // entry refusals
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let server = team_server(&team_world());
    let clock = || server.clock.get();
    let local = discover_with(
        &sandbox.root, &sandbox.scope, &ExecutionHost::Local, TEAM,
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(40), &clock),
    );
    assert_eq!(local.expect_err("local"), "existing_team_vps_required");
    let bad_team = discover_with(
        &sandbox.root, &sandbox.scope, &host(), "short",
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(40), &clock),
    );
    assert_eq!(bad_team.expect_err("team"), "invalid_team_id");
    assert_eq!(server.count(), 0);
    // the request is closed: the renderer sends a hash and a confirmation, nothing else
    assert!(serde_json::from_str::<ExistingTeamRegisterRequest>(&format!(r#"{{"candidateSha256":"{}","confirmed":true}}"#, "a".repeat(64))).is_ok());
    for bad in [
        r#"{"confirmed":true}"#.to_owned(),
        format!(r#"{{"candidateSha256":"{}"}}"#, "a".repeat(64)),
        format!(r#"{{"candidateSha256":"{}","confirmed":true,"host":{{}}}}"#, "a".repeat(64)),
        format!(r#"{{"candidateSha256":"{}","confirmed":true,"teamId":"x"}}"#, "a".repeat(64)),
        format!(r#"{{"candidateSha256":"{}","confirmed":"yes"}}"#, "a".repeat(64)),
    ] {
        assert!(serde_json::from_str::<ExistingTeamRegisterRequest>(&bad).is_err(), "{bad}");
    }
}

#[test]
fn t10_the_receipt_in_memory_is_the_only_authority_for_register() {
    let sandbox = Sandbox::new();
    let slot: Mutex<Option<Receipt>> = Mutex::new(None);
    let sha = "a".repeat(64);
    let receipt = |at: Instant, scope: &AccountScope, sha: &str| Receipt {
        scope_digest: scope.digest().to_owned(),
        host: host(),
        team_id: TEAM.to_owned(),
        candidate_sha256: sha.to_owned(),
        replaces_sha256: None,
        chosen: None,
        at,
    };
    let now = Instant::now();
    assert_eq!(receipt_for(&slot, &sandbox.scope, &sha, now).expect_err("empty"), "existing_team_receipt_required");
    receipt_store(&slot, receipt(now, &sandbox.scope, &sha));
    assert!(receipt_for(&slot, &sandbox.scope, &sha, now).is_ok());
    assert_eq!(receipt_for(&slot, &sandbox.scope, &"b".repeat(64), now).expect_err("other hash"), "existing_team_receipt_required");
    let other = AccountScope::synthetic_local(b"another-account");
    assert_eq!(receipt_for(&slot, &other, &sha, now).expect_err("other scope"), "account_scope_changed");
    // a second discovery replaces the first
    receipt_store(&slot, receipt(now, &sandbox.scope, &"c".repeat(64)));
    assert_eq!(receipt_for(&slot, &sandbox.scope, &sha, now).expect_err("replaced"), "existing_team_receipt_required");
    assert!(receipt_for(&slot, &sandbox.scope, &"c".repeat(64), now).is_ok());
    // expired after ten minutes, and the slot is emptied
    let later = now + Duration::from_secs(10 * 60 + 1);
    assert_eq!(receipt_for(&slot, &sandbox.scope, &"c".repeat(64), later).expect_err("expired"), "existing_team_receipt_required");
    assert!(slot.lock().unwrap().is_none());
    receipt_store(&slot, receipt(now, &sandbox.scope, &sha));
    receipt_clear(&slot);
    assert!(slot.lock().unwrap().is_none());
}

#[test]
fn t11_a_register_that_rediscovers_a_different_target_writes_nothing() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let receipt = receipt_of(&sandbox, &found);
    // the container is replaced between the discovery and the register
    let changed = World::default().jht(7).jht(2);
    let after = Server::new(&changed).probe(7, probe_ok(true, false));
    assert_eq!(register(&sandbox, &after, &receipt), Err("existing_team_target_changed"));
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()]);
}

#[test]
fn t11_two_registrations_of_the_same_bytes_leave_one_file_and_different_bytes_a_conflict() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let found = discover(&sandbox, &team_server(&world), Duration::from_secs(40)).expect("found");
    let identical = Cell::new(false);
    // the other registration publishes the very same bytes inside the window
    let result = runtime::write_candidate_hooked(&sandbox.root, &sandbox.scope, &found.candidate, &mut || {
        use std::os::unix::fs::PermissionsExt;
        fs::write(sandbox.candidate(), &found.candidate).unwrap();
        fs::set_permissions(sandbox.candidate(), fs::Permissions::from_mode(0o600)).unwrap();
        identical.set(true);
    });
    assert_eq!(result, Ok(CandidateWrite::Identical));
    assert_eq!(sandbox.entries(), vec!["existing-team-runtime-candidate.json".to_owned(), "pin".to_owned()]);

    // a custodian (or another team's registration) wins with different valid bytes
    use std::os::unix::fs::PermissionsExt;
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let (other_bytes, _) = runtime::candidate_bytes(&host(), "another-synthetic-team-9", &target_of(&world, 2)).expect("other");
    let before = RefCell::new(Vec::new());
    let result = runtime::write_candidate_hooked(&sandbox.root, &sandbox.scope, &found.candidate, &mut || {
        use std::os::unix::fs::PermissionsExt;
        fs::write(sandbox.candidate(), &other_bytes).unwrap();
        fs::set_permissions(sandbox.candidate(), fs::Permissions::from_mode(0o640)).unwrap();
        let meta = fs::metadata(sandbox.candidate()).unwrap();
        before.borrow_mut().push((meta.permissions().mode(), meta.modified().unwrap()));
    });
    assert_eq!(result, Err("existing_team_runtime_candidate_conflict"));
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), other_bytes, "the other file is intact");
    let meta = fs::metadata(sandbox.candidate()).unwrap();
    assert_eq!(before.borrow()[0], (meta.permissions().mode(), meta.modified().unwrap()));
    assert_eq!(sandbox.entries(), vec!["existing-team-runtime-candidate.json".to_owned(), "pin".to_owned()], "no temporary left");
    // an unreadable definitive file that appears is a conflict, never "identical"
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let result = runtime::write_candidate_hooked(&sandbox.root, &sandbox.scope, &found.candidate, &mut || {
        fs::write(sandbox.candidate(), &found.candidate).unwrap(); // mode left at the default 0644: not private
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(sandbox.candidate(), fs::Permissions::from_mode(0o644)).unwrap();
    });
    assert_eq!(result, Err("existing_team_runtime_candidate_conflict"));
}

#[test]
fn t12_the_filesystem_is_checked_before_and_nothing_else_is_created_or_touched() {
    use std::os::unix::fs::PermissionsExt;
    let world = team_world();
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let found = discover(&sandbox, &team_server(&world), Duration::from_secs(40)).expect("found");

    // invalid bytes: no definitive file, no temporary
    let mut broken = found.candidate.clone();
    broken.truncate(broken.len() / 2);
    assert_eq!(runtime::write_candidate_at(&sandbox.root, &sandbox.scope, &broken), Err("existing_team_runtime_candidate_invalid"));
    assert_eq!(runtime::write_candidate_at(&sandbox.root, &sandbox.scope, br#"{"schema":2}"#), Err("existing_team_runtime_candidate_invalid"));
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()]);

    // an account directory the others can write to is refused, and nothing is created in it
    fs::set_permissions(sandbox.account(), fs::Permissions::from_mode(0o770)).unwrap();
    assert_eq!(runtime::write_candidate_at(&sandbox.root, &sandbox.scope, &found.candidate), Err("existing_team_runtime_unavailable"));
    fs::set_permissions(sandbox.account(), fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()]);

    // a missing account directory is never created
    let ghost = AccountScope::synthetic_local(b"f6-ghost");
    assert_eq!(runtime::write_candidate_at(&sandbox.root, &ghost, &found.candidate), Err("existing_team_runtime_unavailable"));
    assert!(!sandbox.root.join("accounts").join(ghost.digest()).exists());

    // a refused discovery leaves other scopes exactly as they were
    let (other, other_dir) = sandbox.other_scope();
    let snapshot = |dir: &Path| -> Vec<(String, Vec<u8>, u32)> {
        let mut rows: Vec<_> = fs::read_dir(dir).unwrap().map(|e| {
            let e = e.unwrap();
            let meta = e.metadata().unwrap();
            (e.file_name().to_string_lossy().into_owned(), fs::read(e.path()).unwrap_or_default(), meta.permissions().mode())
        }).collect();
        rows.sort();
        rows
    };
    let before = snapshot(&other_dir);
    let receipt = receipt_of(&sandbox, &found);
    assert_eq!(register(&sandbox, &team_server(&world), &receipt), Ok(Registered::New(CandidateWrite::Written)));
    assert_eq!(snapshot(&other_dir), before);
    assert!(runtime::registration_gate_at(&sandbox.root, &other).is_err(), "the other scope has its own candidate and keeps it");
    // register on top of its own result: the existing path owns the scope now
    assert_eq!(
        register(&sandbox, &team_server(&world), &receipt),
        Err("existing_team_runtime_candidate_exists")
    );
}

#[test]
fn t12_the_definitive_file_is_never_made_by_rename() {
    let source = include_str!("existing_team_runtime.rs");
    let writer = source
        .split("pub(crate) fn write_candidate_hooked(")
        .nth(1)
        .and_then(|rest| rest.split("/// Called only after the exact host/team identity").next())
        .expect("the writer");
    assert!(writer.contains("fs::hard_link("));
    assert!(!writer.contains("fs::rename("), "rename would overwrite");
    assert!(!writer.contains("create_dir"), "register never creates a directory");
    let hook = writer.find("before_link()").expect("hook");
    let link = writer.find("fs::hard_link(").expect("link");
    let validate = writer.rfind("parse_candidate_bytes(&staged)").expect("validation of the staged file");
    assert!(validate < hook && hook < link, "validated before it becomes definitive");
}

#[test]
fn t13_classification_ignores_what_command_could_never_pin() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    // a JHT image whose descriptor cannot be read is unusable, not the reason for "not found"
    let world = World::default().jht(1).edit_cont(1, |c| c.descriptor = None);
    let server = Server::new(&world).probe(1, probe_ok(true, false));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("unusable"), "existing_team_unavailable");
    assert_eq!(server.count(), 1);
    // an unreadable image of a foreign container does not hide the team's own
    let world = World::default().jht(1).other(2, &[]).edit_image(2, |i| i.readable = false);
    let found = discover(&sandbox, &Server::new(&world).probe(1, probe_ok(true, false)), Duration::from_secs(40)).expect("found");
    assert_eq!(found.runtime.container_id, container_id(1));
    // revision missing, wrong os, descriptor equal to the image id: all unusable
    for edit in [
        (|i: &mut Image| i.revision = None) as fn(&mut Image),
        |i: &mut Image| i.os_arch = "windows/amd64".into(),
        |i: &mut Image| i.os_arch = "linux/riscv64".into(),
    ] {
        let world = World::default().jht(1).edit_image(1, edit);
        let result = discover(&sandbox, &Server::new(&world).probe(1, probe_ok(true, false)), Duration::from_secs(40));
        assert_eq!(result.expect_err("unusable"), "existing_team_unavailable");
    }
    let world = World::default().jht(1).edit_cont(1, |c| c.descriptor = Some(image_id(1)));
    let result = discover(&sandbox, &Server::new(&world).probe(1, probe_ok(true, false)), Duration::from_secs(40));
    assert_eq!(result.expect_err("unusable"), "existing_team_unavailable");
    // the classification itself, on a parsed listing
    let parsed = parse_discovery(&team_world().reply()).expect("parsed");
    let classified = classify(&parsed).expect("classified");
    assert_eq!(classified.targets.len(), 2);
    assert_eq!(classified.unusable, 0);
}

// -------- the real script, run by a real shell against a stub `docker`

#[cfg(unix)]
mod script_in_a_shell {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    struct Stub {
        dir: PathBuf,
    }

    impl Stub {
        fn new(world: &World) -> Self {
            let n = SANDBOXES.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("jht-f6-stub-{}-{n}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            let docker = dir.join("docker");
            fs::write(
                &docker,
                r#"#!/bin/sh
D="$STUB_DIR"
case "$1" in
  ps) cat "$D/ps.txt" ;;
  inspect)
    case "$5" in
      *ImageManifestDescriptor*) cat "$D/c-$6.desc" ;;
      *) cat "$D/c-$6.row" ;;
    esac ;;
  image) img="$5"; cat "$D/i-${img#sha256:}.info" ;;
  *) exit 99 ;;
esac
"#,
            )
            .unwrap();
            fs::set_permissions(&docker, fs::Permissions::from_mode(0o755)).unwrap();
            let stub = Self { dir };
            let ids: Vec<String> = world.conts.iter().map(|c| c.id.clone()).collect();
            fs::write(stub.dir.join("ps.txt"), ids.join("\n")).unwrap();
            for cont in &world.conts {
                fs::write(stub.dir.join(format!("c-{}.row", cont.id)), format!("{}|{}", cont.image, cont.running)).unwrap();
                if let Some(descriptor) = &cont.descriptor {
                    fs::write(stub.dir.join(format!("c-{}.desc", cont.id)), descriptor).unwrap();
                }
            }
            for image in &world.images {
                if image.readable {
                    let digests: String = image.digests.iter().map(|d| format!("{d},")).collect();
                    fs::write(
                        stub.dir.join(format!("i-{}.info", image.id.trim_start_matches("sha256:"))),
                        format!("{}|{}|{}|{}", image.id, image.os_arch, image.revision.clone().unwrap_or_default(), digests),
                    )
                    .unwrap();
                }
            }
            stub
        }

        fn run(&self) -> ProcessResult {
            let output = Command::new("/bin/sh")
                .arg("-c")
                .arg(DISCOVERY_SCRIPT)
                .env("PATH", format!("{}:/usr/bin:/bin", self.dir.display()))
                .env("STUB_DIR", &self.dir)
                .output()
                .expect("a shell");
            ProcessResult { code: output.status.code().unwrap_or(-1), stdout: output.stdout }
        }
    }

    impl Drop for Stub {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn the_script_prints_what_the_parser_expects_and_classifies_like_the_fixtures() {
        let world = team_world();
        let reply = Stub::new(&world).run();
        assert_eq!(reply.code, 0, "{}", String::from_utf8_lossy(&reply.stdout));
        let parsed = parse_discovery(&reply).expect("the real output parses");
        let classified = classify(&parsed).expect("classified");
        let ids: Vec<&str> = classified.targets.iter().map(|t| t.container_id.as_str()).collect();
        assert_eq!(ids, vec![container_id(1), container_id(2)]);
        assert_eq!(classified.targets[0], target_of(&world, 1));
        // the same listing the fixtures render
        assert_eq!(String::from_utf8_lossy(&reply.stdout).lines().filter(|l| l.starts_with("P|")).count(), 4);
    }

    /// The details script against a fake engine: `rows` maps a container id to what
    /// `inspect --format` prints for it (none: the inspect fails).
    fn run_details(engine: &str, rows: &[(String, Option<&str>)], stdin: &str) -> (ProcessResult, String) {
        let n = SANDBOXES.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jht-t123-stub-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // The script looks the engine up on PATH. A real `docker` on the machine (a CI runner and the test boxes have one) would win over
        // the podman stub, so PATH holds only the stub and the two tools that run: grep (the script) and cat (the stub).
        for tool in ["grep", "cat"] {
            let real = [format!("/usr/bin/{tool}"), format!("/bin/{tool}")].into_iter().find(|p| std::path::Path::new(p).exists()).expect("a system tool");
            std::os::unix::fs::symlink(real, dir.join(tool)).unwrap();
        }
        let stub = dir.join(engine);
        fs::write(
            &stub,
            r#"#!/bin/sh
D="$STUB_DIR"
case "$1" in
  --version) echo "$0 version 1" ;;
  inspect) printf '%s\n' "$5" > "$D/format"; [ -f "$D/c-$6" ] || exit 1; cat "$D/c-$6" ;;
  *) exit 99 ;;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&stub, fs::Permissions::from_mode(0o755)).unwrap();
        for (id, row) in rows {
            if let Some(row) = row {
                fs::write(dir.join(format!("c-{id}")), row).unwrap();
            }
        }
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg(DETAILS_SCRIPT)
            .env("PATH", dir.display().to_string())
            .env("STUB_DIR", &dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("a shell");
        use std::io::Write as _;
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        let format = fs::read_to_string(dir.join("format")).unwrap_or_default();
        let _ = fs::remove_dir_all(&dir);
        (ProcessResult { code: output.status.code().unwrap_or(-1), stdout: output.stdout }, format)
    }

    #[test]
    fn t123_the_details_script_prints_what_parse_details_reads_and_marks_what_it_cannot() {
        let (one, two, three) = (container_id(1), container_id(2), container_id(3));
        let rows = [
            (one.clone(), Some("/jht|2026-10-20T08:00:00.123456789Z")),
            (two.clone(), Some("/jht old|2026-10-20T08:00:00Z")),
            (three.clone(), None),
        ];
        let (reply, format) = run_details("docker", &rows, &format!("{one}\n{two}\n{three}\n"));
        assert_eq!(reply.code, 0);
        assert_eq!(
            String::from_utf8_lossy(&reply.stdout),
            format!("C|{one}|jht|2026-10-20T08:00:00.123456789Z\nC|{two}|-|2026-10-20T08:00:00Z\nC|{three}|-|-\nEND|3\n")
        );
        assert_eq!(format.trim_end(), "{{.Name}}|{{.State.StartedAt}}");
        let details = parse_details(&reply, &[one.as_str(), two.as_str(), three.as_str()]);
        assert_eq!(details[&one], (Some("jht".to_owned()), Some("2026-10-20T08:00:00.123456789Z".to_owned())));
        assert_eq!(details[&two], (None, Some("2026-10-20T08:00:00Z".to_owned())));
        assert_eq!(details[&three], (None, None));
        // a name that tries to add fields, and a start time that is not one, are marked, never passed on
        let rows = [(one.clone(), Some("/a|b|c\nC|x"))];
        let (reply, _) = run_details("docker", &rows, &format!("{one}\n"));
        assert_eq!(String::from_utf8_lossy(&reply.stdout), format!("C|{one}|a|-\nEND|1\n"));
        // Podman: its own format, the same record
        let rows = [(one.clone(), Some("jht|2026-10-20T08:00:00+02:00"))];
        let (reply, format) = run_details("podman", &rows, &format!("{one}\n"));
        assert_eq!(String::from_utf8_lossy(&reply.stdout), format!("C|{one}|jht|2026-10-20T08:00:00+02:00\nEND|1\n"));
        assert!(format.contains(".State.StartedAt.Format"), "{format}");
        // more than four ids, or one that is not an id: no END, a failing exit
        let five: String = (1..=5).map(|n| format!("{}\n", container_id(n))).collect();
        for stdin in [five, format!("{one}\nnot-an-id\n"), format!("{one};id\n")] {
            let (reply, _) = run_details("docker", &rows, &stdin);
            assert_eq!(reply.code, 71, "{stdin:?}");
            assert!(!String::from_utf8_lossy(&reply.stdout).contains("END|"));
        }
    }

    #[test]
    fn no_container_is_a_complete_empty_listing() {
        let reply = Stub::new(&World::default()).run();
        assert_eq!(reply.code, 0);
        assert_eq!(String::from_utf8_lossy(&reply.stdout), "END|0|0|0\n");
        assert!(parse_discovery(&reply).is_ok());
    }

    #[test]
    fn a_failed_listing_of_a_container_leaves_no_end_and_a_failing_exit() {
        let world = team_world();
        let stub = Stub::new(&world);
        fs::remove_file(stub.dir.join(format!("c-{}.row", container_id(3)))).unwrap();
        let reply = stub.run();
        assert_eq!(reply.code, 71);
        assert!(!String::from_utf8_lossy(&reply.stdout).contains("END|"));
        assert_eq!(parse_discovery(&reply), Err("existing_team_unavailable"));
    }

    #[test]
    fn an_unreadable_image_or_descriptor_is_marked_not_dropped() {
        let world = team_world();
        let stub = Stub::new(&world);
        fs::remove_file(stub.dir.join(format!("i-{}.info", image_id(3).trim_start_matches("sha256:")))).unwrap();
        fs::remove_file(stub.dir.join(format!("c-{}.desc", container_id(2)))).unwrap();
        let reply = stub.run();
        assert_eq!(reply.code, 0);
        let text = String::from_utf8_lossy(&reply.stdout).into_owned();
        assert!(text.contains(&format!("I|{}|-|-|-", image_id(3))));
        assert!(text.contains(&format!("D|{}|-", container_id(2))));
        let parsed = parse_discovery(&reply).expect("parses");
        let classified = classify(&parsed).expect("classified");
        assert_eq!(classified.targets.len(), 1, "the container without a descriptor is unusable");
        assert_eq!(classified.unusable, 2);
    }

    #[test]
    fn more_than_thirty_two_containers_stop_at_the_marker_before_any_inspection() {
        let mut world = World::default();
        for n in 1..=33 {
            world = world.other(n, &[]);
        }
        let stub = Stub::new(&world);
        for entry in fs::read_dir(&stub.dir).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.starts_with("c-") || name.starts_with("i-") {
                fs::remove_file(stub.dir.join(name)).unwrap(); // any inspection would now fail
            }
        }
        let reply = stub.run();
        assert_eq!(reply.code, 0);
        assert_eq!(String::from_utf8_lossy(&reply.stdout), "OVERFLOW|33\n");
        assert_eq!(parse_discovery(&reply), Err("existing_team_too_many_containers"));
        // 32 exactly is fine
        let mut world = World::default();
        for n in 1..=32 {
            world = world.other(n, &[]);
        }
        let reply = Stub::new(&world).run();
        assert_eq!(reply.code, 0);
        assert!(String::from_utf8_lossy(&reply.stdout).ends_with("END|32|32|0\n"));
    }

    #[test]
    fn an_image_or_a_label_that_would_break_the_record_is_marked_unreadable() {
        let world = World::default().jht(1);
        let stub = Stub::new(&world);
        let info = stub.dir.join(format!("i-{}.info", image_id(1).trim_start_matches("sha256:")));
        // a pipe in the revision label shifts the fields: the whole image is marked unreadable
        fs::write(&info, format!("{}|linux/amd64|ab|cd|{},", image_id(1), ghcr(1))).unwrap();
        let text = String::from_utf8_lossy(&stub.run().stdout).into_owned();
        assert!(text.contains(&format!("I|{}|-|-|-", image_id(1))), "{text}");
        // a revision that is not 40 hex becomes "-", the rest stays readable
        fs::write(&info, format!("{}|linux/amd64|not-hex|{},", image_id(1), ghcr(1))).unwrap();
        let text = String::from_utf8_lossy(&stub.run().stdout).into_owned();
        assert!(text.contains(&format!("I|{}|linux/amd64|-|{},", image_id(1), ghcr(1))), "{text}");
    }
}

#[test]
fn the_reply_cap_and_the_probe_cap_are_the_declared_ones() {
    assert_eq!(SNAPSHOT_TIMEOUT, Duration::from_secs(25), "the existing read-only connection keeps its own timeout");
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = World::default().jht(1);
    let server = Server::new(&world);
    // a probe that answers with more than 4 KiB is refused, not parsed
    let flood = ProcessResult { code: 0, stdout: vec![b'x'; 5000] };
    server.probes.borrow_mut().insert(container_id(1), Ok(flood));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("flood"), "existing_team_unavailable");
}

#[test]
fn t11_the_commands_share_one_gate_and_teardown_empties_the_receipt() {
    let state = OnboardingNativeState::default();
    assert!(state.try_begin());
    assert!(!state.try_begin(), "a second operation is refused while one runs");
    state.finish();
    assert!(state.try_begin());
    state.finish();
    let sandbox = Sandbox::new();
    receipt_store(
        &state.receipt,
        Receipt {
            scope_digest: sandbox.scope.digest().to_owned(),
            host: host(),
            team_id: TEAM.to_owned(),
            candidate_sha256: "a".repeat(64),
            replaces_sha256: None,
            chosen: None,
            at: Instant::now(),
        },
    );
    crate::onboarding::teardown(&state);
    assert!(state.receipt.lock().unwrap().is_none(), "a scope change forgets the receipt");
}

#[test]
fn t12_a_candidate_larger_than_every_read_accepts_is_refused_before_it_is_published() {
    let world = team_world();
    let huge = ExecutionHost::Vps {
        address: "a".repeat(9000),
        user: "jht".into(),
        port: 22,
        key_path: "/tmp/synthetic-key".into(),
    };
    assert_eq!(
        runtime::candidate_bytes(&huge, TEAM, &target_of(&world, 1)).err(),
        Some("existing_team_runtime_candidate_invalid")
    );
    assert!(runtime::candidate_bytes(&host(), TEAM, &target_of(&world, 1)).is_ok());
}

// ---- reopening a saved team after a restart

/// A profile that connected once: pin, candidate and selection, the assistant down.
fn connected_once(sandbox: &Sandbox) -> (World, Server) {
    write_pin(sandbox);
    let world = team_world();
    let server = Server::new(&world).probe(1, probe_ok(true, false));
    let found = discover(sandbox, &server, Duration::from_secs(40)).expect("found");
    register(sandbox, &server, &receipt_of(sandbox, &found)).expect("registered");
    existing_team_readonly_connect_with(
        &sandbox.root, &sandbox.scope, &host(), TEAM,
        &mut || Ok(validated(sandbox)), &mut || Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    )
    .expect("connected");
    assert!(sandbox.selection().exists());
    let fresh = Server::new(&world).probe(1, probe_ok(true, false));
    (world, fresh)
}

fn reopen(sandbox: &Sandbox, server: &Server, persisted: &Cell<u32>) -> Result<crate::onboarding::ExistingTeamReadiness, crate::onboarding::OnboardingError> {
    existing_team_reopen_with(
        &sandbox.root, &sandbox.scope,
        &mut |_| Ok(validated(sandbox)),
        &mut |_| {
            persisted.set(persisted.get() + 1);
            Ok(())
        },
        &mut |_, c, i, t| server.answer(c, i, t),
    )
}

#[test]
fn t27_opening_the_team_read_only_takes_the_full_connection_away_and_so_does_reopening_it() {
    let _serial = runtime::FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).expect("selected").expect("a target");
    let server = team_server(&world);

    // «Conferma e collega» succeeded on this team: the chat and the controls may write to it
    runtime::grant_full_link(&sandbox.scope, &target);
    assert!(runtime::full_link_granted(&sandbox.scope, &target));
    // the same team opened read-only has the very same connection key: the grant goes
    existing_team_readonly_connect_with(
        &sandbox.root, &sandbox.scope, &host(), TEAM,
        &mut || Ok(validated(&sandbox)), &mut || Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    )
    .expect("opened read only");
    assert!(!runtime::full_link_granted(&sandbox.scope, &target), "the read-only view cannot write");

    // and so does a restart's reopening
    runtime::grant_full_link(&sandbox.scope, &target);
    let again = team_server(&world);
    reopen(&sandbox, &again, &Cell::new(0)).expect("reopened");
    assert!(!runtime::full_link_granted(&sandbox.scope, &target), "nor can a reopened one");
}

#[test]
fn t15_a_saved_team_with_the_assistant_down_reopens_read_only_and_starts_nothing() {
    let sandbox = Sandbox::new();
    let (world, server) = connected_once(&sandbox);
    let candidate_before = fs::read(sandbox.candidate()).unwrap();
    let selection_before = fs::read(sandbox.selection()).unwrap();
    let persisted = Cell::new(0);
    let readiness = reopen(&sandbox, &server, &persisted).expect("reopened");
    assert!(!readiness.readiness, "the assistant is down and that is only reported");
    // the reopened view is named by the saved connection, as the first opening was
    let saved = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    assert_eq!(readiness.connection_key, Some(runtime::connection_key(&sandbox.scope, &saved)));
    assert_eq!(persisted.get(), 1);
    // the pin and the identity are checked again, by the one probe of the saved target, and nothing else runs
    assert_eq!(server.commands(), vec![runtime::team_probe_command(&target_of(&world, 1)).unwrap()]);
    for command in server.commands() {
        assert!(!command.contains("start-agent") && !command.contains("jht-tmux-send") && !command.contains(" docker start"));
    }
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), candidate_before, "the candidate is not touched");
    assert_eq!(fs::read(sandbox.selection()).unwrap(), selection_before, "the selection is not touched");
}

#[test]
fn t15_with_nothing_saved_it_refuses_before_any_call_and_creates_nothing() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let server = Server::new(&team_world());
    let persisted = Cell::new(0);
    assert_eq!(reopen(&sandbox, &server, &persisted).expect_err("nothing").code, "existing_team_runtime_candidate_required");
    assert_eq!(server.count(), 0);
    assert_eq!(persisted.get(), 0);
    assert_eq!(sandbox.entries(), vec!["pin".to_owned()]);
}

#[test]
fn t15_a_half_saved_connection_is_incomplete_not_absent_and_is_never_completed() {
    use std::os::unix::fs::symlink;
    let persisted = Cell::new(0);
    // a candidate with no selection: a restart does not activate it
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    register(&sandbox, &server, &receipt_of(&sandbox, &found)).expect("registered");
    let fresh = team_server(&world);
    assert_eq!(reopen(&sandbox, &fresh, &persisted).expect_err("no selection").code, "existing_team_saved_incomplete");
    assert_eq!(fresh.count(), 0);
    assert!(!sandbox.selection().exists(), "no selection is created by reopening");
    // a selection with no candidate
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    fs::remove_file(sandbox.candidate()).unwrap();
    let fresh = team_server(&world);
    assert_eq!(reopen(&sandbox, &fresh, &persisted).expect_err("no candidate").code, "existing_team_saved_incomplete");
    assert_eq!(fresh.count(), 0);
    assert!(!sandbox.candidate().exists(), "no candidate is invented");
    // a dangling symlink counts as present, so it is not "nothing saved"
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    symlink("/nonexistent/synthetic", sandbox.selection()).unwrap();
    let fresh = Server::new(&world);
    assert_eq!(reopen(&sandbox, &fresh, &persisted).expect_err("dangling").code, "existing_team_saved_incomplete");
    assert_eq!(fresh.count(), 0);
    assert_eq!(persisted.get(), 0);
}

#[test]
fn t15_a_replaced_team_or_a_missing_pin_is_an_error_not_a_start() {
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    // another team answers on the saved container
    let server = Server::new(&world).probe(1, exit(72));
    let persisted = Cell::new(0);
    assert_eq!(reopen(&sandbox, &server, &persisted).expect_err("identity").code, "existing_team_identity_mismatch");
    assert_eq!(persisted.get(), 0);
    // the VPS was updated: its container is not the pinned one any more (the shell's pin check, exit 70).
    // It is said as that, never as «not reachable», and nothing saved is touched or replaced.
    let candidate_before = fs::read(sandbox.candidate()).unwrap();
    let selection_before = fs::read(sandbox.selection()).unwrap();
    let updated = Server::new(&world).probe(1, exit(70));
    assert_eq!(reopen(&sandbox, &updated, &persisted).expect_err("updated").code, "existing_team_runtime_changed");
    assert_eq!(persisted.get(), 0);
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), candidate_before, "the saved candidate is never replaced");
    assert_eq!(fs::read(sandbox.selection()).unwrap(), selection_before, "the saved selection is never replaced");
    // a link that fails for any other reason is still «not reachable»
    let down = Server::new(&world).probe(1, exit(1));
    assert_eq!(reopen(&sandbox, &down, &persisted).expect_err("down").code, "existing_team_unavailable");
    // the pin is gone
    let server = Server::new(&world).probe(1, probe_ok(true, false));
    let result = existing_team_reopen_with(
        &sandbox.root, &sandbox.scope,
        &mut |_| Err("host_key_missing"), &mut |_| Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    );
    assert_eq!(result.expect_err("pin").code, "host_key_missing");
    assert_eq!(server.count(), 0);
}

// ------------------------------------------- a selection without its candidate

/// A profile that connected once and then lost its candidate (taken away from
/// outside): the saved selection, its bytes and the candidate bytes it attests.
fn selection_without_candidate(sandbox: &Sandbox) -> (World, Vec<u8>, Vec<u8>) {
    let (world, _) = connected_once(sandbox);
    let candidate = fs::read(sandbox.candidate()).unwrap();
    let selection = fs::read(sandbox.selection()).unwrap();
    fs::remove_file(sandbox.candidate()).unwrap();
    (world, candidate, selection)
}

fn file_state(path: &Path) -> (Vec<u8>, u32, std::time::SystemTime) {
    use std::os::unix::fs::PermissionsExt;
    let meta = fs::symlink_metadata(path).unwrap();
    (fs::read(path).unwrap(), meta.permissions().mode(), meta.modified().unwrap())
}

fn write_private(path: &Path, bytes: &[u8]) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, bytes).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}

#[test]
fn t16_a_selection_without_candidate_gets_back_the_candidate_it_attests_and_opens_read_only() {
    let sandbox = Sandbox::new();
    let (world, candidate_before, _) = selection_without_candidate(&sandbox);
    let selection_before = file_state(&sandbox.selection());
    let server = team_server(&world);

    // what the dialog does first: the usual read-only connection, refused before any SSH call
    let refused = existing_team_readonly_connect_with(
        &sandbox.root, &sandbox.scope, &host(), TEAM,
        &mut || Ok(validated(&sandbox)), &mut || Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    );
    assert_eq!(refused.expect_err("no candidate").code, "existing_team_runtime_candidate_required");
    assert_eq!(server.count(), 0);

    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("discovered");
    assert!(found.restores);
    assert_eq!(found.candidate, candidate_before, "the very bytes the selection was made from");
    assert!(!sandbox.candidate().exists(), "discover writes nothing");

    assert_eq!(register(&sandbox, &server, &receipt_of(&sandbox, &found)), Ok(Registered::Restored));
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), candidate_before);
    assert_eq!(file_state(&sandbox.selection()), selection_before, "the selection is never written");
    assert_eq!(
        runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).expect("selected").map(|t| t.runtime),
        Some(target_of(&world, 1))
    );

    // the read-only connection of always takes it from here, and a restart reopens it
    let persisted = Cell::new(0);
    existing_team_readonly_connect_with(
        &sandbox.root, &sandbox.scope, &host(), TEAM,
        &mut || Ok(validated(&sandbox)),
        &mut || {
            persisted.set(persisted.get() + 1);
            Ok(())
        },
        &mut |_, c, i, t| server.answer(c, i, t),
    )
    .expect("connected read only");
    reopen(&sandbox, &team_server(&world), &persisted).expect("reopened");
    assert_eq!(persisted.get(), 2);
    assert_eq!(file_state(&sandbox.selection()), selection_before);
    for command in server.commands() {
        assert!(!command.contains("start-agent") && !command.contains("jht-tmux-send"));
    }
}

#[test]
fn t16_another_team_or_host_than_the_saved_one_is_refused_locally_before_the_pin_and_any_call() {
    let sandbox = Sandbox::new();
    let (world, _, _) = selection_without_candidate(&sandbox);
    let before = sandbox.entries();
    let selection_before = file_state(&sandbox.selection());
    let other_key = ExecutionHost::Vps {
        address: "203.0.113.7".into(),
        user: "jht".into(),
        port: 22,
        key_path: "/tmp/another-synthetic-key".into(),
    };
    for (label, asked_host, asked_team) in [
        ("another team", host(), "another-synthetic-team-9"),
        ("another key path", other_key, TEAM),
        ("another user", ExecutionHost::Vps { address: "203.0.113.7".into(), user: "root".into(), port: 22, key_path: "/tmp/synthetic-key".into() }, TEAM),
    ] {
        let server = team_server(&world);
        let pins = Cell::new(0);
        let clock = || server.clock.get();
        let result = discover_with(
            &sandbox.root, &sandbox.scope, &asked_host, asked_team,
            &mut || {
                pins.set(pins.get() + 1);
                Ok(validated(&sandbox))
            },
            &mut |_, c, i, t| server.answer(c, i, t),
            &budget_of(Duration::from_secs(40), &clock),
        );
        assert_eq!(result.expect_err(label), SELECTION_MISMATCH, "{label}");
        assert_eq!(server.count(), 0, "{label}: no SSH");
        assert_eq!(pins.get(), 0, "{label}: the pin is not even read");
        assert_eq!(sandbox.entries(), before, "{label}: nothing written");
        assert_eq!(file_state(&sandbox.selection()), selection_before, "{label}");
    }
}

#[test]
fn t16_a_team_whose_container_changed_since_the_selection_is_a_mismatch_and_nothing_is_written() {
    let sandbox = Sandbox::new();
    let (world, _, _) = selection_without_candidate(&sandbox);
    let before = sandbox.entries();
    // the team now runs in another container: the discovery finds it, its bytes differ
    let changed = World::default().jht(7).jht(2);
    let server = Server::new(&changed).probe(7, probe_ok(true, false));
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("changed"), SELECTION_MISMATCH);
    assert!(server.count() > 0, "decided only after the discovery");
    assert_eq!(sandbox.entries(), before);

    // and if it changes between the discovery the person confirmed and the register
    let found = discover(&sandbox, &team_server(&world), Duration::from_secs(40)).expect("found");
    let receipt = receipt_of(&sandbox, &found);
    assert_eq!(register(&sandbox, &server, &receipt), Err(SELECTION_MISMATCH));
    assert_eq!(sandbox.entries(), before);
}

#[test]
fn t16_a_selection_that_is_not_a_valid_private_one_still_owns_the_scope_with_no_call() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let world = team_world();
    let cases: [(&str, Box<dyn Fn(&Sandbox, &[u8])>); 5] = [
        ("readable by others", Box::new(|s, bytes| {
            fs::write(s.selection(), bytes).unwrap();
            fs::set_permissions(s.selection(), fs::Permissions::from_mode(0o644)).unwrap();
        })),
        ("another schema", Box::new(|s, bytes| {
            let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            value["schema"] = serde_json::json!(2);
            write_private(&s.selection(), &serde_json::to_vec(&value).unwrap());
        })),
        ("an unknown field", Box::new(|s, bytes| {
            let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            value["extra"] = serde_json::json!(1);
            write_private(&s.selection(), &serde_json::to_vec(&value).unwrap());
        })),
        ("a symlink to a valid selection", Box::new(|s, bytes| {
            let elsewhere = s.account().join("elsewhere.json");
            write_private(&elsewhere, bytes);
            symlink(&elsewhere, s.selection()).unwrap();
        })),
        ("a directory", Box::new(|s, _| fs::create_dir(s.selection()).unwrap())),
    ];
    for (label, make) in cases {
        let sandbox = Sandbox::new();
        let (_, _, selection) = selection_without_candidate(&sandbox);
        fs::remove_file(sandbox.selection()).unwrap();
        make(&sandbox, selection.as_slice());
        let before = sandbox.entries();
        let server = team_server(&world);
        assert_eq!(
            discover(&sandbox, &server, Duration::from_secs(40)).expect_err(label),
            "existing_team_runtime_already_selected",
            "{label}"
        );
        assert_eq!(server.count(), 0, "{label}: no SSH");
        assert_eq!(sandbox.entries(), before, "{label}: nothing written");
    }
    // a coherent pair of this host and team may be rebound, so the VPS is read (the discovery and the
    // team probes, nothing else); when it runs the very same runtime the refusal is the same as ever
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let before = (fs::read(sandbox.candidate()).unwrap(), fs::read(sandbox.selection()).unwrap());
    let server = team_server(&world);
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("pair"), "existing_team_runtime_candidate_exists");
    for command in server.commands() {
        assert!(command == DISCOVERY_SCRIPT || command.contains("JHT_CID="), "unexpected command: {command}");
    }
    assert_eq!((fs::read(sandbox.candidate()).unwrap(), fs::read(sandbox.selection()).unwrap()), before);
}

#[test]
fn t16_restored_is_said_only_once_the_pair_reads_back_as_one() {
    let sandbox = Sandbox::new();
    let (world, candidate_before, selection) = selection_without_candidate(&sandbox);
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let receipt = receipt_of(&sandbox, &found);
    // in the window before the link, someone else replaces the selection with another valid one
    let attested = runtime::sha256(&candidate_before);
    let replaced = String::from_utf8(selection).unwrap().replace(&attested, &"b".repeat(64)).into_bytes();
    let clock = || server.clock.get();
    let result = register_hooked(
        &sandbox.root, &sandbox.scope, &receipt,
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(60), &clock),
        &mut || {
            fs::remove_file(sandbox.selection()).unwrap();
            write_private(&sandbox.selection(), &replaced);
        },
    );
    assert_eq!(result, Err("existing_team_runtime_target_changed"), "never «restored»");
    // the candidate written stays: nothing is ever removed
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), candidate_before);
    assert_eq!(fs::read(sandbox.selection()).unwrap(), replaced, "the other selection is not touched");
}

#[test]
fn t16_races_with_another_writer_rest_on_the_link_and_the_read_back_not_on_a_lock() {
    // the same bytes appear first: identical, and the pair reads back, so restored
    let sandbox = Sandbox::new();
    let (world, candidate_before, _) = selection_without_candidate(&sandbox);
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let clock = || server.clock.get();
    let result = register_hooked(
        &sandbox.root, &sandbox.scope, &receipt_of(&sandbox, &found),
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(60), &clock),
        &mut || write_private(&sandbox.candidate(), &candidate_before),
    );
    assert_eq!(result, Ok(Registered::Restored));

    // the same value in another layout appears first: a conflict, and that file stays as it was
    let sandbox = Sandbox::new();
    let (world, candidate_before, _) = selection_without_candidate(&sandbox);
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let value: serde_json::Value = serde_json::from_slice(&candidate_before).unwrap();
    let other_layout = serde_json::to_vec_pretty(&value).unwrap();
    let appeared = RefCell::new(None);
    let clock = || server.clock.get();
    let result = register_hooked(
        &sandbox.root, &sandbox.scope, &receipt_of(&sandbox, &found),
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(60), &clock),
        &mut || {
            write_private(&sandbox.candidate(), &other_layout);
            *appeared.borrow_mut() = Some(file_state(&sandbox.candidate()));
        },
    );
    assert_eq!(result, Err("existing_team_runtime_candidate_conflict"));
    assert_eq!(Some(file_state(&sandbox.candidate())), appeared.into_inner(), "bytes, mode and mtime intact");

    // a read-only connection in the same window writes no selection, and the one there stays
    let sandbox = Sandbox::new();
    let (world, _, _) = selection_without_candidate(&sandbox);
    let selection_before = file_state(&sandbox.selection());
    let server = team_server(&world);
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    let other = team_server(&world);
    let connected = RefCell::new(None);
    let clock = || server.clock.get();
    let result = register_hooked(
        &sandbox.root, &sandbox.scope, &receipt_of(&sandbox, &found),
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(60), &clock),
        &mut || {
            let outcome = existing_team_readonly_connect_with(
                &sandbox.root, &sandbox.scope, &host(), TEAM,
                &mut || Ok(validated(&sandbox)), &mut || Ok(()),
                &mut |_, c, i, t| other.answer(c, i, t),
            );
            *connected.borrow_mut() = Some(outcome.map(|_| ()).map_err(|e| e.code));
        },
    );
    assert_eq!(connected.into_inner(), Some(Err("existing_team_runtime_candidate_required")));
    assert_eq!(result, Ok(Registered::Restored));
    assert_eq!(file_state(&sandbox.selection()), selection_before, "no selection written by the recovery");
}

#[test]
fn t16_the_outcomes_and_the_receipt_after_a_mismatch() {
    assert_eq!(register_outcome(&Registered::New(CandidateWrite::Written)), "registered");
    assert_eq!(register_outcome(&Registered::New(CandidateWrite::Identical)), "already_registered");
    assert_eq!(register_outcome(&Registered::Restored), "restored");
    assert_eq!(register_outcome(&Registered::Rebound(CandidateWrite::Written)), "rebound");

    let receipt = || Receipt {
        scope_digest: "d".repeat(64),
        host: host(),
        team_id: TEAM.to_owned(),
        candidate_sha256: "a".repeat(64),
        replaces_sha256: None,
        chosen: None,
        at: Instant::now(),
    };
    for (label, result, clears) in [
        ("restored", Ok(Registered::Restored), true),
        ("rebound", Ok(Registered::Rebound(CandidateWrite::Written)), true),
        (SELECTION_MISMATCH, Err(SELECTION_MISMATCH), true),
        ("existing_team_target_changed", Err("existing_team_target_changed"), true),
        ("existing_team_runtime_target_changed", Err("existing_team_runtime_target_changed"), true),
        ("existing_team_discovery_timeout", Err("existing_team_discovery_timeout"), false),
    ] {
        let slot = Mutex::new(Some(receipt()));
        let reply = settle_register(&slot, result);
        assert_eq!(slot.lock().unwrap().is_none(), clears, "{label}");
        match reply {
            Ok(reply) => assert_eq!(reply.outcome, label),
            Err(error) => {
                // the code alone: no host, team or hash in what leaves the backend
                assert_eq!(
                    serde_json::to_value(&error).unwrap(),
                    serde_json::json!({ "code": label, "message": label, "retryable": label == "existing_team_discovery_timeout" || label.ends_with("target_changed") }),
                    "{label}"
                );
            }
        }
    }
    // the mismatch is not retried: the server must change first (checked above, retryable false)
}

// ---- the full connection after a read-only opening of the same team

#[test]
fn t28_the_full_connection_keeps_the_selection_a_read_only_opening_of_the_same_team_saved() {
    let sandbox = Sandbox::new();
    let (_world, _) = connected_once(&sandbox);
    let before = fs::read(sandbox.selection()).expect("the selection of the read-only opening");
    let target = runtime::candidate_for_request_at(&sandbox.root, &sandbox.scope, &host(), TEAM).expect("the candidate");
    // the plain activation of the full connection used to stop here
    assert_eq!(
        runtime::activate_at(&sandbox.root, &sandbox.scope, &host(), &target),
        Err("existing_team_runtime_already_selected")
    );
    assert_eq!(runtime::activate_or_keep_at(&sandbox.root, &sandbox.scope, &host(), &target), Ok(()));
    assert_eq!(fs::read(sandbox.selection()).expect("still there"), before, "kept as it was, not rewritten");

    // another target is never taken for the saved one
    let mut other = target.clone();
    other.runtime.oci_revision = "f".repeat(40);
    assert!(runtime::activate_or_keep_at(&sandbox.root, &sandbox.scope, &host(), &other).is_err());
    assert_eq!(fs::read(sandbox.selection()).expect("still there"), before);
}

#[test]
fn t28_with_nothing_selected_the_full_connection_saves_the_selection() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let server = team_server(&team_world());
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("found");
    register(&sandbox, &server, &receipt_of(&sandbox, &found)).expect("registered");
    assert!(!sandbox.selection().exists());
    let target = runtime::candidate_for_request_at(&sandbox.root, &sandbox.scope, &host(), TEAM).expect("the candidate");
    assert_eq!(runtime::activate_or_keep_at(&sandbox.root, &sandbox.scope, &host(), &target), Ok(()));
    assert!(runtime::selected_at(&sandbox.root, &sandbox.scope, &host()) == Ok(Some(target)), "the selection of this target");
}

#[test]
fn t28_the_full_connection_command_activates_through_the_one_that_keeps_the_same_target() {
    let onboarding = include_str!("onboarding.rs").split("mod existing_team_assistant_tests").next().unwrap();
    let body = onboarding
        .split("pub(crate) async fn onboarding_existing_team_connect(")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .expect("the full connection");
    assert!(body.contains("existing_team_runtime::activate_or_keep("));
    assert!(!body.contains("existing_team_runtime::activate("));
}

// ---- a team on rootless Podman

#[test]
fn t29_a_podman_discovery_gives_the_target_every_command_checks_again() {
    // The lines the discovery prints on Podman (tests/test_existing_team_engine_podman.py runs the
    // script itself): the image id with its `sha256:` added, the index as the image's only digest of
    // the repository, the platform manifest as the container's descriptor.
    let cid = "d9".repeat(32);
    let image = format!("sha256:{}", "f4".repeat(32));
    let index = format!("sha256:{}", "c9".repeat(32));
    let platform = format!("sha256:{}", "40".repeat(32));
    let revision = "9f".repeat(20);
    let lines = vec![
        format!("P|{cid}|{image}|true"),
        format!("I|{image}|linux/amd64|{revision}|ghcr.io/leopu00/jht@{index},"),
        format!("D|{cid}|{platform}"),
        "END|1|1|1".to_owned(),
    ];
    let parsed = parse_discovery(&text(&lines)).expect("parsed");
    let classified = classify(&parsed).expect("classified");
    assert_eq!(classified.targets.len(), 1);
    let target = &classified.targets[0];
    assert_eq!(target.container_id, cid);
    assert_eq!(target.image_id, image);
    assert_eq!(target.platform_image_id, platform);
    assert_eq!(target.digest, index);
    assert_eq!(target.oci_revision, revision);
    assert!(runtime::valid_target(target));
    // and a container whose platform manifest could not be told apart is not a target
    let lines = vec![lines[0].clone(), lines[1].clone(), format!("D|{cid}|-"), "END|1|1|1".to_owned()];
    let classified = classify(&parse_discovery(&text(&lines)).expect("parsed")).expect("classified");
    assert!(classified.targets.is_empty());
    assert_eq!(classified.unusable, 1);
}

// ----------------------------------------------------- rebind of an updated team

/// The VPS updated the team: its container is another one (5) of another image, same team, same host.
fn updated_world() -> World {
    World::default().jht(5).jht(2).other(3, &["docker.io/library/redis@sha256:aaaa"])
}

fn updated_server() -> Server {
    Server::new(&updated_world()).probe(5, probe_ok(true, false))
}

fn pair_of(sandbox: &Sandbox) -> (Vec<u8>, Vec<u8>) {
    (fs::read(sandbox.candidate()).unwrap(), fs::read(sandbox.selection()).unwrap())
}

#[test]
fn t30_an_updated_team_shows_what_it_replaces_and_replaces_nothing_until_it_is_confirmed() {
    let sandbox = Sandbox::new();
    let (old_world, _) = connected_once(&sandbox);
    let (candidate, selection) = pair_of(&sandbox);
    let server = updated_server();
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("rebind found");
    assert_eq!(found.runtime, target_of(&updated_world(), 5));
    let base = found.replaces.as_ref().expect("it says what it replaces");
    assert_eq!(base.runtime, target_of(&old_world, 1));
    assert_eq!(base.candidate_sha256, runtime::sha256(&candidate));
    assert_ne!(found.candidate_sha256, base.candidate_sha256);
    assert_eq!(pair_of(&sandbox), (candidate, selection), "discover writes and removes nothing");
}

#[test]
fn t30_the_confirmed_rebind_replaces_candidate_and_selection_together_and_the_team_opens_again() {
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let server = updated_server();
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("rebind found");
    let receipt = receipt_of(&sandbox, &found);
    assert!(receipt.replaces_sha256.is_some());
    assert_eq!(register(&sandbox, &server, &receipt), Ok(Registered::Rebound(CandidateWrite::Written)));
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), found.candidate);
    assert!(!sandbox.selection().exists(), "the selection is the connection's, written after the identity probe");
    assert_eq!(sandbox.entries(), vec!["existing-team-runtime-candidate.json".to_owned(), "pin".to_owned()]);
    // the ordinary read-only connection then selects the new candidate, as after a first link
    existing_team_readonly_connect_with(
        &sandbox.root, &sandbox.scope, &host(), TEAM,
        &mut || Ok(validated(&sandbox)), &mut || Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    )
    .expect("connected again");
    let selected = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    assert_eq!(selected.runtime, found.runtime);
}

#[test]
fn t30_a_rebind_never_applies_to_another_host_user_key_or_team() {
    let other_hosts = [
        ExecutionHost::Vps { address: "203.0.113.8".into(), user: "jht".into(), port: 22, key_path: "/tmp/synthetic-key".into() },
        ExecutionHost::Vps { address: "203.0.113.7".into(), user: "root".into(), port: 22, key_path: "/tmp/synthetic-key".into() },
        ExecutionHost::Vps { address: "203.0.113.7".into(), user: "jht".into(), port: 2222, key_path: "/tmp/synthetic-key".into() },
        ExecutionHost::Vps { address: "203.0.113.7".into(), user: "jht".into(), port: 22, key_path: "/tmp/another-key".into() },
    ];
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let before = pair_of(&sandbox);
    for other in &other_hosts {
        let server = updated_server();
        let clock = || server.clock.get();
        let refused = discover_with(
            &sandbox.root, &sandbox.scope, other, TEAM,
            &mut || Ok(validated(&sandbox)),
            &mut |_, c, i, t| server.answer(c, i, t),
            &budget_of(Duration::from_secs(40), &clock),
        );
        assert_eq!(refused.expect_err("other host"), "existing_team_runtime_candidate_exists");
        assert_eq!(server.count(), 0, "refused before any call");
    }
    let server = updated_server();
    let clock = || server.clock.get();
    let other_team = discover_with(
        &sandbox.root, &sandbox.scope, &host(), "synthetic-team-id-0002",
        &mut || Ok(validated(&sandbox)),
        &mut |_, c, i, t| server.answer(c, i, t),
        &budget_of(Duration::from_secs(40), &clock),
    );
    assert_eq!(other_team.expect_err("other team"), "existing_team_runtime_candidate_exists");
    assert_eq!(server.count(), 0);
    assert_eq!(pair_of(&sandbox), before);
}

#[test]
fn t30_a_team_that_answers_for_another_identity_is_not_a_rebind() {
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let before = pair_of(&sandbox);
    // the updated container answers as another team: nothing is found, nothing is replaced
    let server = Server::new(&updated_world());
    assert_eq!(discover(&sandbox, &server, Duration::from_secs(40)).expect_err("other team"), "existing_team_not_found");
    assert_eq!(pair_of(&sandbox), before);
}

#[test]
fn t30_the_same_runtime_is_no_rebind_and_keeps_the_refusal() {
    let sandbox = Sandbox::new();
    let (world, server) = connected_once(&sandbox);
    let before = pair_of(&sandbox);
    assert_eq!(
        discover(&sandbox, &server, Duration::from_secs(40)).expect_err("current"),
        "existing_team_runtime_candidate_exists"
    );
    let _ = world;
    assert_eq!(pair_of(&sandbox), before);
}

#[test]
fn t30_a_selection_of_other_bytes_or_a_broken_pair_is_no_rebind() {
    for label in ["selection of other bytes", "selection not valid", "selection symlink"] {
        let sandbox = Sandbox::new();
        connected_once(&sandbox);
        match label {
            "selection of other bytes" => {
                let text = String::from_utf8(fs::read(sandbox.selection()).unwrap()).unwrap();
                let hash = text.split("\"candidate_sha256\":\"").nth(1).unwrap()[..64].to_owned();
                write_private(&sandbox.selection(), text.replace(&hash, &"0".repeat(64)).as_bytes());
            }
            "selection not valid" => write_private(&sandbox.selection(), b"{}"),
            _ => {
                fs::remove_file(sandbox.selection()).unwrap();
                std::os::unix::fs::symlink("/nonexistent/synthetic", sandbox.selection()).unwrap();
            }
        }
        let server = updated_server();
        assert_eq!(
            discover(&sandbox, &server, Duration::from_secs(40)).expect_err(label),
            "existing_team_runtime_candidate_exists",
            "{label}"
        );
        assert_eq!(server.count(), 0, "{label}: refused before any call");
    }
}

#[test]
fn t30_a_register_only_replaces_exactly_what_the_person_was_shown() {
    // a receipt of a first link never replaces a saved candidate
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let before = pair_of(&sandbox);
    let server = updated_server();
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("rebind found");
    let mut first_link = receipt_of(&sandbox, &found);
    first_link.replaces_sha256 = None;
    assert_eq!(register(&sandbox, &server, &first_link), Err("existing_team_target_changed"));
    // a receipt that names another saved candidate neither
    let mut other = receipt_of(&sandbox, &found);
    other.replaces_sha256 = Some("0".repeat(64));
    assert_eq!(register(&sandbox, &server, &other), Err("existing_team_target_changed"));
    // another runtime found at register time than the one shown
    let mut shown = receipt_of(&sandbox, &found);
    shown.candidate_sha256 = "1".repeat(64);
    assert_eq!(register(&sandbox, &server, &shown), Err("existing_team_target_changed"));
    assert_eq!(pair_of(&sandbox), before, "nothing was removed or written");
}

#[test]
fn t30_the_saved_pair_changed_after_the_receipt_is_not_replaced() {
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let server = updated_server();
    let found = discover(&sandbox, &server, Duration::from_secs(40)).expect("rebind found");
    // between the receipt and the confirmation another writer replaced the saved selection's bytes
    let candidate = fs::read(sandbox.candidate()).unwrap();
    let selection = String::from_utf8(fs::read(sandbox.selection()).unwrap()).unwrap();
    let hash = selection.split("\"candidate_sha256\":\"").nth(1).unwrap()[..64].to_owned();
    write_private(&sandbox.selection(), selection.replace(&hash, &"0".repeat(64)).as_bytes());
    let result = register(&sandbox, &server, &receipt_of(&sandbox, &found));
    assert_eq!(result, Err("existing_team_runtime_candidate_exists"));
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), candidate);
    assert!(sandbox.selection().exists());
}

#[test]
fn t30_the_rebind_removes_the_selection_before_the_candidate() {
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let base = runtime::rebind_base_at(&sandbox.root, &sandbox.scope, &host(), TEAM).expect("pair");
    // the rule the clearing keeps: never a selection left without its candidate
    runtime::clear_for_rebind_at(&sandbox.root, &sandbox.scope, &host(), TEAM, &base.candidate_sha256).expect("cleared");
    assert!(!sandbox.selection().exists() && !sandbox.candidate().exists());
    // once cleared the scope is empty (a first link), and clearing twice is refused as changed
    assert_eq!(
        runtime::clear_for_rebind_at(&sandbox.root, &sandbox.scope, &host(), TEAM, &base.candidate_sha256),
        Err("existing_team_runtime_target_changed")
    );
    assert_eq!(runtime::registration_gate_at(&sandbox.root, &sandbox.scope), Ok(runtime::RegistrationGate::Fresh));
}

fn window_gate_of(name: &str) {
    let source = include_str!("existing_team_register.rs");
    let body = source.split(name).nth(1).expect(name).split("\n}\n").next().unwrap();
    let window = body.find("window_may_write(window.label())").unwrap_or_else(|| panic!("{name}: the window is checked"));
    assert!(body.contains("window_not_allowed"), "{name}");
    for later in ["scopes.active()", "state.try_begin()", "runtime::root("] {
        if let Some(at) = body.find(later) {
            assert!(window < at, "{name}: the window comes before {later}");
        }
    }
    assert!(body.find("scopes.active()").is_some(), "{name}: the scope is still read after the gate");
}

// `register` removes and writes the saved connection and `discover` is its first half: both are writes, and
// the permission file grants the commands to windows that must never write.
#[test]
fn t31_discover_refuses_every_window_but_the_apps_own_before_anything_else() {
    window_gate_of("pub(crate) async fn onboarding_existing_team_discover(");
}

#[test]
fn t31_register_refuses_every_window_but_the_apps_own_before_anything_else() {
    window_gate_of("pub(crate) async fn onboarding_existing_team_register(");
}

#[test]
fn t31_only_the_apps_own_window_is_one_that_writes() {
    assert!(crate::direct_chat::window_may_write("main"));
    for label in ["live-screen", "broker-login", "other"] {
        assert!(!crate::direct_chat::window_may_write(label), "{label}");
    }
}

// ------------------------------------------- T123: more than one container of the team

fn discover_picking(
    sandbox: &Sandbox,
    server: &Server,
    chosen: Option<&str>,
) -> (Result<Found, &'static str>, Vec<crate::existing_team_register::ContainerChoice>) {
    let clock = || server.clock.get();
    let mut choices = Vec::new();
    let result = discover_choosing(
        &sandbox.root,
        &sandbox.scope,
        &host(),
        TEAM,
        chosen,
        &mut || Ok(validated(sandbox)),
        &mut |_, command, input, timeout| server.answer(command, input, timeout),
        &budget_of(Duration::from_secs(40), &clock),
        &mut choices,
    );
    (result, choices)
}

/// Containers 1 and 2 both answer as the team; 3 is another team's, 4 someone else's image.
fn two_of_the_team() -> (World, Server) {
    let world = World::default()
        .jht(1)
        .jht(2)
        .jht(3)
        .other(4, &["docker.io/library/redis@sha256:aaaa"]);
    let server = Server::new(&world).probe(1, probe_ok(true, true)).probe(2, probe_ok(false, false));
    (world, server)
}

fn details_reply(lines: &[String]) -> ProcessResult {
    text(lines)
}

#[test]
fn t123_two_containers_of_the_team_are_listed_with_name_and_start_and_none_is_picked() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let (_, server) = two_of_the_team();
    *server.details.borrow_mut() = Ok(details_reply(&[
        format!("C|{}|jht|2026-10-20T08:00:00.123456789Z", container_id(1)),
        format!("C|{}|jht-old|2026-09-01T10:00:00+02:00", container_id(2)),
        "END|2".to_owned(),
    ]));
    let (result, choices) = discover_picking(&sandbox, &server, None);
    assert_eq!(result.expect_err("still ambiguous"), "existing_team_ambiguous");
    let ids: Vec<&str> = choices.iter().map(|c| c.container_id.as_str()).collect();
    assert_eq!(ids, [container_id(1), container_id(2)]);
    assert_eq!(choices[0].name.as_deref(), Some("jht"));
    assert_eq!(choices[0].started_at.as_deref(), Some("2026-10-20T08:00:00.123456789Z"));
    assert_eq!(choices[1].name.as_deref(), Some("jht-old"));
    assert_eq!(choices[0].oci_revision, revision(1));
    assert_eq!(choices[1].digest, format!("sha256:{}", hexs(0x9d, 2)));
    assert!(choices[0].readiness && !choices[1].readiness);
    // the details call is the fixed script, with only the team's two ids on stdin
    let calls = server.calls.borrow();
    let details: Vec<&Call> = calls.iter().filter(|c| c.command == DETAILS_SCRIPT).collect();
    assert_eq!(details.len(), 1);
    assert_eq!(
        details[0].input.as_deref(),
        Some(format!("{}\n{}\n", container_id(1), container_id(2)).as_bytes())
    );
    assert!(!DETAILS_SCRIPT.contains(TEAM));
    for verb in [" start ", " stop ", " restart ", " run ", " rm ", " kill ", " cp ", " pull ", " exec ", "tmux", " create "] {
        assert!(!DETAILS_SCRIPT.contains(verb), "{verb}");
    }
    // nothing is written by a discovery
    assert!(!sandbox.candidate().exists() && !sandbox.selection().exists());
    // what reaches the app: the same code, with the list
    let error = serde_json::to_value(choice_failure("existing_team_ambiguous", choices)).expect("json");
    assert_eq!(error["code"], "existing_team_ambiguous");
    assert_eq!(error["choices"].as_array().expect("choices").len(), 2);
    assert_eq!(error["choices"][0]["containerId"], container_id(1));
    assert_eq!(error["choices"][0]["startedAt"], "2026-10-20T08:00:00.123456789Z");
    // and no list for any other code
    let other = serde_json::to_value(choice_failure("existing_team_not_found", Vec::new())).expect("json");
    assert!(other.get("choices").is_none());
}

#[test]
fn t123_details_that_are_not_exactly_right_are_dropped_and_the_choice_stays() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let one = container_id(1);
    let two = container_id(2);
    let bad: Vec<Result<ProcessResult, &'static str>> = vec![
        Ok(exit(71)),
        Err("process_timeout"),
        Ok(details_reply(&[format!("C|{one}|jht|2026-10-20T08:00:00Z"), "END|1".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|jht|2026-10-20T08:00:00Z"), format!("C|{one}|jht|2026-10-20T08:00:00Z"), "END|2".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|jht|2026-10-20T08:00:00Z"), format!("C|{}|x|-", container_id(3)), "END|2".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|<b>jht</b>|-"), format!("C|{two}|-|-"), "END|2".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|jht|yesterday"), format!("C|{two}|-|-"), "END|2".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|jht|-|extra"), format!("C|{two}|-|-"), "END|2".to_owned()])),
        Ok(details_reply(&[format!("C|{one}|-|-"), format!("C|{two}|-|-")])),
    ];
    for (n, answer) in bad.into_iter().enumerate() {
        let (_, server) = two_of_the_team();
        *server.details.borrow_mut() = answer;
        let (result, choices) = discover_picking(&sandbox, &server, None);
        assert_eq!(result.expect_err("ambiguous"), "existing_team_ambiguous", "case {n}");
        assert_eq!(choices.len(), 2, "case {n}");
        assert!(choices.iter().all(|c| c.name.is_none() && c.started_at.is_none()), "case {n}");
    }
    // a valid reply where one container could not be read keeps the other's details
    let reply = details_reply(&[format!("C|{one}|jht|2026-10-20T08:00:00Z"), format!("C|{two}|-|-"), "END|2".to_owned()]);
    let details = parse_details(&reply, &[one.as_str(), two.as_str()]);
    assert_eq!(details[&one], (Some("jht".to_owned()), Some("2026-10-20T08:00:00Z".to_owned())));
    assert_eq!(details[&two], (None, None));
}

#[test]
fn t123_one_container_of_the_team_needs_no_details_call() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let world = team_world();
    let server = team_server(&world);
    let (result, choices) = discover_picking(&sandbox, &server, None);
    assert_eq!(result.expect("found").runtime.container_id, container_id(1));
    assert!(choices.is_empty());
    assert!(!server.commands().iter().any(|c| c == DETAILS_SCRIPT));
}

#[test]
fn t123_the_pick_only_narrows_to_a_container_that_answers_as_the_team_now() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    // the picked one of the two
    let (world, server) = two_of_the_team();
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(2)));
    let found = result.expect("picked");
    assert_eq!(found.runtime, target_of(&world, 2));
    assert!(!found.readiness);
    assert!(!server.commands().iter().any(|c| c == DETAILS_SCRIPT));
    // another team's container, someone else's image, an id the VPS does not have: never
    for id in [container_id(3), container_id(4), container_id(9)] {
        let (_, server) = two_of_the_team();
        let (result, _) = discover_picking(&sandbox, &server, Some(&id));
        assert_eq!(result.expect_err("not the team's"), CHOICE_GONE);
    }
    // the picked one stopped meanwhile: only container 1 is listed now
    let world = World::default().jht(1).jht(3);
    let server = Server::new(&world).probe(1, probe_ok(true, true));
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(2)));
    assert_eq!(result.expect_err("gone"), CHOICE_GONE);
    // and with no container of the team left at all, it is not found
    let world = World::default().jht(3);
    let server = Server::new(&world);
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(2)));
    assert_eq!(result.expect_err("none"), "existing_team_not_found");
    // a malformed id is refused before any call
    for id in ["", "zz", "C0C0", &"c0".repeat(33), &format!("{}\n", container_id(1))] {
        let (_, server) = two_of_the_team();
        let (result, _) = discover_picking(&sandbox, &server, Some(id));
        assert_eq!(result.expect_err("malformed"), "invalid_container_choice", "{id:?}");
        assert_eq!(server.count(), 0);
    }
}

#[test]
fn t123_register_rediscovers_with_the_same_pick_and_writes_that_container() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let (world, server) = two_of_the_team();
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(2)));
    let found = result.expect("picked");
    let mut receipt = receipt_of(&sandbox, &found);
    // without the pick the same receipt cannot register: the team is still ambiguous
    let (_, server) = two_of_the_team();
    assert_eq!(register(&sandbox, &server, &receipt).expect_err("no pick"), "existing_team_ambiguous");
    assert!(!sandbox.candidate().exists());
    // with it, the candidate is the picked container
    receipt.chosen = Some(container_id(2));
    let (_, server) = two_of_the_team();
    assert!(matches!(register(&sandbox, &server, &receipt).expect("registered"), Registered::New(CandidateWrite::Written)));
    let (candidate, _) = runtime::candidate_bytes(&host(), TEAM, &target_of(&world, 2)).expect("bytes");
    assert_eq!(fs::read(sandbox.candidate()).expect("candidate"), candidate);
}

#[test]
fn t123_a_pick_that_is_gone_at_register_writes_nothing_and_drops_the_receipt() {
    let sandbox = Sandbox::new();
    write_pin(&sandbox);
    let (_, server) = two_of_the_team();
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(2)));
    let mut receipt = receipt_of(&sandbox, &result.expect("picked"));
    receipt.chosen = Some(container_id(2));
    let world = World::default().jht(1).jht(3);
    let server = Server::new(&world).probe(1, probe_ok(true, true));
    let gone = register(&sandbox, &server, &receipt);
    assert_eq!(*gone.as_ref().map(|_| ()).expect_err("gone"), CHOICE_GONE);
    assert!(!sandbox.candidate().exists());
    let slot = Mutex::new(Some(receipt));
    assert!(settle_register(&slot, gone).is_err());
    assert!(slot.lock().expect("slot").is_none(), "a new discovery is needed");
}

#[test]
fn t123_an_updated_team_that_answers_from_two_containers_is_rebound_only_to_the_one_picked() {
    let sandbox = Sandbox::new();
    let (old_world, _) = connected_once(&sandbox);
    let (candidate, selection) = pair_of(&sandbox);
    // after the update both the new container (5) and another one (6) answer as the team
    let world = updated_world().jht(6);
    let server = || Server::new(&world).probe(5, probe_ok(true, true)).probe(6, probe_ok(false, false));
    let (result, choices) = discover_picking(&sandbox, &server(), None);
    assert_eq!(result.expect_err("two of the team"), "existing_team_ambiguous");
    let ids: Vec<&str> = choices.iter().map(|c| c.container_id.as_str()).collect();
    assert_eq!(ids, [container_id(5), container_id(6)]);
    // the pick: a rebind of the saved candidate to that container, still nothing written
    let (result, _) = discover_picking(&sandbox, &server(), Some(&container_id(6)));
    let found = result.expect("picked");
    assert_eq!(found.runtime, target_of(&world, 6));
    let base = found.replaces.as_ref().expect("it says what it replaces");
    assert_eq!(base.runtime, target_of(&old_world, 1));
    assert_eq!(base.candidate_sha256, runtime::sha256(&candidate));
    assert_eq!(pair_of(&sandbox), (candidate, selection));
    // register keeps both: the same pick, the same saved candidate replaced
    let mut receipt = receipt_of(&sandbox, &found);
    receipt.chosen = Some(container_id(6));
    assert_eq!(register(&sandbox, &server(), &receipt), Ok(Registered::Rebound(CandidateWrite::Written)));
    assert_eq!(fs::read(sandbox.candidate()).unwrap(), found.candidate);
    assert!(!sandbox.selection().exists());
}

#[test]
fn t123_picking_the_container_already_saved_is_no_rebind() {
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let before = pair_of(&sandbox);
    // the old container (1) still answers next to the new one (5)
    let world = updated_world().jht(1);
    let server = Server::new(&world).probe(5, probe_ok(true, true)).probe(1, probe_ok(true, false));
    let (result, _) = discover_picking(&sandbox, &server, Some(&container_id(1)));
    assert_eq!(result.expect_err("same runtime"), "existing_team_runtime_candidate_exists");
    assert_eq!(pair_of(&sandbox), before);
}

// ------------------------------------------- the full connection kept across a restart

fn full_link_file(sandbox: &Sandbox) -> PathBuf {
    sandbox.account().join("existing-team-runtime-full-link.json")
}

fn serial() -> std::sync::MutexGuard<'static, ()> {
    runtime::FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What a successful «Connect with write access» leaves: the permission in memory and the record.
fn confirmed_in_full(sandbox: &Sandbox, at: u64) -> runtime::ActivatedTarget {
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).expect("selected").expect("a target");
    runtime::grant_full_link(&sandbox.scope, &target);
    runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, at).expect("remembered");
    target
}

/// A new run of the app: the permission in memory is gone; the start-up reopening of the saved team.
fn restart_and_reopen(sandbox: &Sandbox, world: &World) -> crate::onboarding::ExistingTeamReadiness {
    runtime::revoke_full_link();
    reopen(sandbox, &team_server(world), &Cell::new(0)).expect("reopened")
}

fn record_of(sandbox: &Sandbox, target: &runtime::ActivatedTarget, at: u64) -> String {
    serde_json::json!({
        "schema": 1,
        "connection_key": runtime::connection_key(&sandbox.scope, target),
        "granted_at": at,
    })
    .to_string()
}

fn mode_of(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
}

fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

#[test]
fn t40_the_full_connection_comes_back_after_a_restart_when_the_whole_reopening_passes() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = confirmed_in_full(&sandbox, runtime::unix_now());
    // the record: exact keys, private, and nothing of the host, the team or a fingerprint in it
    let bytes = fs::read(full_link_file(&sandbox)).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["connection_key", "granted_at", "schema"]);
    assert_eq!(value["schema"], 1);
    assert_eq!(value["connection_key"], runtime::connection_key(&sandbox.scope, &target));
    assert_eq!(mode_of(&full_link_file(&sandbox)), 0o600);
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("203.0.113") && !text.contains(TEAM) && !text.contains("SHA256") && !text.contains("synthetic-key"));

    let readiness = restart_and_reopen(&sandbox, &world);
    assert!(readiness.full_link, "the person confirmed it and nothing changed");
    assert_eq!(readiness.full_link_outcome, Some("restored"));
    assert!(runtime::full_link_granted(&sandbox.scope, &target));
    assert!(full_link_file(&sandbox).exists(), "the record stays until it expires or is taken away");
    // the reopening itself is still the read-only one: no start, nothing written, the connection key is the same
    assert_eq!(readiness.connection_key.as_deref(), Some(runtime::connection_key(&sandbox.scope, &target).as_str()));
    runtime::revoke_full_link();
}

#[test]
fn t41_no_record_or_no_confirmation_is_the_read_only_view_as_before() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let readiness = restart_and_reopen(&sandbox, &world);
    assert!(!readiness.full_link);
    assert_eq!(readiness.full_link_outcome, Some("not_restored"));
    assert!(!runtime::full_link_granted(&sandbox.scope, &target));
    // the permission of this run only (no record: the write of it failed or was never made) is gone too
    runtime::grant_full_link(&sandbox.scope, &target);
    let again = restart_and_reopen(&sandbox, &world);
    assert!(!again.full_link && !runtime::full_link_granted(&sandbox.scope, &target));
    assert!(!full_link_file(&sandbox).exists());
}

#[test]
fn t42_a_reopening_that_fails_gives_nothing_back_and_keeps_the_record_for_its_expiry() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = confirmed_in_full(&sandbox, runtime::unix_now());
    let record = fs::read(full_link_file(&sandbox)).unwrap();
    for (what, server) in [
        ("the team does not answer", Server::new(&world).probe(1, exit(1))),
        ("another team answers", Server::new(&world).probe(1, exit(72))),
        ("the VPS was updated", Server::new(&world).probe(1, exit(70))),
    ] {
        runtime::revoke_full_link();
        assert!(reopen(&sandbox, &server, &Cell::new(0)).is_err(), "{what}");
        assert!(!runtime::full_link_granted(&sandbox.scope, &target), "{what}");
        assert_eq!(fs::read(full_link_file(&sandbox)).unwrap(), record, "{what}: the record is not touched");
    }
    // the pin is gone: the reopening stops before any SSH call
    runtime::revoke_full_link();
    let server = Server::new(&world).probe(1, probe_ok(true, false));
    let result = existing_team_reopen_with(
        &sandbox.root, &sandbox.scope,
        &mut |_| Err("host_key_changed"), &mut |_| Ok(()),
        &mut |_, c, i, t| server.answer(c, i, t),
    );
    assert_eq!(result.expect_err("pin").code, "host_key_changed");
    assert!(!runtime::full_link_granted(&sandbox.scope, &target));
    assert!(full_link_file(&sandbox).exists());
}

#[test]
fn t43_another_candidate_is_read_only_and_a_rebind_or_an_unlink_takes_the_record_away() {
    let _serial = serial();
    // the record names the connection of ANOTHER saved candidate (the VPS was updated and the team rebound)
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let other = runtime::ActivatedTarget::synthetic_for_tests();
    assert_ne!(runtime::connection_key(&sandbox.scope, &other), runtime::connection_key(&sandbox.scope, &target));
    runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &other, runtime::unix_now()).unwrap();
    let readiness = restart_and_reopen(&sandbox, &world);
    assert!(!readiness.full_link && !runtime::full_link_granted(&sandbox.scope, &target));
    assert_eq!(readiness.full_link_outcome, Some("discarded"));
    assert!(!full_link_file(&sandbox).exists(), "a record of another candidate is removed");

    // the first half of a rebind takes the record away BEFORE the candidate goes: a candidate that
    // comes back byte for byte the same finds nothing to restore
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    confirmed_in_full(&sandbox, runtime::unix_now());
    let candidate = fs::read(sandbox.candidate()).unwrap();
    runtime::clear_for_rebind_at(&sandbox.root, &sandbox.scope, &host(), TEAM, &runtime::sha256(&candidate)).expect("rebind");
    assert!(!full_link_file(&sandbox).exists());
    assert!(!sandbox.candidate().exists() && !sandbox.selection().exists());
    // a refused rebind (the candidate is not the one shown) leaves everything, the record included
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    confirmed_in_full(&sandbox, runtime::unix_now());
    assert_eq!(
        runtime::clear_for_rebind_at(&sandbox.root, &sandbox.scope, &host(), TEAM, &"0".repeat(64)),
        Err("existing_team_runtime_target_changed")
    );
    assert!(full_link_file(&sandbox).exists() && sandbox.candidate().exists());
    // «Unlink the team»
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    confirmed_in_full(&sandbox, runtime::unix_now());
    runtime::clear_link_at(&sandbox.root, &sandbox.scope).expect("unlink");
    assert!(!full_link_file(&sandbox).exists());
    assert!(!sandbox.candidate().exists() && !sandbox.selection().exists());
    runtime::revoke_full_link();
}

#[test]
fn t44_a_record_that_cannot_be_believed_is_ignored_and_removed() {
    use std::os::unix::{ffi::OsStrExt, fs::symlink};
    let _serial = serial();
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let now = runtime::unix_now();
    let good = record_of(&sandbox, &target, now);
    let key = runtime::connection_key(&sandbox.scope, &target);
    let write = |bytes: &str, mode: u32| {
        let file = full_link_file(&sandbox);
        let _ = fs::remove_file(&file);
        fs::write(&file, bytes).unwrap();
        set_mode(&file, mode);
    };
    let cases: Vec<(&str, Box<dyn Fn() + '_>)> = vec![
        ("group-readable (0644)", Box::new(|| write(&good, 0o644))),
        ("too open (0666)", Box::new(|| write(&good, 0o666))),
        ("stricter than the writer makes it (0400)", Box::new(|| write(&good, 0o400))),
        ("a symbolic link to a good record", Box::new(|| {
            let real = sandbox.account().join("elsewhere.json");
            fs::write(&real, &good).unwrap();
            set_mode(&real, 0o600);
            let _ = fs::remove_file(full_link_file(&sandbox));
            symlink(&real, full_link_file(&sandbox)).unwrap();
        })),
        ("a dangling symbolic link", Box::new(|| {
            let _ = fs::remove_file(full_link_file(&sandbox));
            symlink("/nonexistent/synthetic", full_link_file(&sandbox)).unwrap();
        })),
        ("a FIFO", Box::new(|| {
            let file = full_link_file(&sandbox);
            let _ = fs::remove_file(&file);
            let name = std::ffi::CString::new(file.as_os_str().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        })),
        ("two names (a hard link)", Box::new(|| {
            write(&good, 0o600);
            fs::hard_link(full_link_file(&sandbox), sandbox.account().join("second-name")).unwrap();
        })),
        ("over 1 KiB", Box::new(|| write(&format!("{good}{}", " ".repeat(2000)), 0o600))),
        ("empty", Box::new(|| write("", 0o600))),
        ("not JSON", Box::new(|| write("granted", 0o600))),
        ("an extra key", Box::new(|| write(&good.replace('}', ",\"host\":\"x\"}"), 0o600))),
        ("another schema", Box::new(|| write(&good.replace("\"schema\":1", "\"schema\":2"), 0o600))),
        ("a key that is not a whole hash", Box::new(|| write(&good.replace(&key, &key[..63]), 0o600))),
        ("an upper-case hash", Box::new(|| write(&good.replace(&key, &key.to_uppercase()), 0o600))),
        ("a date that is a float", Box::new(|| write(&good.replace(&now.to_string(), &format!("{now}.5")), 0o600))),
        ("a date that is a string", Box::new(|| write(&good.replace(&now.to_string(), &format!("\"{now}\"")), 0o600))),
        ("a negative date", Box::new(|| write(&good.replace(&now.to_string(), "-5"), 0o600))),
        ("a missing date", Box::new(|| write(&format!("{{\"schema\":1,\"connection_key\":\"{key}\"}}"), 0o600))),
    ];
    for (what, prepare) in &cases {
        runtime::revoke_full_link();
        let _ = fs::remove_file(sandbox.account().join("second-name"));
        prepare();
        let readiness = restart_and_reopen(&sandbox, &world);
        assert!(!readiness.full_link, "{what}");
        assert!(!runtime::full_link_granted(&sandbox.scope, &target), "{what}");
        assert_eq!(readiness.full_link_outcome, Some("discarded"), "{what}");
        assert!(fs::symlink_metadata(full_link_file(&sandbox)).is_err(), "{what}: the record is removed");
    }
    // and the same record, written the way the app writes it, does come back: the cases above are the defense
    write(&good, 0o600);
    assert!(restart_and_reopen(&sandbox, &world).full_link);
    runtime::revoke_full_link();
}

#[test]
fn t45_a_record_older_than_thirty_days_or_from_the_future_is_removed() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let given = 1_800_000_000u64;
    let max = runtime::FULL_LINK_MAX_AGE_S;
    assert_eq!(max, 30 * 24 * 3600);
    for (now, restored, what) in [
        (given, true, "the same second"),
        (given + max, true, "the last second of the thirtieth day"),
        (given + max + 1, false, "one second more"),
        (given + 365 * 24 * 3600, false, "a year"),
        (given - 1, false, "the clock went back by a second"),
        (given - 10_000_000, false, "the clock went back a lot"),
    ] {
        runtime::revoke_full_link();
        runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, given).unwrap();
        let outcome = runtime::restore_full_link_at(&sandbox.root, &sandbox.scope, &target, now);
        assert_eq!(runtime::full_link_granted(&sandbox.scope, &target), restored, "{what}");
        assert_eq!(
            outcome,
            if restored { runtime::FullLinkRestore::Restored } else { runtime::FullLinkRestore::Expired },
            "{what}"
        );
        assert_eq!(full_link_file(&sandbox).exists(), restored, "{what}: an expired record is removed");
    }
    runtime::revoke_full_link();
}

#[test]
fn t46_another_account_never_gets_the_permission_from_a_record() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    connected_once(&sandbox);
    let target = confirmed_in_full(&sandbox, runtime::unix_now());
    runtime::revoke_full_link();
    let (other, dir) = sandbox.other_scope();
    fs::remove_file(dir.join("existing-team-runtime-candidate.json")).unwrap();
    // the other account has no record at all
    assert_eq!(
        runtime::restore_full_link_at(&sandbox.root, &other, &target, runtime::unix_now()),
        runtime::FullLinkRestore::NotRestored
    );
    // the record of this account copied into the other's folder is not the other's: its key is
    fs::copy(full_link_file(&sandbox), dir.join("existing-team-runtime-full-link.json")).unwrap();
    set_mode(&dir.join("existing-team-runtime-full-link.json"), 0o600);
    assert_eq!(
        runtime::restore_full_link_at(&sandbox.root, &other, &target, runtime::unix_now()),
        runtime::FullLinkRestore::Discarded
    );
    assert!(!runtime::full_link_granted(&other, &target) && !runtime::full_link_granted(&sandbox.scope, &target));
}

#[test]
fn t47_a_record_that_cannot_be_written_or_taken_away_is_said_not_swallowed() {
    use std::os::unix::fs::MetadataExt;
    let _serial = serial();
    if unsafe { libc::geteuid() } == 0 {
        return; // permissions mean nothing to root: the cases below cannot be built
    }
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let account = sandbox.account();
    let unavailable: Result<(), &str> = Err("existing_team_runtime_unavailable");
    // writing: a folder nobody may write into, and one that others may write into, are refused: no record
    set_mode(&account, 0o500);
    assert_eq!(runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, 1), unavailable);
    set_mode(&account, 0o770);
    assert_eq!(runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, 1), unavailable);
    set_mode(&account, 0o700);
    assert!(!full_link_file(&sandbox).exists());
    assert!(fs::read_dir(&account).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().contains("full-link.tmp")));
    assert_eq!(fs::metadata(&account).unwrap().uid(), unsafe { libc::geteuid() });

    // removing: the folder does not let the file go, but the file can be overwritten: it is made unreadable as a record
    runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, runtime::unix_now()).unwrap();
    set_mode(&account, 0o500);
    assert_eq!(runtime::forget_full_link_at(&sandbox.root, &sandbox.scope), Ok(runtime::FullLinkForgotten::Neutralized));
    set_mode(&account, 0o700);
    assert!(full_link_file(&sandbox).exists(), "it could not be removed");
    let readiness = restart_and_reopen(&sandbox, &world);
    assert!(!readiness.full_link, "a neutralized record gives nothing back");
    assert_eq!(readiness.full_link_outcome, Some("discarded"));

    // neither works: the file cannot be written and the folder does not let it go or move: an error, said by name
    runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, runtime::unix_now()).unwrap();
    set_mode(&full_link_file(&sandbox), 0o400);
    set_mode(&account, 0o500);
    assert_eq!(runtime::forget_full_link_at(&sandbox.root, &sandbox.scope), Err("existing_team_full_link_not_removed"));
    set_mode(&account, 0o700);
    // and the unlink, the rebind and a new confirmation stop there rather than go on with an armed record
    set_mode(&account, 0o500);
    assert_eq!(runtime::clear_link_at(&sandbox.root, &sandbox.scope), Err("existing_team_full_link_not_removed"));
    set_mode(&account, 0o700);
    assert!(sandbox.candidate().exists() && sandbox.selection().exists(), "nothing else was removed");
    set_mode(&full_link_file(&sandbox), 0o600);
    runtime::revoke_full_link();
}

#[test]
fn t48_the_code_that_gives_and_takes_the_permission_is_where_it_must_be() {
    let runtime_source = include_str!("existing_team_runtime.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
    // the permission in memory is set by ONE function, and the restore goes through it
    assert_eq!(runtime_source.matches("*slot = Some(").count(), 1, "one place sets FULL_LINK");
    let restore = runtime_source.split("pub(crate) fn restore_full_link_at(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert_eq!(restore.matches("grant_full_link(scope, target)").count(), 1);
    assert!(!restore.contains("FULL_LINK.") && !restore.contains("*slot"), "no shortcut that sets the static");
    // the descriptor itself is read: no link followed, never blocking, the size capped before any parse
    let read = runtime_source.split("fn read_full_link_mark(").nth(1).unwrap().split("\n}\n").next().unwrap();
    for needed in ["O_NOFOLLOW", "O_NONBLOCK", "handle.metadata()", "geteuid()", "0o777 != 0o600", "nlink() != 1", "FULL_LINK_MAX_BYTES"] {
        assert!(read.contains(needed), "{needed}");
    }

    let onboarding = include_str!("onboarding.rs").split("mod existing_team_assistant_tests").next().unwrap();
    // only the start-up reopening gives it back: not the connection, not the explicit read-only opening, not the shared probe
    assert_eq!(onboarding.matches("restore_full_link_at(").count(), 1);
    let reopen = onboarding.split("pub(crate) fn existing_team_reopen_with(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(reopen.find("existing_team_readonly_connect_with(").unwrap() < reopen.find("restore_full_link_at(").unwrap(), "after the checks");
    assert!(reopen.find("revoke_full_link()").unwrap() < reopen.find("restore_full_link_at(").unwrap());
    // «Connect with write access»: a new confirmation starts from nothing on disk, the record is written once, after the grant
    let connect = onboarding.split("pub(crate) async fn onboarding_existing_team_connect(").nth(1).unwrap().split("\n}\n").next().unwrap();
    let forget = connect.find("forget_full_link_at(").expect("it forgets first");
    assert!(forget < connect.find("if request.reconfirm").unwrap());
    assert_eq!(connect.matches("remember_full_link_at(").count(), 1);
    assert!(connect.find("grant_full_link(").unwrap() < connect.find("remember_full_link_at(").unwrap());
    // the explicit read-only opening takes the record away before it connects; «switch to read only» revokes first
    let explicit = onboarding.split("pub(crate) async fn onboarding_existing_team_readonly_connect(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(explicit.find("forget_full_link_at(").unwrap() < explicit.find("existing_team_readonly_connect_with(").unwrap());
    let off = onboarding.split("pub(crate) async fn existing_team_write_access_off(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(off.find("window_may_write(window.label())").unwrap() < off.find("revoke_full_link()").unwrap());
    assert!(off.find("revoke_full_link()").unwrap() < off.find("forget_full_link_at(").unwrap());
    // the unlink revokes in memory before anything that can fail
    let unlink = onboarding.split("pub(crate) async fn existing_team_unlink(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(unlink.find("revoke_full_link()").unwrap() < unlink.find("clear_link_at(").unwrap());
    assert!(include_str!("lib.rs").contains("onboarding::existing_team_write_access_off"));
}

#[test]
fn t49_leaving_the_account_takes_the_record_away_so_coming_back_is_read_only() {
    let _serial = serial();
    let sandbox = Sandbox::new();
    let (world, _) = connected_once(&sandbox);
    let target = confirmed_in_full(&sandbox, runtime::unix_now());
    assert!(full_link_file(&sandbox).exists());
    // the person signs out (or another account takes over); the saved team itself stays
    crate::account_scope::forget_write_access_at(&sandbox.root, &sandbox.scope);
    assert!(!full_link_file(&sandbox).exists());
    assert!(sandbox.candidate().exists() && sandbox.selection().exists(), "only the permission goes");
    // and signs in again within the 30 days: a new run of the app, the same team, the reopening passes: read only
    let readiness = restart_and_reopen(&sandbox, &world);
    assert!(!readiness.full_link && !runtime::full_link_granted(&sandbox.scope, &target));
    assert_eq!(readiness.full_link_outcome, Some("not_restored"));
    // a record that cannot be removed is neutralized on the way out (best effort, never an error that blocks leaving)
    if unsafe { libc::geteuid() } != 0 {
        runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, runtime::unix_now()).unwrap();
        set_mode(&sandbox.account(), 0o500);
        crate::account_scope::forget_write_access_at(&sandbox.root, &sandbox.scope);
        set_mode(&sandbox.account(), 0o700);
        assert!(!restart_and_reopen(&sandbox, &world).full_link, "an unremovable record is overwritten, never read again");
    }
    // another account's record is not touched
    let (other, dir) = sandbox.other_scope();
    fs::write(dir.join("existing-team-runtime-full-link.json"), b"x").unwrap();
    crate::account_scope::forget_write_access_at(&sandbox.root, &sandbox.scope);
    assert!(dir.join("existing-team-runtime-full-link.json").exists());
    let _ = other;
    runtime::revoke_full_link();
}

#[test]
fn t50_the_sign_out_and_the_switch_of_account_call_it_and_leftover_temporary_files_are_swept() {
    let source = include_str!("account_scope.rs").split("#[cfg(test)]").next().unwrap();
    let reset = source.split("pub(crate) fn runtime_account_scope_reset(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(reset.find("active.take()").unwrap() < reset.find("direct_chat::teardown").unwrap());
    assert!(reset.find("direct_chat::teardown").unwrap() < reset.find("forget_write_access_of(").unwrap(), "after the handles are closed");
    let switch = source.split("fn activate_scope(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(switch.find("active.take()").unwrap() < switch.find("forget_write_access_of(").unwrap());
    assert!(switch.find("forget_write_access_of(").unwrap() < switch.find("*active = Some(next)").unwrap());

    let _serial = serial();
    let sandbox = Sandbox::new();
    let (_world, _) = connected_once(&sandbox);
    let target = runtime::selected_at(&sandbox.root, &sandbox.scope, &host()).unwrap().unwrap();
    let leftover = sandbox.account().join("existing-team-runtime-full-link.tmp-1-2");
    let other_leftover = sandbox.account().join("existing-team-runtime-candidate.tmp-1-2");
    fs::write(&leftover, b"half").unwrap();
    fs::write(&other_leftover, b"not ours").unwrap();
    runtime::remember_full_link_at(&sandbox.root, &sandbox.scope, &target, runtime::unix_now()).unwrap();
    assert!(!leftover.exists(), "a write sweeps what an interrupted one left");
    assert!(other_leftover.exists() && sandbox.candidate().exists() && sandbox.selection().exists(), "and only its own");
    fs::write(&leftover, b"half").unwrap();
    runtime::restore_full_link_at(&sandbox.root, &sandbox.scope, &target, runtime::unix_now());
    assert!(!leftover.exists(), "so does the start-up reopening");
    runtime::revoke_full_link();
}
