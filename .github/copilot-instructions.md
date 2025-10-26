# Copilot Instructions

## Package Management

**Never use `npm` commands.** This project uses Deno for package management and
development tasks.

- Use `deno` commands instead of `npm`
- Dependencies are managed through Deno's import system
- For installing packages, use Deno's import syntax or `deno add` commands

## Common Tasks

### Installation

```bash
deno install
```

### Building

```bash
deno run build
```

### Linting

```bash
deno run lint
```

### Testing

```bash
deno test
```
