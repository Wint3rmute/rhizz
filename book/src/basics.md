# Basics of Rhizz syntax

The smallest possible thing you could write in Rhizz looks like this:

```rhizz
system "nothing" {
  description = "an empty system"
}
```

While this is not a very good model, we can use it to describe the
very basics of the language we'll be working with.

## HCL syntax

Rhizz uses
[HCL - HashiCorp configuration language](https://github.com/hashicorp/hcl)
to define system models. HCL is easy to write by hand, is much less verbose than
JSON and is more predictable than YAML. It's already used to define cloud-based
systems, so it was a natural fit.

## Rhizz Compiler Output

While not strictly related to the Rhizz syntax, the output of the compiler will
be frequently mentioned in this book. All code blocks in this book containing
Rhizz code are run through the Rhizz compiler, which emits the compilation
results - completion metrics for the system model. You can see them in the green
box in the example above. This way of displaying the results of examples will be
used across this whole book.

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
Think about a following example: you're building a plane. Already getting
ambitious! But you can't just build a plane, you also have to build surrounding
infrastructure for it:

1. Your plane probably needs an end-to-end testing harness.
2. Components of your plane need their own dedicated harnesses.
3. You could picture the same plane in various usage contexts.
4. You want to re-use components and have Rhizz validate all defined configurations.

That's precisely what systems are for! You can build separate systems for:

- `plane-in-hangar`
- `plane-in-air`
- `engine-testing-harness`
- `hydraulics-testing-harness`

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

## Connections

The warning *"component 'SOME_NAME' is not referenced by any connection"* keeps on
appearing, let's fix it by building a bike with:

- A bicycle frame
- A bicycle fork
- Wheels attached

```rhizz
component "wheel" {
  description = "A spinning round object"
  leaf = true
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

## A live project

Static code blocks show one angle at a time. The project below is embedded
live: browse its diagram, read its source files, and inspect the compiler's
verdict — all without leaving the book.

```rhizz-project src="projects/demo" open="diagrams/main.hcl"
```
