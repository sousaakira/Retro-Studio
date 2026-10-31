#pragma once

#include "core/string/ustring.h"

// PATH do usuário: o do editor, o do shell de login interativo (asdf, nvm, mise, npm global…) e as
// pastas conhecidas, sem repetir e sem pastas inexistentes. Lido uma vez (até 5 s) e guardado.
String retro_user_path();
// Caminho absoluto de um executável nesse PATH (ou o próprio caminho, se já for absoluto); vazio se não achar.
String retro_find_executable(const String &p_name);
