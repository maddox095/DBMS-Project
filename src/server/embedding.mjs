import { pipeline } from "@huggingface/transformers";

const model = "Xenova/all-MiniLM-L6-v2";
const revision = "751bff37182d3f1213fa05d7196b954e230abad9";
let extractor;

/** @param {string} text */
export async function embedText(text) {
  extractor ??= pipeline("feature-extraction", model, {
    revision,
    dtype: "q8",
    device: "cpu",
  }).catch((error) => {
    extractor = undefined;
    throw error;
  });

  const embed = await extractor;
  const result = await embed(text, { pooling: "mean", normalize: true });
  const values = Array.from(result.data);
  if (
    values.length !== 384 ||
    !values.every(Number.isFinite) ||
    !values.some((value) => value !== 0)
  ) {
    throw new Error(
      "The embedding model did not return a usable 384-dimensional vector.",
    );
  }
  return JSON.stringify(values);
}
