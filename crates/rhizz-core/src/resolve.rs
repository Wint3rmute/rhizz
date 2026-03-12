use crate::model::{
    Component, ComponentId, ComponentParent, Connection, ConnectionEndpoint, ConnectionId,
    Diagnostic, DiagnosticCode, Field, FieldId, Message, MessageId, Model, Port, PortId, PortRole,
    Project, Scope, ScopeIndex, System, SystemId, View, ViewFilter, ViewOutput,
};
use crate::parse::{Labeled, RawComponent, RawConnection, RawFile, RawMessage};
use std::collections::{HashMap, HashSet};
use tracing::instrument;

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
    /// Maps system label -> SystemId for view resolution.
    system_label_index: HashMap<String, SystemId>,
    /// Top-level component labels that were referenced by at least one `source` attribute.
    used_top_level_labels: HashSet<String>,
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
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Resolve a merged `RawFile` into a fully cross-referenced `Model`.
///
/// On success returns `Ok((model, warnings))`.
/// If any hard errors (E-codes) were encountered returns `Err(all_diagnostics)`.
#[instrument(skip(raw))]
pub fn resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>> {
    let mut r = Resolver::default();

    // ── Project ───────────────────────────────────────────────────────────────
    let p = raw.project.unwrap_or_default();
    r.model.project = Project {
        name: p.name.unwrap_or_default(),
        version: p.version.unwrap_or_else(|| "0.0.0".to_owned()),
        authors: p.authors,
    };

    // ── Systems ───────────────────────────────────────────────────────────────
    //
    // Two-phase loop per system so that system-level connections can reference
    // any direct-child component regardless of declaration order.
    //
    // Phase A: allocate SystemId, register all components (recursive)
    // Phase B: process system-level connections + resolve encapsulates

    // Build top-level component map for source resolution.
    let mut top_level_components: HashMap<String, RawComponent> = HashMap::new();
    {
        let mut tl_seen: HashSet<String> = HashSet::new();
        for lc in raw.components {
            if !tl_seen.insert(lc.label.clone()) {
                r.push_error(
                    DiagnosticCode::E001,
                    format!("duplicate top-level component label '{}'", lc.label),
                );
                continue;
            }
            top_level_components.insert(lc.label, lc.inner);
        }
    }

    let mut system_labels_seen: HashSet<String> = HashSet::new();

    struct SystemWork {
        sid: SystemId,
        label: String,
        connections: Vec<Labeled<RawConnection>>,
        system_level: i32,
    }
    let mut pending_systems: Vec<SystemWork> = Vec::new();

    for ls in raw.systems {
        if !system_labels_seen.insert(ls.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!("duplicate system label '{}'", ls.label),
            );
            continue;
        }

        let sid = SystemId(r.model.systems.len());
        r.system_label_index.insert(ls.label.clone(), sid);
        let system_level = ls.inner.level.unwrap_or(0);

        r.model.systems.push(System {
            label: ls.label.clone(),
            description: ls.inner.description.clone().unwrap_or_default(),
            tags: ls.inner.tags.clone(),
            level: system_level,
            components: vec![],
            connections: vec![],
        });

        // Phase A: register all direct-child components (each one recursively
        // handles its own children, ports, and their nested connections).
        let scope = Scope::System(sid);
        let mut comp_labels_seen: HashSet<String> = HashSet::new();
        let mut child_ids: Vec<ComponentId> = Vec::new();
        let mut ancestors: Vec<String> = Vec::new();

        for lc in &ls.inner.components {
            if !comp_labels_seen.insert(lc.label.clone()) {
                r.push_error(
                    DiagnosticCode::E001,
                    format!(
                        "duplicate component label '{}' in system '{}'",
                        lc.label, ls.label
                    ),
                );
                continue;
            }
            let cid = register_component(
                &mut r,
                lc,
                scope,
                ComponentParent::System(sid),
                system_level,
                &top_level_components,
                &mut ancestors,
            );
            child_ids.push(cid);
        }
        r.model.systems[sid.0].components = child_ids;

        pending_systems.push(SystemWork {
            sid,
            label: ls.label,
            connections: ls.inner.connections,
            system_level,
        });
    }

    // Phase B: system-level connections
    for sw in pending_systems {
        let scope = Scope::System(sw.sid);
        let conn_ids = process_connections_in_scope(
            &mut r,
            &sw.connections,
            scope,
            sw.system_level,
            &sw.label,
        );

        // Resolve encapsulates now that all sibling connections are registered.
        for (lc, cid) in sw.connections.iter().zip(conn_ids.iter()) {
            resolve_encapsulates(&mut r, *cid, &lc.inner.encapsulates, scope, &lc.label);
        }

        r.model.systems[sw.sid.0].connections = conn_ids;
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    for lv in raw.views {
        resolve_view(&mut r, lv);
    }

    // ── W012: orphan top-level components ─────────────────────────────────────
    {
        let mut orphan_labels: Vec<&str> = top_level_components
            .keys()
            .filter(|label| !r.used_top_level_labels.contains(*label))
            .map(|s| s.as_str())
            .collect();
        orphan_labels.sort();
        for label in orphan_labels {
            r.push_warning(
                DiagnosticCode::W012,
                format!(
                    "top-level component '{}' is not referenced by any 'source'",
                    label
                ),
            );
        }
    }

    // ── Warnings ──────────────────────────────────────────────────────────────
    r.diagnostics.extend(crate::validate::validate(&r.model));

    // ── Return ────────────────────────────────────────────────────────────────
    let has_errors = r.diagnostics.iter().any(|d| d.is_error());
    if has_errors {
        Err(r.diagnostics)
    } else {
        let warnings = r
            .diagnostics
            .into_iter()
            .filter(|d| d.is_warning())
            .collect();
        Ok((r.model, warnings))
    }
}

