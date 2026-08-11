export type StatusTitulo = 'aberto' | 'pago' | 'promessa' | 'sem_resposta';
export type Categoria = 'preventivo' | 'atraso_leve' | 'atraso_longo';

/** Por que um título que tinha saído da fila voltou para ela. */
export type MotivoReentrada = 'promessa_vencida' | 'silencio_expirado';

export interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  criado_em: string;
}

export interface Titulo {
  id: string;
  cliente_id: string;
  valor: number;
  data_vencimento: string;
  status: StatusTitulo;
  /** Status 'promessa': data combinada. O título volta à fila nessa data. */
  data_promessa: string | null;
  /** Status 'sem_resposta': fora da fila até esta data (volta nela). */
  silenciado_ate: string | null;
  /** Preenchido só quando o título vira 'pago' — fonte da receita recuperada. */
  resolvido_em: string | null;
  criado_em: string;
  clientes?: Cliente;
}

export interface Interacao {
  id: string;
  titulo_id: string;
  mensagem_enviada: string | null;
  data_envio: string;
  resultado: string | null;
}

export interface TituloComPrioridade extends Omit<Titulo, 'clientes'> {
  cliente: Cliente;
  score: number;
  categoria: Categoria;
  diasAtraso: number; // positivo = dias em atraso; negativo = dias até vencer
  mensagem: string;
  /** null = está na fila pela primeira vez. Preenchido quando o título voltou
   *  por promessa vencida ou fim do silêncio — quem cobra precisa saber que já
   *  falou com essa pessoa antes. */
  motivoReentrada: MotivoReentrada | null;
}

// Um cliente pode ter vários títulos em aberto ao mesmo tempo — agrupamos
// para que o financeiro cobre a PESSOA uma vez, não cada título separado.
export interface ClienteAgrupado {
  cliente: Cliente;
  titulos: TituloComPrioridade[];
  valorTotal: number;
  scoreTotal: number;
  categoriaMaisUrgente: Categoria;
  diasAtrasoMax: number; // maior diasAtraso entre os títulos do cliente
  mensagemConsolidada: string;
}
