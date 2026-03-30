 | Tool | TUI Effect | Key Parameters |
  |---|---|---|
  | `AskUserQuestion` | Interactive option picker with radio/checkbox selection | `questions[]` with `question`, `header`, `options[]` (label, description, markdown), `multiSelect` |
  | `TaskCreate` | Adds item to visible task list | `subject`, `description`, `activeForm` (spinner text) |
  | `TaskUpdate` | Updates task status with spinner/checkmark | `taskId`, `status` (pending/in_progress/completed/deleted), `activeForm`, `addBlocks`, `addBlockedBy` |
  | `TaskList` | Renders full task list summary | (none) |
  | `TaskGet` | Retrieves full task details | `taskId` |
  | `EnterPlanMode` | Switches UI to plan/exploration mode | (none) |
  | `ExitPlanMode` | Exits plan mode, presents plan for approval | `allowedPrompts[]` (tool + prompt pairs) |
  | `EnterWorktree` | Creates isolated git worktree with UI feedback | `name` (optional) |
  | `Skill` | Invokes another skill | `skill`, `args` |