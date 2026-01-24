// agent update this file with appropriate markdown
// edit for cohension and spelling. Do not make major tone or style changes. 

Why Agent Pipeline? 

-- 

CONTEXT IS KING and the better we manage context the better the model performs. 

Agent Pipeline allows developers to move all non-core developement tasks (like linters, outside of main agent harness)

---

Story

For most of last year, my preferred coding flow looked like hardcore pair programming with one main agent: a long planned prompt, sometimes saved to disk if work scope was very large, and pair programming side by side with agent reviewing their work as they go. Watching the agent work WAS very important because previous models would make mistakes quite often. 

Working like this for a few months (March 2025 - June 2025) I found that there are some tasks that consume a lot of model time and context and result in slowing down core developement. 

for example, linting code is a task that consumes time if the model continually checks against linter and needs to constantly tweak their work.

even if not a lot of context is used, this delays core work unnecessarily. 

so I started using a prompt (or /commands) AFTER the initial core work was complete with a FRESH context model to run linters on changed files.  

I found this saved a ton of time and context, and that's how Agent Pipeline was born.

Agent Pipeline is a tool created to automate secondary coding tasks like linting, commenting, and fixing code smell.

As the underlying models improved and became more trustworthy, the power of Agent Pipeline increase since by design it's intended to be run "out of loop". (no human oversight)

Initally, I used this tool to run very simple and known tasks (like linting, test running / updates, other CI/CD work), but as models improved models became more performant, my use of Agent Pipeline evolved to feature exploration and even core feature development. 
