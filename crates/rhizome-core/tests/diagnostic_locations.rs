//! Every model diagnostic points at the block it is about: `file` is the
//! source file and `line` the line of that block's identifier.
//!
//! One case per diagnostic code. Sources start on line 1 (no leading
//! newline), so the line numbers in the assertions can be read off the
//! source text directly.

use rhizome_core::{Diagnostic, Source, compile};
use std::path::Path;

const FILE: &str = "system.hcl";

fn diagnostics(src: &str) -> Vec<Diagnostic> {
    compile(&[Source {
        filename: FILE.to_owned(),
        content: src.to_owned(),
    }])
    .diagnostics
}

/// Line of the `code` diagnostic whose message contains `needle`. Panics when
/// there is none, or when it does not name [`FILE`].
fn line_of(src: &str, code: &str, needle: &str) -> Option<u32> {
    let all = diagnostics(src);
    let found = all
        .iter()
        .find(|d| d.code.code == code && d.message.contains(needle));
    assert!(
        found.is_some(),
        "no {code} mentioning {needle:?} in {all:#?}"
    );
    let found = found?;
    assert_eq!(found.file.as_deref(), Some(Path::new(FILE)), "{found:?}");
    found.line
}

// ── Parse errors ─────────────────────────────────────────────────────────────

#[test]
fn e000_syntax_error_points_at_its_line() {
    let src = r#"component "a" {
  full_name = "A"
}
component "b" {
  full_name = = "B"
}"#;
    assert_eq!(line_of(src, "E000", "HCL parse error"), Some(5));
}

#[test]
fn e000_unknown_attribute_points_at_the_innermost_block() {
    let src = r#"component "a" {
  full_name = "A"
  port "p" {
    descripton = "typo"
  }
}"#;
    assert_eq!(line_of(src, "E000", "descripton"), Some(3));
}

#[test]
fn e000_unknown_top_level_block_points_at_it() {
    let src = r#"component "a" {}
widget "w" {}"#;
    assert_eq!(line_of(src, "E000", "widget"), Some(2));
}

#[test]
fn e010_duplicate_project_points_at_the_second_block() {
    let src = r#"project { name = "a" }

project { name = "b" }"#;
    assert_eq!(line_of(src, "E010", "duplicate project"), Some(3));
}

#[test]
fn e010_project_in_two_files_points_at_the_second_block() {
    let result = compile(&[
        Source {
            filename: "a.hcl".to_owned(),
            content: "project { name = \"a\" }".to_owned(),
        },
        Source {
            filename: "b.hcl".to_owned(),
            content: "\nproject { name = \"b\" }".to_owned(),
        },
    ]);
    let e010 = result
        .diagnostics
        .iter()
        .find(|d| d.code.code == "E010")
        .expect("E010");
    assert_eq!(e010.file.as_deref(), Some(Path::new("b.hcl")));
    assert_eq!(e010.line, Some(2));
}

#[test]
fn e012_instance_with_extra_attribute_points_at_the_instance() {
    let src = r#"component "c" { leaf = true }
system "s" {
  instance "i" {
    source    = "c"
    full_name = "extra"
  }
}"#;
    assert_eq!(line_of(src, "E012", "instance"), Some(3));
}

#[test]
fn w015_points_at_the_unexpected_block() {
    let src = r#"system "s" {
  full_name = "S"
  component "inline" {}
}"#;
    assert_eq!(line_of(src, "W015", "component"), Some(3));
}

// ── Resolution errors ────────────────────────────────────────────────────────

#[test]
fn e001_duplicate_definition_points_at_the_second_block() {
    let src = r#"component "a" { leaf = true }
component "a" { leaf = true }"#;
    assert_eq!(line_of(src, "E001", "component label `a`"), Some(2));
}

#[test]
fn e001_duplicate_port_points_at_the_second_port() {
    let src = r#"component "a" {
  leaf = true
  port "p" {}
  port "p" {}
}"#;
    assert_eq!(line_of(src, "E001", "port label `p`"), Some(4));
}

#[test]
fn e001_duplicate_connection_across_declarations_points_at_one_of_them() {
    // `link` is declared in the system and inside the `box` definition.
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
component "box" {
  instance "x" { source = "dev" }
  instance "y" { source = "dev" }
  connection "link" {
    from = "x/io"
    to   = "y/io"
  }
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "box" }
  instance "c" { source = "dev" }
  connection "link" {
    from = "a/io"
    to   = "c/io"
  }
}"#;
    // Declarations are listed sorted (`component:box` before `system:s`);
    // the error points at the last one.
    assert_eq!(line_of(src, "E001", "connection label `link`"), Some(17));
}

