"""No 32-bit ELF in the JHT image (scripts/ci/image_elf32.py), without Docker.

The check reads the image's filesystem as a tar stream. Here the stream is
built in memory: a 64-bit Chromium and Python pass; one 32-bit ELF file
anywhere fails; a stream with no ELF file at all fails (the scan would have
read nothing); an image that cannot be exported fails.

Run with: pytest tests/test_image_elf32.py -v
"""

import importlib.util
import io
import tarfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("image_elf32", ROOT / "scripts" / "ci" / "image_elf32.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def elf(bits: int, machine: int) -> bytes:
    """An ELF header: class (1 = 32-bit, 2 = 64-bit), little endian, machine."""
    ident = b"\x7fELF" + bytes([1 if bits == 32 else 2, 1, 1]) + bytes(9)
    return ident + (2).to_bytes(2, "little") + machine.to_bytes(2, "little") + bytes(44)


AARCH64, ARM, X86_64, I386 = 183, 40, 62, 3


def image(files: dict) -> io.BytesIO:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    buffer.seek(0)
    return buffer


ARM64_IMAGE = {
    "opt/playwright/chromium-1208/chrome-linux/chrome": elf(64, AARCH64),
    "usr/bin/python3.12": elf(64, AARCH64),
    "usr/lib/aarch64-linux-gnu/libc.so.6": elf(64, AARCH64),
    "etc/hostname": b"jht\n" * 10,
}


def test_a_64_bit_image_passes_and_its_machines_are_counted():
    result = check.scan(image(ARM64_IMAGE))
    assert result["elf_files"] == 3 and result["elf32_count"] == 0
    assert result["machines"] == {"aarch64": 3}


@pytest.mark.parametrize("path,machine", [
    ("usr/lib/arm-linux-gnueabihf/libc.so.6", ARM),       # armhf libraries
    ("opt/playwright/chromium-1208/chrome-linux/nacl_helper", ARM),
    ("usr/local/lib/node_modules/x/prebuilt/linux-ia32/addon.node", I386),
])
def test_one_32_bit_elf_anywhere_is_found(path, machine):
    result = check.scan(image({**ARM64_IMAGE, path: elf(32, machine)}))
    assert result["elf32_count"] == 1 and result["elf32"][0].startswith(f"/{path} ")


def _main(monkeypatch, capsys, result, argv=("jht:arm64-check", "--platform", "linux/arm64")):
    seen = {}

    def fake_export(image_, platform):
        seen.update(image=image_, platform=platform)
        return result

    monkeypatch.setattr(check, "export", fake_export)
    code = check.main(list(argv))
    return code, capsys.readouterr().out, seen


def test_the_gate_is_red_when_a_32_bit_elf_is_slipped_into_the_image(monkeypatch, capsys):
    clean = check.scan(image(ARM64_IMAGE))
    code, out, seen = _main(monkeypatch, capsys, clean)
    assert code == 0 and seen == {"image": "jht:arm64-check", "platform": "linux/arm64"}
    dirty = check.scan(image({**ARM64_IMAGE, "usr/bin/helper32": elf(32, ARM)}))
    code, out, _ = _main(monkeypatch, capsys, dirty)
    assert code == 1 and "FAIL [elf32]" in out and "/usr/bin/helper32" in out


def test_a_scan_that_read_no_elf_fails(monkeypatch, capsys):
    code, out, _ = _main(monkeypatch, capsys, check.scan(image({"etc/hostname": b"jht\n" * 10})))
    assert code == 1 and "FAIL [scan]" in out


def test_an_image_that_cannot_be_exported_fails(monkeypatch, capsys):
    code, out, _ = _main(monkeypatch, capsys, {"error": "No such image"})
    assert code == 1 and "FAIL [export]" in out


def test_docker_yml_reads_both_images_before_the_push():
    workflow = yaml.load((ROOT / ".github" / "workflows" / "docker.yml").read_text(), Loader=yaml.BaseLoader)
    steps = workflow["jobs"]["build-and-push"]["steps"]
    names = [step.get("name", "") for step in steps]
    runs = [step.get("run", "") for step in steps]
    amd64 = next(i for i, run in enumerate(runs) if "image_elf32.py jht:agent-shell-check" in run)
    arm64 = next(i for i, run in enumerate(runs) if "image_elf32.py jht:arm64-check --platform linux/arm64" in run)
    push = names.index("Build & push")
    assert amd64 < push and arm64 < push
    built = steps[names.index("Build the arm64 image for the 32-bit check (local)")]["with"]
    assert built["platforms"] == "linux/arm64" and built["load"] == "true" and built["push"] == "false"
