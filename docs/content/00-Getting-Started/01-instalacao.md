---
title: Instalação do SGDK
description: Passo a passo para instalar o SGDK no seu computador
---

# 📦 Instalação do SGDK

## Preparar pelo Retro Studio (recomendado)

Na primeira abertura, a IDE verifica Java 17+, GNU Make, Node.js 18+, npm,
Python 3, Pillow, Git, SDL2 (Linux), o toolkit e o emulador. O painel também
fica disponível em **Configurações → Toolkit**.

Em Ubuntu/Debian, **Preparar ambiente** instala os pré-requisitos pelo
repositório do sistema; a autenticação ocorre na janela do próprio sistema.
O pacote `.deb` declara essas dependências para instalação pelo gerenciador
de pacotes. AppImage e instalações existentes usam a mesma verificação.

Depois, a preparação baixa e configura **MarsDev** e **Genesis Plus GX** pelo
catálogo da IDE, quando faltarem. Instalações válidas são reutilizadas;
pastas existentes incompletas e configurações alteradas durante o download
são preservadas e precisam ser conferidas no painel. Nada é gravado no jogo.

No Windows, instale as ferramentas de sistema indicadas; o painel pode
baixar toolkit e emulador quando os pré-requisitos estiverem prontos. No
macOS, a preparação é manual. Use **Verificar novamente** após ajustes.

Build, Play e builds pedidos pela IA conferem Java/Make e os geradores
Node/Python declarados no Makefile antes de executar a compilação ou limpeza.
Agentes ACP continuam opcionais; a IDE considera também os comandos
instalados nas pastas do usuário ao localizar executáveis.

## Windows

### Passo 1: Baixar o SGDK

1. Acesse [github.com/Stephane-D/SGDK](https://github.com/Stephane-D/SGDK)
2. Clique em **"Releases"** na lateral direita
3. Baixe a versão mais recente (ex: SGDK 2.xx)

### Passo 2: Descompactar

1. Crie uma pasta `C:\SGDK\` (ou outro local sem espaços)
2. Descompacte o arquivo baixado dentro dessa pasta
3. A estrutura deve ficar assim:
```
C:\SGDK\
├── bin\
├── inc\
├── lib\
├── src\
├── tools\
├── readme.md
└── ...
```

### Passo 3: Adicionar ao PATH (Variável de Ambiente)

1. Abra **Variáveis de Ambiente**:
   - Win + X → Opções avançadas do sistema
   - Clique em **"Variáveis de Ambiente"**

2. Em **Variáveis de usuário**, clique em **"Novo"**:
   - Nome da variável: `SGDK_PATH`
   - Valor: `C:\SGDK`

3. Edite a variável **Path**:
   - Clique em **"Path"** e depois **"Editar"**
   - Clique em **"Novo"** e adicione: `%SGDK_PATH%\bin`

4. Clique **OK** em todas as janelas

### Passo 4: Verificar Instalação

Abra o **Prompt de Comando** (Win + R, digite `cmd`):

```bash
m68k-elf-gcc --version
```

Se aparecer uma versão, você está pronto! ✅

---

## Mac

### Usando Homebrew

```bash
brew install sgdk
```

Se Homebrew não tem o SGDK, instale manualmente:

```bash
cd ~
git clone https://github.com/Stephane-D/SGDK.git
cd SGDK
make
```

Depois adicione ao seu `.bashrc` ou `.zshrc`:
```bash
export SGDK_PATH=$HOME/SGDK
export PATH=$SGDK_PATH/bin:$PATH
```

---

## Linux (Ubuntu/Debian)

### Instalar dependências

```bash
sudo apt-get update
sudo apt-get install build-essential git openjdk-21-jre-headless nodejs npm python3 python3-pil libsdl2-2.0-0
```

### Clonar e compilar

```bash
cd ~
git clone https://github.com/Stephane-D/SGDK.git
cd SGDK
make
```

### Adicionar ao PATH

Edite seu `~/.bashrc`:
```bash
export SGDK_PATH=$HOME/SGDK
export PATH=$SGDK_PATH/bin:$PATH
```

Depois execute:
```bash
source ~/.bashrc
```

---

## Verificação Final

Em qualquer sistema, execute:

```bash
rescomp --version
```

Se aparecer a versão, a instalação foi bem-sucedida! 🎉

---

## Próximo passo

Agora que o SGDK está instalado, vamos criar seu [Primeiro Programa](./02-hello-world.md).
