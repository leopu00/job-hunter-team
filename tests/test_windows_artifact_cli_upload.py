"""Real PowerShell upload dispatcher, real CLI/skill, synthetic mounted files.

The real top-level switch is parsed, not copied. Only engine admission is
stubbed; Docker is a test transport and no engine or desktop app is needed.
Native Windows junction/ACL behaviour requires the separately authorised gate.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import install_fake, powershell_argv, WINDOWS

ROOT = Path(__file__).resolve().parents[1]
PDF = b"%PDF-1.4\nsynthetic document\n%%EOF\n"
HOST_ROOT = r"C:\Users\Synthetic\Documents\Job Hunter Team"

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:UPLOAD_WRAPPER, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "wrapper parse: $($errors[0])" }
$dispatch = @($ast.EndBlock.Statements | Where-Object {
  $_ -is [System.Management.Automation.Language.SwitchStatementAst] -and $_.Condition.Extent.Text -ceq '$Sub'
})
if ($dispatch.Count -ne 1) { throw 'real dispatcher missing or duplicated' }
function Require-ComposeFile { }
function Require-Docker { }
function Ensure-Up { }
function Write-Err { param($Message) [Console]::Error.WriteLine($Message) }
function docker {
  [IO.File]::WriteAllText($env:UPLOAD_CALLS, (ConvertTo-Json -InputObject @($args) -Compress))
  if ($env:UPLOAD_TRANSPORT_RC) {
    [Console]::Error.WriteLine('synthetic transport refused')
    $global:LASTEXITCODE = [int]$env:UPLOAD_TRANSPORT_RC
    return
  }
  if ($args[0] -cne 'exec') { throw 'unexpected engine operation' }
  $i = 1
  while ($args[$i] -in @('-i', '-t', '-e')) {
    if ($args[$i] -eq '-e') {
      $i++
      $pair = $args[$i].Split('=', 2)
      [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
    }
    $i++
  }
  if ($args[$i] -cne 'fake-team' -or $args[$i+1] -cne 'node') { throw 'wrong target' }
  $forwarded = @($args[($i+2)..($args.Count-1)])
  & $env:UPLOAD_NODE @forwarded
}
$Sub = 'artifact'
$Rest = @('upload') + [string[]](ConvertFrom-Json -InputObject $env:UPLOAD_ARGS)
$LocalAppData = $env:UPLOAD_APPDATA
$Container = 'fake-team'
$NodeEntry = $env:UPLOAD_ENTRY
$ExecFlags = @('-i')
Invoke-Expression $dispatch[0].Extent.Text
"""


@pytest.fixture
def upload_case(tmp_path):
    root = tmp_path / 'documents'
    root.mkdir()
    home = tmp_path / 'home'
    home.mkdir()
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    # The Node fallback probes this fake, never a real Docker on the machine.
    install_fake(bin_dir, 'docker.exe' if WINDOWS else 'docker', '#!/bin/sh\nexit 1\n')
    import shutil
    node = shutil.which('node')
    assert node, 'Node is required for the CLI upload proof'
    harness = tmp_path / 'upload.ps1'
    harness.write_text(HARNESS, encoding='utf-8')
    env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
           'USERPROFILE': r'C:\Users\Synthetic', 'JHT_USER_DIR_HOST': '',
           'JHT_HOME': str(home), 'JHT_ARTIFACT_ROOT': str(root),
           'JHT_CONTAINER_NAME': 'upload-synthetic-absent', 'IS_CONTAINER': '0',
           'UPLOAD_WRAPPER': str(ROOT / 'scripts/jht-wrapper.ps1'),
           'UPLOAD_ENTRY': str(ROOT / 'cli/bin/jht.js'), 'UPLOAD_NODE': node,
           'UPLOAD_APPDATA': str(tmp_path / 'appdata'),
           'UPLOAD_CALLS': str(tmp_path / 'calls.json'), 'UPLOAD_TRANSPORT_RC': '',
           'NO_COLOR': '1', 'JHT_LANG': 'en'}
    env.pop('JHT_ARTIFACT_HOST_CONTEXT', None)
    return root, harness, env


def run_upload(case, *args, data=None):
    root, harness, env = case
    done = subprocess.run([*powershell_argv(), '-File', str(harness)],
                          env={**env, 'UPLOAD_ARGS': json.dumps(args)}, input=data,
                          capture_output=True, timeout=40)
    return done, root / 'allegati'


@pytest.mark.parametrize('name', ['CV synthetic.pdf', "CV d'esempio.pdf", 'CV ünicode.pdf', '-cv.pdf'])
def test_cli_only_upload_reads_the_real_mounted_document(upload_case, name):
    root, _, env = upload_case
    (root / name).write_bytes(PDF)
    done, destination = run_upload(upload_case, HOST_ROOT + '\\' + name, '--json')
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    assert answer['ok'] is True and answer['bytes'] == len(PDF)
    assert (destination / answer['name']).read_bytes() == PDF
    assert answer['path'] == '/jht_user/allegati/' + answer['name']
    calls = json.loads(Path(env['UPLOAD_CALLS']).read_text())
    context = next(arg for arg in calls if arg.startswith('JHT_ARTIFACT_HOST_CONTEXT='))
    assert 'Synthetic' not in context, 'context must be encoded across the native boundary'
    assert calls[-4:] == ['artifact', 'upload', HOST_ROOT + '\\' + name, '--json']


