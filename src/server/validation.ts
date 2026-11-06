import { invalidInput } from "./http";

const maxId = BigInt("9223372036854775807");
const idPattern = /^[1-9][0-9]{0,18}$/;
const quantityPattern = /^(?:0|[1-9][0-9]{0,10})\.[0-9]{3}$/;

export function isId(value: unknown): value is string {
  return (
    typeof value === "string" && idPattern.test(value) && BigInt(value) <= maxId
  );
}

export function readId(value: unknown, field: string) {
  if (!isId(value))
    throw invalidInput(`${field} must be a positive ID string.`);
  return value;
}

export function quantityUnits(value: string) {
  return BigInt(value.replace(".", ""));
}

export function readQuantity(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !quantityPattern.test(value) ||
    value === "0.000"
  ) {
    throw invalidInput(
      `${field} must be a positive decimal string with three fractional digits.`,
    );
  }
  return value;
}

export function readText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string")
    throw invalidInput(`${field} must be a string.`);
  const text = value.trim();
  if (!text || Array.from(text).length > maxLength) {
    throw invalidInput(
      `${field} must have between 1 and ${maxLength} characters.`,
    );
  }
  return text;
}
