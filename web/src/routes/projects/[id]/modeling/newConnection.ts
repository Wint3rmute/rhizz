// Decision logic of the "New connection" dialog, kept free of Svelte so it can
// be unit-tested in plain Node.
//
// Dragging an arrow between two components opens the dialog, which creates the
// connection *and* one port on each end in a single `connect_components` op.
// This module owns what the dialog prefills, what it refuses and the op it
// finally sends. Everything model-shaped is decided in rhizz-core; the checks
// here only exist to explain a refusal before the user presses Create.
import type { ConnectEnd } from "../../../../actionLog";
import type { ModelMutationOp } from "../../../../history/applyMutation";
import type { ProtocolData } from "../../../../modelView";

/** One end of the connection being drawn, as the dialog needs to know it. */
export interface ConnectionEndInfo {
  /** Canonical component key (`main/drone/battery`), shown as a breadcrumb. */
  key: string;
  /** The component's own label (last path segment). */
  label: string;
  /**
   * Instance path relative to the connection's scope (`battery`, `fc/mcu`).
   * Empty for the scope's own component — the delegation outer end.
   */
  component: string;
  /**
   * The definition that owns the ports. Two ends on the same definition
   * share one port namespace.
   */
  definition: string;
  /** Labels of the ports the component already has. */
  portLabels: readonly string[];
  /**
   * Set when the drag started or ended on a port dot: the connection uses
   * that port instead of creating a new one.
   */
  existingPort?: string | undefined;
  /** Declared protocol of `existingPort`, if any (for delegation checks). */
  existingPortProtocol?: string | undefined;
  /** Declared role of `existingPort`, if any (for delegation checks). */
  existingPortRole?: string | undefined;
  /** Whether `existingPort` is an external boundary port. */
  existingPortExternal?: boolean | undefined;
  /** Whether `existingPort` declares `protocol` or `role` in HCL. */
  existingPortExplicit?: boolean | undefined;
}

/** What the dialog is asked to create. */
export interface NewConnectionRequest {
  /** Scope that declares the connection (lowest common ancestor). */
  scopePath: string;
  from: ConnectionEndInfo;
  to: ConnectionEndInfo;
}

/** The editable attributes of one new port. */
export interface PortDraft {
  name: string;
  role: string;
  external: boolean;
  required: boolean;
}

/** Everything the user can edit in the dialog. */
export interface ConnectionDraft {
  /** Connection name. */
  label: string;
  /**
   * Protocol label, or empty for none. A label that no protocol has yet means
   * "create this protocol".
   */
  protocol: string;
  from: PortDraft;
  to: PortDraft;
}

/** What validation needs to know about the rest of the model. */
export interface DraftContext {
  /** Every connection label in the model (views key connections by name). */
  takenConnectionLabels: readonly string[];
  protocols: readonly ProtocolData[];
}

/** Why a field cannot be submitted, by field. Absent means fine. */
export interface DraftProblems {
  label?: string;
  protocol?: string;
  fromName?: string;
  toName?: string;
  fromRole?: string;
  toRole?: string;
  /** Form-wide blocker (e.g. a delegation that cannot be built). */
  form?: string;
}

export interface DraftValidation {
  valid: boolean;
  problems: DraftProblems;
}

/** `base`, or `base-2`, `base-3`, … — the first one not in `taken`. */
export function uniqueLabel(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n)}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function defaultConnectionLabel(
  from: ConnectionEndInfo,
  to: ConnectionEndInfo,
  taken: readonly string[],
): string {
  return uniqueLabel(`${from.label}-to-${to.label}`, taken);
}

/**
 * Neutral on purpose: a connection has no direction of its own (roles carry
 * it), so `link-<other>` never claims one the way `to-<other>` would.
 */
export function defaultPortName(
  other: ConnectionEndInfo,
  taken: readonly string[],
): string {
  return uniqueLabel(`link-${other.label}`, taken);
}

/**
 * Whether a port at `component` is a boundary port. A direct child of the
 * connection's scope wires a sibling (`false`); a nested component, or the
 * scope's own component, wires across a component boundary (`true`).
 */
export function isExternalEnd(component: string): boolean {
  return component.split("/").filter(Boolean).length !== 1;
}

/** Which end (if any) is the scope's own component: the delegation outer. */
export type DelegationSide = "from" | "to" | null;

/**
 * A delegation drag names the scope itself on exactly one end (empty
 * component path): the boundary dot forwards inward to the other end.
 */
