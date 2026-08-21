// Public API consumed by the resolve module.

/// Raw (deserialization) model and file-level parsing.
///
/// Two concerns live here:
///   1. Raw struct definitions that mirror the HCL schema 1:1.
///   2. `parse_file` / `merge_into` that turn HCL text into those structs.
///
/// No validation, no resolution — that is Task 2+.
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tracing::instrument;

// ── Raw model types ──────────────────────────────────────────────────────────

/// A block that carries a label (e.g. `system "my-system" { … }`).
#[derive(Debug, Clone)]
pub struct Labeled<T> {
    /// The block label (e.g. `"my-system"`).
    pub label: String,
    /// The parsed inner value.
    pub inner: T,
}

/// Merged contents of all `.hcl` files in a project directory.
#[derive(Debug, Default)]
pub struct RawFile {
    /// Source file path hint — used for diagnostics.
    /// After merging this holds the last file that contributed a project block.
    pub project_source: Option<PathBuf>,
    /// Parsed project block, if present.
    pub project: Option<RawProject>,
    /// All parsed system blocks.
    pub systems: Vec<Labeled<RawSystem>>,
    /// All parsed top-level component blocks.
    pub components: Vec<Labeled<RawComponent>>,
    /// All parsed view blocks.
    pub views: Vec<Labeled<RawView>>,
}

/// Raw project metadata before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawProject {
    /// Optional project name.
    pub name: Option<String>,
    /// Optional semantic version.
    pub version: Option<String>,
    /// List of authors.
    pub authors: Vec<String>,
}

/// Raw system block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawSystem {
    /// Optional description text.
    pub description: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Optional explicit abstraction level.
    pub level: Option<i32>,
    /// Child component blocks.
    pub components: Vec<Labeled<RawComponent>>,
    /// Child connection blocks.
    pub connections: Vec<Labeled<RawConnection>>,
}

/// Raw component block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawComponent {
    /// Optional source label referring to a top-level component definition.
    pub source: Option<String>,
    /// Optional description text.
    pub description: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Optional explicit abstraction level.
    pub level: Option<i32>,
    /// Whether this component is atomic.
    pub leaf: Option<bool>,
    /// Port blocks declared on this component.
    pub ports: Vec<Labeled<RawPort>>,
    /// Nested child component blocks.
    pub components: Vec<Labeled<RawComponent>>,
    /// Nested connection blocks.
    pub connections: Vec<Labeled<RawConnection>>,
}

/// Raw port block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawPort {
    /// Optional description text.
    pub description: Option<String>,
    /// Free-form protocol name.
    pub protocol: Option<String>,
    /// Role string (`"provider"`, `"consumer"`, `"peer"`).
    pub role: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Nested message blocks.
    pub messages: Vec<Labeled<RawMessage>>,
}

/// Raw connection block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawConnection {
    /// Optional description text.
    pub description: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Optional explicit abstraction level.
    pub level: Option<i32>,
    /// Source reference (`"comp"` or `"comp:port"`).
    pub from: Option<String>,
    /// Target reference (`"comp"` or `"comp:port"`).
    pub to: Option<String>,
    /// Labels of sibling connections this one encapsulates.
    pub encapsulates: Vec<String>,
}

/// Raw message block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawMessage {
    /// Optional description text.
    pub description: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Optional explicit abstraction level.
    pub level: Option<i32>,
    /// Nested field blocks.
    pub fields: Vec<Labeled<RawField>>,
}

/// Raw field block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawField {
    /// Data type string (mapped from HCL `type` attribute).
    pub field_type: Option<String>,
    /// Optional description text.
    pub description: Option<String>,
    /// Physical unit string.
    pub unit: Option<String>,
    /// Whether the field is required.
    pub required: Option<bool>,
}

// ── Serde attribute-only structs ─────────────────────────────────────────────
//
// These are used exclusively with `hcl::from_body` to extract simple
// key-value attributes from a block body, ignoring nested child blocks.

/// Serde helper for deserializing project attributes.
#[derive(Deserialize, Default)]
struct ProjectAttrs {
    /// Optional project name.
    name: Option<String>,
    /// Optional version string.
    version: Option<String>,
    /// Optional author list.
    authors: Option<Vec<String>>,
}

