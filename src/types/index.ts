export type StatusTitulo = 'aberto' | 'pago' | 'promessa' | 'sem_resposta';
export type Categoria = 'preventivo' | 'atraso_leve' | 'atraso_longo';

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
  data_promessa: string | null;
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
}
