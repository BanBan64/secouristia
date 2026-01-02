-- Activer l'extension pgvector pour les embeddings
create extension if not exists vector;

-- Supprimer la table si elle existe (pour réinitialiser)
drop table if exists documents;

-- Table pour stocker les chunks de documents
-- Utilise vector(384) pour le modèle BAAI/bge-small-en-v1.5
create table documents (
  id bigserial primary key,
  content text not null,
  source text not null,
  embedding vector(384),
  -- Métadonnées PSE (null pour les documents non-PSE)
  chapter text,                    -- Numéro du chapitre (01-12)
  chapter_name text,               -- Nom du chapitre
  fiche_type text,                 -- Type de fiche (AC, PR, FT)
  fiche_type_name text,            -- Nom du type (Apport de Connaissances, Procédure, Fiche Technique)
  fiche_ref text,                  -- Référence complète (ex: 07PR13)
  pse_level smallint,              -- Niveau PSE (1 ou 2, null si non spécifié)
  update_date text,                -- Date de mise à jour (MM-YYYY)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index sur les métadonnées PSE pour filtrage rapide
create index documents_chapter_idx on documents(chapter);
create index documents_fiche_type_idx on documents(fiche_type);
create index documents_fiche_ref_idx on documents(fiche_ref);
create index documents_pse_level_idx on documents(pse_level);

-- Index pour la recherche de similarité
create index documents_embedding_idx on documents
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

-- Fonction pour rechercher les documents similaires
create or replace function match_documents (
  query_embedding vector(384),
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  source text,
  similarity float,
  -- Métadonnées PSE
  chapter text,
  chapter_name text,
  fiche_type text,
  fiche_type_name text,
  fiche_ref text,
  pse_level smallint
)
language sql stable
as $$
  select
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
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;

-- Fonction pour rechercher par référence de fiche exacte
create or replace function get_fiche_by_ref (
  ref text
)
returns table (
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
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.source,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  from documents
  where documents.fiche_ref = ref;
$$;

-- Fonction pour rechercher toutes les fiches d'un chapitre
create or replace function get_fiches_by_chapter (
  chapter_num text
)
returns table (
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
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.source,
    documents.chapter,
    documents.chapter_name,
    documents.fiche_type,
    documents.fiche_type_name,
    documents.fiche_ref,
    documents.pse_level
  from documents
  where documents.chapter = chapter_num
  order by documents.fiche_ref;
$$;

-- Politique RLS (Row Level Security)
alter table documents enable row level security;

-- Permettre la lecture publique
create policy "Documents are publicly readable"
  on documents for select
  using (true);

-- Permettre l'insertion
create policy "Documents can be inserted"
  on documents for insert
  with check (true);