/// Serde helper for deserializing system attributes.
#[derive(Deserialize, Default)]
struct SystemAttrs {
    /// Optional description.
    description: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
    /// Optional abstraction level.
    level: Option<i32>,
}

/// Serde helper for deserializing component attributes.
#[derive(Deserialize, Default)]
struct ComponentAttrs {
    /// Optional source reference.
    source: Option<String>,
    /// Optional description.
    description: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
    /// Optional abstraction level.
    level: Option<i32>,
    /// Optional leaf flag.
    leaf: Option<bool>,
}

/// Serde helper for deserializing port attributes.
#[derive(Deserialize, Default)]
struct PortAttrs {
    /// Optional description.
    description: Option<String>,
    /// Optional protocol name.
    protocol: Option<String>,
    /// Optional role string.
    role: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
}

/// Serde helper for deserializing connection attributes.
#[derive(Deserialize, Default)]
struct ConnectionAttrs {
    /// Optional description.
    description: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
    /// Optional abstraction level.
    level: Option<i32>,
    /// Source reference.
    from: Option<String>,
    /// Target reference.
    to: Option<String>,
    /// Encapsulated connection labels.
    encapsulates: Option<Vec<String>>,
}

/// Serde helper for deserializing message attributes.
#[derive(Deserialize, Default)]
struct MessageAttrs {
    /// Optional description.
    description: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
    /// Optional abstraction level.
    level: Option<i32>,
}

/// Serde helper for deserializing field attributes.
#[derive(Deserialize, Default)]
struct FieldAttrs {
    // `type` is a Rust keyword; serde rename handles this transparently.
    /// Data type string (renamed from HCL `type`).
    #[serde(rename = "type")]
    field_type: Option<String>,
    /// Optional description.
    description: Option<String>,
    /// Physical unit string.
    unit: Option<String>,
    /// Whether the field is required.
    required: Option<bool>,
}

/// Serde helper for deserializing view attributes.
#[derive(Deserialize, Default)]
struct ViewAttrs {
    /// Optional description.
    description: Option<String>,
    /// Optional tags list.
    tags: Option<Vec<String>>,
    /// Target system label.
    system: Option<String>,
}

/// Serde helper for deserializing filter sub-block attributes.
#[derive(Deserialize, Default)]
struct FilterAttrs {
    /// Tag whitelist.
    include_tags: Option<Vec<String>>,
    /// Tag blacklist.
    exclude_tags: Option<Vec<String>>,
    /// Maximum abstraction level.
    max_level: Option<i32>,
    /// Component label whitelist.
    components: Option<Vec<String>>,
    /// Whether to show messages on edges.
    show_messages: Option<bool>,
}

// ── Raw view types ────────────────────────────────────────────────────────────

/// Raw view block before resolution.
#[derive(Debug, Clone, Default)]
pub struct RawView {
    /// Optional description text.
    pub description: Option<String>,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Target system label.
    pub system: Option<String>,
    /// Optional filter sub-block.
    pub filter: Option<RawViewFilter>,
}

