#pragma once

// "Converter para o Mega Drive" no menu do Sistema de Arquivos: grava ao lado de um PNG qualquer uma
// cópia que o rescomp aceita (nome_md.png): lados múltiplos de 8, cores na grade do console (8 níveis
// por canal) e no máximo 15 cores mais a transparência, num PNG indexado de 4 bits.

#include "editor/inspector/editor_context_menu_plugin.h"

namespace RetroImageConvert {
// Converte a imagem e devolve o caminho gravado; em caso de erro, devolve vazio e explica em r_message.
String convert(const String &p_path, String &r_message);
} // namespace RetroImageConvert

class RetroImageMenu : public EditorContextMenuPlugin {
	GDCLASS(RetroImageMenu, EditorContextMenuPlugin);

	void _convert(const Vector<String> &p_paths);

public:
	virtual void get_options(const Vector<String> &p_paths) override;
};
