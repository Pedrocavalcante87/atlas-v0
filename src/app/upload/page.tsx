'use client';

import { useState, useRef, type DragEvent } from 'react';
import Link from 'next/link';
import { formatarMoeda as moeda, formatarData, formatarTelefone, plural } from '@/lib/format';
import { chamarApi, mensagemDeFalha, type FalhaDeResposta } from '@/lib/resposta-http';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import Painel from '@/components/ui/Painel';
import Aviso from '@/components/ui/Aviso';
import KpiCard from '@/components/ui/KpiCard';
import Badge from '@/components/ui/Badge';
import { Botao, estiloBotao } from '@/components/ui/Botao';
import { IconeArquivo, IconeImportar } from '@/components/ui/Icone';

// ---------------------------------------------------------------------------
// Importação de planilha — dois passos, e o fluxo NÃO mudou nesta tela:
// escolher arquivo → prévia (nada gravado) → confirmar → relatório. Ela foi
// repaginada, não redesenhada: a tela de mapeamento de colunas é o centro da
// Fase 1 do PLANEJAMENTO.md e não pode nascer aqui por acidente.
//
// O que mudou foi o que a prévia MOSTRA: além das contagens, uma amostra das
// linhas como o sistema as leu. É a única chance de o usuário perceber que um
// valor ou uma data foi interpretado errado antes de gravar.
// ---------------------------------------------------------------------------

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

/** Quantas linhas lidas a prévia mostra antes de pedir confirmação. */
const LINHAS_NA_AMOSTRA = 8;
/** Quantas linhas ignoradas aparecem antes de "mostrar todas". */
const IGNORADAS_VISIVEIS = 10;

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

/**
 * Contagem instantânea, antes de enviar. Ingênua de propósito (só a primeira
 * linha decide o separador) — quem decide de verdade é o PapaParse no
 * servidor; isto só dá retorno imediato ao escolher o arquivo.
 */
function analisarCSVLocal(text: string): FilePreview {
  const primeiraLinha = text.split('\n')[0] ?? '';
  const separador = primeiraLinha.includes(';')
    ? 'ponto e vírgula (;)'
    : primeiraLinha.includes('\t')
    ? 'tabulação'
    : primeiraLinha.includes('|')
    ? 'barra vertical (|)'
    : 'vírgula (,)';
  const linhas = Math.max(0, text.trim().split('\n').filter((l) => l.trim()).length - 1);
  return { linhas, separador };
}

/**
 * Planilha do Excel não é CSV — e a mensagem precisa dizer como resolver.
 * Só o Excel é barrado aqui: `.txt` passa, porque há sistema que exporta
 * texto separado com essa extensão e o servidor sempre o aceitou. Quem
 * decide se o conteúdo presta continua sendo a análise no servidor.
 */
function problemaNoTipo(arquivo: File): string | null {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls') || nome.endsWith('.ods')) {
    return 'Este arquivo é uma planilha, não um CSV. Abra-o no Excel e use Arquivo › Salvar como › CSV, depois importe o arquivo salvo.';
  }
  return null;
}