// ── Component registration ────────────────────────────────────────────────────

/// Register a raw component (and its subtree) into the arena.
///
/// Order within each scope:
///   1. Register the component itself in `parent_scope`.
///   2. Register all child components in the component's own scope.
///   3. Process ports on the component.
///   4. Process connections in the component's own scope (from/to resolved).
///   5. Resolve encapsulates for those connections.
///
/// When `lc.inner.source` is set the body is taken from the top-level
/// component map instead of from `lc.inner`.  The `ancestors` stack is used
/// for cycle detection (E013).
fn register_component(
    r: &mut Resolver,
    lc: &Labeled<RawComponent>,
    parent_scope: Scope,
    parent: ComponentParent,
    parent_level: i32,
    top_level: &HashMap<String, RawComponent>,
    ancestors: &mut Vec<String>,
) -> ComponentId {
    let initial_depth = ancestors.len();

    // Resolve source if present, following the chain with cycle detection.
    // Returns Some(body) when source resolves successfully, or early-returns
    // (with a placeholder ComponentId) on E013/E014.  Returns None when no
    // source attribute is set.
    let source_body: Option<RawComponent> = if let Some(ref src_label) = lc.inner.source {
        // E012: source must be exclusive — no other attrs or child blocks.
        let has_other = lc.inner.description.is_some()
            || !lc.inner.tags.is_empty()
            || lc.inner.level.is_some()
            || lc.inner.leaf.is_some()
            || !lc.inner.ports.is_empty()
            || !lc.inner.components.is_empty()
            || !lc.inner.connections.is_empty();
        if has_other {
            r.push_error(
                DiagnosticCode::E012,
                format!(
                    "component '{}' has 'source' together with other attributes or blocks",
                    lc.label
                ),
            );
        }

        // Follow source chain: push each label and look up the final concrete body.
        let mut current_label = src_label.clone();
        let resolved = loop {
            // E013: cycle detection.
            if ancestors.iter().any(|a| a == &current_label) {
                r.push_error(
                    DiagnosticCode::E013,
                    format!(
                        "circular 'source' chain detected involving '{}' (at component '{}')",
                        current_label, lc.label
                    ),
                );
                let cid = ComponentId(r.model.components.len());
                r.scope_index
                    .components
                    .insert((parent_scope, lc.label.clone()), cid);
                r.model.components.push(Component {
                    label: lc.label.clone(),
                    description: String::new(),
                    tags: vec![],
                    level: parent_level + 1,
                    leaf: false,
                    parent,
                    children: vec![],
                    ports: vec![],
                    connections: vec![],
                });
                ancestors.truncate(initial_depth);
                return cid;
            }
            ancestors.push(current_label.clone());
            r.used_top_level_labels.insert(current_label.clone());

            match top_level.get(&current_label) {
                None => {
                    // E014: undefined source label.
                    r.push_error(
                        DiagnosticCode::E014,
                        format!(
                            "component '{}' sources undefined top-level component '{}'",
                            lc.label, current_label
                        ),
                    );
                    let cid = ComponentId(r.model.components.len());
                    r.scope_index
                        .components
                        .insert((parent_scope, lc.label.clone()), cid);
                    r.model.components.push(Component {
                        label: lc.label.clone(),
                        description: String::new(),
                        tags: vec![],
                        level: parent_level + 1,
                        leaf: false,
                        parent,
                        children: vec![],
                        ports: vec![],
                        connections: vec![],
                    });
                    ancestors.truncate(initial_depth);
                    return cid;
                }
                Some(found_body) => match &found_body.source {
                    None => break found_body.clone(),
                    Some(next) => current_label = next.clone(),
                },
            }
        };
        Some(resolved)
    } else {
        None
    };

    let body: &RawComponent = source_body.as_ref().unwrap_or(&lc.inner);

    let cid = ComponentId(r.model.components.len());
    let level = body.level.unwrap_or(parent_level + 1);
    let leaf = body.leaf.unwrap_or(false);

    // E005 -- leaf component with children or connections
    if leaf && (!body.components.is_empty() || !body.connections.is_empty()) {
        r.push_error(
            DiagnosticCode::E005,
            format!(
                "leaf component '{}' contains child components or connections",
                lc.label
            ),
        );
    }

    // Register in parent scope so siblings can reference it.
    r.scope_index
        .components
        .insert((parent_scope, lc.label.clone()), cid);

    // Push placeholder; children/ports/connections filled in below.
    r.model.components.push(Component {
        label: lc.label.clone(),
        description: body.description.clone().unwrap_or_default(),
        tags: body.tags.clone(),
        level,
        leaf,
        parent,
        children: vec![],
        ports: vec![],
        connections: vec![],
    });

    let child_scope = Scope::Component(cid);

    // Step 1: register child components in this component's scope.
    let mut child_label_seen: HashSet<String> = HashSet::new();
    let mut child_ids: Vec<ComponentId> = Vec::new();
    for child_lc in &body.components {
        if !child_label_seen.insert(child_lc.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate component label '{}' in component '{}'",
                    child_lc.label, lc.label
                ),
            );
            continue;
        }
        let child_cid = register_component(
            r,
            child_lc,
            child_scope,
            ComponentParent::Component(cid),
            level,
            top_level,
            ancestors,
        );
        child_ids.push(child_cid);
    }
    r.model.components[cid.0].children = child_ids;

    // Step 2: process ports on this component.
    let port_ids = process_ports(r, &body.ports, cid, level, &lc.label);
    r.model.components[cid.0].ports = port_ids;

    // Step 3: process connections in this component's scope.
    let conn_ids =
        process_connections_in_scope(r, &body.connections, child_scope, level, &lc.label);

    // Step 4: resolve encapsulates for those connections.
    for (li, conn_id) in body.connections.iter().zip(conn_ids.iter()) {
        resolve_encapsulates(r, *conn_id, &li.inner.encapsulates, child_scope, &li.label);
    }

    r.model.components[cid.0].connections = conn_ids;

    // Restore ancestors to where they were before this call.
    ancestors.truncate(initial_depth);

    cid
}

