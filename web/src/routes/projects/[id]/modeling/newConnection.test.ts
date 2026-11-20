import { beforeEach, describe, expect, it } from "vitest";
import type { ProtocolData } from "../../../../modelView";
import {
  type ConnectionEndInfo,
  type NewConnectionRequest,
  buildConnectOp,
  connectionDirection,
  defaultConnectionLabel,
  defaultPortName,
  delegationOuterSide,
  initialDraft,
  isDelegationRequest,
  isExternalEnd,
  needsOuterConversion,
  orderProtocols,
  outerConversionSource,
  presetDelegationRoles,
  presetRoles,
  protocolUsage,
  recentProtocols,
  rememberProtocol,
  resetRecentProtocols,
  uniqueLabel,
  validateDraft,
} from "./newConnection";

function end(
  label: string,
  overrides: Partial<ConnectionEndInfo> = {},
): ConnectionEndInfo {
  return {
    key: `demo/${label}`,
    label,
    component: label,
    definition: label,
    portLabels: [],
    ...overrides,
  };
}

function request(
  overrides: Partial<NewConnectionRequest> = {},
): NewConnectionRequest {
  return {
    scopePath: "demo",
    from: end("a"),
    to: end("b"),
    ...overrides,
  };
}

function protocol(
  label: string,
  overrides: Partial<ProtocolData> = {},
): ProtocolData {
  return {
    label,
    full_name: "",
    tags: [],
    roles: [],
    leaf: false,
    encapsulates: [],
    messages: [],
    ...overrides,
  };
}

const NO_CONTEXT = { takenConnectionLabels: [], protocols: [] };

describe("uniqueLabel", () => {
  it("keeps a free label as is", () => {
    expect(uniqueLabel("link-b", [])).toBe("link-b");
  });

  it("appends the first free numeric suffix", () => {
    expect(uniqueLabel("link-b", ["link-b"])).toBe("link-b-2");
    expect(uniqueLabel("link-b", ["link-b", "link-b-2"])).toBe("link-b-3");
  });
});

describe("defaults", () => {
  it("names the connection a-to-b", () => {
    expect(defaultConnectionLabel(end("a"), end("b"), [])).toBe("a-to-b");
  });

  it("makes the connection name unique across the model", () => {
    expect(defaultConnectionLabel(end("a"), end("b"), ["a-to-b"])).toBe(
      "a-to-b-2",
    );
  });

  it("names a port link-<other>, never a direction", () => {
    expect(defaultPortName(end("b"), [])).toBe("link-b");
    expect(defaultPortName(end("b"), ["link-b"])).toBe("link-b-2");
  });

  it("names each port after the component on the other end", () => {
    const draft = initialDraft(request(), NO_CONTEXT);
    expect(draft.from.name).toBe("link-b");
    expect(draft.to.name).toBe("link-a");
  });

  it("avoids ports the component already has", () => {
    const draft = initialDraft(
      request({ from: end("a", { portLabels: ["link-b"] }) }),
      NO_CONTEXT,
    );
    expect(draft.from.name).toBe("link-b-2");
  });

  it("does not give both ends of one definition the same port name", () => {
    const draft = initialDraft(
      request({
        from: end("x", {
          key: "demo/p/mcu",
          component: "p/mcu",
          definition: "mcu",
        }),
        to: end("x", {
          key: "demo/q/mcu",
          component: "q/mcu",
          definition: "mcu",
        }),
      }),
      NO_CONTEXT,
    );
    expect(draft.from.name).toBe("link-x");
    expect(draft.to.name).toBe("link-x-2");
  });

  it("starts with no protocol and no role, and required ports", () => {
    const draft = initialDraft(request(), NO_CONTEXT);
    expect(draft.protocol).toBe("");
    expect(draft.from.role).toBe("");
    expect(draft.to.role).toBe("");
    expect(draft.from.required).toBe(true);
    expect(draft.to.required).toBe(true);
  });
});

