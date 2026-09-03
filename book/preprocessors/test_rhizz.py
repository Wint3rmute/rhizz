"""Unit tests for the book.lock mechanics inside the rhizz mdbook preprocessor.

These test the pure functions (normalization, lock comparison, chapter
transformation) without mdbook or the rhizz binary.

Run from the repo root with:
    python3 -m unittest discover -s book/preprocessors -v
"""

import json
import os
import unittest

import rhizz  # same directory (unittest discover adds it to sys.path)


def sample_raw() -> dict:
    """A realistic raw `--json build` output (failing model)."""
    return {
        "errors": [
            {"code": "E011", "file": "/tmp/rhizz-book-ab12/system.hcl", "message": "connection 'greet' references undefined component 'sender' in 'from'"},
            {"code": "E011", "file": "/tmp/rhizz-book-ab12/system.hcl", "line": 12, "message": "connection 'greet' references undefined component 'receiver' in 'to'"},
        ],
        "warnings": [
            {"code": "W005", "file": "/tmp/rhizz-book-ab12/system.hcl", "message": "connection 'greet' has 'from' and 'to' pointing to the same component"},
        ],
    }


class NormalizeOutputTest(unittest.TestCase):
    def test_drops_file_and_sorts_diagnostics(self):
        out = rhizz.normalize_output(sample_raw())
        self.assertEqual(
            out,
            {
                "errors": [
                    # sorted by (code, line, message): a missing line sorts
                    # before a present one (None -> -1)
                    {"code": "E011", "message": "connection 'greet' references undefined component 'sender' in 'from'"},
                    {"code": "E011", "line": 12, "message": "connection 'greet' references undefined component 'receiver' in 'to'"},
                ],
                "warnings": [
                    {"code": "W005", "message": "connection 'greet' has 'from' and 'to' pointing to the same component"},
                ],
            },
        )
        # No path may leak into the lock, ever.
        self.assertNotIn("rhizz-book-", json.dumps(out))

    def test_sorts_reordered_warnings_identically(self):
        a = rhizz.normalize_output({"errors": [], "warnings": [{"code": "W002", "message": "x"}, {"code": "W001", "message": "y"}]})
        b = rhizz.normalize_output({"errors": [], "warnings": [{"code": "W001", "message": "y"}, {"code": "W002", "message": "x"}]})
        self.assertEqual(a, b)

    def test_score_passthrough_when_present(self):
        raw = {"errors": [], "warnings": [], "score": {"system": "ok", "overall": {"percent": 100.0}, "ports": {"complete": 4, "total": 4}}}
        out = rhizz.normalize_output(raw)
        self.assertEqual(out["score"]["overall"]["percent"], 100.0)
        self.assertEqual(out["score"]["ports"]["complete"], 4)

    def test_no_score_key_when_compilation_failed(self):
        out = rhizz.normalize_output(sample_raw())
        self.assertNotIn("score", out)

    def test_tool_error_is_none(self):
        self.assertIsNone(rhizz.normalize_output({"tool_error": "rhizz exploded"}))

    def test_omits_null_line(self):
        out = rhizz.normalize_output({"errors": [{"code": "E001", "file": "", "line": None, "message": "m"}], "warnings": []})
        self.assertEqual(out, {"errors": [{"code": "E001", "message": "m"}], "warnings": []})

    def test_is_deterministic_string(self):
        first = json.dumps(rhizz.normalize_output(sample_raw()), sort_keys=True)
        second = json.dumps(rhizz.normalize_output(sample_raw()), sort_keys=True)
        self.assertEqual(first, second)


