# Connections & Ports

This chapter focuses on how to model connections between the components of your
system. You've already seen the basic component-to-component connection schema:

```rhizz
component "server" {
  description = "Server in the cloud"
  leaf = true
}

component "client" {
  description = "Client's computer"
  leaf = true
}

system "banking-application" {
  description = "Internet-based access to your bank account"

  instance "server" { source = "server" }
  instance "client" { source = "client" }

  connection "api-access" {
    description = "REST API with OAuth2"
    from = "server"
    to = "client"
  }
}
```

This is fine, but high-level. We just know that two components talk to each
other and that's it. What if we wanted to dig deeper, how about:

- What kind of `protocol` is used to talk between those components?
- Is `client` even supporting that protocol?
- Does `server` has any `port` for the client to connect to?

> [!NOTE]
> Programmers reading this probably think about `ports` in terms of
> [networking](https://en.wikipedia.org/wiki/Port_(computer_networking)).
> In the case of this book, please switch into a more generic definition of
> "something to connect to".

While this model compiles without any errors, the model completion score
points us towards things to specify further:

- There are 0 `ports` defined
- There are 0 `messages` defined

> TODO: what the hell is "Connections 0/1"? Some bug prolly...

## Defining & connecting ports

```rhizz
component "computer" {
  description = "Personal Computer (PC)"
  leaf = true
  port "usb-c" { }
}

component "mouse" {
  description = "Computer Mouse"
  leaf = true
  port "usb-c" { }
}

system "work-computer" {
  description = "My work computer"
  instance "computer" { source = "computer" }
  instance "mouse" { source = "mouse" }

  connection "mouse-to-computer" {
    description = "Mouse connected to the PC by a USB-C cable"
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
