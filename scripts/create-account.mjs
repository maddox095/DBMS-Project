import { emitKeypressEvents } from "node:readline";
import { parseArgs } from "node:util";
import { hashPassword, passwordProblem } from "../src/server/auth-password.mjs";
import { mysqlPool } from "../src/server/mysql-pool.mjs";

// Administrator-only provisioning for an existing organization. Never accepts a password argument.
function hiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Run this command in an interactive terminal; password entry is hidden.",
    );
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }
    function onKey(text, key) {
      if (key?.ctrl && key.name === "c") return finish(new Error("Cancelled."));
      if (key?.name === "return" || key?.name === "enter") return finish();
      if (key?.name === "backspace" || key?.name === "delete") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (
        text &&
        !key?.ctrl &&
        !key?.meta &&
        !Array.from(text).some(
          (character) =>
            character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
        )
      ) {
        if (Array.from(value + text).length <= 128) value += text;
      }
    }
    process.stdin.on("keypress", onKey);
  });
}

const database = mysqlPool("admin");
try {
  const { values } = parseArgs({
    options: {
      "organization-id": { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
    },
  });
  const id = values["organization-id"] ?? "";
  const email = (values.email ?? "").trim().toLowerCase();
  const name = (values.name ?? "").trim();
  if (
    !/^[1-9]\d{0,18}$/.test(id) ||
    BigInt(id) > BigInt("9223372036854775807") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !name ||
    Array.from(name).length > 120
  )
    throw new Error(
      'Usage: npm run account:create -- --organization-id 1 --email owner@example.com --name "Full Name"',
    );
  const [organizations] = await database.execute(
    "SELECT id, name, role FROM organizations WHERE id = ?",
    [id],
  );
  if (!organizations[0])
    throw new Error(
      "Organization not found. Use public signup to create a new organization.",
    );
  process.stdout.write(
    `Create a user for ${organizations[0].name} (${organizations[0].role}).\n`,
  );
  const password = await hiddenPassword("New password (15–128 characters): ");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const confirmation = await hiddenPassword("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const passwordHash = await hashPassword(password);
  await database.execute(
    "INSERT INTO auth_users (organization_id, full_name, email, password_hash) VALUES (?, ?, ?, ?)",
    [id, name, email, passwordHash],
  );
  process.stdout.write(
    `Account created for ${email}. Sign in through /login.\n`,
  );
} catch (error) {
  console.error(
    error?.code === "ER_DUP_ENTRY"
      ? "An account already uses this email address."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
