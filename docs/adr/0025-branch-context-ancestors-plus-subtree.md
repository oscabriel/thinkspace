# ADR 0025 — Branch context window: ancestor path + subtree

**Status:** accepted (2026-07-01)
**Amends:** ADR 0016 (branch subtree as the agent context window)

## Context
ADR 0016 defined the dispatched branch's **subtree** as the agent's context window. Typed
literally (`Branch = { rootCommentId }`), a dispatch at a fresh leaf comment yields a
single-comment context: the agent never sees the discussion that led to the dispatch. The
core loop — reply deep in a discussion, dispatch the agent right there — would be
context-blind exactly when context matters most.

## Decision
The context window for a dispatch at comment C is the **ancestor path** (the thread's
top-level comment down to C) **plus the subtree rooted at C**. Ancestor-siblings and other
top-level branches stay excluded — branch isolation is preserved; siblings are precisely the
noise being branched away from.

## Consequences
- `BranchSnapshot` becomes `{ ancestors, branch, subtree }`; `ThreadAgent.loadBranch`
  returns both slices (ancestors oldest-first, subtree = C and its descendants).
- The glossary's **Branch** entry is updated: the dispatch context slice, not the bare
  subtree.
- Prompt assembly orders ancestors before the subtree; context growth is bounded by tree
  depth plus the dispatched sub-discussion, not thread width.
