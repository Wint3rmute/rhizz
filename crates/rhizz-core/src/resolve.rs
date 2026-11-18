use crate::model::{
    Component, ComponentId, ComponentKind, ComponentParent, Connection, ConnectionEndpoint,
    ConnectionId, Diagnostic, DiagnosticCode, Field, FieldId, Message, MessageId, Model, Port,
    PortId, Project, ProtocolId, Scope, ScopeIndex, System, SystemId,
};
use crate::parse::{Labeled, RawComponent, RawConnection, RawFile, RawMessage};
use std::collections::{HashMap, HashSet};
use tracing::instrument;

/// A system whose connections are processed after every instance is registered.
struct SystemWork {
    sid: SystemId,
    label: String,
    connections: Vec<Labeled<RawConnection>>,
}

// ── Resolver state ────────────────────────────────────────────────────────────

/// Internal state used throughout the resolution pass.
#[derive(Default)]
struct Resolver {
    /// The model being built.
    model: Model,
    /// Index for looking up entities by `(scope, label)`.
    scope_index: ScopeIndex,
    /// Accumulated diagnostics (errors and warnings).
    diagnostics: Vec<Diagnostic>,
    /// Maps system label -> `SystemId` for view resolution.
    system_label_index: HashMap<String, SystemId>,
    /// Maps protocol label -> `ProtocolId` for port protocol resolution.
    protocol_label_index: HashMap<String, ProtocolId>,
    /// Protocol labels that were referenced by at least one port.
    used_protocol_labels: HashSet<String>,
    /// Top-level component labels that were referenced by at least one `source` attribute.
    used_top_level_labels: HashSet<String>,
    /// `realized_by` entries that did not resolve, by declaring connection.
    unresolved_realized_by: Vec<(ConnectionId, String)>,
}

impl Resolver {
    /// Record an error diagnostic.
    fn push_error(&mut self, code: DiagnosticCode, msg: impl Into<String>) {
        self.diagnostics.push(Diagnostic::error(code, msg));
    }

    /// Record a warning diagnostic.
    fn push_warning(&mut self, code: DiagnosticCode, msg: impl Into<String>) {
        self.diagnostics.push(Diagnostic::warning(code, msg));
    }

    /// Reject block labels that are empty or contain `/` (E004): `/` is the
    /// path separator (SPEC.md §3), so such labels can never resolve as a
    /// single segment and would collide with projected port names
    /// (`B/input`). Returns `false` when the label was rejected and the
    /// caller must skip the block. Mirrors the editor-side
    /// `mutation/connect.ts:check_label` guard, which refuses the same labels
    /// before they reach the compiler.
    fn check_block_label(&mut self, label: &str, what: &str) -> bool {
        if label.is_empty() {
            self.push_error(
                DiagnosticCode::E004,
                format!("{what} label must not be empty"),
            );
            return false;
        }
        if label.contains('/') {
            self.push_error(
                DiagnosticCode::E004,
                format!("{what} label `{label}` must not contain `/`"),
            );
            return false;
        }
        true
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Resolve a merged `RawFile` into a fully cross-referenced `Model`.
///
/// On success returns `Ok((model, warnings))`.
/// If any hard errors (E-codes) were encountered returns `Err(all_diagnostics)`.
///
/// # Errors
///
/// Returns the full list of collected diagnostics when any blocking error
/// (E-code) was emitted during resolution.
#[instrument(skip(raw))]
pub fn resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>> {
    let r = resolve_pass(raw);

    // ── Return ────────────────────────────────────────────────────────────────
    let has_errors = r
        .diagnostics
        .iter()
        .any(super::diagnostics::Diagnostic::is_error);
    if has_errors {
        Err(r.diagnostics)
    } else {
        let warnings = r
            .diagnostics
            .into_iter()
            .filter(super::diagnostics::Diagnostic::is_warning)
            .collect();
        Ok((r.model, warnings))
    }
}

/// Run every resolution pass and keep the whole resolver state, errors included.
// Long but linear: phases A/B of resolution read top-to-bottom; splitting
// would thread `Resolver` through helpers without reducing complexity.
#[allow(clippy::too_many_lines)]
fn resolve_pass(raw: RawFile) -> Resolver {
    let mut r = Resolver::default();

    // ── Project ───────────────────────────────────────────────────────────────
    let p = raw.project.unwrap_or_default();
    r.model.project = Project {
        name: p.name.unwrap_or_default(),
        version: p.version.unwrap_or_else(|| "0.0.0".to_owned()),
        authors: p.authors,
    };

    // ── Protocols ─────────────────────────────────────────────────────────────
    let mut proto_seen: HashSet<String> = HashSet::new();
    for lp in raw.protocols {
        if !r.check_block_label(&lp.label, "protocol") {
            continue;
        }
        if !proto_seen.insert(lp.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!("duplicate protocol label `{}`", lp.label),
            );
            continue;
        }

        let proto_id = ProtocolId(r.model.protocols.len());
        r.protocol_label_index.insert(lp.label.clone(), proto_id);

        let roles = lp.inner.roles.unwrap_or_default();

        let msg_ids = process_messages(&mut r, &lp.inner.messages, 0, &lp.label);

        r.model.protocols.push(crate::model::Protocol {
            label: lp.label.clone(),
            full_name: lp.inner.full_name.unwrap_or_default(),
            tags: lp.inner.tags,
            roles,
            messages: msg_ids,
            leaf: lp.inner.leaf,
            encapsulates: lp.inner.encapsulates,
            encapsulates_ids: vec![],
        });
    }

    resolve_protocol_encapsulates(&mut r);

    // ── Systems ───────────────────────────────────────────────────────────────
    //
    // Two-phase loop per system so that system-level connections can reference
    // any direct-child instance regardless of declaration order.
    //
    // Phase A: allocate SystemId, register all instances (recursive)
    // Phase B: process system-level connections

    // Build the reusable-definition map for source resolution, and register
    // each top-level `component` block as a first-class definition in the model
    // (kind: Definition, no placement parent). A definition survives even with
    // zero current instances, so it can be defined ahead of use.
    let mut definitions: HashMap<String, RawComponent> = HashMap::new();
    let mut def_labels: Vec<String> = Vec::new();
    {
        let mut def_seen: HashSet<String> = HashSet::new();
        for lc in &raw.components {
            if !r.check_block_label(&lc.label, "component") {
                continue;
            }
            if !def_seen.insert(lc.label.clone()) {
                r.push_error(
                    DiagnosticCode::E001,
                    format!("duplicate top-level component label `{}`", lc.label),
                );
                continue;
            }
            definitions.insert(lc.label.clone(), lc.inner.clone());
            def_labels.push(lc.label.clone());
        }
    }

    // Register each definition now that the full map exists, so a definition's
    // own child instances can resolve forward references (definitions declared
    // later in the file). Cycle detection (E013) still uses the ancestors stack.
    let mut ancestors: Vec<String> = Vec::new();
    for label in &def_labels {
        let Some(body) = definitions.get(label) else {
            continue;
        };
        let cid = register_component_inner(
            &mut r,
            label,
            body,
            None,
            ComponentKind::Definition,
            None,
            None,
            0,
            &definitions,
            &mut ancestors,
        );
        r.model.definitions.push(cid);
    }

    let mut system_labels_seen: HashSet<String> = HashSet::new();

    let mut pending_systems: Vec<SystemWork> = Vec::new();

    for ls in raw.systems {
        if !r.check_block_label(&ls.label, "system") {
            continue;
        }
        if !system_labels_seen.insert(ls.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!("duplicate system label `{}`", ls.label),
            );
            continue;
        }

        let sid = SystemId(r.model.systems.len());
        r.system_label_index.insert(ls.label.clone(), sid);

        r.model.systems.push(System {
            label: ls.label.clone(),
            full_name: ls.inner.full_name.clone().unwrap_or_default(),
            icon: ls.inner.icon.clone(),
            tags: ls.inner.tags.clone(),
            components: vec![],
            connections: vec![],
        });

        // Phase A: register all direct-child instances (each one recursively
        // handles its cloned children, ports, and their nested connections).
        let scope = Scope::System(sid);
        let mut instance_labels_seen: HashSet<String> = HashSet::new();
        let mut child_ids: Vec<ComponentId> = Vec::new();
        let mut ancestors: Vec<String> = Vec::new();

        for li in &ls.inner.instances {
            if !r.check_block_label(&li.label, "instance") {
                continue;
            }
            if !instance_labels_seen.insert(li.label.clone()) {
                r.push_error(
                    DiagnosticCode::E001,
                    format!(
                        "duplicate instance label `{}` in system `{}`",
                        li.label, ls.label
                    ),
                );
                continue;
            }
            let cid = register_instance(
                &mut r,
                li,
                Some(scope),
                Some(ComponentParent::System(sid)),
                // Systems have no `level`; children default from an implicit
                // root of 0.
                0,
                &definitions,
                &mut ancestors,
            );
            child_ids.push(cid);
        }
        if let Some(system) = r.model.system_mut(sid) {
            system.components = child_ids;
        }

        pending_systems.push(SystemWork {
            sid,
            label: ls.label,
            connections: ls.inner.connections,
        });
    }

    // Phase B: system-level connections (systems are implicitly level 0).
    for sw in pending_systems {
        let scope = Scope::System(sw.sid);
        let decl = format!("system:{}", sw.label);
        let conn_ids =
            process_connections_in_scope(&mut r, &sw.connections, scope, 0, &sw.label, &decl);

        if let Some(system) = r.model.system_mut(sw.sid) {
            system.connections = conn_ids;
        }
    }

    // ── delegation: infer proxy port types (E021/E022) ───────────────────
    // Runs before `realized_by` so `connection_protocol` (E019 leaf checks,
    // W019/W020/W021) reads inherited values on assembly edges.
    resolve_delegation(&mut r);

    // ── realized_by: after every connection is registered ─────
    resolve_realized_by(&mut r);

    // ── E001: one connection name per system ─────────────────────────────────
    // View `connection` blocks are keyed by name, so one name must refer to
    // one declaration within a system. Copies of one declaration (each
    // instance clones its definition's connections) share `decl` and are one
    // connection for hiding and the sidebar; two different declarations
    // sharing a name in one system are rejected.
    {
        let mut errors: Vec<String> = Vec::new();
        // Snapshot per-system connection (label, decl) pairs first so the
        // error push below does not fight the model borrow.
        let mut per_system: Vec<(String, Vec<(String, String)>)> = Vec::new();
        for system in &r.model.systems {
            let mut pairs: Vec<(String, String)> = Vec::new();
            for cid in &system.connections {
                if let Some(conn) = r.model.connections.get(cid.0) {
                    pairs.push((conn.label.clone(), conn.decl.clone()));
                }
            }
            let mut stack: Vec<ComponentId> = system.components.clone();
            while let Some(cid) = stack.pop() {
                let Some(comp) = r.model.components.get(cid.0) else {
                    continue;
                };
                for ccid in &comp.connections.clone() {
                    if let Some(conn) = r.model.connections.get(ccid.0) {
                        pairs.push((conn.label.clone(), conn.decl.clone()));
                    }
                }
                stack.extend(comp.children.clone());
            }
            per_system.push((system.label.clone(), pairs));
        }
        for (system_label, pairs) in &per_system {
            let mut by_label: HashMap<&str, HashSet<&str>> = HashMap::new();
            let mut order: Vec<&str> = Vec::new();
            for (label, decl) in pairs {
                let entry = by_label.entry(label.as_str()).or_default();
                if entry.is_empty() {
                    order.push(label.as_str());
                }
                entry.insert(decl.as_str());
            }
            for label in order {
                if let Some(decls) = by_label.get(label)
                    && decls.len() > 1
                {
                    let mut sorted: Vec<&&str> = decls.iter().collect();
                    sorted.sort();
                    let locations = sorted
                        .iter()
                        .map(|d| format!("`{d}`"))
                        .collect::<Vec<_>>()
                        .join(" and ");
                    errors.push(format!(
                        "duplicate connection label `{label}` in system `{system_label}` (declared in {locations})"
                    ));
                }
            }
        }
        for msg in errors {
            r.push_error(DiagnosticCode::E001, msg);
        }
    }

    // ── W012: orphan protocols (reusable definitions are intentionally allowed
    // ── to exist with zero instances, so they are not flagged) ──────────────
    {
        let mut orphan_proto_labels: Vec<String> = r
            .protocol_label_index
            .keys()
            .filter(|label| !r.used_protocol_labels.contains(*label))
            .cloned()
            .collect();
        orphan_proto_labels.sort();
        for label in orphan_proto_labels {
            r.push_warning(
                DiagnosticCode::W012,
                format!("top-level protocol `{label}` is not referenced by any port"),
            );
        }
    }

    // ── Warnings ──────────────────────────────────────────────────────────────
    r.diagnostics.extend(crate::validate::validate(&r.model));

    r
}

// ── Component registration ────────────────────────────────────────────────────

/// Register a raw component (and its subtree) into the arena.
///
/// Order within each scope:
///   1. Register the component itself in `parent_scope`.
///   2. Register all child components in the component's own scope.
///   3. Process ports on the component.
///   4. Process connections in the component's own scope (from/to resolved).
///
/// When `lc.inner.source` is set the body is taken from the top-level
/// component map instead of from `lc.inner`.  The `ancestors` stack is used
/// for cycle detection (E013).
///
/// Register a reusable definition's body as a component into the arena
/// (used for both top-level definitions and cloned instance bodies).
///
/// `parent_scope` / `parent` are `None` for a reusable top-level definition
/// (declared outside any system). Such a component is added to
/// [`Model::definitions`] with `kind: Definition`, so it exists even before
/// any system instantiates it.
///
/// `source` is set when this is an instance (the definition label it reuses);
/// the body then comes from that definition rather than being an inline block.
// Long but linear: the five registration steps read top-to-bottom.
#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
fn register_component_inner(
    r: &mut Resolver,
    label: &str,
    body: &RawComponent,
    source: Option<String>,
    kind: ComponentKind,
    parent_scope: Option<Scope>,
    parent: Option<ComponentParent>,
    parent_level: i32,
    definitions: &HashMap<String, RawComponent>,
    ancestors: &mut Vec<String>,
) -> ComponentId {
    let initial_depth = ancestors.len();

    let cid = ComponentId(r.model.components.len());
    let level = body.level.unwrap_or_else(|| parent_level.saturating_add(1));
    let leaf = body.leaf.unwrap_or(false);

    // E005 -- leaf component with children or connections
    if leaf && (!body.instances.is_empty() || !body.connections.is_empty()) {
        r.push_error(
            DiagnosticCode::E005,
            format!("leaf component `{label}` contains children or connections"),
        );
    }

    // Register in parent scope so siblings can reference it. A reusable
    // definition (parent_scope None) has no siblings, so nothing to index.
    if let Some(parent_scope) = parent_scope {
        r.scope_index
            .components
            .insert((parent_scope, label.to_owned()), cid);
    }

    // Which declaration this body was cloned from. Copies of one declaration
    // share the value, so the whole-system duplicate check can tell copies
    // apart from different declarations that happen to share a name.
    // `source` is moved into the component below, so compute first.
    let decl = format!(
        "component:{}",
        source.clone().unwrap_or_else(|| label.to_owned())
    );
    // Push placeholder; children/ports/connections filled in below.
    r.model.components.push(Component {
        label: label.to_owned(),
        source,
        kind,
        full_name: body.full_name.clone().unwrap_or_default(),
        icon: body.icon.clone(),
        color: body.color.clone(),
        border: body.border,
        font: body.font.clone(),
        tags: body.tags.clone(),
        level,
        leaf,
        parent,
        children: vec![],
        ports: vec![],
        connections: vec![],
    });

    let child_scope = Scope::Component(cid);

    // Step 1: register child instances in this component's scope.
    let mut child_label_seen: HashSet<String> = HashSet::new();
    let mut child_ids: Vec<ComponentId> = Vec::new();
    for child_li in &body.instances {
        if !r.check_block_label(&child_li.label, "instance") {
            continue;
        }
        if !child_label_seen.insert(child_li.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate instance label `{}` in component `{}`",
                    child_li.label, label
                ),
            );
            continue;
        }
        let child_cid = register_instance(
            r,
            child_li,
            Some(child_scope),
            Some(ComponentParent::Component(cid)),
            level,
            definitions,
            ancestors,
        );
        child_ids.push(child_cid);
    }
    if let Some(component) = r.model.component_mut(cid) {
        component.children = child_ids;
    }

    // Step 2: process ports on this component.
    let port_ids = process_ports(r, &body.ports, cid, level, label);
    if let Some(component) = r.model.component_mut(cid) {
        component.ports = port_ids;
    }

    // Step 3: process connections in this component's scope.
    let conn_ids =
        process_connections_in_scope(r, &body.connections, child_scope, level, label, &decl);

    if let Some(component) = r.model.component_mut(cid) {
        component.connections = conn_ids;
    }

    // Restore ancestors to where they were before this call.
    ancestors.truncate(initial_depth);

    cid
}

