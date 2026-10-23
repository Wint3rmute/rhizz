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
import { componentKeyAt } from "../../../../modelKeys";
import type { RawModelPayload } from "../../../../modelView";

/** One endpoint of the connection, as the dialog shows it. */
export interface DeleteConnectionEndpoint {
  /** Canonical component key (`main/fc`), for tests and disambiguation. */
  key: string;
  /** Label of the endpoint component instance. */
  component: string;
  /** Port label, when the endpoint names one. */
  port?: string | undefined;
  /** Top-level definition that declares the port (and every instance copy). */
  definition?: string | undefined;
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
  return JSON.stringify([port.definition, port.port]);
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
  const keys = model.component_keys();
  const components = raw.components ?? [];
  const ports = raw.ports ?? [];
  const connections = raw.connections ?? [];
  const targetIndex = connections.findIndex(
    (connection) => connection.label === label,
  );
  const target = connections[targetIndex];
  if (target === undefined) return undefined;

  // The definition a port block lives in: an instance's `source`, or the
  // component itself when it is a definition.
  function definitionIndex(componentIndex: number): number | undefined {
    const component = components[componentIndex];
    if (component === undefined) return undefined;
    const source = component.source;
    if (source === undefined || source === "") return componentIndex;
    return (raw.definitions ?? []).find(
      (index) => components[index]?.label === source,
    );
  }

  function endpoint(
    end: (typeof connections)[number]["from"],
  ): DeleteConnectionEndpoint {
    const component = components[end.component];
    const port = end.port == null ? undefined : ports[end.port]?.label;
    const definition = definitionIndex(end.component);
    return {
      key: componentKeyAt(keys, end.component),
      component: component?.label ?? componentKeyAt(keys, end.component),
      port,
      definition:
        definition === undefined ? undefined : components[definition]?.label,
    };
  }

  const from = endpoint(target.from);
  const to = endpoint(target.to);

  const endpointPorts: ConnectionPortCleanup[] = [];
  for (const end of [from, to]) {
    if (end.port === undefined || end.definition === undefined) continue;
    const cleanup = {
      definition: end.definition,
      port: end.port,
      component: end.component,
    };
    if (!endpointPorts.some((p) => portKey(p) === portKey(cleanup))) {
      endpointPorts.push(cleanup);
    }
  }

  const usedBy = new Map<string, string[]>();
  connections.forEach((other, index) => {
    if (index === targetIndex) return;
    const copy =
      other.label === target.label &&
      (target.decl === undefined || other.decl === target.decl);
    if (copy) return;
    for (const end of [other.from, other.to]) {
      const info = endpoint(end);
      if (info.port === undefined || info.definition === undefined) continue;
      const key = portKey({
        definition: info.definition,
        port: info.port,
        component: info.component,
      });
      if (!endpointPorts.some((p) => portKey(p) === key)) continue;
      const labels = usedBy.get(key) ?? [];
      if (!labels.includes(other.label)) labels.push(other.label);
      usedBy.set(key, labels);
    }
  });

  const removablePorts = endpointPorts.filter(
    (port) => !usedBy.has(portKey(port)),
  );
  const keptPorts = endpointPorts
    .filter((port) => usedBy.has(portKey(port)))
    .map((port) => ({ ...port, usedBy: usedBy.get(portKey(port)) ?? [] }));

  return { label, from, to, removablePorts, keptPorts };
}
