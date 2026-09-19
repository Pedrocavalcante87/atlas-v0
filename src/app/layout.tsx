import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavbarWrapper from "@/components/NavbarWrapper";

// Inter com `variable` e sem pesos fixos: a variável cobre 100–900, então
// hierarquia é feita por peso sem baixar um arquivo por corte. É a escolha
// padrão de produto financeiro por um motivo prático — os algarismos têm
// largura tabular nativa (ver `.numero` em globals.css), que é o que mantém
// uma coluna de valores alinhada e comparável de relance.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-superficie-sutil text-texto">
        <NavbarWrapper />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
