import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecouristIA - Assistant Secourisme",
  description: "Chatbot IA spécialisé dans les référentiels de secourisme français (PSE1, PSE2, PSC, SST)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-50">
        {children}
      </body>
    </html>
  );
}
