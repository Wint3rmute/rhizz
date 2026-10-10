//! Criterion benchmarks for the `rhizz-core` compilation pipeline.
//!
//! Every embedded example project is compiled end-to-end (parse, merge,
//! resolve, validate) and, when it yields a model, scored. This is the
//! reference end-to-end benchmark for the core library: copy it as a template
//! when measuring new implementations or compilation options.
//!
//! Run with `just bench` (or `cargo bench -p rhizz-core`); Criterion writes
//! HTML reports to `target/criterion/`.

use std::hint::black_box;
use std::path::Path;

use criterion::{Criterion, criterion_group, criterion_main};
use rhizz_core::{ExampleProject, Source, compile, example_projects, is_docs_source, score};

/// Builds owned [`Source`] values for an embedded example project.
///
/// Mirrors the CLI's loader: only `.hcl` files and Markdown under `docs/` are
/// sources (so a project-root `README.md` is ignored, not parsed as HCL).
/// Allocation and sorting happen once, outside the measured loop, so the
/// benchmark measures compilation rather than string copying.
fn sources_for(project: &ExampleProject) -> Vec<Source> {
    let mut sources: Vec<Source> = project
        .files
        .iter()
        .filter(|file| {
            Path::new(file.path)
                .extension()
                .is_some_and(|ext| ext == "hcl")
                || is_docs_source(file.path)
        })
        .map(|file| Source {
            filename: file.path.to_string(),
            content: file.content.to_string(),
        })
        .collect();
    sources.sort_by(|left, right| left.filename.cmp(&right.filename));
    sources
}

fn bench_compile(c: &mut Criterion) {
    let mut group = c.benchmark_group("compile");
    for project in example_projects() {
        let sources = sources_for(project);
        group.bench_function(project.id, |b| {
            b.iter(|| black_box(compile(black_box(&sources))));
        });
    }
    group.finish();
}

fn bench_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("score");
    for project in example_projects() {
        // Scoring is a separate, read-only pass over the resolved model, so it
        // only makes sense when the project compiles cleanly.
        let sources = sources_for(project);
        if let Some(model) = compile(&sources).model {
            group.bench_function(project.id, |b| {
                b.iter(|| black_box(score(black_box(&model))));
            });
        }
    }
    group.finish();
}

criterion_group!(benches, bench_compile, bench_score);
criterion_main!(benches);
