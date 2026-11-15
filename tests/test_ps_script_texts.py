"""tests/ps_script_texts.py makes, from the catalogs, PowerShell expressions of ASCII only that are the texts, letter by letter."""

from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from ps_script_texts import ps_quote
from script_texts import LANGUAGES, catalog

SAMPLES = ["plain", "it's", "''", "", "è", "Ölçü", "zażółć gęślą", "naïve « » — ő ű", "%s e' %d", "{0} $x `n \"q\"", "😀 ok"]


@pytest.mark.parametrize("text", SAMPLES)
def test_the_expression_is_ascii(text):
    assert ps_quote(text).isascii()


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="pwsh is not on this machine (it is on the Linux and Windows gates)")
def test_powershell_reads_back_every_text_of_the_catalogs_and_the_samples(tmp_path):
    texts = SAMPLES + sorted({value for lang in LANGUAGES for value in catalog(lang).values() if isinstance(value, str)})
    texts = [t for t in texts if "\n" not in t][:4000]
    script = "$out = @(\n" + ",\n".join(ps_quote(t) for t in texts) + "\n)\n[Console]::Out.Write((ConvertTo-Json -InputObject $out -Compress))\n"
    path = tmp_path / "texts.ps1"
    path.write_bytes(script.encode("ascii"))  # ASCII, no BOM: what Windows PowerShell 5.1 reads as it is
    done = subprocess.run(["pwsh", "-NoProfile", "-NonInteractive", "-File", str(path)], capture_output=True,
                          text=True, encoding="utf-8", timeout=120)
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout) == texts