// ── Port processing ───────────────────────────────────────────────────────────

/// Process port blocks on a component, returning their `PortId`s.
fn process_ports(
    r: &mut Resolver,
    ports: &[Labeled<crate::parse::RawPort>],
    owner: ComponentId,
    parent_level: i32,
    comp_label: &str,
) -> Vec<PortId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut port_ids: Vec<PortId> = Vec::new();

    for lp in ports {
        if !label_seen.insert(lp.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate port label '{}' in component '{}'",
                    lp.label, comp_label
                ),
            );
            continue;
        }

        // E009 -- invalid port.role
        let role = match lp.inner.role.as_deref() {
            None | Some("peer") => PortRole::Peer,
            Some("provider") => PortRole::Provider,
            Some("consumer") => PortRole::Consumer,
            Some(other) => {
                r.push_error(
                    DiagnosticCode::E009,
                    format!("port '{}' has invalid role '{}'", lp.label, other),
                );
                PortRole::Peer // placeholder so we keep going
            }
        };

        // Process messages inside this port.
        let msg_ids = process_messages(r, &lp.inner.messages, parent_level, &lp.label);

        let pid = PortId(r.model.ports.len());
        // Register in scope_index so connection endpoints can find it.
        r.scope_index.ports.insert((owner, lp.label.clone()), pid);

        r.model.ports.push(Port {
            label: lp.label.clone(),
            description: lp.inner.description.clone().unwrap_or_default(),
            protocol: lp.inner.protocol.clone().unwrap_or_default(),
            role,
            tags: lp.inner.tags.clone(),
            owner,
            messages: msg_ids,
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
) -> Vec<ConnectionId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut conn_ids: Vec<ConnectionId> = Vec::new();

    for lc in connections {
        if !label_seen.insert(lc.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate connection label '{}' in '{}'",
                    lc.label, scope_name
                ),
            );
            continue;
        }

        let level = lc.inner.level.unwrap_or(parent_level + 1);

        // Resolve `from` endpoint
        let from = resolve_endpoint(r, &lc.inner.from, scope, &lc.label, "from");

        // Resolve `to` endpoint
        let to = resolve_endpoint(r, &lc.inner.to, scope, &lc.label, "to");

        // Allocate ConnectionId and register in scope so encapsulates can find it.
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
        };
        let from_ep = from.unwrap_or_else(|| sentinel.clone());
        let to_ep = to.unwrap_or(sentinel);

        r.model.connections.push(Connection {
            label: lc.label.clone(),
            description: lc.inner.description.clone().unwrap_or_default(),
            tags: lc.inner.tags.clone(),
            level,
            from: from_ep,
            to: to_ep,
            encapsulates: vec![], // filled by resolve_encapsulates
        });

        conn_ids.push(conn_id);
    }

    conn_ids
}

