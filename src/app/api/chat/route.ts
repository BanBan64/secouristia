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

const SYSTEM_PROMPT = `Tu es SecouristIA, un assistant spécialisé dans les référentiels de secourisme français. Tu maîtrises parfaitement :

- **PSE1** (Premiers Secours en Équipe de niveau 1) : techniques de base du secourisme en équipe
- **PSE2** (Premiers Secours en Équipe de niveau 2) : techniques avancées et utilisation de matériel spécialisé
- **PSC1** (Prévention et Secours Civiques de niveau 1) : gestes de premiers secours pour le grand public
- **SST** (Sauveteur Secouriste du Travail) : secourisme en milieu professionnel

Tu réponds en te basant UNIQUEMENT sur les extraits de documents fournis dans le contexte.
Si le contexte ne contient pas l'information demandée, dis-le clairement.

## FORMAT DE RÉPONSE OBLIGATOIRE

Tu DOIS utiliser ces blocs spéciaux pour structurer ta réponse de manière visuelle :

### Pour les actions À FAIRE (bloc vert) :
:::do
- Action 1
- Action 2
:::

### Pour les actions À NE PAS FAIRE / INTERDICTIONS (bloc rouge) :
:::dont
- Ne jamais faire X
- Ne pas faire Y
:::

### Pour les points d'ATTENTION / VIGILANCE (bloc jaune) :
:::warning
Information importante ou point de vigilance
:::

### Pour les SIGNES à rechercher ou INFORMATIONS complémentaires (bloc bleu) :
:::info
- Signe 1
- Signe 2
:::

## RÈGLES IMPORTANTES :
1. TOUT le contenu doit être dans des blocs colorés (:::do, :::dont, :::warning, :::info)
2. Seule exception : une phrase d'introduction courte (1-2 lignes max) AVANT les blocs
3. Ordre des blocs : :::dont → :::do → :::warning → :::info
4. Si une information ne rentre pas dans les autres catégories, utilise :::info
5. NE JAMAIS laisser de texte en dehors des blocs (sauf intro)
6. Chaque bloc doit avoir du contenu sous forme de liste (- item)
7. NE PAS mentionner la source à la fin (elle est affichée automatiquement)

Tu réponds en français.`;

interface DocumentMatch {
  id: number;
  content: string;
  source: string;
  similarity: number;
}

async function reformulateQuery(question: string): Promise<string> {
  try {
    console.log("Reformulation de la question...");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      system: REFORMULATION_PROMPT,
      messages: [{ role: "user", content: question }],
    });

    const reformulated = message.content[0].type === "text"
      ? message.content[0].text.trim()
      : question;

    console.log(`Question originale: "${question}"`);
    console.log(`Reformulation: "${reformulated}"`);

    return reformulated;
  } catch (err) {
    console.error("Erreur reformulation:", err);
    return question; // Fallback sur la question originale
  }
}

