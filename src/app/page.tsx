"use client";

import React, { useState, useEffect } from "react";

type SourceFilter = "PSE" | "PSC" | "SST";

interface Fiche {
  ref: string;
  type: "AC" | "FT" | "PR" | "unknown";
  typeName: string;
  title: string;
  date: string;
  level: string;
  content: string;
  source: string;
}

interface SearchResult {
  fiches: Fiche[];
  query?: string;
  message?: string;
}

const filterConfig: { value: SourceFilter; label: string; bgColor: string }[] = [
  { value: "PSE", label: "PSE", bgColor: "bg-blue-600" },
  { value: "PSC", label: "PSC", bgColor: "bg-green-600" },
  { value: "SST", label: "SST", bgColor: "bg-orange-500" },
];

// Configuration des couleurs par type de fiche
const typeColors = {
  AC: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-500",
    badge: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
    icon: "📘",
  },
  FT: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    border: "border-emerald-500",
    badge: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: "🔧",
  },
  PR: {
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-500",
    badge: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
    icon: "📋",
  },
  unknown: {
    bg: "bg-gray-50 dark:bg-gray-800",
    border: "border-gray-400",
    badge: "bg-gray-500",
    text: "text-gray-700 dark:text-gray-300",
    icon: "📄",
  },
};

// Formatter le contenu pour un affichage propre
function formatContent(content: string): React.ReactNode[] {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: string[] = [];
  let listType: "bullet" | "numbered" | null = null;

  const flushList = () => {
    if (currentList.length > 0 && listType) {
      const ListTag = listType === "numbered" ? "ol" : "ul";
      elements.push(
        <ListTag
          key={`list-${elements.length}`}
          className={`my-2 ml-4 space-y-1 ${listType === "numbered" ? "list-decimal" : "list-disc"}`}
        >
          {currentList.map((item, i) => (
            <li key={i} className="text-[var(--text-primary)]">
              {item}
            </li>
          ))}
        </ListTag>
      );
      currentList = [];
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flushList();
      continue;
    }

    // Détection des titres de section
    if (line.match(/^(Définition|Signes|Causes|Risques|Conduite à tenir|Points clés|En présence|Principes|Objectifs)/i)) {
      flushList();
      elements.push(
        <h3 key={`h-${i}`} className="font-bold text-[var(--text-primary)] mt-4 mb-2 text-base border-b border-[var(--border-color)] pb-1">
          {line.replace(/[-–]?\s*$/, "")}
        </h3>
      );
      continue;
    }

    // Détection des listes à puces
    const bulletMatch = line.match(/^[•\-\*○◦▪]\s*(.+)/);
    if (bulletMatch) {
      if (listType !== "bullet") {
        flushList();
        listType = "bullet";
      }
      currentList.push(bulletMatch[1]);
      continue;
    }

    // Détection des listes numérotées
    const numberedMatch = line.match(/^(\d+[.\)°])\s*(.+)/);
    if (numberedMatch) {
      if (listType !== "numbered") {
        flushList();
        listType = "numbered";
      }
      currentList.push(numberedMatch[2]);
      continue;
    }

    // Détection des sous-items (o, -, avec indentation)
    const subItemMatch = line.match(/^o\s+(.+)/);
    if (subItemMatch) {
      if (listType !== "bullet") {
        flushList();
        listType = "bullet";
      }
      currentList.push(subItemMatch[1]);
      continue;
    }

    // Texte normal
    flushList();
    if (line.length > 0) {
      elements.push(
        <p key={`p-${i}`} className="text-[var(--text-primary)] my-2">
          {line}
        </p>
      );
    }
  }

  flushList();
  return elements;
}