/// Resolve a single `from` or `to` string into a `ConnectionEndpoint`.
///
/// Supports two forms:
/// - `"comp"` -- bare component label (E002 if not found)
/// - `"comp:port"` -- typed reference (E011 if comp not found, E010 if port not found)
///
/// Returns `None` and emits the appropriate error if resolution fails.
fn resolve_endpoint(
    r: &mut Resolver,
    ref_str: &Option<String>,
    scope: Scope,
    conn_label: &str,
    field: &str,
) -> Option<ConnectionEndpoint> {
    let raw = match ref_str {
        None => {
            r.push_error(
                DiagnosticCode::E002,
                format!(
                    "connection '{}' is missing required '{}' attribute",
                    conn_label, field
                ),
            );
            return None;
        }
        Some(s) => s,
    };

    if let Some((comp_part, port_part)) = raw.split_once(':') {
        // Typed reference: comp:port
        let comp_cid = match r.scope_index.components.get(&(scope, comp_part.to_owned())) {
            Some(cid) => *cid,
            None => {
                r.push_error(
                    DiagnosticCode::E011,
                    format!(
                        "connection '{}' references undefined component '{}' in '{}' (comp:port)",
                        conn_label, comp_part, field
                    ),
                );
                return None;
            }
        };
        let port_pid = match r.scope_index.ports.get(&(comp_cid, port_part.to_owned())) {
            Some(pid) => *pid,
            None => {
                r.push_error(
                    DiagnosticCode::E010,
                    format!(
                        "connection '{}': component '{}' has no port '{}' (in '{}')",
                        conn_label, comp_part, port_part, field
                    ),
                );
                return None;
            }
        };
        Some(ConnectionEndpoint {
            component: comp_cid,
            port: Some(port_pid),
        })
    } else {
        // Bare component reference
        match r.scope_index.components.get(&(scope, raw.clone())) {
            Some(cid) => Some(ConnectionEndpoint {
                component: *cid,
                port: None,
            }),
            None => {
                r.push_error(
                    DiagnosticCode::E002,
                    format!(
                        "connection '{}' references undefined component '{}' in '{}'",
                        conn_label, raw, field
                    ),
                );
                None
            }
        }
    }
}

