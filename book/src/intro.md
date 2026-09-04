# Introduction

![](./rhizz_landing.jpg)

Rhizz is a systems modeling language, built for architects who want to go
beyond design documents and diagrams sketched on whiteboards (or their digital
equivalents). Rhizz allows you to create a **model of your system**, either via
an interactive model editor (think Drawio/Excalidraw but with with validation
across multiple diagrams) or by implementing your systems models as code. Those
approaches are interchangeable. Your LLM of choice will likely appreciate a
text-based interface, while you will probably prefer a graphical representation.

Diagramming in Rhizz goes beyond drawing shapes on a canvas. Each thing you draw
is added to your system model, made out of:

- Systems (possible realisations of your product)
- Components (nodes, boxes)
- Connections (arrows/lines between components)
- Interfaces (specification of interaction)

Once defined, Rhizz will not allow you to draw the same component with a
different set of connections, a different parent, or a different interface. You
can show & hide parts of the model for brevity, showing the model of your system
from diferent perspectives, but the Rhizz compiler will always verify that all
your diagrams are consistent.


## Gradual Compilation

Rhizz is built on top of the idea that your system is constantly changing,
rarely (if ever) finished. Therefore, the compiler was built with **gradual
specification** of your system in mind. You don't have to create a full model of
your system upfront. You can leave missing pieces for later, you can stay on a
high level of abstraction. The Rhizz compiler can be tuned into various level of
strictness, accepting super high-level non-technical specifications or requiring
full breakdowns of all components and their connections.

> TODO: link to strictness settings page.

## Target Audience

### Engineers

The core audience for Rhizz are **engineers in general**. All the people who
want to understand the things their working on. Rhizz attempts to deepen their
understanding by letting engineers explore a system model, which also serves as
a knowledge base.

### Product Owners

High-level assumptions about the project can be defined in Rhizz, even by
non-technical PO's. What's important is that there's no knowledge/system gap
between high-level Product Owners and lower-level engineers. The product spec
and the model of how its implemented both live in the same place, allowing
for effective collaboration and deeper understanding between team members with
different backgrounds.

### Architects

Warning: ramblings of the author ahead! After I stopped working as a software
engineer and became an architect (though I've also been a team lead and a
product owner), I felt like the way that we communicate in large engineering
projects is not very effective.

Every time I meet with other teams, I explain the same interfaces all over
again. Everyone has some level of understanding, but it's usually only their
side of the equation. You could blame bad documentation (or lack of it), but I
don't believe that's the case. It's mostly about availability of the **right**
documentation when you need it. While the things which everyone should know
are usually written down somewhere, it's hard to quickly find and read through
what's relevant to the issue at hand.

I believe that the single system model which can be projected into a diagram,
a view of a specific part of the system, is what we need to quickly find our way
through complex multidisciplinary projects.

### Programmers

Rhizz aims to bring static analysis capabilities to your system design. If
you're a software person, think about it as a linter or a compiler for a system
design. You can have your diagrams checked for correctness, as you check your
code!

## Philosophy

The name "Rhizz" is a portmanteau of:

- Rizz, a slang term for charisma/style/charm
- Philosophical term [rhizome](https://en.wikipedia.org/wiki/Rhizome_(philosophy)):

> Rhizome is a concept (...) describing an assemblage that allows connections between any of its constituent elements,
> regardless of any predefined ordering,  structure, or entry point.

Rhizz's philosophy opposes the typical top-down architect-to-engineer structure,
where architects define "the high level view" and engineers are supposed to make
their designs work in the limitations of the real world. Such approach causes
architects to become more and more detached from the reality of the system,
unaware of the growing gap between the model and the real world.
See: [Ivory Tower Architect](https://blog.alexewerlof.com/p/ivory-tower-architect).
Rhizz aims to let engineers of different specializations and different positions
in the organization contribute to the system model. The permissive/gradual
compiler provides an easy learning curve. Each small piece of information added
to the model improves the coherence validation capabilites of the compiler.
Information no longer flows in one direction. Instead, constraints and details
emerge from multiple sides.

## Non-goals

Features which are not not planned for implementation. If you need them, you need a different tool.

### Simulations

Rhizz does not simulate the behavior of your system. It cannot stress-test your model.
If you need something for simulations, consider [TLA+](https://en.wikipedia.org/wiki/TLA%2B).

### Fancy animations of your system model

Rhizz's primary output format is **a 2D diagram**. While I'm dedicated to make
them look as good as possible, I won't create a tool for fancy visualisations.
