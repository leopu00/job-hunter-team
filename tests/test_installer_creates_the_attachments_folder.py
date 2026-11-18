"""The welcome tells the person to put the CV in ~/Documents/Job Hunter Team/allegati: the installer makes that folder
(Linux build11 round: the folder was not there after the installer)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_branch_of_the_ownership_alignment_makes_the_attachments_folder():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    body = text.split("align_bind_ownership() {", 1)[1].split("\n}\n", 1)[0]
    assert len(re.findall(r'mkdir -p "\$jht_user_dir/allegati"', body)) == 3
    assert 'mkdir -p "$jht_user_dir" ' not in body, "a branch that makes only the parent leaves the folder out"


def test_the_public_copy_follows():
    assert (ROOT / "scripts" / "install.sh").read_bytes() == (ROOT / "web" / "public" / "install.sh").read_bytes()
