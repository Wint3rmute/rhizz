use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let diagnostics_dir = Path::new(&manifest_dir).join("../../SPEC/diagnostics");

    println!("cargo:rerun-if-changed={}", diagnostics_dir.display());

    let mut out_code = String::new();
    out_code.push_str("impl DiagnosticCode {\n");

    let mut entries = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&diagnostics_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension() {
                if ext != "md" {
                    continue;
                }
            } else {
                continue;
            }

            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let is_code = (stem.starts_with('E') || stem.starts_with('W'))
                    && stem.len() == 4
                    && stem[1..].chars().all(|c| c.is_ascii_digit());
                if is_code {
                    println!("cargo:rerun-if-changed={}", path.display());
                    entries.push((stem.to_string(), path.canonicalize().unwrap_or(path)));
                }
            }
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (code, path) in entries {
        let level = if code.starts_with('E') {
            "Level::Error"
        } else {
            "Level::Warning"
        };
        let path_str = path.to_str().expect("valid UTF-8 path");
        out_code.push_str(&format!(
            "    #[doc = include_str!(r#\"{}\"#)]\n    pub const {}: Self = Self {{\n        code: \"{}\",\n        level: {},\n    }};\n",
            path_str, code, code, level
        ));
    }

    out_code.push_str("}\n");

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
    let dest_path = Path::new(&out_dir).join("diagnostic_codes.rs");
    fs::write(dest_path, out_code).expect("failed to write generated diagnostic_codes.rs");
}
