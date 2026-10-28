//! Does this computer have the room the agents need — asked BEFORE anything is installed or started.
//!
//! On a Mac with 20 GiB free the setup used to install the runtime, drop to 7.4 GiB, and then have the disk
//! guard refuse two of the seven agents. Now the setup measures first: free disk and available memory against
//! what is still missing on this computer, and if one is short it does not try, with the numbers.
//!
//! The figures are measured, not guessed (Mac with the runtime installed from scratch, 2026-10-28):
//! the Podman machine occupies 12-13 GiB of the disk (its 30 GiB virtual size is sparse), the runtime image is
//! 4.8 GB, and the disk guard of the team refuses to start an agent under 8 GiB free. What is already on the
//! computer is not asked for twice: a machine and an image that exist only need the guard's margin.
//!
//! A measure that cannot be taken never refuses (`None`): the same rule as the disk guard.

use serde::Serialize;
use std::path::Path;

const GIB: u64 = 1024 * 1024 * 1024;

/// The Podman machine on disk, in GiB (12-13 measured).
pub(crate) const MACHINE_DISK_GIB: u64 = 13;
/// The runtime image, in GiB (4.8 GB measured, rounded up).
pub(crate) const RUNTIME_IMAGE_GIB: u64 = 5;
/// The free disk the team's guard keeps: under it no new agent starts. A test keeps it equal to
/// `DISK_BLOCK_FREE_BYTES` of the guard (shared/skills/host_vitals.py).
pub(crate) const GUARD_MARGIN_GIB: u64 = 8;
/// The memory the machine is given (`podman::MACHINE_MEMORY_MIB`, the team measured at about 3.9 GB).
pub(crate) const MACHINE_RAM_GIB: u64 = 4;
/// What the system and the app itself need on top of the machine.
pub(crate) const HOST_RAM_HEADROOM_GIB: u64 = 2;
/// Swap in use from which the advice is to restart the computer (it only changes the advice, never blocks).
pub(crate) const SWAP_HIGH_USED_GIB: u64 = 4;

/// What is already on this computer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Installed {
    /// The Podman machine exists (on Linux, where there is none, always true).
    pub(crate) machine: bool,
    /// The runtime (its image and wrapper) is installed AND current: an update that would download a new image
    /// counts as not installed, so the image is asked for again.
    pub(crate) runtime: bool,
    /// The machine is running: its memory is already taken.
    pub(crate) machine_running: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Needs {
    pub(crate) disk_gib: u64,
    pub(crate) ram_gib: u64,
}

