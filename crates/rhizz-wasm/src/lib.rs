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

// ── ConnectionJS ───────────────────────────────────────────────────────────────

/// A connection exposed to JavaScript.
#[derive(Clone)]
#[wasm_bindgen]
pub struct ConnectionJS {
    label: String,
    // description: String,
    // tags: Vec<String>,
    level: i32,
    pub from: usize,
    pub to: usize
}

impl From<&rhizz_core::Connection> for ConnectionJS {
    fn from(c: &rhizz_core::Connection) -> Self {
        Self {
            label: c.label.clone(),
            level: c.level,
            from: c.from.component.0,
            to: c.to.component.0
        }
    }
}

#[wasm_bindgen]
impl ConnectionJS {
    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        return self.label.clone();
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
    /// Set when the parent is another component; `None` when the parent is a system.
    parent_component_index: Option<usize>,
    /// Set when the parent is a top-level system; `None` when the parent is a component.
    parent_system_index: Option<usize>,
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

    /// Arena index into `model.components()` for the parent component, or `undefined` if the parent is a system.
    #[wasm_bindgen(getter)]
    pub fn parent_component_index(&self) -> Option<usize> {
        self.parent_component_index
    }

    /// Arena index into `model.systems()` for the parent system, or `undefined` if the parent is a component.
    #[wasm_bindgen(getter)]
    pub fn parent_system_index(&self) -> Option<usize> {
        self.parent_system_index
    }
}

impl From<&rhizz_core::Component> for ComponentJS {
    fn from(c: &rhizz_core::Component) -> Self {
        let (parent_component_index, parent_system_index) = match c.parent {
            rhizz_core::ComponentParent::Component(id) => (Some(id.0), None),
            rhizz_core::ComponentParent::System(id) => (None, Some(id.0)),
        };
        Self {
            label: c.label.clone(),
            description: c.description.clone(),
            tags: c.tags.clone(),
            level: c.level,
            leaf: c.leaf,
            parent_component_index,
            parent_system_index,
        }
    }
}

// ── ModelJS ───────────────────────────────────────────────────────────────────

/// The fully-resolved model, returned by [`CompileResultJS::model`].
///
/// Only available when compilation succeeded (no hard errors).
#[wasm_bindgen]
pub struct ModelJS {
    inner: rhizz_core::Model,
}

#[wasm_bindgen]
impl ModelJS {
    /// Returns the project metadata.
    pub fn project(&self) -> ProjectJS {
        ProjectJS::from(&self.inner.project)
    }

    /// Returns all components as typed wrappers.
    pub fn components(&self) -> Vec<ComponentJS> {
        self.inner
            .components
            .iter()
            .map(ComponentJS::from)
            .collect()
    }

    /// Returns all connections as typed wrappers.
    pub fn connections(&self) -> Vec<ConnectionJS> {
        self.inner
            .connections
            .iter()
            .map(ConnectionJS::from)
            .collect()
    }


    /// Returns the component with the given label, or `undefined` if not found.
    pub fn component_by_name(&self, name: &str) -> Option<ComponentJS> {
        self.inner
            .components
            .iter()
            .find(|c| c.label == name)
            .map(ComponentJS::from)
    }

    /// Returns the component with the given id, or `undefined` if not found.
    pub fn component_by_id(&self, id: usize) -> Option<ComponentJS> {
        self.inner.components.get(id).map(ComponentJS::from)
    }

    /// Computes and returns the completion score report.
    pub fn score(&self) -> ScoreReportJS {
        ScoreReportJS::from(&rhizz_core::score(&self.inner))
    }
}

// ── CompileResultJS ───────────────────────────────────────────────────────────

/// A compiled result exposed as a JS class with callable Rust methods.
///
/// Construct with [`CompileResultJS::compile`], then inspect diagnostics and
/// optionally access the model via [`CompileResultJS::model`].
///
/// ```js
/// const result = CompileResultJS.compile(sources);
/// const diags = result.diagnostics();
/// const model = result.model();   // ModelJS | undefined
/// if (model) {
///     const comps = model.components();
///     const score = model.score();
/// }
/// ```
#[wasm_bindgen]
pub struct CompileResultJS {
    diagnostics: Vec<rhizz_core::Diagnostic>,
    model: Option<rhizz_core::Model>,
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
        let result = rhizz_core::compile(&sources);
        Ok(CompileResultJS {
            diagnostics: result.diagnostics,
            model: result.model,
        })
    }

    /// Returns all diagnostics (errors and warnings) as typed wrappers.
    pub fn diagnostics(&self) -> Vec<DiagnosticJS> {
        self.diagnostics.iter().map(DiagnosticJS::from).collect()
    }

    /// Returns the number of error-level diagnostics.
    pub fn error_count(&self) -> usize {
        self.diagnostics.iter().filter(|d| d.is_error()).count()
    }

    /// Returns the number of warning-level diagnostics.
    pub fn warning_count(&self) -> usize {
        self.diagnostics.iter().filter(|d| !d.is_error()).count()
    }

    /// Returns the resolved model, or `undefined` if there were hard errors.
    ///
    /// Clones the model on each call; cache the result in JS if calling repeatedly.
    pub fn model(&self) -> Option<ModelJS> {
        self.model.as_ref().map(|m| ModelJS { inner: m.clone() })
    }
}