/// Resolve `encapsulates` labels for an already-allocated connection.
/// Emits E003 for missing references and detects E004 circular chains.
fn resolve_encapsulates(
    r: &mut Resolver,
    conn_id: ConnectionId,
    encapsulates: &[String],
    scope: Scope,
    conn_label: &str,
) {
    if encapsulates.is_empty() {
        return;
    }
    let mut enc_ids: Vec<ConnectionId> = Vec::new();
    for label in encapsulates {
        match r.scope_index.connections.get(&(scope, label.clone())) {
            Some(enc_cid) => enc_ids.push(*enc_cid),
            None => {
                r.push_error(
                    DiagnosticCode::E003,
                    format!(
                        "connection '{}' encapsulates undefined connection '{}'",
                        conn_label, label
                    ),
                );
            }
        }
    }
    r.model.connections[conn_id.0].encapsulates = enc_ids;

    // E004 -- detect circular encapsulation by DFS from this connection.
    if has_encapsulation_cycle(&r.model.connections, conn_id) {
        r.push_error(
            DiagnosticCode::E004,
            format!(
                "circular encapsulation chain detected involving connection '{}'",
                conn_label
            ),
        );
        // Clear the encapsulates list to break the cycle in the model.
        r.model.connections[conn_id.0].encapsulates.clear();
    }
}

/// DFS cycle detection in the encapsulates graph starting from `start`.
fn has_encapsulation_cycle(connections: &[Connection], start: ConnectionId) -> bool {
    let mut gray: HashSet<usize> = HashSet::new();
    let mut black: HashSet<usize> = HashSet::new();
    let mut stack: Vec<(usize, usize)> = vec![(start.0, 0)];

    while let Some((node, child_idx)) = stack.last_mut() {
        let node = *node;
        let children = &connections[node].encapsulates;

        if *child_idx == 0 {
            if black.contains(&node) {
                stack.pop();
                continue;
            }
            if gray.contains(&node) {
                return true;
            }
            gray.insert(node);
        }

        let idx = *child_idx;
        if idx < children.len() {
            *stack.last_mut().unwrap() = (node, idx + 1);
            let child = children[idx].0;
            stack.push((child, 0));
        } else {
            gray.remove(&node);
            black.insert(node);
            stack.pop();
        }
    }
    false
}

// ── Message / Field processing ────────────────────────────────────────────────