def test_cli_only_upload_uses_the_configured_shared_folder(upload_case):
    root, _, env = upload_case
    env['JHT_USER_DIR_HOST'] = r'D:\Shared documents'
    (root / 'cv.pdf').write_bytes(PDF)
    done, destination = run_upload(upload_case, r'D:\Shared documents\cv.pdf')
    assert done.returncode == 0, done.stdout + done.stderr
    assert (destination / 'cv.pdf').read_bytes() == PDF


@pytest.mark.parametrize('written', [
    r'C:\Users\Synthetic\Downloads\cv.pdf', HOST_ROOT + r'-other\cv.pdf',
    r'D:\cv.pdf', r'C:cv.pdf', r'\cv.pdf', r'\\server\share\cv.pdf',
    HOST_ROOT + r'\..\secret.pdf', HOST_ROOT + r'\cv.pdf:secret',
])
def test_cli_only_outside_or_ambiguous_paths_fail_with_an_action(upload_case, written):
    done, destination = run_upload(upload_case, written)
    assert done.returncode == 2, done.stdout + done.stderr
    assert b'artifact_host_path_unavailable' in done.stderr
    assert b'copy' in done.stderr.lower() and b'Job Hunter Team' in done.stderr
    assert written.encode() not in done.stdout + done.stderr
    assert b'ENOENT' not in done.stdout + done.stderr
    assert not destination.exists()


@pytest.mark.parametrize('kind', ['missing', 'directory', 'empty', 'oversized', 'extension'])
def test_cli_only_invalid_sources_are_refused_without_writing(upload_case, kind):
    root, _, _ = upload_case
    name = 'cv.exe' if kind == 'extension' else 'cv.pdf'
    source = root / name
    if kind == 'directory':
        source.mkdir()
    elif kind != 'missing':
        source.write_bytes(b'x' * (10 * 1024 * 1024 + 1) if kind == 'oversized'
                           else b'' if kind == 'empty' else PDF)
    done, destination = run_upload(upload_case, HOST_ROOT + '\\' + name)
    assert done.returncode != 0, done.stdout + done.stderr
    assert done.stderr
    assert b'artifact_upload_needs_app' not in done.stdout + done.stderr
    assert not destination.exists()


def test_cli_only_transport_failure_keeps_its_exit_code(upload_case):
    _, _, env = upload_case
    env['UPLOAD_TRANSPORT_RC'] = '41'
    done, destination = run_upload(upload_case, HOST_ROOT + r'\cv.pdf')
    assert done.returncode == 41, done.stdout + done.stderr
    assert b'synthetic transport refused' in done.stderr
    assert not destination.exists()


def test_cli_only_stdin_keeps_the_original_binary_bytes(upload_case):
    data = PDF + b'\x00\xff\x80\r\n'
    done, destination = run_upload(upload_case, '--stdin', '--name', 'cv.pdf', '--json', data=data)
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout)['bytes'] == len(data)
    assert (destination / 'cv.pdf').read_bytes() == data


@pytest.mark.parametrize('kind', ['leaf', 'parent', 'fifo'])
def test_cli_only_never_follows_links_or_blocks_on_a_pipe(upload_case, kind):
    root, _, _ = upload_case
    outside = root.parent / 'private'
    outside.mkdir()
    (outside / 'cv.pdf').write_bytes(PDF)
    if kind == 'parent':
        (root / 'nested').symlink_to(outside, target_is_directory=True)
        relative = r'nested\cv.pdf'
    elif kind == 'leaf':
        (root / 'cv.pdf').symlink_to(outside / 'cv.pdf')
        relative = 'cv.pdf'
    else:
        if not hasattr(os, 'mkfifo'):
            # Windows has no POSIX FIFO; its regular-file oracle is the directory case.
            (root / 'cv.pdf').mkdir()
        else:
            os.mkfifo(root / 'cv.pdf')
        relative = 'cv.pdf'
    done, destination = run_upload(upload_case, HOST_ROOT + '\\' + relative)
    assert done.returncode != 0, done.stdout + done.stderr
    assert b'artifact_source_' in done.stderr
    assert not destination.exists()
    assert (outside / 'cv.pdf').read_bytes() == PDF


def test_existing_app_upload_still_keeps_the_apps_exit_code(upload_case):
    _, _, env = upload_case
    folder = Path(env['UPLOAD_APPDATA']) / 'Job Hunter Team'
    folder.mkdir(parents=True)
    install_fake(folder, 'jht-desktop.exe', '#!/bin/sh\nprintf "APP %s\\n" "$*"\nexit 37\n')
    done, destination = run_upload(upload_case, HOST_ROOT + r'\cv.pdf', '--json')
    assert done.returncode == 37, done.stdout + done.stderr
    assert b'APP --artifact-upload' in done.stdout
    assert not Path(env['UPLOAD_CALLS']).exists()
    assert not destination.exists()
