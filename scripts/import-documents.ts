import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse";
import * as fs from "fs";
import * as path from "path";

// Configuration
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
const DOCUMENTS_DIR = path.join(process.cwd(), "documents");

// Pattern pour détecter les fiches PSE : [07PR13 / 09-2019] PSE②
const PSE_FICHE_PATTERN = /\[(\d{2})(AC|PR|FT)(\d+)\s*\/\s*(\d{2})-(\d{4})\]/g;

// Noms des chapitres PSE
const CHAPTER_NAMES: Record<string, string> = {
  "01": "Attitude et comportement",
  "02": "Bilans",
  "03": "Protection et sécurité",
  "04": "Hygiène et asepsie",
  "05": "Urgences vitales",
  "06": "Malaises et affections",
  "07": "Atteintes circonstancielles",
  "08": "Traumatismes",
  "09": "Souffrance psychique",
  "10": "Relevage et brancardage",
  "11": "Situations à nombreuses victimes",
  "12": "Divers",
};

// Types de fiches PSE
const FICHE_TYPES: Record<string, string> = {
  AC: "Apport de Connaissances",
  PR: "Procédure",
  FT: "Fiche Technique",
};

// Interface pour les métadonnées d'une fiche PSE
interface PSEFiche {
  content: string;
  chapter: string;
  chapterName: string;
  ficheType: string;
  ficheTypeName: string;
  ficheRef: string;
  ficheNumber: string;
  updateDate: string;
  pseLevel: number | null;
}

// Utiliser BAAI/bge-small-en-v1.5 qui est optimisé pour les embeddings (384 dim)
const HF_API_URL =
  "https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5";

// Client Supabase
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// Générer l'embedding via Hugging Face API
async function generateEmbedding(text: string): Promise<number[]> {
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
    // Si c'est un tableau de tableaux, moyenne des token embeddings
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
      // Format: [[embedding]]
      embedding = result[0];
    }
  } else {
    embedding = result;
  }

  return embedding;
}

// Découper le texte en chunks avec chevauchement (fallback pour documents non-PSE)
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  const cleanedText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();

  while (start < cleanedText.length) {
    let end = start + CHUNK_SIZE;

    if (end < cleanedText.length) {
      const lastPeriod = cleanedText.lastIndexOf(".", end);
      const lastNewline = cleanedText.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > start + CHUNK_SIZE / 2) {
        end = breakPoint + 1;
      }
    }

    const chunk = cleanedText.slice(start, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

// Détecter le niveau PSE (PSE① ou PSE②) dans le texte
function detectPSELevel(text: string): number | null {
  // Cherche PSE① ou PSE1 ou PSE ①
  if (/PSE\s*[①1]/i.test(text)) return 1;
  // Cherche PSE② ou PSE2 ou PSE ②
  if (/PSE\s*[②2]/i.test(text)) return 2;
  return null;
}

// Découper le texte PSE en fiches complètes avec métadonnées
function splitIntoPSEFiches(text: string): PSEFiche[] {
  const fiches: PSEFiche[] = [];

  // Nettoyer le texte en préservant les sauts de ligne significatifs
  const cleanedText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n") // Limite à 3 sauts de ligne max
    .trim();

  // Trouver toutes les positions des patterns de fiches
  const matches: { index: number; match: RegExpMatchArray }[] = [];
  const regex = new RegExp(PSE_FICHE_PATTERN.source, "g");
  let match;

  while ((match = regex.exec(cleanedText)) !== null) {
    matches.push({ index: match.index, match });
  }

  console.log(`    📋 ${matches.length} fiches PSE détectées`);

  // Extraire chaque fiche avec son contenu complet
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];

    // Le contenu de la fiche va du début du pattern jusqu'au début du suivant
    const startIndex = currentMatch.index;
    const endIndex = nextMatch ? nextMatch.index : cleanedText.length;

    let ficheContent = cleanedText.slice(startIndex, endIndex).trim();

    // Extraire les métadonnées depuis le match
    const [fullMatch, chapter, ficheType, ficheNumber, month, year] = currentMatch.match;
    const ficheRef = `${chapter}${ficheType}${ficheNumber}`;

    // Détecter le niveau PSE dans les 200 premiers caractères de la fiche
    const pseLevel = detectPSELevel(ficheContent.slice(0, 200));

    // Nettoyer le contenu : normaliser les espaces multiples mais garder la structure
    ficheContent = ficheContent
      .replace(/\s{3,}/g, "  ") // Max 2 espaces consécutifs
      .replace(/\n\s*\n\s*\n/g, "\n\n") // Max 2 sauts de ligne
      .trim();

    const fiche: PSEFiche = {
      content: ficheContent,
      chapter,
      chapterName: CHAPTER_NAMES[chapter] || `Chapitre ${chapter}`,
      ficheType,
      ficheTypeName: FICHE_TYPES[ficheType] || ficheType,
      ficheRef,
      ficheNumber,
      updateDate: `${month}-${year}`,
      pseLevel,
    };

    fiches.push(fiche);

    // Log de debug pour les fiches très longues ou très courtes
    if (ficheContent.length > 5000) {
      console.log(`    ⚠️  Fiche [${ficheRef}] très longue: ${ficheContent.length} caractères`);
    } else if (ficheContent.length < 100) {
      console.log(`    ⚠️  Fiche [${ficheRef}] très courte: ${ficheContent.length} caractères`);
    }
  }

  return fiches;
}

// Vérifier si un fichier est un document PSE
function isPSEDocument(fileName: string): boolean {
  return fileName.toLowerCase().includes("pse");
}

