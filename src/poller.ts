import { printReceipt } from './printer';
import { store } from './store';

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 3;

interface PrintJob {
  id: string;
  order_id: string;
  copies: number;
  payload: {
    receipt_text: string;
    order_id: string;
    restaurant_name: string;
    total: number;
    customer_name: string;
    order_type: string;
  };
  attempts: number;
  created_at: string;
}

export type PollerStatus = 'idle' | 'polling' | 'printing' | 'error' | 'disconnected';
type StatusCallback = (status: PollerStatus, message: string) => void;

let pollerTimer: ReturnType<typeof setInterval> | null = null;
let onStatusChange: StatusCallback | null = null;

function emit(status: PollerStatus, message: string) {
  onStatusChange?.(status, message);
}

async function fetchJobs(): Promise<PrintJob[]> {
  const apiUrl = store.get('apiUrl');
  const token = store.get('agentToken');
  if (!apiUrl || !token) return [];

  const res = await fetch(`${apiUrl}/api/print/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    emit('error', 'Token inválido. Verifique o token no painel admin.');
    return [];
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { jobs: PrintJob[] };
  return json.jobs ?? [];
}

async function markJob(jobId: string, status: 'completed' | 'failed', errorMessage?: string): Promise<void> {
  const apiUrl = store.get('apiUrl');
  const token = store.get('agentToken');

  await fetch(`${apiUrl}/api/print/jobs/${jobId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, error_message: errorMessage }),
  });
}

async function processJob(job: PrintJob): Promise<void> {
  const printerType = store.get('printerType');
  const printerInterface = store.get('printerInterface');
  const printerModel = store.get('printerModel');

  if (!printerInterface) {
    await markJob(job.id, 'failed', 'Impressora não configurada no agente');
    emit('error', 'Impressora não configurada. Abra as configurações e selecione a impressora.');
    return;
  }

  emit('printing', `Imprimindo pedido #${job.order_id.slice(0, 8).toUpperCase()}...`);

  try {
    const printerName = (store.get('printerName') ?? '').trim() || undefined;
    await printReceipt(
      job.payload.receipt_text,
      { type: printerType, interface: printerInterface, model: printerModel, printerName },
      Math.min(job.copies, 5)
    );

    await markJob(job.id, 'completed');
    emit('polling', `Pedido #${job.order_id.slice(0, 8).toUpperCase()} impresso com sucesso`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    if (job.attempts + 1 >= MAX_ATTEMPTS) {
      await markJob(job.id, 'failed', message);
      emit('error', `Falha ao imprimir após ${MAX_ATTEMPTS} tentativas: ${message}`);
    } else {
      emit('error', `Erro ao imprimir (tentativa ${job.attempts + 1}): ${message}`);
    }
  }
}

async function poll(): Promise<void> {
  const apiUrl = store.get('apiUrl');
  const token = store.get('agentToken');

  if (!apiUrl || !token) {
    emit('disconnected', 'Configure a URL do painel e o token para começar');
    return;
  }

  try {
    const jobs = await fetchJobs();
    if (jobs.length === 0) {
      emit('polling', 'Conectado — aguardando pedidos...');
      return;
    }
    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de rede';
    emit('error', `Erro ao conectar: ${message}`);
  }
}

export function startPoller(callback: StatusCallback): void {
  onStatusChange = callback;
  if (pollerTimer) return;

  void poll();
  pollerTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
}

export function restartPoller(callback?: StatusCallback): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  if (callback) onStatusChange = callback;
  void poll();
  pollerTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
}

export function stopPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  onStatusChange = null;
}
