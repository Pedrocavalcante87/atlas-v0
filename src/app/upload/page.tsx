'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UploadResult {
  message: string;
  count: number;
  duplicatas?: number;
  errors: string[];
  colunasDetectadas?: Record<string, string>;
  separadorDetectado?: string;
}

interface FilePreview {
  linhas: number;
  separador: string;
}

function analisarCSVLocal(text: string): FilePreview {
  const primeiraLinha = text.split('\n')[0] ?? '';
  const separador = primeiraLinha.includes(';')
    ? 'ponto e vírgula (;)'
    : primeiraLinha.includes('\t')
    ? 'tab'
    : 'vírgula (,)';
  const linhas = Math.max(0, text.trim().split('\n').filter((l) => l.trim()).length - 1);
  return { linhas, separador };
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
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
            ← Lista do dia
          </Link>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Importar planilha</h2>
        <p className="text-sm text-slate-500 mt-0.5">Suba um CSV para adicionar novos títulos à lista de cobrança</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {/* Form — coluna principal */}
        <div className="md:col-span-3 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Drop zone */}
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
                      <span className="text-xl">📄</span>
                    </div>
                    <p className="text-blue-700 font-semibold text-sm">{file.name}</p>
                    <p className="text-blue-400 text-xs mt-0.5">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
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
                      <span className="text-xl">📁</span>
                    </div>
                    <p className="text-slate-600 text-sm font-medium">
                      Clique para selecionar o arquivo
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5">Somente .csv</p>
                  </>
                )}
              </div>
            </label>

            {/* Preview local — aparece assim que o arquivo é selecionado */}
            {preview && !result && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-start gap-2.5 text-sm">
                <span className="shrink-0 mt-0.5">🔍</span>
                <div>
                  <p className="text-blue-800 font-semibold">
                    {preview.linhas} linha{preview.linhas !== 1 ? 's' : ''} detectada{preview.linhas !== 1 ? 's' : ''}
                  </p>
                  <p className="text-blue-600 text-xs mt-0.5">
                    Separador: {preview.separador} · Clique em &quot;Importar&quot; para enviar ao sistema
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-2.5 text-sm text-red-700">
                <span className="shrink-0">⚠️</span>
                <span className="whitespace-pre-wrap">{error}</span>
              </div>
            )}

            {result && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <span>✅</span>
                  <p className="text-sm text-emerald-800 font-semibold">{result.message}</p>
                </div>

                {/* Duplicatas ignoradas */}
                {(result.duplicatas ?? 0) > 0 && (
                  <div className="mt-2 pt-2 border-t border-emerald-200 flex items-center gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <p className="text-xs text-amber-700">
                       {result.duplicatas} título(s) ignorado(s) por já existirem no sistema com o mesmo valor e vencimento.
                    </p>
                  </div>
                )}

                {/* Relatório de detecção */}
                {result.colunasDetectadas && (
                  <div className="mt-2 pt-2 border-t border-emerald-200">
                    <p className="text-xs font-semibold text-emerald-700 mb-1.5">
                       Colunas detectadas
                       {result.separadorDetectado && (
                         <span className="font-normal text-emerald-600"> · separador: {result.separadorDetectado}</span>
                       )}
                    </p>
                    <div className="space-y-0.5">
                       {Object.entries(result.colunasDetectadas).map(([canonical, mapped]) => (
                         <p key={canonical} className="text-xs text-emerald-700 font-mono">
                           {mapped}
                         </p>
                       ))}
                    </div>
                  </div>
                )}

                {result.errors.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-emerald-200">
                    <p className="text-xs font-semibold text-amber-700 mb-1">
                      {result.errors.length} linha(s) com aviso:
                    </p>
                    <ul className="space-y-0.5">
                      {result.errors.map((err, i) => (
                        <li key={i} className="text-xs text-red-600">• {err}</li>
                      ))}
                    </ul>
                  </div>
                )}
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
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Importando…
                </span>
              ) : 'Importar títulos'}
            </button>

            {result && result.count > 0 && (
              <button
                type="button"
                onClick={() => router.push('/')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Ver lista do dia →
              </button>
            )}
          </form>
        </div>

        {/* Instruções — coluna lateral */}
        <div className="md:col-span-2 space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Colunas esperadas</p>
            <div className="space-y-2">
              {[
                { col: 'nome', desc: 'Nome completo do cliente' },
                { col: 'telefone', desc: 'Com ou sem máscara' },
                { col: 'valor', desc: 'Ex: 1500.00 ou 1500,00' },
                { col: 'data_vencimento', desc: 'DD/MM/AAAA ou AAAA-MM-DD' },
              ].map(({ col, desc }) => (
                <div key={col} className="flex items-start gap-2">
                  <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                    {col}
                  </code>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Exemplo</p>
            <pre className="text-xs text-slate-300 overflow-x-auto leading-relaxed font-mono">
{`nome,telefone,valor,
  data_vencimento
João Silva,11999990000,
  1500.00,15/08/2025
Maria Souza,21988880000,
  320,2025-08-20`}
            </pre>
          </div>
        </div>
      </div>
    </main>
  );
}