/// Register an `instance "<local>" { source = "<definition>" }` block. Resolves
/// the `source` label against the definition map (following `source` chains with
/// cycle detection, emitting E013/E014 on problems), then clones the definition
/// body via [`register_component_inner`] with kind: Instance.
fn register_instance(
    r: &mut Resolver,
    li: &Labeled<crate::parse::RawInstance>,
    parent_scope: Option<Scope>,
    parent: Option<ComponentParent>,
    parent_level: i32,
    definitions: &HashMap<String, RawComponent>,
    ancestors: &mut Vec<String>,
) -> ComponentId {
    let Some(ref src_label) = li.inner.source else {
        // parse_instance guarantees a source, but guard defensively.
        r.push_error(
            DiagnosticCode::E014,
            format!("instance `{}` is missing a 'source' attribute", li.label),
        );
        let body = RawComponent::default();
        return register_component_inner(
            r,
            &li.label,
            &body,
            None,
            ComponentKind::Instance,
            parent_scope,
            parent,
            parent_level,
            definitions,
            ancestors,
        );
    };

    let Some(definition) = definitions.get(src_label) else {
        // E014: undefined source label.
        r.push_error(
            DiagnosticCode::E014,
            format!(
                "instance `{}` sources undefined definition `{}`",
                li.label, src_label
            ),
        );
        let body = RawComponent::default();
        return register_component_inner(
            r,
            &li.label,
            &body,
            Some(src_label.clone()),
            ComponentKind::Instance,
            parent_scope,
            parent,
            parent_level,
            definitions,
            ancestors,
        );
    };

    r.used_top_level_labels.insert(src_label.clone());

    register_component_inner(
        r,
        &li.label,
        definition,
        Some(src_label.clone()),
        ComponentKind::Instance,
        parent_scope,
        parent,
        parent_level,
        definitions,
        ancestors,
    )
}

// ── Port processing ───────────────────────────────────────────────────────────

/// Process port blocks on a component, returning their `PortId`s.
fn process_ports(
    r: &mut Resolver,
    ports: &[Labeled<crate::parse::RawPort>],
    owner: ComponentId,
    _parent_level: i32,
    comp_label: &str,
) -> Vec<PortId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut port_ids: Vec<PortId> = Vec::new();

    for lp in ports {
        if !r.check_block_label(&lp.label, "port") {
            continue;
        }
        if !label_seen.insert(lp.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate port label `{}` in component `{}`",
                    lp.label, comp_label
                ),
            );
            continue;
        }

        let role = lp.inner.role.clone();

        let proto_id = if let Some(ref proto_name) = lp.inner.protocol {
            if proto_name.is_empty() {
                None
            } else {
                r.used_protocol_labels.insert(proto_name.clone());
                if let Some(&pid) = r.protocol_label_index.get(proto_name) {
                    if let Some(proto) = r
                        .model
                        .protocol(pid)
                        .filter(|proto| !proto.roles.is_empty())
                    {
                        match &role {
                            Some(r_str) if proto.roles.contains(r_str) => {}
                            Some(invalid_role) => {
                                r.push_error(
                                    DiagnosticCode::E009,
                                    format!(
                                        "port `{}` in component `{}` has role `{}` which is not permitted by protocol `{}` (permitted: {:?})",
                                        lp.label, comp_label, invalid_role, proto_name, proto.roles
                                    ),
                                );
                            }
                            None => {
                                r.push_error(
                                    DiagnosticCode::E009,
                                    format!(
                                        "port `{}` in component `{}` must specify a role for protocol `{}` (permitted: {:?})",
                                        lp.label, comp_label, proto_name, proto.roles
                                    ),
                                );
                            }
                        }
                    }
                    Some(pid)
                } else {
                    r.push_warning(
                        DiagnosticCode::W014,
                        format!(
                            "port `{}` in component `{}` references undefined protocol `{}`",
                            lp.label, comp_label, proto_name
                        ),
                    );
                    None
                }
            }
        } else {
            None
        };

        let pid = PortId(r.model.ports.len());
        // Register in scope_index so connection endpoints can find it.
        r.scope_index.ports.insert((owner, lp.label.clone()), pid);

        r.model.ports.push(Port {
            label: lp.label.clone(),
            full_name: lp.inner.full_name.clone().unwrap_or_default(),
            protocol: lp.inner.protocol.clone().unwrap_or_default(),
            protocol_id: proto_id,
            role,
            external: lp.inner.external.unwrap_or(false),
            required: lp.inner.required.unwrap_or(true),
            tags: lp.inner.tags.clone(),
            owner,
            // Proxy candidacy (omitted `protocol`/`role`) is decided in
            // `resolve_delegation`, once every connection is registered.
            inferred: false,
            inferred_from: None,
        });
        port_ids.push(pid);
    }

    port_ids
}

// ── Connection processing ─────────────────────────────────────────────────────

/// Process all connections declared in a single scope.
///
/// Precondition: all sibling components in `scope` must already be registered
/// in `r.scope_index.components`.
///
/// Returns the `ConnectionId`s in declaration order.
fn process_connections_in_scope(
    r: &mut Resolver,
    connections: &[Labeled<RawConnection>],
    scope: Scope,
    parent_level: i32,
    scope_name: &str,
    decl: &str,
) -> Vec<ConnectionId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut conn_ids: Vec<ConnectionId> = Vec::new();

    for lc in connections {
        if !r.check_block_label(&lc.label, "connection") {
            continue;
        }
        if !label_seen.insert(lc.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate connection label `{}` in `{}`",
                    lc.label, scope_name
                ),
            );
            continue;
        }

        let level = lc
            .inner
            .level
            .unwrap_or_else(|| parent_level.saturating_add(1));

        // Resolve `from` endpoint
        let from = resolve_endpoint(r, lc.inner.from.as_deref(), scope, &lc.label, "from");

        // Resolve `to` endpoint
        let to = resolve_endpoint(r, lc.inner.to.as_deref(), scope, &lc.label, "to");

        // Allocate ConnectionId and register in scope so realized_by can find it.
        let conn_id = ConnectionId(r.model.connections.len());
        r.scope_index
            .connections
            .insert((scope, lc.label.clone()), conn_id);

        // Use ComponentId(usize::MAX) as a sentinel when a reference failed; the
        // error has already been recorded above, and the model is never returned
        // in the error case, so this sentinel is never visible to callers.
        let sentinel = ConnectionEndpoint {
            component: ComponentId(usize::MAX),
            port: None,
            is_self: false,
        };
        let from_ep = from.unwrap_or_else(|| sentinel.clone());
        let to_ep = to.unwrap_or(sentinel);

        // Validate Lowest Common Ancestor (LCA) placement
        if from_ep.component.0 != usize::MAX && to_ep.component.0 != usize::MAX {
            let from_ok = is_ancestor_or_self(&r.model, scope, from_ep.component);
            let to_ok = is_ancestor_or_self(&r.model, scope, to_ep.component);
            if !from_ok || !to_ok {
                r.push_error(
                    DiagnosticCode::E015,
                    format!(
                        "connection `{}` is declared in `{}` which is not an ancestor of both endpoints (declared outside Lowest Common Ancestor)",
                        lc.label, scope_name
                    ),
                );
            }
            // Delegation lives in its owner by definition: the self end's
            // component must be the declaring scope itself.
            if from_ep.is_self ^ to_ep.is_self {
                let self_cid = if from_ep.is_self {
                    from_ep.component
                } else {
                    to_ep.component
                };
                if Scope::Component(self_cid) != scope {
                    r.push_error(
                        DiagnosticCode::E015,
                        format!(
                            "connection `{}` is a delegation edge and must be declared inside its owning component",
                            lc.label
                        ),
                    );
                }
            }
        }

        let is_delegation = from_ep.is_self ^ to_ep.is_self;
        if from_ep.is_self && to_ep.is_self {
            r.push_error(
                DiagnosticCode::E022,
                format!(
                    "connection `{}` has two self (`./port`) endpoints; a delegation edge must have exactly one",
                    lc.label
                ),
            );
        }
        if is_delegation && !lc.inner.realized_by.is_empty() {
            r.push_error(
                DiagnosticCode::E019,
                format!(
                    "connection `{}` is a delegation edge and must not declare `realized_by`",
                    lc.label
                ),
            );
        }

        r.model.connections.push(Connection {
            label: lc.label.clone(),
            decl: decl.to_owned(),
            full_name: lc.inner.full_name.clone().unwrap_or_default(),
            tags: lc.inner.tags.clone(),
            level,
            from: from_ep,
            to: to_ep,
            realized_by: lc.inner.realized_by.clone(),
            realized_by_ids: vec![], // filled by resolve_realized_by
            is_delegation,
        });

        conn_ids.push(conn_id);
    }

    conn_ids
}

/// Checks whether `ancestor_scope` is an ancestor of `cid` or is `Scope::Component(cid)`.
fn is_ancestor_or_self(model: &Model, ancestor_scope: Scope, cid: ComponentId) -> bool {
    let mut current_cid = cid;
    loop {
        if Scope::Component(current_cid) == ancestor_scope {
            return true;
        }
        match model.component(current_cid).map(|c| c.parent) {
            Some(Some(ComponentParent::Component(parent_cid))) => {
                current_cid = parent_cid;
            }
            Some(Some(ComponentParent::System(parent_sid))) => {
                return Scope::System(parent_sid) == ancestor_scope;
            }
            Some(None) | None => {
                return false;
            }
        }
    }
}

/// Why a path walk stopped before the end of its segments.
#[derive(Debug, PartialEq, Eq)]
enum WalkError {
    /// A segment names no component in the scope it was looked up in.
    NotFound(String),
    /// `..` used at a system, which has no parent scope.
    AboveSystem,
    /// `..` used at a top-level definition, which has no parent scope.
    AboveDefinition,
}

/// Walk `segments` from `start` through `.`, `..` and child components and
/// return the scope they lead to. Shared by endpoint resolution and
/// `realized_by` resolution, so both read paths the same way.
fn walk_scope(r: &Resolver, start: Scope, segments: &[&str]) -> Result<Scope, WalkError> {
    let mut current = start;
    for &seg in segments {
        current = match seg {
            "." => current,
            ".." => match current {
                Scope::System(_) => return Err(WalkError::AboveSystem),
                Scope::Component(cid) => match r.model.component(cid).and_then(|c| c.parent) {
                    Some(ComponentParent::Component(parent)) => Scope::Component(parent),
                    Some(ComponentParent::System(sid)) => Scope::System(sid),
                    None => return Err(WalkError::AboveDefinition),
                },
            },
            name => match r.scope_index.components.get(&(current, name.to_owned())) {
                Some(cid) => Scope::Component(*cid),
                None => return Err(WalkError::NotFound(name.to_owned())),
            },
        };
    }
    Ok(current)
}

/// Scope of the system with the given label.
fn system_scope(r: &Resolver, label: &str) -> Option<Scope> {
    r.system_label_index
        .get(label)
        .map(|sid| Scope::System(*sid))
}

/// Report a failed endpoint walk. A `..` above a top-level definition is
/// silent, as it always was for endpoints.
fn report_endpoint_walk_error(
    r: &mut Resolver,
    err: WalkError,
    conn_label: &str,
    raw: &str,
    field: &str,
    segment_count: usize,
) {
    match err {
        WalkError::AboveDefinition => {}
        WalkError::AboveSystem => r.push_error(
            DiagnosticCode::E002,
            format!(
                "connection `{conn_label}` cannot navigate above root system with '..' in path `{raw}`"
            ),
        ),
        WalkError::NotFound(seg) => {
            let err_code = if segment_count > 1 {
                DiagnosticCode::E011
            } else {
                DiagnosticCode::E002
            };
            r.push_error(
                err_code,
                format!(
                    "connection `{conn_label}` references undefined component `{seg}` in '{field}'"
                ),
            );
        }
    }
}

/// Validate an endpoint string and split it into `/`-separated segments.
/// Reports E002 for a missing, empty, colon-notation or segment-less path.
fn endpoint_segments<'a>(
    r: &mut Resolver,
    ref_str: Option<&'a str>,
    conn_label: &str,
    field: &str,
) -> Option<(&'a str, Vec<&'a str>)> {
    let raw = match ref_str {
        None => {
            r.push_error(
                DiagnosticCode::E002,
                format!("connection `{conn_label}` is missing required '{field}' attribute"),
            );
            return None;
        }
        Some(s) => s.trim(),
    };

    if raw.is_empty() {
        r.push_error(
            DiagnosticCode::E002,
            format!("connection `{conn_label}` has empty '{field}' attribute"),
        );
        return None;
    }

    if raw.contains(':') {
        r.push_error(
            DiagnosticCode::E002,
            format!(
                "connection `{conn_label}` has invalid non-UNIX path `{raw}` in '{field}' (colon notation is not supported; use '/' path notation)"
            ),
        );
        return None;
    }

    let raw_segments: Vec<&str> = raw.split('/').filter(|s| !s.is_empty()).collect();
    if raw_segments.is_empty() {
        r.push_error(
            DiagnosticCode::E002,
            format!("connection `{conn_label}` references empty path in '{field}'"),
        );
        return None;
    }
    Some((raw, raw_segments))
}

