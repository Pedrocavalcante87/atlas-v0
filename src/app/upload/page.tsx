'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatarMoeda as moeda } from '@/lib/format';
import { chamarApi, mensagemDeFalha, type FalhaDeResposta } from '@/lib/resposta-http';

interface BreakdownGroup {
  count: number;
  valor: number;
}

interface LinhaIgnorada {
  linha: number;
  nome: string;
  motivo: string;
}

interface LinhaValida {
  linha: number;
  nome: string;
  telefone: string;
  valor: number;
  dataVencimento: string;
}

interface PreviewResult {
  message: string;
  totalLinhas: number;
  count: number;
  duplicatas: number;
  errors: string[];
  linhasIgnoradas: LinhaIgnorada[];
  colunasDetectadas: Record<string, string>;
  separadorDetectado: string;
  breakdown: {
    vencidos: BreakdownGroup;
    preventivos: BreakdownGroup;
    futuros: BreakdownGroup;
  };
  totalValor: number;
  linhasValidas: LinhaValida[];
}

interface ConfirmResult {
  /** completo = tudo gravado; parcial = algo foi recusado; indisponivel = o banco não respondeu. */
  resultado: 'completo' | 'parcial' | 'indisponivel';
  count: number;
  duplicatas: number;
  naoGravadas: number;
  errors: string[];
  message: string;
}

interface FilePreview {
  linhas: number;
  separador: string;
}

/** O 503 da confirmação traz o relatório do que chegou a ser gravado. */
function ehRelatorio(dados: unknown): dados is ConfirmResult {
  return (
    dados !== null &&
    typeof dados === 'object' &&
    typeof (dados as { resultado?: unknown }).resultado === 'string'
  );
}

// A confirmação GRAVA, então cada falha precisa dizer o que pode ter
// acontecido com o banco — "tente de novo" sem isso convida a importar duas
// vezes sem saber se a primeira entrou (é seguro, mas o usuário não sabe).
function textoFalhaConfirmacao(falha: FalhaDeResposta): string {
  switch (falha.tipo) {
    case 'sessao_expirada':
      // O proxy barrou a requisição antes da rota: nada foi gravado.
      return 'Sua sessão expirou antes da confirmação. Nada foi gravado: entre de novo e importe o arquivo outra vez.';
    case 'sem_conexao':
      return (
        'Não foi possível falar com o servidor, e não há como saber se a importação chegou a começar. ' +
        'Confira a lista do dia; importar o mesmo arquivo de novo é seguro, porque o que já entrou é reconhecido como duplicata.'
      );
    case 'invalida':
      return (
        `${mensagemDeFalha(falha, '')} Confira a lista do dia antes de tentar de novo; ` +
        'importar o mesmo arquivo outra vez não duplica títulos.'
      );
    case 'erro':
      return mensagemDeFalha(falha, 'Erro ao confirmar importação.');
  }
}

