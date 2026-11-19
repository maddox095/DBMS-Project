import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummy = `scrypt$32768$8$3$${"00".repeat(16)}$${"00".repeat(64)}`;

/** @param {string} password */
export function passwordProblem(password) {
  const length = Array.from(password).length;
  return length < 15 ||
    length > 128 ||
    Buffer.byteLength(password, "utf8") > 512
    ? "Use a password between 15 and 128 characters. Spaces and passphrases are welcome."
    : null;
}

/** @param {string} password @param {Buffer} salt @returns {Promise<Buffer>} */
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** @param {string} password */
export async function hashPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** @param {string} password @param {string | null} encoded */
export async function verifyPassword(password, encoded) {
  const valid =
    encoded !== null &&
    /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
  const parts = (valid ? encoded : dummy).split("$");
  const actual = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex")) && valid;
}
