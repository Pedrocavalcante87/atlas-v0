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
      strokeWidth={2.25}
      strokeLinecap="square"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 20 L12 4 L19 20" />
      <path d="M3 15 L21 15" />
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
      <SimboloAtlas className="w-[18px] h-[18px] shrink-0" />
      {!apenasSimbolo && (
        // Tracking apertado e peso semibold: o wordmark precisa ler como marca,
        // não como um título qualquer da interface.
        <span className="font-semibold text-destaque tracking-[-0.02em] leading-none">Atlas</span>
      )}
    </span>
  );
}