/// Raw filter sub-block of a view.
#[derive(Debug, Clone, Default)]
pub struct RawViewFilter {
    /// Tag whitelist (empty = match all).
    pub include_tags: Vec<String>,
    /// Tag blacklist.
    pub exclude_tags: Vec<String>,
    /// Maximum abstraction level.
    pub max_level: Option<i32>,
    /// Component label whitelist (empty = all).
    pub components: Vec<String>,
    /// Whether to show messages on edges.
    pub show_messages: Option<bool>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract the first label from a block (e.g. `system "label" { … }`).
fn first_label(block: &hcl::Block) -> Result<String> {
    block
        .labels()
        .first()
        .map(|l| l.as_str().to_owned())
        .ok_or_else(|| anyhow!("block '{}' is missing a label", block.identifier()))
}

/// Deserialize attribute-only fields from a body, discarding child blocks.
fn attrs<T: for<'de> Deserialize<'de> + Default>(body: &hcl::Body) -> Result<T> {
    hcl::from_body(body.clone()).context("failed to deserialize block attributes")
}

// ── Block parsers ─────────────────────────────────────────────────────────────

/// Parse a `project` block body into a [`RawProject`].
fn parse_project(body: &hcl::Body) -> Result<RawProject> {
    let a: ProjectAttrs = attrs(body)?;
    Ok(RawProject {
        name: a.name,
        version: a.version,
        authors: a.authors.unwrap_or_default(),
    })
}

/// Parse a `field` block body into a [`RawField`].
fn parse_field(body: &hcl::Body) -> Result<RawField> {
    let a: FieldAttrs = attrs(body)?;
    Ok(RawField {
        field_type: a.field_type,
        description: a.description,
        unit: a.unit,
        required: a.required,
    })
}

/// Parse a `message` block body into a [`RawMessage`].
fn parse_message(body: &hcl::Body) -> Result<RawMessage> {
    let a: MessageAttrs = attrs(body)?;
    let mut fields = Vec::new();
    for block in body.blocks() {
        if block.identifier() == "field" {
            let label = first_label(block)?;
            let inner = parse_field(block.body()).with_context(|| format!("in field '{label}'"))?;
            fields.push(Labeled { label, inner });
        }
    }
    Ok(RawMessage {
        description: a.description,
        tags: a.tags.unwrap_or_default(),
        level: a.level,
        fields,
    })
}

/// Parse a `port` block body into a [`RawPort`].
fn parse_port(body: &hcl::Body) -> Result<RawPort> {
    let a: PortAttrs = attrs(body)?;
    let mut messages = Vec::new();
    for block in body.blocks() {
        if block.identifier() == "message" {
            let label = first_label(block)?;
            let inner =
                parse_message(block.body()).with_context(|| format!("in message '{label}'"))?;
            messages.push(Labeled { label, inner });
        }
    }
    Ok(RawPort {
        description: a.description,
        protocol: a.protocol,
        role: a.role,
        tags: a.tags.unwrap_or_default(),
        messages,
    })
}

/// Parse a `connection` block body into a [`RawConnection`].
fn parse_connection(body: &hcl::Body) -> Result<RawConnection> {
    let a: ConnectionAttrs = attrs(body)?;
    Ok(RawConnection {
        description: a.description,
        tags: a.tags.unwrap_or_default(),
        level: a.level,
        from: a.from,
        to: a.to,
        encapsulates: a.encapsulates.unwrap_or_default(),
    })
}

/// Parse a `component` block body into a [`RawComponent`].
fn parse_component(body: &hcl::Body) -> Result<RawComponent> {
    let a: ComponentAttrs = attrs(body)?;
    let mut ports = Vec::new();
    let mut components = Vec::new();
    let mut connections = Vec::new();
    for block in body.blocks() {
        match block.identifier() {
            "port" => {
                let label = first_label(block)?;
                let inner =
                    parse_port(block.body()).with_context(|| format!("in port '{label}'"))?;
                ports.push(Labeled { label, inner });
            }
            "component" => {
                let label = first_label(block)?;
                let inner = parse_component(block.body())
                    .with_context(|| format!("in component '{label}'"))?;
                components.push(Labeled { label, inner });
            }
            "connection" => {
                let label = first_label(block)?;
                let inner = parse_connection(block.body())
                    .with_context(|| format!("in connection '{label}'"))?;
                connections.push(Labeled { label, inner });
            }
            _ => {}
        }
    }
    Ok(RawComponent {
        source: a.source,
        description: a.description,
        tags: a.tags.unwrap_or_default(),
        level: a.level,
        leaf: a.leaf,
        ports,
        components,
        connections,
    })
}

/// Parse a `system` block body into a [`RawSystem`].
fn parse_system(body: &hcl::Body) -> Result<RawSystem> {
    let a: SystemAttrs = attrs(body)?;
    let mut components = Vec::new();
    let mut connections = Vec::new();
    for block in body.blocks() {
        match block.identifier() {
            "component" => {
                let label = first_label(block)?;
                let inner = parse_component(block.body())
                    .with_context(|| format!("in component '{label}'"))?;
                components.push(Labeled { label, inner });
            }
            "connection" => {
                let label = first_label(block)?;
                let inner = parse_connection(block.body())
                    .with_context(|| format!("in connection '{label}'"))?;
                connections.push(Labeled { label, inner });
            }
            _ => {}
        }
    }
    Ok(RawSystem {
        description: a.description,
        tags: a.tags.unwrap_or_default(),
        level: a.level,
        components,
        connections,
    })
}

/// Parse a `view` block body into a [`RawView`].
fn parse_view(body: &hcl::Body) -> Result<RawView> {
    let a: ViewAttrs = attrs(body)?;
    let mut filter = None;
    for block in body.blocks() {
        if block.identifier() == "filter" {
            let fa: FilterAttrs = attrs(block.body())?;
            filter = Some(RawViewFilter {
                include_tags: fa.include_tags.unwrap_or_default(),
                exclude_tags: fa.exclude_tags.unwrap_or_default(),
                max_level: fa.max_level,
                components: fa.components.unwrap_or_default(),
                show_messages: fa.show_messages,
            });
        }
    }
    Ok(RawView {
        description: a.description,
        tags: a.tags.unwrap_or_default(),
        system: a.system,
        filter,
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Parse a single `.hcl` source string into a `RawFile`.
/// `path` is used only for error context messages.
#[instrument(skip(src), fields(path = %path.display()))]
pub fn parse_file(src: &str, path: &Path) -> Result<RawFile> {
    let body = hcl::parse(src).with_context(|| format!("HCL parse error in {}", path.display()))?;

    let mut file = RawFile::default();

    for block in body.blocks() {
        match block.identifier() {
            "project" => {
                if file.project.is_some() {
                    bail!(
                        "E010: duplicate project block (second occurrence in {})",
                        path.display()
                    );
                }
                file.project = Some(parse_project(block.body()).context("in project block")?);
                file.project_source = Some(path.to_path_buf());
            }
            "system" => {
                let label = first_label(block)?;
                let inner =
                    parse_system(block.body()).with_context(|| format!("in system '{label}'"))?;
                file.systems.push(Labeled { label, inner });
            }
            "component" => {
                let label = first_label(block)?;
                let inner = parse_component(block.body())
                    .with_context(|| format!("in component '{label}'"))?;
                file.components.push(Labeled { label, inner });
            }
            "view" => {
                let label = first_label(block)?;
                let inner =
                    parse_view(block.body()).with_context(|| format!("in view '{label}'"))?;
                file.views.push(Labeled { label, inner });
            }
            other => {
                bail!("unknown top-level block '{}' in {}", other, path.display());
            }
        }
    }

    Ok(file)
}

/// Merge `src` into `dst`.  Returns an error on E010 (duplicate project block).
#[instrument(skip(dst, src), fields(path = %path.display()))]
pub(crate) fn merge_into(dst: &mut RawFile, src: RawFile, path: &Path) -> Result<()> {
    if let Some(proj) = src.project {
        if dst.project.is_some() {
            bail!(
                "E010: more than one project block defined (second in {})",
                path.display()
            );
        }
        dst.project = Some(proj);
        dst.project_source = src.project_source;
    }
    dst.systems.extend(src.systems);
    dst.components.extend(src.components);
    dst.views.extend(src.views);
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub(crate) fn parse_dir(dir: &std::path::Path) -> anyhow::Result<RawFile> {
    use walkdir::WalkDir;
    let mut merged = RawFile::default();
    let mut hcl_files: Vec<PathBuf> = WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|ext| ext == "hcl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    hcl_files.sort();
    if hcl_files.is_empty() {
        anyhow::bail!("no .hcl files found in {}", dir.display());
    }
    for path in &hcl_files {
        let src = std::fs::read_to_string(path)
            .with_context(|| format!("cannot read {}", path.display()))?;
        let file = parse_file(&src, path)?;
        merge_into(&mut merged, file, path)?;
    }
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
    fn parse_drone_dir() {
        let dir = example_dir("drone");
        let raw = parse_dir(&dir).expect("drone example should parse without error");

        assert!(raw.project.is_some(), "project block expected");
        let proj = raw.project.as_ref().unwrap();
        assert_eq!(proj.name.as_deref(), Some("drone-system"));
        assert_eq!(proj.version.as_deref(), Some("0.3.0"));

        // Two systems: quadcopter + ground-control
        assert_eq!(raw.systems.len(), 2, "expected 2 systems");
        let quad = raw
            .systems
            .iter()
            .find(|s| s.label == "quadcopter")
            .unwrap();
        assert!(quad.inner.description.is_some());

        // Components at top level of quadcopter
        let comp_labels: Vec<&str> = quad
            .inner
            .components
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(comp_labels.contains(&"flight-controller"));
        assert!(comp_labels.contains(&"esc"));
        assert!(comp_labels.contains(&"battery"));

        // flight-controller uses source = "flight-controller"; no inline body at parse time
        let fc = quad
            .inner
            .components
            .iter()
            .find(|c| c.label == "flight-controller")
            .unwrap();
        assert_eq!(
            fc.inner.source.as_deref(),
            Some("flight-controller"),
            "flight-controller component should have source attribute"
        );
        assert!(
            fc.inner.components.is_empty(),
            "sourced component should have no inline children at parse time"
        );

        // The full definition lives in the top-level components map
        let tl_fc = raw
            .components
            .iter()
            .find(|c| c.label == "flight-controller")
            .expect("top-level flight-controller component missing");
        let tl_fc_child_labels: Vec<&str> = tl_fc
            .inner
            .components
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(tl_fc_child_labels.contains(&"mcu"));
        assert!(tl_fc_child_labels.contains(&"imu"));
        assert!(tl_fc_child_labels.contains(&"barometer"));

        // FC top-level definition should have ports with messages
        let fc_port_labels: Vec<&str> =
            tl_fc.inner.ports.iter().map(|p| p.label.as_str()).collect();
        assert!(fc_port_labels.contains(&"motor-out"));
        assert!(fc_port_labels.contains(&"gps-serial"));
        assert!(fc_port_labels.contains(&"rc-in"));

        // motor-out port should have a message
        let motor_port = tl_fc
            .inner
            .ports
            .iter()
            .find(|p| p.label == "motor-out")
            .unwrap();
        assert_eq!(motor_port.inner.messages.len(), 1);
        assert_eq!(motor_port.inner.messages[0].label, "throttle");
        assert_eq!(motor_port.inner.messages[0].inner.fields.len(), 2);

        // Connections at system level
        let conn_labels: Vec<&str> = quad
            .inner
            .connections
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(conn_labels.contains(&"motor-control"));
        assert!(conn_labels.contains(&"rc-link"));

        // Views
        assert_eq!(raw.views.len(), 4, "expected 4 views");
        let ov = raw
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .unwrap();
        assert!(ov.inner.filter.is_some());
    }

    #[test]
    fn drone_ground_control_system_parses() {
        let dir = example_dir("drone");
        let raw = parse_dir(&dir).unwrap();
        let gc = raw
            .systems
            .iter()
            .find(|s| s.label == "ground-control")
            .expect("ground-control system missing");
        // ground-station-pc has no description and no children — should still parse
        let gpc = gc
            .inner
            .components
            .iter()
            .find(|c| c.label == "ground-station-pc")
            .expect("ground-station-pc component missing");
        assert!(gpc.inner.description.is_none());
        assert!(gpc.inner.components.is_empty());
    }

    // ── social-media ───────────────────────────────────────────────────────

    #[test]
    fn parse_social_media_dir() {
        let dir = example_dir("social-media");
        let raw = parse_dir(&dir).expect("social-media example should parse without error");

        assert_eq!(raw.systems.len(), 1);
        let bv = &raw.systems[0];
        assert_eq!(bv.label, "buzzvid");

        // Backend is a non-leaf component with children
        let backend = bv
            .inner
            .components
            .iter()
            .find(|c| c.label == "backend")
            .expect("backend component missing");
        let backend_children: Vec<&str> = backend
            .inner
            .components
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(backend_children.contains(&"user-service"));
        assert!(backend_children.contains(&"feed-service"));
        assert!(backend_children.contains(&"recommendation-engine"));

        // recommendation-engine has no children (in-progress)
        let rec = backend
            .inner
            .components
            .iter()
            .find(|c| c.label == "recommendation-engine")
            .unwrap();
        assert!(rec.inner.components.is_empty());

        // mobile-app should have ports with messages
        let app = bv
            .inner
            .components
            .iter()
            .find(|c| c.label == "mobile-app")
            .expect("mobile-app component missing");
        let api_port = app
            .inner
            .ports
            .iter()
            .find(|p| p.label == "api")
            .expect("api port missing");
        let msg_labels: Vec<&str> = api_port
            .inner
            .messages
            .iter()
            .map(|m| m.label.as_str())
            .collect();
        assert!(msg_labels.contains(&"get-feed"));
        assert!(msg_labels.contains(&"upload-video"));

        // Top-level connections
        let conn_labels: Vec<&str> = bv
            .inner
            .connections
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(conn_labels.contains(&"client-api"));
        assert!(conn_labels.contains(&"push-notify"));

        assert_eq!(raw.views.len(), 3);
    }

    // ── software-house ─────────────────────────────────────────────────────

    #[test]
    fn parse_software_house_dir() {
        let dir = example_dir("software-house");
        let raw = parse_dir(&dir).expect("software-house example should parse without error");

        assert_eq!(raw.systems.len(), 1);
        let acme = &raw.systems[0];
        assert_eq!(acme.label, "acme-software");

        // Departments exist as top-level components
        let dept_labels: Vec<&str> = acme
            .inner
            .components
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(dept_labels.contains(&"engineering"));
        assert!(dept_labels.contains(&"product"));
        assert!(dept_labels.contains(&"qa"));
        assert!(dept_labels.contains(&"sales"));
        assert!(dept_labels.contains(&"operations"));

        // Engineering has sub-teams
        let eng = acme
            .inner
            .components
            .iter()
            .find(|c| c.label == "engineering")
            .unwrap();
        let team_labels: Vec<&str> = eng
            .inner
            .components
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(team_labels.contains(&"frontend-team"));
        assert!(team_labels.contains(&"backend-team"));
        assert!(team_labels.contains(&"platform-team"));

        // operations has no description and no children
        let ops = acme
            .inner
            .components
            .iter()
            .find(|c| c.label == "operations")
            .unwrap();
        assert!(ops.inner.description.is_none());
        assert!(ops.inner.components.is_empty());

        // Cross-department connections
        let conn_labels: Vec<&str> = acme
            .inner
            .connections
            .iter()
            .map(|c| c.label.as_str())
            .collect();
        assert!(conn_labels.contains(&"sprint-planning"));
        assert!(conn_labels.contains(&"bug-reports"));

        // Product has ports with messages
        let product = acme
            .inner
            .components
            .iter()
            .find(|c| c.label == "product")
            .unwrap();
        let sprint_port = product
            .inner
            .ports
            .iter()
            .find(|p| p.label == "sprint-out")
            .expect("sprint-out port missing");
        assert_eq!(sprint_port.inner.messages.len(), 1);
        let msg = &sprint_port.inner.messages[0];
        assert_eq!(msg.label, "sprint-backlog");
        let field_labels: Vec<&str> = msg.inner.fields.iter().map(|f| f.label.as_str()).collect();
        assert!(field_labels.contains(&"sprint_id"));
        assert!(field_labels.contains(&"stories"));
        assert!(field_labels.contains(&"capacity"));

        assert_eq!(raw.views.len(), 3);
    }

    // ── E010 detection ─────────────────────────────────────────────────────

    #[test]
    fn e010_duplicate_project_block_same_file() {
        let src = r#"
            project { name = "a" }
            project { name = "b" }
        "#;
        let path = PathBuf::from("test.hcl");
        let err = parse_file(src, &path).unwrap_err();
        assert!(
            err.to_string().contains("E010"),
            "expected E010 error, got: {err}"
        );
    }

    // ── Inline unit parse tests ─────────────────────────────────────────────

    #[test]
    fn parse_minimal_system() {
        let src = r#"
            system "my-sys" {
                description = "test"
                tags = ["a", "b"]
                level = 0

                component "c1" { leaf = true }
                connection "i1" {
                    from = "c1"
                    to   = "c1"
                }
            }
        "#;
        let path = PathBuf::from("test.hcl");
        let raw = parse_file(src, &path).unwrap();
        assert_eq!(raw.systems.len(), 1);
        let sys = &raw.systems[0];
        assert_eq!(sys.label, "my-sys");
        assert_eq!(sys.inner.tags, vec!["a", "b"]);
        assert_eq!(sys.inner.level, Some(0));
        assert_eq!(sys.inner.components.len(), 1);
        assert_eq!(sys.inner.connections.len(), 1);
        let conn = &sys.inner.connections[0];
        assert_eq!(conn.inner.from.as_deref(), Some("c1"));
        assert_eq!(conn.inner.to.as_deref(), Some("c1"));
    }

    #[test]
    fn parse_field_type_attribute() {
        let src = r#"
            system "s" {
                component "a" {
                    leaf = true
                    port "p" {
                        message "m" {
                            field "f" {
                                type        = "uint8"
                                unit        = "ms"
                                description = "desc"
                            }
                        }
                    }
                }
                component "b" { leaf = true }
            }
        "#;
        let path = PathBuf::from("test.hcl");
        let raw = parse_file(src, &path).unwrap();
        let field = &raw.systems[0].inner.components[0].inner.ports[0]
            .inner
            .messages[0]
            .inner
            .fields[0];
        assert_eq!(field.inner.field_type.as_deref(), Some("uint8"));
        assert_eq!(field.inner.unit.as_deref(), Some("ms"));
    }

    // ── Top-level component parsing ─────────────────────────────────────────

    #[test]
    fn parse_top_level_component_block() {
        let src = r#"
            component "my-comp" {
                description = "a standalone component"
                tags        = ["x"]
                level       = 2
                leaf        = true
            }
        "#;
        let path = PathBuf::from("test.hcl");
        let raw = parse_file(src, &path).unwrap();
        assert_eq!(raw.components.len(), 1);
        let comp = &raw.components[0];
        assert_eq!(comp.label, "my-comp");
        assert_eq!(
            comp.inner.description.as_deref(),
            Some("a standalone component")
        );
        assert_eq!(comp.inner.tags, vec!["x"]);
        assert_eq!(comp.inner.level, Some(2));
        assert_eq!(comp.inner.leaf, Some(true));
    }

    #[test]
    fn parse_mixed_system_component_view_blocks() {
        let src = r#"
            system "sys-a" {
                component "inline-comp" { leaf = true }
            }

            component "shared-comp" {
                description = "top-level component"
                port "p1" { role = "provider" }
            }

            view "v1" {
                system = "sys-a"
            }
        "#;
        let path = PathBuf::from("test.hcl");
        let raw = parse_file(src, &path).unwrap();

        assert_eq!(raw.systems.len(), 1);
        assert_eq!(raw.systems[0].label, "sys-a");

        assert_eq!(raw.components.len(), 1);
        let comp = &raw.components[0];
        assert_eq!(comp.label, "shared-comp");
        assert_eq!(
            comp.inner.description.as_deref(),
            Some("top-level component")
        );
        assert_eq!(comp.inner.ports.len(), 1);
        assert_eq!(comp.inner.ports[0].label, "p1");

        assert_eq!(raw.views.len(), 1);
        assert_eq!(raw.views[0].label, "v1");
    }

    #[test]
    fn merge_top_level_components_from_multiple_files() {
        let src1 = r#"component "comp-a" { description = "first" }"#;
        let src2 = r#"component "comp-b" { description = "second" }"#;
        let path1 = PathBuf::from("file1.hcl");
        let path2 = PathBuf::from("file2.hcl");

        let file1 = parse_file(src1, &path1).unwrap();
        let file2 = parse_file(src2, &path2).unwrap();

        let mut merged = RawFile::default();
        merge_into(&mut merged, file1, &path1).unwrap();
        merge_into(&mut merged, file2, &path2).unwrap();

        assert_eq!(merged.components.len(), 2);
        let labels: Vec<&str> = merged.components.iter().map(|c| c.label.as_str()).collect();
        assert!(labels.contains(&"comp-a"));
        assert!(labels.contains(&"comp-b"));
    }
}
