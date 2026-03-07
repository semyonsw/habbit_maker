# Contributing Guide

Thank you for your interest in improving Habit Maker.

## Ways to Contribute

- Report bugs and usability issues
- Suggest or discuss new features
- Improve documentation
- Submit code improvements

## Development Setup

1. Fork and clone the repository.
2. Start a local server from the project root:

```bash
python3 -m http.server 8080
```

3. Open `http://localhost:8080` in your browser.

## Branch and Commit Style

- Create focused branches for each change.
- Keep pull requests small and reviewable.
- Use clear commit messages, for example:

```text
feat: add weekly summary card hover states
fix: preserve checkbox state after month switch
docs: clarify import/export behavior in README
```

## Pull Request Checklist

- Code changes are scoped and understandable
- Existing behavior is preserved unless intentionally changed
- README/docs are updated when needed
- Manual browser check completed (desktop and mobile)

## Coding Guidelines

- Prefer readable, explicit JavaScript over clever shortcuts
- Keep CSS organized by section and component
- Add comments only where intent is not obvious
- Do not introduce build tooling unless discussed first

## Questions

If you are unsure about implementation details, open an issue first so we can
align on scope and direction.