class TransformChapterTest(unittest.TestCase):
    def test_records_only_compiled_blocks(self):
        raw_body = 'project {\n  name = "x"\n}\n'
        chapter = {
            "name": "X",
            "path": "x.md",
            "content": f"# X\n\n```rhizz\n{raw_body}```\n\n```rhizz,ignore\nignored\n```\n",
        }
        # The lock hashes the block body as the joined source lines (the
        # closing fence is never part of it) — same basis as the compiler sees.
        body = "project {\n  name = \"x\"\n}"
        results = {rhizz.body_hash(body): {"errors": [], "warnings": []}}
        _, blocks = rhizz.transform_chapter(chapter, results)

        self.assertEqual(len(blocks), 1)
        entry = blocks[("x.md", rhizz.body_hash(body))]
        self.assertEqual(entry["chapter"], "x.md")
        self.assertEqual(entry["hcl"], body)
        self.assertEqual(entry["output"], {"errors": [], "warnings": []})

    def test_changed_content_means_new_key(self):
        chapter = {"name": "X", "path": "x.md", "content": '# X\n\n```rhizz\nproject {}\n```\n'}
        results = {rhizz.body_hash("project {}"): {"errors": [], "warnings": []}}
        _, blocks = rhizz.transform_chapter(chapter, results)
        self.assertEqual(list(blocks)[0], ("x.md", rhizz.body_hash("project {}")))

    def test_output_none_when_tool_failed(self):
        chapter = {"name": "X", "path": "x.md", "content": '# X\n\n```rhizz\nproject {}\n```\n'}
        body = "project {}"
        results = {rhizz.body_hash(body): {"tool_error": "boom"}}
        _, blocks = rhizz.transform_chapter(chapter, results)
        self.assertIsNone(blocks[("x.md", rhizz.body_hash(body))]["output"])

    def test_falls_back_to_source_path(self):
        chapter = {"name": "Draft", "source_path": "draft.md", "content": '# X\n\n```rhizz\nproject {}\n```\n'}
        body = "project {}"
        results = {rhizz.body_hash(body): {"errors": [], "warnings": []}}
        _, blocks = rhizz.transform_chapter(chapter, results)
        self.assertEqual(list(blocks)[0], ("draft.md", rhizz.body_hash(body)))


class LockPayloadTest(unittest.TestCase):
    def test_entries_sorted_by_chapter_then_hash(self):
        entries = [
            {"chapter": "b.md", "input_sha256": "9" * 64, "hcl": "b", "output": {}},
            {"chapter": "a.md", "input_sha256": "8" * 64, "hcl": "a", "output": {}},
        ]
        payload = rhizz.lock_payload(entries, "rhizz 0.1.0")
        self.assertEqual([e["chapter"] for e in payload["entries"]], ["a.md", "b.md"])
        self.assertEqual(payload["format"], rhizz.LOCK_FORMAT)
        self.assertEqual(payload["rhizz_version"], "rhizz 0.1.0")

    def test_round_trip_is_identical(self):
        entry = {"chapter": "a.md", "input_sha256": "8" * 64, "hcl": "a", "output": {"errors": [], "warnings": []}}
        payload = rhizz.lock_payload([entry], "rhizz 0.1.0")
        text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True)
        again = json.loads(text)
        self.assertEqual(again, payload)


