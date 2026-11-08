"""Real acquisition stays fresh when pure lexical transformations are reused.

All Rust trees are synthetic. No compiler, subprocess or product imports.
These tests exercise public readers, not cache bookkeeping.
"""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from rust_source_graph import RustTree
from rust_source_guard import production_files, symbol_source


class RustAcquisitionFreshness(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rust-acquisition-fresh-")
        self.root = Path(self.temporary.name)
        self.write("lib.rs", "mod engine;\n")
        self.original = 'const VALUE: &str = "alpha";\n'
        self.write("engine.rs", self.original)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, relative, source):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(source.encode("utf8"))
        return path

    def value(self, root=None, **options):
        return symbol_source("engine.rs", "const VALUE:",
                             root=self.root if root is None else root, **options)

    def rewrite_preserving_size_and_mtime(self, path, source):
        before = path.stat()
        self.assertEqual(len(source.encode("utf8")), before.st_size)
        path.write_bytes(source.encode("utf8"))
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)

    def test_same_file_same_size_and_mtime_returns_the_new_source(self):
        self.assertEqual(self.value(), self.original.rstrip("\n"))
        changed = self.original.replace("alpha", "bravo")
        self.rewrite_preserving_size_and_mtime(self.root / "engine.rs", changed)
        self.assertEqual(self.value(), changed.rstrip("\n"))

    def test_a_previously_read_file_can_disappear_and_be_restored(self):
        self.assertIn('"alpha"', self.value())
        (self.root / "engine.rs").unlink()
        with self.assertRaisesRegex(AssertionError, "missing or ambiguous Rust module"):
            self.value()
        self.write("engine.rs", self.original.replace("alpha", "bravo"))
        self.assertIn('"bravo"', self.value())

    def test_the_requested_library_entry_is_rechecked_after_a_success(self):
        self.assertIn('"alpha"', RustTree(self.root).source("lib.rs"))
        (self.root / "lib.rs").unlink()
        # The physical child remains; it cannot stand in for this lib.rs query.
        with self.assertRaisesRegex(AssertionError, "missing Rust entry"):
            RustTree(self.root).source("lib.rs")
        self.write("lib.rs", "mod engine;\n")
        self.assertIn('"alpha"', RustTree(self.root).source("lib.rs"))

    def test_membership_changes_even_when_the_old_file_and_metadata_remain(self):
        self.write("first.rs", self.original)
        self.write("other.rs", self.original.replace("alpha", "bravo"))
        library = self.write("lib.rs", "mod first;\n")
        self.assertEqual([record.relative for record in production_files("lib.rs", root=self.root)],
                         ["lib.rs", "first.rs"])
        self.rewrite_preserving_size_and_mtime(library, "mod other;\n")
        self.assertEqual([record.relative for record in production_files("lib.rs", root=self.root)],
                         ["lib.rs", "other.rs"])
        self.assertIn('"bravo"', symbol_source("lib.rs", "const VALUE:", root=self.root))

    def test_two_live_aliases_do_not_collapse_one_physical_declaration(self):
        self.assertIn('"alpha"', self.value())
        self.write("lib.rs", '#[path = "engine.rs"]\nmod first;\n'
                             '#[path = "engine.rs"]\nmod other;\n')
        with self.assertRaisesRegex(AssertionError, "matched 2 times"):
            symbol_source("lib.rs", "const VALUE:", root=self.root)
        self.write("lib.rs", "mod engine;\n")
        self.assertIn('"alpha"', self.value())

    def test_duplicate_declarations_fail_then_repair_without_a_stale_error(self):
        self.assertIn('"alpha"', self.value())
        self.write("engine.rs", self.original + self.original)
        with self.assertRaisesRegex(AssertionError, "matched 2 times"):
            self.value()
        self.write("engine.rs", self.original)
        self.assertEqual(self.value(), self.original.rstrip("\n"))

    def test_identical_entry_names_in_distinct_roots_select_their_own_content(self):
        other = self.root / "separate"
        other.mkdir()
        (other / "lib.rs").write_text("mod engine;\n", encoding="utf8")
        (other / "engine.rs").write_text(self.original.replace("alpha", "bravo"), encoding="utf8")
        self.assertIn('"alpha"', self.value())
        self.assertIn('"bravo"', self.value(other))
        self.assertIn('"alpha"', self.value())

    def test_bom_crlf_raw_literals_and_test_items_keep_their_original_semantics(self):
        declaration = 'const VALUE: &str = r#"alpha\r\nmod absent_in_literal;"#;'
        source = ('\ufeff/* outer /* mod absent_in_comment; */ */\r\n' + declaration +
                  '\r\n#[cfg(test)]\r\nmod absent_test_module;\r\n')
        path = self.write("engine.rs", source)
        self.assertEqual(self.value(preserve_newlines=True), declaration)
        self.assertNotIn("absent_test_module", RustTree(self.root).source("engine.rs"))
        changed = source.replace("alpha", "bravo")
        self.rewrite_preserving_size_and_mtime(path, changed)
        self.assertEqual(self.value(preserve_newlines=True), declaration.replace("alpha", "bravo"))

    def test_a_truncated_input_remains_an_error_until_the_file_is_repaired(self):
        self.assertIn('"alpha"', self.value())
        self.write("engine.rs", 'const VALUE: &str = r#"truncated')
        for _ in range(2):
            with self.assertRaisesRegex(AssertionError, "Unclosed Rust raw string"):
                self.value()
        self.write("engine.rs", self.original)
        self.assertIn('"alpha"', self.value())


if __name__ == "__main__":
    unittest.main()