function analisarCSVLocal(text: string): FilePreview {
  const primeiraLinha = text.split('\n')[0] ?? '';
  const separador = primeiraLinha.includes(';')
    ? 'ponto e virgula (;)'
    : primeiraLinha.includes('\t')
    ? 'tab'
    : 'virgula (,)';
  const linhas = Math.max(0, text.trim().split('\n').filter((l) => l.trim()).length - 1);
  return { linhas, separador };
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFileSelect(selectedFile: File) {
    setFile(selectedFile);
    setResult(null);
    setConfirmResult(null);
    setError('');
    setSessaoExpirada(false);
    // A leitura local é só uma prévia informativa; se o navegador não
    // conseguir ler o arquivo, a análise no servidor ainda decide.
    try {
      setPreview(analisarCSVLocal(await selectedFile.text()));
    } catch {
      setPreview(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError('');
    setSessaoExpirada(false);
    setResult(null);
    setConfirmResult(null);

    const formData = new FormData();
    formData.append('file', file);

    // Antes: `await res.json()` sem tratamento. Sem sessão, a resposta é um
    // 404 em texto puro (ver lib/resposta-http.ts), o parse lançava e o botão
    // ficava em "Analisando..." para sempre. A análise nunca grava nada, então
    // qualquer falha aqui é segura de repetir.
    const leitura = await chamarApi<PreviewResult>('/api/upload-csv', { method: 'POST', body: formData });

    if (leitura.tipo === 'ok') {
      setResult(leitura.dados);
    } else {
      setError(mensagemDeFalha(leitura, 'Não foi possível analisar o arquivo.'));
      setSessaoExpirada(leitura.tipo === 'sessao_expirada');
    }
    setLoading(false);
  }

  async function handleConfirmar() {
    if (!result) return;
    setConfirmando(true);
    setError('');
    setSessaoExpirada(false);

    const leitura = await chamarApi<ConfirmResult>('/api/upload-csv/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linhas: result.linhasValidas }),
    });

    // 503 com `resultado` é indisponibilidade da dependência, não CSV inválido:
    // o relatório existe e pode até ter linhas gravadas antes da queda, então
    // vai para a tela de resultado (em vermelho), não para o erro de formulário.
    if (leitura.tipo === 'ok') {
      setConfirmResult(leitura.dados);
    } else if (leitura.tipo === 'erro' && ehRelatorio(leitura.dados)) {
      setConfirmResult(leitura.dados);
    } else {
      // Este erro aparece NA PRÉVIA. Antes ele ia para um aviso que só existia
      // no formulário inicial: o usuário clicava em confirmar e nada acontecia.
      setError(textoFalhaConfirmacao(leitura));
      setSessaoExpirada(leitura.tipo === 'sessao_expirada');
    }
    setConfirmando(false);
  }

  function reiniciar() {
    setResult(null);
    setConfirmResult(null);
    setError('');
    setSessaoExpirada(false);
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <div className="mb-1">
          <Link href="/" className="text-texto-fraco hover:text-texto-suave text-base transition-colors">
            &larr; Lista do dia
          </Link>
        </div>
        <h2 className="text-cifra font-bold text-texto">Importar planilha</h2>
        <p className="text-base text-texto-suave mt-0.5">Suba um CSV para adicionar titulos a lista de cobranca</p>
      </div>

      {confirmResult ? (
        <ConfirmedReport result={confirmResult} onNovo={reiniciar} onVerLista={() => router.push('/')} />
      ) : result ? (
        <PreviewReport
          result={result}
          erro={error}
          sessaoExpirada={sessaoExpirada}
          confirmando={confirmando}
          onConfirmar={handleConfirmar}
          onCancelar={reiniciar}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3 bg-superficie border border-borda rounded-lg p-6 ">
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block cursor-pointer">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
                <div
                  className={`border-2 border-dashed rounded-md p-8 text-center transition-all ${
                    file
                      ? 'border-marca-500 bg-marca-50'
                      : 'border-borda hover:border-tinta-400 hover:bg-superficie-sutil'
                  }`}
                >
                  {file ? (
                    <>
                      <div className="w-10 h-10 bg-marca-100 rounded-md flex items-center justify-center mx-auto mb-2">
                        <span className="text-cifra">&#128196;</span>
                      </div>
                      <p className="text-marca-800 font-semibold text-base">{file.name}</p>
                      <p className="text-marca-500 text-legenda mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                      <button
                        type="button"
                        className="text-legenda text-texto-fraco mt-2 hover:text-texto-suave underline transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          setFile(null);
                          setPreview(null);
                          if (inputRef.current) inputRef.current.value = '';
                        }}
                      >
                        trocar arquivo
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 bg-superficie-afundada rounded-md flex items-center justify-center mx-auto mb-2">
                        <span className="text-cifra">&#128193;</span>
                      </div>
                      <p className="text-texto-suave text-base font-medium">Clique para selecionar o arquivo</p>
                      <p className="text-texto-fraco text-legenda mt-0.5">Somente .csv</p>
                    </>
                  )}
                </div>
              </label>

              {preview && (
                <div className="bg-marca-50 border border-marca-200 rounded-md p-3.5 flex items-start gap-2.5 text-base">
                  <span className="shrink-0 mt-0.5">&#128269;</span>
                  <div>
                    <p className="text-marca-800 font-semibold">
                      {preview.linhas} {preview.linhas !== 1 ? 'linhas detectadas' : 'linha detectada'}
                    </p>
                    <p className="text-marca-700 text-legenda mt-0.5">
                      Separador: {preview.separador} &middot; Clique em &quot;Analisar&quot; pra ver a prévia
                    </p>
                  </div>
                </div>
              )}

              {error && <ErroNaTela erro={error} sessaoExpirada={sessaoExpirada} />}

              <button
                type="submit"
                disabled={!file || loading}
                className="w-full bg-marca-700 hover:bg-marca-800 text-white font-semibold py-3 rounded-md disabled:opacity-40 transition-colors "
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analisando...
                  </span>
                ) : 'Analisar planilha'}
              </button>
              <p className="text-legenda text-texto-fraco text-center">
                Isso só analisa o arquivo. Nada é gravado até você confirmar na próxima tela.
              </p>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <div className="bg-superficie border border-borda rounded-lg p-4 ">
              <p className="text-legenda font-semibold text-texto-suave uppercase tracking-wide mb-3">Colunas esperadas</p>
              <div className="space-y-2">
                {[
                  { col: 'nome', desc: 'Nome do cliente' },
                  { col: 'telefone', desc: 'Com ou sem mascara' },
                  { col: 'valor', desc: 'Ex: 1500.00 ou R$ 1.500,00' },
                  { col: 'data_vencimento', desc: 'DD/MM/AAAA ou AAAA-MM-DD' },
                ].map(({ col, desc }) => (
                  <div key={col} className="flex items-start gap-2">
                    <code className="text-legenda bg-superficie-afundada text-texto px-1.5 py-0.5 rounded font-mono whitespace-nowrap">{col}</code>
                    <span className="text-legenda text-texto-fraco">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-legenda text-texto-fraco mt-3 leading-relaxed">
                O sistema detecta automaticamente variações de nomes como{' '}
                <span className="font-mono">CLIENTE</span>,{' '}
                <span className="font-mono">CELULAR</span>,{' '}
                <span className="font-mono">VL_TOTAL</span>,{' '}
                <span className="font-mono">VENCTO</span> e mais de 60 outros aliases.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Prévia — mostra o que SERIA importado, mas ainda não gravou nada.
// ---------------------------------------------------------------------------
function ErroNaTela({ erro, sessaoExpirada }: { erro: string; sessaoExpirada: boolean }) {
  return (
    <div role="alert" className="bg-risco-50 border border-risco-200 rounded-md p-3.5 flex gap-2.5 text-base text-risco-700">
      <span className="shrink-0">&#9888;&#65039;</span>
      <div>
        <span className="whitespace-pre-wrap">{erro}</span>
        {sessaoExpirada && (
          <Link href="/login" className="block mt-1.5 font-semibold underline">
            Entrar de novo
          </Link>
        )}
      </div>
    </div>
  );
}

function PreviewReport({
  result,
  erro,
  sessaoExpirada,
  confirmando,
  onConfirmar,
  onCancelar,
}: {
  result: PreviewResult;
  erro: string;
  sessaoExpirada: boolean;
  confirmando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const totalIgnoradas = result.linhasIgnoradas.length;
  const temProblemas = totalIgnoradas > 0 || result.duplicatas > 0;

  return (
    <div className="space-y-4">
      <div className="bg-atencao-50 border border-atencao-200 rounded-md p-3.5 flex items-start gap-2.5 text-base">
        <span className="shrink-0 mt-0.5">&#128203;</span>
        <div>
          <p className="text-atencao-700 font-semibold">Isso é uma prévia — nada foi gravado ainda</p>
          <p className="text-atencao-700 text-legenda mt-0.5">
            Confira os números abaixo e só clique em &quot;Confirmar importação&quot; se estiver tudo certo.
          </p>
        </div>
      </div>

      <div className="bg-superficie border border-borda rounded-lg overflow-hidden">
        <div className="bg-tinta-900 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-base">Prévia da importação</p>
              <p className="text-texto-fraco text-legenda mt-0.5">
                {result.totalLinhas} {result.totalLinhas !== 1 ? 'linhas' : 'linha'} no arquivo &middot; separador: {result.separadorDetectado}
              </p>
            </div>
            <span className="text-cifra">&#128202;</span>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-borda border-b border-borda">
          <div className="px-4 py-3 text-center">
            <p className="text-cifra font-bold text-marca-700">{result.count}</p>
            <p className="text-legenda text-texto-suave mt-0.5">Prontos p/ importar</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className={`text-cifra font-bold ${result.duplicatas > 0 ? 'text-atencao-500' : 'text-texto-fraco'}`}>{result.duplicatas}</p>
            <p className="text-legenda text-texto-suave mt-0.5">Duplicatas</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className={`text-cifra font-bold ${totalIgnoradas > 0 ? 'text-risco-500' : 'text-texto-fraco'}`}>{totalIgnoradas}</p>
            <p className="text-legenda text-texto-suave mt-0.5">Ignoradas</p>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-borda">
          <p className="text-legenda font-semibold text-texto-suave uppercase tracking-wide mb-2">Colunas identificadas</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(result.colunasDetectadas).map(([canonical, mapped]) => (
              <div key={canonical} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-marca-500 shrink-0" />
                <span className="text-legenda text-texto-suave font-mono truncate">{mapped}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {result.count > 0 && (
        <div className="bg-superficie border border-borda rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-borda">
            <p className="text-base font-semibold text-texto">Análise financeira do que seria importado</p>
            <p className="text-legenda text-texto-fraco mt-0.5">
              Total: <span className="font-semibold text-texto">{moeda(result.totalValor)}</span>
            </p>
          </div>

          <div className="divide-y divide-borda">
            <BreakdownRow
              cor="red"
              label="Ja vencidos — cobrar hoje"
              hint="Aparecem na lista do dia como prioritarios"
              count={result.breakdown.vencidos.count}
              valor={result.breakdown.vencidos.valor}
              total={result.totalValor}
            />
            <BreakdownRow
              cor="amber"
              label="Vencimento em ate 3 dias — enviar lembrete"
              hint="Aparecem na lista do dia como preventivos"
              count={result.breakdown.preventivos.count}
              valor={result.breakdown.preventivos.valor}
              total={result.totalValor}
            />
            <BreakdownRow
              cor="slate"
              label="Vencimento futuro — monitorando"
              hint="Entram na lista quando se aproximam do vencimento"
              count={result.breakdown.futuros.count}
              valor={result.breakdown.futuros.valor}
              total={result.totalValor}
            />
          </div>
        </div>
      )}

      {temProblemas && (
        <div className="bg-superficie border border-borda rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-borda">
            <p className="text-base font-semibold text-texto">Linhas que não vão ser importadas</p>
            <p className="text-legenda text-texto-fraco mt-0.5">Revise o arquivo original para corrigir estas entradas, se quiser</p>
          </div>

          {result.duplicatas > 0 && (
            <div className="px-5 py-3 flex items-center gap-3 border-b border-borda bg-atencao-50">
              <div>
                <p className="text-base font-semibold text-atencao-700">
                  {result.duplicatas} {result.duplicatas !== 1 ? 'titulos duplicados' : 'titulo duplicado'}
                </p>
                <p className="text-legenda text-atencao-600">Ja existem no sistema com mesmo cliente, valor e data de vencimento</p>
              </div>
            </div>
          )}

          {result.linhasIgnoradas.map((item, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3 border-b border-borda last:border-0">
              <span className="text-risco-500 text-base shrink-0 mt-0.5">x</span>
              <div className="min-w-0">
                <p className="text-base text-texto font-medium">
                  Linha {item.linha}{item.nome ? ` — ${item.nome}` : ''}
                </p>
                <p className="text-legenda text-risco-600 mt-0.5">{item.motivo}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {erro && <ErroNaTela erro={erro} sessaoExpirada={sessaoExpirada} />}

      <div className="flex gap-3">
        {result.count > 0 && (
          <button
            onClick={onConfirmar}
            disabled={confirmando}
            className="flex-1 bg-marca-700 hover:bg-marca-700 text-white font-semibold py-3 rounded-md transition-colors disabled:opacity-50"
          >
            {confirmando ? 'Importando...' : `Confirmar importação (${result.count})`}
          </button>
        )}
        <button
          onClick={onCancelar}
          disabled={confirmando}
          className="flex-1 bg-superficie border border-borda hover:bg-superficie-sutil text-texto font-semibold py-3 rounded-md transition-colors disabled:opacity-50"
        >
          Cancelar / trocar arquivo
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relatório final — depois que o usuário confirmou e os dados JÁ foram gravados.
// ---------------------------------------------------------------------------
function ConfirmedReport({
  result,
  onNovo,
  onVerLista,
}: {
  result: ConfirmResult;
  onNovo: () => void;
  onVerLista: () => void;
}) {
  // Um banner verde por cima de "3 importados · 7 erros" foi exatamente o que
  // escondeu uma queda de rede durante o teste real. A cor agora segue o
  // desfecho, e a indisponibilidade tem um texto próprio: o problema não é o
  // arquivo do usuário.
  const estilo = {
    completo: {
      caixa: 'bg-marca-50 border-marca-200',
      titulo: 'text-marca-800',
      texto: 'text-marca-700',
      icone: '✅',
      rotulo: 'Importação concluída',
    },
    parcial: {
      caixa: 'bg-atencao-50 border-atencao-200',
      titulo: 'text-atencao-700',
      texto: 'text-atencao-700',
      icone: '⚠️',
      rotulo: 'Importação concluída em parte',
    },
    indisponivel: {
      caixa: 'bg-risco-50 border-risco-200',
      titulo: 'text-risco-700',
      texto: 'text-risco-700',
      icone: '❌',
      rotulo: 'Importação interrompida — banco de dados indisponível',
    },
  }[result.resultado];

  return (
    <div className="space-y-4">
      <div className={`${estilo.caixa} border rounded-md p-3.5 flex items-start gap-2.5 text-base`}>
        <span className="shrink-0 mt-0.5">{estilo.icone}</span>
        <div>
          <p className={`${estilo.titulo} font-semibold`}>{estilo.rotulo}</p>
          <p className={`${estilo.texto} text-legenda mt-0.5`}>{result.message}</p>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="bg-superficie border border-borda rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-borda">
            <p className="text-base font-semibold text-texto">
              {result.resultado === 'indisponivel'
                ? 'O que aconteceu'
                : 'Erros durante a gravação'}
            </p>
          </div>
          {result.errors.map((err, i) => (
            <div key={i} className="px-5 py-3 border-b border-borda last:border-0 text-base text-risco-600">
              {err}
            </div>
          ))}
        </div>
      )}

      {result.resultado === 'indisponivel' && (
        <p className="text-legenda text-texto-suave leading-relaxed px-1">
          Nenhum dado do arquivo foi perdido. Assim que a conexão voltar, importe o mesmo arquivo
          de novo: os títulos que chegaram a ser gravados serão reconhecidos como duplicata e não
          entrarão duas vezes.
        </p>
      )}

      <div className="flex gap-3">
        {result.count > 0 && (
          <button
            onClick={onVerLista}
            className="flex-1 bg-tinta-900 hover:bg-tinta-800 text-white font-semibold py-3 rounded-md transition-colors"
          >
            Ver lista do dia
          </button>
        )}
        <button
          onClick={onNovo}
          className="flex-1 bg-superficie border border-borda hover:bg-superficie-sutil text-texto font-semibold py-3 rounded-md transition-colors"
        >
          {result.resultado === 'indisponivel' ? 'Tentar de novo' : 'Importar outro arquivo'}
        </button>
      </div>
    </div>
  );
}

function BreakdownRow({
  cor,
  label,
  hint,
  count,
  valor,
  total,
}: {
  cor: 'red' | 'amber' | 'slate';
  label: string;
  hint: string;
  count: number;
  valor: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
  const barColor = cor === 'red' ? 'bg-risco-500' : cor === 'amber' ? 'bg-atencao-500' : 'bg-borda-forte';
  const valorColor = cor === 'red' ? 'text-risco-600' : cor === 'amber' ? 'text-atencao-600' : 'text-texto-suave';
  const dot = cor === 'red' ? 'bg-risco-500' : cor === 'amber' ? 'bg-atencao-500' : 'bg-borda-forte';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-start gap-2">
          <span className={`w-2 h-2 rounded-full ${dot} shrink-0 mt-1.5`} />
          <div>
            <p className="text-base font-semibold text-texto">{label}</p>
            <p className="text-legenda text-texto-fraco mt-0.5">{hint}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-base font-bold ${valorColor}`}>{moeda(valor)}</p>
          <p className="text-legenda text-texto-fraco">{count} {count !== 1 ? 'titulos' : 'titulo'} &middot; {pct}%</p>
        </div>
      </div>
      <div className="h-1.5 bg-superficie-afundada rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
