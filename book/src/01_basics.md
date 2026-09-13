# Basics of Rhizz syntax

The smallest possible thing you could write in Rhizz looks like this:

```rhizz
system "nothing" {
  description = "an empty system"
}
```

While this does not really model any useful system, we can use it to describe
the basics of the tool we'll be working with.

## HCL syntax

Rhizz uses
[HCL - HashiCorp configuration language](https://github.com/hashicorp/hcl)
to define system models. HCL is easy to write by hand, is much less verbose than
JSON and is more predictable than YAML. It's already used to define cloud-based
systems, so it was a natural fit.

## Rhizz Compiler Output

Output of the compiler will be frequently mentioned in this book. All code
blocks in this book containing Rhizz code are run through the Rhizz compiler,
which emits the compilation results - completion metrics for the system model.
You can see them in the green box in the example above. This way of displaying
the results of examples will be used across this whole book.

## Systems

```rhizz
system "nothing" {
  description = "an empty system"
}

system "also-nothing" {
  description = "Nothingness 2.0: Electric Bongaloo"
}
```

A `system` is **one possible realisation** of whatever it is you're building.
Think about a following example: you're building a plane. But you can't build
**just** a plane, such system is always surrounded by the instrastructure
related to its manufacturing and utilization:

1. Your plane probably needs an end-to-end testing harness.
2. Components of your plane need their own dedicated harnesses.
    - e.g. a dedicated harness for the engine.
3. You could picture the same plane in various usage contexts.
4. You want to re-use components and have Rhizz validate all defined configurations.

That's precisely what systems are for! You can define separate systems for
different use-cases:

- `system plane-in-hangar`
- `system plane-in-air`
- `system engine-testing-harness`
- `system hydraulics-testing-harness`

Those systems will re-use various parts of your overall model. When you have to
change your design, Rhizz will give you hollistic feedback, not only about the
final use-case (`plane-in-air`), but also how the design change will affect the
rest of your product's infrastructure.

> TODO: is `system` really a good name for it? Ask fellow SE people.

## Components

```rhizz
component "wheel" {
  description = "A spinning round object"
}
```

The keyword `component` **defines** a new reusable component. It's not the same
thing as placing the component somewhere in your system model! This is a
**reusable definition**. Each definition has a unique name, you will soon learn
how to "place" (instantiate) your `component` definitions in your systems.

You can already see that the Rhizz compiler started warning you about some
issues with that definition. More on those issues in the Components in Detail
page!

> TODO: add component details page

## Instances

You now know about `systems` and about `components`, lets put this together
and place a component in a system:

```rhizz
component "wheel" {
  description = "A spinning round object"
  leaf = true
}

system "bicycle" {
  description = "Personal transport vehicle"

  instance "front-wheel" {source = "wheel"}
  instance "rear-wheel" {source = "wheel"}
}
```

We instantiated the `wheel` 2 times to create a `bicycle`! For the sake of
brevity, I marked `wheel` with `leaf = true`, so that the compiler won't
complain about the battery not being fully defined. We'll come back to this
later, you can ignore this fact for now.

## Nesting

A component can have children (and those children can have their own children). Let's
add a `tire` to our wheel:

```rhizz
component "tire" {
  description = "A 24in bicycle tire"
  leaf = true
}

component "wheel" {
  description = "A spinning round object"
  instance "tire" {source = "tire"}
}

system "bicycle" {
  description = "Personal transport vehicle"

  instance "front-wheel" {source = "wheel"}
  instance "rear-wheel" {source = "wheel"}
}
```

> [!IMPORTANT]
> A crucial concept to understand in this example is that adding the `tire` as the
  child component of `wheel`
> causes this change to be propagated along all instances of `wheel`.
  `front-wheel` and `rear-wheel` both
> have a `tire` child component now, as we've changed the **definition** of what `wheel` means.

## Connections

The warnings *"component 'NAME' is not referenced by any connection"* appear
multiple times, let's fix some of them by building a bike with:

- A bicycle frame
- A bicycle fork
- Wheels attached

```rhizz
component "tire" {
  description = "A 24in bicycle tire"
  leaf = true
}

component "wheel" {
  description = "A spinning round object"
  instance "tire" {source = "tire"}
}

component "fork" {
  description = "Holds the front wheel"
  leaf = true
}

component "frame"  {
  description = "main component of a bicycle"
  leaf = true
}

system "bicycle" {
  description = "Personal transport vehicle"

  instance "front-wheel" {source = "wheel"}
  instance "rear-wheel" {source = "wheel"}
  instance "fork" {source = "fork"}
  instance "frame" {source = "frame"}

  connection "front-wheel-mount" {
    description = "keeps the front wheel attached"
    from = "./front-wheel"
    to = "fork"
  }

  connection "rear-wheel-mount" {
    description = "keeps the rear wheel attached"
    from = "./rear-wheel"
    to = "./frame"
  }

  connection "fork-mount" {
    description = "bearing connecting the fork to the frame"
    from = "./fork"
    to = "./frame"
  }
}
```

> TODO: why W003 still appears for standalone components...?

We now have a simple (and incomplete) bicycle model. This model is small enough
to be visualised with just a single diagram, so Rhizz's diagramming capabilities
won't shine for such a trivial example.

In the upcoming chapters, you'll see how Rhizz can model complex, nested and
multi-dimentional systems, which cannot be grasped without looking at them from
multiple different angles.

## Full projects

All examples in this book are **actual Rhizz projects**.
So far we've been only working with single-file examples,
here you can see a project with a system model and a view.

```rhizz-project src="basics/demo" open="diagrams/main.hcl"
```
