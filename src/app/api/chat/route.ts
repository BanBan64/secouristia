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
- "saignement" → "hémorragie externe compression plaie pansement compressif garrot"
- "brûlure" → "brûlure thermique chimique refroidissement"
- "fracture" → "traumatisme osseux immobilisation attelle"
- "inconscient" → "perte connaissance PLS libération voies aériennes"`;

const SYSTEM_PROMPT = `Tu es SecouristIA, un assistant spécialisé dans les référentiels de secourisme français (PSE1, PSE2, PSC1, SST).

## RÈGLE ABSOLUE - ZÉRO HALLUCINATION

⚠️ Tu ne dois JAMAIS inventer, ajouter ou déduire des informations qui ne sont PAS EXPLICITEMENT écrites dans le contexte fourni.

INTERDIT :
- Ajouter des techniques non mentionnées (ex: "points de compression" si non dans le contexte)
- Interpréter ou extrapoler au-delà du texte exact
- Utiliser tes connaissances générales sur le secourisme
- Dire "il est recommandé de..." si ce n'est pas écrit mot pour mot

OBLIGATOIRE :
- Citer UNIQUEMENT ce qui est écrit dans les extraits fournis
- Si une info manque, dire "Cette information n'apparaît pas dans les extraits consultés"
- Reformuler pour clarifier, mais JAMAIS ajouter de contenu

## FORMAT DE RÉPONSE

Utilise ces blocs pour structurer visuellement :

### Actions À FAIRE (bloc vert) :
:::do
- Action 1 (telle qu'écrite dans le référentiel)
- Action 2
:::

### Actions À NE PAS FAIRE (bloc rouge) :
:::dont
- Interdit 1 (si mentionné dans le contexte)
:::

### Points d'ATTENTION (bloc jaune) :
:::warning
Point de vigilance mentionné dans le référentiel
:::

### INFORMATIONS complémentaires (bloc bleu) :
:::info
- Information additionnelle du contexte
:::

## RÈGLES DE FORMAT :
1. Commence par une phrase d'introduction courte (1-2 lignes)
2. Utilise les blocs colorés pour le contenu principal
3. Ordre recommandé : :::do → :::dont → :::warning → :::info
4. Chaque bloc contient une liste (- item)
5. NE PAS mentionner les sources (affichées automatiquement)

Tu réponds en français, de manière claire et structurée.`;

interface DocumentMatch {
  id: number;
  content: string;
  source: string;
  similarity: number;
  fiche_ref?: string;
}

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
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const originalWords = originalQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const allKeywords = Array.from(new Set([...queryWords, ...originalWords]));

    // 1. RECHERCHE VECTORIELLE
    const embedding = await generateEmbedding(query);
    const { data: vectorResults, error: vectorError } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.18,
      match_count: 12,
    });

    if (vectorError) {
      console.error("Erreur recherche vectorielle:", vectorError);
    }

    // 2. RECHERCHE TEXTUELLE
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
          return { ...doc, similarity: 0.75 + (matchCount / keyWords.length) * 0.2 };
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

        const docTitle = extractDocumentTitle(doc.content);
        const isOnTopic = relevanceKeywords.some(k => docTitle.includes(k));

        if (!isOnTopic && doc.similarity < 0.9) {
          doc.similarity *= 0.4;
        }

        combinedResults.push(doc);
      }
    }

    if (sourceFilter) {
      combinedResults = combinedResults.filter(doc =>
        doc.source.toUpperCase().includes(sourceFilter.toUpperCase())
      );
    }

    combinedResults.sort((a, b) => b.similarity - a.similarity);
    return combinedResults.slice(0, 6);
  } catch (err) {
    console.error("Erreur recherche:", err);
    return [];
  }
}

function buildContextFromDocuments(documents: DocumentMatch[]): string {
  if (documents.length === 0) {
    return "Aucun document pertinent trouvé dans la base de connaissances.";
  }

  const context = documents
    .map((doc, i) => {
      const ficheRef = doc.fiche_ref ? `[${doc.fiche_ref}]` : "";
      return `[Extrait ${i + 1} ${ficheRef} - ${doc.source}]\n${doc.content}`;
    })
    .join("\n\n---\n\n");

  return `Voici les extraits des référentiels de secourisme. UTILISE UNIQUEMENT ces informations pour répondre :\n\n${context}`;
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

    // 1. Reformuler la question
    const technicalQuery = await reformulateQuery(question);

    // 2. Rechercher les documents
    const documents = await searchDocuments(technicalQuery, question, sourceFilter);

    // 3. Construire le contexte
    const context = buildContextFromDocuments(documents);

    // 4. Générer la réponse avec Claude
    const userMessage = `${context}\n\n---\n\nQuestion : ${question}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const response = message.content[0].type === "text" ? message.content[0].text : "";

    // 5. Extraire les références
    const sources = Array.from(new Set(documents.map(d => d.source)));
    const ficheRefs = Array.from(new Set(documents.map(d => d.fiche_ref).filter(Boolean))) as string[];

    return NextResponse.json({
      response,
      sources,
      ficheRefs,
    });
  } catch (error) {
    console.error("Erreur API:", error);
    return NextResponse.json(
      { error: "Erreur lors de la communication avec l'assistant" },
      { status: 500 }
    );
  }
}