const COLUNAS_ESPERADAS = [
  { col: 'nome', desc: 'Nome do cliente' },
  { col: 'telefone', desc: 'Com ou sem máscara, com ou sem DDI' },
  { col: 'valor', desc: '1500,00 · R$ 1.500,00 · 1500.00' },
  { col: 'data_vencimento', desc: 'DD/MM/AAAA ou AAAA-MM-DD' },
];

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(selectedFile: File) {
    setResult(null);
    setConfirmResult(null);
    setError('');
    setSessaoExpirada(false);

    const problema = problemaNoTipo(selectedFile);
    if (problema) {
      setFile(null);
      setPreview(null);
      setError(problema);
      return;
    }

    setFile(selectedFile);
    // A leitura local é só uma prévia informativa; se o navegador não
    // conseguir ler o arquivo, a análise no servidor ainda decide.
    try {
      setPreview(analisarCSVLocal(await selectedFile.text()));
    } catch {
      setPreview(null);
    }
  }

  function soltar(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastando(false);
    const arquivo = e.dataTransfer.files?.[0];
    if (arquivo) handleFileSelect(arquivo);
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
    <Pagina>
      <CabecalhoPagina
        titulo="Importar planilha"
        descricao="Suba um CSV de contas a receber. Nada é gravado antes da sua confirmação."
      />

      {confirmResult ? (
        <RelatorioFinal result={confirmResult} onNovo={reiniciar} />
      ) : result ? (
        <Previa
          result={result}
          erro={error}
          sessaoExpirada={sessaoExpirada}
          confirmando={confirmando}
          onConfirmar={handleConfirmar}
          onCancelar={reiniciar}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-5 md:items-start">
          <form onSubmit={handleSubmit} className="md:col-span-3 space-y-3">
            {/* O `label` inteiro é a área de clique e de soltar. O input fica
                `sr-only`, não `hidden`: escondido com display:none ele saía da
                ordem do Tab, e quem usa teclado não conseguia escolher arquivo. */}
            <label
              onDragEnter={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setArrastando(false)}
              onDrop={soltar}
              className={`block cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors
                          focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-marca-500 ${
                            arrastando
                              ? 'border-marca-500 bg-marca-50'
                              : 'border-borda-forte bg-superficie hover:border-tinta-400 hover:bg-superficie-sutil'
                          }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              {file ? (
                <>
                  <IconeArquivo className="w-6 h-6 mx-auto text-marca-700" />
                  <p className="mt-2 text-base font-medium text-texto break-all">{file.name}</p>
                  <p className="mt-0.5 text-legenda text-texto-suave">
                    <span className="numero">{(file.size / 1024).toFixed(1)}</span> KB
                    {preview && (
                      <>
                        {' · '}
                        {plural(preview.linhas, 'linha', 'linhas')} · separador {preview.separador}
                      </>
                    )}
                  </p>
                  <p className="mt-3 text-legenda text-texto-suave underline">Trocar arquivo</p>
                </>
              ) : (
                <>
                  <IconeImportar className="w-6 h-6 mx-auto text-texto-suave" />
                  <p className="mt-2 text-base font-medium text-texto">
                    {arrastando ? 'Solte o arquivo aqui' : 'Arraste o arquivo ou clique para escolher'}
                  </p>
                  <p className="mt-0.5 text-legenda text-texto-suave">
                    Arquivo .csv — exporte do seu sistema ou salve a planilha como CSV
                  </p>
                </>
              )}
            </label>

            {error && <AvisoDeFalha erro={error} sessaoExpirada={sessaoExpirada} />}

            <Botao type="submit" variante="primario" tamanho="lg" largura disabled={!file} carregando={loading}>
              {loading ? 'Analisando…' : 'Analisar planilha'}
            </Botao>
            <p className="text-legenda text-texto-suave text-center">
              A análise só lê o arquivo. Nada é gravado até você confirmar na próxima etapa.
            </p>
          </form>

          <aside className="md:col-span-2">
            <Painel id="colunas" titulo="Colunas esperadas">
              <dl className="px-4 py-3 space-y-2.5">
                {COLUNAS_ESPERADAS.map(({ col, desc }) => (
                  <div key={col} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <dt>
                      <code className="text-legenda font-mono bg-superficie-afundada text-texto px-1.5 py-0.5 rounded-sm">
                        {col}
                      </code>
                    </dt>
                    <dd className="text-legenda text-texto-suave">{desc}</dd>
                  </div>
                ))}
              </dl>
              <p className="px-4 pb-3.5 text-legenda text-texto-suave leading-relaxed">
                O nome da coluna não precisa ser exato: o sistema reconhece mais de 70 variações, como{' '}
                <code className="font-mono">CLIENTE</code>, <code className="font-mono">CELULAR</code>,{' '}
                <code className="font-mono">VL_TOTAL</code> e <code className="font-mono">VENCTO</code>. Colunas
                desconhecidas são ignoradas.
              </p>
            </Painel>
          </aside>
        </div>
      )}
    </Pagina>
  );
}

function AvisoDeFalha({ erro, sessaoExpirada }: { erro: string; sessaoExpirada: boolean }) {
  return (
    <Aviso
      tom="risco"
      acao={
        sessaoExpirada ? (
          <Link href="/login" className={estiloBotao('secundario', 'sm')}>
            Entrar de novo
          </Link>
        ) : undefined
      }
    >
      <span className="whitespace-pre-wrap">{erro}</span>
    </Aviso>
  );
}

// ---------------------------------------------------------------------------
// Prévia — mostra o que SERIA importado, mas ainda não gravou nada.
// ---------------------------------------------------------------------------
function Previa({
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
  const [todasIgnoradas, setTodasIgnoradas] = useState(false);
  const totalIgnoradas = result.linhasIgnoradas.length;
  const temProblemas = totalIgnoradas > 0 || result.duplicatas > 0;
  const amostra = result.linhasValidas.slice(0, LINHAS_NA_AMOSTRA);
  const ignoradasVisiveis = todasIgnoradas
    ? result.linhasIgnoradas
    : result.linhasIgnoradas.slice(0, IGNORADAS_VISIVEIS);

  return (
    <div className="space-y-4">
      <Aviso tom="atencao" titulo="Prévia: nada foi gravado ainda">
        Confira os números e a amostra abaixo. Só o botão &ldquo;Confirmar importação&rdquo; grava no banco.
      </Aviso>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard rotulo="Prontos" valor={result.count} nota="títulos para importar" />
        <KpiCard
          rotulo="Duplicatas"
          valor={result.duplicatas}
          tom={result.duplicatas > 0 ? 'atencao' : 'neutro'}
          nota="já estão no sistema"
        />
        <KpiCard
          rotulo="Ignoradas"
          valor={totalIgnoradas}
          tom={totalIgnoradas > 0 ? 'risco' : 'neutro'}
          nota="linhas com problema"
        />
      </div>

      <Painel
        id="arquivo"
        titulo="Arquivo"
        complemento={`${plural(result.totalLinhas, 'linha', 'linhas')} · separador ${result.separadorDetectado}`}
      >
        <div className="px-4 py-3">
          <p className="text-legenda text-texto-suave mb-2">Colunas reconhecidas</p>
          <ul className="flex flex-wrap gap-1.5">
            {Object.entries(result.colunasDetectadas).map(([canonica, lida]) => (
              <li key={canonica}>
                <code className="text-legenda font-mono bg-superficie-afundada text-texto px-1.5 py-0.5 rounded-sm">
                  {lida}
                </code>
              </li>
            ))}
          </ul>
        </div>
      </Painel>

      {result.count > 0 && (
        <>
          <Painel
            id="analise"
            titulo="O que entra na fila"
            complemento={
              <>
                total <span className="numero font-medium text-texto">{moeda(result.totalValor)}</span>
              </>
            }
          >
            <div className="divide-y divide-borda">
              <LinhaDaAnalise
                tom="risco"
                rotulo="Já vencidos — cobrar hoje"
                dica="Entram na lista do dia como vencidos"
                grupo={result.breakdown.vencidos}
                total={result.totalValor}
              />
              <LinhaDaAnalise
                tom="neutro"
                rotulo="Vencem em até 3 dias — enviar lembrete"
                dica="Entram na lista do dia como a vencer"
                grupo={result.breakdown.preventivos}
                total={result.totalValor}
              />
              <LinhaDaAnalise
                tom="fraco"
                rotulo="Vencimento mais adiante"
                dica="Entram na lista quando faltarem 3 dias"
                grupo={result.breakdown.futuros}
                total={result.totalValor}
              />
            </div>
          </Painel>

          <Painel
            id="amostra"
            titulo="Amostra"
            complemento={
              result.count > amostra.length
                ? `as primeiras ${amostra.length} de ${result.count} linhas, como o sistema as leu`
                : 'como o sistema leu cada linha'
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-borda bg-cabecalho">
                    {['Linha', 'Cliente', 'Telefone', 'Valor', 'Vencimento'].map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`px-3 py-2 text-legenda font-medium text-texto-suave uppercase tracking-[0.04em] whitespace-nowrap ${
                          c === 'Valor' ? 'text-right' : 'text-left'
                        } ${c === 'Linha' || c === 'Telefone' ? 'hidden sm:table-cell' : ''}`}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {amostra.map((l) => (
                    <tr key={l.linha} className="border-b border-borda last:border-0">
                      <td className="px-3 py-2 text-corpo text-texto-suave numero hidden sm:table-cell">{l.linha}</td>
                      <td className="px-3 py-2 text-corpo text-texto max-w-56 truncate">{l.nome}</td>
                      <td className="px-3 py-2 text-corpo text-texto-suave numero whitespace-nowrap hidden sm:table-cell">
                        {formatarTelefone(l.telefone)}
                      </td>
                      <td className="px-3 py-2 text-corpo text-texto numero text-right whitespace-nowrap">
                        {moeda(l.valor)}
                      </td>
                      <td className="px-3 py-2 text-corpo text-texto-suave numero whitespace-nowrap">
                        {formatarData(l.dataVencimento)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Painel>
        </>
      )}

      {temProblemas && (
        <Painel id="fora" titulo="Fora desta importação" complemento="corrija no arquivo original se quiser incluí-las">
          {result.duplicatas > 0 && (
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-borda last:border-0">
              <Badge tom="atencao">duplicata</Badge>
              <p className="text-corpo text-texto">
                {plural(result.duplicatas, 'título já existe', 'títulos já existem')} no sistema com o mesmo cliente,
                valor e vencimento.
              </p>
            </div>
          )}
          {totalIgnoradas > 0 && (
            <ul className="divide-y divide-borda">
              {ignoradasVisiveis.map((item) => (
                <li key={item.linha} className="px-4 py-2.5">
                  <p className="text-corpo text-texto">
                    <span className="numero text-texto-suave">Linha {item.linha}</span>
                    {item.nome ? ` — ${item.nome}` : ''}
                  </p>
                  <p className="text-legenda text-risco-700 mt-0.5">{item.motivo}</p>
                </li>
              ))}
            </ul>
          )}
          {totalIgnoradas > IGNORADAS_VISIVEIS && (
            <div className="px-4 py-2.5 border-t border-borda">
              <Botao variante="sutil" tamanho="sm" onClick={() => setTodasIgnoradas((v) => !v)}>
                {todasIgnoradas ? 'Mostrar menos' : `Mostrar todas as ${totalIgnoradas} linhas ignoradas`}
              </Botao>
            </div>
          )}
        </Painel>
      )}

      {erro && <AvisoDeFalha erro={erro} sessaoExpirada={sessaoExpirada} />}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Botao variante="secundario" tamanho="lg" disabled={confirmando} onClick={onCancelar}>
          Cancelar e trocar arquivo
        </Botao>
        {result.count > 0 && (
          <Botao variante="primario" tamanho="lg" carregando={confirmando} onClick={onConfirmar}>
            {confirmando ? 'Importando…' : `Confirmar importação de ${plural(result.count, 'título', 'títulos')}`}
          </Botao>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relatório final — depois que o usuário confirmou e os dados JÁ foram gravados.
// ---------------------------------------------------------------------------
const DESFECHO: Record<ConfirmResult['resultado'], { tom: 'marca' | 'atencao' | 'risco'; rotulo: string }> = {
  completo: { tom: 'marca', rotulo: 'Importação concluída' },
  parcial: { tom: 'atencao', rotulo: 'Importação concluída em parte' },
  indisponivel: { tom: 'risco', rotulo: 'Importação interrompida — banco de dados indisponível' },
};

function RelatorioFinal({ result, onNovo }: { result: ConfirmResult; onNovo: () => void }) {
  // Um banner verde por cima de "3 importados · 7 erros" foi exatamente o que
  // escondeu uma queda de rede durante o teste real. A cor segue o desfecho,
  // e a indisponibilidade tem um texto próprio: o problema não é o arquivo.
  const desfecho = DESFECHO[result.resultado];

  return (
    <div className="space-y-4">
      <Aviso tom={desfecho.tom} titulo={desfecho.rotulo} papel={desfecho.tom === 'risco' ? 'alert' : 'status'}>
        {result.message}
      </Aviso>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard rotulo="Gravados" valor={result.count} nota="títulos novos" />
        <KpiCard rotulo="Duplicatas" valor={result.duplicatas} nota="já estavam no sistema" />
        <KpiCard
          rotulo="Não gravados"
          valor={result.naoGravadas}
          tom={result.naoGravadas > 0 ? 'risco' : 'neutro'}
          nota="ficaram de fora"
        />
      </div>

      {result.errors.length > 0 && (
        <Painel
          id="erros"
          titulo={result.resultado === 'indisponivel' ? 'O que aconteceu' : 'Erros durante a gravação'}
        >
          <ul className="divide-y divide-borda">
            {result.errors.map((err, i) => (
              <li key={i} className="px-4 py-2.5 text-corpo text-risco-700">
                {err}
              </li>
            ))}
          </ul>
        </Painel>
      )}

      {result.resultado === 'indisponivel' && (
        <p className="text-corpo text-texto-suave leading-relaxed">
          Nenhum dado do arquivo foi perdido. Assim que a conexão voltar, importe o mesmo arquivo de novo: os
          títulos que chegaram a ser gravados serão reconhecidos como duplicata e não entrarão duas vezes.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Botao variante="secundario" tamanho="lg" onClick={onNovo}>
          {result.resultado === 'indisponivel' ? 'Tentar de novo' : 'Importar outro arquivo'}
        </Botao>
        {result.count > 0 && (
          <Link href="/" className={estiloBotao('primario', 'lg')}>
            Ver lista do dia
          </Link>
        )}
      </div>
    </div>
  );
}

function LinhaDaAnalise({
  tom,
  rotulo,
  dica,
  grupo,
  total,
}: {
  /** Mesma escala da fila: vencido em vermelho, a vencer neutro, o resto mais claro ainda. */
  tom: 'risco' | 'neutro' | 'fraco';
  rotulo: string;
  dica: string;
  grupo: BreakdownGroup;
  total: number;
}) {
  const pct = total > 0 ? Math.round((grupo.valor / total) * 100) : 0;
  const barra = tom === 'risco' ? 'bg-risco-500' : tom === 'neutro' ? 'bg-tinta-400' : 'bg-borda-forte';
  const valor = tom === 'risco' ? 'text-risco-700' : tom === 'neutro' ? 'text-texto' : 'text-texto-suave';

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <span aria-hidden className={`w-2 h-2 rounded-full ${barra} shrink-0 mt-1.5`} />
          <div className="min-w-0">
            <p className="text-corpo font-medium text-texto">{rotulo}</p>
            <p className="text-legenda text-texto-suave mt-0.5">{dica}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-corpo font-semibold numero ${valor}`}>{moeda(grupo.valor)}</p>
          <p className="text-legenda text-texto-suave">
            {plural(grupo.count, 'título', 'títulos')} · <span className="numero">{pct}%</span>
          </p>
        </div>
      </div>
      <div
        className="h-1.5 bg-superficie-afundada rounded-full overflow-hidden"
        role="img"
        aria-label={`${pct}% do valor total`}
      >
        <div className={`h-full rounded-full ${barra}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