describe("isExternalEnd", () => {
  it("is false for a direct child of the connection's scope", () => {
    expect(isExternalEnd("battery")).toBe(false);
  });

  it("is true when the connection leaves a nested component", () => {
    expect(isExternalEnd("fc/mcu")).toBe(true);
  });

  it("is true for the scope's own component", () => {
    expect(isExternalEnd("")).toBe(true);
  });

  it("is derived per end in the initial draft", () => {
    const draft = initialDraft(
      request({ from: end("mcu", { component: "fc/mcu" }) }),
      NO_CONTEXT,
    );
    expect(draft.from.external).toBe(true);
    expect(draft.to.external).toBe(false);
  });
});

describe("presetRoles", () => {
  it("is unset for no protocol and for a protocol without roles", () => {
    expect(presetRoles(undefined)).toEqual({ from: "", to: "" });
    expect(presetRoles(protocol("spi"))).toEqual({ from: "", to: "" });
  });

  it("gives the source the first role and the target the second", () => {
    expect(
      presetRoles(protocol("spi", { roles: ["provider", "consumer"] })),
    ).toEqual({ from: "provider", to: "consumer" });
  });

  it("repeats a single role on both ends", () => {
    expect(presetRoles(protocol("bus", { roles: ["peer"] }))).toEqual({
      from: "peer",
      to: "peer",
    });
  });
});

describe("validateDraft", () => {
  it("accepts the initial draft", () => {
    const req = request();
    const result = validateDraft(
      req,
      initialDraft(req, NO_CONTEXT),
      NO_CONTEXT,
    );
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual({});
  });

  it("requires a connection name without a slash that is not taken", () => {
    const req = request();
    const draft = initialDraft(req, NO_CONTEXT);
    expect(
      validateDraft(req, { ...draft, label: "  " }, NO_CONTEXT).problems.label,
    ).toBeDefined();
    expect(
      validateDraft(req, { ...draft, label: "a/b" }, NO_CONTEXT).problems.label,
    ).toBeDefined();
    const taken = { ...NO_CONTEXT, takenConnectionLabels: ["a-to-b"] };
    const result = validateDraft(req, { ...draft, label: "a-to-b" }, taken);
    expect(result.problems.label).toContain("already exists");
    expect(result.valid).toBe(false);
  });

  it("refuses an empty, slashed or clashing port name", () => {
    const req = request({ from: end("a", { portLabels: ["used"] }) });
    const draft = initialDraft(req, NO_CONTEXT);
    const problems = (name: string) =>
      validateDraft(
        req,
        { ...draft, from: { ...draft.from, name } },
        NO_CONTEXT,
      ).problems.fromName;
    expect(problems("")).toBeDefined();
    expect(problems("x/y")).toBeDefined();
    expect(problems("used")).toContain("already");
    expect(problems("free")).toBeUndefined();
  });

  it("refuses two new ports with the same name on one definition", () => {
    const req = request({
      from: end("m1", { definition: "motor" }),
      to: end("m2", { definition: "motor" }),
    });
    const draft = initialDraft(req, NO_CONTEXT);
    const result = validateDraft(
      req,
      {
        ...draft,
        from: { ...draft.from, name: "link" },
        to: { ...draft.to, name: "link" },
      },
      NO_CONTEXT,
    );
    expect(result.problems.toName).toBeDefined();
  });

  it("does not check the name of an end that uses an existing port", () => {
    const req = request({ from: end("a", { existingPort: "out" }) });
    const draft = initialDraft(req, NO_CONTEXT);
    const result = validateDraft(
      req,
      { ...draft, from: { ...draft.from, name: "" } },
      NO_CONTEXT,
    );
    expect(result.problems.fromName).toBeUndefined();
  });

  it("requires a permitted role when the protocol defines roles", () => {
    const spi = protocol("spi", { roles: ["provider", "consumer"] });
    const context = { ...NO_CONTEXT, protocols: [spi] };
    const req = request();
    const draft = { ...initialDraft(req, context), protocol: "spi" };
    expect(
      validateDraft(
        req,
        { ...draft, from: { ...draft.from, role: "" } },
        context,
      ).problems.fromRole,
    ).toBeDefined();
    expect(
      validateDraft(
        req,
        { ...draft, from: { ...draft.from, role: "sideways" } },
        context,
      ).problems.fromRole,
    ).toBeDefined();
    const ok = validateDraft(
      req,
      {
        ...draft,
        from: { ...draft.from, role: "provider" },
        to: { ...draft.to, role: "consumer" },
      },
      context,
    );
    expect(ok.valid).toBe(true);
  });

  it("allows any role text when there is no protocol", () => {
    const req = request();
    const draft = initialDraft(req, NO_CONTEXT);
    const result = validateDraft(
      req,
      { ...draft, from: { ...draft.from, role: "whatever" } },
      NO_CONTEXT,
    );
    expect(result.valid).toBe(true);
  });

  it("refuses a protocol name with a slash", () => {
    const req = request();
    const draft = { ...initialDraft(req, NO_CONTEXT), protocol: "a/b" };
    expect(
      validateDraft(req, draft, NO_CONTEXT).problems.protocol,
    ).toBeDefined();
  });
});

