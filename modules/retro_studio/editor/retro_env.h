#pragma once

#include "core/string/ustring.h"
#include "core/templates/vector.h"

// Pasta pessoal do usuário (HOME no Linux, USERPROFILE no Windows, com barras /).
String retro_home();
// Pasta padrão do kit SGDK (a do instalador).
String retro_default_gdk();
// Separador das pastas do PATH (":" no Linux, ";" no Windows).
String retro_path_separator();
// O gcc m68k do kit SGDK (m68k-elf-gcc no Linux, gcc.exe no SGDK para Windows).
String retro_gdk_gcc(const String &p_gdk);
// PATH do usuário: o do editor, o do shell de login interativo (asdf, nvm, mise, npm global…) e as
// pastas conhecidas, sem repetir e sem pastas inexistentes. Lido uma vez (até 5 s) e guardado.
String retro_user_path();
// Caminho absoluto de um executável nesse PATH (ou o próprio caminho, se já for absoluto); vazio se não achar.
String retro_find_executable(const String &p_name);

// Ambiente de build e do emulador (instalação do Retro Studio):
// Pasta kit do editor (Java mínimo em jre/ e make em bin/), ao lado do executável instalado
// (~/.local/share/retro-studio/kit) ou na pasta do pacote descompactado; vazio se não houver.
String retro_app_kit_dir();
// O instalar.sh que fica ao lado do executável (para o botão Reparar); vazio se não houver.
String retro_installer_path();
// PATH do build do SGDK: bin do kit SGDK, Java e make do editor, e o PATH do usuário.
String retro_build_path(const String &p_gdk);
// Procura um programa nas pastas de um PATH; caminho absoluto ou vazio.
String retro_find_in_path(const String &p_name, const String &p_path);
// Bibliotecas que o executável não acha (ldd); vazio se todas existem ou se não há ldd.
Vector<String> retro_missing_libraries(const String &p_executable);
// O emulador que dá para abrir: o configurado ou, se faltam bibliotecas a ele, o BlastEm oficial em
// old/ (traz a própria SDL2). Vazio se nenhum abre; r_missing lista as bibliotecas que faltam e
// r_note explica a troca.
String retro_resolve_emulator(const String &p_configured, Vector<String> &r_missing, String &r_note);
// Dependências (java, make, sdl2, glew) que as bibliotecas que faltam pedem.
Vector<String> retro_dependencies_for_libraries(const Vector<String> &p_libraries);
// Comando para instalar dependências (java, make, sdl2, glew) no gerenciador de pacotes desta distro.
String retro_install_command(const Vector<String> &p_dependencies);
// Confere tudo de que o build e o emulador precisam. Devolve os problemas (texto para o usuário) e,
// em r_dependencies, os pacotes do sistema que resolveriam. Pode levar alguns segundos (shell de
// login para o PATH): chame fora da thread principal.
Vector<String> retro_check_environment(const String &p_gdk, const String &p_emulator, Vector<String> &r_dependencies);
