/* global window */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(status, message) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = message;
}

function onPrinterTypeChange() {
  const type = document.getElementById('printerType').value;
  const label = document.getElementById('interfaceLabel');
  const input = document.getElementById('printerInterface');
  const hint = document.getElementById('interfaceHint');

  if (type === 'tcp') {
    label.textContent = 'IP e porta da impressora';
    input.placeholder = 'Ex: 192.168.1.100:9100';
    hint.textContent = 'IP da impressora na rede local seguido da porta (geralmente 9100)';
  } else {
    label.textContent = 'Interface USB';
    input.placeholder = 'Ex: //./USB001';
    hint.textContent = 'No Windows use //./USB001, //./USB002, etc. Verifique no Gerenciador de Dispositivos';
  }
}

async function loadConfig() {
  try {
    const config = await window.api.getConfig();
    document.getElementById('apiUrl').value = config.apiUrl || '';
    document.getElementById('agentToken').value = config.agentToken || '';
    document.getElementById('printerType').value = config.printerType || 'usb';
    document.getElementById('printerInterface').value = config.printerInterface || '';
    document.getElementById('printerName').value = config.printerName || '';
    document.getElementById('autoStart').checked = config.autoStart !== false;

    onPrinterTypeChange();

    if (config.currentStatus && config.currentMessage) {
      setStatus(config.currentStatus, config.currentMessage);
    }
  } catch (err) {
    console.error('Erro ao carregar config:', err);
  }
}

async function saveConfig() {
  const config = {
    apiUrl: document.getElementById('apiUrl').value.trim().replace(/\/$/, ''),
    agentToken: document.getElementById('agentToken').value.trim(),
    printerType: document.getElementById('printerType').value,
    printerInterface: document.getElementById('printerInterface').value.trim(),
    printerName: document.getElementById('printerName').value.trim(),
    autoStart: document.getElementById('autoStart').checked,
  };

  try {
    await window.api.saveConfig(config);
    setStatus('polling', 'Configuração salva — aguardando pedidos...');
  } catch (err) {
    setStatus('error', 'Erro ao salvar: ' + (err.message || 'desconhecido'));
  }
}

async function testPrinter() {
  const btn = document.getElementById('testBtn');
  const result = document.getElementById('testResult');
  btn.disabled = true;
  btn.textContent = 'Testando...';
  result.className = 'test-result';

  try {
    const res = await window.api.testPrinter();
    if (res.ok) {
      result.className = 'test-result ok';
      result.textContent = '✓ Impressora encontrada e respondendo!';
    } else {
      result.className = 'test-result fail';
      result.textContent = '✗ ' + (res.error || 'Impressora não respondeu');
    }
  } catch (err) {
    result.className = 'test-result fail';
    result.textContent = '✗ Erro: ' + (err.message || 'desconhecido');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Testar impressora';
  }
}

// Listen for live status updates from main process
window.api.onStatus((status, message) => {
  setStatus(status, message);
});

// Load config on start
loadConfig();
