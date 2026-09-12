import { readFile, writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import Steel from "steel-sdk";
import { chromium } from "playwright";

const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
const PROFILE_FILE = ".facebook-marketplace-profile.json";
const SESSION_TIMEOUT_MS = Number.parseInt(process.env.SESSION_TIMEOUT_MS ?? "900000", 10);

if (!Number.isSafeInteger(SESSION_TIMEOUT_MS) || SESSION_TIMEOUT_MS < 60_000) {
  throw new Error("SESSION_TIMEOUT_MS must be an integer of at least 60000 milliseconds.");
}

async function loadSavedProfileId() {
  if (process.env.STEEL_PROFILE_ID) return process.env.STEEL_PROFILE_ID;

  try {
    const saved = JSON.parse(await readFile(PROFILE_FILE, "utf8"));
    return typeof saved.facebookProfileId === "string" ? saved.facebookProfileId : undefined;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${PROFILE_FILE}: ${error.message}`);
  }
}

async function saveProfileId(profileId) {
  // This is an opaque Steel profile reference, not a Facebook password or cookie.
  await writeFile(PROFILE_FILE, `${JSON.stringify({ facebookProfileId: profileId }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function hasFacebookLogin(context) {
  // Facebook's authenticated browser session normally includes both cookies.
  // Do not print, persist, or send their values anywhere.
  const cookies = await context.cookies(["https://www.facebook.com", "https://m.facebook.com"]);
  const cookieNames = new Set(cookies.map(({ name }) => name));
  return cookieNames.has("c_user") && cookieNames.has("xs");
}

async function openMarketplace(page) {
  await page.goto(FACEBOOK_MARKETPLACE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}

async function main() {
  if (!process.env.STEEL_API_KEY) {
    throw new Error("STEEL_API_KEY is required. Copy .env.example to .env and add a Steel API key.");
  }

  const steel = new Steel({ steelAPIKey: process.env.STEEL_API_KEY });
  const existingProfileId = await loadSavedProfileId();
  const session = await steel.sessions.create({
    ...(existingProfileId ? { profileId: existingProfileId } : {}),
    // Required on both first and later sessions so Facebook auth changes are retained.
    persistProfile: true,
    // The account owner must be able to interact with the live session.
    debugConfig: { interactive: true },
    timeout: SESSION_TIMEOUT_MS,
  });

  if (!session.profileId) {
    throw new Error("Steel did not return a profile ID for this persistent session.");
  }

  let browser;
  const prompt = readline.createInterface({ input, output });

  try {
    const websocketUrl = new URL("wss://connect.steel.dev");
    websocketUrl.searchParams.set("apiKey", process.env.STEEL_API_KEY);
    websocketUrl.searchParams.set("sessionId", session.id);

    browser = await chromium.connectOverCDP(websocketUrl.toString());
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    await openMarketplace(page);

    while (!(await hasFacebookLogin(context))) {
      console.log("\nFacebook needs a manual sign-in.");
      console.log(`Open this Steel live session: ${session.sessionViewerUrl}`);
      console.log("Complete Facebook login and any MFA/checkpoint yourself in that browser.");
      const answer = await prompt.question("Press Enter here to verify login, or type q to quit: ");

      if (answer.trim().toLowerCase() === "q") {
        throw new Error("Login cancelled before Facebook authentication was verified.");
      }

      await openMarketplace(page);
    }

    await saveProfileId(session.profileId);
    console.log("\nFacebook Marketplace login verified.");
    console.log(`Saved the reusable Steel profile ID in ${PROFILE_FILE}.`);
    console.log("The session will now be released so Steel can persist the profile.");
  } finally {
    prompt.close();
    await browser?.close().catch(() => undefined);
    // Releasing is what uploads profile changes, including the user-completed login.
    await steel.sessions.release(session.id).catch((error) => {
      console.error(`Could not release Steel session ${session.id}: ${error.message}`);
    });
  }
}

main().catch((error) => {
  console.error(`Login failed: ${error.message}`);
  process.exitCode = 1;
});