/// Process message blocks within a port, returning their `MessageId`s.
fn process_messages(
    r: &mut Resolver,
    messages: &[Labeled<RawMessage>],
    parent_level: i32,
    port_label: &str,
) -> Vec<MessageId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut msg_ids: Vec<MessageId> = Vec::new();

    for lm in messages {
        if !label_seen.insert(lm.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate message label '{}' in port '{}'",
                    lm.label, port_label
                ),
            );
            continue;
        }

        let level = lm.inner.level.unwrap_or(parent_level);
        let field_ids = process_fields(r, &lm.inner.fields, &lm.label);

        let mid = MessageId(r.model.messages.len());
        r.model.messages.push(Message {
            label: lm.label.clone(),
            description: lm.inner.description.clone().unwrap_or_default(),
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
        if !label_seen.insert(lf.label.clone()) {
            r.push_error(
                DiagnosticCode::E001,
                format!(
                    "duplicate field label '{}' in message '{}'",
                    lf.label, msg_label
                ),
            );
            continue;
        }

        // E007 -- missing required `type`
        let field_type = match &lf.inner.field_type {
            Some(t) => t.clone(),
            None => {
                r.push_error(
                    DiagnosticCode::E007,
                    format!(
                        "field '{}' in message '{}' is missing required 'type'",
                        lf.label, msg_label
                    ),
                );
                String::new()
            }
        };

        let fid = FieldId(r.model.fields.len());
        r.model.fields.push(Field {
            label: lf.label.clone(),
            field_type,
            description: lf.inner.description.clone().unwrap_or_default(),
            unit: lf.inner.unit.clone().unwrap_or_default(),
            required: lf.inner.required.unwrap_or(false),
        });
        field_ids.push(fid);
    }

    field_ids
}

// ── View resolution ───────────────────────────────────────────────────────────

