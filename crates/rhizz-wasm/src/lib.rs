//! `rhizz-wasm` — WebAssembly bindings for `rhizz-core`.

#![deny(clippy::all)]

use serde::{Deserialize, Serialize};
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
    #[must_use]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    /// Human-readable diagnostic message.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn message(&self) -> String {
        self.message.clone()
    }

    /// Severity level as a string (`"Error"`, `"Warning"`, `"Note"`, `"Help"`).
    #[wasm_bindgen(getter)]
    #[must_use]
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
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn complete(&self) -> usize {
        self.complete
    }

    /// Number of entities that scored 0.5 ("partial").
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn partial(&self) -> usize {
        self.partial
    }

    /// Number of entities that scored 0.0 ("incomplete").
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn incomplete(&self) -> usize {
        self.incomplete
    }

    /// Aggregate percentage (0–100).
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
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
    #[must_use]
    pub fn project_name(&self) -> String {
        self.project_name.clone()
    }

    /// Overall aggregate percentage (0–100).
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn overall_percentage(&self) -> f64 {
        self.overall_percentage
    }

    /// Component scoring breakdown.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn components(&self) -> CategoryScoreJS {
        self.components.clone()
    }

    /// Port scoring breakdown.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn ports(&self) -> CategoryScoreJS {
        self.ports.clone()
    }

    /// Connection scoring breakdown.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn connections(&self) -> CategoryScoreJS {
        self.connections.clone()
    }

    /// Message scoring breakdown.
    #[wasm_bindgen(getter)]
    #[must_use]
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
    #[must_use]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    /// Semantic version string.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn version(&self) -> String {
        self.version.clone()
    }

    /// List of author strings.
    #[wasm_bindgen(getter)]
    #[must_use]
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
    // level: i32,
    pub from: usize,
    pub to: usize,
}

impl From<&rhizz_core::Connection> for ConnectionJS {
    fn from(c: &rhizz_core::Connection) -> Self {
        Self {
            label: c.label.clone(),
            // Uncommented, not used yet anywhere,
            // otherwise linter complains.
            // Uncomment when you start using it
            // level: c.level,
            from: c.from.component.0,
            to: c.to.component.0,
        }
    }
}

#[wasm_bindgen]
impl ConnectionJS {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

// ── PortJS ───────────────────────────────────────────────────────────────────

/// A port exposed to JavaScript.
#[derive(Clone)]
#[wasm_bindgen]
pub struct PortJS {
    label: String,
    description: String,
    protocol: String,
    role: Option<String>,
    external: bool,
    required: bool,
    tags: Vec<String>,
    owner_component_index: usize,
}

#[wasm_bindgen]
impl PortJS {
    /// Port label.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    /// Human-readable description.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn description(&self) -> String {
        self.description.clone()
    }

    /// Referenced protocol name.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn protocol(&self) -> String {
        self.protocol.clone()
    }

    /// Port role.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn role(&self) -> Option<String> {
        self.role.clone()
    }

    /// Whether this port is an external boundary interface.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn external(&self) -> bool {
        self.external
    }

    /// Whether this port is required when instantiated in a system.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn required(&self) -> bool {
        self.required
    }

    /// Filtering tags.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn tags(&self) -> Vec<String> {
        self.tags.clone()
    }

    /// Index of the owning component in `model.components()`.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn owner_component_index(&self) -> usize {
        self.owner_component_index
    }
}

impl From<&rhizz_core::Port> for PortJS {
    fn from(p: &rhizz_core::Port) -> Self {
        Self {
            label: p.label.clone(),
            description: p.description.clone(),
            protocol: p.protocol.clone(),
            role: p.role.clone(),
            external: p.external,
            required: p.required,
            tags: p.tags.clone(),
            owner_component_index: p.owner.0,
        }
    }
}

// ── ProtocolJS ───────────────────────────────────────────────────────────────

/// A top-level protocol definition exposed to JavaScript.
#[derive(Clone)]
#[wasm_bindgen]
pub struct ProtocolJS {
    label: String,
    description: String,
    tags: Vec<String>,
    roles: Vec<String>,
}

#[wasm_bindgen]
impl ProtocolJS {
    /// Protocol label.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    /// Human-readable description.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn description(&self) -> String {
        self.description.clone()
    }

    /// Filtering tags.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn tags(&self) -> Vec<String> {
        self.tags.clone()
    }

    /// Permitted port roles.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn roles(&self) -> Vec<String> {
        self.roles.clone()
    }
}

impl From<&rhizz_core::Protocol> for ProtocolJS {
    fn from(proto: &rhizz_core::Protocol) -> Self {
        Self {
            label: proto.label.clone(),
            description: proto.description.clone(),
            tags: proto.tags.clone(),
            roles: proto.roles.clone(),
        }
    }
}