/// Reject a bare single segment that names a component or an own port.
/// Only `"./port"` names the declaring scope's own port (delegation).
/// Anything else bare falls through to the usual undefined-component errors
/// (E002/E011). Returns `true` when an error was emitted.
fn reject_bare_segment(
    r: &mut Resolver,
    scope: Scope,
    segments: &[&str],
    conn_label: &str,
    field: &str,
) -> bool {
    if segments.len() != 1 {
        return false;
    }
    let Some(seg) = segments.first() else {
        return false;
    };
    let names_component = r
        .scope_index
        .components
        .contains_key(&(scope, (*seg).to_owned()));
    let names_own_port = match scope {
        Scope::Component(cid) => r.scope_index.ports.contains_key(&(cid, (*seg).to_owned())),
        Scope::System(_) => false,
    };
    if !(names_component || names_own_port) {
        return false;
    }
    r.push_error(
        DiagnosticCode::E003,
        format!(
            "connection `{conn_label}` requires a port path in '{field}' (e.g. `comp/port` or `./port` for the declaring scope's own port)"
        ),
    );
    true
}

/// Resolve a single `from` or `to` string into a `ConnectionEndpoint`.
///
/// Supports UNIX-style path notation:
/// - Relative sibling port: `"comp/port"`
/// - Nested ports: `"comp/subcomp/port"`
/// - Parent traversal: `"../sibling/port"`
/// - Absolute root path: `"/system-name/comp/subcomp/port"`
/// - Own port: `"./port"` (delegation only)
///
/// Returns `None` and emits the appropriate error if resolution fails.
fn resolve_endpoint(
    r: &mut Resolver,
    ref_str: Option<&str>,
    scope: Scope,
    conn_label: &str,
    field: &str,
) -> Option<ConnectionEndpoint> {
    let (raw, raw_segments) = endpoint_segments(r, ref_str, conn_label, field)?;
    let is_absolute = raw.starts_with('/');

    // Absolute paths start after the leading system segment; relative paths
    // start at the declaring scope and use every segment.
    let (start, path): (Scope, &[&str]) = if is_absolute {
        let system_label = raw_segments.first().copied().unwrap_or_default();
        let Some(scope) = system_scope(r, system_label) else {
            r.push_error(
                DiagnosticCode::E002,
                format!(
                    "connection `{conn_label}` references undefined system `{system_label}` in path `{raw}`"
                ),
            );
            return None;
        };
        (scope, raw_segments.get(1..).unwrap_or_default())
    } else {
        (scope, raw_segments.as_slice())
    };

    let Some((&last, prefix)) = path.split_last() else {
        // Absolute path pointed to just the system itself
        r.push_error(
            DiagnosticCode::E002,
            format!(
                "connection `{conn_label}` references system instead of component in path `{raw}`"
            ),
        );
        return None;
    };

    if !is_absolute && reject_bare_segment(r, scope, path, conn_label, field) {
        return None;
    }

    if last == "." || last == ".." {
        // A trailing `.` or `..` names neither a component nor a port: walk
        // the path for its errors, then give no endpoint (as before).
        if let Err(err) = walk_scope(r, start, path) {
            report_endpoint_walk_error(r, err, conn_label, raw, field, raw_segments.len());
        }
        return None;
    }

    let owner_scope = match walk_scope(r, start, prefix) {
        Ok(owner_scope) => owner_scope,
        Err(err) => {
            report_endpoint_walk_error(r, err, conn_label, raw, field, raw_segments.len());
            return None;
        }
    };

    // The last segment names a port on the component found via `prefix`.
    // A component match without a port is E003.
    if r.scope_index
        .components
        .contains_key(&(owner_scope, last.to_owned()))
    {
        r.push_error(
            DiagnosticCode::E003,
            format!(
                "connection `{conn_label}` requires a port path in '{field}' (e.g. `comp/port`)"
            ),
        );
        return None;
    }
    if let Scope::Component(cid) = owner_scope {
        if let Some(pid) = r.scope_index.ports.get(&(cid, last.to_owned())) {
            // A `./port` endpoint resolves against the declaring scope itself.
            let is_self = owner_scope == scope;
            return Some(ConnectionEndpoint {
                component: cid,
                port: Some(*pid),
                is_self,
            });
        }
        let comp_label = r
            .model
            .component(cid)
            .map(|c| c.label.clone())
            .unwrap_or_default();
        r.push_error(
            DiagnosticCode::E010,
            format!(
                "connection `{conn_label}`: component `{comp_label}` has no port `{last}` (in '{field}')"
            ),
        );
        return None;
    }

    report_endpoint_walk_error(
        r,
        WalkError::NotFound(last.to_owned()),
        conn_label,
        raw,
        field,
        raw_segments.len(),
    );
    None
}

/// Resolve protocol `encapsulates` labels to [`ProtocolId`]s (`W022` for labels
/// naming no top-level protocol), then reject cycles (`E020`).
fn resolve_protocol_encapsulates(r: &mut Resolver) {
    let labels: Vec<String> = r.model.protocols.iter().map(|p| p.label.clone()).collect();

    let mut graph: Vec<Vec<ProtocolId>> = Vec::with_capacity(labels.len());
    let mut warnings: Vec<String> = Vec::new();
    for proto in &r.model.protocols {
        let mut ids: Vec<ProtocolId> = Vec::new();
        for target in &proto.encapsulates {
            match r.protocol_label_index.get(target).copied() {
                Some(pid) if !ids.contains(&pid) => ids.push(pid),
                Some(_) => {}
                None => warnings.push(format!(
                    "protocol `{}` encapsulates undefined protocol `{target}`",
                    proto.label
                )),
            }
        }
        graph.push(ids);
    }
    for msg in warnings {
        r.push_warning(DiagnosticCode::W022, msg);
    }

    // Visit roots in label order so that the reported cycles are deterministic.
    let mut roots: Vec<usize> = (0..labels.len()).collect();
    roots.sort_by_key(|i| labels.get(*i).cloned());

    let mut state = vec![VisitState::Unvisited; labels.len()];
    let mut path: Vec<usize> = Vec::new();
    let mut chains: Vec<String> = Vec::new();
    for root in roots {
        if state.get(root) == Some(&VisitState::Unvisited) {
            visit_protocol_encapsulates(
                root,
                &mut graph,
                &labels,
                &mut state,
                &mut path,
                &mut chains,
            );
        }
    }
    for chain in chains {
        r.push_error(
            DiagnosticCode::E020,
            format!("circular protocol encapsulation: {chain}"),
        );
    }

    for (proto, ids) in r.model.protocols.iter_mut().zip(graph) {
        proto.encapsulates_ids = ids;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VisitState {
    Unvisited,
    OnPath,
    Done,
}

/// DFS step of the `encapsulates` cycle check. Each back edge closes one cycle,
/// which is recorded in `chains` and removed from `graph`, so the remaining
/// graph is acyclic.
fn visit_protocol_encapsulates(
    node: usize,
    graph: &mut [Vec<ProtocolId>],
    labels: &[String],
    state: &mut [VisitState],
    path: &mut Vec<usize>,
    chains: &mut Vec<String>,
) {
    if let Some(slot) = state.get_mut(node) {
        *slot = VisitState::OnPath;
    }
    path.push(node);

    let successors = graph.get(node).cloned().unwrap_or_default();
    let mut kept: Vec<ProtocolId> = Vec::with_capacity(successors.len());
    for succ in successors {
        let next = succ.0;
        match state.get(next).copied().unwrap_or(VisitState::Done) {
            VisitState::OnPath => {
                let start = path.iter().position(|&p| p == next).unwrap_or(0);
                let mut chain: Vec<String> = path
                    .get(start..)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&p| labels.get(p).cloned())
                    .collect();
                if let Some(first) = chain.first().cloned() {
                    chain.push(first);
                }
                let shown = chain
                    .iter()
                    .map(|l| format!("`{l}`"))
                    .collect::<Vec<_>>()
                    .join(" -> ");
                chains.push(shown);
                // The back edge is dropped, so this cycle cannot recur.
            }
            VisitState::Unvisited => {
                kept.push(succ);
                visit_protocol_encapsulates(next, graph, labels, state, path, chains);
            }
            VisitState::Done => kept.push(succ),
        }
    }
    if let Some(slot) = graph.get_mut(node) {
        *slot = kept;
    }

    path.pop();
    if let Some(slot) = state.get_mut(node) {
        *slot = VisitState::Done;
    }
}

// ── Message / Field processing ────────────────────────────────────────────────

/// Process message blocks within a port, returning their `MessageId`s.
fn process_messages(
    r: &mut Resolver,
    messages: &[Labeled<RawMessage>],
    parent_level: i32,
    proto_label: &str,
) -> Vec<MessageId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut msg_ids: Vec<MessageId> = Vec::new();

    for lm in messages {
        if !r.check_block_label(&lm.label, "message") {
            continue;
        }
        if !label_seen.insert(lm.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate message label `{}` in protocol `{}`",
                    lm.label, proto_label
                ),
            );
            continue;
        }

        let level = lm.inner.level.unwrap_or(parent_level);
        let field_ids = process_fields(r, &lm.inner.fields, &lm.label);

        let mid = MessageId(r.model.messages.len());
        r.model.messages.push(Message {
            label: lm.label.clone(),
            full_name: lm.inner.full_name.clone().unwrap_or_default(),
            tags: lm.inner.tags.clone(),
            level,
            fields: field_ids,
        });
        msg_ids.push(mid);
    }

    msg_ids
}

/// Process field blocks within a message, returning their `FieldId`s.
fn process_fields(
    r: &mut Resolver,
    fields: &[Labeled<crate::parse::RawField>],
    msg_label: &str,
) -> Vec<FieldId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut field_ids: Vec<FieldId> = Vec::new();

    for lf in fields {
        if !r.check_block_label(&lf.label, "field") {
            continue;
        }
        if !label_seen.insert(lf.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate field label `{}` in message `{}`",
                    lf.label, msg_label
                ),
            );
            continue;
        }

        // E007 -- missing required `type`
        let field_type = lf.inner.field_type.as_ref().map_or_else(
            || {
                r.push_error(
                    DiagnosticCode::E007,
                    format!(
                        "field `{}` in message `{}` is missing required 'type'",
                        lf.label, msg_label
                    ),
                );
                String::new()
            },
            std::clone::Clone::clone,
        );

        let fid = FieldId(r.model.fields.len());
        r.model.fields.push(Field {
            label: lf.label.clone(),
            field_type,
            full_name: lf.inner.full_name.clone().unwrap_or_default(),
            unit: lf.inner.unit.clone().unwrap_or_default(),
            required: lf.inner.required.unwrap_or(false),
        });
        field_ids.push(fid);
    }

    field_ids
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// ── realized_by (E017, E018, E019) ───────────────────────────────────────────

/// A `realized_by` entry that did not resolve, with the connection declaring it
/// identified by its raw owner, so mutations can edit the raw source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UnresolvedRealizedBy {
    /// Raw block the declaring connection was written in.
    pub(crate) owner: RawOwner,
    /// Label of the declaring connection within that block.
    pub(crate) label: String,
    /// The `realized_by` entry exactly as written.
    pub(crate) entry: String,
}

/// A raw block that declares connections.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RawOwner {
    /// A `system` block, by label.
    System(String),
    /// A top-level `component` definition, by label.
    Definition(String),
}

/// Raw `realized_by` entries that do not resolve, for mutations that delete
/// connections. Runs the resolver and ignores every other diagnostic.
pub(crate) fn unresolved_realized_by(raw: RawFile) -> Vec<UnresolvedRealizedBy> {
    let r = resolve_pass(raw);
    r.unresolved_realized_by
        .iter()
        .filter_map(|(cid, entry)| {
            let conn = r.model.connection(*cid)?;
            let owner = if let Some(label) = conn.decl.strip_prefix("system:") {
                RawOwner::System(label.to_owned())
            } else {
                RawOwner::Definition(conn.decl.strip_prefix("component:")?.to_owned())
            };
            Some(UnresolvedRealizedBy {
                owner,
                label: conn.label.clone(),
                entry: entry.clone(),
            })
        })
        .collect()
}

/// Human-readable path of a scope, e.g. `banking/bank-a`.
fn scope_path(model: &Model, scope: Scope) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current = scope;
    loop {
        match current {
            Scope::System(sid) => {
                parts.push(
                    model
                        .system(sid)
                        .map(|s| s.label.clone())
                        .unwrap_or_default(),
                );
                break;
            }
            Scope::Component(cid) => {
                let Some(comp) = model.component(cid) else {
                    break;
                };
                parts.push(comp.label.clone());
                match comp.parent {
                    Some(ComponentParent::Component(parent)) => {
                        current = Scope::Component(parent);
                    }
                    Some(ComponentParent::System(sid)) => current = Scope::System(sid),
                    None => break,
                }
            }
        }
    }
    parts.reverse();
    parts.join("/")
}

/// The system or top-level definition a scope belongs to.
fn scope_root(model: &Model, scope: Scope) -> Scope {
    let mut current = scope;
    while let Scope::Component(cid) = current {
        match model.component(cid).and_then(|c| c.parent) {
            Some(ComponentParent::Component(parent)) => current = Scope::Component(parent),
            Some(ComponentParent::System(sid)) => return Scope::System(sid),
            None => return current,
        }
    }
    current
}

/// Infer proxy port types along delegation chains (`SPEC.md` §2.6/§2.7).
///
/// A port that omits `protocol`/`role` and appears as the self endpoint of
/// exactly one delegation edge in its owner inherits both (transitively) from
/// the delegation target. Chains abort past 1024 hops (`E021`); exclusivity
/// and shape violations are `E022`. Errors are reported once per top-level
/// definition — instance copies share the declaration — while inherited values
/// are filled on every copy.
fn resolve_delegation(r: &mut Resolver) {
    let (single_edge, multi_edge) = delegation_edges(r);
    let candidates = proxy_candidates(&r.model);
    let explicit_self = explicitly_typed_self_ends(&single_edge, &multi_edge, &candidates);
    infer_proxy_types(r, &single_edge, &candidates);
    check_delegation_shapes(r, &single_edge, &multi_edge, &explicit_self, &candidates);
}

/// Ports that omit `protocol` and `role`: proxy candidates.
fn proxy_candidates(model: &Model) -> HashSet<PortId> {
    model
        .ports
        .iter()
        .enumerate()
        .filter(|(_, p)| p.protocol.is_empty() && p.role.is_none())
        .map(|(i, _)| PortId(i))
        .collect()
}

/// In-scope self-endpoint uses per outer port: `outer -> target` for outers
/// with exactly one self edge, or fan-out membership otherwise. An entry
/// exists for every connection declared in the owner's own scope whose self
/// end names the port (delegation or both-self assembly). Built for every
/// owner (definitions and instance copies alike) so chain following works per
/// copy; diagnostics only fire for definitions.
fn delegation_edges(r: &Resolver) -> (HashMap<PortId, PortId>, HashSet<PortId>) {
    let mut self_uses: HashMap<PortId, Vec<(ConnectionId, Option<PortId>)>> = HashMap::new();
    for comp in &r.model.components {
        for cid in &comp.connections {
            let Some(conn) = r.model.connection(*cid) else {
                continue;
            };
            let ends = [&conn.from, &conn.to];
            // The non-self end of a delegation edge is its target; a
            // both-self assembly edge carries no target.
            let target = if conn.is_delegation {
                ends.iter()
                    .find_map(|end| if end.is_self { None } else { end.port })
            } else {
                None
            };
            for end in ends {
                if !end.is_self {
                    continue;
                }
                let Some(outer) = end.port else {
                    continue;
                };
                // A both-self assembly edge still counts as a self use.
                self_uses.entry(outer).or_default().push((*cid, target));
            }
        }
    }
    // Single in-scope self edge per outer port: `outer -> target`.
    let mut single_edge: HashMap<PortId, PortId> = HashMap::new();
    // Outers with more than one in-scope self edge (fan-out).
    let mut multi_edge: HashSet<PortId> = HashSet::new();
    for (outer, uses) in &self_uses {
        if uses.len() == 1 {
            if let Some(target) = uses.first().and_then(|(_, target)| *target) {
                single_edge.insert(*outer, target);
            } else {
                // Both-self assembly edge: a self use with no target.
                multi_edge.insert(*outer);
            }
        } else {
            multi_edge.insert(*outer);
        }
    }
    (single_edge, multi_edge)
}

