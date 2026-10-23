// Read-only projection for the "Delete connection" dialog.
//
// A port lives on a component *definition*, so deleting it affects every
// instance of that definition. The dialog therefore has to show which
// endpoint ports it would remove, and which ones have to stay because another
// connection still uses them. The Rust dispatcher has the final say; this
// projection only tells the user what to expect and marks the shared ports.
//
// Deliberately has zero dependency on Svelte, so it is unit-testable in plain
// Node (see deleteConnection.test.ts).
import type { ModelJS } from "rhizz";
import type { RawModelPayload } from "../../../../modelView";

/** One endpoint of the connection, as the dialog shows it. */
export interface DeleteConnectionEndpoint {
  /** Label of the endpoint component instance. */
  component: string;
  /** Port label, when the endpoint names one. */
  port?: string | undefined;
}

/** A port the cleanup would remove. */
export interface ConnectionPortCleanup {
  /** Definition that declares the port. */
  definition: string;
  /** Port label. */
  port: string;
  /** Label of the endpoint instance the connection ends on. */
  component: string;
}

/** A port the cleanup must leave alone, with the connections that still use it. */
export interface KeptConnectionPort extends ConnectionPortCleanup {
  /** Labels of the other connections that still use this port. */
  usedBy: string[];
}

/** Everything the dialog renders for one connection. */
export interface DeleteConnectionRequest {
  label: string;
  from: DeleteConnectionEndpoint;
  to: DeleteConnectionEndpoint;
  /** Endpoint ports no other connection uses; the checkbox removes these. */
  removablePorts: ConnectionPortCleanup[];
  /** Endpoint ports that stay because another connection uses them. */
  keptPorts: KeptConnectionPort[];
}

function portKey(port: ConnectionPortCleanup): string {
  return `${port.definition}\0${port.port}`;
}

/**
 * Builds the dialog's view of connection `label`, or `undefined` when the
 * model is unavailable or has no such connection.
 *
 * Resolved connections include one copy per instance of a definition, and
 * copies share both their label and `decl`. Copies of the deleted connection
 * disappear with it, so they never count as "another connection" using a port;
 * a same-label connection from a different declaration does.
 */
export function buildDeleteConnectionRequest(
  model: ModelJS | undefined,
  label: string,
): DeleteConnectionRequest | undefined {
  if (model === undefined) return undefined;
  const raw = model.to_js() as RawModelPayload;
  const components = raw.components ?? [];
  const ports = raw.ports ?? [];
  const connections = raw.connections ?? [];
  const target = connections.find((connection) => connection.label === label);
  if (target === undefined) return undefined;

  // The definition a port block lives in: an instance's `source`, or the
  // component itself when it is a definition.
  function definitionIndex(componentIndex: number): number | undefined {
    const source = components[componentIndex]?.source;
    if (source === undefined || source === "") return componentIndex;
    return (raw.definitions ?? []).find(
      (index) => components[index]?.label === source,
    );
  }

  function info(end: (typeof connections)[number]["from"]) {
    const component = components[end.component];
    const definition = definitionIndex(end.component);
    return {
      component: component?.label ?? "",
      port: end.port == null ? undefined : ports[end.port]?.label,
      definition:
        definition === undefined ? undefined : components[definition]?.label,
    };
  }

  const from = info(target.from);
  const to = info(target.to);

  const endpointPorts = new Map<string, ConnectionPortCleanup>();
  for (const end of [from, to]) {
    if (end.port === undefined || end.definition === undefined) continue;
    const port = {
      definition: end.definition,
      port: end.port,
      component: end.component,
    };
    endpointPorts.set(portKey(port), port);
  }

  const usedBy = new Map<string, string[]>();
  for (const other of connections) {
    const copy =
      other.label === target.label &&
      (target.decl === undefined || other.decl === target.decl);
    if (other === target || copy) continue;
    for (const end of [info(other.from), info(other.to)]) {
      if (end.port === undefined || end.definition === undefined) continue;
      const key = portKey({
        definition: end.definition,
        port: end.port,
        component: end.component,
      });
      if (!endpointPorts.has(key)) continue;
      const labels = usedBy.get(key) ?? [];
      if (!labels.includes(other.label)) labels.push(other.label);
      usedBy.set(key, labels);
    }
  }

  const removablePorts = [...endpointPorts]
    .filter(([key]) => !usedBy.has(key))
    .map(([, port]) => port);
  const keptPorts = [...endpointPorts]
    .filter(([key]) => usedBy.has(key))
    .map(([key, port]) => ({ ...port, usedBy: usedBy.get(key) ?? [] }));

  return {
    label,
    from: { component: from.component, port: from.port },
    to: { component: to.component, port: to.port },
    removablePorts,
    keptPorts,
  };
}
