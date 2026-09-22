// ---------------------------------------------------------------------------
// Ícones de ação do sistema.
//
// Todos partem do mesmo grid de 16, mesma espessura (1.6) e mesmas terminações
// arredondadas — é o que faz um conjunto parecer um conjunto e não uma coleção
// de símbolos avulsos. Herdam `currentColor`, então quem os usa decide a cor
// pelo estado, não por variante do ícone.
//
// Nenhum ícone aqui aparece sozinho: em ação destrutiva ou financeira, ícone
// sem rótulo acessível é adivinhação. Quem usa passa `aria-label` no botão.
// ---------------------------------------------------------------------------

interface PropsIcone {
  className?: string;
}

const BASE = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** WhatsApp — a ação principal do produto. Glifo oficial simplificado ao grid. */
export function IconeWhatsApp({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.6 13.4l.8-2.7a5.6 5.6 0 1 1 2.1 2l-2.9.7z" />
      <path d="M6.1 6.2c.2.7.6 1.4 1.1 1.9.5.5 1.2.9 1.9 1.1l.7-.8 1.4.6-.2 1.1c-1 .2-2.3-.3-3.4-1.4C6.5 7.6 6 6.3 6.2 5.3l1.1-.2.6 1.4-.8.7z" />
    </svg>
  );
}

/** Telefone — abre o discador com `tel:`. */
export function IconeTelefone({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <path d="M5.2 2.8H3.4c-.6 0-1 .5-1 1.1a10 10 0 0 0 9.5 9.5c.6 0 1.1-.4 1.1-1v-1.8l-2.6-.9-1.1 1.4a8.2 8.2 0 0 1-3.5-3.5l1.4-1.1z" />
    </svg>
  );
}

/** Marcar como pago. Círculo fechado + verificação: conclusão, não "ok". */
export function IconePago({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M5.6 8.2l1.7 1.7 3.1-3.6" />
    </svg>
  );
}

/** Calendário — registrar promessa de pagamento. */
export function IconePromessa({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.4" />
      <path d="M2.4 6.4h11.2M5.6 2.2v2M10.4 2.2v2" />
    </svg>
  );
}

/** Sem resposta — silenciar temporariamente. */
export function IconeSemResposta({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M5.4 8h5.2" />
    </svg>
  );
}

/** Divisa de expansão. Gira 90° quando a linha abre (transição no consumidor). */
export function IconeDivisa({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <path d="M6.2 3.8L10.4 8l-4.2 4.2" />
    </svg>
  );
}

/** Seta de importação, usada na barra superior. */
export function IconeImportar({ className = 'w-4 h-4' }: PropsIcone) {
  return (
    <svg {...BASE} className={className}>
      <path d="M8 3.5v7M4.5 7L8 3.5 11.5 7M3 12.5h10" />
    </svg>
  );
}
