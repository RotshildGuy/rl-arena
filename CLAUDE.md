# RL Arena: working rules

- Never write the em dash character (U+2014) anywhere in the project: code, comments, UI text, docs, commit messages. Use a short dash `-` instead (with spaces around it where it separates clauses). `npm run sanity` fails if one appears in a tracked file.
- Before every push run `npm run typecheck` and `npm run sanity`.
- The plan of work is `ROADMAP.md`; mark finished tasks with "(בוצע)".
- `firestore.rules` is not in the repo. Any change that needs a new rule documents it in README.md and is listed for the owner to publish.
