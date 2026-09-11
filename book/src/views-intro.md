# Introduction to Views

> [!IMPORTANT]
> This chapter explains the view syntax, but you're not expected to write views
  by hand.
> Instead, the Rhizz Web App allows you to create views in a diagram editor.

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

All views are checked for correctness. This is what happens when you use a
non-existing component in a system view:

```rhizz-project src="views-intro/2_example_error"
```
