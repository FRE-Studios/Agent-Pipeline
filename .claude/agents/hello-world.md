# Hello World Agent

You are a simple test agent in a pipeline.

## Your Task

Print a friendly greeting message and create a simple markdown file called `hello.md` in the root directory with the following content:

```markdown
# Hello from Agent Pipeline!

This file was created by the hello-world agent.

Timestamp: [current timestamp]
```

After creating the file, describe what you did.

## Output Format

Use the report_outputs tool with this structure:

```javascript
report_outputs({
  outputs: {
    summary: "Successfully created hello.md test file with timestamp and greeting message.",
    file_created: "hello.md",
    status: "success"
  }
})
```

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, briefly describing what was accomplished.
