import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe("server", () => {
  it("reports healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "gehackathon-server" });
  });

  it("returns the initial marketplace catalog", async () => {
    const response = await app.inject({ method: "GET", url: "/sources" });

    expect(response.statusCode).toBe(200);
    expect(response.json().sources).toHaveLength(4);
  });
});