/// Explicitly typed ports used as a self endpoint (never inferred).
fn explicitly_typed_self_ends(
    single_edge: &HashMap<PortId, PortId>,
    multi_edge: &HashSet<PortId>,
    candidates: &HashSet<PortId>,
) -> HashSet<PortId> {
    single_edge
        .keys()
        .chain(multi_edge.iter())
        .copied()
        .filter(|pid| !candidates.contains(pid))
        .collect()
}

/// Fill inherited `protocol`/`role` on every copy (definitions and
/// instances) by following each single-edge chain to its terminal port.
/// Chains abort past 1024 hops (`E021`, once per definition).
fn infer_proxy_types(
    r: &mut Resolver,
    single_edge: &HashMap<PortId, PortId>,
    candidates: &HashSet<PortId>,
) {
    const MAX_HOPS: usize = 1024;
    let mut memo: HashMap<PortId, (Option<PortId>, usize)> = HashMap::new();
    let mut fills: Vec<InferredPort> = Vec::new();
    let mut inferred: Vec<PortId> = Vec::new();
    let mut depth_errors: Vec<(PortId, String)> = Vec::new();
    // Deterministic order so diagnostics read stable across runs.
    let mut outers: Vec<PortId> = single_edge.keys().copied().collect();
    outers.sort_by_key(|p| p.0);
    for outer in outers {
        if !candidates.contains(&outer) {
            continue;
        }
        // Shape gate: inference only for boundary ports on non-leaf owners.
        let Some(owner) = r.model.port(outer).map(|p| p.owner) else {
            continue;
        };
        let shape_ok = r.model.component(owner).is_some_and(|c| !c.leaf)
            && r.model.port(outer).is_some_and(|p| p.external);
        if !shape_ok {
            continue;
        }
        let (terminal, exceeded) =
            follow_delegation_chain(single_edge, candidates, &mut memo, outer, MAX_HOPS);
        let Some(tpid) = terminal else {
            if exceeded {
                let owner_label = r
                    .model
                    .component(owner)
                    .map_or_else(String::new, |c| c.label.clone());
                let port_label = r
                    .model
                    .port(outer)
                    .map_or_else(String::new, |p| p.label.clone());
                depth_errors.push((outer, format!(
                    "proxy port `{port_label}` in component `{owner_label}` exceeds the 1024-hop delegation limit"
                )));
            }
            continue;
        };
        if let Some(tport) = r.model.port(tpid) {
            fills.push((
                outer,
                tport.protocol.clone(),
                tport.protocol_id,
                tport.role.clone(),
                tpid,
            ));
            inferred.push(outer);
        }
    }
    for (pid, protocol, protocol_id, role, terminal) in fills {
        if let Some(port) = r.model.ports.get_mut(pid.0) {
            port.protocol = protocol;
            port.protocol_id = protocol_id;
            port.role = role;
            port.inferred_from = Some(terminal);
        }
    }
    for pid in inferred {
        if let Some(port) = r.model.ports.get_mut(pid.0) {
            port.inferred = true;
        }
    }
    // Depth errors fire once per definition (copies share the declaration).
    for (pid, msg) in depth_errors {
        let is_def = r
            .model
            .port(pid)
            .and_then(|p| r.model.component(p.owner))
            .is_some_and(|c| c.kind == ComponentKind::Definition);
        if is_def {
            r.push_error(DiagnosticCode::E021, msg);
        }
    }
}

/// E022 shape + exclusivity checks, once per definition (instance copies
/// share the declaration).
fn check_delegation_shapes(
    r: &mut Resolver,
    single_edge: &HashMap<PortId, PortId>,
    multi_edge: &HashSet<PortId>,
    explicit_self: &HashSet<PortId>,
    candidates: &HashSet<PortId>,
) {
    let mut e022: Vec<String> = Vec::new();
    for comp in &r.model.components {
        if comp.kind != ComponentKind::Definition {
            continue;
        }
        // Shape: inferred candidates require `external = true` and non-leaf.
        for pid in &comp.ports {
            let Some(port) = r.model.port(*pid) else {
                continue;
            };
            // Only ports that participate in delegation (or omit their type
            // while a delegation edge exists nearby) are proxy candidates.
            let participates = single_edge.contains_key(pid)
                || multi_edge.contains(pid)
                || explicit_self.contains(pid);
            if !participates {
                continue;
            }
            if candidates.contains(pid) {
                if comp.leaf {
                    e022.push(format!(
                        "proxy port `{}` in leaf component `{}` cannot delegate (a leaf has no children)",
                        port.label, comp.label
                    ));
                } else if !port.external {
                    e022.push(format!(
                        "proxy port `{}` in component `{}` must set `external = true`",
                        port.label, comp.label
                    ));
                }
            } else if explicit_self.contains(pid) {
                e022.push(format!(
                    "port `{}` in component `{}` declares `protocol`/`role` and must not be a delegation endpoint (omit both to declare a proxy port)",
                    port.label, comp.label
                ));
            }
        }
        // D1: an inferred outer appears as the self endpoint in exactly one
        // in-scope connection. Omission without any self use keeps today's
        // meaning (undefined port), so only multi-use (fan-out) reports here;
        // a misplaced edge (declared outside the owner) is already E015.
        for pid in &comp.ports {
            if !candidates.contains(pid) {
                continue;
            }
            let in_scope_uses = comp
                .connections
                .iter()
                .filter_map(|cid| r.model.connection(*cid))
                .filter(|conn| {
                    [&conn.from, &conn.to]
                        .iter()
                        .any(|end| end.is_self && end.port == Some(*pid))
                })
                .count();
            if in_scope_uses > 1 {
                let port_label = r
                    .model
                    .port(*pid)
                    .map_or_else(String::new, |p| p.label.clone());
                e022.push(format!(
                    "proxy port `{port_label}` in component `{}` fans out to {in_scope_uses} delegation edges (a proxy port must delegate to exactly one child port)",
                    comp.label
                ));
            }
        }
        // D2: a delegation target appears in no other in-scope connection.
        for cid in &comp.connections {
            let Some(conn) = r.model.connection(*cid) else {
                continue;
            };
            if !conn.is_delegation {
                continue;
            }
            let target = if conn.from.is_self {
                conn.to.port
            } else {
                conn.from.port
            };
            let Some(target) = target else {
                continue;
            };
            let target_label = r
                .model
                .port(target)
                .map_or_else(String::new, |p| p.label.clone());
            let others = comp
                .connections
                .iter()
                .filter(|other| **other != *cid)
                .filter_map(|other| r.model.connection(*other))
                .any(|other| other.from.port == Some(target) || other.to.port == Some(target));
            if others {
                e022.push(format!(
                    "delegation target `{target_label}` in component `{}` is double-driven (it must appear in no other connection in the same scope)",
                    comp.label
                ));
            }
        }
    }
    for msg in e022 {
        r.push_error(DiagnosticCode::E022, msg);
    }
}

/// One inferred proxy port: its id, inherited type, and terminal port.
type InferredPort = (PortId, String, Option<ProtocolId>, Option<String>, PortId);

/// Follow a delegation chain from `start` through `single_edge` (outer ->
/// target for outers with exactly one in-scope self edge). `candidates` holds
/// the syntactically omitted ports. Returns the terminal port and whether the
/// `max_hops` cap was exceeded. Suffixes are memoized in `memo` (port ->
/// (terminal, hops from here)) so deep models stay linear.
fn follow_delegation_chain(
    single_edge: &HashMap<PortId, PortId>,
    candidates: &HashSet<PortId>,
    memo: &mut HashMap<PortId, (Option<PortId>, usize)>,
    start: PortId,
    max_hops: usize,
) -> (Option<PortId>, bool) {
    let mut path: Vec<PortId> = vec![start];
    let mut current = match single_edge.get(&start) {
        Some(next) => *next,
        None => return (None, false),
    };
    let mut hops: usize = 1;
    let terminal: Option<PortId> = loop {
        if let Some(&(memo_term, memo_hops)) = memo.get(&current) {
            hops = hops.saturating_add(memo_hops);
            if hops > max_hops {
                break None;
            }
            break memo_term;
        }
        if !candidates.contains(&current) {
            break Some(current);
        }
        let Some(&next) = single_edge.get(&current) else {
            // Dangling intermediate: no edge to follow.
            break Some(current);
        };
        path.push(current);
        hops = hops.saturating_add(1);
        if hops > max_hops {
            break None;
        }
        current = next;
    };
    let exceeded = terminal.is_none();
    let total = hops;
    for (i, pid) in path.iter().enumerate() {
        memo.insert(*pid, (terminal, total.saturating_sub(i)));
    }
    (terminal, exceeded)
}

/// Resolve one `realized_by` entry written in `declaring`. The last segment is
/// a connection label; the segments before it are walked like an endpoint's
/// component path. The target must share the declaring system or definition
/// tree. Failures return the reason, which the caller puts in `E017`.
fn resolve_realized_by_entry(
    r: &Resolver,
    entry: &str,
    declaring: Scope,
) -> Result<ConnectionId, String> {
    let not_a_connection = || "the path must end in a connection label".to_owned();
    let segments: Vec<&str> = entry.split('/').filter(|s| !s.is_empty()).collect();
    let (start, path): (Scope, &[&str]) = if entry.starts_with('/') {
        let Some((&system_label, rest)) = segments.split_first() else {
            return Err(not_a_connection());
        };
        let Some(scope) = system_scope(r, system_label) else {
            return Err(format!("no system `{system_label}`"));
        };
        (scope, rest)
    } else {
        (declaring, segments.as_slice())
    };

    let Some((&last, prefix)) = path.split_last() else {
        return Err(not_a_connection());
    };
    if last == "." || last == ".." {
        return Err(not_a_connection());
    }

    let container = walk_scope(r, start, prefix).map_err(|err| {
        let searched = scope_path(&r.model, start);
        match err {
            WalkError::NotFound(seg) => {
                format!("no component `{seg}` on the path from `{searched}`")
            }
            WalkError::AboveSystem => format!("`..` from `{searched}` goes above the system"),
            WalkError::AboveDefinition => {
                format!("`..` from `{searched}` goes above a top-level definition")
            }
        }
    })?;

    let Some(target) = r
        .scope_index
        .connections
        .get(&(container, last.to_owned()))
        .copied()
    else {
        return Err(format!(
            "no connection `{last}` in `{}`",
            scope_path(&r.model, container)
        ));
    };

    if scope_root(&r.model, container) != scope_root(&r.model, declaring) {
        return Err(format!(
            "`{}` is outside the system or definition tree of the declaring connection",
            scope_path(&r.model, container)
        ));
    }
    Ok(target)
}

/// Resolve every `realized_by` entry (`E017`), reject cycles in the resolved
/// graph (`E018`) and flag connections over a leaf protocol that declare
/// `realized_by` (`E019`). Runs after all connections are registered.
fn resolve_realized_by(r: &mut Resolver) {
    let mut declared: Vec<(ConnectionId, Scope)> = r
        .scope_index
        .connections
        .iter()
        .map(|((scope, _), cid)| (*cid, *scope))
        .collect();
    declared.sort_by_key(|(cid, _)| cid.0);

    let connection_count = r.model.connections.len();
    let mut names: Vec<String> = (0..connection_count).map(|i| format!("#{i}")).collect();
    let mut graph: Vec<Vec<usize>> = vec![Vec::new(); connection_count];
    let mut messages: Vec<String> = Vec::new();

    for (cid, scope) in &declared {
        let Some(conn) = r.model.connection(*cid) else {
            continue;
        };
        let label = conn.label.clone();
        let mut entries = conn.realized_by.clone();
        let mut seen: HashSet<String> = HashSet::new();
        entries.retain(|e| seen.insert(e.clone()));

        let here = scope_path(&r.model, *scope);
        if let Some(name) = names.get_mut(cid.0) {
            *name = format!("{here}/{label}");
        }

        let mut targets: Vec<ConnectionId> = Vec::new();
        for entry in &entries {
            match resolve_realized_by_entry(r, entry, *scope) {
                Ok(target) => {
                    // Delegation edges relate port to port within one
                    // component; they can neither realize nor be realized.
                    if r.model.connection(target).is_some_and(|c| c.is_delegation) {
                        messages.push(format!(
                            "connection `{label}` in `{here}` has unresolved realized_by entry `{entry}`: delegation edges must not appear in `realized_by`"
                        ));
                        r.unresolved_realized_by.push((*cid, entry.clone()));
                    } else if !targets.contains(&target) {
                        targets.push(target);
                    }
                }
                Err(reason) => {
                    messages.push(format!(
                        "connection `{label}` in `{here}` has unresolved realized_by entry `{entry}`: {reason}"
                    ));
                    r.unresolved_realized_by.push((*cid, entry.clone()));
                }
            }
        }
        if let Some(slot) = graph.get_mut(cid.0) {
            *slot = targets.iter().map(|t| t.0).collect();
        }
    }
    for msg in messages {
        r.push_error(DiagnosticCode::E017, msg);
    }

    let mut state = vec![VisitState::Unvisited; connection_count];
    let mut path: Vec<usize> = Vec::new();
    let mut cycles: Vec<String> = Vec::new();
    for node in 0..connection_count {
        if state.get(node) == Some(&VisitState::Unvisited) {
            visit_realization(node, &mut graph, &names, &mut state, &mut path, &mut cycles);
        }
    }
    for cycle in cycles {
        r.push_error(DiagnosticCode::E018, cycle);
    }

    for (idx, targets) in graph.into_iter().enumerate() {
        if let Some(conn) = r.model.connections.get_mut(idx) {
            conn.realized_by_ids = targets.into_iter().map(ConnectionId).collect();
        }
    }

    let mut leaf_messages: Vec<String> = Vec::new();
    for (idx, conn) in r.model.connections.iter().enumerate() {
        if conn.realized_by.is_empty() {
            continue;
        }
        if conn.is_delegation {
            // Already E019 at registration; skip the leaf-protocol check here.
            continue;
        }
        let Some(pid) = r.model.connection_protocol(ConnectionId(idx)) else {
            continue;
        };
        if let Some(proto) = r.model.protocol(pid).filter(|p| p.leaf) {
            leaf_messages.push(format!(
                "connection `{}` declares realized_by but its protocol `{}` is a leaf",
                names.get(idx).map_or("", String::as_str),
                proto.label
            ));
        }
    }
    for msg in leaf_messages {
        r.push_error(DiagnosticCode::E019, msg);
    }
}

