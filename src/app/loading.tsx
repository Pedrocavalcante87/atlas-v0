import Pagina from '@/components/ui/Pagina';

// ---------------------------------------------------------------------------
// Esqueleto enquanto o servidor monta a tela.
//
// A home e o histórico leem o banco antes de responder (até 8s por leitura,
// ver lib/supabase-io.ts), e sem este arquivo a navegação ficava sem retorno
// visual nenhum: o clique parecia não ter pegado. Genérico de propósito —
// o mesmo esqueleto aparece em qualquer rota, então ele não pode prometer a
// forma de uma tela específica.
// ---------------------------------------------------------------------------

export default function Carregando() {
  return (
    <Pagina>
      <div role="status" className="motion-safe:animate-pulse">
        <span className="sr-only">Carregando…</span>
        <div className="h-5 w-40 rounded-sm bg-superficie-afundada" />
        <div className="h-3.5 w-56 mt-2 rounded-sm bg-superficie-afundada" />
        <div className="mt-6 bg-superficie border border-borda rounded-lg overflow-hidden">
          <div className="h-11 border-b border-borda bg-cabecalho" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 h-12 border-b border-borda last:border-0">
              <div className="h-3.5 w-1/3 rounded-sm bg-superficie-afundada" />
              <div className="h-3.5 w-20 ml-auto rounded-sm bg-superficie-afundada" />
            </div>
          ))}
        </div>
      </div>
    </Pagina>
  );
}
