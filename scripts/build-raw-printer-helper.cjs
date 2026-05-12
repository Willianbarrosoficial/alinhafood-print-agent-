const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'bin', 'win-x64');
const helperDir = path.join(rootDir, 'tools', 'raw-printer-helper');
const sourceFile = path.join(helperDir, 'AlinhafoodRawPrinter.cs');
const projectFile = path.join(helperDir, 'AlinhafoodRawPrinter.csproj');
const exeFile = path.join(outDir, 'AlinhafoodRawPrinter.exe');

fs.mkdirSync(outDir, { recursive: true });

if (process.env.ALINHAFOOD_SKIP_RAW_HELPER_BUILD === '1') {
  console.log('[raw-helper] Build do helper RAW ignorado por ALINHAFOOD_SKIP_RAW_HELPER_BUILD=1.');
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.log(`[raw-helper] Build do helper Windows ignorado em ${process.platform}.`);
  process.exit(0);
}

if (!fs.existsSync(sourceFile)) {
  console.error(`[raw-helper] Fonte nao encontrada: ${sourceFile}`);
  process.exit(1);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function commandExists(command) {
  const probe = run('where.exe', [command]);
  return probe.status === 0
    ? probe.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
}

function existingFiles(paths) {
  return paths.filter((filePath) => filePath && fs.existsSync(filePath));
}

function getDotnetCandidates() {
  return [
    ...commandExists('dotnet'),
    ...existingFiles([
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'dotnet', 'dotnet.exe'),
    ]),
  ];
}

function compileWithCsc(cscPath) {
  const result = run(cscPath, [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    `/out:${exeFile}`,
    sourceFile,
  ]);

  if (result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(detail || 'csc.exe retornou erro sem detalhes');
  }
}

function compileWithDotnet(dotnetPath) {
  const result = run(dotnetPath, [
    'publish',
    projectFile,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'false',
    '-p:UseAppHost=true',
    '-o',
    outDir,
  ]);

  if (result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(detail || 'dotnet publish retornou erro sem detalhes');
  }
}

try {
  const cscCandidates = [
    ...commandExists('csc.exe'),
    ...commandExists('csc'),
  ];
  const dotnetCandidates = getDotnetCandidates();

  if (cscCandidates.length > 0) {
    compileWithCsc(cscCandidates[0]);
    console.log(`[raw-helper] Helper RAW compilado com csc.exe em ${exeFile}`);
  } else if (dotnetCandidates.length > 0) {
    compileWithDotnet(dotnetCandidates[0]);
    console.log(`[raw-helper] Helper RAW compilado com dotnet publish em ${exeFile}`);
  } else {
    throw new Error(
      'Nenhum compilador C# encontrado. Instale o .NET SDK (dotnet) ou Build Tools com csc.exe para gerar o helper RAW.'
    );
  }

  if (!fs.existsSync(exeFile)) {
    throw new Error(`Compilacao concluida, mas o executavel nao foi encontrado em ${exeFile}`);
  }
} catch (error) {
  console.error('[raw-helper] Falha ao gerar helper RAW.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
