# Proposals

Proposals are design documents for changes to the Rhizz language, its
diagnostics, scoring, views, or CLI. Each proposal is numbered and carries a
status.

## Lifecycle

```
draft -> review -> accepted -> implemented
                 \-> rejected
                 \-> withdrawn
```

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `draft`       | Being written; not yet ready for discussion                             |
| `review`      | Open for discussion via pull request                                    |
| `accepted`    | Approved; may be implemented                                            |
| `implemented` | Merged into `SPEC.md` / `SPEC/` and the book chapters                   |
| `rejected`    | Decided against; kept for reference                                     |
| `withdrawn`   | Withdrawn by its author                                                 |

## Index

| No. | Title | Status |
| --- | ----- | ------ |

_No proposals yet. See [the template](0000-template.md) to start a new one._

## Process

1. Copy `0000-template.md` to `NNNN-short-title.md` using the next free number.
2. Set `status: draft` and open a pull request.
3. Move to `review` once the design is complete and includes at least one
   worked example under `examples/` or in the proposal itself.
4. On acceptance, set `status: accepted` and add the entry to the index above.
5. On implementation, move the content into `SPEC.md` / `SPEC/` and the book
   chapters, bump the spec version, and set `status: implemented`.
