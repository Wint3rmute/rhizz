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
import type { ConnectionSide } from "./geometry";

/** One end of the connection being drawn, as the dialog needs to know it. */
export interface ConnectionEndInfo {
  /** Canonical component key (`main/drone/battery`), shown as a breadcrumb. */
  key: string;
  /** The component's own label (last path segment). */
  label: string;
  /** Instance path relative to the connection's scope (`battery`, `fc/mcu`). */
  component: string;
  /**
   * The component definition that owns the ports. Two ends on the same
   * definition share one port namespace.
   */
  definition: string;
  /** Labels of the ports the component already has. */
  portLabels: readonly string[];
  /**
   * Set when the drag started or ended on a port dot: the connection uses
   * that port instead of creating a new one.
   */
  existingPort?: string | undefined;
}

/** What the dialog is asked to create. */
export interface NewConnectionRequest {
  /** Scope that declares the connection (lowest common ancestor). */
  scopePath: string;
  from: ConnectionEndInfo;
  to: ConnectionEndInfo;
  /** Border side the edge leaves, when the drag began on a side handle. */
  startSide?: ConnectionSide | undefined;
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

  return { valid: Object.keys(problems).length === 0, problems };
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

/** The op that creates what the dialog describes. Assumes a valid draft. */
export function buildConnectOp(
  request: NewConnectionRequest,
  draft: ConnectionDraft,
  protocols: readonly ProtocolData[],
): ModelMutationOp {
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
