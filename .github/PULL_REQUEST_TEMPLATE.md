<!--
Thanks for sending a PR! Filling this out helps reviewers understand the change quickly.
For typo / one-line fixes, feel free to delete most of this and just describe the change in a sentence.
-->

## Summary

<!-- One or two sentences: what does this change do, and why? -->

## Linked issue

<!-- e.g. "Closes #42" or "Related to #17". For typo / docs / one-liner PRs, this is optional. -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ Feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that changes existing behaviour)
- [ ] 📝 Docs / README update
- [ ] 🧹 Refactor / chore (no functional change)

## How I tested this

<!--
Run `npm run verify` (typecheck, the full vitest suite, and the tree + contracts audits) and say what you added or changed in the tests. Tests live next to the source they cover, as `<name>.test.ts`.
Examples:
- Ingested a sample PDF, queried `@Tusk who is X?` in Discord, confirmed cited answer.
- Loaded the dashboard, switched the provider from Claude to Gemini, confirmed no restart needed.
- Ran `npm run lint` — clean.
-->

## Screenshots / Discord exchange (if UI / bot change)

<!-- Drop a screenshot here if the change is visual. Redact server names / player names. -->

## Checklist

- [ ] My change does one thing (if it does many things, please split it)
- [ ] `npm run lint` (i.e. `tsc --noEmit`) passes locally
- [ ] I updated the README / `.env.example` if I added an LLM provider, file format, or env var
- [ ] No secrets, lore folders, `api-keys.json`, or `.env.local` are in the diff
- [ ] I've read the [CONTRIBUTING](../CONTRIBUTING.md) guide