describe("buildConnectOp", () => {
  it("builds the default gesture: two untyped new ports", () => {
    const req = request();
    const op = buildConnectOp(req, initialDraft(req, NO_CONTEXT), []);
    expect(op).toEqual({
      kind: "connect_components",
      scopePath: "demo",
      label: "a-to-b",
      from: {
        component: "a",
        port: {
          new: { label: "link-b", external: false, required: true },
        },
      },
      to: {
        component: "b",
        port: {
          new: { label: "link-a", external: false, required: true },
        },
      },
    });
  });

  it("sends the chosen protocol and roles to both new ports", () => {
    const spi = protocol("spi", { roles: ["provider", "consumer"] });
    const req = request();
    const base = initialDraft(req, { ...NO_CONTEXT, protocols: [spi] });
    const op = buildConnectOp(
      req,
      {
        ...base,
        protocol: "spi",
        from: { ...base.from, role: "provider" },
        to: { ...base.to, role: "consumer" },
      },
      [spi],
    );
    expect(op).toMatchObject({
      from: { port: { new: { protocol: "spi", role: "provider" } } },
      to: { port: { new: { protocol: "spi", role: "consumer" } } },
    });
    expect(op).not.toHaveProperty("createProtocol");
  });

  it("asks for a stub protocol only when the name is not defined yet", () => {
    const req = request();
    const draft = { ...initialDraft(req, NO_CONTEXT), protocol: "spi" };
    expect(buildConnectOp(req, draft, [])).toMatchObject({
      createProtocol: "spi",
    });
    expect(buildConnectOp(req, draft, [protocol("spi")])).not.toHaveProperty(
      "createProtocol",
    );
  });

  it("uses an existing port as is", () => {
    const req = request({ from: end("a", { existingPort: "out" }) });
    const op = buildConnectOp(req, initialDraft(req, NO_CONTEXT), []);
    expect(op).toMatchObject({ from: { port: { existing: "out" } } });
  });

  it("trims the names", () => {
    const req = request();
    const base = initialDraft(req, NO_CONTEXT);
    const op = buildConnectOp(
      req,
      { ...base, label: "  link  ", from: { ...base.from, name: " p " } },
      [],
    );
    expect(op).toMatchObject({
      label: "link",
      from: { port: { new: { label: "p" } } },
    });
  });
});

