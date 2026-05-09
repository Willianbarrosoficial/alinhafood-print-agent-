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
- Impressora térmica ESC/POS (Elgin, Epson, Bematech, Daruma, Tanca, etc.)

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
   - **Tipo de conexão**: USB ou Rede (TCP/IP)
   - **Interface**: `//./USB001` para USB, ou `192.168.1.100:9100` para rede
4. Clique em "Testar impressora" para verificar a conexão
5. Clique em "Salvar e conectar"

## Ícones (assets/)

Coloque os seguintes arquivos PNG (32x32) na pasta `assets/`:
- `icon-green.png` — agente conectado/aguardando
- `icon-red.png` — erro de conexão
- `icon-gray.png` — desconectado/sem config
- `icon.ico` — ícone do instalador Windows (256x256)
- `icon.icns` — ícone macOS (opcional)
