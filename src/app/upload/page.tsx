'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface BreakdownGroup {
  count: number;
  valor: number;
}

interface LinhaIgnorada {
  linha: number;
  nome: string;
  motivo: string;
}

interface UploadResult {
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
}

interface FilePreview {
  linhas: number;
  separador: string;
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

function moeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFileSelect(selectedFile: File) {
    setFile(selectedFile);
    setResult(null);
    setError('');
    const text = await selectedFile.text();
    setPreview(analisarCSVLocal(text));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload-csv', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Erro desconhecido.');
    } else {
      setResult(data);
    }
    setLoading(false);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <div className="mb-1">
          <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
            &larr; Lista do dia
          </Link>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Importar planilha</h2>
        <p className="text-sm text-slate-500 mt-0.5">Suba um CSV para adicionar titulos a lista de cobranca</p>
      </div>

      {result ? (
        <ImportReport
          result={result}
          onNovo={() => {
            setResult(null);
            setFile(null);
            setPreview(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
          onVerLista={() => router.push('/')}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
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
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                    file
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {file ? (
                    <>
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                        <span className="text-xl">&#128196;</span>
                      </div>
                      <p className="text-blue-700 font-semibold text-sm">{file.name}</p>
                      <p className="text-blue-400 text-xs mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                      <button
                        type="button"
                        className="text-xs text-slate-400 mt-2 hover:text-slate-600 underline transition-colors"
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
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                        <span className="text-xl">&#128193;</span>
                      </div>
                      <p className="text-slate-600 text-sm font-medium">Clique para selecionar o arquivo</p>
                      <p className="text-slate-400 text-xs mt-0.5">Somente .csv</p>
                    </>
                  )}
                </div>
              </label>

              {preview && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-start gap-2.5 text-sm">
                  <span className="shrink-0 mt-0.5">&#128269;</span>
                  <div>
                    <p className="text-blue-800 font-semibold">
                      {preview.linhas} {preview.linhas !== 1 ? 'linhas detectadas' : 'linha detectada'}
                    </p>
                    <p className="text-blue-600 text-xs mt-0.5">
                      Separador: {preview.separador} &middot; Clique em &quot;Importar&quot; para analisar
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-2.5 text-sm text-red-700">
                  <span className="shrink-0">&#9888;&#65039;</span>
                  <span className="whitespace-pre-wrap">{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!file || loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-40 transition-colors shadow-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analisando e importando...
                  </span>
                ) : 'Importar e analisar'}
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Colunas esperadas</p>
              <div className="space-y-2">
                {[
                  { col: 'nome', desc: 'Nome do cliente' },
                  { col: 'telefone', desc: 'Com ou sem mascara' },
                  { col: 'valor', desc: 'Ex: 1500.00 ou R$ 1.500,00' },
                  { col: 'data_vencimento', desc: 'DD/MM/AAAA ou AAAA-MM-DD' },
                ].map(({ col, desc }) => (
                  <div key={col} className="flex items-start gap-2">
                    <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono whitespace-nowrap">{col}</code>
                    <span className="text-xs text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3 leading-relaxed">
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

function ImportReport({
  result,
  onNovo,
  onVerLista,
}: {
  result: UploadResult;
  onNovo: () => void;
  onVerLista: () => void;
}) {
  const totalIgnoradas = result.linhasIgnoradas.length;
  const temProblemas = totalIgnoradas > 0 || result.duplicatas > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-slate-900 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-base">Relatorio de importacao</p>
              <p className="text-slate-400 text-xs mt-0.5">
                {result.totalLinhas} {result.totalLinhas !== 1 ? 'linhas' : 'linha'} no arquivo &middot; separador: {result.separadorDetectado}
              </p>
            </div>
            <span className="text-2xl">&#128202;</span>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-4 py-3 text-center">
            <p className="text-xl font-bold text-emerald-600">{result.count}</p>
            <p className="text-xs text-slate-500 mt-0.5">Importados</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className={`text-xl font-bold ${result.duplicatas > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{result.duplicatas}</p>
            <p className="text-xs text-slate-500 mt-0.5">Duplicatas</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className={`text-xl font-bold ${totalIgnoradas > 0 ? 'text-red-500' : 'text-slate-300'}`}>{totalIgnoradas}</p>
            <p className="text-xs text-slate-500 mt-0.5">Ignoradas</p>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Colunas identificadas</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(result.colunasDetectadas).map(([canonical, mapped]) => (
              <div key={canonical} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-xs text-slate-600 font-mono truncate">{mapped}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {result.count > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">Analise financeira dos titulos importados</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Total: <span className="font-semibold text-slate-700">{moeda(result.totalValor)}</span>
            </p>
          </div>

          <div className="divide-y divide-slate-100">
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
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">Linhas nao importadas</p>
            <p className="text-xs text-slate-400 mt-0.5">Revise o arquivo original para corrigir estas entradas</p>
          </div>

          {result.duplicatas > 0 && (
            <div className="px-5 py-3 flex items-center gap-3 border-b border-slate-100 bg-amber-50">
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {result.duplicatas} {result.duplicatas !== 1 ? 'titulos duplicados' : 'titulo duplicado'}
                </p>
                <p className="text-xs text-amber-600">Ja existem no sistema com mesmo cliente, valor e data de vencimento</p>
              </div>
            </div>
          )}

          {result.linhasIgnoradas.map((item, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3 border-b border-slate-50 last:border-0">
              <span className="text-red-400 text-sm shrink-0 mt-0.5">x</span>
              <div className="min-w-0">
                <p className="text-sm text-slate-700 font-medium">
                  Linha {item.linha}{item.nome ? ` — ${item.nome}` : ''}
                </p>
                <p className="text-xs text-red-600 mt-0.5">{item.motivo}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {result.count > 0 && (
          <button
            onClick={onVerLista}
            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Ver lista do dia
          </button>
        )}
        <button
          onClick={onNovo}
          className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition-colors"
        >
          Importar outro arquivo
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
  const barColor = cor === 'red' ? 'bg-red-400' : cor === 'amber' ? 'bg-amber-400' : 'bg-slate-300';
  const valorColor = cor === 'red' ? 'text-red-600' : cor === 'amber' ? 'text-amber-600' : 'text-slate-500';
  const dot = cor === 'red' ? 'bg-red-400' : cor === 'amber' ? 'bg-amber-400' : 'bg-slate-300';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-start gap-2">
          <span className={`w-2 h-2 rounded-full ${dot} shrink-0 mt-1.5`} />
          <div>
            <p className="text-sm font-semibold text-slate-700">{label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-base font-bold ${valorColor}`}>{moeda(valor)}</p>
          <p className="text-xs text-slate-400">{count} {count !== 1 ? 'titulos' : 'titulo'} &middot; {pct}%</p>
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}