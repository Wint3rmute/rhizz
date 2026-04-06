//! `rhizz-wasm` — WebAssembly bindings for `rhizz-core`.

#![deny(clippy::all)]

use wasm_bindgen::prelude::*;

// ── DiagnosticJS ──────────────────────────────────────────────────────────────

/// A single diagnostic (error or warning) exposed to JavaScript.
#[derive(Clone)]
#[wasm_bindgen]
pub struct DiagnosticJS {
    code: String,
    message: String,
    level: String,
}

#[wasm_bindgen]
impl DiagnosticJS {
    /// Short code string, e.g. `"E001"` or `"W003"`.
    #[wasm_bindgen(getter)]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    /// Human-readable diagnostic message.
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.message.clone()
    }

    /// Severity level as a string (`"Error"`, `"Warning"`, `"Note"`, `"Help"`).
    #[wasm_bindgen(getter)]
    pub fn level(&self) -> String {
        self.level.clone()
    }
}

impl From<&rhizz_core::Diagnostic> for DiagnosticJS {
    fn from(d: &rhizz_core::Diagnostic) -> Self {
        Self {
            code: d.code.code.to_string(),
            message: d.message.clone(),
            level: format!("{:?}", d.code.level),
        }
    }
}

// ── CategoryScoreJS ───────────────────────────────────────────────────────────

/// Aggregated scoring statistics for one category.
#[derive(Clone)]
#[wasm_bindgen]
pub struct CategoryScoreJS {
    complete: usize,
    partial: usize,
    incomplete: usize,
    percentage: f64,
}

#[wasm_bindgen]
impl CategoryScoreJS {
    /// Number of entities that scored 1.0 ("fully complete").
    #[wasm_bindgen(getter)]
    pub fn complete(&self) -> usize {
        self.complete
    }

    /// Number of entities that scored 0.5 ("partial").
    #[wasm_bindgen(getter)]
    pub fn partial(&self) -> usize {
        self.partial
    }

    /// Number of entities that scored 0.0 ("incomplete").
    #[wasm_bindgen(getter)]
    pub fn incomplete(&self) -> usize {
        self.incomplete
    }

    /// Aggregate percentage (0–100).
    #[wasm_bindgen(getter)]
    pub fn percentage(&self) -> f64 {
        self.percentage
    }
}

impl From<&rhizz_core::CategoryScore> for CategoryScoreJS {
    fn from(c: &rhizz_core::CategoryScore) -> Self {
        Self {
            complete: c.complete,
            partial: c.partial,
            incomplete: c.incomplete,
            percentage: c.percentage(),
        }
    }
}

// ── ScoreReportJS ─────────────────────────────────────────────────────────────

/// Full completion report for the model.
#[derive(Clone)]
#[wasm_bindgen]
pub struct ScoreReportJS {
    project_name: String,
    overall_percentage: f64,
    components: CategoryScoreJS,
    ports: CategoryScoreJS,
    connections: CategoryScoreJS,
    messages: CategoryScoreJS,
}

#[wasm_bindgen]
impl ScoreReportJS {
    /// Project name.
    #[wasm_bindgen(getter)]
    pub fn project_name(&self) -> String {
        self.project_name.clone()
    }

    /// Overall aggregate percentage (0–100).
    #[wasm_bindgen(getter)]
    pub fn overall_percentage(&self) -> f64 {
        self.overall_percentage
    }

    /// Component scoring breakdown.
    #[wasm_bindgen(getter)]
    pub fn components(&self) -> CategoryScoreJS {
        self.components.clone()
    }

    /// Port scoring breakdown.
    #[wasm_bindgen(getter)]
    pub fn ports(&self) -> CategoryScoreJS {
        self.ports.clone()
    }

    /// Connection scoring breakdown.
    #[wasm_bindgen(getter)]
    pub fn connections(&self) -> CategoryScoreJS {
        self.connections.clone()
    }

    /// Message scoring breakdown.
    #[wasm_bindgen(getter)]
    pub fn messages(&self) -> CategoryScoreJS {
        self.messages.clone()
    }
}

impl From<&rhizz_core::ScoreReport> for ScoreReportJS {
    fn from(r: &rhizz_core::ScoreReport) -> Self {
        Self {
            project_name: r.project_name.clone(),
            overall_percentage: r.overall_percentage(),
            components: CategoryScoreJS::from(&r.components),
            ports: CategoryScoreJS::from(&r.ports),
            connections: CategoryScoreJS::from(&r.connections),
            messages: CategoryScoreJS::from(&r.messages),
        }
    }
}

// ── ProjectJS ─────────────────────────────────────────────────────────────────

/// Project-level metadata.
#[derive(Clone)]
#[wasm_bindgen]
pub struct ProjectJS {
    name: String,
    version: String,
    authors: Vec<String>,
}

