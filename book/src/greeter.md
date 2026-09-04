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
component "battery" {
  description = "Small AAA battery providing power"
}
```

The keyword `component` **defines** a new reusable component. It's not the same
thing as placing the component somewhere in your system model! This is a
**reusable definition**. Each definition has a unique name, you will soon learn
how to "place" (instantiate) your `component` definitions in your systems.

You can already see that the Rhizz compiler started warning you about some
issues with that definition. More on those issues in the Components in Detail
page!
