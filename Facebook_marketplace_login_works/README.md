# Steel + Facebook Marketplace login reference

This is a deliberately small, human-in-the-loop reference program. It creates a Steel browser, opens Facebook Marketplace, and prints a live-session URL. The account owner completes Facebook login, MFA, or checkpoints in that visible browser. The program then verifies that an authenticated Facebook browser session exists and saves the Steel profile ID for reuse.

It does **not** store a Facebook password, cookie values, or MFA secrets. It does not try to bypass Facebook checks.

## Requirements

- Node.js 20 or newer
- A Steel account and API key

## Run it

```bash
npm install
cp .env.example .env
```

Add the API key to `.env`, then load it into your shell and run the program:

```bash
set -a
source .env
set +a
npm run login
```

The terminal prints a Steel live-session URL. Open it, sign in to Facebook and complete any verification, then return to the terminal and press Enter. On success, `.facebook-marketplace-profile.json` is created locally with an opaque Steel profile ID.

Run `npm run login` again to confirm that Marketplace opens with the saved profile. Do not commit `.env` or `.facebook-marketplace-profile.json`.

## How it works

1. The first run creates a Steel session with `persistProfile: true`.
2. The user authenticates through `sessionViewerUrl`; Facebook credentials never pass through this program.
3. The script checks only for the presence of Facebook's authenticated-session cookie *names* (`c_user` and `xs`) and never logs their values.
4. Releasing the Steel session persists browser state to the profile.
5. Later runs start a session with the saved `profileId`, reusing the authenticated browser state.

For a product, store the profile ID server-side per application user, use a profile only for that user's Facebook account, and surface a fresh live-session link if Facebook later requests a checkpoint. A stable Steel dedicated IP alongside the profile can reduce location/device challenges.