/// DFS step of the `realized_by` cycle check. Each back edge closes one cycle,
/// which is reported and removed from `graph`, so the remaining graph is
/// acyclic. A connection realized by itself is a one-entry cycle.
fn visit_realization(
    node: usize,
    graph: &mut [Vec<usize>],
    names: &[String],
    state: &mut [VisitState],
    path: &mut Vec<usize>,
    cycles: &mut Vec<String>,
) {
    if let Some(slot) = state.get_mut(node) {
        *slot = VisitState::OnPath;
    }
    path.push(node);

    let successors = graph.get(node).cloned().unwrap_or_default();
    let mut kept: Vec<usize> = Vec::with_capacity(successors.len());
    for next in successors {
        match state.get(next).copied().unwrap_or(VisitState::Done) {
            VisitState::OnPath => {
                let start = path.iter().position(|&p| p == next).unwrap_or(0);
                let mut chain: Vec<String> = path
                    .get(start..)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&p| names.get(p).map(|n| format!("`{n}`")))
                    .collect();
                if let Some(name) = names.get(next) {
                    chain.push(format!("`{name}`"));
                }
                cycles.push(format!("circular realization: {}", chain.join(" -> ")));
            }
            VisitState::Unvisited => {
                visit_realization(next, graph, names, state, path, cycles);
                kept.push(next);
            }
            VisitState::Done => kept.push(next),
        }
    }
    if let Some(slot) = graph.get_mut(node) {
        *slot = kept;
    }
    path.pop();
    if let Some(slot) = state.get_mut(node) {
        *slot = VisitState::Done;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::DiagnosticCode;
    use crate::parse::parse_dir;
    use std::fmt::Write as _;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
    // Long but linear: asserts the full resolved shape of the drone example.
    #[allow(clippy::too_many_lines)]
    fn resolve_drone() {
        let raw = parse_dir(&example_dir("drone")).expect("drone should parse");
        let (model, warnings) = resolve(raw).expect("drone should resolve without errors");

        // Two systems
        assert_eq!(model.systems.len(), 2);
        let quad_sid = model
            .systems
            .iter()
            .position(|s| s.label == "quadcopter")
            .map(SystemId)
            .expect("quadcopter system");
        let gc_sid = model
            .systems
            .iter()
            .position(|s| s.label == "ground-control")
            .map(SystemId)
            .expect("ground-control system");

        // quadcopter groups everything under a single `drone` assembly
        // for readability: one direct child carrying the former 7 children.
        let quad = &model.systems[quad_sid.0];
        assert_eq!(
            quad.components.len(),
            1,
            "quadcopter should have exactly the drone assembly, got: {:?}",
            quad.components
                .iter()
                .map(|cid| model.components[cid.0].label.as_str())
                .collect::<Vec<_>>()
        );
        assert!(
            quad.connections.is_empty(),
            "quadcopter should have no direct connections (moved into drone)"
        );

        let drone_cid = quad.components[0];
        let drone = &model.components[drone_cid.0];
        assert_eq!(drone.label, "drone");
        assert!(!drone.leaf, "drone assembly should not be a leaf");
        assert!(
            drone.children.len() >= 7,
            "drone should have >=7 children, got {}",
            drone.children.len()
        );

        // flight-controller should be a non-leaf with children (mcu, imu, barometer)
        // nested inside the drone assembly (not a direct system child).
        let fc_cid = drone
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "flight-controller")
            .expect("flight-controller component inside drone");
        let fc = &model.components[fc_cid.0];
        assert!(!fc.leaf, "flight-controller should not be a leaf");
        assert!(
            fc.children.len() >= 3,
            "flight-controller should have >=3 children"
        );

        // mcu and imu should be children of flight-controller
        let mcu_cid = fc
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "mcu")
            .expect("mcu");
        let imu_cid = fc
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "imu")
            .expect("imu");
        assert!(model.components[mcu_cid.0].leaf);
        assert!(model.components[imu_cid.0].leaf);

        // spi-imu connection is inside flight-controller scope: from=mcu/spi, to=imu/spi
        let spi_conn_id = fc
            .connections
            .iter()
            .copied()
            .find(|cid| model.connections[cid.0].label == "spi-imu")
            .expect("spi-imu connection");
        let spi = &model.connections[spi_conn_id.0];
        assert_eq!(spi.from.component, mcu_cid);
        assert_eq!(spi.to.component, imu_cid);
        // Both endpoints should be typed (have port references)
        assert!(spi.from.port.is_some(), "spi-imu from should have port");
        assert!(spi.to.port.is_some(), "spi-imu to should have port");

        // motor-control connection inside drone assembly: has no messages (messages are on ports now)
        let mc_conn_id = drone
            .connections
            .iter()
            .copied()
            .find(|cid| model.connections[cid.0].label == "motor-control")
            .expect("motor-control inside drone");
        let mc = &model.connections[mc_conn_id.0];
        // from=flight-controller/motor-out, to=esc/motor-in
        let esc_cid = drone
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "esc")
            .expect("esc component inside drone");
        assert_eq!(mc.from.component, fc_cid);
        assert_eq!(mc.to.component, esc_cid);
        assert!(
            mc.from.port.is_some(),
            "motor-control from should have port"
        );

        // Check that the motor-out port on FC has the throttle message
        let fc_motor_out = fc
            .ports
            .iter()
            .copied()
            .find(|pid| model.ports[pid.0].label == "motor-out")
            .expect("motor-out port on FC");
        let motor_out_port = &model.ports[fc_motor_out.0];
        assert_eq!(motor_out_port.label, "motor-out");

        // ground-control system exists
        let gc = &model.systems[gc_sid.0];
        assert!(gc.components.len() >= 3);

        // ground-station-pc: non-leaf, no children -> W001; no full_name -> W004
        let gpc_cid = gc
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "ground-station-pc")
            .expect("ground-station-pc");
        let gpc = &model.components[gpc_cid.0];
        assert!(!gpc.leaf);
        assert!(gpc.children.is_empty(), "{:?}", gpc.children);
        assert!(gpc.full_name.is_empty(), "{:?}", gpc.full_name);

        // Warnings: W001 for ground-station-pc, W004 for ground-station-pc
        let w001_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W001)
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w001_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W001 for ground-station-pc, got: {w001_labels:?}"
        );

        let w004_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W004)
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w004_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W004 for ground-station-pc, got: {w004_labels:?}"
        );
    }

    // ── social-media ───────────────────────────────────────────────────────

    #[test]
    fn resolve_social_media() {
        let raw = parse_dir(&example_dir("social-media")).expect("social-media should parse");
        let (model, warnings) = resolve(raw).expect("social-media should resolve without errors");

        assert_eq!(model.systems.len(), 1);
        let bv_sid = SystemId(0);
        assert_eq!(model.systems[bv_sid.0].label, "buzzvid");

        // backend is non-leaf with children
        let bv = &model.systems[bv_sid.0];
        let backend_cid = bv
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "backend")
            .expect("backend");
        let backend = &model.components[backend_cid.0];
        assert!(!backend.leaf);
        assert!(backend.children.len() >= 4);

        // recommendation-engine: non-leaf, no children -> W001
        let rec_cid = backend
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "recommendation-engine")
            .expect("recommendation-engine");
        assert!(
            model.components[rec_cid.0].children.is_empty(),
            "{:?}",
            model.components[rec_cid.0].children
        );

        // rec-to-feed connection: from=recommendation-engine/scores-out, to=feed-service/scores-in
        let feed_service_cid = backend
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "feed-service")
            .expect("feed-service");
        let rec_conn = backend
            .connections
            .iter()
            .copied()
            .find(|cid| model.connections[cid.0].label == "rec-to-feed")
            .expect("rec-to-feed");
        let rec_conn = &model.connections[rec_conn.0];
        assert_eq!(rec_conn.from.component, rec_cid);
        assert_eq!(rec_conn.to.component, feed_service_cid);
        assert_eq!(
            rec_conn.from.port.map(|p| model.ports[p.0].label.as_str()),
            Some("scores-out")
        );
        assert_eq!(
            rec_conn.to.port.map(|p| model.ports[p.0].label.as_str()),
            Some("scores-in")
        );

        // Warnings: W001 for recommendation-engine
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W001
                    && d.message.contains("recommendation-engine")),
            "expected W001 for recommendation-engine"
        );
    }

    // ── software-house ─────────────────────────────────────────────────────

    #[test]
    fn resolve_software_house() {
        let raw = parse_dir(&example_dir("software-house")).expect("software-house should parse");
        let (model, warnings) = resolve(raw).expect("software-house should resolve without errors");

        assert_eq!(model.systems.len(), 1);
        let acme_sid = SystemId(0);
        assert_eq!(model.systems[acme_sid.0].label, "acme-software");

        // engineering has children (teams)
        let acme = &model.systems[acme_sid.0];
        let eng_cid = acme
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "engineering")
            .expect("engineering");
        let eng = &model.components[eng_cid.0];
        assert!(!eng.leaf);
        assert!(eng.children.len() >= 3);

        // operations: non-leaf, no children -> W001; no full_name -> W004
        let ops_cid = acme
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "operations")
            .expect("operations");
        let ops = &model.components[ops_cid.0];
        assert!(!ops.leaf);
        assert!(ops.children.is_empty(), "{:?}", ops.children);
        assert!(ops.full_name.is_empty(), "{:?}", ops.full_name);

        // sprint-planning connection: from=product/sprint-out, to=engineering/sprint-in
        let product_cid = acme
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "product")
            .expect("product");
        let sp_conn_id = acme
            .connections
            .iter()
            .copied()
            .find(|cid| model.connections[cid.0].label == "sprint-planning")
            .expect("sprint-planning");
        let sp = &model.connections[sp_conn_id.0];
        assert_eq!(sp.from.component, product_cid);
        assert_eq!(sp.to.component, eng_cid);
        assert!(
            sp.from.port.is_some(),
            "sprint-planning from should have port"
        );
        assert!(sp.to.port.is_some(), "sprint-planning to should have port");

        // Warnings: W001 + W004 for operations
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W001 && d.message.contains("operations")),
            "expected W001 for operations"
        );
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W004 && d.message.contains("operations")),
            "expected W004 for operations"
        );
    }

    // ── Error cases ────────────────────────────────────────────────────────

    #[test]
    fn e002_undefined_from_to() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            system "s" {
              instance "a" { source = "a" }
              connection "c" {
                from = "a/p"
                to   = "nonexistent"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err(), "expected Err for undefined component ref");
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E002),
            "expected E002, got: {diags:?}"
        );
    }

    #[test]
    fn e001_duplicate_component_label() {
        let src = r#"
            component "a" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
              instance "a" { source = "a" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E001),
            "expected E001, got: {diags:?}"
        );
    }

    #[test]
    fn e001_same_connection_name_from_two_definitions_in_one_system() {
        // Two different component definitions each declare `data`; both are
        // instantiated in one system, so the name is ambiguous for hiding.
        let src = r#"
            component "left" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "data" {
                from = "a/p"
                to   = "b/q"
              }
            }
            component "right" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "data" {
                from = "a/p"
                to   = "b/q"
              }
            }
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "l" { source = "left" }
              instance "r" { source = "right" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err(), "expected E001, got ok");
        let diags = result.unwrap_err();
        let e001: Vec<_> = diags
            .iter()
            .filter(|d| d.code == DiagnosticCode::E001)
            .collect();
        assert_eq!(e001.len(), 1, "expected one E001, got: {diags:?}");
        assert!(
            e001[0].message.contains("`data`")
                && e001[0].message.contains("`s`")
                && e001[0].message.contains("component:left")
                && e001[0].message.contains("component:right"),
            "message must name the connection, system and both declarations, got: {}",
            e001[0].message
        );
    }

    #[test]
    fn e001_system_connection_next_to_component_connection_with_same_name() {
        let src = r#"
            component "sub" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "data" {
                from = "a/p"
                to   = "b/q"
              }
            }
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "x" { source = "a" }
              instance "y" { source = "b" }
              instance "inner" { source = "sub" }
              connection "data" {
                from = "x/p"
                to   = "y/q"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err(), "expected E001, got ok");
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E001
                && d.message.contains("`data`")
                && d.message.contains("system:s")
                && d.message.contains("component:sub")),
            "expected E001 naming both declarations, got: {diags:?}"
        );
    }

    #[test]
    fn copies_of_one_declaration_share_a_connection_name() {
        // The same definition instantiated twice clones its `data` connection
        // twice; the copies share `decl` and must not raise E001.
        let src = r#"
            component "pair" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "data" {
                from = "a/p"
                to   = "b/q"
              }
            }
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "l" { source = "pair" }
              instance "r" { source = "pair" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).expect("copies must not raise E001");
        let datas: Vec<_> = model
            .connections
            .iter()
            .filter(|c| c.label == "data")
            .collect();
        // The definition itself plus one copy per instance.
        assert_eq!(datas.len(), 3, "definition + two copies expected");
        assert!(
            datas.iter().all(|c| c.decl == datas[0].decl),
            "copies share one declaration: {datas:?}"
        );
    }

    #[test]
    fn e005_leaf_component_with_children() {
        let src = r#"
            component "a" {
              leaf = true
              instance "b" { source = "b" }
            }
            component "b" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E005),
            "expected E005, got: {diags:?}"
        );
    }

    #[test]
    fn e009_invalid_port_role() {
        let src = r#"
            protocol "bus" {
              roles = ["primary", "secondary"]
            }

            component "a" {
              leaf = true
              port "p" {
                protocol = "bus"
                role     = "sideways"
              }
            }
            system "s" {
              instance "a" { source = "a" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E009),
            "expected E009, got: {diags:?}"
        );
    }

    #[test]
    fn e010_port_not_found() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "c" {
                from = "a/nonexistent"
                to   = "b/q"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E010),
            "expected E010, got: {diags:?}"
        );
    }

    #[test]
    fn e003_requires_port_path() {
        // Table-driven consolidation of the former `e003_from_*` and
        // `e003_to_*` tests: same E003 assertion, only the bare side differs.
        // Shared fixture exposes a port on both components.
        let fixture = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "c" {
                from = "__FROM__"
                to   = "__TO__"
              }
            }
        "#;
        let cases: &[(&str, &str, &str)] = &[("a", "b/q", "'from'"), ("a/p", "b", "'to'")];
        for (from, to, side) in cases {
            let src = fixture.replace("__FROM__", from).replace("__TO__", to);
            let raw = crate::parse::parse_file(&src, std::path::Path::new("test.hcl")).unwrap();
            let result = resolve(raw);
            assert!(
                result.is_err(),
                "expected Err for endpoint without port path ({from} -> {to})"
            );
            let diags = result.unwrap_err();
            assert!(
                diags.iter().any(|d| d.code == DiagnosticCode::E003
                    && d.message.contains("`c`")
                    && d.message.contains(side)),
                "expected E003 for {side}, got: {diags:?}"
            );
        }
    }

    #[test]
    fn e003_both_require_port_paths() {
        let src = r#"
            component "a" { leaf = true }
            component "b" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(
            result.is_err(),
            "expected Err for endpoints without port paths"
        );
        let diags = result.unwrap_err();
        let count = diags
            .iter()
            .filter(|d| d.code == DiagnosticCode::E003)
            .count();
        assert_eq!(count, 2, "expected two E003, got: {diags:?}");
    }

    #[test]
    fn e011_comp_not_found_in_typed_ref() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            system "s" {
              instance "a" { source = "a" }
              connection "c" {
                from = "a/p"
                to   = "ghost/port"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E011),
            "expected E011, got: {diags:?}"
        );
    }

    #[test]
    fn diagnostic_messages_wrap_entity_names_in_backticks() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            system "s" {
              instance "a" { source = "a" }
              connection "c" {
                from = "a/p"
                to   = "ghost/port"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let diags = resolve(raw).unwrap_err();
        let e011 = diags
            .iter()
            .find(|d| d.code == DiagnosticCode::E011)
            .expect("expected E011");
        assert_eq!(
            e011.message,
            "connection `c` references undefined component `ghost` in 'to'"
        );
    }

    #[test]
    fn non_unix_path_with_colon_emits_error() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "c" {
                from = "a:port"
                to   = "b/q"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags
                .iter()
                .any(|d| d.code == DiagnosticCode::E002 && d.message.contains("colon")),
            "expected E002 error for colon notation, got: {diags:?}"
        );
    }

    #[test]
    fn defaults_applied() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "c" {
                from = "a/p"
                to   = "b/q"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();

        // Default level: system implicitly 0, component=1, connection=1 (parent_level+1)
        assert_eq!(model.components[0].level, 1);
        assert_eq!(model.connections[0].level, 1);
        // Default full_name = ""
        assert_eq!(model.systems[0].full_name, "");
        assert_eq!(model.components[0].full_name, "");
    }

    // ── source resolution ──────────────────────────────────────────────────────

    #[test]
    fn source_basic_clones_body() {
        let src = r#"
component "sensor" {
    full_name = "a temperature sensor"
    leaf = true
    port "data-out" {
        role = "provider"
    }
}
system "sys" {
    instance "temp-sensor" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _warnings) = resolve(raw).expect("should resolve");
        let tc_cid = model.systems[0].components[0];
        let tc = &model.components[tc_cid.0];
        assert_eq!(tc.label, "temp-sensor");
        assert_eq!(tc.source.as_deref(), Some("sensor"));
        assert_eq!(tc.full_name, "a temperature sensor");
        assert!(tc.leaf);
        assert_eq!(tc.ports.len(), 1);
        assert_eq!(model.ports[tc.ports[0].0].label, "data-out");
    }

    #[test]
    fn source_exclusivity_e012() {
        let src = r#"
component "sensor" {
    full_name = "sensor"
    leaf = true
}
system "sys" {
    instance "temp-sensor" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _) = resolve(raw).expect("instance syntax carries no extras -> resolves");
        let tc = &model.components[model.systems[0].components[0].0];
        assert_eq!(tc.source.as_deref(), Some("sensor"));
    }

    #[test]
    fn source_undefined_label_e014() {
        let src = r#"
system "sys" {
    instance "mystery" {
        source = "nonexistent"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let errs = resolve(raw).unwrap_err();
        assert!(
            errs.iter().any(|d| d.code == DiagnosticCode::E014),
            "expected E014, got: {errs:?}"
        );
    }

    #[test]
    fn source_circular_e013() {
        let src = r#"
component "b" {
    leaf = true
}
component "a" {
    instance "b" {
        source = "b"
    }
}
system "sys" {
    instance "comp-a" {
        source = "a"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        // No definition-to-definition source cycle exists under the new model
        // (definitions only instantiate via `instance`, they cannot self-source),
        // so this is no longer an error. It resolves cleanly.
        let (model, _warnings) = resolve(raw).expect("a->b instance chain should resolve");
        let comp = &model.components[model.systems[0].components[0].0];
        assert_eq!(comp.source.as_deref(), Some("a"));
        assert_eq!(comp.children.len(), 1);
        let child = &model.components[comp.children[0].0];
        assert_eq!(child.source.as_deref(), Some("b"));
    }

    #[test]
    fn source_nested_works() {
        let src = r#"
component "c-comp" {
    full_name = "component C"
    leaf = true
}
component "b-comp" {
    full_name = "component B"
    instance "child" {
        source = "c-comp"
    }
}
system "sys" {
    instance "a" {
        source = "b-comp"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _warnings) = resolve(raw).expect("nested source should resolve");
        let a_cid = model.systems[0].components[0];
        let a = &model.components[a_cid.0];
        assert_eq!(a.label, "a");
        assert_eq!(a.full_name, "component B");
        assert_eq!(a.children.len(), 1);
        let child = &model.components[a.children[0].0];
        assert_eq!(child.label, "child");
        assert_eq!(child.full_name, "component C");
        assert!(child.leaf);
    }

    #[test]
    fn source_same_component_two_systems() {
        let src = r#"
component "sensor" {
    full_name = "sensor"
    leaf = true
}
system "sys1" {
    instance "s1" {
        source = "sensor"
    }
}
system "sys2" {
    instance "s2" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _warnings) = resolve(raw).expect("reuse should work");
        assert_eq!(model.systems.len(), 2);
        let s1 = &model.components[model.systems[0].components[0].0];
        let s2 = &model.components[model.systems[1].components[0].0];
        assert_eq!(s1.source.as_deref(), Some("sensor"));
        assert_eq!(s2.source.as_deref(), Some("sensor"));
        assert_eq!(s1.full_name, "sensor");
        assert_eq!(s2.full_name, "sensor");
    }

    #[test]
    fn source_records_terminal_definition_label() {
        // Under the definition/instance model each `instance` records the
        // definition label it sources directly. A nested chain (`inst` sources
        // definition `a`, which contains an `instance` sourcing `b`, which
        // contains one sourcing `c`) is preserved as a child-instance chain.
        let src = r#"
component "c" {
    full_name = "concrete"
    leaf = true
}
component "b" {
    instance "c" {
        source = "c"
    }
}
component "a" {
    instance "b" {
        source = "b"
    }
}
system "sys" {
    instance "inst" {
        source = "a"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _warnings) = resolve(raw).expect("chain should resolve");
        let inst = &model.components[model.systems[0].components[0].0];
        assert_eq!(inst.source.as_deref(), Some("a"));
        // The chain deepens via child instances: inst -> b -> c.
        let b_child = &model.components[inst.children[0].0];
        assert_eq!(b_child.source.as_deref(), Some("b"));
        let c_child = &model.components[b_child.children[0].0];
        assert_eq!(c_child.source.as_deref(), Some("c"));
        assert_eq!(c_child.full_name, "concrete");
    }

    #[test]
    fn source_is_none_for_inline_component() {
        // Under the new model a top-level `component` is a definition and its
        // source is None; definitions are not clones of anything.
        let src = r#"
component "plain" {
    full_name = "inline"
    leaf = true
}
system "sys" {
    instance "plain" {
        source = "plain"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (model, _warnings) = resolve(raw).expect("should resolve");
        let plain = &model.components[model.systems[0].components[0].0];
        assert_eq!(plain.source.as_deref(), Some("plain"));
    }

    // ── W012: orphan top-level component ──────────────────────────────────────

    #[test]
    fn w012_referenced_top_level_no_warning() {
        let src = r#"
component "sensor" {
    full_name = "sensor"
    leaf = true
}
system "sys" {
    instance "s" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected no W012 when top-level component is referenced, got: {warnings:?}"
        );
    }

    #[test]
    fn w012_unreferenced_top_level_no_warning() {
        // Under the definition/instance model an unreferenced top-level
        // `component` is a reusable definition that is intentionally allowed
        // to exist with zero instances (it can be defined ahead of use), so it
        // must not emit W012.
        let src = r#"
component "unused" {
    full_name = "never referenced"
    leaf = true
}
component "a" { leaf = true }
system "sys" {
    instance "a" { source = "a" }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "unreferenced top-level definitions should not emit W012, got: {warnings:?}"
        );
    }

    #[test]
    fn w012_referenced_multiple_times_no_warning() {
        let src = r#"
component "sensor" {
    full_name = "sensor"
    leaf = true
}
system "sys1" {
    instance "s1" {
        source = "sensor"
    }
}
system "sys2" {
    instance "s2" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected no W012 when top-level component referenced multiple times, got: {warnings:?}"
        );
    }

    #[test]
    fn w012_unreferenced_top_level_protocol_emits_warning() {
        let src = r#"
protocol "unused-proto" {
    full_name = "never referenced"
}
component "a" { leaf = true }
system "sys" {
    instance "a" { source = "a" }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected W012 for unreferenced top-level protocol, got: {warnings:?}"
        );
        let w = warnings
            .iter()
            .find(|d| d.code == DiagnosticCode::W012)
            .unwrap();
        assert!(
            w.message.contains("unused-proto"),
            "W012 message should mention the protocol label, got: {}",
            w.message
        );
    }

    #[test]
    fn w012_referenced_protocol_no_warning() {
        let src = r#"
protocol "used-proto" {
    full_name = "used by port"
}
component "a" {
    leaf = true
    port "p" {
        protocol = "used-proto"
    }
}
system "sys" {
    instance "a" { source = "a" }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected no W012 for referenced protocol, got: {warnings:?}"
        );
    }

    // ── UNIX-style Path Connections ──────────────────────────────────────────

    #[test]
    fn resolve_unix_style_relative_sibling_ports() {
        let src = r#"
component "sensor" {
  leaf = true
  port "i2c" { role = "provider" }
}
component "controller" {
  leaf = true
  port "i2c-in" { role = "consumer" }
}
system "drone" {
  instance "sensor" { source = "sensor" }
  instance "controller" { source = "controller" }
  connection "sensor-bus" {
    from = "sensor/i2c"
    to   = "controller/i2c-in"
  }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, diags) = resolve(raw).expect("should resolve unix-style relative paths");
        assert!(diags.iter().all(|d| !d.is_error()));

        let conn = &model.connections[0];
        assert_eq!(conn.label, "sensor-bus");
        assert_eq!(model.components[conn.from.component.0].label, "sensor");
        assert_eq!(model.ports[conn.from.port.unwrap().0].label, "i2c");
        assert_eq!(model.components[conn.to.component.0].label, "controller");
        assert_eq!(model.ports[conn.to.port.unwrap().0].label, "i2c-in");
    }

    #[test]
    fn resolve_unix_style_nested_subcomponent_paths() {
        let src = r#"
component "mcu" {
  leaf = true
  port "spi" { role = "provider" }
}
component "controller" {
  instance "mcu" { source = "mcu" }
}
component "imu" {
  leaf = true
  port "spi-in" { role = "consumer" }
}
component "sensor" {
  instance "imu" { source = "imu" }
}
system "drone" {
  instance "controller" { source = "controller" }
  instance "sensor" { source = "sensor" }
  connection "spi-bus" {
    from = "controller/mcu/spi"
    to   = "sensor/imu/spi-in"
  }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, diags) = resolve(raw).expect("should resolve nested subcomponent paths");
        assert!(diags.iter().all(|d| !d.is_error()));

        let conn = &model.connections[0];
        assert_eq!(conn.label, "spi-bus");
        assert_eq!(model.components[conn.from.component.0].label, "mcu");
        assert_eq!(model.ports[conn.from.port.unwrap().0].label, "spi");
        assert_eq!(model.components[conn.to.component.0].label, "imu");
        assert_eq!(model.ports[conn.to.port.unwrap().0].label, "spi-in");
    }

    #[test]
    fn connection_declared_outside_lca_emits_e015() {
        let src = r#"
component "battery" {
  leaf = true
  port "power-out" { role = "provider" }
}
component "power-regulator" {
  leaf = true
  port "v-in" { role = "consumer" }
}
component "controller" {
  instance "power-regulator" { source = "power-regulator" }
  # E015: 'controller' is not an ancestor of 'battery'.
  # This connection belongs in system "drone" (the LCA).
  connection "internal-power" {
    from = "../battery/power-out"
    to   = "power-regulator/v-in"
  }
}
system "drone" {
  instance "battery" { source = "battery" }
  instance "controller" { source = "controller" }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err(), "expected error for LCA violation");
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E015),
            "expected E015 for connection outside LCA, got: {diags:?}"
        );
    }

    #[test]
    fn resolve_protocol_definition_and_linking() {
        let src = r#"
protocol "spi" {
  full_name = "SPI bus"
  tags        = ["serial"]
  roles       = ["provider", "consumer"]

  message "frame" {
    full_name = "Data frame"
    field "data" { type = "bytes" }
  }
}

component "mcu" {
  leaf = true
  port "spi" {
    protocol = "spi"
    role     = "provider"
  }
}
system "drone" {
  instance "mcu" { source = "mcu" }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, diags) = resolve(raw).expect("protocol definition should resolve");
        assert!(diags.iter().all(|d| !d.is_error()));

        assert_eq!(model.protocols.len(), 1);
        let proto = &model.protocols[0];
        assert_eq!(proto.label, "spi");
        assert_eq!(proto.full_name, "SPI bus");
        assert_eq!(proto.tags, vec!["serial"]);
        assert_eq!(
            proto.roles,
            vec!["provider".to_string(), "consumer".to_string()]
        );
        assert_eq!(proto.messages.len(), 1);

        let msg = &model.messages[proto.messages[0].0];
        assert_eq!(msg.label, "frame");
        assert_eq!(msg.fields.len(), 1);

        let port = &model.ports[0];
        assert_eq!(port.protocol, "spi");
        assert_eq!(port.protocol_id, Some(ProtocolId(0)));
    }

    #[test]
    fn w014_undefined_protocol_warning() {
        let src = r#"
component "mcu" {
  leaf = true
  port "spi" {
    protocol = "nonexistent-protocol"
    role     = "provider"
  }
}
system "drone" {
  instance "mcu" { source = "mcu" }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, warnings) =
            resolve(raw).expect("undefined protocol should not block compilation");

        assert!(
            warnings.iter().any(|d| d.code == DiagnosticCode::W014),
            "expected W014 warning, got: {warnings:?}"
        );
        let port = &model.ports[0];
        assert_eq!(port.protocol, "nonexistent-protocol");
        assert_eq!(port.protocol_id, None);
    }

    #[test]
    fn e009_role_not_permitted_by_protocol_error() {
        let src = r#"
protocol "serial" {
  roles = ["provider", "consumer"]
}

component "mcu" {
  leaf = true
  port "uart" {
    protocol = "serial"
    role     = "peer"
    }
}
system "drone" {
  instance "mcu" { source = "mcu" }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E009),
            "expected E009 error, got: {diags:?}"
        );
    }

    fn resolve_src(src: &str) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>> {
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        resolve(raw)
    }

    /// Codes of `diags`, without the orphan/no-message noise (W011/W012) that
    /// bare protocol fixtures always produce.
    fn codes(diags: &[Diagnostic]) -> Vec<&'static str> {
        diags
            .iter()
            .map(|d| d.code.code)
            .filter(|c| *c != "W011" && *c != "W012")
            .collect()
    }

    #[test]
    fn w022_undefined_encapsulates_label_is_dropped() {
        let src = r#"
protocol "http" {
  encapsulates = ["fund-transfer"]
}
"#;
        let (model, warnings) = resolve_src(src).expect("W022 must not block compilation");
        assert_eq!(codes(&warnings), vec!["W022"]);
        assert!(
            model.protocols[0].encapsulates_ids.is_empty(),
            "{:?}",
            model.protocols[0].encapsulates_ids
        );
        assert_eq!(model.protocols[0].encapsulates, vec!["fund-transfer"]);
    }

    #[test]
    fn e020_protocol_listing_itself_is_a_cycle() {
        let src = r#"
protocol "http" {
  encapsulates = ["http"]
}
"#;
        let diags = resolve_src(src).expect_err("self-reference must be an error");
        assert_eq!(codes(&diags), vec!["E020"]);
        assert!(diags[0].message.contains("http"), "{}", diags[0].message);
    }

    #[test]
    fn e020_two_protocol_cycle_reported_once() {
        let src = r#"
protocol "http" {
  encapsulates = ["tls"]
}
protocol "tls" {
  encapsulates = ["http"]
}
"#;
        let diags = resolve_src(src).expect_err("2-cycle must be an error");
        assert_eq!(codes(&diags), vec!["E020"]);
        let msg = &diags[0].message;
        assert!(msg.contains("http") && msg.contains("tls"), "{msg}");
    }

    #[test]
    fn e020_longer_cycle_reported_once() {
        let src = r#"
protocol "a" {
  encapsulates = ["b"]
}
protocol "b" {
  encapsulates = ["c"]
}
protocol "c" {
  encapsulates = ["a"]
}
"#;
        let diags = resolve_src(src).expect_err("3-cycle must be an error");
        assert_eq!(codes(&diags), vec!["E020"]);
        let msg = &diags[0].message;
        assert!(
            msg.contains('a') && msg.contains('b') && msg.contains('c'),
            "{msg}"
        );
    }

    #[test]
    fn encapsulates_diamond_is_clean_and_resolved() {
        let src = r#"
protocol "top" {
  encapsulates = ["left", "right"]
}
protocol "left" {
  encapsulates = ["base"]
}
protocol "right" {
  encapsulates = ["base"]
}
protocol "base" {
  leaf = true
}
"#;
        let (model, warnings) = resolve_src(src).expect("diamond has no cycle");
        assert!(codes(&warnings).is_empty(), "{warnings:?}");
        let id_of = |label: &str| {
            model
                .protocols
                .iter()
                .position(|p| p.label == label)
                .map(ProtocolId)
                .unwrap()
        };
        let top = &model.protocols[id_of("top").0];
        assert_eq!(top.encapsulates_ids, vec![id_of("left"), id_of("right")]);
        assert_eq!(
            model.protocols[id_of("left").0].encapsulates_ids,
            vec![id_of("base")]
        );
    }

    #[test]
    fn resolve_unix_style_absolute_paths() {
        let src = r#"
component "sensor" {
  leaf = true
  port "data" { role = "provider" }
}
component "fc" {
  leaf = true
  port "data-in" { role = "consumer" }
}
system "drone" {
  instance "sensor" { source = "sensor" }
  instance "fc" { source = "fc" }
  connection "global-link" {
    from = "/drone/sensor/data"
    to   = "/drone/fc/data-in"
  }
}
"#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, diags) = resolve(raw).expect("should resolve absolute path");
        assert!(diags.iter().all(|d| !d.is_error()));

        let conn = &model.connections[0];
        assert_eq!(conn.label, "global-link");
        assert_eq!(model.components[conn.from.component.0].label, "sensor");
        assert_eq!(model.ports[conn.from.port.unwrap().0].label, "data");
        assert_eq!(model.components[conn.to.component.0].label, "fc");
        assert_eq!(model.ports[conn.to.port.unwrap().0].label, "data-in");
    }

    // ── realized_by (0002.3) ─────────────────────────────────────────────────

    /// Banking fixture. `bank-a` is a copy of `bank`, which declares
    /// `http-request`. `tls-session` (system scope) realizes through `entry`.
    fn realized_fixture(entry: &str) -> String {
        format!(
            r#"
component "stack" {{
  leaf = true
  port "p" {{ role = "provider" }}
}}
component "bank" {{
  instance "stack" {{ source = "stack" }}
  connection "http-request" {{
    from = "stack/p"
    to = "stack/p"
  }}
}}
system "banking" {{
  instance "bank-a" {{ source = "bank" }}
  instance "ext" {{ source = "stack" }}
  connection "uplink" {{
    from = "ext/p"
    to = "ext/p"
  }}
  connection "tls-session" {{
    from = "ext/p"
    to = "ext/p"
    realized_by = [{entry}]
  }}
}}
"#
        )
    }

    /// Label of the component or system that declares `conn`.
    fn declaring_scope_label(model: &Model, conn: &Connection) -> String {
        let Some(comp) = model.component(conn.from.component) else {
            return String::new();
        };
        match comp.parent {
            Some(ComponentParent::Component(p)) => model
                .component(p)
                .map(|c| c.label.clone())
                .unwrap_or_default(),
            Some(ComponentParent::System(s)) => {
                model.system(s).map(|s| s.label.clone()).unwrap_or_default()
            }
            None => String::new(),
        }
    }

    /// `(label, declaring scope)` of every connection `tls-session` realizes.
    fn realized_targets(model: &Model) -> Vec<(String, String)> {
        let conn = model
            .connections
            .iter()
            .find(|c| c.label == "tls-session")
            .expect("tls-session");
        conn.realized_by_ids
            .iter()
            .map(|cid| {
                let target = model.connection(*cid).expect("target");
                (target.label.clone(), declaring_scope_label(model, target))
            })
            .collect()
    }

    /// Asserts the blocking error codes of `src` (warnings are not compared).
    fn expect_codes(src: &str, expected: &[&str]) -> Vec<Diagnostic> {
        let diags = resolve_src(src).expect_err("expected a blocking error");
        let errors: Vec<Diagnostic> = diags.iter().filter(|d| d.is_error()).cloned().collect();
        let error_codes: Vec<&str> = errors.iter().map(|d| d.code.code).collect();
        assert_eq!(error_codes, expected, "{diags:?}");
        errors
    }

    #[test]
    fn realized_by_bare_label_resolves_to_sibling() {
        let (model, _) = resolve_src(&realized_fixture("\"uplink\"")).expect("resolves");
        assert_eq!(
            realized_targets(&model),
            vec![("uplink".to_owned(), "banking".to_owned())]
        );
    }

    #[test]
    fn realized_by_dot_slash_resolves_like_bare_label() {
        let (model, _) = resolve_src(&realized_fixture("\"./uplink\"")).expect("resolves");
        assert_eq!(
            realized_targets(&model),
            vec![("uplink".to_owned(), "banking".to_owned())]
        );
    }

    #[test]
    fn realized_by_child_instance_path_resolves_into_that_copy() {
        let (model, _) =
            resolve_src(&realized_fixture("\"bank-a/http-request\"")).expect("resolves");
        assert_eq!(
            realized_targets(&model),
            vec![("http-request".to_owned(), "bank-a".to_owned())]
        );
    }

    #[test]
    fn realized_by_absolute_system_path_resolves() {
        let (model, _) = resolve_src(&realized_fixture("\"/banking/uplink\"")).expect("resolves");
        assert_eq!(
            realized_targets(&model),
            vec![("uplink".to_owned(), "banking".to_owned())]
        );
    }

    #[test]
    fn realized_by_absolute_path_through_instance_resolves() {
        let (model, _) =
            resolve_src(&realized_fixture("\"/banking/bank-a/http-request\"")).expect("resolves");
        assert_eq!(
            realized_targets(&model),
            vec![("http-request".to_owned(), "bank-a".to_owned())]
        );
    }

    #[test]
    fn realized_by_duplicate_entries_collapse_to_one() {
        let (model, _) =
            resolve_src(&realized_fixture("\"uplink\", \"./uplink\"")).expect("resolves");
        assert_eq!(realized_targets(&model).len(), 1);
    }

    #[test]
    fn e017_missing_label_names_the_entry() {
        let diags = expect_codes(&realized_fixture("\"nope\""), &["E017"]);
        assert!(diags[0].message.contains("nope"), "{}", diags[0].message);
    }

    #[test]
    fn e017_path_through_missing_instance() {
        expect_codes(&realized_fixture("\"ghost/http-request\""), &["E017"]);
    }

    #[test]
    fn e017_dotdot_above_system_is_unresolved() {
        expect_codes(&realized_fixture("\"../uplink\""), &["E017"]);
    }

    #[test]
    fn e017_reference_into_another_system() {
        let src = r#"
component "stack" {
  leaf = true
  port "p" { role = "provider" }
}
system "other" {
  instance "o" { source = "stack" }
  connection "far" {
    from = "o/p"
    to = "o/p"
  }
}
system "banking" {
  instance "ext" { source = "stack" }
  connection "tls-session" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["/other/far"]
  }
}
"#;
        expect_codes(src, &["E017"]);
    }

    #[test]
    fn e018_self_reference_is_a_cycle() {
        let diags = expect_codes(&realized_fixture("\"tls-session\""), &["E018"]);
        assert!(
            diags[0].message.contains("tls-session"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn e018_two_connection_cycle_reported_once() {
        let src = r#"
component "stack" {
  leaf = true
  port "p" { role = "provider" }
}
system "banking" {
  instance "ext" { source = "stack" }
  connection "a" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["b"]
  }
  connection "b" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["a"]
  }
}
"#;
        let diags = expect_codes(src, &["E018"]);
        let msg = &diags[0].message;
        assert!(msg.contains('a') && msg.contains('b'), "{msg}");
    }

    #[test]
    fn e018_cycle_inside_definition_body() {
        let src = r#"
component "stack" {
  leaf = true
  port "p" { role = "provider" }
}
component "bank" {
  instance "stack" { source = "stack" }
  connection "x" {
    from = "stack/p"
    to = "stack/p"
    realized_by = ["y"]
  }
  connection "y" {
    from = "stack/p"
    to = "stack/p"
    realized_by = ["x"]
  }
}
"#;
        expect_codes(src, &["E018"]);
    }

    #[test]
    fn e019_leaf_protocol_connection_declares_realized_by() {
        let src = r#"
protocol "p" { leaf = true }
component "a" {
  leaf = true
  port "x" { protocol = "p" }
}
component "b" {
  leaf = true
  port "y" { protocol = "p" }
}
system "s" {
  instance "ia" { source = "a" }
  instance "ib" { source = "b" }
  connection "c1" {
    from = "ia/x"
    to = "ib/y"
    realized_by = ["c2"]
  }
  connection "c2" {
    from = "ia/x"
    to = "ib/y"
  }
}
"#;
        expect_codes(src, &["E019"]);
    }

    #[test]
    fn connection_protocol_needs_both_ports_to_agree_on_a_defined_protocol() {
        let src = r#"
protocol "p" { leaf = true }
component "a" {
  leaf = true
  port "x" { protocol = "p" }
  port "z" { protocol = "q" }
  port "u" { role = "provider" }
}
component "b" {
  leaf = true
  port "y" { protocol = "p" }
  port "v" { role = "consumer" }
}
system "s" {
  instance "ia" { source = "a" }
  instance "ib" { source = "b" }
  connection "same" {
    from = "ia/x"
    to = "ib/y"
  }
  connection "mixed" {
    from = "ia/z"
    to = "ib/y"
  }
  connection "plain" {
    from = "ia/u"
    to = "ib/v"
  }
}
"#;
        let (model, _) = resolve_src(src).expect("warnings only");
        let protocol_of = |label: &str| {
            let idx = model
                .connections
                .iter()
                .position(|c| c.label == label)
                .expect(label);
            model.connection_protocol(ConnectionId(idx))
        };
        assert_eq!(protocol_of("same"), Some(ProtocolId(0)));
        assert_eq!(protocol_of("mixed"), None, "undefined vs defined protocol");
        assert_eq!(
            protocol_of("plain"),
            None,
            "ports without protocol agree on none"
        );
    }

    #[test]
    fn realized_by_copies_of_a_definition_resolve_independently() {
        let src = r#"
component "stack" {
  leaf = true
  port "p" { role = "provider" }
}
component "bank" {
  instance "stack" { source = "stack" }
  connection "low" {
    from = "stack/p"
    to = "stack/p"
  }
  connection "high" {
    from = "stack/p"
    to = "stack/p"
    realized_by = ["low"]
  }
}
system "banking" {
  instance "bank-a" { source = "bank" }
  instance "bank-b" { source = "bank" }
}
"#;
        let (model, _) = resolve_src(src).expect("resolves");
        let highs: Vec<&Connection> = model
            .connections
            .iter()
            .filter(|c| c.label == "high")
            .collect();
        assert_eq!(highs.len(), 3, "definition plus two copies");
        let mut targets = Vec::new();
        for high in highs {
            assert_eq!(high.realized_by_ids.len(), 1);
            let target = model.connection(high.realized_by_ids[0]).expect("target");
            assert_eq!(target.label, "low");
            assert_eq!(
                declaring_scope_label(&model, target),
                declaring_scope_label(&model, high),
                "a copy must realize its own low, not another copy's"
            );
            targets.push(high.realized_by_ids[0]);
        }
        targets.sort_by_key(|c| c.0);
        targets.dedup();
        assert_eq!(targets.len(), 3, "each copy has a distinct target");
    }

    /// A source with a single slash-bearing (or empty) block label must fail
    /// with exactly one E004 whose message contains `want`.
    fn assert_one_e004(src: &str, what: &str, want: &str) {
        let result = resolve_src(src);
        assert!(result.is_err(), "expected E004 for {what}, got ok");
        let diags = result.unwrap_err();
        let e004: Vec<_> = diags
            .iter()
            .filter(|d| d.code == DiagnosticCode::E004)
            .collect();
        assert_eq!(e004.len(), 1, "expected one E004, got: {diags:?}");
        assert!(
            e004[0].message.contains(want),
            "{what} message must contain `{want}`, got: {}",
            e004[0].message
        );
    }

    #[test]
    fn e004_slash_in_system_label_rejected() {
        assert_one_e004(r#"system "a/b" { full_name = "d" }"#, "system", "a/b");
    }

    #[test]
    fn e004_slash_in_component_label_rejected() {
        assert_one_e004(r#"component "a/b" { full_name = "d" }"#, "component", "a/b");
    }

    #[test]
    fn e004_empty_component_label_rejected() {
        assert_one_e004(
            r#"component "" { full_name = "d" }"#,
            "component",
            "must not be empty",
        );
    }

    #[test]
    fn e004_slash_in_instance_label_rejected() {
        assert_one_e004(
            r#"
            component "c" { leaf = true }
            system "s" {
              instance "a/b" { source = "c" }
            }
            "#,
            "instance",
            "a/b",
        );
    }

    #[test]
    fn e004_slash_in_port_label_rejected() {
        assert_one_e004(
            r#"
            component "c" {
              leaf = true
              port "a/b" { role = "provider" }
            }
            "#,
            "port",
            "a/b",
        );
    }

    #[test]
    fn e004_slash_in_connection_label_rejected() {
        assert_one_e004(
            r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" {
              leaf = true
              port "q" { role = "consumer" }
            }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "a/b" {
                from = "a/p"
                to   = "b/q"
              }
            }
            "#,
            "connection",
            "a/b",
        );
    }

    // ── delegation + proxy ports (0006) ──────────────────────────────────────

    /// Weather-service fixture: `weather-service/api` (proxy) delegates to
    /// `proxy/http`; `user/out` talks to the boundary from outside.
    fn delegation_fixture() -> &'static str {
        r#"
protocol "rest" {
  leaf = true
  roles = ["provider", "consumer"]
  message "req" {
    field "path" { type = "string" }
  }
}
component "reverse-proxy" {
  leaf = true
  port "http" {
    protocol = "rest"
    role = "provider"
    external = true
  }
}
component "weather-service" {
  port "api" { external = true }
  instance "proxy" { source = "reverse-proxy" }
  connection "api-delegation" {
    from = "./api"
    to   = "proxy/http"
  }
}
component "user" {
  leaf = true
  port "out" {
    protocol = "rest"
    role = "consumer"
    external = true
  }
}
system "app" {
  instance "user" { source = "user" }
  instance "weather-service" { source = "weather-service" }
  connection "forecast" {
    from = "user/out"
    to   = "weather-service/api"
  }
}
"#
    }

    /// Instance-owned port `label` on the instance sourced from `definition`.
    fn instance_port<'a>(model: &'a Model, definition: &str, label: &str) -> &'a Port {
        model
            .ports
            .iter()
            .find(|p| {
                p.label == label
                    && model.component(p.owner).is_some_and(|c| {
                        c.kind == ComponentKind::Instance && c.source.as_deref() == Some(definition)
                    })
            })
            .unwrap_or_else(|| panic!("instance port `{label}` sourced from `{definition}`"))
    }

    #[test]
    fn delegation_proxy_port_inherits_type() {
        let (model, warnings) = resolve_src(delegation_fixture()).expect("resolves");
        assert!(
            warnings.iter().all(|d| !d.is_error()),
            "unexpected errors: {warnings:?}"
        );
        let api = instance_port(&model, "weather-service", "api");
        assert!(api.inferred, "outer port must be marked inferred");
        assert_eq!(api.protocol, "rest");
        assert_eq!(api.role.as_deref(), Some("provider"));
        // Terminal provenance: the type comes from the inner listener port.
        let terminal = api.inferred_from.and_then(|pid| model.port(pid));
        let terminal = terminal.expect("inferred port names its terminal");
        assert_eq!(terminal.label, "http");
        assert_eq!(
            model.component(terminal.owner).map(|c| c.label.as_str()),
            Some("proxy"),
            "terminal is the proxy copy at the end of the 1-hop chain"
        );
        assert_eq!(
            api.protocol_id,
            model
                .protocols
                .iter()
                .position(|p| p.label == "rest")
                .map(ProtocolId)
        );
        let delegations: Vec<&Connection> = model
            .connections
            .iter()
            .filter(|c| c.label == "api-delegation")
            .collect();
        assert!(!delegations.is_empty(), "delegation edge must exist");
        for conn in delegations {
            assert!(conn.is_delegation, "must be marked delegation");
            assert!(conn.from.is_self ^ conn.to.is_self, "exactly one self end");
        }
        // The outside assembly edge reads the inherited protocol.
        let forecast = model
            .connections
            .iter()
            .find(|c| c.label == "forecast")
            .expect("forecast");
        assert!(!forecast.is_delegation);
        assert!(
            model
                .connection_protocol(ConnectionId(
                    model
                        .connections
                        .iter()
                        .position(|c| c.label == "forecast")
                        .expect("idx")
                ))
                .is_some(),
            "forecast must resolve a protocol via the inherited proxy type"
        );
    }

    #[test]
    fn delegation_transitive_nhop_inherits_terminal_type() {
        let src = r#"
protocol "rest" {
  leaf = true
  roles = ["provider", "consumer"]
  message "req" {
    field "path" { type = "string" }
  }
}
component "listener" {
  leaf = true
  port "http" {
    protocol = "rest"
    role = "provider"
    external = true
  }
}
component "reverse-proxy" {
  port "http" { external = true }
  instance "listener" { source = "listener" }
  connection "http-delegation" {
    from = "./http"
    to   = "listener/http"
  }
}
component "weather-service" {
  port "api" { external = true }
  instance "proxy" { source = "reverse-proxy" }
  connection "api-delegation" {
    from = "./api"
    to   = "proxy/http"
  }
}
system "app" {
  instance "weather-service" { source = "weather-service" }
}
"#;
        let (model, _) = resolve_src(src).expect("resolves");
        let api = instance_port(&model, "weather-service", "api");
        assert!(api.inferred);
        assert_eq!(api.protocol, "rest");
        assert_eq!(api.role.as_deref(), Some("provider"));
        let mid = instance_port(&model, "reverse-proxy", "http");
        assert!(mid.inferred);
        assert_eq!(mid.protocol, "rest");
    }

    #[test]
    fn delegation_bare_port_stays_e003() {
        let src = r#"
component "reverse-proxy" {
  leaf = true
  port "http" {
    role = "provider"
    external = true
  }
}
component "weather-service" {
  port "api" { external = true }
  instance "proxy" { source = "reverse-proxy" }
  connection "api-delegation" {
    from = "api"
    to   = "proxy/http"
  }
}
"#;
        let diags = expect_codes(src, &["E003"]);
        assert!(diags[0].message.contains("./port"), "{}", diags[0].message);
    }

    #[test]
    fn delegation_deep_bypass_from_system_stays_legal() {
        // Naming internals directly from the system (deep bypass) stays legal
        // for migration; it is an ordinary assembly edge, not delegation.
        let src2 = r#"
component "inner" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "outer" {
  port "api" { external = true }
  instance "inner" { source = "inner" }
  connection "ok" {
    from = "./api"
    to   = "inner/p"
  }
}
component "sibling" {
  leaf = true
  port "q" {
    role = "consumer"
    external = true
  }
}
system "s" {
  instance "outer" { source = "outer" }
  instance "sibling" { source = "sibling" }
  connection "clean" {
    from = "outer/api"
    to   = "sibling/q"
  }
  connection "bypass" {
    from = "outer/inner/p"
    to   = "sibling/q"
  }
}
"#;
        // The clean boundary edge and the deep bypass both resolve: deep
        // bypass stays legal for migration (no new diagnostic).
        let (model, _) = resolve_src(src2).expect("delegation plus deep bypass resolves");
        assert!(
            model
                .connections
                .iter()
                .any(|c| c.label == "bypass" && !c.is_delegation),
            "deep bypass is ordinary assembly"
        );
    }

    #[test]
    fn delegation_with_realized_by_is_e019() {
        let src = r#"
protocol "rest" { leaf = true }
component "reverse-proxy" {
  leaf = true
  port "http" {
    protocol = "rest"
    role = "provider"
    external = true
  }
  port "aux" {
    protocol = "rest"
    role = "provider"
    external = true
  }
}
component "weather-service" {
  port "api" { external = true }
  instance "proxy" { source = "reverse-proxy" }
  connection "other" {
    from = "proxy/aux"
    to   = "proxy/aux"
  }
  connection "api-delegation" {
    from = "./api"
    to   = "proxy/http"
    realized_by = ["other"]
  }
}
"#;
        let diags = expect_codes(src, &["E019"]);
        assert!(
            diags[0].message.contains("delegation"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_fanout_is_e022() {
        let src = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "leaf-b" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "svc" {
  port "api" { external = true }
  instance "a" { source = "leaf-a" }
  instance "b" { source = "leaf-b" }
  connection "d1" {
    from = "./api"
    to   = "a/p"
  }
  connection "d2" {
    from = "./api"
    to   = "b/p"
  }
}
"#;
        let diags = expect_codes(src, &["E022"]);
        assert!(
            diags[0].message.contains("fans out"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_explicit_outer_is_e022() {
        let src = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    protocol = "rest"
    role = "provider"
    external = true
  }
}
protocol "rest" { leaf = true }
component "svc" {
  port "api" {
    protocol = "rest"
    role = "provider"
    external = true
  }
  instance "a" { source = "leaf-a" }
  connection "d" {
    from = "./api"
    to   = "a/p"
  }
}
"#;
        let diags = expect_codes(src, &["E022"]);
        assert!(
            diags[0]
                .message
                .contains("must not be a delegation endpoint"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_internal_proxy_is_e022() {
        let src = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "svc" {
  port "api" { external = false }
  instance "a" { source = "leaf-a" }
  connection "d" {
    from = "./api"
    to   = "a/p"
  }
}
"#;
        let diags = expect_codes(src, &["E022"]);
        assert!(
            diags[0].message.contains("external = true"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_on_leaf_is_e022() {
        let src = r#"
component "svc" {
  leaf = true
  port "api" { external = true }
}
"#;
        // A leaf cannot delegate (E005 fires for children/connections, E022
        // for the proxy shape itself) — shape check on a leaf with an edge:
        let src2 = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "svc" {
  leaf = true
  port "api" { external = true }
  instance "a" { source = "leaf-a" }
  connection "d" {
    from = "./api"
    to   = "a/p"
  }
}
"#;
        let _ = src;
        let diags = resolve_src(src2).expect_err("leaf delegation must fail");
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E022),
            "expected E022, got: {diags:?}"
        );
    }

    #[test]
    fn delegation_double_driven_target_is_e022() {
        let src = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "leaf-b" {
  leaf = true
  port "q" {
    role = "consumer"
    external = true
  }
}
component "svc" {
  port "api" { external = true }
  instance "a" { source = "leaf-a" }
  instance "b" { source = "leaf-b" }
  connection "d" {
    from = "./api"
    to   = "a/p"
  }
  connection "extra" {
    from = "a/p"
    to   = "b/q"
  }
}
"#;
        let diags = expect_codes(src, &["E022"]);
        assert!(
            diags[0].message.contains("double-driven"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_both_self_ends_is_e022() {
        let src = r#"
component "svc" {
  port "a" { external = true }
  port "b" { external = true }
  connection "d" {
    from = "./a"
    to   = "./b"
  }
}
"#;
        let diags = expect_codes(src, &["E022"]);
        assert!(
            diags[0].message.contains("exactly one"),
            "{}",
            diags[0].message
        );
    }

    #[test]
    fn delegation_realized_by_target_is_e017() {
        let src = r#"
component "leaf-a" {
  leaf = true
  port "p" {
    role = "provider"
    external = true
  }
}
component "leaf-b" {
  leaf = true
  port "q" {
    role = "consumer"
    external = true
  }
}
component "svc" {
  port "api" { external = true }
  instance "a" { source = "leaf-a" }
  connection "d" {
    from = "./api"
    to   = "a/p"
  }
}
system "s" {
  instance "svc" { source = "svc" }
  instance "b" { source = "leaf-b" }
  connection "high" {
    from = "svc/api"
    to   = "b/q"
    realized_by = ["svc/d"]
  }
}
"#;
        let diags = expect_codes(src, &["E017"]);
        assert!(
            diags[0].message.contains("delegation"),
            "{}",
            diags[0].message
        );
    }

    /// Chain follower over hand-built maps: `outer -> target` with `max_hops`.
    fn follow(
        edges: &[(usize, usize)],
        candidates: &[usize],
        start: usize,
        max_hops: usize,
    ) -> (Option<PortId>, bool) {
        let single_edge: HashMap<PortId, PortId> = edges
            .iter()
            .map(|(a, b)| (PortId(*a), PortId(*b)))
            .collect();
        let candidates: HashSet<PortId> = candidates.iter().copied().map(PortId).collect();
        let mut memo = HashMap::new();
        follow_delegation_chain(
            &single_edge,
            &candidates,
            &mut memo,
            PortId(start),
            max_hops,
        )
    }

    #[test]
    fn delegation_chain_follows_to_terminal() {
        // 0 -> 1 -> 2 -> 3(explicit): terminal is 3 within the cap.
        let (terminal, exceeded) = follow(&[(0, 1), (1, 2), (2, 3)], &[0, 1, 2], 0, 1024);
        assert!(!exceeded);
        assert_eq!(terminal, Some(PortId(3)));
    }

    #[test]
    fn delegation_chain_cap_reports_exceeded() {
        // Same chain with a tiny cap: the walk aborts past 2 hops.
        let (terminal, exceeded) = follow(&[(0, 1), (1, 2), (2, 3)], &[0, 1, 2], 0, 2);
        assert!(exceeded);
        assert_eq!(terminal, None);
    }

    #[test]
    fn delegation_chain_dangling_intermediate_is_terminal() {
        // 1 omits its type but has no edge: the chain ends there.
        let (terminal, exceeded) = follow(&[(0, 1)], &[0, 1], 0, 1024);
        assert!(!exceeded);
        assert_eq!(terminal, Some(PortId(1)));
    }

    #[test]
    fn delegation_chain_memoized_suffix_reused() {
        // Two outers sharing a suffix: the second reuses the first's walk.
        let single_edge: HashMap<PortId, PortId> = [(0, 2), (1, 2), (2, 3)]
            .iter()
            .map(|(a, b)| (PortId(*a), PortId(*b)))
            .collect();
        let candidates: HashSet<PortId> = [0, 1, 2].iter().copied().map(PortId).collect();
        let mut memo = HashMap::new();
        let (t0, e0) =
            follow_delegation_chain(&single_edge, &candidates, &mut memo, PortId(0), 1024);
        assert!(!e0);
        assert_eq!(t0, Some(PortId(3)));
        let memo_len = memo.len();
        let (t1, e1) =
            follow_delegation_chain(&single_edge, &candidates, &mut memo, PortId(1), 1024);
        assert!(!e1);
        assert_eq!(t1, Some(PortId(3)));
        assert!(
            memo.len() <= memo_len + 1,
            "shared suffix must be reused, not rewalked"
        );
    }

    #[test]
    fn delegation_deep_chain_resolves_without_e021() {
        // 40 nested levels: transitivity at depth, no false cap trip.
        // (The 1024 cap itself is pinned by the `follow_*` unit tests above.)
        let depth: usize = 40;
        let mut src = String::from("protocol \"p\" { leaf = true }\n");
        for i in 0..depth {
            let next = i + 1;
            if i + 1 == depth {
                let _ = writeln!(
                    src,
                    "component \"c{i}\" {{\n  leaf = true\n  port \"p\" {{\n    protocol = \"p\"\n    role = \"provider\"\n    external = true\n  }}\n}}"
                );
            } else {
                let _ = writeln!(
                    src,
                    "component \"c{i}\" {{\n  port \"p\" {{ external = true }}\n  instance \"sub\" {{ source = \"c{next}\" }}\n  connection \"d{i}\" {{\n    from = \"./p\"\n    to   = \"sub/p\"\n  }}\n}}"
                );
            }
        }
        src.push_str("system \"s\" {\n  instance \"top\" { source = \"c0\" }\n}\n");
        let (model, _) = resolve_src(&src).expect("40-deep chain resolves");
        let api = instance_port(&model, "c0", "p");
        assert!(api.inferred);
        assert_eq!(api.protocol, "p");
    }

    #[test]
    fn e004_slash_in_protocol_message_field_labels_rejected() {
        assert_one_e004(r#"protocol "a/b" {}"#, "protocol", "a/b");
        assert_one_e004(
            r#"
            protocol "p" {
              message "a/b" {
                field "x" { type = "uint8" }
              }
            }
            "#,
            "message",
            "a/b",
        );
        assert_one_e004(
            r#"
            protocol "p" {
              message "m" {
                field "a/b" { type = "uint8" }
              }
            }
            "#,
            "field",
            "a/b",
        );
    }
}