export function delegationOuterSide(
  request: NewConnectionRequest,
): DelegationSide {
  const fromEmpty = request.from.component === "";
  const toEmpty = request.to.component === "";
  if (fromEmpty && !toEmpty) return "from";
  if (toEmpty && !fromEmpty) return "to";
  return null;
}

/** True when the dialog must offer the delegation variant. */
export function isDelegationRequest(request: NewConnectionRequest): boolean {
  return delegationOuterSide(request) !== null;
}

/**
 * Roles for a delegation draft: the outer port always inherits (stays blank)
 * while the inner port takes the protocol's first role, if any.
 */
export function presetDelegationRoles(protocol: ProtocolData | undefined): {
  inner: string;
} {
  const [first] = protocol?.roles ?? [];
  return { inner: first ?? "" };
}

/**
 * Roles to preselect once a protocol that defines roles is chosen: the
 * source takes the first role and the target the second (or the first again
 * when there is only one). Unset when the protocol allows any role.
 */
export function presetRoles(protocol: ProtocolData | undefined): {
  from: string;
  to: string;
} {
  const [first, second] = protocol?.roles ?? [];
  if (first === undefined) return { from: "", to: "" };
  return { from: first, to: second ?? first };
}

export function initialDraft(
  request: NewConnectionRequest,
  context: DraftContext,
): ConnectionDraft {
  const fromName = defaultPortName(request.to, request.from.portLabels);
  const sameDefinition = request.from.definition === request.to.definition;
  const toTaken = sameDefinition
    ? [...request.to.portLabels, fromName]
    : request.to.portLabels;
  return {
    label: defaultConnectionLabel(
      request.from,
      request.to,
      context.takenConnectionLabels,
    ),
    protocol: "",
    from: {
      name: fromName,
      role: "",
      external: isExternalEnd(request.from.component),
      required: true,
    },
    to: {
      name: defaultPortName(request.from, toTaken),
      role: "",
      external: isExternalEnd(request.to.component),
      required: true,
    },
  };
}

function nameProblem(
  name: string,
  taken: readonly string[],
  what: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return `Give the ${what} a name.`;
  if (trimmed.includes("/")) return `A ${what} name cannot contain “/”.`;
  if (taken.includes(trimmed))
    return `A port named “${trimmed}” already exists.`;
  return undefined;
}

function roleProblem(
  role: string,
  protocol: ProtocolData | undefined,
): string | undefined {
  if (protocol === undefined || protocol.roles.length === 0) return undefined;
  if (protocol.roles.includes(role)) return undefined;
  return `Pick one of: ${protocol.roles.join(", ")}.`;
}

export function validateDraft(
  request: NewConnectionRequest,
  draft: ConnectionDraft,
  context: DraftContext,
): DraftValidation {
  const problems: DraftProblems = {};
  const label = draft.label.trim();

  if (label === "") problems.label = "Give the connection a name.";
  else if (label.includes("/")) {
    problems.label = "A connection name cannot contain “/”.";
  } else if (context.takenConnectionLabels.includes(label)) {
    problems.label = `A connection named “${label}” already exists.`;
  }

  const protocolLabel = draft.protocol.trim();
  if (protocolLabel.includes("/")) {
    problems.protocol = "A protocol name cannot contain “/”.";
  }
  const protocol = context.protocols.find((p) => p.label === protocolLabel);

  if (request.from.existingPort === undefined) {
    const problem = nameProblem(
      draft.from.name,
      request.from.portLabels,
      "port",
    );
    if (problem !== undefined) problems.fromName = problem;
    const role = roleProblem(draft.from.role, protocol);
    if (role !== undefined) problems.fromRole = role;
  }
  if (request.to.existingPort === undefined) {
    // Two new ports on one definition share a namespace, so the target also
    // must not repeat the name the source is about to take.
    const sameDefinition =
      request.from.existingPort === undefined &&
      request.from.definition === request.to.definition;
    const taken = sameDefinition
      ? [...request.to.portLabels, draft.from.name.trim()]
      : request.to.portLabels;
    const problem = nameProblem(draft.to.name, taken, "port");
    if (problem !== undefined) problems.toName = problem;
    const role = roleProblem(draft.to.role, protocol);
    if (role !== undefined) problems.toRole = role;
  }

  const delegation = delegationOuterSide(request);
  if (request.from.component === "" && request.to.component === "") {
    problems.form =
      "A delegation needs a child component to forward to — pick two different components.";
  } else if (delegation !== null) {
    const outer = delegation === "from" ? request.from : request.to;
    const outerDraft = delegation === "from" ? draft.from : draft.to;
    if (outer.existingPort !== undefined) {
      // An existing outer never blocks: the op converts it into a proxy in
      // the same atomic step (moves its type inward, sets `external`).
      // See `needsOuterConversion` / `convertOuterToProxy`.
    } else if (!outerDraft.external) {
      problems.form = "The boundary port must stay external to delegate.";
    }
  }

  return { valid: Object.keys(problems).length === 0, problems };
}