async function searchDocuments(query: string, originalQuery: string, sourceFilter?: string): Promise<DocumentMatch[]> {
  try {
    console.log("\n=== DEBUG RAG HYBRIDE ===");
    console.log("Query technique:", query);
    console.log("Query originale:", originalQuery);
    console.log("Source filter:", sourceFilter || "all");

    // Extraire les mots-clés des DEUX requêtes
    const allKeywords = [...new Set([
      ...query.toLowerCase().split(/\s+/).filter(w => w.length > 2),
      ...originalQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    ])];

    console.log("Mots-clés combinés:", allKeywords);

    // 1. RECHERCHE VECTORIELLE
    const embedding = await generateEmbedding(query);
    const { data: vectorResults, error: vectorError } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.15, // Seuil bas pour ne pas rater de documents
      match_count: 15,
    });

    if (vectorError) {
      console.error("Erreur recherche vectorielle:", vectorError);
    }
    console.log(`Recherche vectorielle: ${vectorResults?.length || 0} résultats`);

    // 2. RECHERCHE PAR PHRASE EXACTE (priorité maximale)
    // Extraire les phrases clés (enlever les mots interrogatifs courants)
    const stopWords = ["quoi", "que", "faire", "comment", "quel", "quelle", "quels", "quelles", "est", "sont", "cas", "pour", "dans", "avec", "sans", "lors", "une", "qui", "les", "des", "aux"];
    const keyWords = originalQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));

    // Construire la phrase clé à partir des mots significatifs
    const keyPhrase = keyWords.join(" ");
    console.log(`Mots clés extraits: [${keyWords.join(", ")}] -> phrase: "${keyPhrase}"`);

    let exactPhraseResults: DocumentMatch[] = [];
    if (keyWords.length >= 2) {
      // Chercher les documents qui contiennent TOUS les mots-clés
      let exactQuery = supabase
        .from("documents")
        .select("id, content, source");

      // Ajouter un filtre ILIKE pour chaque mot-clé (AND implicite)
      for (const word of keyWords.slice(0, 3)) { // Max 3 mots pour performance
        exactQuery = exactQuery.ilike("content", `%${word}%`);
      }

      if (sourceFilter) {
        exactQuery = exactQuery.ilike("source", `%${sourceFilter}%`);
      }

      const { data: exactData, error: exactError } = await exactQuery.limit(15);

      if (!exactError && exactData) {
        console.log(`Recherche mots-clés [${keyWords.slice(0, 3).join(" + ")}]: ${exactData.length} résultats`);
        exactPhraseResults = exactData.map(doc => {
          const contentLower = doc.content.toLowerCase();
          let score = 0.85;

          // Bonus si contient "en présence" (début de protocole)
          if (contentLower.includes("en présence")) {
            score += 0.12;
            console.log(`  Match protocole "en présence": doc ${doc.id}`);
          }

          return { ...doc, similarity: Math.min(score, 0.99) };
        });
      }
    }

    // 3. RECHERCHE TEXTUELLE par mots-clés
    let textResults: DocumentMatch[] = [];
    const searchTerms = allKeywords.filter(k => k.length > 3);

    if (searchTerms.length > 0) {
      let textQuery = supabase
        .from("documents")
        .select("id, content, source");

      if (sourceFilter) {
        textQuery = textQuery.ilike("source", `%${sourceFilter}%`);
      }

      const orConditions = searchTerms.map(k => `content.ilike.%${k}%`).join(",");

      const { data: textData, error: textError } = await textQuery
        .or(orConditions)
        .limit(20);

      if (!textError && textData) {
        textResults = textData.map(doc => {
          const contentLower = doc.content.toLowerCase();
          const matchCount = allKeywords.filter(k => contentLower.includes(k)).length;
          const score = 0.4 + (matchCount / Math.max(allKeywords.length, 1)) * 0.4;
          return { ...doc, similarity: Math.min(score, 0.8) };
        });
      }
    }
    console.log(`Recherche textuelle: ${textResults.length} résultats`);

    // 4. COMBINER ET DÉDUPLIQUER (phrase exacte en premier!)
    const allResults = [...exactPhraseResults, ...(vectorResults || []), ...textResults];
    const seen = new Set<number>();
    let combinedResults: DocumentMatch[] = [];

    for (const doc of allResults) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        combinedResults.push(doc);
      }
    }

    // Filtrer par source si demandé (pour les résultats vectoriels)
    if (sourceFilter) {
      combinedResults = combinedResults.filter(doc =>
        doc.source.toUpperCase().includes(sourceFilter.toUpperCase())
      );
    }

    // Trier par similarité et prendre les 8 meilleurs (plus de contexte)
    combinedResults.sort((a, b) => b.similarity - a.similarity);
    combinedResults = combinedResults.slice(0, 8);

    console.log(`Résultats combinés: ${combinedResults.length}`);
    if (combinedResults.length > 0) {
      combinedResults.forEach((doc, i) => {
        console.log(`  ${i + 1}. Score: ${doc.similarity.toFixed(3)}, Source: ${doc.source}`);
        console.log(`     Extrait: ${doc.content.substring(0, 80)}...`);
      });
    }
    console.log("=========================\n");

    return combinedResults;
  } catch (err) {
    console.error("Erreur lors de la recherche:", err);
    return [];
  }
}

function buildContextFromDocuments(documents: DocumentMatch[]): string {
  if (documents.length === 0) {
    return "Aucun document pertinent trouvé dans la base de connaissances.";
  }

  const context = documents
    .map(
      (doc, i) =>
        `[Extrait ${i + 1} - Source: ${doc.source}]\n${doc.content}`
    )
    .join("\n\n---\n\n");

  return `Voici les extraits pertinents des référentiels de secourisme :\n\n${context}`;
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

    // 1. Reformuler la question en termes techniques pour la recherche
    const technicalQuery = await reformulateQuery(question);

    // 2. Rechercher avec DEUX requêtes : technique (pour embeddings) + originale (pour texte)
    const documents = await searchDocuments(technicalQuery, question, sourceFilter);

    // Construire le contexte
    const context = buildContextFromDocuments(documents);

    // 3. Construire le message avec la question ORIGINALE (pas reformulée)
    const userMessage = `${context}\n\n---\n\nQuestion de l'utilisateur : ${question}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const response =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Retourner la réponse avec les sources utilisées
    const sources = [...new Set(documents.map((d) => d.source))];

    return NextResponse.json({
      response,
      sources,
    });
  } catch (error) {
    console.error("Erreur API Claude:", error);
    return NextResponse.json(
      { error: "Erreur lors de la communication avec l'assistant" },
      { status: 500 }
    );
  }
}
