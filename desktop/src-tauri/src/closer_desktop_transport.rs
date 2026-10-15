//! Process I/O for the one #281 SSH command. Never truncates a JSON reply.
use std::{
    ffi::OsString,
    io::{Read, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(super) const OUTPUT_LIMIT: usize = 12 * 1024 * 1024;

#[cfg(unix)]
fn prepare(stdout: &std::process::ChildStdout) -> Result<(), &'static str> {
    use std::os::fd::AsRawFd;
    // SAFETY: the open pipe is owned for the entire call; flags preserve existing bits.
    unsafe {
        let flags = libc::fcntl(stdout.as_raw_fd(), libc::F_GETFL);
        if flags == -1
            || libc::fcntl(stdout.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) == -1
        {
            return Err("browser_transport_unavailable");
        }
    }
    Ok(())
}

#[cfg(windows)]
fn prepare(_: &std::process::ChildStdout) -> Result<(), &'static str> {
    Ok(())
}

#[cfg(unix)]
fn read(
    stdout: &mut std::process::ChildStdout,
    buffer: &mut [u8],
) -> std::io::Result<Option<usize>> {
    match stdout.read(buffer) {
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
        value => value.map(Some),
    }
}

#[cfg(windows)]
fn read(
    stdout: &mut std::process::ChildStdout,
    buffer: &mut [u8],
) -> std::io::Result<Option<usize>> {
    use std::{os::windows::io::AsRawHandle, ptr};
    use windows_sys::Win32::{Foundation::ERROR_BROKEN_PIPE, System::Pipes::PeekNamedPipe};
    let mut available = 0;
    // SAFETY: this is the owned stdout pipe; only the available count is requested.
    if unsafe {
        PeekNamedPipe(
            stdout.as_raw_handle(),
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            &mut available,
            ptr::null_mut(),
        )
    } == 0
    {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
            Ok(Some(0))
        } else {
            Err(error)
        };
    }
    if available == 0 {
        return Ok(None);
    }
    let count = buffer.len().min(available as usize);
    stdout.read(&mut buffer[..count]).map(Some)
}

/// Private to the #281 module; no new renderer-selectable program/arguments.
pub(super) fn run_bounded(
    program: &str,
    args: &[OsString],
    input: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, &'static str> {
    // Fits an initially empty anonymous stdin pipe on both supported platforms.
    // The embedded bridge is in the fixed command; only the small envelope is stdin.
    if input.len() > 2048 {
        return Err("browser_request_invalid");
    }
    let started = Instant::now();
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|_| "browser_transport_unavailable")?;
    let result = (|| {
        let mut stdout = child.stdout.take().ok_or("browser_transport_unavailable")?;
        prepare(&stdout)?;
        {
            let mut stdin = child.stdin.take().ok_or("browser_transport_unavailable")?;
            stdin
                .write_all(input)
                .map_err(|_| "browser_transport_unavailable")?;
        }
        let mut output = Vec::new();
        let mut buffer = [0; 65536];
        let mut eof = false;
        loop {
            if started.elapsed() >= timeout {
                return Err("browser_transport_timeout");
            }
            if !eof {
                match read(&mut stdout, &mut buffer).map_err(|_| "browser_transport_unavailable")? {
                    Some(0) => eof = true,
                    Some(count) => {
                        if output.len() + count > OUTPUT_LIMIT {
                            return Err("browser_response_too_large");
                        }
                        output.extend_from_slice(&buffer[..count]);
                    }
                    None => {}
                }
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|_| "browser_transport_unavailable")?
            {
                if !status.success() {
                    return Err("browser_transport_unavailable");
                }
                if eof {
                    return Ok(output);
                }
            }
            thread::sleep(Duration::from_millis(2));
        }
    })();
    // No reader/writer threads or detached pipe drains survive timeout/overflow.
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    child.wait().map_err(|_| "browser_transport_unavailable")?;
    result
}
