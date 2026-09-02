# Introduction

![](./rhizz_landing.jpg)

Rhizz is a systems modeling language, built for architects who want to go beyond
design documents and diagrams sketched on whiteboards (or their digital
equivalents). Rhizz allows you to create a model of your system by creating a
series of diagrams, which are turned into a formal model of the system and
verified by the Rhizz compiler. Diagramming in Rhizz not drawing shapes on a
canvas. Each thing you draw is added to your system model, made out of:

- Components (nodes, boxes)
- Connections (arrows/lines between components)
- Interfaces (specification of interaction)

Rhizz will not allow you to draw the same component with a different set of
connections, a different parent, or a different interface. You can show & hide
parts of the model for brevity, showing the model of your system from diferent
perspectives, but the Rhizz compiler will always verify that all your diagrams
are consistent.


## Gradual Compilation

Rhizz is built on top of the idea that your system is constantly changing,
rarely (if ever) finished. Therefore, the compiler treats **gradual
specification** of your system as a first-class citizen. You don't have to
create a full model of your system upfront. You can leave missing pieces for
later, you can stay on a high level of abstraction.
The Rhizz compiler can be tuned into various level of strictness, accepting
super high-level non-technical specifications or requiring full breakdowns of
all components and their connections.

## Target Audience

### Engineers

The core audience for Rhizz are **engineers in general**. All the people who
want to really understand the systems their working on, based on a coherent
system model, which also serves as a knowledge base.


### Programmers

Rhizz aims to bring static analysis capabilities to your system design. If
you're a software person, think about it as a linter or a compiler for a system
design.

## Philosophy

The name "Rhizz" is a portmanteau of:

- Rizz, a slang term for charisma/style/charm
- Philosophical term [rhizome](https://en.wikipedia.org/wiki/Rhizome_(philosophy)):

> Rhizome is a concept (...) describing an assemblage that allows connections between any of its constituent elements,
> regardless of any predefined ordering,  structure, or entry point.

Rhizz's philosophy opposes the hierarchical structures, where software
architects define top-down models and the remaining engineers are supposed to
make those models work in the limitations of the real world. Such approach causes
architects to become more and more detached from the reality of the system,
unaware of the growing gap between the model and the real world.
See: [Ivory Tower Architect](https://blog.alexewerlof.com/p/ivory-tower-architect).
Rhizz aims to let engineers of different specializations and different positions
in the organization contribute to the system model. The permissive/gradual
compiler provides an easy learning curve. Each small piece of information added
to the model improves the coherence validation capabilites of the compiler.

## Non-goals

Features which are not not planned for implementation. If you need them, you need a different tool.

### Simulations

Rhizz does not simulate the behavior of your system. It cannot stress-test your model.
If you need something for simulations, consider [TLA+](https://en.wikipedia.org/wiki/TLA%2B).