#[wasm_bindgen]
impl ProjectJS {
    /// Human-readable project name.
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    /// Semantic version string.
    #[wasm_bindgen(getter)]
    pub fn version(&self) -> String {
        self.version.clone()
    }

    /// List of author strings.
    #[wasm_bindgen(getter)]
    pub fn authors(&self) -> Vec<String> {
        self.authors.clone()
    }
}

impl From<&rhizz_core::Project> for ProjectJS {
    fn from(p: &rhizz_core::Project) -> Self {
        Self {
            name: p.name.clone(),
            version: p.version.clone(),
            authors: p.authors.clone(),
        }
    }
}

// ── ComponentJS ───────────────────────────────────────────────────────────────

/// A resolved component exposed to JavaScript.
#[derive(Clone)]
#[wasm_bindgen]
pub struct ComponentJS {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    leaf: bool,
}

#[wasm_bindgen]
impl ComponentJS {
    /// Unique label within its parent scope.
    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    /// Human-readable description.
    #[wasm_bindgen(getter)]
    pub fn description(&self) -> String {
        self.description.clone()
    }

    /// Filtering tags.
    #[wasm_bindgen(getter)]
    pub fn tags(&self) -> Vec<String> {
        self.tags.clone()
    }

    /// Abstraction level.
    #[wasm_bindgen(getter)]
    pub fn level(&self) -> i32 {
        self.level
    }

    /// Whether the component is atomic (no further decomposition).
    #[wasm_bindgen(getter)]
    pub fn leaf(&self) -> bool {
        self.leaf
    }
}

impl From<&rhizz_core::Component> for ComponentJS {
    fn from(c: &rhizz_core::Component) -> Self {
        Self {
            label: c.label.clone(),
            description: c.description.clone(),
            tags: c.tags.clone(),
            level: c.level,
            leaf: c.leaf,
        }
    }
}

// ── CompileResultJS ───────────────────────────────────────────────────────────

/// A compiled result exposed as a JS class with callable Rust methods.
///
/// Construct with [`CompileResultJS::compile`], then query the model via the
/// typed accessor methods directly from JavaScript.
///
/// ```js
/// const result = CompileResultJS.compile(sources);
/// if (result.has_model()) {
///     const comps = result.components();
///     const score = result.score();
/// }
/// const diags = result.diagnostics();
/// ```
#[wasm_bindgen]
pub struct CompileResultJS {
    inner: rhizz_core::CompileResult,
}

#[wasm_bindgen]
impl CompileResultJS {
    /// Compile one or more HCL sources and return a [`CompileResultJS`].
    ///
    /// # Arguments
    /// * `sources` – a JS array of `{ filename: string, content: string }` objects.
    ///
    /// # Errors
    /// Returns a [`JsError`] if `sources` cannot be deserialised.
    pub fn compile(sources: JsValue) -> Result<CompileResultJS, JsError> {
        let sources: Vec<rhizz_core::Source> =
            serde_wasm_bindgen::from_value(sources).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(CompileResultJS {
            inner: rhizz_core::compile(&sources),
        })
    }

    /// Returns `true` if compilation produced a model (i.e. no hard errors).
    pub fn has_model(&self) -> bool {
        self.inner.model.is_some()
    }

    /// Returns all diagnostics (errors and warnings) as typed wrappers.
    pub fn diagnostics(&self) -> Vec<DiagnosticJS> {
        self.inner
            .diagnostics
            .iter()
            .map(DiagnosticJS::from)
            .collect()
    }

    /// Returns the number of error-level diagnostics.
    pub fn error_count(&self) -> usize {
        self.inner
            .diagnostics
            .iter()
            .filter(|d| d.is_error())
            .count()
    }

    /// Returns the number of warning-level diagnostics.
    pub fn warning_count(&self) -> usize {
        self.inner
            .diagnostics
            .iter()
            .filter(|d| !d.is_error())
            .count()
    }

    /// Returns all components as typed wrappers, or an empty vec when there is no model.
    pub fn components(&self) -> Vec<ComponentJS> {
        match &self.inner.model {
            Some(model) => model.components.iter().map(ComponentJS::from).collect(),
            None => vec![],
        }
    }

    /// Computes and returns the completion score, or `None` when there is no model.
    pub fn score(&self) -> Option<ScoreReportJS> {
        self.inner
            .model
            .as_ref()
            .map(|model| ScoreReportJS::from(&rhizz_core::score(model)))
    }

    /// Returns the project metadata, or `None` when there is no model.
    pub fn project(&self) -> Option<ProjectJS> {
        self.inner
            .model
            .as_ref()
            .map(|model| ProjectJS::from(&model.project))
    }
}
