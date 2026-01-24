# Why Agent Pipeline?

---

**Context is king** — the better we manage context, the better the model performs.

Agent Pipeline allows developers to move all non-core development tasks (like linting) outside of the main agent harness.

---

## Story

For most of last year, my preferred coding flow looked like hardcore pair programming with one main agent: a long planned prompt, sometimes saved to disk if work scope was very large, and pair programming side by side with the agent reviewing their work as they go. Watching the agent work was very important because previous models would make mistakes quite often.

Working like this for a few months (March 2025 - June 2025), I found that there are some tasks that consume a lot of model time and context and result in slowing down core development.

For example, linting code is a task that consumes time if the model continually checks against the linter and needs to constantly tweak their work.

Even if not a lot of context is used, this delays core work unnecessarily.

So I started using a prompt (or /commands) AFTER the initial core work was complete with a FRESH context model to run linters on changed files.

I found this saved a ton of time and context, and that's how Agent Pipeline was born.

Agent Pipeline is a tool created to automate secondary coding tasks like linting, commenting, and fixing code smell.

As the underlying models improved and became more trustworthy, the power of Agent Pipeline increased since by design it's intended to be run "out of loop" (no human oversight).

Initially, I used this tool to run very simple and known tasks (like linting, test running/updates, other CI/CD work), but as models became more performant, my use of Agent Pipeline evolved to feature exploration and even core feature development.