// ── SystemJS ──────────────────────────────────────────────────────────────────

/// A top-level system exposed to JavaScript.
///
/// Systems (unlike components, whose labels are only unique within their
/// parent scope) have globally-unique labels, so `label` is suitable as a
/// stable identifier even across `ModelJS::systems()` re-ordering.
#[derive(Clone)]
#[wasm_bindgen]
pub struct SystemJS {
    label: String,
}

#[wasm_bindgen]
impl SystemJS {
    /// Globally-unique system identifier.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

impl From<&rhizz_core::System> for SystemJS {
    fn from(s: &rhizz_core::System) -> Self {
        Self {
            label: s.label.clone(),
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
    icon: Option<String>,
    tags: Vec<String>,
    level: i32,
    leaf: bool,
    color: Option<String>,
    border: Option<String>,
    font: Option<String>,
    /// Set when the parent is another component; `None` when the parent is a system.
    parent_component_index: Option<usize>,
    /// Set when the parent is a top-level system; `None` when the parent is a component.
    parent_system_index: Option<usize>,
}

#[wasm_bindgen]
impl ComponentJS {
    /// Unique label within its parent scope.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    /// Human-readable description.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn description(&self) -> String {
        self.description.clone()
    }

    /// Optional `FontAwesome` icon name.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn icon(&self) -> Option<String> {
        self.icon.clone()
    }

    /// Optional border color.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn color(&self) -> Option<String> {
        self.color.clone()
    }

    /// Optional border style (solid, dashed, dotted).
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn border(&self) -> Option<String> {
        self.border.clone()
    }

    /// Optional single-word font style (bold, italic).
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn font(&self) -> Option<String> {
        self.font.clone()
    }

    /// Filtering tags.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn tags(&self) -> Vec<String> {
        self.tags.clone()
    }

    /// Abstraction level.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn level(&self) -> i32 {
        self.level
    }

    /// Whether the component is atomic (no further decomposition).
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn leaf(&self) -> bool {
        self.leaf
    }

    /// Arena index into `model.components()` for the parent component, or `undefined` if the parent is a system.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
    pub fn parent_component_index(&self) -> Option<usize> {
        self.parent_component_index
    }

    /// Arena index into `model.systems()` for the parent system, or `undefined` if the parent is a component.
    #[wasm_bindgen(getter)]
    #[must_use]
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen forbids const fns
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
            icon: c.icon.clone(),
            tags: c.tags.clone(),
            level: c.level,
            leaf: c.leaf,
            color: c.color.clone(),
            border: c.border.map(|b| b.as_str().to_string()),
            font: c.font.clone(),
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
    #[must_use]
    pub fn project(&self) -> ProjectJS {
        ProjectJS::from(&self.inner.project)
    }

    /// Returns all top-level systems as typed wrappers.
    #[must_use]
    pub fn systems(&self) -> Vec<SystemJS> {
        self.inner.systems.iter().map(SystemJS::from).collect()
    }

    /// Returns all components as typed wrappers.
    #[must_use]
    pub fn components(&self) -> Vec<ComponentJS> {
        self.inner
            .components
            .iter()
            .map(ComponentJS::from)
            .collect()
    }

    /// Returns all connections as typed wrappers.
    #[must_use]
    pub fn connections(&self) -> Vec<ConnectionJS> {
        self.inner
            .connections
            .iter()
            .map(ConnectionJS::from)
            .collect()
    }

    /// Returns all top-level protocols as typed wrappers.
    #[must_use]
    pub fn protocols(&self) -> Vec<ProtocolJS> {
        self.inner.protocols.iter().map(ProtocolJS::from).collect()
    }

    /// Returns all ports as typed wrappers.
    #[must_use]
    pub fn ports(&self) -> Vec<PortJS> {
        self.inner.ports.iter().map(PortJS::from).collect()
    }

    /// Returns the component with the given label, or `undefined` if not found.
    #[must_use]
    pub fn component_by_name(&self, name: &str) -> Option<ComponentJS> {
        self.inner
            .components
            .iter()
            .find(|c| c.label == name)
            .map(ComponentJS::from)
    }

    /// Returns the component with the given id, or `undefined` if not found.
    #[must_use]
    pub fn component_by_id(&self, id: usize) -> Option<ComponentJS> {
        self.inner.components.get(id).map(ComponentJS::from)
    }

    /// Computes and returns the completion score report.
    #[must_use]
    pub fn score(&self) -> ScoreReportJS {
        ScoreReportJS::from(&rhizz_core::score(&self.inner))
    }

    /// Serializes the model into a canonical HCL string.
    #[must_use]
    pub fn to_hcl(&self) -> String {
        rhizz_core::serialize_model(&self.inner)
    }

    /// Creates a `ModelJS` from a JSON string representation of `Model`.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the JSON does not match the `Model` schema.
    pub fn from_json(json: &str) -> Result<Self, JsError> {
        let model: rhizz_core::Model = serde_json::from_str(json)
            .map_err(|e| JsError::new(&format!("invalid model JSON: {e}")))?;
        Ok(Self { inner: model })
    }

    /// Exports the model to a JSON string.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if serialization fails.
    pub fn to_json(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.inner)
            .map_err(|e| JsError::new(&format!("failed to serialize model to JSON: {e}")))
    }

    /// Creates a `ModelJS` directly from a JS object matching the `Model` schema.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the JS object does not match the `Model` schema.
    pub fn from_js(val: JsValue) -> Result<Self, JsError> {
        let model: rhizz_core::Model =
            serde_wasm_bindgen::from_value(val).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self { inner: model })
    }

    /// Exports the model as a plain JS object.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if serialization fails.
    pub fn to_js(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.inner).map_err(|e| JsError::new(&e.to_string()))
    }
}

