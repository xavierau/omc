# Development Process

Strict workflow for every feature implementation. NO shortcuts. Follow every step.

## Step 0: Pick Task

1. Run `./node_modules/.bin/tsx scripts/kanban.ts todo` to see the board
2. Confirm with the user which task to work on
3. Read the task's acceptance criteria and dependencies from `.claude/kanban.json`

## Step 1: Create Worktree

Create a git worktree for the feature. NEVER work directly on `develop`.

```bash
# Format: ../{project_name}-{worktree_name}-worktree
git worktree add ../whatsapp-crm-{task-id-lowercase}-worktree -b feature/{task-id-lowercase}
cd ../whatsapp-crm-{task-id-lowercase}-worktree
```

Example for MSG-002:
```bash
git worktree add ../whatsapp-crm-msg-002-worktree -b feature/msg-002
cd ../whatsapp-crm-msg-002-worktree
```

## Step 2: Plan (BEFORE any code)

Use the `solution-architect` agent to create a comprehensive implementation plan:

1. **Analyze** the task acceptance criteria
2. **Identify** all files to create/modify
3. **Design** the solution (domain entities, use cases, infrastructure, UI)
4. **Define test cases** for EACH acceptance criterion + edge cases
5. **List dependencies** between implementation steps
6. **Present the plan** to the user for approval

The plan MUST include:
- Architecture decisions with rationale
- File-by-file changes
- Database migration if needed
- Test plan with specific test cases per acceptance criterion
- Edge cases identified and how they're handled

**Do NOT proceed to Step 3 until the user approves the plan.**

## Step 3: Implement with TDD (Parallel Agents)

**Maximize parallelism.** During the plan phase (Step 2), identify independent work streams that can run concurrently. Delegate to specialized sub-agents in parallel wherever possible.

### Parallelization Strategy

1. **Identify independent streams** from the plan — e.g., domain logic, infrastructure, API routes, UI components, migrations
2. **Launch agents in parallel** for streams with no dependencies between them:
   - `senior-backend-dev` — domain entities, use cases, repositories, migrations
   - `react-frontend-dev` — UI components, pages, hooks
   - Both agents write tests as part of their implementation (TDD)
3. **Sequential only when dependent** — if Stream B depends on Stream A's output, wait for A to complete
4. **Synthesize** — after all agents complete, verify integration, run full test suite

### Example parallel dispatch

For a task with domain logic + API route + admin UI:
```
[parallel]
  Agent 1 (senior-backend-dev): domain entity + use case + tests
  Agent 2 (senior-backend-dev): migration + repository + tests
[wait for both]
[parallel]
  Agent 3 (senior-backend-dev): API route + integration tests
  Agent 4 (react-frontend-dev): admin UI component + hooks
[wait for both]
  Run full test suite
```

### TDD within each agent

Each agent follows TDD internally:

1. **Write tests FIRST** — unit tests for each acceptance criterion + edge cases
2. **Run tests** — confirm they fail (red)
3. **Implement** — write the minimum code to pass
4. **Run tests** — confirm they pass (green)
5. **Refactor** if needed — clean up while tests stay green

### Testing requirements
- Every acceptance criterion has at least one test
- Edge cases are tested (null inputs, empty arrays, boundary conditions, error paths)
- Use the project's existing test patterns (vitest, test-utils/mocks.ts, test-utils/builders.ts)
- Tests must be runnable with `npm run test`
- After all agents complete, run full suite to verify integration

## Step 4: Code Review (Agent)

After implementation is complete:

1. Use the `code-review-analyzer` agent to review ALL changed files
2. The review checks:
   - Security (OWASP top 10)
   - Performance
   - Architecture alignment (Clean Architecture, DDD, SOLID)
   - Test coverage and quality
   - Code quality (file size < 150 lines, function < 20 lines, params < 4)
3. **Fix ALL identified issues** before proceeding
4. Re-run tests after fixes: `npm run test`

## Step 5: Create PR

1. Stage and commit changes (follow git conventions: `feat:`, `fix:`, `refactor:`, `test:`)
2. Push the feature branch
3. Create a GitHub PR against `develop`:
   ```bash
   gh pr create --base develop --title "feat: {description}" --body "..."
   ```
4. PR body must include:
   - Summary of changes
   - Test plan
   - Link to kanban task ID

## Step 6: PR Review + Merge

1. Run `/review` skill on the PR
2. Fix ALL issues identified by the review
3. Push fixes, re-run `/review` until clean
4. Merge the PR:
   ```bash
   gh pr merge --squash
   ```
5. Return to main worktree and pull:
   ```bash
   cd /Users/xavierau/Code/js/whatsapp-crm
   git pull origin develop
   ```
6. Clean up the worktree:
   ```bash
   git worktree remove ../whatsapp-crm-{task-id-lowercase}-worktree
   ```

## Step 7: Update Board

Update `.claude/kanban.json`:
- Move the task from `todo` → `done`
- Add `completed_at` date
- Run `./node_modules/.bin/tsx scripts/kanban.ts` to verify

## Rules

- **NEVER skip the plan step** — no cowboy coding
- **NEVER skip tests** — every acceptance criterion must have a test
- **NEVER merge without review** — agent review + /review on PR
- **NEVER work on develop directly** — always use a worktree
- **Ask the user** if anything is unclear before proceeding
