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

O instalador é gerado em `release/AlinhafoodPrintAgent-Setup-1.0.0.exe`.

Copie o `.exe` para `Alinhafood 01/public/downloads/AlinhafoodPrintAgent-Setup.exe`
para disponibilizá-lo no link de download do painel admin.

## ⚠️ Windows bloqueando o instalador (SmartScreen / Smart App Control)

O Windows pode bloquear o instalador com uma das seguintes mensagens:
- "O Windows protegeu o computador" (SmartScreen)
- "Um controle de inteligência bloqueou o aplicativo" (Smart App Control)
- "Este aplicativo não é seguro" (Windows Defender)

Isso acontece porque o instalador **não possui certificado de assinatura digital**
(code signing), o que é necessário para que o Windows confie no executável.

### Solução rápida — Instalação assistida

Use os scripts incluídos no projeto que desbloqueiam o instalador automaticamente:

**Opção 1 — Script BAT (mais simples):**
1. Clique direito em `instalar.bat`
2. Selecione **"Executar como administrador"**
3. O script desbloqueia o arquivo e inicia a instalação

**Opção 2 — Script PowerShell (mais completo):**
1. Clique direito em `desbloquear-e-instalar.ps1`
2. Selecione **"Executar com PowerShell"** (como admin)
3. O script verifica SmartScreen, Smart App Control, configura exclusões no Defender

### Solução manual — Bypass do SmartScreen

Se preferir instalar manualmente:

1. Clique direito no `.exe` → **Propriedades**
2. Na aba "Geral", marque **"Desbloquear"** no canto inferior → **OK**
3. Execute o instalador novamente
4. Se aparecer a tela do SmartScreen:
   - Clique em **"Mais informações"**
   - Clique em **"Executar assim mesmo"**

### Solução manual — Smart App Control (Windows 11)

Se o erro for do **Smart App Control** (diferente do SmartScreen):

1. Abra **Configurações** → **Privacidade e segurança** → **Segurança do Windows**
2. Clique em **Controle de aplicativos e navegador**
3. Em **Smart App Control**, mude para **"Desativado"**

> **Aviso:** Desativar o Smart App Control é permanente e não pode ser revertido
> sem reinstalar o Windows. Considere isso antes de desativar.

### Solução manual — Exclusão no Windows Defender

Para evitar que o Defender bloqueie o app após a instalação:

1. Abra **Segurança do Windows** → **Proteção contra vírus e ameaças**
2. Em "Configurações", clique em **Gerenciar configurações**
3. Role até **Exclusões** → **Adicionar ou remover exclusões**
4. Adicione a pasta: `C:\Program Files\Alinhafood Print Agent`

### Solução definitiva — Certificado Code Signing

Para eliminar todos os avisos do Windows, adquira um certificado EV Code Signing
de uma autoridade certificadora (Sectigo, DigiCert, GlobalSign — ~$300-500/ano).

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
