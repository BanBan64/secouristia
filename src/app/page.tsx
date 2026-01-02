"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

type SourceFilter = "PSE" | "PSC" | "SST";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

const filterConfig: { value: SourceFilter; label: string; bgColor: string }[] = [
  { value: "PSE", label: "PSE", bgColor: "bg-blue-600" },
  { value: "PSC", label: "PSC", bgColor: "bg-green-600" },
  { value: "SST", label: "SST", bgColor: "bg-orange-500" },
];

// Fonction pour normaliser le texte (supprimer les espaces multiples qui créent des colonnes)
function normalizeText(text: string): string {
  return text
    // Remplacer les tabulations par des espaces
    .replace(/\t/g, ' ')
    // Remplacer 2+ espaces par un seul (mais pas en début de ligne pour les listes)
    .replace(/([^\n]) {2,}/g, '$1 ')
    // Nettoyer les lignes avec uniquement des espaces
    .replace(/^\s+$/gm, '');
}

// Fonction pour transformer le markdown en blocs colorés
function transformMarkdownToBlocks(markdown: string): string {
  // D'abord normaliser le texte
  let result = normalizeText(markdown);

  // Transformer :::do ... ::: en bloc vert
  result = result.replace(
    /:::do\s*\n([\s\S]*?):::/g,
    '<div class="action-block action-block-do"><div class="action-title">✅ À FAIRE</div>\n\n$1</div>'
  );

  // Transformer :::dont ... ::: en bloc rouge
  result = result.replace(
    /:::dont\s*\n([\s\S]*?):::/g,
    '<div class="action-block action-block-dont"><div class="action-title">❌ À NE PAS FAIRE</div>\n\n$1</div>'
  );

  // Transformer :::warning ... ::: en bloc jaune
  result = result.replace(
    /:::warning\s*\n([\s\S]*?):::/g,
    '<div class="action-block action-block-warning"><div class="action-title">⚠️ ATTENTION</div>\n\n$1</div>'
  );

  // Transformer :::info ... ::: en bloc bleu
  result = result.replace(
    /:::info\s*\n([\s\S]*?):::/g,
    '<div class="action-block action-block-info"><div class="action-title">ℹ️ INFORMATIONS</div>\n\n$1</div>'
  );

  return result;
}

// Composant Toggle pour le mode sombre
function DarkModeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`dark-mode-toggle ${isDark ? 'dark-mode-toggle-checked' : 'dark-mode-toggle-unchecked'}`}
      aria-label="Toggle dark mode"
    >
      <span
        className={`dark-mode-toggle-circle ${isDark ? 'translate-x-6' : 'translate-x-1'}`}
      />
      <span className="sr-only">Mode sombre</span>
    </button>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("PSE");
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Initialiser le mode sombre depuis localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("darkMode");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedMode ? savedMode === "true" : prefersDark;
    setIsDarkMode(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Toggle le mode sombre
  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));
    if (newMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setIsLoading(true);
    setError("");

    try {
      // Préparer l'historique pour l'API (sans les sources)
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: userMessage.content,
          sourceFilter,
          conversationHistory,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Une erreur est survenue");
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        sources: data.sources || [],
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setError("");
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pt-8 bg-[var(--bg-secondary)] transition-colors">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header avec logo et toggle mode sombre */}
        <div className="flex justify-end mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-secondary)]">
              {isDarkMode ? "🌙" : "☀️"}
            </span>
            <DarkModeToggle isDark={isDarkMode} onToggle={toggleDarkMode} />
          </div>
        </div>

        {/* Logo et titre */}
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-[var(--text-primary)]">SecouristIA</h1>
          <p className="mt-2 text-lg text-[var(--text-secondary)]">
            Votre assistant IA pour les référentiels de secourisme français
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            PSE1 • PSE2 • PSC • SST
          </p>
        </div>

        {/* Filtres par source */}
        <div className="relative flex justify-center">
          <div className="relative flex rounded-lg bg-[var(--bg-card)] dark:bg-gray-800 p-1 shadow-sm">
            {/* Sliding indicator */}
            <div
              className={`absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out ${
                filterConfig.find(f => f.value === sourceFilter)?.bgColor
              }`}
              style={{
                width: `calc((100% - 8px) / 3)`,
                left: `calc(4px + ${filterConfig.findIndex(f => f.value === sourceFilter)} * (100% - 8px) / 3)`,
              }}
            />
            {/* Buttons */}
            {filterConfig.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSourceFilter(filter.value)}
                className={`relative z-10 px-8 py-3 text-base font-semibold transition-colors duration-300 ${
                  sourceFilter === filter.value
                    ? "text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Formulaire de question */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Posez votre question sur le secourisme..."
              disabled={isLoading}
              className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-6 py-4 pr-14 text-lg text-[var(--text-primary)] shadow-sm transition-all focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-50 placeholder:text-[var(--text-secondary)]"
            />
            <button
              type="submit"
              disabled={!question.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-red-600 p-2 text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600"
            >
              {isLoading ? (
                <svg
                  className="h-6 w-6 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
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

        {/* Bouton nouvelle conversation */}
        {messages.length > 0 && (
          <div className="flex justify-center">
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Nouvelle conversation
            </button>
          </div>
        )}

        {/* Conversation (plus récent en haut) */}
        {messages.length > 0 && (
          <div className="space-y-4">
            {/* Loading en haut */}
            {isLoading && (
              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  SecouristIA réfléchit...
                </div>
              </div>
            )}
            {[...messages].reverse().map((msg, index) => (
              <div key={index} className={`${msg.role === "user" ? "flex justify-end" : ""}`}>
                {msg.role === "user" ? (
                  <div className="max-w-[85%] rounded-xl bg-red-600 px-4 py-3 text-white">
                    {msg.content}
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-6 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                        />
                      </svg>
                      SecouristIA
                    </div>
                    <div className="prose prose-gray dark:prose-invert max-w-none">
                      <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                        {transformMarkdownToBlocks(msg.content)}
                      </ReactMarkdown>
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Sources :</p>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((source) => (
                            <span
                              key={source}
                              className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-xs text-[var(--text-secondary)]"
                            >
                              {source}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Exemples de questions */}
        {messages.length === 0 && !isLoading && (
          <div className="text-center">
            <p className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              Exemples de questions :
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                "Comment réaliser un bilan d'urgence vitale ?",
                "Quelle est la conduite à tenir face à un AVC ?",
                "Comment utiliser un défibrillateur ?",
              ].map((exemple) => (
                <button
                  key={exemple}
                  onClick={() => setQuestion(exemple)}
                  className="rounded-full bg-[var(--bg-card)] dark:bg-gray-800 border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--text-primary)]"
                >
                  {exemple}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
