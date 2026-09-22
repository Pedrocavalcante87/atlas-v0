// ---------------------------------------------------------------------------
// Marca do Atlas.
//
// O símbolo é um "A" construído com geometria, não uma letra dentro de um
// quadrado colorido (o que havia antes, e que é a solução que todo projeto
// novo usa nos primeiros dias). Três decisões deliberadas:
//
//  - **A travessa ultrapassa as diagonais.** É o que dá assinatura: lê como
//    um "A", mas também como uma base sustentando peso — que é o que o titã
//    Atlas faz, e o que o produto faz com a operação de cobrança de alguém.
//  - **Traço reto, sem ponta arredondada.** Coerente com o resto do sistema
//    (raios curtos, sem sombra): é um produto que mostra dinheiro devido.
//  - **`currentColor`.** O símbolo herda a cor de quem o contém, então serve
//    em fundo claro, escuro ou dentro de um botão sem uma variante para cada.
// ---------------------------------------------------------------------------

interface PropsSimbolo {
  className?: string;
}

export function SimboloAtlas({ className = 'w-5 h-5' }: PropsSimbolo) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      className={className}
      aria-hidden="true"
    >
      {/* Ápice fechado em ponta (miter), pernas bem abertas: em 20px um "A" de
          traço fino some, e o vértice arredondado tira a firmeza que a marca
          precisa ter ao lado de números. */}
      <path d="M4.5 20.5 L12 3.5 L19.5 20.5" />
      {/* A travessa ultrapassa por pouco — 1,5px de cada lado. Na versão
          anterior ela avançava até a borda do quadro e o símbolo lia como um
          "A" cortado (Ⱥ), não como base sustentando peso. Sentada em 14.5,
          perto de onde a travessa de um "A" real fica. */}
      <path d="M6.6 14.5 L17.4 14.5" />
    </svg>
  );
}

interface PropsMarca {
  /** Esconde o nome, deixando só o símbolo (espaços estreitos). */
  apenasSimbolo?: boolean;
  className?: string;
}

export default function Marca({ apenasSimbolo = false, className = '' }: PropsMarca) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SimboloAtlas className="w-5 h-5 shrink-0" />
      {!apenasSimbolo && (
        // Peso 600 e tracking fechado: o wordmark precisa ler como marca, não
        // como um título qualquer da interface. O símbolo em 20px e o texto em
        // 15px dão ao conjunto altura suficiente para ancorar a barra — em
        // 18px/15px a marca competia de igual para igual com os links de
        // navegação e nada liderava.
        <span className="font-semibold text-destaque tracking-[-0.025em] leading-none">
          Atlas
        </span>
      )}
    </span>
  );
}
