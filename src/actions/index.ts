'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { StatusTitulo } from '@/types';

export async function atualizarStatusTitulo(
  tituloId: string,
  status: StatusTitulo,
  mensagemGerada: string,
  dataPromessa?: string,
) {
  await supabase.from('interacoes').insert({
    titulo_id: tituloId,
    mensagem_enviada: mensagemGerada,
    resultado: status,
  });

  await supabase
    .from('titulos')
    .update({
      status,
      data_promessa: dataPromessa ?? null,
    })
    .eq('id', tituloId);

  revalidatePath('/');
}
