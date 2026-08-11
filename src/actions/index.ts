'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { gravar, ler } from '@/lib/supabase-io';
import { calcularSilenciadoAte } from '@/lib/prioridade';
import { StatusTitulo } from '@/types';

/**
 * Registra que uma mensagem foi enviada, ANTES de sabermos o resultado.
 * Chamado no clique do botão "Enviar via WhatsApp" — o envio em si acontece
 * fora do app (o usuário sai pro WhatsApp), então isso é a única forma de
 * garantir que o histórico exista mesmo se ninguém voltar pra marcar status.
 */
export async function registrarEnvio(tituloId: string, mensagem: string) {
  // Falhar alto, pelo mesmo motivo de atualizarStatusTitulo abaixo: o envio
  // acontece FORA do app, então esta linha é a única prova de que a cobrança
  // foi feita. Engolir o erro fazia o histórico sumir sem ninguém notar — e o
  // usuário cobraria a mesma pessoa de novo achando que nunca tinha falado.
  const r = await gravar<null>(
    (sinal) =>
      supabase
        .from('interacoes')
        .insert({ titulo_id: tituloId, mensagem_enviada: mensagem, resultado: null })
        .abortSignal(sinal),
    'registro de envio',
  );

  if (!r.ok) {
    throw new Error(`Não foi possível registrar o envio da mensagem. ${r.mensagem}`);
  }

  revalidatePath('/');
  revalidatePath('/clientes', 'layout');
}

/**
 * Marca o resultado de uma cobrança. Se já existir uma interação pendente
 * (resultado null) pra esse título — o normal, criada por registrarEnvio —
 * atualiza ela em vez de criar uma linha solta. Se não existir (ex: usuário
 * marcou "pago" sem ter clicado em enviar mensagem antes), cria uma nova.
 */
export async function atualizarStatusTitulo(
  tituloId: string,
  status: StatusTitulo,
  mensagemGerada: string,
  dataPromessa?: string,
) {
  const { data: pendente } = await ler<{ id: string } | null>(
    (sinal) =>
      supabase
        .from('interacoes')
        .select('id')
        .eq('titulo_id', tituloId)
        .is('resultado', null)
        .order('data_envio', { ascending: false })
        .limit(1)
        .abortSignal(sinal)
        .maybeSingle(),
    'interação pendente do título',
  );

  const historico = pendente
    ? await gravar<null>(
        (sinal) =>
          supabase.from('interacoes').update({ resultado: status }).eq('id', pendente.id).abortSignal(sinal),
        'atualização da interação',
      )
    : await gravar<null>(
        (sinal) =>
          supabase
            .from('interacoes')
            .insert({ titulo_id: tituloId, mensagem_enviada: mensagemGerada, resultado: status })
            .abortSignal(sinal),
        'criação da interação',
      );

  // Parar ANTES de mexer no título. Se o histórico não pôde ser gravado, mudar
  // o status assim mesmo deixaria uma cobrança resolvida sem registro de como
  // — e a ordem inversa é pior: título alterado, histórico perdido, sem sinal.
  if (!historico.ok) {
    throw new Error(
      `Não foi possível registrar o histórico desta cobrança. ${historico.mensagem} ` +
      `O título não foi alterado.`,
    );
  }

  // Só 'pago' encerra o título. 'promessa' e 'sem_resposta' apenas o tiram da
  // fila até a data correspondente — quem lê isso de volta é
  // lib/prioridade.ts::estaNaFilaHoje. Os três campos são sempre reescritos
  // juntos para não sobrar estado de uma marcação anterior (ex: um título que
  // tinha promessa e depois virou "sem resposta" não pode voltar pela promessa
  // antiga).
  const r = await gravar<null>(
    (sinal) =>
      supabase
        .from('titulos')
        .update({
          status,
          data_promessa: status === 'promessa' ? (dataPromessa ?? null) : null,
          silenciado_ate: status === 'sem_resposta' ? calcularSilenciadoAte() : null,
          resolvido_em: status === 'pago' ? new Date().toISOString() : null,
        })
        .eq('id', tituloId)
        .abortSignal(sinal),
    'atualização de status do título',
  );

  // Falhar alto: sem isso a UI marcava o título como resolvido na tela
  // enquanto o banco continuava intacto — o usuário achava que registrou uma
  // cobrança que nunca foi gravada.
  if (!r.ok) {
    throw new Error(
      `Não foi possível registrar o resultado do título. ${r.mensagem}` +
      (r.detalhe.includes('does not exist')
        ? ' — rode supabase/migration-01-ciclo-operacional.sql.'
        : ''),
    );
  }

  revalidatePath('/');
  revalidatePath('/clientes', 'layout');
}
