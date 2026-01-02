import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/embeddings";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const REFORMULATION_PROMPT = `Tu es un expert en secourisme français. Reformule la question de l'utilisateur en utilisant les termes techniques officiels des référentiels PSE1, PSE2, PSC1 et SST.

Règles :
- Retourne UNIQUEMENT les mots-clés techniques, séparés par des espaces
- Pas de phrase, pas de ponctuation, pas d'explication
- Utilise le vocabulaire exact des référentiels français
- Ajoute les synonymes techniques pertinents

Exemples :
- "étouffement" → "obstruction voies aériennes corps étranger désobstruction"
- "malaise cardiaque" → "douleur thoracique arrêt cardiaque RCP DAE"
- "saignement" → "hémorragie externe compression plaie"
- "brûlure" → "brûlure thermique chimique refroidissement"
- "fracture" → "traumatisme osseux immobilisation attelle"
- "inconscient" → "perte connaissance PLS libération voies aériennes"`;

interface DocumentMatch {
  id: number;
  content: string;
  source: string;
  similarity: number;
  fiche_ref?: string;
}

interface ParsedFiche {
  ref: string;
  type: "AC" | "FT" | "PR" | "unknown";
  typeName: string;
  title: string;
  date: string;
  level: string;
  content: string;
  source: string;
}

// Parser une fiche pour extraire les métadonnées
function parseFiche(doc: DocumentMatch): ParsedFiche {
  const content = doc.content;
  const firstLine = content.split("\n")[0];

  // Format: "[05PR08 / 12-2022] PSE① Hémorragie externe"
  const headerMatch = firstLine.match(/\[([^\]]+)\]\s*(PSE[①②]?|PSC[①]?|SST)?\s*(.+)?/i);

  let ref = doc.fiche_ref || "";
  let date = "";
  let level = "";
  let title = "";

  if (headerMatch) {
    const refPart = headerMatch[1]; // "05PR08 / 12-2022"
    const refMatch = refPart.match(/(\d{2}[A-Z]{2}\d{2})\s*\/?\s*(\d{2}-\d{4})?/);
    if (refMatch) {
      ref = refMatch[1];
      date = refMatch[2] || "";
    }
    level = headerMatch[2] || "";
    title = headerMatch[3]?.trim() || "";
  }

  // Nettoyer le titre (enlever les underscores et numéros de page)
  title = title
    .replace(/_+/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Déterminer le type de fiche
  let type: "AC" | "FT" | "PR" | "unknown" = "unknown";
  let typeName = "Document";

  const typeMatch = ref.match(/\d{2}([A-Z]{2})\d{2}/);
  if (typeMatch) {
    const typeCode = typeMatch[1];
    switch (typeCode) {
      case "AC":
        type = "AC";
        typeName = "Connaissance";
        break;
      case "FT":
        type = "FT";
        typeName = "Fiche Technique";
        break;
      case "PR":
        type = "PR";
        typeName = "Procédure";
        break;
    }
  }

  // Nettoyer le contenu (enlever la première ligne header)
  const lines = content.split("\n");
  const cleanContent = lines.slice(1).join("\n").trim();

  return {
    ref,
    type,
    typeName,
    title: title || "Document",
    date,
    level: level.replace(/[①②]/g, (m) => m === "①" ? "1" : "2"),
    content: cleanContent,
    source: doc.source,
  };
}

// Extraire le titre du document pour vérification de pertinence
function extractDocumentTitle(content: string): string {
  const firstLine = content.split("\n")[0].toLowerCase();
  const match = firstLine.match(/pse[①②]?\s+(.+)/i);
  return match ? match[1].trim() : firstLine;
}

async function reformulateQuery(question: string): Promise<string> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      system: REFORMULATION_PROMPT,
      messages: [{ role: "user", content: question }],
    });

    return message.content[0].type === "text"
      ? message.content[0].text.trim()
      : question;
  } catch (err) {
    console.error("Erreur reformulation:", err);
    return question;
  }
}

async function searchDocuments(query: string, originalQuery: string, sourceFilter?: string): Promise<DocumentMatch[]> {
  try {
    // Extraire les mots-clés
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const originalWords = originalQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const allKeywords = Array.from(new Set([...queryWords, ...originalWords]));

    // 1. RECHERCHE VECTORIELLE
    const embedding = await generateEmbedding(query);
    const { data: vectorResults, error: vectorError } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.20,
      match_count: 10,
    });

    if (vectorError) {
      console.error("Erreur recherche vectorielle:", vectorError);
    }

    // 2. RECHERCHE TEXTUELLE par mots-clés
    const stopWords = ["quoi", "que", "faire", "comment", "quel", "quelle", "est", "sont", "cas", "pour", "dans", "avec", "sans", "lors", "une", "qui", "les", "des", "aux", "tenir", "face", "conduite"];
    const keyWords = originalQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.includes(w));

    let exactResults: DocumentMatch[] = [];
    if (keyWords.length >= 1) {
      let exactQuery = supabase
        .from("documents")
        .select("id, content, source, fiche_ref");

      // Chercher les documents qui contiennent les mots-clés principaux
      for (const word of keyWords.slice(0, 2)) {
        exactQuery = exactQuery.ilike("content", `%${word}%`);
      }

      if (sourceFilter) {
        exactQuery = exactQuery.ilike("source", `%${sourceFilter}%`);
      }

      const { data: exactData } = await exactQuery.limit(10);

      if (exactData) {
        exactResults = exactData.map(doc => {
          const contentLower = doc.content.toLowerCase();
          const matchCount = keyWords.filter(k => contentLower.includes(k)).length;
          return { ...doc, similarity: 0.7 + (matchCount / keyWords.length) * 0.25 };
        });
      }
    }

    // 3. COMBINER ET DÉDUPLIQUER
    const allResults = [...exactResults, ...(vectorResults || [])];
    const seen = new Set<number>();
    let combinedResults: DocumentMatch[] = [];

    const relevanceKeywords = originalQuery.toLowerCase().split(/\s+/).filter(w => w.length > 4);

    for (const doc of allResults) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);

        // Vérifier pertinence par titre
        const docTitle = extractDocumentTitle(doc.content);
        const isOnTopic = relevanceKeywords.some(k => docTitle.includes(k));

        if (!isOnTopic && doc.similarity < 0.9) {
          doc.similarity *= 0.4;
        }

        combinedResults.push(doc);
      }
    }

    // Filtrer par source
    if (sourceFilter) {
      combinedResults = combinedResults.filter(doc =>
        doc.source.toUpperCase().includes(sourceFilter.toUpperCase())
      );
    }

    // Trier et limiter
    combinedResults.sort((a, b) => b.similarity - a.similarity);
    return combinedResults.slice(0, 5);
  } catch (err) {
    console.error("Erreur recherche:", err);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const { question, sourceFilter } = await request.json();

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "La question est requise" },
        { status: 400 }
      );
    }

    // 1. Reformuler la question en termes techniques
    const technicalQuery = await reformulateQuery(question);

    // 2. Rechercher les documents pertinents
    const documents = await searchDocuments(technicalQuery, question, sourceFilter);

    if (documents.length === 0) {
      return NextResponse.json({
        fiches: [],
        message: "Aucun document trouvé pour cette recherche. Essayez avec d'autres termes.",
      });
    }

    // 3. Parser les fiches pour extraction structurée
    const fiches = documents.map(doc => parseFiche(doc));

    // 4. Dédupliquer par référence (garder la première occurrence)
    const seenRefs = new Set<string>();
    const uniqueFiches = fiches.filter(f => {
      if (f.ref && seenRefs.has(f.ref)) return false;
      if (f.ref) seenRefs.add(f.ref);
      return true;
    });

    return NextResponse.json({
      fiches: uniqueFiches,
      query: technicalQuery,
    });
  } catch (error) {
    console.error("Erreur API:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recherche" },
      { status: 500 }
    );
  }
}