/** Whether creating this delegation must convert an existing outer into a
 *  proxy (the `convertOuterToProxy` op flag): a declared type moves inward,
 *  and a missing `external` is set — all in the same atomic step. */
export function needsOuterConversion(request: NewConnectionRequest): boolean {
  const outerSide = delegationOuterSide(request);
  if (outerSide === null) return false;
  const outer = request[outerSide];
  return (
    outer.existingPort !== undefined &&
    (outer.existingPortExplicit === true ||
      outer.existingPortExternal === false)
  );
}

/** Whether the conversion will set `external = true` on the outer port. */
export function outerConversionSetsExternal(
  request: NewConnectionRequest,
): string | null {
  const outerSide = delegationOuterSide(request);
  if (outerSide === null) return null;
  const outer = request[outerSide];
  if (outer.existingPort !== undefined && outer.existingPortExternal === false)
    return outer.existingPort;
  return null;
}

/** The type the conversion moves inward (outer's declared protocol/role). */
export function outerConversionSource(request: NewConnectionRequest): {
  protocol: string;
  role: string;
} | null {
  const outerSide = delegationOuterSide(request);
  if (outerSide === null) return null;
  const outer = request[outerSide];
  if (outer.existingPort === undefined || outer.existingPortExplicit !== true)
    return null;
  return {
    protocol: outer.existingPortProtocol ?? "",
    role: outer.existingPortRole ?? "",
  };
}

function connectEnd(
  info: ConnectionEndInfo,
  port: PortDraft,
  protocol: string,
): ConnectEnd {
  if (info.existingPort !== undefined) {
    return { component: info.component, port: { existing: info.existingPort } };
  }
  return {
    component: info.component,
    port: {
      new: {
        label: port.name.trim(),
        ...(protocol === "" ? {} : { protocol }),
        ...(port.role.trim() === "" ? {} : { role: port.role.trim() }),
        external: port.external,
        required: port.required,
      },
    },
  };
}

/**
 * The op for a delegation drag: the outer end omits `protocol`/`role` so the
 * type is inherited, while the inner end is built exactly like an assembly
 * end. `createProtocol` fires only for a new inner port. When the outer is
 * an existing typed port, `convertOuterToProxy` moves its type inward in the
 * same atomic op (the dialog pre-fills the inner with it).
 */
function buildDelegationOp(
  request: NewConnectionRequest,
  draft: ConnectionDraft,
  protocols: readonly ProtocolData[],
  outerSide: "from" | "to",
): ModelMutationOp {
  const innerSide = outerSide === "from" ? "to" : "from";
  const innerInfo = request[innerSide];
  const innerDraft = draft[innerSide];
  const outerInfo = request[outerSide];
  const converts =
    outerInfo.existingPort !== undefined &&
    (outerInfo.existingPortExplicit === true ||
      outerInfo.existingPortExternal === false);
  // Conversion: a new inner left empty inherits the outer's old type.
  // Prefill here so the op is explicit even if the dialog left it blank;
  // Rust fills any remaining gap the same way.
  let protocol = draft.protocol.trim();
  let innerRole = innerDraft.role;
  if (converts && innerInfo.existingPort === undefined) {
    if (protocol === "" && outerInfo.existingPortProtocol) {
      protocol = outerInfo.existingPortProtocol;
    }
    if (
      innerRole.trim() === "" &&
      outerInfo.existingPortRole !== undefined &&
      outerInfo.existingPortRole !== ""
    ) {
      innerRole = outerInfo.existingPortRole;
    }
  }
  const innerIsNew = innerInfo.existingPort === undefined;
  const creates =
    innerIsNew &&
    protocol !== "" &&
    !protocols.some((p) => p.label === protocol);
  const outerPort: ConnectEnd["port"] =
    outerSide === "from"
      ? request.from.existingPort !== undefined
        ? { existing: request.from.existingPort }
        : {
            new: {
              label: draft.from.name.trim(),
              external: true,
              required: draft.from.required,
            },
          }
      : request.to.existingPort !== undefined
        ? { existing: request.to.existingPort }
        : {
            new: {
              label: draft.to.name.trim(),
              external: true,
              required: draft.to.required,
            },
          };
  const innerWithRole: PortDraft = { ...innerDraft, role: innerRole };
  return {
    kind: "connect_components",
    scopePath: request.scopePath,
    label: draft.label.trim(),
    from:
      outerSide === "from"
        ? { component: request.from.component, port: outerPort }
        : connectEnd(innerInfo, innerWithRole, innerIsNew ? protocol : ""),
    to:
      outerSide === "to"
        ? { component: request.to.component, port: outerPort }
        : connectEnd(innerInfo, innerWithRole, innerIsNew ? protocol : ""),
    ...(creates ? { createProtocol: protocol } : {}),
    ...(converts ? { convertOuterToProxy: true } : {}),
  };
}

