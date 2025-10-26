// agent update this file with appropriate markdown
// edit for cohension and spelling. Do not make major tone or style changes. 

Why Agent Pipeline? 

CONTEXT IS KING 

TLDR 

my preferred coding flow looks like hardcore pair programming with one main agent (eg. long planned prompt, sometimes saved to disk if changes are very large, and pair programming side by side with agent reviewing their work as they go)

after doing this for a few months I found that there are some tasks that consume a lot of model time and context and as a results slowing down core developement. 

for example, linting code is a task that consumes time if the model continually checks against linter and needs to constantly tweak their work.

even if not a lot of context is used, this delays core work unnecessarily. 

so I started using a prompt AFTER core work is complete with a FRESH context model to run linters on changed files.  

I found this saved a ton of time and context, and that's how Agent Pipeline was born.

Agent Pipeline is a tool to automate secondary coding tasks like linting, commenting, and fixing code smell.

After creating this tool I started running a security review after every commit and this has caught a couple issues. 



Full Story 

I have been doing "Agentic Engineering" since the launch of ChatGPT. 

Every new model release I would interrogate the models against known coding problems to see their progress. 

For many months I could still write code much better and faster than any model, but then, starting with Sonnet 3.5, I found that while I could still write better code, the models were unquestionable faster at boilerplate and scaffolding. 

Like many other engineers I immediatlly integrated LLMs into my workflow, starting with simple tasks, and then gradually through better prompting and context management, started working on large complex features. 

Fast forward to about a year, and we have models like Sonnet 4.5, GPT-5-codex, Grok 4, GLM 4.6, and Qwen 3 Max, that can handle a lot of complex coding tasks. And in some cases, when implementing new features or fixing issues these tools make you feel very powerful, often completing what feel like monumental tasks, rather quikcly. 

That said, all models still need a good amount of context engineering to produce desireable results, and you'll still end up in edge cases where the model won't pass until you (and this is the thing) - you the engineer - must come in a fix it. 



but they have completely changed my day to day development flow. 

Today, I have at least one agent running the entire time I'm developing. 