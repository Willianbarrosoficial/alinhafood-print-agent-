/* global window */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(status, message) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = message;
}

function onPrinterTypeChange() {
  const type = document.getElementById('printerType').value;
  const usbInfo = document.getElementById('usbInfo');
  const tcpInfo = document.getElementById('tcpInfo');

  if (type === 'tcp') {
    usbInfo.style.display = 'none';
    tcpInfo.style.display = 'block';
  } else {
    usbInfo.style.display = 'block';
    tcpInfo.style.display = 'none';
  }
}

function getActiveInterface() {
  const type = document.getElementById('printerType').value;
  if (type === 'tcp') {
    return document.getElementById('printerInterfaceTcp').value.trim();
  }
  return document.getElementById('printerInterface').value.trim();
}

async function loadConfig() {
  try {
    const config = await window.api.getConfig();
    document.getElementById('apiUrl').value = config.apiUrl || '';
    document.getElementById('agentToken').value = config.agentToken || '';
    document.getElementById('printerType').value = config.printerType || 'usb';
    if (config.printerType === 'tcp') {
      document.getElementById('printerInterfaceTcp').value = config.printerInterface || '';
    } else {
      document.getElementById('printerInterface').value = config.printerInterface || '';
    }
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
    printerInterface: getActiveInterface(),
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
