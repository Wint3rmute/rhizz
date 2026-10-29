# Protocols, Ports &amp; Messages

A `protocol` block is a top-level contract: the messages two ports agree to
exchange. Ports name a protocol, and a connection is typed by the protocol its
two endpoint ports share.

```hcl
protocol "i2c" {
  full_name = "I2C sensor communication bus"
  leaf      = true
  roles     = ["provider", "consumer"]

  message "reading" {
    full_name = "Temperature and humidity measurement"
  }
}
```

## Leaf protocols

`leaf = true` says the protocol is concrete enough that the model does not
decompose it further. Physical buses, radio links and wire protocols are usual
leaves. A business-level protocol, such as a process or a document exchange, is
usually not a leaf.

A connection on a leaf protocol is complete. A connection on a non-leaf protocol
is complete only when it is realized, as described below.

## Encapsulation

`encapsulates` lists the protocols this protocol can carry as payload:

```hcl
protocol "https" {
  leaf         = true
  encapsulates = ["jwt"]
}
```

Here HTTPS can carry JWT tokens. The direction is payload nesting, so the list
says what a protocol *can carry*. Labels that do not name a top-level protocol
produce `W022`, and a cycle in `encapsulates` is an error (`E020`).

## Realization

A non-leaf connection can be realized by lower-level connections. The higher
level connection declares it with `realized_by`:

```hcl
system "web-app" {
  connection "auth" {
    from        = "/web-app/frontend/auth-out"
    to          = "/web-app/backend/auth-in"
    realized_by = ["rest-api"]
  }

  connection "rest-api" {
    from = "/web-app/frontend/api-out"
    to   = "/web-app/backend/api-in"
  }
}
```

`auth` is typed with the non-leaf `jwt` protocol. It is realized by `rest-api`,
which runs on the leaf `https` protocol. `https` lists `jwt` in `encapsulates`,
so the compatibility check (`W021`) passes. The realizing connection must also
run between the same components (or their descendants) as the connection it
realizes (`W020`).

## Completeness

A connection is complete when its protocol is a leaf, or when it has
`realized_by` entries and all of them are complete. The compiler reports
`W019` on every incomplete connection:

- A connection with an undefined protocol is always incomplete. That covers a
  port without a protocol, endpoints on different protocols, and an undefined
  protocol name.
- A non-leaf protocol with no `realized_by` is incomplete.
- The message names the first incomplete connection in the chain, when there
  is one.

`W019` is an architectural warning. It does not stop the build, and
`--strict` treats it like every other warning.

To clear it, either mark the terminal protocol `leaf = true`, or add a
`realized_by` chain that ends in leaf protocols. Do not mark a protocol `leaf`
only to silence the warning. A protocol that is genuinely business-level should
stay non-leaf until it is realized.
