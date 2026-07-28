import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RECOVERY_WINDOW_SECONDS,
  emailSchema,
  isRecoveryAllowedPath,
  newPasswordSchema,
  passwordSchema,
  readRecoveryMarker,
  recoveryWindowSeconds,
  RESET_REQUEST_MESSAGE,
  signRecoveryMarker,
} from "./password-reset.ts";
import { PASSWORD_RULES } from "./password-rules.ts";

const SECRET = "test-secret-at-least-32-characters-long!!";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

describe("request response", () => {
  it("says the same thing whether or not the account exists", () => {
    assert.equal(
      RESET_REQUEST_MESSAGE,
      "If an account exists for that email, we’ve sent password reset instructions.",
    );
  });
});

describe("validation", () => {
  it("normalises the email", () => {
    assert.equal(emailSchema.parse(" User@180dc.org "), "user@180dc.org");
  });

  it("rejects a non-email", () => {
    assert.equal(emailSchema.safeParse("not-an-email").success, false);
  });

  it("rejects passwords that miss a rule", () => {
    assert.equal(passwordSchema.safeParse("short").success, false);
    assert.equal(passwordSchema.safeParse("alllowercase123").success, false);
    assert.equal(passwordSchema.safeParse("ALLUPPERCASE123").success, false);
    assert.equal(passwordSchema.safeParse("NoDigitsInHere").success, false);
    assert.equal(passwordSchema.safeParse("A-secure-password-123").success, true);
  });

  // The reset form renders its checklist from PASSWORD_RULES and the schema is
  // built from the same list. These pin the two together: a rule that stops
  // being enforced, or one the checklist shows but nothing checks, fails here.
  it("enforces exactly the rules the checklist shows", () => {
    // Each fails only the rule at the same index, satisfying the other three.
    const failing: Record<string, string> = {
      length: "Ab1",
      lowercase: "A-SECURE-PASSWORD-123",
      uppercase: "a-secure-password-123",
      number: "A-secure-password-abc",
    };

    for (const rule of PASSWORD_RULES) {
      const value = failing[rule.id];
      assert.ok(value, `no fixture for rule ${rule.id}`);
      assert.equal(rule.test(value), false, `${rule.id}.test should fail`);

      const result = passwordSchema.safeParse(value);
      assert.equal(result.success, false, `${rule.id} should be rejected`);
      assert.ok(
        result.error?.issues.some((issue) => issue.message === rule.message),
        `${rule.id} should report its own message`,
      );
    }
  });

  it("reports every unmet rule at once, not just the first", () => {
    const result = passwordSchema.safeParse("abc");
    assert.equal(result.success, false);
    // Too short, no uppercase, no digit — three of the four.
    assert.equal(result.error?.issues.length, 3);
  });

  it("accepts a password meeting every rule", () => {
    assert.equal(passwordSchema.safeParse("A-secure-password-123").success, true);
    for (const rule of PASSWORD_RULES) {
      assert.equal(rule.test("A-secure-password-123"), true, rule.id);
    }
  });

  it("blames the confirmation field when the two do not match", () => {
    const result = newPasswordSchema.safeParse({
      password: "A-secure-password-123",
      confirmPassword: "A-secure-password-124",
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues[0]?.path, ["confirmPassword"]);
  });
});

describe("recovery marker", () => {
  it("round-trips the user it was issued for", async () => {
    const marker = await signRecoveryMarker(USER, SECRET);
    assert.equal(await readRecoveryMarker(marker, SECRET, true), USER);
  });

  // The point of the signature: a session holder must not be able to hand
  // themselves a marker and change a password without the emailed link.
  it("rejects a forged marker", async () => {
    assert.equal(await readRecoveryMarker(USER, SECRET, true), null);
    assert.equal(await readRecoveryMarker(`${USER}.not-a-signature`, SECRET, true), null);
  });

  it("rejects a marker signed for a different user", async () => {
    const marker = await signRecoveryMarker(OTHER_USER, SECRET);
    const swapped = `${USER}.${marker.split(".")[1]}`;
    assert.equal(await readRecoveryMarker(swapped, SECRET, true), null);
  });

  it("rejects a marker signed with a different secret", async () => {
    const marker = await signRecoveryMarker(USER, "a-different-secret-32-chars-long!!!!");
    assert.equal(await readRecoveryMarker(marker, SECRET, true), null);
  });

  it("treats an absent marker as no reset in progress", async () => {
    assert.equal(await readRecoveryMarker(undefined, SECRET, true), null);
    assert.equal(await readRecoveryMarker("", SECRET, true), null);
  });

  // Without a secret there is nothing to verify, so production refuses rather
  // than accept a marker anyone could write. Local work still runs unsigned.
  it("refuses unsigned markers in production but allows them locally", async () => {
    assert.equal(await readRecoveryMarker(USER, null, true), null);
    assert.equal(await readRecoveryMarker(USER, null, false), USER);
  });
});

describe("marker lifetime", () => {
  it("reads a valid window", () => {
    assert.equal(recoveryWindowSeconds({ PASSWORD_RESET_WINDOW_SECONDS: "900" }), 900);
  });

  // A NaN maxAge would silently become a session cookie outliving the window.
  it("falls back rather than emit NaN", () => {
    for (const value of [undefined, "", "abc", "0", "-1"]) {
      assert.equal(
        recoveryWindowSeconds({ PASSWORD_RESET_WINDOW_SECONDS: value }),
        DEFAULT_RECOVERY_WINDOW_SECONDS,
      );
    }
  });
});

describe("recovery confinement", () => {
  it("allows the reset flow and the ways out of it", () => {
    for (const path of [
      "/reset-password",
      "/forgot-password",
      "/login",
      "/auth/confirm",
      "/auth/recovery",
    ]) {
      assert.equal(isRecoveryAllowedPath(path), true, path);
    }
  });

  // The whole point: a reset link must not double as a way into the app.
  it("blocks the rest of the app", () => {
    for (const path of ["/", "/dashboard", "/dashboard/clients", "/api/anything"]) {
      assert.equal(isRecoveryAllowedPath(path), false, path);
    }
  });
});
