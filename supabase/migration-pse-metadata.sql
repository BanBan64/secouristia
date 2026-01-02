-- Migration : Ajout des métadonnées PSE à la table documents existante
-- Exécuter cette migration si vous avez déjà des données dans la table

-- Ajouter les nouvelles colonnes si elles n'existent pas
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chapter text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chapter_name text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiche_type text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiche_type_name text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiche_ref text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pse_level smallint;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS update_date text;

-- Créer les index pour le filtrage rapide
CREATE INDEX IF NOT EXISTS documents_chapter_idx ON documents(chapter);
CREATE INDEX IF NOT EXISTS documents_fiche_type_idx ON documents(fiche_type);
CREATE INDEX IF NOT EXISTS documents_fiche_ref_idx ON documents(fiche_ref);
CREATE INDEX IF NOT EXISTS documents_pse_level_idx ON documents(pse_level);

-- Mettre à jour la fonction match_documents pour retourner les métadonnées
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(384),
  match_threshold float default 0.5,
  match_count int default 5
)
RETURNS TABLE (
  id bigint,
  content text,
  source text,
  similarity float,
  chapter text,
  chapter_name text,
  fiche_type text,
  fiche_type_name text,
  fiche_ref text,
  pse_level smallint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.source,
    1 - (documents.embedding <=> query_embedding) as similarity,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  FROM documents
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Fonction pour rechercher par référence de fiche exacte
CREATE OR REPLACE FUNCTION get_fiche_by_ref (ref text)
RETURNS TABLE (
  id bigint,
  content text,
  source text,
  chapter text,
  chapter_name text,
  fiche_type text,
  fiche_type_name text,
  fiche_ref text,
  pse_level smallint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.source,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  FROM documents
  WHERE documents.fiche_ref = ref;
$$;

-- Fonction pour rechercher toutes les fiches d'un chapitre
CREATE OR REPLACE FUNCTION get_fiches_by_chapter (chapter_num text)
RETURNS TABLE (
  id bigint,
  content text,
  source text,
  chapter text,
  chapter_name text,
  fiche_type text,
  fiche_type_name text,
  fiche_ref text,
  pse_level smallint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.source,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  FROM documents
  WHERE documents.chapter = chapter_num
  ORDER BY documents.fiche_ref;
$$;

-- Fonction pour rechercher par type de fiche (AC, PR, FT)
CREATE OR REPLACE FUNCTION get_fiches_by_type (type_code text)
RETURNS TABLE (
  id bigint,
  content text,
  source text,
  chapter text,
  chapter_name text,
  fiche_type text,
  fiche_type_name text,
  fiche_ref text,
  pse_level smallint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.source,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  FROM documents
  WHERE documents.fiche_type = type_code
  ORDER BY documents.chapter, documents.fiche_ref;
$$;
