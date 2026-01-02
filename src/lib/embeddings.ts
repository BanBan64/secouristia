const HF_API_URL =
  "https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(HF_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Hugging Face API error: ${error}`);
  }

  const result = await response.json();

  // L'API retourne [[...embedding...]] pour feature-extraction
  let embedding: number[];
  if (Array.isArray(result) && Array.isArray(result[0])) {
    if (Array.isArray(result[0][0])) {
      // Format: [[[token1], [token2], ...]] -> moyenne
      const tokens = result[0];
      const dim = tokens[0].length;
      embedding = new Array(dim).fill(0);
      for (const token of tokens) {
        for (let i = 0; i < dim; i++) {
          embedding[i] += token[i];
        }
      }
      for (let i = 0; i < dim; i++) {
        embedding[i] /= tokens.length;
      }
    } else {
      embedding = result[0];
    }
  } else {
    embedding = result;
  }

  return embedding;
}
