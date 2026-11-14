---
name: file-work
description: Files the work session that is ending, from any repository, as a journal entry on its solution plus the hours on its contract. Drafts Did, Decided, Links and Next from the session's commits, PRs and decisions, always asks how many hours, shows the room first, refuses an answer over it, confirms, then writes. Use at the end of a work session, when the user says /file-work, or when they say to file today's work or hours.
---

# /file-work

**Install:** copy this folder to `~/.claude/skills/file-work/` (or into a repository's `.claude/skills/`). The CRM connector must be connected to Claude Code.

**Name the solution in each client repository**, in its `.claude/CLAUDE.md`:

```markdown
## Gemini CRM

Solution: Guest 360
Client: Alpine Resorts Group
At the end of a work session, run /file-work.
```

Tools below are the connector's own, called by their plain names. Every check lives in the server: a step skipped here still cannot write more than 8 hours on a client in a day, or more than a contract's days. Nothing is written before the user says yes.

## Flow

1. **Find the solution.** Read the `## Gemini CRM` block of `.claude/CLAUDE.md` (the repository root's `CLAUDE.md` too). Without one, ask once which solution this repository belongs to (`list_solutions` gives the names), file under that answer, and offer the block to add; write it only after a yes.

2. **Find the step and the contract.** `get_solution` with the solution and client gives `nowStep` and what pays for it (`paidBy`).
   - `paidBy` a contract: that contract's `id` is the one the hours go on.
   - Otherwise, or with no Now step: `get_client` lists the client's active contracts. Ask which one the hours go on. With none, file the work alone and say that no hours were filed.

3. **Draft the entry** from this session only: today's commits (`git log --since=midnight`), the PRs and branches they name, and the decisions taken in the conversation. Never invent a decision or a link.
   - **Did**: what was done, in one or two sentences.
   - **Decided**: one line per decision. Leave it out when there is none.
   - **Links**: the PRs and commits, as "PR #7".
   - **Next**: the one next thing, if the session named it.

   Show it under "For _Solution_, step N, _step title_:".

4. **Show the room, then ask the hours.** Call `get_hours_left` with `client` and `engagementId` (and no date: today). Say, in these words:
   - "Today on _Client_: nothing yet, 8 h left of 8" (or the hours already logged);
   - "Your 2 h on _Other Client_ today count only on _Other Client_", for each other client with hours today;
   - "Contract: 4.5 days left (36 h)" (an hourly contract in hours; a contract with no days has no line);
   - "_Month_ plan: 1.5 days left (12 h)" (no line without a plan).

   Then ask "How many hours did you put in on _Contract_ today?". The hours are always asked, never guessed from the session, its commits or its length. If `refusal` is set, say why and file the work alone.

5. **Check the answer** against `most` from that reply.
   - Over `most`: refuse with the reason and the most. "9 h is over the 8-hour day on _Client_. At most 8 h today." Name the contract's days instead when `binds` is "contract", and point to the web app's Amend Contract for more days. Ask again.
   - Inside it: confirm. "6 h fits: 6 of 8 today on _Client_, 3.75 days left on the contract. File the entry and the hours?" The month's plan is only a warning: say it if the hours pass it.
   - 0 or "none": confirm filing the entry alone.

6. **On yes, write**, in this order:
   1. `log_work` with `solution`, `client`, `step` (the Now step's number), `did`, `decisions`, `links`, `next` and `source` (the repository's folder name).
   2. `log_time` with `client`, `engagementId`, and `hours` = `day.onThisContract` plus the answer, because `hours` is the day's total on the contract. Add `replace: true` when `day.onThisContract` is above 0.

   Report what each reply said: the step it landed on, the hours, the day and the contract. If `log_time` refuses, say why; the entry is already filed, and say so.

## Rules

- Never call a write tool before the yes, and never with hours the user did not give.
- Never file hours for another person: a collaborator's hours are theirs to file.
- A date other than today is the user's to name; pass it as `date` to both `get_hours_left` and `log_time`.