#[test]
fn e002_missing_endpoint_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  connection "half" {
    from = "a/io"
  }
}"#;
    assert_eq!(line_of(src, "E002", "missing required 'to'"), Some(7));
}

#[test]
fn e003_bare_component_endpoint_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "bare" {
    from = "a/io"
    to   = "b"
  }
}"#;
    assert_eq!(line_of(src, "E003", "requires a port path"), Some(8));
}

#[test]
fn e004_label_with_slash_points_at_the_block() {
    let src = r#"component "ok" { leaf = true }
component "a/b" { leaf = true }"#;
    assert_eq!(line_of(src, "E004", "must not contain"), Some(2));
}

#[test]
fn e005_leaf_with_children_points_at_the_component() {
    let src = r#"component "chip" { leaf = true }
component "board" {
  leaf = true
  instance "c" { source = "chip" }
}"#;
    assert_eq!(line_of(src, "E005", "`board`"), Some(2));
}

#[test]
fn e007_field_without_type_points_at_the_field() {
    let src = r#"protocol "p" {
  message "m" {
    field "ok" { type = "u8" }
    field "untyped" {}
  }
}"#;
    assert_eq!(line_of(src, "E007", "`untyped`"), Some(4));
}

#[test]
fn e009_role_not_permitted_points_at_the_port() {
    let src = r#"protocol "spi" {
  roles = ["provider", "consumer"]
}
component "chip" {
  leaf = true
  port "bus" {
    protocol = "spi"
    role     = "peer"
  }
}"#;
    assert_eq!(line_of(src, "E009", "`bus`"), Some(6));
}

#[test]
fn e010_unknown_port_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "typo" {
    from = "a/io"
    to   = "b/oi"
  }
}"#;
    assert_eq!(line_of(src, "E010", "has no port `oi`"), Some(8));
}

#[test]
fn e011_undefined_nested_component_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  connection "deep" {
    from = "a/io"
    to   = "nope/sub/io"
  }
}"#;
    assert_eq!(line_of(src, "E011", "`nope`"), Some(7));
}

#[test]
fn e014_undefined_source_points_at_the_instance() {
    let src = r#"system "s" {
  full_name = "S"
  instance "ghost" { source = "missing" }
}"#;
    assert_eq!(line_of(src, "E014", "`missing`"), Some(3));
}

#[test]
fn e015_connection_outside_common_ancestor_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
component "outer" {
  connection "escape" {
    from = "../a/io"
    to   = "../b/io"
  }
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  instance "o" { source = "outer" }
}"#;
    assert_eq!(line_of(src, "E015", "`escape`"), Some(6));
}

#[test]
fn e017_unresolved_realized_by_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "talk" {
    from        = "a/io"
    to          = "b/io"
    realized_by = ["nothing"]
  }
}"#;
    assert_eq!(line_of(src, "E017", "`nothing`"), Some(8));
}

#[test]
fn e018_realization_cycle_points_at_the_connection_closing_it() {
    let src = r#"component "dev" {
  leaf = true
  port "io" {}
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "one" {
    from        = "a/io"
    to          = "b/io"
    realized_by = ["two"]
  }
  connection "two" {
    from        = "a/io"
    to          = "b/io"
    realized_by = ["one"]
  }
}"#;
    assert_eq!(line_of(src, "E018", "circular realization"), Some(13));
}

#[test]
fn e019_realized_leaf_protocol_points_at_the_connection() {
    let src = r#"protocol "wire" {
  leaf = true
}
component "dev" {
  leaf = true
  port "io" { protocol = "wire" }
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "low" {
    from = "a/io"
    to   = "b/io"
  }
  connection "high" {
    from        = "a/io"
    to          = "b/io"
    realized_by = ["low"]
  }
}"#;
    assert_eq!(line_of(src, "E019", "is a leaf"), Some(15));
}

#[test]
fn e020_encapsulation_cycle_points_at_the_protocol_closing_it() {
    let src = r#"protocol "p" {
  encapsulates = ["q"]
}
protocol "q" {
  encapsulates = ["p"]
}"#;
    assert_eq!(line_of(src, "E020", "circular"), Some(4));
}

#[test]
fn e022_proxy_port_without_external_points_at_the_port() {
    let src = r#"component "chip" {
  leaf = true
  port "io" {}
}
component "box" {
  port "out" {}
  instance "c" { source = "chip" }
  connection "down" {
    from = "./out"
    to   = "c/io"
  }
}"#;
    assert_eq!(line_of(src, "E022", "external = true"), Some(6));
}

