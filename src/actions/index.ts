'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { calcularSilenciadoAte } from '@/lib/prioridade';
import { StatusTitulo } from '@/types';

/**
 * Registra que uma mensagem foi enviada, ANTES de sabermos o resultado.
 * Chamado no clique do botão "Enviar via WhatsApp" — o envio em si acontece
 * fora do app (o usuário sai pro WhatsApp), então isso é a única forma de
 * garantir que o histórico exista mesmo se ninguém voltar pra marcar status.
 */
export async function registrarEnvio(tituloId: string, mensagem: string) {
  await supabase.from('interacoes').insert({
    titulo_id: tituloId,
    mensagem_enviada: mensagem,
    resultado: null,
  });

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
  const { data: pendente } = await supabase
    .from('interacoes')
    .select('id')
    .eq('titulo_id', tituloId)
    .is('resultado', null)
    .order('data_envio', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendente) {
    await supabase
      .from('interacoes')
      .update({ resultado: status })
      .eq('id', pendente.id);
  } else {
    await supabase.from('interacoes').insert({
      titulo_id: tituloId,
      mensagem_enviada: mensagemGerada,
      resultado: status,
    });
  }

  // Só 'pago' encerra o título. 'promessa' e 'sem_resposta' apenas o tiram da
  // fila até a data correspondente — quem lê isso de volta é
  // lib/prioridade.ts::estaNaFilaHoje. Os três campos são sempre reescritos
  // juntos para não sobrar estado de uma marcação anterior (ex: um título que
  // tinha promessa e depois virou "sem resposta" não pode voltar pela promessa
  // antiga).
  const { error } = await supabase
    .from('titulos')
    .update({
      status,
      data_promessa: status === 'promessa' ? (dataPromessa ?? null) : null,
      silenciado_ate: status === 'sem_resposta' ? calcularSilenciadoAte() : null,
      resolvido_em: status === 'pago' ? new Date().toISOString() : null,
    })
    .eq('id', tituloId);

  // Falhar alto: sem isso a UI marcava o título como resolvido na tela
  // enquanto o banco continuava intacto — o usuário achava que registrou uma
  // cobrança que nunca foi gravada.
  if (error) {
    throw new Error(
      `Não foi possível registrar o resultado do título. ${error.message}` +
      (error.message.includes('does not exist')
        ? ' — rode supabase/migration-01-ciclo-operacional.sql.'
        : ''),
    );
  }

  revalidatePath('/');
  revalidatePath('/clientes', 'layout');
}
