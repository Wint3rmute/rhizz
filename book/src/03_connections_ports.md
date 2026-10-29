# Connections & Ports

This chapter focuses on how to model connections between the components of your
system. You've already seen the basic port-to-port connection schema:

```rhizz,level=architectural
component "server" {
  full_name = "Server in the cloud"
  leaf = true

  port "api" {
    role = "provider"
  }
}

component "client" {
  full_name = "Client's computer"
  leaf = true

  port "api" {
    role = "consumer"
  }
}

system "banking-application" {
  full_name = "Internet-based access to your bank account"

  instance "server" { source = "server" }
  instance "client" { source = "client" }

  connection "api-access" {
    full_name = "REST API with OAuth2"
    from = "server/api"
    to = "client/api"
  }
}
```

This names the port paths the connection uses. To dig deeper, how about:

- What kind of `protocol` is used to talk between those ports?
- Is `client` even supporting that protocol?
- Does `server` name the same protocol on its port?

> [!NOTE]
> Programmers reading this probably think about `ports` in terms of
> [networking](https://en.wikipedia.org/wiki/Port_(computer_networking)).
> In the case of this book, think about a more broad/generic definition of
> "something to connect to".

While this model compiles without any errors, the model completion score
points us towards things to specify further:

- There are 0 `messages` defined

The connection is also reported as incomplete (`W019`): the ports name no
protocol, so the protocol is undefined. See
[Protocols](07_protocols.md) for how a connection gets its protocol and how it
is completed.

> TODO: what the hell is "Connections 0/1"? Some bug prolly...

## Defining & connecting ports

```rhizz,level=architectural
component "computer" {
  full_name = "Personal Computer (PC)"
  leaf = true
  port "usb-c" { }
}

component "mouse" {
  full_name = "Computer Mouse"
  leaf = true
  port "usb-c" { }
}

system "work-computer" {
  full_name = "My work computer"
  instance "computer" { source = "computer" }
  instance "mouse" { source = "mouse" }

  connection "mouse-to-computer" {
    full_name = "Mouse connected to the PC by a USB-C cable"
    from = "computer/usb-c"
    to = "mouse/usb-c"
  }
}
```

> TODO: 0/4 ports, marked as unused or what? Why isn't completion score up? Same
> issue with connections as before.

The `work-computer` system defines 2 `usb-c` ports on the component level. Now
we have more details about what exactly we're connecting to.  The component
states what port it exposes and the compiler will raise an error if you try to
connecting to a non-existing port. Consider having an inventory of components
from some iteration of your product, while designing a new version of that
product. Having ports specified inside components allows you to quickly see what
parts can be easily re-used and which ones will require changes at interface
level, or even need a complete rework.