// ── Warnings ─────────────────────────────────────────────────────────────────

#[test]
fn w001_points_at_the_definition() {
    let src = r#"component "box" {
  full_name = "Box"
}"#;
    assert_eq!(line_of(src, "W001", "`box`"), Some(1));
}

#[test]
fn protocol_warnings_point_at_their_blocks() {
    let src = r#"protocol "p" {
  full_name = "P"
  message "m" {
    full_name = "M"
  }
}
protocol "q" {
  full_name = "Q"
  encapsulates = ["ghost"]
}
protocol "r" {
  message "n" {
    field "f" { type = "u8" }
  }
}"#;
    assert_eq!(line_of(src, "W002", "`m`"), Some(3), "W002");
    assert_eq!(line_of(src, "W004", "message `n`"), Some(12), "W004");
    assert_eq!(line_of(src, "W011", "`q`"), Some(7), "W011");
    assert_eq!(line_of(src, "W012", "`p`"), Some(1), "W012");
    assert_eq!(line_of(src, "W022", "`ghost`"), Some(7), "W022");
}

#[test]
fn placement_warnings_point_at_instances_ports_and_connections() {
    let src = r#"component "dev" {
  full_name = "Device"
  leaf      = true
  port "io" {}
  port "spare" {}
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  instance "c" { source = "dev" }
  connection "link" {
    from = "a/io"
    to   = "b/io"
  }
}"#;
    // W003 names the placed instance, so it points at the `instance` block.
    assert_eq!(line_of(src, "W003", "`c`"), Some(10), "W003");
    // A port is declared once, in its definition, for every instance.
    assert_eq!(line_of(src, "W010", "`spare`"), Some(5), "W010");
    assert_eq!(line_of(src, "W004", "system `s`"), Some(7), "W004 system");
    assert_eq!(line_of(src, "W004", "connection `link`"), Some(11), "W004");
    assert_eq!(line_of(src, "W018", "`dev`"), Some(1), "W018");
    assert_eq!(line_of(src, "W019", "`link`"), Some(11), "W019");
}

#[test]
fn w004_component_points_at_the_definition() {
    let src = r#"component "plain" {
  leaf = true
}"#;
    assert_eq!(line_of(src, "W004", "component `plain`"), Some(1));
}

#[test]
fn w005_same_component_points_at_the_connection() {
    let src = r#"component "dev" {
  leaf = true
  port "a" {}
  port "b" {}
}
system "s" {
  instance "x" { source = "dev" }
  connection "loop" {
    from = "x/a"
    to   = "x/b"
  }
}"#;
    assert_eq!(line_of(src, "W005", "`loop`"), Some(8));
}

#[test]
fn w006_lower_level_points_at_the_instance() {
    let src = r#"component "inner" {
  leaf  = true
  level = 1
}
component "outer" {
  level = 3
  instance "in" { source = "inner" }
}"#;
    assert_eq!(line_of(src, "W006", "component `in`"), Some(7));
}

#[test]
fn port_protocol_warnings_point_at_ports_and_connections() {
    let src = r#"component "dev" {
  leaf = true
  port "tx" { protocol = "uart" }
  port "rx" { protocol = "spi" }
}
system "s" {
  instance "a" { source = "dev" }
  instance "b" { source = "dev" }
  connection "mixed" {
    from = "a/tx"
    to   = "b/rx"
  }
}"#;
    assert_eq!(line_of(src, "W008", "`mixed`"), Some(9), "W008");
    assert_eq!(line_of(src, "W014", "`uart`"), Some(3), "W014");
}

#[test]
fn realization_warnings_point_at_their_subject() {
    let src = r#"protocol "app" {}
protocol "net" {}
component "node" {
  leaf = true
  port "a" { protocol = "app" }
  port "n" { protocol = "net" }
}
system "s" {
  instance "x" { source = "node" }
  instance "y" { source = "node" }
  instance "z" { source = "node" }
  connection "talk" {
    from        = "x/a"
    to          = "y/a"
    realized_by = ["wire"]
  }
  connection "wire" {
    from = "x/n"
    to   = "z/n"
  }
}"#;
    // W020: `wire` realizes `talk` but ends outside it.
    assert_eq!(line_of(src, "W020", "`wire` realizes"), Some(17), "W020");
    // W021: `talk` is realized by a protocol that does not carry it.
    assert_eq!(line_of(src, "W021", "`talk`"), Some(12), "W021");
}
