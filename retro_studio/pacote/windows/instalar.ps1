# Instala o Retro Studio no Windows para o usuário atual, sem precisar de administrador:
#   editor, Java mínimo e jogo de exemplo em %LOCALAPPDATA%\Programs\RetroStudio (atalho no menu Iniciar
#   e na área de trabalho, e entrada em Aplicativos instalados para desinstalar);
#   kit SGDK em %USERPROFILE%\.retrostudio\toolkit\sgdk (ou C:\RetroStudio\toolkit\sgdk, quando a pasta do
#   usuário tem espaço ou acento: o make do SGDK não aceita esses caminhos) e BlastEm em
#   %USERPROFILE%\.retrostudio\emulators\blastem.
# O que já estiver instalado e funcionando é mantido; o que estiver quebrado é guardado de lado com outro
# nome e instalado de novo a partir do pacote. No fim, um projeto mínimo é compilado para conferir o kit.
#
# Uso (o Instalar.cmd chama este script):
#   instalar.ps1               instala (ou atualiza) e confere
#   instalar.ps1 -Reparar      confere e conserta o que faltar (o botão Reparar do editor usa este modo)
#   instalar.ps1 -Verificar    só confere e diz o que falta
#   instalar.ps1 -Desinstalar  remove o editor (o kit, o emulador e os projetos ficam)
param(
	[switch]$Reparar,
	[switch]$Verificar,
	[switch]$Desinstalar
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$Destino = if ($env:RETRO_STUDIO_DESTINO) { $env:RETRO_STUDIO_DESTINO } else { Join-Path $env:LOCALAPPDATA 'Programs\RetroStudio' }
$Casa = $env:USERPROFILE
$Emulador = Join-Path $Casa '.retrostudio\emulators\blastem'
# O make e o sh do SGDK quebram com espaço ou acento no caminho: nesse caso o kit vai para a raiz do disco.
if ($Casa -match '[^A-Za-z0-9_\-\.:\\]') {
	$Kit = Join-Path $env:SystemDrive 'RetroStudio\toolkit\sgdk'
} else {
	$Kit = Join-Path $Casa '.retrostudio\toolkit\sgdk'
}
$Modo = 'instalar'
if ($Reparar) { $Modo = 'reparar' }
if ($Verificar) { $Modo = 'verificar' }
if ($Desinstalar) { $Modo = 'desinstalar' }

$script:Problemas = New-Object System.Collections.Generic.List[string]
function Ok($texto) { Write-Host "  [ok] $texto" }
function Aviso($texto) { Write-Host "  [!]  $texto" }
function Problema($texto) { $script:Problemas.Add($texto); Write-Host "  [x]  $texto" }
function Carimbo { Get-Date -Format 'yyyyMMdd-HHmmss' }

function Guardar-DeLado($pasta) {
	# Nunca apaga o que o usuário tinha: renomeia para <pasta>.antigo-<data>.
	if (Test-Path -LiteralPath $pasta) {
		$antigo = "$pasta.antigo-$(Carimbo)"
		Move-Item -LiteralPath $pasta -Destination $antigo
		Aviso "A versão anterior ficou guardada em $antigo (pode apagar se tudo funcionar)."
	}
}

function Roda($programa, $argumentos) {
	# Roda um programa e diz se terminou bem (sem deixar o erro do PowerShell aparecer).
	try {
		$saida = & $programa @argumentos 2>&1
		return ($LASTEXITCODE -eq 0)
	} catch {
		return $false
	}
}

function Kit-Funciona {
	(Test-Path (Join-Path $Kit 'makefile.gen')) -and (Test-Path (Join-Path $Kit 'bin\rescomp.jar')) -and
		(Roda (Join-Path $Kit 'bin\gcc.exe') @('--version'))
}
function Java-DoRetroStudio($app) {
	$java = Join-Path $app 'kit\jre\bin\java.exe'
	(Test-Path $java) -and (Roda $java @('-version'))
}

# Pasta do editor em uso: a instalada ou, para -Reparar/-Verificar rodados do pacote sem instalar, a do pacote.
$App = $Destino
if ($Modo -ne 'instalar' -and (Test-Path (Join-Path $Aqui 'retro-studio.exe')) -and ($Aqui -ne $Destino)) {
	$App = $Aqui
}

# ---------------------------------------------------------------------------------------------------
if ($Modo -eq 'desinstalar') {
	Write-Host "Removendo o editor de $Destino..."
	foreach ($item in @('retro-studio.exe', 'retro-studio.console.exe', 'kit', 'docs', 'licencas', 'teste_kit', 'retro-studio.ico')) {
		$caminho = Join-Path $Destino $item
		if (Test-Path -LiteralPath $caminho) { Remove-Item -LiteralPath $caminho -Recurse -Force }
	}
	$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Retro Studio.lnk'
	$mesa = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Retro Studio.lnk'
	foreach ($atalho in @($menu, $mesa)) { if (Test-Path $atalho) { Remove-Item $atalho -Force } }
	Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RetroStudio' -Recurse -ErrorAction SilentlyContinue
	Write-Host "Pronto. Ficaram: o jogo de exemplo ($Destino\jogo_padrao), este instalador, o kit ($Kit),"
	Write-Host "o emulador ($Emulador) e as configurações (%APPDATA%\RetroStudio)."
	exit 0
}

Write-Host '== Sistema =='
if (-not [Environment]::Is64BitOperatingSystem) {
	Problema 'Este pacote é para Windows de 64 bits.'
	exit 1
}
$versao = [Environment]::OSVersion.Version
if ($versao.Major -lt 10) {
	Problema "O Retro Studio precisa do Windows 10 ou mais novo (este é o $versao)."
	exit 1
}
Ok "Windows $versao de 64 bits."
if ($Kit -notlike "$Casa*") {
	Aviso "A pasta do usuário ($Casa) tem espaço ou acento: o kit fica em $Kit."
}
if ($Modo -ne 'verificar') {
	$disco = Get-PSDrive -Name ($Casa.Substring(0, 1)) -ErrorAction SilentlyContinue
	if ($disco -and $disco.Free -lt 1GB) {
		Aviso "Só $([math]::Round($disco.Free / 1MB)) MB livres; o kit e o emulador ocupam uns 300 MB."
	}
}

# ---------------------------------------------------------------------------------------------------
Write-Host '== Editor =='
if ($Modo -eq 'instalar') {
	if (-not (Test-Path (Join-Path $Aqui 'retro-studio.exe'))) {
		Write-Host "Rode o Instalar.cmd da pasta do pacote descompactado (falta $Aqui\retro-studio.exe)."
		exit 1
	}
	New-Item -ItemType Directory -Force -Path $Destino | Out-Null
	# Com o editor aberto o .exe fica travado: pede para fechar em vez de falhar no meio.
	$exe = Join-Path $Destino 'retro-studio.exe'
	if (Test-Path $exe) {
		try { [System.IO.File]::Open($exe, 'Open', 'ReadWrite', 'None').Close() } catch {
			Write-Host 'Feche o Retro Studio antes de instalar (o editor está aberto).'
			exit 1
		}
	}
	foreach ($item in @('retro-studio.exe', 'retro-studio.console.exe', 'retro-studio.ico', 'instalar.ps1', 'Instalar.cmd', 'LEIA-ME.txt', 'LICENCAS.txt')) {
		$origem = Join-Path $Aqui $item
		if ((Test-Path $origem) -and ($Aqui -ne $Destino)) { Copy-Item $origem $Destino -Force }
	}
	foreach ($pasta in @('docs', 'licencas', 'teste_kit', 'modelos')) {
		$alvo = Join-Path $Destino $pasta
		if (Test-Path $alvo) { Remove-Item $alvo -Recurse -Force }
		# Os modelos do "Novo projeto" vêm nos pacotes a partir da 1.0.3.
		if (Test-Path (Join-Path $Aqui $pasta)) { Copy-Item (Join-Path $Aqui $pasta) $alvo -Recurse }
	}
	# O Java do pacote substitui o da instalação anterior.
	if (Test-Path (Join-Path $Aqui 'kit\jre')) {
		$jre = Join-Path $Destino 'kit\jre'
		if (Test-Path $jre) { Remove-Item $jre -Recurse -Force }
		New-Item -ItemType Directory -Force -Path (Join-Path $Destino 'kit') | Out-Null
		Copy-Item (Join-Path $Aqui 'kit\jre') $jre -Recurse
	}
	# O jogo de exemplo é uma cópia para estudar; uma cópia já instalada (talvez editada) não é trocada.
	if (Test-Path (Join-Path $Destino 'jogo_padrao')) {
		Ok "Jogo de exemplo mantido em $Destino\jogo_padrao."
	} else {
		Copy-Item (Join-Path $Aqui 'jogo_padrao') (Join-Path $Destino 'jogo_padrao') -Recurse
	}
	# Atalhos no menu Iniciar e na área de trabalho.
	$shell = New-Object -ComObject WScript.Shell
	foreach ($pastaAtalho in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
		$atalho = $shell.CreateShortcut((Join-Path $pastaAtalho 'Retro Studio.lnk'))
		$atalho.TargetPath = $exe
		$atalho.Arguments = '--project-manager'
		$atalho.WorkingDirectory = $Destino
		$atalho.Description = 'Jogos de Mega Drive em cenas'
		if (Test-Path (Join-Path $Destino 'retro-studio.ico')) { $atalho.IconLocation = (Join-Path $Destino 'retro-studio.ico') }
		$atalho.Save()
	}
	# Em Configurações > Aplicativos instalados, com o desinstalar.
	$chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RetroStudio'
	New-Item -Path $chave -Force | Out-Null
	Set-ItemProperty $chave DisplayName 'Retro Studio'
	Set-ItemProperty $chave Publisher 'Retro Studio'
	Set-ItemProperty $chave DisplayIcon $exe
	Set-ItemProperty $chave InstallLocation $Destino
	Set-ItemProperty $chave UninstallString "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Destino\instalar.ps1`" -Desinstalar"
	Set-ItemProperty $chave NoModify 1 -Type DWord
	Set-ItemProperty $chave NoRepair 1 -Type DWord
}
$exeEmUso = Join-Path $App 'retro-studio.exe'
if (Test-Path $exeEmUso) {
	if ($App -eq $Destino) { Ok "Editor em $Destino (atalhos no menu Iniciar e na área de trabalho)." }
	else { Ok "Editor do pacote em $Aqui (não instalado; para instalar, rode o Instalar.cmd)." }
} else {
	Problema "O editor não está instalado em ${Destino}: rode o Instalar.cmd da pasta do pacote."
}

# ---------------------------------------------------------------------------------------------------
Write-Host '== Java =='
# O rescomp do SGDK é um programa Java; o pacote traz um Java só com o necessário.
if (Java-DoRetroStudio $App) {
	Ok 'Java do Retro Studio.'
} elseif (Get-Command java -ErrorAction SilentlyContinue) {
	Ok 'Java do sistema.'
} else {
	Problema 'Falta o Java (o SGDK usa para converter imagens e sons). Rode o Instalar.cmd do pacote de novo.'
}

# ---------------------------------------------------------------------------------------------------
Write-Host '== Kit SGDK =='
$kitDoPacote = Join-Path $Aqui 'kit\sgdk'
if (Kit-Funciona) {
	Ok "Kit em $Kit."
	# Uma versão nova do pacote atualiza o kit (o antigo fica guardado).
	$versaoNova = Join-Path $kitDoPacote 'retro-studio-kit.txt'
	$versaoAtual = Join-Path $Kit 'retro-studio-kit.txt'
	if ($Modo -eq 'instalar' -and (Test-Path $versaoNova) -and ((-not (Test-Path $versaoAtual)) -or ((Get-Content $versaoNova -Raw) -ne (Get-Content $versaoAtual -Raw)))) {
		Guardar-DeLado $Kit
		New-Item -ItemType Directory -Force -Path (Split-Path $Kit) | Out-Null
		Copy-Item $kitDoPacote $Kit -Recurse
		if (Kit-Funciona) { Ok "Kit atualizado para a versão do pacote." } else { Problema "O kit novo em $Kit não roda." }
	}
} elseif ($Modo -eq 'verificar') {
	Problema "O kit em $Kit está faltando ou incompleto."
} elseif (Test-Path $kitDoPacote) {
	if (Test-Path $Kit) { Aviso "O kit em $Kit está incompleto ou não roda; vou instalar de novo." }
	Guardar-DeLado $Kit
	New-Item -ItemType Directory -Force -Path (Split-Path $Kit) | Out-Null
	Copy-Item $kitDoPacote $Kit -Recurse
	if (Kit-Funciona) { Ok "Kit instalado em $Kit." } else { Problema "O kit em $Kit não roda nesta máquina (gcc --version falhou)." }
} else {
	Problema "O kit em $Kit está faltando e o pacote não o traz: rode o Instalar.cmd da pasta do pacote."
}

# ---------------------------------------------------------------------------------------------------
Write-Host '== Emulador BlastEm =='
$emuladorDoPacote = Join-Path $Aqui 'kit\blastem'
$blastem = Join-Path $Emulador 'blastem.exe'
if (-not (Test-Path $blastem) -and $Modo -ne 'verificar' -and (Test-Path $emuladorDoPacote)) {
	Guardar-DeLado $Emulador
	New-Item -ItemType Directory -Force -Path (Split-Path $Emulador) | Out-Null
	Copy-Item $emuladorDoPacote $Emulador -Recurse
}
if (Test-Path $blastem) { Ok "BlastEm em $Emulador." } else { Problema "O emulador não está em $Emulador." }

# ---------------------------------------------------------------------------------------------------
# Conferência final: compila um projeto mínimo com o kit e o Java que o editor vai usar.
if ($script:Problemas.Count -eq 0 -and $Modo -ne 'verificar' -and (Test-Path (Join-Path $App 'teste_kit'))) {
	Write-Host '== Conferência: compilando um projeto de teste =='
	$teste = Join-Path ([System.IO.Path]::GetTempPath()) "retro-studio-teste-$(Carimbo)"
	Copy-Item (Join-Path $App 'teste_kit') $teste -Recurse
	$pathAntigo = $env:PATH
	$env:PATH = "$Kit\bin;$App\kit\jre\bin;$env:PATH"
	$env:GDK = $Kit.Replace('\', '/')
	$log = "$teste.log"
	& (Join-Path $Kit 'bin\make.exe') -C $teste.Replace('\', '/') *> $log
	$codigo = $LASTEXITCODE
	$env:PATH = $pathAntigo
	if ($codigo -eq 0 -and (Test-Path (Join-Path $teste 'out\rom.bin'))) {
		Ok 'O kit compilou uma ROM de teste.'
		Remove-Item $teste -Recurse -Force
		Remove-Item $log -Force
	} else {
		Problema "A compilação de teste falhou; o log está em $log (últimas linhas abaixo)."
		Get-Content $log -Tail 8 | ForEach-Object { Write-Host "      $_" }
		Remove-Item $teste -Recurse -Force -ErrorAction SilentlyContinue
	}
}

# ---------------------------------------------------------------------------------------------------
Write-Host ''
if ($script:Problemas.Count -eq 0) {
	Write-Host 'Tudo pronto.'
	if ($Modo -eq 'instalar') {
		Write-Host 'Abra pelo atalho Retro Studio no menu Iniciar ou na área de trabalho.'
		Write-Host "O jogo de exemplo está em $Destino\jogo_padrao (botão Importar do gerenciador de projetos)."
	}
	exit 0
}
Write-Host 'Ficou faltando:'
foreach ($item in $script:Problemas) { Write-Host "  - $item" }
exit 1