// Extraire le texte d'un PDF
async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// Importer un document PSE avec chunking intelligent par fiche
async function importPSEDocument(filePath: string) {
  const fileName = path.basename(filePath);
  console.log(`\n📄 Traitement PSE: ${fileName}`);

  // Extraire le texte
  console.log("  📖 Extraction du texte...");
  const text = await extractTextFromPDF(filePath);
  console.log(`  📝 ${text.length} caractères extraits`);

  // Découper en fiches complètes
  const fiches = splitIntoPSEFiches(text);
  console.log(`  ✂️  ${fiches.length} fiches PSE extraites`);

  // Statistiques par chapitre
  const chaptersStats: Record<string, number> = {};
  for (const fiche of fiches) {
    chaptersStats[fiche.chapter] = (chaptersStats[fiche.chapter] || 0) + 1;
  }
  console.log("  📊 Répartition par chapitre:");
  for (const [ch, count] of Object.entries(chaptersStats).sort()) {
    console.log(`      ${ch}: ${count} fiches (${CHAPTER_NAMES[ch] || "?"})`);
  }

  // Traiter chaque fiche
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < fiches.length; i++) {
    const fiche = fiches[i];

    try {
      // Générer l'embedding via Hugging Face
      const embedding = await generateEmbedding(fiche.content);

      // Insérer dans Supabase avec les métadonnées PSE
      const { error } = await supabase.from("documents").insert({
        content: fiche.content,
        source: fileName,
        embedding,
        // Métadonnées PSE
        chapter: fiche.chapter,
        chapter_name: fiche.chapterName,
        fiche_type: fiche.ficheType,
        fiche_type_name: fiche.ficheTypeName,
        fiche_ref: fiche.ficheRef,
        pse_level: fiche.pseLevel,
        update_date: fiche.updateDate,
      });

      if (error) {
        console.error(`\n  ❌ Erreur fiche [${fiche.ficheRef}]:`, error.message);
        errors++;
      } else {
        imported++;
        process.stdout.write(
          `\r  📤 Import: ${imported}/${fiches.length} [${fiche.ficheRef}]`
        );
      }

      // Délai pour éviter le rate limiting HF
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`\n  ❌ Erreur fiche [${fiche.ficheRef}]:`, err);
      errors++;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(`\n  ✅ ${imported} fiches importées, ${errors} erreurs`);
}

// Importer un document standard (non-PSE) avec chunking classique
async function importStandardDocument(filePath: string) {
  const fileName = path.basename(filePath);
  console.log(`\n📄 Traitement standard: ${fileName}`);

  // Extraire le texte
  console.log("  📖 Extraction du texte...");
  const text = await extractTextFromPDF(filePath);
  console.log(`  📝 ${text.length} caractères extraits`);

  // Découper en chunks classiques
  const chunks = splitIntoChunks(text);
  console.log(`  ✂️  ${chunks.length} chunks créés`);

  // Traiter chaque chunk
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      // Générer l'embedding via Hugging Face
      const embedding = await generateEmbedding(chunk);

      // Insérer dans Supabase
      const { error } = await supabase.from("documents").insert({
        content: chunk,
        source: fileName,
        embedding,
      });

      if (error) {
        console.error(`\n  ❌ Erreur chunk ${i + 1}:`, error.message);
        errors++;
      } else {
        imported++;
        process.stdout.write(`\r  📤 Import: ${imported}/${chunks.length}`);
      }

      // Délai pour éviter le rate limiting HF
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`\n  ❌ Erreur chunk ${i + 1}:`, err);
      errors++;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(`\n  ✅ ${imported} chunks importés, ${errors} erreurs`);
}

// Importer un document (dispatch vers PSE ou standard)
async function importDocument(filePath: string) {
  const fileName = path.basename(filePath);

  if (isPSEDocument(fileName)) {
    await importPSEDocument(filePath);
  } else {
    await importStandardDocument(filePath);
  }
}

// Fonction principale
async function main() {
  console.log("🚀 Démarrage de l'import des documents SecouristIA\n");
  console.log("📡 Utilisation de l'API Hugging Face (BAAI/bge-small-en-v1.5)\n");

  // Récupérer le filtre optionnel depuis les arguments
  const filterArg = process.argv[2]; // ex: "PSE" ou "PSC" ou "SST"

  // Vérifier les variables d'environnement
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error("❌ Variables SUPABASE_URL et SUPABASE_KEY requises");
    process.exit(1);
  }
  if (!process.env.HUGGINGFACE_API_KEY) {
    console.error("❌ Variable HUGGINGFACE_API_KEY requise");
    process.exit(1);
  }

  // Test de l'API avant de commencer
  console.log("🧪 Test de l'API Hugging Face...");
  try {
    const testEmb = await generateEmbedding("test");
    console.log(`✅ API OK - Embedding dimension: ${testEmb.length}\n`);
  } catch (err) {
    console.error("❌ Erreur API:", err);
    process.exit(1);
  }

  // Lister les PDFs
  let files = fs
    .readdirSync(DOCUMENTS_DIR)
    .filter((f) => f.endsWith(".pdf"))
    .map((f) => path.join(DOCUMENTS_DIR, f));

  // Filtrer si un argument est fourni
  if (filterArg) {
    console.log(`🔍 Filtre appliqué: "${filterArg}"\n`);
    files = files.filter((f) =>
      path.basename(f).toLowerCase().includes(filterArg.toLowerCase())
    );
  }

  console.log(`📁 ${files.length} fichiers PDF trouvés:`);
  files.forEach((f) => console.log(`   - ${path.basename(f)}`));

  if (files.length === 0) {
    console.log("\n⚠️  Aucun fichier à importer.");
    return;
  }

  // Importer chaque document
  for (const file of files) {
    await importDocument(file);
  }

  console.log("\n✅ Import terminé!");
}

main().catch(console.error);
