### Step 8: Integration testing
**Create integration test file:**
- `src/__tests__/integration/{example}.test.ts`

**Test scenarios:**
1. Full workflow: init → create → edit → validate → run
2. Agent workflow: init → agent pull → agent list → agent info
3. Pipeline workflow: create → clone → export → import
4. Cleanup workflow: run → cleanup --force --delete-logs
5. Error scenarios across all new commands

**Verification:**
```bash
npm test src/__tests__/integration/ -- --run
```

### Step 9: Run full test suite
**Ensure all tests pass:**
```bash
npm test -- --run
```

**Expected results:**
- All existing tests pass
- All new command tests pass
- Code coverage maintained or improved
- No regressions in existing functionality

### Step 10: Manual testing checklist
**Test each command manually:**
- [ ] `agent-pipeline create` - Interactive flow works
- [ ] `agent-pipeline edit <pipeline>` - Opens in editor
- [ ] `agent-pipeline delete <pipeline>` - Confirmation works
- [ ] `agent-pipeline clone <source> <dest>` - Auto-naming works
- [ ] `agent-pipeline validate <pipeline>` - Shows errors
- [ ] `agent-pipeline config <pipeline>` - Displays YAML
- [ ] `agent-pipeline export <pipeline> --include-agents` - Exports with agents
- [ ] `agent-pipeline import <file>` - Imports successfully
- [ ] `agent-pipeline agent list` - Shows table
- [ ] `agent-pipeline agent info <name>` - Shows details
- [ ] `agent-pipeline agent pull` - Imports from plugins
- [ ] `agent-pipeline history` - Press 'o' to open logs
- [ ] `agent-pipeline cleanup --force --delete-logs` - Deletes branches and logs

---

## Next Steps After Testing

1. Update README.md with all new commands and examples
2. Add CONTRIBUTING.md with development guidelines
3. Create CHANGELOG.md for version tracking
4. Prepare for npm publication