/// Resolve a raw view block, emitting E006 for undefined system references.
fn resolve_view(r: &mut Resolver, lv: Labeled<crate::parse::RawView>) {
    // E006 -- undefined system
    let system = match &lv.inner.system {
        None => {
            r.push_error(
                DiagnosticCode::E006,
                format!("view '{}' does not specify a system", lv.label),
            );
            return;
        }
        Some(sys_label) => match r.system_label_index.get(sys_label) {
            Some(sid) => *sid,
            None => {
                r.push_error(
                    DiagnosticCode::E006,
                    format!(
                        "view '{}' references undefined system '{}'",
                        lv.label, sys_label
                    ),
                );
                return;
            }
        },
    };

    let filter = {
        let f = lv.inner.filter.unwrap_or_default();
        ViewFilter {
            include_tags: f.include_tags,
            exclude_tags: f.exclude_tags,
            max_level: f.max_level,
            components: f.components,
            show_messages: f.show_messages.unwrap_or(false),
        }
    };
    let output = {
        let o = lv.inner.output.unwrap_or_default();
        ViewOutput {
            filename: o.filename.unwrap_or_else(|| format!("{}.dot", lv.label)),
            rankdir: o.rankdir.unwrap_or_else(|| "TB".to_owned()),
        }
    };

    r.model.views.push(View {
        label: lv.label,
        description: lv.inner.description.unwrap_or_default(),
        tags: lv.inner.tags,
        system,
        filter,
        output,
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::DiagnosticCode;
    use crate::parse::parse_dir;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
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

        // quadcopter has direct children
        let quad = &model.systems[quad_sid.0];
        assert!(
            quad.components.len() >= 7,
            "quadcopter should have >=7 direct components"
        );

        // flight-controller should be a non-leaf with children (mcu, imu, barometer)
        let fc_cid = quad
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "flight-controller")
            .expect("flight-controller component");
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

        // spi-imu connection is inside flight-controller scope: from=mcu:spi, to=imu:spi
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

        // motor-control connection at system level: has no messages (messages are on ports now)
        let mc_conn_id = quad
            .connections
            .iter()
            .copied()
            .find(|cid| model.connections[cid.0].label == "motor-control")
            .expect("motor-control");
        let mc = &model.connections[mc_conn_id.0];
        // from=flight-controller:motor-out, to=esc:motor-in
        assert_eq!(mc.from.component, fc_cid);
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
        assert_eq!(motor_out_port.messages.len(), 1);
        let throttle = &model.messages[motor_out_port.messages[0].0];
        assert_eq!(throttle.label, "throttle");
        assert_eq!(throttle.fields.len(), 2);

        // ground-control system exists
        let gc = &model.systems[gc_sid.0];
        assert!(gc.components.len() >= 3);

        // ground-station-pc: non-leaf, no children -> W001; no description -> W004
        let gpc_cid = gc
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "ground-station-pc")
            .expect("ground-station-pc");
        let gpc = &model.components[gpc_cid.0];
        assert!(!gpc.leaf);
        assert!(gpc.children.is_empty());
        assert!(gpc.description.is_empty());

        // Warnings: W001 for ground-station-pc, W004 for ground-station-pc
        let w001_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W001)
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w001_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W001 for ground-station-pc, got: {:?}",
            w001_labels
        );

        let w004_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W004)
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w004_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W004 for ground-station-pc, got: {:?}",
            w004_labels
        );

        // 4 views should resolve
        assert_eq!(model.views.len(), 4);
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
        assert!(model.components[rec_cid.0].children.is_empty());

        // rec-to-feed connection: from=recommendation-engine, to=feed-service (bare)
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

        // Warnings: W001 for recommendation-engine
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W001
                    && d.message.contains("recommendation-engine")),
            "expected W001 for recommendation-engine"
        );

        assert_eq!(model.views.len(), 3);
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

        // operations: non-leaf, no children -> W001; no description -> W004
        let ops_cid = acme
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "operations")
            .expect("operations");
        let ops = &model.components[ops_cid.0];
        assert!(!ops.leaf);
        assert!(ops.children.is_empty());
        assert!(ops.description.is_empty());

        // sprint-planning connection: from=product:sprint-out, to=engineering:sprint-in
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

        assert_eq!(model.views.len(), 3);
    }

    // ── Error cases ────────────────────────────────────────────────────────

    #[test]
    fn e002_undefined_from_to() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              connection "c" {
                from = "a"
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
            "expected E002, got: {:?}",
            diags
        );
    }

    #[test]
    fn e001_duplicate_component_label() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "a" { leaf = true }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E001),
            "expected E001, got: {:?}",
            diags
        );
    }

    #[test]
    fn e006_undefined_system_in_view() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
              }
            }
            view "v" {
              system = "nonexistent"
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E006),
            "expected E006, got: {:?}",
            diags
        );
    }

    #[test]
    fn e005_leaf_component_with_children() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                component "b" { leaf = true }
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E005),
            "expected E005, got: {:?}",
            diags
        );
    }

    #[test]
    fn e009_invalid_port_role() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p" {
                  role = "sideways"
                }
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E009),
            "expected E009, got: {:?}",
            diags
        );
    }

    #[test]
    fn e010_port_not_found() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              connection "c" {
                from = "a:nonexistent"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E010),
            "expected E010, got: {:?}",
            diags
        );
    }

    #[test]
    fn e011_comp_not_found_in_typed_ref() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              connection "c" {
                from = "a"
                to   = "ghost:port"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E011),
            "expected E011, got: {:?}",
            diags
        );
    }

    #[test]
    fn defaults_applied() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();

        // Default level: system=0, component=1, connection=1 (parent_level+1)
        assert_eq!(model.systems[0].level, 0);
        assert_eq!(model.components[0].level, 1);
        assert_eq!(model.connections[0].level, 1);
        // Default description = ""
        assert_eq!(model.systems[0].description, "");
        assert_eq!(model.components[0].description, "");
    }

    // ── source resolution ──────────────────────────────────────────────────────

    #[test]
    fn source_basic_clones_body() {
        let src = r#"
component "sensor" {
    description = "a temperature sensor"
    leaf = true
    port "data-out" {
        role = "provider"
    }
}
system "sys" {
    component "temp-sensor" {
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
        assert_eq!(tc.description, "a temperature sensor");
        assert!(tc.leaf);
        assert_eq!(tc.ports.len(), 1);
        assert_eq!(model.ports[tc.ports[0].0].label, "data-out");
    }

    #[test]
    fn source_exclusivity_e012() {
        let src = r#"
component "sensor" {
    description = "sensor"
    leaf = true
}
system "sys" {
    component "temp-sensor" {
        source = "sensor"
        description = "extra"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let errs = resolve(raw).unwrap_err();
        assert!(
            errs.iter().any(|d| d.code == DiagnosticCode::E012),
            "expected E012, got: {:?}",
            errs
        );
    }

    #[test]
    fn source_undefined_label_e014() {
        let src = r#"
system "sys" {
    component "mystery" {
        source = "nonexistent"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let errs = resolve(raw).unwrap_err();
        assert!(
            errs.iter().any(|d| d.code == DiagnosticCode::E014),
            "expected E014, got: {:?}",
            errs
        );
    }

    #[test]
    fn source_circular_e013() {
        let src = r#"
component "a" {
    source = "b"
}
component "b" {
    source = "a"
}
system "sys" {
    component "comp-a" {
        source = "a"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let errs = resolve(raw).unwrap_err();
        assert!(
            errs.iter().any(|d| d.code == DiagnosticCode::E013),
            "expected E013, got: {:?}",
            errs
        );
    }

    #[test]
    fn source_nested_works() {
        let src = r#"
component "c-comp" {
    description = "component C"
    leaf = true
}
component "b-comp" {
    description = "component B"
    component "child" {
        source = "c-comp"
    }
}
system "sys" {
    component "a" {
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
        assert_eq!(a.description, "component B");
        assert_eq!(a.children.len(), 1);
        let child = &model.components[a.children[0].0];
        assert_eq!(child.label, "child");
        assert_eq!(child.description, "component C");
        assert!(child.leaf);
    }

    #[test]
    fn source_same_component_two_systems() {
        let src = r#"
component "sensor" {
    description = "sensor"
    leaf = true
}
system "sys1" {
    component "s1" {
        source = "sensor"
    }
}
system "sys2" {
    component "s2" {
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
        assert_eq!(s1.description, "sensor");
        assert_eq!(s2.description, "sensor");
    }

    // ── W012: orphan top-level component ──────────────────────────────────────

    #[test]
    fn w012_referenced_top_level_no_warning() {
        let src = r#"
component "sensor" {
    description = "sensor"
    leaf = true
}
system "sys" {
    component "s" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected no W012 when top-level component is referenced, got: {:?}",
            warnings
        );
    }

    #[test]
    fn w012_unreferenced_top_level_emits_warning() {
        let src = r#"
component "unused" {
    description = "never referenced"
    leaf = true
}
system "sys" {
    component "a" { leaf = true }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected W012 for unreferenced top-level component, got: {:?}",
            warnings
        );
        let w = warnings
            .iter()
            .find(|d| d.code == DiagnosticCode::W012)
            .unwrap();
        assert!(
            w.message.contains("unused"),
            "W012 message should mention the label, got: {}",
            w.message
        );
    }

    #[test]
    fn w012_referenced_multiple_times_no_warning() {
        let src = r#"
component "sensor" {
    description = "sensor"
    leaf = true
}
system "sys1" {
    component "s1" {
        source = "sensor"
    }
}
system "sys2" {
    component "s2" {
        source = "sensor"
    }
}
"#;
        let path = std::path::Path::new("test.hcl");
        let raw = crate::parse::parse_file(src, path).unwrap();
        let (_model, warnings) = resolve(raw).expect("should resolve");
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W012),
            "expected no W012 when top-level component referenced multiple times, got: {:?}",
            warnings
        );
    }
}
