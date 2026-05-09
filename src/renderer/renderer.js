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
    return $('printerInterface').value.trim();
  }

  function getCurrentPrinterConfig() {
    return {
      type:      $('printerType').value,
      interface: getActiveInterface(),
      model:     $('printerModel').value,
      printerName: $('printerName').value.trim(),
    };
  }

  function onPrinterTypeChange() {
    const type    = $('printerType').value;
    const usbInfo = $('usbInfo');
    const tcpInfo = $('tcpInfo');
    if (type === 'tcp') {
      usbInfo.style.display = 'none';
      tcpInfo.style.display = 'block';
    } else {
      usbInfo.style.display = 'block';
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
      $('apiUrl').value         = config.apiUrl         || '';
      $('agentToken').value     = config.agentToken     || '';
      $('printerType').value    = config.printerType    || 'usb';
      $('printerModel').value   = config.printerModel   || 'epson';
      if (config.printerType === 'tcp') {
        $('printerInterfaceTcp').value = config.printerInterface || '';
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
      result.textContent = '✗ Preencha a porta USB ou o IP da impressora antes de testar.';
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

  async function detectUsb() {
    console.log('[detectUsb] iniciando...');
    const btn  = $('detectBtn');
    const list = $('detectedList');

    btn.disabled = true;
    btn.textContent = '🔍 Detectando...';
    list.innerHTML = '';
    list.className = 'detected-list visible';
    list.innerHTML = '<div style="font-size:12px;color:#475569;padding:6px 0">… buscando impressoras conectadas …</div>';

    try {
      const res = await window.api.detectUsbPrinters();
      console.log('[detectUsb] resultado:', res);
      const printers = (res && res.printers) || [];

      list.innerHTML = '';

      if (printers.length === 0) {
        list.innerHTML =
          '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
          'Nenhuma impressora USB encontrada.<br>' +
          'Verifique se a impressora está <strong>ligada</strong> e o <strong>cabo USB conectado</strong>.' +
          '</div>';
        return;
      }

      for (let i = 0; i < printers.length; i++) {
        const p = printers[i];
        const item = document.createElement('div');
        item.className = 'detected-item';

        const badge = document.createElement('span');
        badge.className = 'port-badge';
        badge.textContent = p.portName;
        item.appendChild(badge);

        const label = document.createElement('span');
        label.textContent = p.label;
        item.appendChild(label);

        item.addEventListener('click', function () {
          $('printerInterface').value = p.port;
          // Extrai o nome da impressora do label "Epson TM-T20 — USB001"
          const nameMatch = p.label.match(/^(.+?)\s+—\s+USB\d+/i);
          if (nameMatch) {
            $('printerName').value = nameMatch[1].trim();
          }
          const items = list.querySelectorAll('.detected-item');
          for (let j = 0; j < items.length; j++) items[j].classList.remove('selected');
          item.classList.add('selected');
        });

        list.appendChild(item);
      }
    } catch (err) {
      console.error('[detectUsb] erro:', err);
      list.innerHTML =
        '<div style="font-size:12px;color:#ef4444;padding:6px 0">' +
        'Erro na detecção: ' + (err && err.message ? err.message : err) +
        '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Detectar USB';
    }
  }

  // ─────────────── boot ───────────────

  function bindEvents() {
    console.log('[boot] api disponível?', !!window.api);

    $('printerType').addEventListener('change', onPrinterTypeChange);
    $('saveBtn').addEventListener('click', saveConfig);
    $('testBtn').addEventListener('click', testPrinter);
    $('detectBtn').addEventListener('click', detectUsb);
    $('closeBtn').addEventListener('click', function () { window.close(); });
    $('clearBtn').addEventListener('click', async function () {
      if (!confirm('Limpar todas as configurações?')) return;
      await window.api.clearConfig();
      $('apiUrl').value = '';
      $('agentToken').value = '';
      $('printerInterface').value = '';
      $('printerInterfaceTcp').value = '';
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
