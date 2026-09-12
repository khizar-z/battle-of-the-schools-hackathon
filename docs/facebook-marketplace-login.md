# Facebook Marketplace login

Facebook Marketplace searches run in a persistent Steel browser profile. Scout
does not receive, store, log, or submit Facebook passwords, cookies, MFA codes,
or checkpoint answers.

## First login

1. Add `STEEL_API_KEY` to `.env` and set `MOCK_AGENTS=false`.
2. Start the server with `pnpm dev:server` and start a search with Facebook
   Marketplace selected.
3. Scout emits a `needs_login` source status with a **Watch live** link.
4. Open that Steel live-session link and complete Facebook's own sign-in and
   any MFA or checkpoint directly in the browser.
5. The agent detects the authenticated session using only the presence of the
   `c_user` and `xs` cookie names, saves Steel's opaque profile ID to
   `data/facebook-marketplace-profile.json`, and resumes the Marketplace
   search automatically.

The profile file is ignored by Git. It contains an opaque Steel profile ID—not
Facebook credentials or cookie values. To provide a managed profile instead,
set `STEEL_FACEBOOK_PROFILE_ID`; this takes precedence over the local file.

## Session settings

`FACEBOOK_LOGIN_TIMEOUT_MS` defaults to 900,000 (15 minutes). It applies to
the interactive Steel session and the corresponding source timeout, giving the
account owner enough time to complete login without blocking other selected
marketplaces.

If Facebook asks for a new checkpoint later, Scout returns to `needs_login` and
surfaces a fresh live-session link. It does not attempt to bypass the check.
