import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  applyForfeitCooldowns, checkForfeitCooldown,
  voidForfeitCooldown, getActiveForfeitCooldowns,
} from "../lib/forfeit";
import { cleanup, TEST_GUILD, USERS } from "./helpers";

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("applyForfeitCooldowns", () => {
  test("creates unavoidable for forfeiter and voidable for other", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test forfeit");

    const p1cd = await checkForfeitCooldown(TEST_GUILD, USERS.p1);
    const p2cd = await checkForfeitCooldown(TEST_GUILD, USERS.p2);

    expect(p1cd).not.toBeNull();
    expect(p1cd?.type).toBe("unavoidable");
    expect(p1cd?.remaining).toBeGreaterThan(0);

    expect(p2cd).not.toBeNull();
    expect(p2cd?.type).toBe("voidable");
  });
});

describe("checkForfeitCooldown", () => {
  test("returns active cooldown with remaining time", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test");

    const cd = await checkForfeitCooldown(TEST_GUILD, USERS.p1);
    expect(cd).not.toBeNull();
    expect(cd!.remaining).toBeGreaterThan(86000); // ~24hrs
    expect(cd!.reason).toBe("Test");
  });

  test("returns null for user with no cooldown", async () => {
    const cd = await checkForfeitCooldown(TEST_GUILD, USERS.p3);
    expect(cd).toBeNull();
  });
});

describe("voidForfeitCooldown", () => {
  test("voidable CD can be voided", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test");

    const result = await voidForfeitCooldown(TEST_GUILD, USERS.p2, USERS.p2);
    expect(result).toBe(true);

    const cd = await checkForfeitCooldown(TEST_GUILD, USERS.p2);
    expect(cd).toBeNull();
  });

  test("unavoidable CD cannot be voided", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test");

    const result = await voidForfeitCooldown(TEST_GUILD, USERS.p1, USERS.p1);
    expect(result).toBe(false);

    const cd = await checkForfeitCooldown(TEST_GUILD, USERS.p1);
    expect(cd).not.toBeNull();
  });

  test("self-cancel voidable works", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test");

    // p2 self-cancels
    const result = await voidForfeitCooldown(TEST_GUILD, USERS.p2, USERS.p2);
    expect(result).toBe(true);

    const cd = await checkForfeitCooldown(TEST_GUILD, USERS.p2);
    expect(cd).toBeNull();
  });
});

describe("getActiveForfeitCooldowns", () => {
  test("returns all active CDs for guild", async () => {
    await applyForfeitCooldowns(TEST_GUILD, USERS.p1, USERS.p2, "Test1");
    await applyForfeitCooldowns(TEST_GUILD, USERS.p3, USERS.p4, "Test2");

    const all = await getActiveForfeitCooldowns(TEST_GUILD);
    expect(all.length).toBe(4); // 2 per forfeit

    const p1Only = await getActiveForfeitCooldowns(TEST_GUILD, USERS.p1);
    expect(p1Only.length).toBe(1);
  });
});
