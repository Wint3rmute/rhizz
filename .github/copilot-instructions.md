# Copilot Instructions

## Project Overview

Rhizz is a systems engineering tool built with React, TypeScript, Vite, and Electron. It provides:
- System modeling via YAML files
- Interface modeling with protocols
- Verification of interface coherency
- Graphical visualization using Graphviz
- Monaco editor integration for YAML editing

## Package Management

**This project uses npm/Node.js**, not Deno. Use standard npm commands:

- Use `npm` commands for package management
- Dependencies are managed through `package.json`
- Don't attempt to install packages without explicit user request

## Architecture

### Core Model Pipeline

1. **Syntax Layer** (`model-syntax.ts`): Defines Zod schemas for parsing YAML into syntactic models
2. **Compiler** (`model-compiler.ts`): Validates and transforms syntax models into semantic models
3. **Semantics Layer** (`model-semantics.ts`): Defines the validated semantic model structure with `components_index`
4. **Visualizer** (`model-visualizer.ts`): Generates Graphviz DOT format from semantic models

### Key Concepts

- **Components**: Hierarchical system elements that can contain nested components
- **Connections**: Links between components with optional protocol specifications
- **Protocols**: Define communication interfaces with `is_abstract` and `can_encapsulate` properties

## Common Tasks

### Development

```bash
npm start
```

### Linting

```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
```

### Testing

```bash
npm test
```

Tests use Node.js built-in test runner (`node:test`) with `tsx` for TypeScript support.

## Code Style Guidelines

### Model-Related Code

- Validation errors should throw `ModelCompilationError`

### TypeScript Conventions

- Use `.ts` file extensions in imports (compatible with Vite/Electron Forge setup)
- Prefer `type` over `interface` for type-only definitions
- Use Zod schemas for runtime validation
- Keep schema definitions close to their usage

### React Components

- Functional components with hooks
- Use React Router for navigation
- LocalStorage for persistence (via `UseLocalStorage.ts` hook)
- Ant Design (antd) for UI components

### Error Handling

- Use discriminated union return types for parsing results

## Testing

- Tests are in `tests/` directory with `*_test.ts` naming
- Use Node.js test runner assertions (`node:assert`)

## Dependencies

Key libraries:
- **Zod**: Runtime schema validation
- **Monaco Editor**: Code editor component
- **@viz-js/viz**: Graphviz rendering (WASM)
- **Ant Design**: UI component library
- **js-yaml**: YAML parsing
- **React Router**: Client-side routing
- **Electron Forge**: Electron build tooling
