/* global window */

const statusDot  = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(status, message) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = message;
}

function onPrinterTypeChange() {
  const type    = document.getElementById('printerType').value;
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

function getCurrentConfig() {
  return {
    type:      document.getElementById('printerType').value,
    interface: getActiveInterface(),
    model:     document.getElementById('printerModel').value,
  };
}

async function loadConfig() {
  try {
    const config = await window.api.getConfig();
    document.getElementById('apiUrl').value      = config.apiUrl      || '';
    document.getElementById('agentToken').value  = config.agentToken  || '';
    document.getElementById('printerType').value = config.printerType || 'usb';
    document.getElementById('printerModel').value = config.printerModel || 'epson';

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
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando...';

  const config = {
    apiUrl:           document.getElementById('apiUrl').value.trim().replace(/\/$/, ''),
    agentToken:       document.getElementById('agentToken').value.trim(),
    printerType:      document.getElementById('printerType').value,
    printerInterface: getActiveInterface(),
    printerName:      document.getElementById('printerName').value.trim(),
    printerModel:     document.getElementById('printerModel').value,
    autoStart:        document.getElementById('autoStart').checked,
  };

  try {
    await window.api.saveConfig(config);
    setStatus('polling', 'Configuração salva — conectando ao painel...');
    saveBtn.textContent = '✓ Salvo!';
    setTimeout(() => { saveBtn.textContent = 'Salvar e conectar'; saveBtn.disabled = false; }, 2000);
  } catch (err) {
    setStatus('error', 'Erro ao salvar: ' + (err.message || 'desconhecido'));
    saveBtn.textContent = 'Salvar e conectar';
    saveBtn.disabled = false;
  }
}

async function testPrinter() {
  const btn    = document.getElementById('testBtn');
  const result = document.getElementById('testResult');

  btn.disabled = true;
  btn.textContent = 'Testando...';
  result.className = 'test-result';

  const config = getCurrentConfig();

  if (!config.interface) {
    result.className = 'test-result fail';
    result.textContent = '✗ Preencha a porta USB ou o IP da impressora antes de testar.';
    btn.disabled = false;
    btn.textContent = 'Testar impressora';
    return;
  }

  try {
    const res = await window.api.testPrinter(config);
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

async function detectUsb() {
  const btn          = document.getElementById('detectBtn');
  const list         = document.getElementById('detectedList');

  btn.disabled = true;
  btn.textContent = '🔍 Detectando...';
  list.innerHTML = '';
  list.className = 'detected-list';

  try {
    const res = await window.api.detectUsbPrinters();
    const printers = res.printers || [];

    if (printers.length === 0) {
      list.className = 'detected-list visible';
      list.innerHTML = '<div style="font-size:12px;color:#ef4444;padding:6px 0">Nenhuma impressora USB encontrada. Verifique se está ligada e o cabo conectado.</div>';
    } else {
      list.className = 'detected-list visible';
      for (const p of printers) {
        const item = document.createElement('div');
        item.className = 'detected-item';
        item.innerHTML = `<span class="port-badge">${p.portName}</span><span>${p.label}</span>`;
        item.addEventListener('click', () => {
          document.getElementById('printerInterface').value = p.port;
          // Destaca o selecionado
          document.querySelectorAll('.detected-item').forEach(el => el.style.background = '');
          item.style.background = '#eff6ff';
        });
        list.appendChild(item);
      }
    }
  } catch (err) {
    list.className = 'detected-list visible';
    list.innerHTML = `<div style="font-size:12px;color:#ef4444;padding:6px 0">Erro na detecção: ${err.message || 'desconhecido'}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Detectar USB';
  }
}

// Atualiza status em tempo real do processo principal
window.api.onStatus((status, message) => {
  setStatus(status, message);
});

// Carrega configuração ao abrir
loadConfig();
