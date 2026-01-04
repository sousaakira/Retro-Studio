---
title: Instalação do SGDK
description: Passo a passo para instalar o SGDK no seu computador
---

# 📦 Instalação do SGDK

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
sudo apt-get install build-essential git openjdk-11-jre-headless
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
