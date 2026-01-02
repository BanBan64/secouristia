import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function main() {
  // Chercher spécifiquement le contenu avec "65 ans" et "haut risque"
  const { data, error } = await supabase
    .from("documents")
    .select("id, content, fiche_ref")
    .ilike("content", "%65 ans%")
    .limit(10);

  if (error) {
    console.error("Erreur:", error);
    return;
  }

  console.log("Documents contenant '65 ans': " + (data ? data.length : 0) + "\n");

  if (data) {
    data.forEach((doc, i) => {
      console.log("=== Doc " + (i + 1) + " (ID: " + doc.id + ", Ref: " + (doc.fiche_ref || "N/A") + ") ===");
      // Trouver et afficher le contexte autour de "65 ans"
      const idx = doc.content.toLowerCase().indexOf("65 ans");
      if (idx >= 0) {
        const start = Math.max(0, idx - 200);
        const end = Math.min(doc.content.length, idx + 300);
        console.log("..." + doc.content.substring(start, end) + "...");
      }
      console.log("\n");
    });
  }
}

main();
