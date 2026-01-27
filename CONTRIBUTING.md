# Contributing to Agent Pipeline

Thanks for your interest in contributing!

## Philosophy

**Small, focused PRs only.** This mirrors the core philosophy of Agent Pipeline itself: break work into the smallest coherent units. Each PR should do one thing well.

## What Makes a Good PR

- **Single purpose**: One bug fix, one feature, or one refactor per PR
- **Clear title**: Describes what changed, not how
- **Tests included**: For any new functionality or bug fixes

## What to Avoid

- PRs that mix features with refactoring
- PRs that touch unrelated files
- Large "cleanup" PRs that change many things at once
- Drive-by style fixes bundled with other work

If your change is larger, break it into sequential PRs.

## Getting Started

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/agent-pipeline.git
cd agent-pipeline

# Install and build
npm install

# Run tests
npm test -- --run

# Make your changes on a branch
git checkout -b fix/short-description
```

## Before Submitting

1. Run `npm test -- --run` and ensure all tests pass
2. Run `npm run build` to verify TypeScript compiles
3. Keep commits atomic and well-described

## Code Style

- TypeScript with ESNext modules
- Imports use `.js` extension (even for `.ts` files)
- Use existing patterns in the codebase
- No unnecessary abstractions

## Questions?

Open an issue for discussion before starting large changes.
