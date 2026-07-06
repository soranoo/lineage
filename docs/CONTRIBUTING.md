# Contributing to Lineage

Thank you for considering a contribution to Lineage. Every kind of contribution is welcome, from a typo fix in the docs to a full feature implementation.

---

## 📖 Table of Contents

- [📋 Code of Conduct](#-code-of-conduct)
- [🐛 Reporting Bugs](#-reporting-bugs)
- [💡 Requesting Features](#-requesting-features)
- [🛠️ Development Setup](#️-development-setup)
- [🔀 Contribution Workflow](#-contribution-workflow)
- [✍️ Commit Messages](#️-commit-messages)
- [✅ Pre-PR Checklist](#-pre-pr-checklist)
- [📐 Coding Standards](#-coding-standards)
- [🤖 AI-Assisted Contributions](#-ai-assisted-contributions)
- [📝 Docs and Non-Code Contributions](#-docs-and-non-code-contributions)

---

## 📋 Code of Conduct

Be respectful. Criticism of code and ideas is welcome; criticism of people is not. If you are unsure whether something is appropriate, err on the side of kindness.

---

## 🐛 Reporting Bugs

Before opening a bug report, please search existing issues to avoid duplicates.

A good bug report includes:

- A **minimal reproducible example** - the smallest possible source snippet and tracker call that triggers the problem
- The **expected output** and the **actual output**
- Your environment: Node.js / Bun version, OS, and `@soranoo/lineage` version
- If relevant: whether the issue reproduces with `mode: 'blank'`, `mode: 'compact'`, or both

> [!TIP]\
> If you are unsure whether something is a bug or a known limitation, open a [discussion](https://github.com/soranoo/lineage/discussions/new/choose) first rather than an issue.

---

## 💡 Requesting Features

Open an issue with the `enhancement` label. Describe:

- **What** you want to do that you currently cannot
- **Why** it matters to your use case
- **How** you imagine it might work (rough sketch is fine)

Features that conflict with the static-analysis-only design of Lineage (e.g. anything requiring code execution) are unlikely to be accepted. If you are unsure, ask first.

---

## 🛠️ Development Setup

### Prerequisites

- [Bun](https://bun.sh) `>= 1.3` - used as the runtime, package manager, and test runner
- [Git](https://git-scm.com)

### Clone and install

```bash
git clone https://github.com/soranoo/lineage.git
cd lineage
bun install
```

### Run the full test suite

```bash
bun test
```

### Run a single test file

```bash
bun test src/__tests__/resolve/IgnoreFilter.test.ts
```

### Run tests in watch mode

```bash
bun test --watch
```

### Type check without emitting

```bash
bun run typecheck
```

### Format the codebase

```bash
bun run fmt
```

### Build

```bash
bun run build
```

The compiled output lands in `dist/`. The entry point is `dist/index.js` with accompanying `.d.ts` type declarations.

> [!NOTE]\
> All four commands (`bun test`, `bun run typecheck`, `bun run fmt`, `bun run build`) must pass cleanly before submitting a pull request.

---

## 🔀 Contribution Workflow

### 1. Open an issue first

For anything beyond a trivial fix (typo, broken link), open an issue before writing code. This avoids duplicate effort and ensures the change aligns with the project direction.

### 2. Fork and create a branch

```bash
# Fork the repo on GitHub, then:
git checkout -b fix/ignore-filter-regex-escape
#              ^-- use the type/short-description format shown below
```

Branch naming follows the same type prefixes as commit messages:

| Type | When to use |
|---|---|
| `fix/` | Bug fix |
| `feat/` | New feature |
| `docs/` | Documentation only |
| `refactor/` | Code change with no behaviour change |
| `test/` | Adding or correcting tests |
| `chore/` | Tooling, config, dependency updates |

### 3. Make your changes

- Write tests before writing implementation (see [Coding Standards](CODING_STANDARDS.md#-testing-rules))
- Keep each PR focused on one concern. If you find an unrelated bug while working, open a separate issue or PR for it.
- Use draft PRs (`Create draft pull request`) if your work is still in progress and you want early feedback.

### 4. Verify everything passes

Run the full pre-PR checklist (see [below](#-pre-pr-checklist)) before marking your PR as ready for review.

### 5. Open the pull request

- Reference the related issue in the PR description: `Closes #42`
- Describe **what** changed and **why**, not just **how**
- If the change affects public API or observable behaviour, update `README.md` accordingly

---

## ✍️ Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer>
```

**Types:**

| Type | When to use |
|---|---|
| `fix` | A bug fix |
| `feat` | A new feature |
| `docs` | Documentation changes only |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or fixing tests |
| `chore` | Tooling, config, dependency bumps |
| `perf` | Performance improvements |
| `ci` | CI configuration changes |

**Examples:**

```
fix(ignore-filter): handle RegExp patterns with special characters

feat(slicer): support generator function yield as a return-path terminus

docs(readme): add compact mode example to getting started

test(backward-slicer): add circular import fixture case
```

**Rules:**

- Summary line is 72 characters or fewer
- Use the imperative mood: "add support" not "adds support" or "added support"
- Body explains the **why** when the summary alone is not enough
- Breaking changes must include `BREAKING CHANGE:` in the footer

---

## ✅ Pre-PR Checklist

Run every item before marking your PR as ready. Every check must pass.

- [ ] `bun test` - zero failures, zero skipped
- [ ] `bun run typecheck` - zero type errors
- [ ] `bun run fmt` - no formatting diff
- [ ] `bun run build` - builds without error
- [ ] `README.md` updated if public API or behaviour changed

---

## 📐 Coding Standards

All code in this project follows the rules documented in [CODING_STANDARDS.md](CODING_STANDARDS.md). Read it fully before writing any code.

> [!IMPORTANT]\
> PRs that violate the coding standards may be rejected without review. The standards are strict to ensure the codebase remains maintainable and consistent.

---

## 🤖 AI-Assisted Contributions

AI tools (Copilot, Claude, Cursor, etc.) are permitted and their use is encouraged where they help. The project itself is developed with AI assistance.

The only requirement is **honesty and ownership**:

- You must have read, understood, and verified every line you submit, regardless of how it was generated.
- If AI generated a test, make sure you understand what it is asserting and why.
- If AI generated an implementation, make sure you understand what it does and that it is correct.
- Do not submit code you cannot explain.

> [!NOTE]\
> You are asked to disclose AI assistance in your PR description. This is not a judgment on your contribution, but a transparency measure for reviewers.

---

## 📝 Docs and Non-Code Contributions

Documentation improvements are just as valuable as code changes. This includes:

- Fixing typos or unclear wording in [`README.md`](../README.md), `CONTRIBUTING.md`(this document), or [`CODING_STANDARDS.md`](CODING_STANDARDS.md)
- Adding examples to the README
- Improving JSDoc comments in source files
- Correcting or clarifying inline code comments

For small fixes (a typo, a broken link) you can open a PR directly without an issue. For larger rewrites, open an issue first to discuss the approach.

> [!NOTE]\
> Doc-only PRs do not need to pass `bun run build` but must still pass `bun test` and `bun run typecheck`.