'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Marca from '@/components/Marca';
import { Botao } from '@/components/ui/Botao';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      // 429 é o limitador de tentativas, não credencial errada — dizer
      // "incorretos" a quem já acertou mandaria a pessoa tentar de novo em vez
      // de esperar, que é o oposto do que precisa acontecer.
      setError(
        res.status === 429
          ? 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'
          : 'E-mail ou senha incorretos.',
      );
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-superficie-sutil px-4">
      <div className="w-full max-w-85">
        <div className="flex flex-col items-start mb-7">
          <span className="text-marca-700 mb-4">
            <Marca className="text-[17px]" />
          </span>
          <h1 className="text-[15px] font-medium text-texto">Entrar no painel</h1>
          <p className="text-[13px] text-texto-suave mt-0.5">
            Use as credenciais de acesso da sua empresa.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-[13px] font-medium text-texto mb-1.5">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaempresa.com.br"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'erro-login' : undefined}
              className={`w-full h-10 bg-superficie border rounded-md px-3 text-sm text-texto placeholder-texto-fraco transition-colors ${
                error ? 'border-risco-500' : 'border-borda-forte hover:border-tinta-400'
              }`}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="senha" className="block text-[13px] font-medium text-texto mb-1.5">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'erro-login' : undefined}
              className={`w-full h-10 bg-superficie border rounded-md px-3 text-sm text-texto placeholder-texto-fraco transition-colors ${
                error ? 'border-risco-500' : 'border-borda-forte hover:border-tinta-400'
              }`}
            />
          </div>

          {error && (
            <p id="erro-login" role="alert" className="text-[13px] text-risco-600">
              {error}
            </p>
          )}

          <Botao type="submit" variante="primario" tamanho="lg" largura disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>
      </div>
    </div>
  );
}
