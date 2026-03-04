// Public API consumed by downstream passes (Tasks 3–6).
#![allow(dead_code)]

use crate::model::{
    Component, ComponentId, ComponentParent, Diagnostic, Direction, Field, FieldId, Interface,
    InterfaceId, Message, MessageId, Model, Project, Scope, ScopeIndex, System, SystemId, View,
    ViewFilter, ViewOutput,
};
use crate::parse::{Labeled, RawComponent, RawFile, RawInterface, RawMessage};
use std::collections::{HashMap, HashSet};

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
    /// Maps system label → SystemId for view resolution.
    system_label_index: HashMap<String, SystemId>,
}

impl Resolver {
    /// Record an error diagnostic.
    fn push_error(&mut self, code: &str, msg: impl Into<String>) {
        self.diagnostics.push(Diagnostic::error(code, msg));
    }

    /// Record a warning diagnostic.
    fn push_warning(&mut self, code: &str, msg: impl Into<String>) {
        self.diagnostics.push(Diagnostic::warning(code, msg));
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Resolve a merged `RawFile` into a fully cross-referenced `Model`.
///
/// On success returns `Ok((model, warnings))`.
/// If any hard errors (E-codes) were encountered returns `Err(all_diagnostics)`.
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
    // Two-phase loop per system so that system-level interfaces can reference
    // any direct-child component regardless of declaration order.
    //
    // Phase A: allocate SystemId, register all components (recursive)
    // Phase B: process system-level interfaces + resolve encapsulates

    let mut system_labels_seen: HashSet<String> = HashSet::new();

    // Collected so Phase B can iterate after all systems are in the arena.
    /// Deferred work for a system’s Phase B (interface processing).
    struct SystemWork {
        /// The allocated system id.
        sid: SystemId,
        /// System label (for diagnostics).
        label: String,
        /// Raw interfaces to resolve in Phase B.
        interfaces: Vec<Labeled<RawInterface>>,
        /// The system’s abstraction level.
        system_level: i32,
    }
    let mut pending_systems: Vec<SystemWork> = Vec::new();

    for ls in raw.systems {
        if !system_labels_seen.insert(ls.label.clone()) {
            r.push_error("E001", format!("duplicate system label '{}'", ls.label));
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
            interfaces: vec![],
        });

        // Phase A: register all direct-child components (each one recursively
        // handles its own children and their nested interfaces).
        let scope = Scope::System(sid);
        let mut comp_labels_seen: HashSet<String> = HashSet::new();
        let mut child_ids: Vec<ComponentId> = Vec::new();

        for lc in &ls.inner.components {
            if !comp_labels_seen.insert(lc.label.clone()) {
                r.push_error(
                    "E001",
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
            );
            child_ids.push(cid);
        }
        r.model.systems[sid.0].components = child_ids;

        pending_systems.push(SystemWork {
            sid,
            label: ls.label,
            interfaces: ls.inner.interfaces,
            system_level,
        });
    }

    // Phase B: system-level interfaces
    for sw in pending_systems {
        let scope = Scope::System(sw.sid);
        let iface_ids =
            process_interfaces_in_scope(&mut r, &sw.interfaces, scope, sw.system_level, &sw.label);

        // Resolve encapsulates now that all sibling interfaces are registered.
        for (li, iid) in sw.interfaces.iter().zip(iface_ids.iter()) {
            resolve_encapsulates(&mut r, *iid, &li.inner.encapsulates, scope, &li.label);
        }

        r.model.systems[sw.sid.0].interfaces = iface_ids;
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    for lv in raw.views {
        resolve_view(&mut r, lv);
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
///   3. Process interfaces in the component's own scope (from/to resolved).
///   4. Resolve encapsulates for those interfaces.
fn register_component(
    r: &mut Resolver,
    lc: &Labeled<RawComponent>,
    parent_scope: Scope,
    parent: ComponentParent,
    parent_level: i32,
) -> ComponentId {
    let cid = ComponentId(r.model.components.len());
    let level = lc.inner.level.unwrap_or(parent_level + 1);
    let leaf = lc.inner.leaf.unwrap_or(false);

    // E005 — leaf component with children
    if leaf && (!lc.inner.components.is_empty() || !lc.inner.interfaces.is_empty()) {
        r.push_error(
            "E005",
            format!(
                "leaf component '{}' contains child components or interfaces",
                lc.label
            ),
        );
    }

    // W007 — level decreasing relative to parent (checked in the validate pass)

    // Register in parent scope so siblings can reference it.
    r.scope_index
        .components
        .insert((parent_scope, lc.label.clone()), cid);

    // Push placeholder; children/interfaces filled in below.
    r.model.components.push(Component {
        label: lc.label.clone(),
        description: lc.inner.description.clone().unwrap_or_default(),
        tags: lc.inner.tags.clone(),
        level,
        leaf,
        parent,
        children: vec![],
        interfaces: vec![],
    });

    let child_scope = Scope::Component(cid);

    // Step 1: register child components in this component's scope.
    let mut child_label_seen: HashSet<String> = HashSet::new();
    let mut child_ids: Vec<ComponentId> = Vec::new();
    for child_lc in &lc.inner.components {
        if !child_label_seen.insert(child_lc.label.clone()) {
            r.push_error(
                "E001",
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
        );
        child_ids.push(child_cid);
    }
    r.model.components[cid.0].children = child_ids;

    // Step 2: process interfaces in this component's scope.
    let iface_ids =
        process_interfaces_in_scope(r, &lc.inner.interfaces, child_scope, level, &lc.label);

    // Step 3: resolve encapsulates for those interfaces.
    for (li, iid) in lc.inner.interfaces.iter().zip(iface_ids.iter()) {
        resolve_encapsulates(r, *iid, &li.inner.encapsulates, child_scope, &li.label);
    }

    r.model.components[cid.0].interfaces = iface_ids;

    cid
}

// ── Interface processing ──────────────────────────────────────────────────────

/// Process all interfaces declared in a single scope.
///
/// Precondition: all sibling components in `scope` must already be registered
/// in `r.scope_index.components`.
///
/// Returns the `InterfaceId`s in declaration order.
fn process_interfaces_in_scope(
    r: &mut Resolver,
    interfaces: &[Labeled<RawInterface>],
    scope: Scope,
    parent_level: i32,
    scope_name: &str,
) -> Vec<InterfaceId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut iface_ids: Vec<InterfaceId> = Vec::new();

    for li in interfaces {
        if !label_seen.insert(li.label.clone()) {
            r.push_error(
                "E001",
                format!(
                    "duplicate interface label '{}' in '{}'",
                    li.label, scope_name
                ),
            );
            continue;
        }

        let level = li.inner.level.unwrap_or(parent_level + 1);
        let leaf = li.inner.leaf.unwrap_or(false);

        // W007 — level decreasing relative to parent (checked in the validate pass)

        // E008 — invalid direction
        let direction = match li.inner.direction.as_deref() {
            None | Some("unidirectional") => Direction::Unidirectional,
            Some("bidirectional") => Direction::Bidirectional,
            Some(other) => {
                r.push_error(
                    "E008",
                    format!("interface '{}' has invalid direction '{}'", li.label, other),
                );
                Direction::Unidirectional // placeholder so we keep going
            }
        };

        // E002 — undefined `from`
        let from = resolve_component_ref(r, &li.inner.from, scope, &li.label, "from");

        // E002 — undefined `to`
        let to = resolve_component_ref(r, &li.inner.to, scope, &li.label, "to");

        // E006 — leaf interface with messages
        if leaf && !li.inner.messages.is_empty() {
            r.push_error(
                "E006",
                format!("leaf interface '{}' contains messages", li.label),
            );
        }

        // Process messages (only when not leaf; we skip them on E006 path too).
        let msg_ids = if !leaf {
            process_messages(r, &li.inner.messages, level, &li.label)
        } else {
            vec![]
        };

        // Allocate InterfaceId and register in scope so encapsulates can find it.
        let iid = InterfaceId(r.model.interfaces.len());
        r.scope_index
            .interfaces
            .insert((scope, li.label.clone()), iid);

        // Use ComponentId(usize::MAX) as a sentinel when a reference failed; the
        // error has already been recorded above, and the model is never returned
        // in the error case, so this sentinel is never visible to callers.
        let from_id = from.unwrap_or(ComponentId(usize::MAX));
        let to_id = to.unwrap_or(ComponentId(usize::MAX));

        r.model.interfaces.push(Interface {
            label: li.label.clone(),
            description: li.inner.description.clone().unwrap_or_default(),
            tags: li.inner.tags.clone(),
            level,
            leaf,
            direction,
            from: from_id,
            to: to_id,
            encapsulates: vec![], // filled by resolve_encapsulates
            messages: msg_ids,
        });

        iface_ids.push(iid);
    }

    iface_ids
}

/// Resolve a single component label reference (`from` or `to`) within a scope.
/// Returns `None` and emits E002 if the label is absent or not found.
fn resolve_component_ref(
    r: &mut Resolver,
    label: &Option<String>,
    scope: Scope,
    iface_label: &str,
    field: &str,
) -> Option<ComponentId> {
    match label {
        None => {
            r.push_error(
                "E002",
                format!(
                    "interface '{}' is missing required '{}' attribute",
                    iface_label, field
                ),
            );
            None
        }
        Some(lbl) => match r.scope_index.components.get(&(scope, lbl.clone())) {
            Some(cid) => Some(*cid),
            None => {
                r.push_error(
                    "E002",
                    format!(
                        "interface '{}' references undefined component '{}' in '{}'",
                        iface_label, lbl, field
                    ),
                );
                None
            }
        },
    }
}

/// Resolve `encapsulates` labels for an already-allocated interface.
/// Emits E003 for missing references and detects E004 circular chains.
fn resolve_encapsulates(
    r: &mut Resolver,
    iid: InterfaceId,
    encapsulates: &[String],
    scope: Scope,
    iface_label: &str,
) {
    if encapsulates.is_empty() {
        return;
    }
    let mut enc_ids: Vec<InterfaceId> = Vec::new();
    for label in encapsulates {
        match r.scope_index.interfaces.get(&(scope, label.clone())) {
            Some(enc_iid) => enc_ids.push(*enc_iid),
            None => {
                r.push_error(
                    "E003",
                    format!(
                        "interface '{}' encapsulates undefined interface '{}'",
                        iface_label, label
                    ),
                );
            }
        }
    }
    r.model.interfaces[iid.0].encapsulates = enc_ids;

    // E004 — detect circular encapsulation by DFS from this interface.
    if has_encapsulation_cycle(&r.model.interfaces, iid) {
        r.push_error(
            "E004",
            format!(
                "circular encapsulation chain detected involving interface '{}'",
                iface_label
            ),
        );
        // Clear the encapsulates list to break the cycle in the model.
        r.model.interfaces[iid.0].encapsulates.clear();
    }
}

/// DFS cycle detection in the encapsulates graph starting from `start`.
///
/// Uses a three-color (white/gray/black) marking scheme:
/// - Gray = currently in the DFS stack path
/// - Black = fully processed (not in any current path)
///
/// A cycle is detected only when we re-visit a *gray* node (i.e., a node
/// already on the current DFS path). Reaching a *black* node is fine — it
/// just means we have a shared reference (DAG, not a cycle).
fn has_encapsulation_cycle(interfaces: &[Interface], start: InterfaceId) -> bool {
    // Iterative DFS with explicit frame stack.
    // Each frame tracks (node, index into its encapsulates list).
    let mut gray: HashSet<usize> = HashSet::new(); // in current path
    let mut black: HashSet<usize> = HashSet::new(); // fully processed
    let mut stack: Vec<(usize, usize)> = vec![(start.0, 0)];

    while let Some((node, child_idx)) = stack.last_mut() {
        let node = *node;
        let children = &interfaces[node].encapsulates;

        if *child_idx == 0 {
            // First visit to this node: mark gray.
            if black.contains(&node) {
                // Already fully processed in another subtree — safe to skip.
                stack.pop();
                continue;
            }
            if gray.contains(&node) {
                // We've reached a node currently on the path — cycle!
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
            // All children processed — mark black, unmark gray.
            gray.remove(&node);
            black.insert(node);
            stack.pop();
        }
    }
    false
}

// ── Message / Field processing ────────────────────────────────────────────────

/// Process message blocks within an interface, returning their [`MessageId`]s.
fn process_messages(
    r: &mut Resolver,
    messages: &[Labeled<RawMessage>],
    parent_level: i32,
    iface_label: &str,
) -> Vec<MessageId> {
    let mut label_seen: HashSet<String> = HashSet::new();
    let mut msg_ids: Vec<MessageId> = Vec::new();

    for lm in messages {
        if !label_seen.insert(lm.label.clone()) {
            r.push_error(
                "E001",
                format!(
                    "duplicate message label '{}' in interface '{}'",
                    lm.label, iface_label
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

/// Process field blocks within a message, returning their [`FieldId`]s.
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
                "E001",
                format!(
                    "duplicate field label '{}' in message '{}'",
                    lf.label, msg_label
                ),
            );
            continue;
        }

        // E009 — missing required `type`
        let field_type = match &lf.inner.field_type {
            Some(t) => t.clone(),
            None => {
                r.push_error(
                    "E009",
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

/// Resolve a raw view block, emitting E007 for undefined system references.
fn resolve_view(r: &mut Resolver, lv: Labeled<crate::parse::RawView>) {
    // E007 — undefined system
    let system = match &lv.inner.system {
        None => {
            r.push_error(
                "E007",
                format!("view '{}' does not specify a system", lv.label),
            );
            return;
        }
        Some(sys_label) => match r.system_label_index.get(sys_label) {
            Some(sid) => *sid,
            None => {
                r.push_error(
                    "E007",
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
    use crate::parse::parse_dir;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("examples")
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

        // quadcopter has direct children: flight-controller, esc, gps, battery, radio-rx, vtx, camera
        let quad = &model.systems[quad_sid.0];
        assert!(
            quad.components.len() >= 7,
            "quadcopter should have ≥7 direct components"
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
            "flight-controller should have ≥3 children"
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

        // spi-imu interface is inside flight-controller scope: from=mcu, to=imu
        let spi_iid = fc
            .interfaces
            .iter()
            .copied()
            .find(|iid| model.interfaces[iid.0].label == "spi-imu")
            .expect("spi-imu interface");
        let spi = &model.interfaces[spi_iid.0];
        assert_eq!(spi.from, mcu_cid);
        assert_eq!(spi.to, imu_cid);
        assert_eq!(spi.direction, Direction::Bidirectional);

        // motor-control interface at system level: has message "throttle"
        let mc_iid = quad
            .interfaces
            .iter()
            .copied()
            .find(|iid| model.interfaces[iid.0].label == "motor-control")
            .expect("motor-control");
        let mc = &model.interfaces[mc_iid.0];
        assert_eq!(mc.messages.len(), 1);
        let throttle = &model.messages[mc.messages[0].0];
        assert_eq!(throttle.label, "throttle");
        assert_eq!(throttle.fields.len(), 2);

        // ground-control system exists
        let gc = &model.systems[gc_sid.0];
        assert!(gc.components.len() >= 3);

        // ground-station-pc: non-leaf, no children → W001; no description → W005
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

        // Warnings: W001 for ground-station-pc, W005 for ground-station-pc
        let w001_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == "W001")
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w001_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W001 for ground-station-pc, got: {:?}",
            w001_labels
        );

        let w005_labels: Vec<&str> = warnings
            .iter()
            .filter(|d| d.code == "W005")
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            w005_labels.iter().any(|m| m.contains("ground-station-pc")),
            "expected W005 for ground-station-pc, got: {:?}",
            w005_labels
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

        // recommendation-engine: non-leaf, no children → W001
        let rec_cid = backend
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "recommendation-engine")
            .expect("recommendation-engine");
        assert!(model.components[rec_cid.0].children.is_empty());

        // rec-to-feed interface: from=recommendation-engine, to=feed-service
        let feed_service_cid = backend
            .children
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "feed-service")
            .expect("feed-service");
        let rec_iface = backend
            .interfaces
            .iter()
            .copied()
            .find(|iid| model.interfaces[iid.0].label == "rec-to-feed")
            .expect("rec-to-feed");
        let rec_iface = &model.interfaces[rec_iface.0];
        assert_eq!(rec_iface.from, rec_cid);
        assert_eq!(rec_iface.to, feed_service_cid);

        // push-notify: non-leaf, no messages → W002
        let push_iid = bv
            .interfaces
            .iter()
            .copied()
            .find(|iid| model.interfaces[iid.0].label == "push-notify")
            .expect("push-notify");
        let push = &model.interfaces[push_iid.0];
        assert!(!push.leaf);
        assert!(push.messages.is_empty());

        // Warnings: W001 for recommendation-engine, W002 for push-notify
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("recommendation-engine")),
            "expected W001 for recommendation-engine"
        );
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W002" && d.message.contains("push-notify")),
            "expected W002 for push-notify"
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

        // operations: non-leaf, no children → W001; no description → W005
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

        // sprint-planning interface: from=product, to=engineering
        let product_cid = acme
            .components
            .iter()
            .copied()
            .find(|cid| model.components[cid.0].label == "product")
            .expect("product");
        let sp_iid = acme
            .interfaces
            .iter()
            .copied()
            .find(|iid| model.interfaces[iid.0].label == "sprint-planning")
            .expect("sprint-planning");
        let sp = &model.interfaces[sp_iid.0];
        assert_eq!(sp.from, product_cid);
        assert_eq!(sp.to, eng_cid);

        // Warnings: W001 + W005 for operations
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("operations")),
            "expected W001 for operations"
        );
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W005" && d.message.contains("operations")),
            "expected W005 for operations"
        );

        assert_eq!(model.views.len(), 3);
    }

    // ── Error cases ────────────────────────────────────────────────────────

    #[test]
    fn e002_undefined_from_to() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              interface "i" {
                from = "a"
                to   = "nonexistent"
                direction = "unidirectional"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err(), "expected Err for undefined component ref");
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == "E002"),
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
            diags.iter().any(|d| d.code == "E001"),
            "expected E001, got: {:?}",
            diags
        );
    }

    #[test]
    fn e007_undefined_system_in_view() {
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
            diags.iter().any(|d| d.code == "E007"),
            "expected E007, got: {:?}",
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
            diags.iter().any(|d| d.code == "E005"),
            "expected E005, got: {:?}",
            diags
        );
    }

    #[test]
    fn e008_invalid_direction() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              interface "i" {
                from      = "a"
                to        = "b"
                direction = "sideways"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let result = resolve(raw);
        assert!(result.is_err());
        let diags = result.unwrap_err();
        assert!(
            diags.iter().any(|d| d.code == "E008"),
            "expected E008, got: {:?}",
            diags
        );
    }

    #[test]
    fn defaults_applied() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              interface "i" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();

        // Default direction = Unidirectional
        assert_eq!(model.interfaces[0].direction, Direction::Unidirectional);
        // Default level: system=0, component=1, interface=1 (parent_level+1)
        assert_eq!(model.systems[0].level, 0);
        assert_eq!(model.components[0].level, 1);
        assert_eq!(model.interfaces[0].level, 1);
        // Default description = ""
        assert_eq!(model.systems[0].description, "");
        assert_eq!(model.components[0].description, "");
    }
}