describe("protocol ordering", () => {
  beforeEach(() => {
    resetRecentProtocols();
  });

  const protocols = [
    protocol("a"),
    protocol("b"),
    protocol("c"),
    protocol("d"),
  ];

  it("lists protocols alphabetically when nothing else is known", () => {
    expect(orderProtocols(protocols, new Map()).map((p) => p.label)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("puts protocols used by ports first, most used first", () => {
    const usage = new Map([
      ["c", 1],
      ["d", 3],
    ]);
    expect(orderProtocols(protocols, usage).map((p) => p.label)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
  });

  it("puts recently picked protocols before the used ones", () => {
    rememberProtocol("b");
    rememberProtocol("a");
    const usage = new Map([["d", 3]]);
    expect(orderProtocols(protocols, usage).map((p) => p.label)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("remembers each protocol once, newest first, and ignores blanks", () => {
    rememberProtocol("a");
    rememberProtocol("b");
    rememberProtocol("a");
    rememberProtocol("");
    expect(recentProtocols()).toEqual(["a", "b"]);
  });

  it("skips remembered protocols that no longer exist", () => {
    rememberProtocol("gone");
    expect(orderProtocols(protocols, new Map()).map((p) => p.label)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("connectionDirection", () => {
  it("points from the provider to the consumer", () => {
    expect(connectionDirection("provider", "consumer")).toBe("forward");
    expect(connectionDirection("consumer", "provider")).toBe("backward");
  });

  it("is bidirectional between peers", () => {
    expect(connectionDirection("peer", "peer")).toBe("both");
  });

  it("is unknown when a role is missing or the pair is ambiguous", () => {
    expect(connectionDirection("", "consumer")).toBe("none");
    expect(connectionDirection("provider", "provider")).toBe("none");
    expect(connectionDirection("peer", "provider")).toBe("none");
    expect(connectionDirection("master", "slave")).toBe("none");
  });
});

describe("protocolUsage", () => {
  it("counts the ports that name each protocol", () => {
    const usage = protocolUsage([
      { ports: [{ protocol: "spi" }, { protocol: "" }, { protocol: "i2c" }] },
      { ports: [{ protocol: "spi" }, {}] },
    ]);
    expect(usage.get("spi")).toBe(2);
    expect(usage.get("i2c")).toBe(1);
    expect(usage.has("")).toBe(false);
  });
});

describe("delegation", () => {
  const delegationRequest = (
    overrides: {
      from?: Partial<ReturnType<typeof end>>;
      to?: Partial<ReturnType<typeof end>>;
    } = {},
  ) =>
    request({
      scopePath: "demo/svc",
      from: end("svc", { component: "", ...overrides.from }),
      to: end("proxy", { component: "proxy", ...overrides.to }),
    });

  describe("delegationOuterSide", () => {
    it("names the empty-component end as the outer", () => {
      expect(delegationOuterSide(delegationRequest())).toBe("from");
      expect(
        delegationOuterSide(
          request({
            from: end("proxy", { component: "proxy" }),
            to: end("svc", { component: "" }),
          }),
        ),
      ).toBe("to");
    });

    it("is null without exactly one empty end", () => {
      expect(delegationOuterSide(request())).toBeNull();
      expect(
        delegationOuterSide(
          request({
            from: end("a", { component: "" }),
            to: end("b", { component: "" }),
          }),
        ),
      ).toBeNull();
    });
  });

  describe("isDelegationRequest", () => {
    it("is true only for the delegation shape", () => {
      expect(isDelegationRequest(delegationRequest())).toBe(true);
      expect(isDelegationRequest(request())).toBe(false);
    });
  });

  describe("presetDelegationRoles", () => {
    it("gives the inner port the first role and leaves the outer blank", () => {
      expect(
        presetDelegationRoles(
          protocol("spi", { roles: ["provider", "consumer"] }),
        ),
      ).toEqual({ inner: "provider" });
      expect(presetDelegationRoles(protocol("bare"))).toEqual({ inner: "" });
      expect(presetDelegationRoles(undefined)).toEqual({ inner: "" });
    });
  });

  describe("validateDraft delegation", () => {
    it("refuses two empty ends", () => {
      const req = request({
        from: end("a", { component: "" }),
        to: end("b", { component: "" }),
      });
      const { valid, problems } = validateDraft(
        req,
        initialDraft(req, NO_CONTEXT),
        NO_CONTEXT,
      );
      expect(valid).toBe(false);
      expect(problems.form).toMatch(/child component/);
    });

    it("converts an explicitly typed existing outer port instead of refusing", () => {
      const req = delegationRequest({
        from: {
          existingPort: "api",
          existingPortExplicit: true,
          existingPortExternal: true,
          existingPortProtocol: "https",
          existingPortRole: "provider",
        },
      });
      const { valid, problems } = validateDraft(
        req,
        initialDraft(req, NO_CONTEXT),
        NO_CONTEXT,
      );
      expect(valid).toBe(true);
      expect(problems.form).toBeUndefined();
      expect(needsOuterConversion(req)).toBe(true);
      expect(outerConversionSource(req)).toEqual({
        protocol: "https",
        role: "provider",
      });
    });

    it("refuses an internal existing outer port", () => {
      const req = delegationRequest({
        from: {
          existingPort: "api",
          existingPortExplicit: false,
          existingPortExternal: false,
        },
      });
      const { valid, problems } = validateDraft(
        req,
        initialDraft(req, NO_CONTEXT),
        NO_CONTEXT,
      );
      expect(valid).toBe(false);
      expect(problems.form).toMatch(/must be external/);
    });

    it("refuses a new outer port without external", () => {
      const req = delegationRequest();
      const draft = initialDraft(req, NO_CONTEXT);
      const { valid, problems } = validateDraft(
        req,
        { ...draft, from: { ...draft.from, external: false } },
        NO_CONTEXT,
      );
      expect(valid).toBe(false);
      expect(problems.form).toMatch(/must stay external/);
    });

    it("accepts an omitted existing outer port and a new outer port", () => {
      const existing = delegationRequest({
        from: {
          existingPort: "api",
          existingPortExplicit: false,
          existingPortExternal: true,
        },
      });
      expect(
        validateDraft(existing, initialDraft(existing, NO_CONTEXT), NO_CONTEXT)
          .valid,
      ).toBe(true);
      const fresh = delegationRequest();
      expect(
        validateDraft(fresh, initialDraft(fresh, NO_CONTEXT), NO_CONTEXT).valid,
      ).toBe(true);
    });
  });

  describe("buildConnectOp delegation", () => {
    it("creates a typeless outer port and types only the inner one", () => {
      const spi = protocol("spi", { roles: ["provider", "consumer"] });
      const req = delegationRequest();
      const base = initialDraft(req, { ...NO_CONTEXT, protocols: [spi] });
      const op = buildConnectOp(
        req,
        { ...base, protocol: "spi", to: { ...base.to, role: "provider" } },
        [spi],
      );
      expect(op).toMatchObject({
        kind: "connect_components",
        scopePath: "demo/svc",
        from: {
          component: "",
          port: { new: { label: "link-proxy", external: true } },
        },
        to: {
          component: "proxy",
          port: { new: { protocol: "spi", role: "provider" } },
        },
      });
      expect(op).not.toHaveProperty("createProtocol");
      const created = op as { from: { port: { new?: object } } };
      expect(created.from.port.new).not.toHaveProperty("protocol");
      expect(created.from.port.new).not.toHaveProperty("role");
    });

    it("uses an existing outer port as is and never creates its protocol", () => {
      const req = delegationRequest({
        from: {
          existingPort: "api",
          existingPortExplicit: false,
          existingPortExternal: true,
        },
      });
      const op = buildConnectOp(req, initialDraft(req, NO_CONTEXT), []);
      expect(op).toMatchObject({
        from: { component: "", port: { existing: "api" } },
      });
      expect(op).not.toHaveProperty("createProtocol");
    });

    it("does not create a protocol for an existing inner port", () => {
      const req = delegationRequest({
        to: { existingPort: "http" },
      });
      const base = initialDraft(req, NO_CONTEXT);
      const op = buildConnectOp(req, { ...base, protocol: "fresh" }, []);
      expect(op).toMatchObject({
        to: { component: "proxy", port: { existing: "http" } },
      });
      expect(op).not.toHaveProperty("createProtocol");
    });

    it("moves an explicit outer type to a new inner port", () => {
      const req = delegationRequest({
        from: {
          existingPort: "https",
          existingPortExplicit: true,
          existingPortExternal: true,
          existingPortProtocol: "https",
        },
      });
      const base = initialDraft(req, NO_CONTEXT);
      const op = buildConnectOp(req, base, []);
      expect(op).toMatchObject({
        kind: "connect_components",
        from: { component: "", port: { existing: "https" } },
        to: {
          component: "proxy",
          port: { new: { protocol: "https" } },
        },
        convertOuterToProxy: true,
      });
    });
  });
});