// ── Serialization functions ───────────────────────────────────────────────────

/// Serializes a resolved model to canonical HCL.
#[wasm_bindgen]
#[must_use]
pub fn serialize_model(model: &ModelJS) -> String {
    model.to_hcl()
}

/// Serializes an array of [`rhizz_core::ViewDefinition`] JS objects into canonical HCL for `views.hcl`.
///
/// # Errors
///
/// Returns a `JsError` if the JS value does not match the `ViewDefinition` schema.
#[wasm_bindgen]
pub fn serialize_views(views: JsValue) -> Result<String, JsError> {
    let views: Vec<rhizz_core::ViewDefinition> =
        serde_wasm_bindgen::from_value(views).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(rhizz_core::serialize_views(&views))
}

/// Parses an HCL string representing `views.hcl` into an array of [`rhizz_core::ViewDefinition`] JS objects.
///
/// # Errors
///
/// Returns a `JsError` if the HCL is invalid or serialization fails.
#[wasm_bindgen]
pub fn parse_views(hcl: &str) -> Result<JsValue, JsError> {
    let views = rhizz_core::parse_views(hcl)
        .map_err(|e| JsError::new(&format!("failed to parse views HCL: {e}")))?;
    serde_wasm_bindgen::to_value(&views).map_err(|e| JsError::new(&e.to_string()))
}

// ── Example projects ──────────────────────────────────────────────────────────

/// A source file in an embedded example project.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExampleFileJS {
    pub path: String,
    pub content: String,
}

/// An embedded example project available for scaffolding.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExampleProjectJS {
    pub id: String,
    pub name: String,
    pub description: String,
    pub files: Vec<ExampleFileJS>,
}

/// Returns all embedded example systems from `examples/` as a JS array of
/// `{ id: string, name: string, description: string, files: [{ path: string, content: string }] }`.
///
/// # Errors
///
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn get_example_projects() -> Result<JsValue, JsError> {
    let list: Vec<ExampleProjectJS> = rhizz_core::example_projects()
        .iter()
        .map(|p| ExampleProjectJS {
            id: p.id.to_string(),
            name: p.name.to_string(),
            description: p.description.to_string(),
            files: p
                .files
                .iter()
                .map(|f| ExampleFileJS {
                    path: f.path.to_string(),
                    content: f.content.to_string(),
                })
                .collect(),
        })
        .collect();
    serde_wasm_bindgen::to_value(&list).map_err(|e| JsError::new(&e.to_string()))
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
    pub fn compile(sources: JsValue) -> Result<Self, JsError> {
        let sources: Vec<rhizz_core::Source> =
            serde_wasm_bindgen::from_value(sources).map_err(|e| JsError::new(&e.to_string()))?;
        let result = rhizz_core::compile(&sources);
        Ok(Self {
            diagnostics: result.diagnostics,
            model: result.model,
        })
    }

    /// Returns all diagnostics (errors and warnings) as typed wrappers.
    pub fn diagnostics(&self) -> Vec<DiagnosticJS> {
        self.diagnostics.iter().map(DiagnosticJS::from).collect()
    }

    /// Returns the number of error-level diagnostics.
    #[must_use]
    pub fn error_count(&self) -> usize {
        self.diagnostics.iter().filter(|d| d.is_error()).count()
    }

    /// Returns the number of warning-level diagnostics.
    #[must_use]
    pub fn warning_count(&self) -> usize {
        self.diagnostics.iter().filter(|d| !d.is_error()).count()
    }

    /// Returns the resolved model, or `undefined` if there were hard errors.
    ///
    /// Clones the model on each call; cache the result in JS if calling repeatedly.
    #[must_use]
    pub fn model(&self) -> Option<ModelJS> {
        self.model.as_ref().map(|m| ModelJS { inner: m.clone() })
    }
}