// Composant Fiche
function FicheCard({ fiche, isExpanded, onToggle }: { fiche: Fiche; isExpanded: boolean; onToggle: () => void }) {
  const colors = typeColors[fiche.type] || typeColors.unknown;

  return (
    <div className={`rounded-xl border-l-4 ${colors.border} ${colors.bg} shadow-sm overflow-hidden transition-all`}>
      {/* Header de la fiche */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-start justify-between text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${colors.badge} text-white text-xs font-bold px-2 py-0.5 rounded`}>
              {fiche.ref || "REF"}
            </span>
            <span className={`text-xs font-medium ${colors.text}`}>
              {colors.icon} {fiche.typeName}
            </span>
            {fiche.level && (
              <span className="text-xs text-[var(--text-secondary)] bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded">
                {fiche.level}
              </span>
            )}
          </div>
          <h2 className={`font-bold text-lg ${colors.text}`}>
            {fiche.title}
          </h2>
          {fiche.date && (
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Mise à jour : {fiche.date}
            </p>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-[var(--text-secondary)] transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Contenu de la fiche */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-[var(--border-color)]">
          <div className="pt-4 text-sm">
            {formatContent(fiche.content)}
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
            <p className="text-xs text-[var(--text-secondary)]">
              Source : {fiche.source}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Composant Toggle pour le mode sombre
function DarkModeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        isDark ? "bg-blue-600" : "bg-gray-300"
      }`}
      aria-label="Toggle dark mode"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
          isDark ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("PSE");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [expandedFiches, setExpandedFiches] = useState<Set<string>>(new Set());
  const [lastQuestion, setLastQuestion] = useState("");

  // Initialiser le mode sombre
  useEffect(() => {
    const savedMode = localStorage.getItem("darkMode");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedMode ? savedMode === "true" : prefersDark;
    setIsDarkMode(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));
    document.documentElement.classList.toggle("dark", newMode);
  };

  const toggleFiche = (ref: string) => {
    setExpandedFiches((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) {
        next.delete(ref);
      } else {
        next.add(ref);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (result?.fiches) {
      setExpandedFiches(new Set(result.fiches.map((f) => f.ref || f.title)));
    }
  };

  const collapseAll = () => {
    setExpandedFiches(new Set());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsLoading(true);
    setError("");
    setLastQuestion(question);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sourceFilter }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Une erreur est survenue");
      }

      setResult(data);
      // Ouvrir automatiquement la première fiche
      if (data.fiches?.length > 0) {
        setExpandedFiches(new Set([data.fiches[0].ref || data.fiches[0].title]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
    } finally {
      setIsLoading(false);
      setQuestion("");
    }
  };

  const handleNewSearch = () => {
    setResult(null);
    setExpandedFiches(new Set());
    setLastQuestion("");
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pt-8 bg-[var(--bg-secondary)] transition-colors">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-secondary)]">{isDarkMode ? "🌙" : "☀️"}</span>
            <DarkModeToggle isDark={isDarkMode} onToggle={toggleDarkMode} />
          </div>
        </div>

        {/* Logo et titre */}
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-[var(--text-primary)]">SecouristIA</h1>
          <p className="mt-2 text-lg text-[var(--text-secondary)]">
            Recherche dans les référentiels officiels
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">PSE1 • PSE2 • PSC • SST</p>
        </div>

        {/* Filtres */}
        <div className="relative flex justify-center">
          <div className="relative flex rounded-lg bg-[var(--bg-card)] dark:bg-gray-800 p-1 shadow-sm">
            <div
              className={`absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out ${
                filterConfig.find((f) => f.value === sourceFilter)?.bgColor
              }`}
              style={{
                width: `calc((100% - 8px) / 3)`,
                left: `calc(4px + ${filterConfig.findIndex((f) => f.value === sourceFilter)} * (100% - 8px) / 3)`,
              }}
            />
            {filterConfig.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSourceFilter(filter.value)}
                className={`relative z-10 px-8 py-3 text-base font-semibold transition-colors duration-300 ${
                  sourceFilter === filter.value ? "text-white" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Formulaire de recherche */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Rechercher dans les référentiels..."
              disabled={isLoading}
              className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-6 py-4 pr-14 text-lg text-[var(--text-primary)] shadow-sm transition-all focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-50 placeholder:text-[var(--text-secondary)]"
            />
            <button
              type="submit"
              disabled={!question.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-red-600 p-2 text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {isLoading ? (
                <svg className="h-6 w-6 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </button>
          </div>
        </form>

        {/* Erreur */}
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Résultats */}
        {result && (
          <div className="space-y-4">
            {/* Barre d'info */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">
                  Recherche : <span className="font-medium text-[var(--text-primary)]">"{lastQuestion}"</span>
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {result.fiches?.length || 0} fiche(s) trouvée(s)
                </p>
              </div>
              <div className="flex gap-2">
                {result.fiches && result.fiches.length > 1 && (
                  <>
                    <button onClick={expandAll} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      Tout ouvrir
                    </button>
                    <span className="text-[var(--text-secondary)]">•</span>
                    <button onClick={collapseAll} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      Tout fermer
                    </button>
                  </>
                )}
                <span className="text-[var(--text-secondary)]">•</span>
                <button onClick={handleNewSearch} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                  Nouvelle recherche
                </button>
              </div>
            </div>

            {/* Message si aucun résultat */}
            {result.message && !result.fiches?.length && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-amber-700 dark:text-amber-400">
                {result.message}
              </div>
            )}

            {/* Liste des fiches */}
            {result.fiches && result.fiches.length > 0 && (
              <div className="space-y-4">
                {result.fiches.map((fiche, index) => (
                  <FicheCard
                    key={fiche.ref || index}
                    fiche={fiche}
                    isExpanded={expandedFiches.has(fiche.ref || fiche.title)}
                    onToggle={() => toggleFiche(fiche.ref || fiche.title)}
                  />
                ))}
              </div>
            )}

            {/* Légende */}
            <div className="flex flex-wrap gap-4 justify-center pt-4 border-t border-[var(--border-color)]">
              <div className="flex items-center gap-1 text-xs">
                <span className="w-3 h-3 rounded bg-blue-500"></span>
                <span className="text-[var(--text-secondary)]">AC = Connaissance</span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="w-3 h-3 rounded bg-emerald-500"></span>
                <span className="text-[var(--text-secondary)]">FT = Fiche Technique</span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="w-3 h-3 rounded bg-red-500"></span>
                <span className="text-[var(--text-secondary)]">PR = Procédure</span>
              </div>
            </div>
          </div>
        )}

        {/* Exemples de recherche */}
        {!result && !isLoading && (
          <div className="text-center">
            <p className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Exemples de recherche :</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["hémorragie externe", "arrêt cardiaque", "obstruction voies aériennes", "brûlure"].map((exemple) => (
                <button
                  key={exemple}
                  onClick={() => setQuestion(exemple)}
                  className="rounded-full bg-[var(--bg-card)] dark:bg-gray-800 border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {exemple}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 pt-6 border-t border-[var(--border-color)]">
          <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0 mt-0.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>
              <strong className="text-green-600 dark:text-green-400">Extraits officiels :</strong> Les textes affichés sont extraits directement des référentiels PSE, PSC et SST sans modification ni interprétation.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
