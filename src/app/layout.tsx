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

// Título por tela ("Importar planilha · Atlas"). Com o WhatsApp Web aberto
// ao lado, todas as abas do Atlas se chamavam "Atlas — Painel de Cobrança".
// No Next 16 o `template` só vale para segmentos FILHOS: a home, que é deste
// mesmo segmento, declara o título completo (ver app/page.tsx).
export const metadata: Metadata = {
  title: { default: "Atlas", template: "%s · Atlas" },
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
        {/* Primeiro item do Tab: pula a barra superior. Invisível até ganhar foco. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60
                     focus:px-3 focus:py-2 focus:rounded-md focus:bg-superficie focus:text-texto
                     focus:text-corpo focus:font-medium focus:shadow-flutuante"
        >
          Pular para o conteúdo
        </a>
        <NavbarWrapper />
        <div id="conteudo" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </div>
      </body>
    </html>
  );
}
