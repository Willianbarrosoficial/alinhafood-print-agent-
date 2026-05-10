/* global window, document */

(function () {
  'use strict';

  // ─────────────── helpers ───────────────

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(status, message) {
    const dot  = $('statusDot');
    const text = $('statusText');
    if (dot)  dot.className = 'status-dot ' + status;
    if (text) text.textContent = message;
  }

  function getActiveInterface() {
    const type = $('printerType').value;
    if (type === 'tcp') return $('printerInterfaceTcp').value.trim();
    if (type === 'serial') {
      const port = $('printerInterfaceSerial').value.trim().toUpperCase();
      const baud = $('serialBaudRate').value;
      return port ? port + ':' + baud : '';
    }
    return $('printerInterface').value.trim();
  }

  function parseSerialInterface(value) {
    const match = String(value || '').trim().match(/^(?:[/\\]+\.?[/\\]+)?(COM\d+)(?::(\d+))?$/i);
    if (!match) return { port: '', baudRate: '9600' };
    return { port: match[1].toUpperCase(), baudRate: match[2] || '9600' };
  }

  function getCurrentPrinterConfig() {
    return {
      type:      $('printerType').value,
      interface: getActiveInterface(),
      model:     $('printerModel').value,
      printerName: $('printerName').value.trim(),
    };
  }

  function appendBadge(parent, className, text) {
    if (!text) return;
    const badge = document.createElement('span');
    badge.className = className;
    badge.textContent = text;
    parent.appendChild(badge);
  }

  function getStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized.includes('offline') || normalized.includes('parada')) return 'status-badge hot';
    if (normalized.includes('desconhecido') || normalized.includes('outro')) return 'status-badge warn';
    return 'status-badge';
  }

  function onPrinterTypeChange() {
    const type    = $('printerType').value;
    const usbInfo = $('usbInfo');
    const serialInfo = $('serialInfo');
    const tcpInfo = $('tcpInfo');
    if (type === 'tcp') {
      usbInfo.style.display = 'none';
      serialInfo.style.display = 'none';
      tcpInfo.style.display = 'block';
    } else if (type === 'serial') {
      usbInfo.style.display = 'none';
      serialInfo.style.display = 'block';
      tcpInfo.style.display = 'none';
    } else {
      usbInfo.style.display = 'block';
      serialInfo.style.display = 'none';
      tcpInfo.style.display = 'none';
    }
  }

  // ─────────────── ações ───────────────

  async function loadConfig() {
    if (!window.api) {
      console.error('window.api indisponível — preload não carregou');
      setStatus('error', 'Erro interno: preload não carregou');
      return;
    }
    try {
      const config = await window.api.getConfig();
      const printerType = config.printerType === 'usb' ? 'windows' : (config.printerType || 'windows');
      $('apiUrl').value         = config.apiUrl         || '';
      $('agentToken').value     = config.agentToken     || '';
      $('printerType').value    = printerType;
      $('printerModel').value   = config.printerModel   || 'epson';
      if (printerType === 'tcp') {
        $('printerInterfaceTcp').value = config.printerInterface || '';
      } else if (printerType === 'serial') {
        const serial = parseSerialInterface(config.printerInterface || '');
        $('printerInterfaceSerial').value = serial.port;
        $('serialBaudRate').value = serial.baudRate;
      } else {
        $('printerInterface').value = config.printerInterface || '';
      }
      $('printerName').value    = config.printerName || '';
      $('autoStart').checked    = config.autoStart !== false;

      onPrinterTypeChange();

      if (config.currentStatus && config.currentMessage) {
        setStatus(config.currentStatus, config.currentMessage);
      }
    } catch (err) {
      console.error('Erro ao carregar config:', err);
      setStatus('error', 'Erro ao carregar config: ' + (err && err.message ? err.message : err));
    }
  }

  async function saveConfig() {
    console.log('[saveConfig] iniciando...');
    const btn = $('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    const config = {
      apiUrl:           $('apiUrl').value.trim().replace(/\/$/, ''),
      agentToken:       $('agentToken').value.trim(),
      printerType:      $('printerType').value,
      printerInterface: getActiveInterface(),
      printerName:      $('printerName').value.trim(),
      printerModel:     $('printerModel').value,
      autoStart:        $('autoStart').checked,
    };

    try {
      const res = await window.api.saveConfig(config);
      console.log('[saveConfig] resultado:', res);
      setStatus('polling', 'Configuração salva — conectando ao painel...');
      btn.textContent = '✓ Salvo!';
      setTimeout(() => {
        btn.textContent = 'Salvar e conectar';
        btn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error('[saveConfig] erro:', err);
      setStatus('error', 'Erro ao salvar: ' + (err && err.message ? err.message : err));
      btn.textContent = 'Salvar e conectar';
      btn.disabled = false;
    }
  }

  async function testPrinter() {
    console.log('[testPrinter] iniciando...');
    const btn    = $('testBtn');
    const result = $('testResult');

    btn.disabled = true;
    btn.textContent = 'Imprimindo...';
    result.className = 'test-result info';
    result.textContent = '… enviando página de teste para a impressora …';

    const config = getCurrentPrinterConfig();
    console.log('[testPrinter] config:', config);

    if (!config.interface) {
      result.className = 'test-result fail';
      result.textContent = '✗ Selecione uma impressora, porta COM ou IP antes de testar.';
      btn.disabled = false;
      btn.textContent = '🖨️ Imprimir página de teste';
      return;
    }

    try {
      const res = await window.api.testPrinter(config);
      console.log('[testPrinter] resultado:', res);
      if (res.ok) {
        result.className = 'test-result ok';
        result.textContent = '✓ Página de teste enviada! Verifique se a impressora imprimiu.';
      } else {
        result.className = 'test-result fail';
        result.textContent = '✗ ' + (res.error || 'Impressora não respondeu');
      }
    } catch (err) {
      console.error('[testPrinter] erro:', err);
      result.className = 'test-result fail';
      result.textContent = '✗ Erro: ' + (err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
      btn.textContent = '🖨️ Imprimir página de teste';
    }
  }

  function renderDetectedPrinters(list, printers) {
    list.innerHTML = '';

    for (let i = 0; i < printers.length; i++) {
      const p = printers[i];
      const item = document.createElement('div');
      item.className = 'detected-item';

      const main = document.createElement('div');
      main.className = 'detected-main';

      const name = document.createElement('span');
      name.className = 'detected-name';
      name.textContent = p.printerName || p.label || p.portName;
      main.appendChild(name);

      if (p.isRecommended) appendBadge(main, 'detected-recommended', p.recommendationReason || 'provável térmica');
      if (p.isDefault) appendBadge(main, 'status-badge', 'padrão');
      item.appendChild(main);

      const meta = document.createElement('div');
      meta.className = 'detected-meta';
      appendBadge(meta, 'type-badge', p.connectionType || 'Windows');
      appendBadge(meta, 'port-badge', p.portName);
      appendBadge(meta, getStatusClass(p.printerStatus), p.printerStatus);
      item.appendChild(meta);

      if (p.driverName) {
        const driver = document.createElement('div');
        driver.className = 'detected-driver';
        driver.textContent = 'Driver: ' + p.driverName;
        item.appendChild(driver);
      }

      item.addEventListener('click', function () {
        if ($('printerType').value === 'serial') {
          const serial = parseSerialInterface(p.port || p.portName);
          $('printerInterfaceSerial').value = serial.port;
          $('serialBaudRate').value = serial.baudRate;
          $('printerName').value = '';
        } else {
          $('printerInterface').value = p.port;
          $('printerName').value = (p.printerName || '').trim();
        }
        const items = list.querySelectorAll('.detected-item');
        for (let j = 0; j < items.length; j++) items[j].classList.remove('selected');
        item.classList.add('selected');
      });

      list.appendChild(item);
    }
  }

  async function detectPrinters() {
    console.log('[detectPrinters] iniciando...');
    const btn  = $('detectBtn');
    const list = $('detectedList');

    btn.disabled = true;
    btn.textContent = '🔍 Detectando...';
    list.innerHTML = '';
    list.className = 'detected-list visible';
    list.innerHTML = '<div style="font-size:12px;color:#475569;padding:6px 0">… buscando impressoras instaladas no Windows …</div>';

    try {
      const detect = window.api.detectWindowsPrinters || window.api.detectUsbPrinters;
      const res = await detect();
      console.log('[detectPrinters] resultado:', res);
      const printers = (res && res.printers) || [];

      list.innerHTML = '';

      if (printers.length === 0) {
        list.innerHTML =
          '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
          'Nenhuma impressora instalada no Windows foi encontrada.<br>' +
          'Verifique se ela aparece em <strong>Dispositivos e Impressoras</strong>.' +
          '</div>';
        return;
      }

      renderDetectedPrinters(list, printers);
    } catch (err) {
      console.error('[detectPrinters] erro:', err);
      list.innerHTML =
        '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
        'Erro na detecção: ' + (err && err.message ? err.message : err) +
        '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Detectar impressoras';
    }
  }

  async function detectSerialPorts() {
    console.log('[detectSerialPorts] iniciando...');
    const btn  = $('serialDetectBtn');
    const list = $('serialDetectedList');

    btn.disabled = true;
    btn.textContent = '🔍 Detectando...';
    list.innerHTML = '';
    list.className = 'detected-list visible';
    list.innerHTML = '<div style="font-size:12px;color:#475569;padding:6px 0">… buscando portas COM …</div>';

    try {
      const res = await window.api.detectSerialPorts();
      console.log('[detectSerialPorts] resultado:', res);
      const ports = (res && res.printers) || [];
      list.innerHTML = '';

      if (ports.length === 0) {
        list.innerHTML =
          '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
          'Nenhuma porta COM encontrada.<br>' +
          'Confirme o pareamento Bluetooth e a porta de saída nas configurações do Windows.' +
          '</div>';
        return;
      }

      renderDetectedPrinters(list, ports);
    } catch (err) {
      console.error('[detectSerialPorts] erro:', err);
      list.innerHTML =
        '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
        'Erro na detecção: ' + (err && err.message ? err.message : err) +
        '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Detectar COM';
    }
  }

  // ─────────────── boot ───────────────

  function bindEvents() {
    console.log('[boot] api disponível?', !!window.api);

    $('printerType').addEventListener('change', onPrinterTypeChange);
    $('saveBtn').addEventListener('click', saveConfig);
    $('testBtn').addEventListener('click', testPrinter);
    $('detectBtn').addEventListener('click', detectPrinters);
    $('serialDetectBtn').addEventListener('click', detectSerialPorts);
    $('closeBtn').addEventListener('click', function () { window.close(); });
    $('clearBtn').addEventListener('click', async function () {
      if (!confirm('Limpar todas as configurações?')) return;
      await window.api.clearConfig();
      $('apiUrl').value = '';
      $('agentToken').value = '';
      $('printerInterface').value = '';
      $('printerInterfaceTcp').value = '';
      $('printerInterfaceSerial').value = '';
      $('serialBaudRate').value = '9600';
      $('printerName').value = '';
      setStatus('disconnected', 'Configurações limpas');
    });

    if (window.api && window.api.onStatus) {
      window.api.onStatus(function (status, message) {
        setStatus(status, message);
      });
    }

    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
