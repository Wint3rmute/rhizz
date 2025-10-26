# Copilot Instructions

## Package Management

**Never use `npm` commands.** This project uses Deno for package management and
development tasks.

- Use `deno` commands instead of `npm`
- Dependencies are managed through Deno's import system
- For installing packages, use Deno's import syntax or `deno add` commands

## Common Tasks

### Building

```bash
deno run build
```

### Testing

```bash
deno test
```

### Linting

```bash
deno run lint
```
