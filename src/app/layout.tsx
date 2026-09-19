import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import NavbarWrapper from "@/components/NavbarWrapper";

// Inter com `variable` e sem pesos fixos: a variável cobre 100–900, então a
// hierarquia é feita por peso sem baixar um arquivo por corte.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// IBM Plex Mono carrega o dinheiro (ver `.numero` em globals.css). Escolhida
// entre as monoespaçadas por ser desenhada para interface e não para editor:
// tem altura-x generosa, algarismos que não se confundem (0 cortado, 1 com
// base, 7 sem travessão ambíguo) e um caráter levemente humanista que combina
// com a Inter em vez de brigar. Só dois pesos — a mono aqui não faz hierarquia,
// faz identidade.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas — Painel de Cobrança",
  description: "Lista priorizada de cobrança para pequenos negócios",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-superficie-sutil text-texto">
        <NavbarWrapper />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
