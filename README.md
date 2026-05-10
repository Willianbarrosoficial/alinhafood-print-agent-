# Alinhafood Print Agent

Agente desktop para impressão automática de notinhas térmicas no Windows.

## Como funciona

1. O restaurante aceita um pedido no painel admin
2. O Next.js cria um `print_job` no Supabase
3. Este agente (rodando no Windows do restaurante) consulta a API a cada 3 segundos
4. Quando encontra um job pendente, imprime via ESC/POS e marca como concluído

## Pré-requisitos

- Node.js 18+ (para build)
- Windows 10/11 (para o executável final)
- .NET SDK ou Build Tools com `csc.exe` (para gerar o helper RAW na build Windows)
- Impressora térmica ESC/POS (Elgin, Epson, Bematech, Daruma, Tanca, etc.)

## Impressão USB/Bluetooth no Windows

Para impressoras instaladas no Windows, incluindo USB e Bluetooth pareadas com
driver/fila de impressão, o agente prioriza um helper nativo
`AlinhafoodRawPrinter.exe`, empacotado no instalador, que envia os bytes ESC/POS
ao spooler com `pDataType="RAW"`.

A detecção lista as filas reais do Windows com nome, porta, driver, status,
tipo de conexão e destaque para impressoras provavelmente térmicas ESC/POS.
Impressoras virtuais comuns, como PDF/XPS/Fax/OneNote, são ocultadas da lista.

Quando a impressora Bluetooth não aparece como fila do Windows, mas cria uma
porta serial, use o modo **Bluetooth Serial (porta COM)**. O agente configura a
porta com `mode.com` e envia ESC/POS diretamente para `COMx`. A configuração é
salva no formato `COM5:9600`, usando `9600` como velocidade padrão.

Se o helper não estiver disponível, o agente ainda faz fallback para `print.exe`.
Esse fallback existe por compatibilidade, mas o caminho recomendado para produção
é validar a impressão física usando a build Windows com o helper RAW incluído.

## Desenvolvimento

```bash
npm install
npm start
```

## Gerar instalador Windows (.exe)

```bash
npm run dist
```

O instalador é gerado em `release/Alinhafood Print Agent Setup 1.0.0.exe`.

Copie o `.exe` para `Alinhafood 01/public/downloads/AlinhafoodPrintAgent-Setup.exe`
para disponibilizá-lo no link de download do painel admin.

## Assinatura digital do Windows

Para distribuição em clientes, gere o instalador com um certificado de code signing.
Sem assinatura, o Windows Defender/SmartScreen pode bloquear o app por reputação baixa,
principalmente por ser um app Electron que acessa a fila de impressão local.

Configure estas variáveis no ambiente de build antes de rodar `npm run dist:win`:

```bash
WIN_CSC_LINK=/caminho/para/certificado.pfx
WIN_CSC_KEY_PASSWORD=senha_do_certificado
```

No CI, salve essas variáveis como secrets. O `electron-builder` assina o `.exe`
automaticamente quando encontra o certificado configurado.

## Configuração após instalar

1. Abra o programa — aparece na bandeja do sistema (canto inferior direito)
2. Clique 2x no ícone para abrir as configurações
3. Preencha:
   - **URL do painel**: endereço do site do restaurante (ex: `https://seurestaurante.alinhafood.com.br`)
   - **Token**: gerado em Admin → Impressora → Agente de Impressão → "Gerar token"
   - **Tipo de conexão**: Impressora instalada no Windows, Bluetooth Serial (COM) ou Rede (TCP/IP)
   - **Interface**: selecione pela detecção do Windows, use `COM5:9600` para serial, ou `192.168.1.100:9100` para rede
4. Clique em "Testar impressora" para verificar a conexão
5. Clique em "Salvar e conectar"

## Ícones (assets/)

Coloque os seguintes arquivos PNG (32x32) na pasta `assets/`:
- `icon-green.png` — agente conectado/aguardando
- `icon-red.png` — erro de conexão
- `icon-gray.png` — desconectado/sem config
- `icon.ico` — ícone do instalador Windows (256x256)
- `icon.icns` — ícone macOS (opcional)
