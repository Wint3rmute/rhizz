# Introduction to Views

Views allow you to visualise your system model from different perspectives.
Think about the following:

- High-level overview of the system
- Detailed view of a specific component
- View focusing on interaction between two important components

All of those are valid ideas for a view into your system.
Take a look at a simple model of a computer setup. This model
has 2 views:

- `system.hcl` - Overview of the system
- `pc-build.hcl` - Internals of the computer


```rhizz-project src="views-intro/1_example_simple"
```

Both of those views utilize the same model underneath. Components are imported
to the view using their full path, which uniquely identifies the specific
instance of a component inside a specific system.

## View correctness

All views are checked for correctness. The example below demonstrates what
happens when you use a non-existing component in a system view. As you can see,
the view fails to render and the warning explains why:

```rhizz-project src="views-intro/2_example_error"
```

## Visibility of connections

> [!NOTE]
> This behavior might change in the future, Rhizz is at MVP stage!

Rhizz decides what connections are visible in the view based on the components
that are visible in the view. If selected components have connections, they will
be displayed. This behavior ensures that you don't miss any connections
accidentally.

## View syntax

> [!IMPORTANT]
> This section explains the view syntax, but remember that you're not expected
> to write views by hand. Rhizz Web App allows you to create views in the
  diagram editor.