/** The op that creates what the dialog describes. Assumes a valid draft. */
export function buildConnectOp(
  request: NewConnectionRequest,
  draft: ConnectionDraft,
  protocols: readonly ProtocolData[],
): ModelMutationOp {
  const outerSide = delegationOuterSide(request);
  if (outerSide !== null) {
    return buildDelegationOp(request, draft, protocols, outerSide);
  }
  const protocol = draft.protocol.trim();
  const creates =
    protocol !== "" && !protocols.some((p) => p.label === protocol);
  return {
    kind: "connect_components",
    scopePath: request.scopePath,
    label: draft.label.trim(),
    from: connectEnd(request.from, draft.from, protocol),
    to: connectEnd(request.to, draft.to, protocol),
    ...(creates ? { createProtocol: protocol } : {}),
  };
}

/**
 * Which way data flows, from the two port roles (SPEC §6). Anything the table
 * does not name — a missing role, two providers, custom role names — is
 * `none`: direction unknown or ambiguous.
 */
export function connectionDirection(
  fromRole: string,
  toRole: string,
): "forward" | "backward" | "both" | "none" {
  if (fromRole === "provider" && toRole === "consumer") return "forward";
  if (fromRole === "consumer" && toRole === "provider") return "backward";
  if (fromRole === "peer" && toRole === "peer") return "both";
  return "none";
}

// ── Protocol picker ──────────────────────────────────────────────────────────

const MAX_RECENT = 8;
let recent: string[] = [];

/** Notes that the user picked `label`, so it floats to the top next time. */
export function rememberProtocol(label: string): void {
  const trimmed = label.trim();
  if (trimmed === "") return;
  recent = [trimmed, ...recent.filter((l) => l !== trimmed)].slice(
    0,
    MAX_RECENT,
  );
}

/** Protocols picked this session, newest first. */
export function recentProtocols(): readonly string[] {
  return recent;
}

export function resetRecentProtocols(): void {
  recent = [];
}

/** How many ports name each protocol. */
export function protocolUsage(
  components: readonly {
    ports: readonly { protocol?: string | undefined }[];
  }[],
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const component of components) {
    for (const port of component.ports) {
      if (port.protocol === undefined || port.protocol === "") continue;
      usage.set(port.protocol, (usage.get(port.protocol) ?? 0) + 1);
    }
  }
  return usage;
}

/**
 * The picker's order: protocols picked recently, then the ones ports already
 * use (most used first), then the rest, alphabetically within each group.
 */
export function orderProtocols(
  protocols: readonly ProtocolData[],
  usage: ReadonlyMap<string, number>,
): ProtocolData[] {
  const byLabel = (a: ProtocolData, b: ProtocolData) =>
    a.label.localeCompare(b.label);
  const known = new Set(protocols.map((p) => p.label));
  const recentLabels = recent.filter((label) => known.has(label));
  const picked = new Set(recentLabels);

  const head = recentLabels.flatMap((label) => {
    const found = protocols.find((p) => p.label === label);
    return found === undefined ? [] : [found];
  });
  const rest = protocols.filter((p) => !picked.has(p.label));
  const used = rest
    .filter((p) => (usage.get(p.label) ?? 0) > 0)
    .sort(
      (a, b) =>
        (usage.get(b.label) ?? 0) - (usage.get(a.label) ?? 0) || byLabel(a, b),
    );
  const unused = rest
    .filter((p) => (usage.get(p.label) ?? 0) === 0)
    .sort(byLabel);
  return [...head, ...used, ...unused];
}