class CompareLockTest(unittest.TestCase):
    def make_blocks(self, entries):
        return {(e["chapter"], e["input_sha256"]): e for e in entries}

    def entry(self, chapter, sha64, output, hcl="x"):
        return {"chapter": chapter, "input_sha256": sha64, "hcl": hcl, "output": output}

    def test_matching_lock_has_no_diffs(self):
        blocks = self.make_blocks([self.entry("a.md", "1" * 64, {"errors": [], "warnings": []})])
        lock = rhizz.lock_payload(list(blocks.values()), "rhizz 0.1.0")
        diffs, notes = rhizz.compare_lock(lock, blocks, "rhizz 0.1.0")
        self.assertEqual(diffs, [])
        self.assertEqual(notes, [])

    def test_new_block_detected(self):
        blocks = self.make_blocks([self.entry("a.md", "1" * 64, {"errors": [], "warnings": []})])
        lock = rhizz.lock_payload([], "rhizz 0.1.0")
        diffs, _ = rhizz.compare_lock(lock, blocks, "rhizz 0.1.0")
        self.assertEqual(len(diffs), 1)
        self.assertIn("new block", diffs[0])
        self.assertIn("a.md", diffs[0])

    def test_removed_block_detected(self):
        blocks = {}
        lock = rhizz.lock_payload([self.entry("a.md", "1" * 64, {"errors": [], "warnings": []})], "rhizz 0.1.0")
        diffs, _ = rhizz.compare_lock(lock, blocks, "rhizz 0.1.0")
        self.assertEqual(len(diffs), 1)
        self.assertIn("removed", diffs[0])

    def test_changed_output_detected(self):
        blocks = self.make_blocks([self.entry("a.md", "1" * 64, {"errors": [{"code": "E001", "message": "new"}]})])
        lock = rhizz.lock_payload(
            [self.entry("a.md", "1" * 64, {"errors": [{"code": "E002", "message": "old"}]})],
            "rhizz 0.1.0",
        )
        diffs, _ = rhizz.compare_lock(lock, blocks, "rhizz 0.1.0")
        self.assertEqual(len(diffs), 1)
        self.assertIn("output changed", diffs[0])
        self.assertIn("E002", diffs[0])  # lock shows old
        self.assertIn("E001", diffs[0])  # now shows new

    def test_format_mismatch(self):
        blocks = self.make_blocks([self.entry("a.md", "1" * 64, {"errors": [], "warnings": []})])
        lock = rhizz.lock_payload(list(blocks.values()), "rhizz 0.1.0")
        lock["format"] = 99
        diffs, _ = rhizz.compare_lock(lock, blocks, "rhizz 0.1.0")
        self.assertEqual(len(diffs), 1)
        self.assertIn("format", diffs[0])

    def test_version_drift_is_a_note_not_a_diff(self):
        blocks = self.make_blocks([self.entry("a.md", "1" * 64, {"errors": [], "warnings": []})])
        lock = rhizz.lock_payload(list(blocks.values()), "rhizz 0.1.0")
        diffs, notes = rhizz.compare_lock(lock, blocks, "rhizz 0.2.0")
        self.assertEqual(diffs, [])
        self.assertEqual(len(notes), 1)
        self.assertIn("0.1.0", notes[0])


class AcceptFlagTest(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("BOOKLOCK_ACCEPT_CHANGES")

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("BOOKLOCK_ACCEPT_CHANGES", None)
        else:
            os.environ["BOOKLOCK_ACCEPT_CHANGES"] = self.saved

    def test_unset_means_verify(self):
        os.environ.pop("BOOKLOCK_ACCEPT_CHANGES", None)
        self.assertFalse(rhizz.accept_changes_enabled())

    def test_truthy_values(self):
        for value in ("1", "yes", "true", "Y"):
            os.environ["BOOKLOCK_ACCEPT_CHANGES"] = value
            self.assertTrue(rhizz.accept_changes_enabled())

    def test_falsey_values(self):
        for value in ("0", "false", "no", ""):
            os.environ["BOOKLOCK_ACCEPT_CHANGES"] = value
            self.assertFalse(rhizz.accept_changes_enabled())


class ParseAndHashTest(unittest.TestCase):
    def test_parse_block_attrs(self):
        self.assertEqual(rhizz.parse_block_attrs(",ignore"), {"ignore"})
        self.assertEqual(rhizz.parse_block_attrs("ignore"), {"ignore"})
        self.assertEqual(rhizz.parse_block_attrs(""), set())

    def test_parse_blocks_roundtrip(self):
        md = "# T\n\n```rhizz,ignore\nproject {}\n```\n\ntext\n"
        segments = rhizz.parse_blocks(md.splitlines())
        self.assertEqual(segments[0], ("text", ["# T", ""]))
        self.assertEqual(segments[1][0], "block")
        self.assertEqual(segments[1][1], {"ignore"})
        self.assertEqual(segments[1][2], ["project {}"])
        # splitlines() drops the final newline, so no trailing empty line.
        self.assertEqual(segments[2], ("text", ["", "text"]))

    def test_body_hash_is_deterministic(self):
        self.assertEqual(rhizz.body_hash("project {}"), rhizz.body_hash("project {}"))
        self.assertNotEqual(rhizz.body_hash("project {}"), rhizz.body_hash("project { }"))


if __name__ == "__main__":
    unittest.main()