/// Only what is still missing: a fresh computer needs the machine, the image and the guard's margin; one that
/// has both needs the margin (a start) — and the image again when an update downloads a new one.
pub(crate) fn needs(installed: Installed) -> Needs {
    let machine = if installed.machine { 0 } else { MACHINE_DISK_GIB };
    let image = if installed.runtime { 0 } else { RUNTIME_IMAGE_GIB };
    let machine_ram = if installed.machine_running { 0 } else { MACHINE_RAM_GIB };
    Needs {
        disk_gib: GUARD_MARGIN_GIB + machine + image,
        ram_gib: HOST_RAM_HEADROOM_GIB + machine_ram,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Measure {
    pub(crate) disk_free: Option<u64>,
    pub(crate) ram_available: Option<u64>,
    pub(crate) swap_used: Option<u64>,
}

/// The amounts a refusal names, in bytes: the screen rounds them down to a decimal in the person's language.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Shortfall {
    pub(crate) required_bytes: u64,
    pub(crate) available_bytes: u64,
}

/// `disk_low`, `ram_low` or `ram_low_swap` (memory short while the swap is already high: the advice is to
/// restart), with the amounts; `None` when there is room or when a measure is missing.
pub(crate) fn verdict(needs: Needs, measure: Measure) -> Option<(&'static str, Shortfall)> {
    if let Some(free) = measure.disk_free {
        let required = needs.disk_gib * GIB;
        if free < required {
            return Some(("disk_low", Shortfall { required_bytes: required, available_bytes: free }));
        }
    }
    if let Some(available) = measure.ram_available {
        let required = needs.ram_gib * GIB;
        if available < required {
            let swap_high = measure.swap_used.is_some_and(|used| used >= SWAP_HIGH_USED_GIB * GIB);
            let code = if swap_high { "ram_low_swap" } else { "ram_low" };
            return Some((code, Shortfall { required_bytes: required, available_bytes: available }));
        }
    }
    None
}

/// The disk guard's own refusal, with the amounts it names: the margin and what is free now.
pub(crate) fn guard_shortfall(path: &Path) -> Option<Shortfall> {
    Some(Shortfall { required_bytes: GUARD_MARGIN_GIB * GIB, available_bytes: disk_free_bytes(path)? })
}

/// Free bytes of the volume that holds `path` (or its nearest existing parent), for a normal user.
pub(crate) fn disk_free_bytes(path: &Path) -> Option<u64> {
    let existing = path.ancestors().find(|candidate| candidate.exists())?;
    free_bytes_of(existing)
}

#[cfg(unix)]
fn free_bytes_of(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut stats) } != 0 {
        return None;
    }
    Some((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
}

#[cfg(windows)]
fn free_bytes_of(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut available = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(available)
}

#[cfg(not(any(unix, windows)))]
fn free_bytes_of(_path: &Path) -> Option<u64> {
    None
}

/// `MemAvailable` and the swap in use, in bytes, from /proc/meminfo.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
pub(crate) fn parse_meminfo(text: &str) -> (Option<u64>, Option<u64>) {
    let kib = |key: &str| {
        text.lines().find_map(|line| {
            let rest = line.strip_prefix(key)?.strip_prefix(':')?;
            rest.split_whitespace().next()?.parse::<u64>().ok().map(|value| value * 1024)
        })
    };
    let swap_used = match (kib("SwapTotal"), kib("SwapFree")) {
        (Some(total), Some(free)) => Some(total.saturating_sub(free)),
        _ => None,
    };
    (kib("MemAvailable"), swap_used)
}

/// The swap in use from `sysctl vm.swapusage` («total = 5120.00M  used = 3979.75M  free = 1140.25M  (encrypted)»).
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
pub(crate) fn parse_swap_usage(text: &str) -> Option<u64> {
    let rest = text.split("used =").nth(1)?.split_whitespace().next()?;
    let (number, unit) = rest.split_at(rest.len().checked_sub(1)?);
    let value: f64 = number.parse().ok()?;
    let scale = match unit {
        "K" => 1024.0,
        "M" => 1024.0 * 1024.0,
        "G" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    (value >= 0.0).then(|| (value * scale) as u64)
}

/// The memory a Mac can still give: its total times the share the system reports free
/// (`kern.memorystatus_level`, 0-100, the number `memory_pressure` prints).
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
pub(crate) fn available_from_level(total_bytes: u64, level: u64) -> Option<u64> {
    (level <= 100).then(|| (u128::from(total_bytes) * u128::from(level) / 100) as u64)
}

#[cfg(target_os = "macos")]
fn sysctl(name: &str) -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/sysctl").args(["-n", name]).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(target_os = "macos")]
fn memory() -> (Option<u64>, Option<u64>) {
    let total = sysctl("hw.memsize").and_then(|value| value.parse::<u64>().ok());
    let level = sysctl("kern.memorystatus_level").and_then(|value| value.parse::<u64>().ok());
    let available = total.zip(level).and_then(|(total, level)| available_from_level(total, level));
    (available, sysctl("vm.swapusage").and_then(|value| parse_swap_usage(&value)))
}

#[cfg(target_os = "linux")]
fn memory() -> (Option<u64>, Option<u64>) {
    std::fs::read_to_string("/proc/meminfo").map(|text| parse_meminfo(&text)).unwrap_or((None, None))
}

#[cfg(windows)]
fn memory() -> (Option<u64>, Option<u64>) {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // The page file is not the Mac's swap: Windows only measures the memory it can still give.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    ((ok != 0).then_some(status.ullAvailPhys), None)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn memory() -> (Option<u64>, Option<u64>) {
    (None, None)
}

/// The measures of this computer now: the disk that holds the user's home (the Podman machine and the team's
/// data live under it) and the memory.
pub(crate) fn measure_now(home: &Path) -> Measure {
    let (ram_available, swap_used) = memory();
    Measure { disk_free: disk_free_bytes(home), ram_available, swap_used }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTHING: Installed = Installed { machine: false, runtime: false, machine_running: false };
    const EVERYTHING: Installed = Installed { machine: true, runtime: true, machine_running: true };

    fn gib(value: u64) -> u64 {
        value * GIB
    }

    #[test]
    fn a_computer_with_nothing_installed_needs_the_machine_the_image_and_the_guards_margin() {
        let fresh = needs(NOTHING);
        assert_eq!(fresh.disk_gib, 26, "13 for the machine + 5 for the image + 8 for the guard");
        assert_eq!(fresh.ram_gib, 6, "4 for the machine + 2 for the system");
    }

    #[test]
    fn a_computer_that_has_the_runtime_is_only_asked_for_the_guards_margin() {
        let running = needs(EVERYTHING);
        assert_eq!((running.disk_gib, running.ram_gib), (8, 2), "the machine is up: its memory is already taken");
        let stopped = needs(Installed { machine_running: false, ..EVERYTHING });
        assert_eq!((stopped.disk_gib, stopped.ram_gib), (8, 6), "to start the machine its memory is needed again");
    }

    #[test]
    fn an_update_that_downloads_a_new_image_is_asked_for_it_on_top_of_the_margin() {
        let update = needs(Installed { runtime: false, ..EVERYTHING });
        assert_eq!(update.disk_gib, 13, "the margin and the new image; the machine is already there");
    }

    #[test]
    fn the_machine_without_the_image_needs_the_image_and_the_margin_only() {
        let half = needs(Installed { machine: true, runtime: false, machine_running: false });
        assert_eq!(half.disk_gib, 13);
    }

    #[test]
    fn the_guards_margin_is_the_guards_own_threshold() {
        let guard = include_str!("../../../shared/skills/host_vitals.py");
        assert!(guard.contains(&format!("DISK_BLOCK_FREE_BYTES = {GUARD_MARGIN_GIB} * DISK_GIB")));
    }

    #[test]
    fn the_machines_memory_is_the_one_install_gives_it() {
        assert_eq!(MACHINE_RAM_GIB * 1024, crate::podman::MACHINE_MEMORY_MIB);
    }

    #[test]
    fn disk_short_on_a_fresh_computer_says_what_is_required_and_what_is_there() {
        let measure = Measure { disk_free: Some(gib(20)), ram_available: Some(gib(16)), swap_used: None };
        let (code, shortfall) = verdict(needs(NOTHING), measure).expect("20 GiB is not 26");
        assert_eq!(code, "disk_low");
        assert_eq!((shortfall.required_bytes, shortfall.available_bytes), (gib(26), gib(20)));
    }

    #[test]
    fn the_same_20_gib_are_enough_for_a_computer_that_already_has_the_runtime() {
        let measure = Measure { disk_free: Some(gib(20)), ram_available: Some(gib(16)), swap_used: None };
        assert_eq!(verdict(needs(EVERYTHING), measure), None);
        let update = Installed { runtime: false, ..EVERYTHING };
        assert_eq!(verdict(needs(update), measure), None, "and for an update with a new image (13)");
    }

    #[test]
    fn exactly_what_is_required_is_enough() {
        let measure = Measure { disk_free: Some(gib(26)), ram_available: Some(gib(6)), swap_used: None };
        assert_eq!(verdict(needs(NOTHING), measure), None);
        let one_byte_less = Measure { disk_free: Some(gib(26) - 1), ..measure };
        assert_eq!(verdict(needs(NOTHING), one_byte_less).map(|(code, _)| code), Some("disk_low"));
    }

    #[test]
    fn memory_short_asks_to_close_apps_and_with_the_swap_high_to_restart() {
        let low = Measure { disk_free: Some(gib(100)), ram_available: Some(gib(3)), swap_used: Some(gib(1)) };
        let (code, shortfall) = verdict(needs(NOTHING), low).expect("3 GiB is not 6");
        assert_eq!((code, shortfall.required_bytes, shortfall.available_bytes), ("ram_low", gib(6), gib(3)));
        let swapping = Measure { swap_used: Some(gib(SWAP_HIGH_USED_GIB)), ..low };
        assert_eq!(verdict(needs(NOTHING), swapping).map(|(code, _)| code), Some("ram_low_swap"));
        let just_under = Measure { swap_used: Some(gib(SWAP_HIGH_USED_GIB) - 1), ..low };
        assert_eq!(verdict(needs(NOTHING), just_under).map(|(code, _)| code), Some("ram_low"));
    }

    #[test]
    fn a_high_swap_alone_never_blocks() {
        let enough = Measure { disk_free: Some(gib(100)), ram_available: Some(gib(8)), swap_used: Some(gib(20)) };
        assert_eq!(verdict(needs(NOTHING), enough), None);
    }

    #[test]
    fn the_disk_is_told_before_the_memory() {
        let both = Measure { disk_free: Some(gib(1)), ram_available: Some(gib(1)), swap_used: None };
        assert_eq!(verdict(needs(NOTHING), both).map(|(code, _)| code), Some("disk_low"));
    }

    #[test]
    fn a_measure_that_cannot_be_taken_never_refuses() {
        assert_eq!(verdict(needs(NOTHING), Measure::default()), None);
        let only_disk = Measure { disk_free: Some(gib(100)), ..Measure::default() };
        assert_eq!(verdict(needs(NOTHING), only_disk), None);
    }

    #[test]
    fn the_guard_refusal_names_the_margin_and_what_is_free() {
        let dir = std::env::temp_dir();
        let shortfall = guard_shortfall(&dir).expect("the temp dir is measurable");
        assert_eq!(shortfall.required_bytes, gib(8));
        assert!(shortfall.available_bytes > 0);
        assert_eq!(guard_shortfall(Path::new("")), None, "no path, no measure");
    }

    #[test]
    fn a_folder_that_does_not_exist_yet_is_measured_on_its_nearest_parent() {
        let missing = std::env::temp_dir().join("jht-resources-test").join("not").join("there");
        assert!(disk_free_bytes(&missing).is_some());
    }

    #[test]
    fn the_linux_memory_file_gives_the_available_memory_and_the_swap_in_use() {
        let text = "MemTotal:       16384000 kB\nMemFree:          200000 kB\nMemAvailable:    8388608 kB\nSwapTotal:       4194304 kB\nSwapFree:        1048576 kB\n";
        assert_eq!(parse_meminfo(text), (Some(8388608 * 1024), Some(3145728 * 1024)));
        assert_eq!(parse_meminfo("MemTotal: 1 kB\n"), (None, None));
        assert_eq!(parse_meminfo("MemAvailable: lots kB\n"), (None, None));
    }

    #[test]
    fn the_mac_swap_line_gives_the_swap_in_use() {
        let line = "total = 5120.00M  used = 3979.75M  free = 1140.25M  (encrypted)";
        assert_eq!(parse_swap_usage(line), Some((3979.75 * 1024.0 * 1024.0) as u64));
        assert_eq!(parse_swap_usage("total = 2.00G  used = 1.50G  free = 0.50G"), Some((1.5 * 1024.0 * 1024.0 * 1024.0) as u64));
        assert_eq!(parse_swap_usage("total = 0.00M  used = 0.00M  free = 0.00M"), Some(0));
        assert_eq!(parse_swap_usage("nothing here"), None);
        assert_eq!(parse_swap_usage("used = many"), None);
        assert_eq!(parse_swap_usage("used = "), None);
    }

    #[test]
    fn the_mac_memory_is_the_total_times_the_free_share() {
        assert_eq!(available_from_level(gib(18), 50), Some(gib(9)));
        assert_eq!(available_from_level(gib(18), 0), Some(0));
        assert_eq!(available_from_level(gib(18), 101), None);
    }
}
