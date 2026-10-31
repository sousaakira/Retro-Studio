#pragma once

// Versões de ROM para teste: build limpo de release, cópia numerada da ROM com o cabeçalho ajustado
// (revisão no serial, título opcional, checksum corrigido; o código do jogo não muda), registro em
// releases/releases.json, releases/CHANGELOG.md e LEIA-ME.txt para quem testa. O formato do registro
// é o mesmo do Retro Studio em Electron ("retro-studio.releases" v1).

#include "core/variant/dictionary.h"
#include "scene/gui/dialogs.h"

class Button;
class ItemList;
class Label;
class LineEdit;
class RichTextLabel;
class TextEdit;

namespace RetroRomReleases {

// Header que o jogo inclui para mostrar a versão ("gerado/versao.h").
inline constexpr const char *VERSION_HEADER = "src/gerado/versao.h";

bool valid_version(const String &p_version);
int compare_versions(const String &p_a, const String &p_b);
// Registro do projeto: {title, releases (da mais antiga para a mais nova)}; r_problem se ilegível.
Dictionary read_manifest(const String &p_project_dir, String &r_problem);
String next_version(const Array &p_releases);
// Commits (sem merges) desde a última versão, para sugerir o "o que mudou".
PackedStringArray pending_commits(const String &p_project_dir);
// Confere o pedido {version, changes, notes, title}, grava o header da versão e devolve o rascunho
// que o build de release completa; vazio com r_error se não dá.
Dictionary prepare(const String &p_project_dir, const Dictionary &p_request, String &r_error);
// Depois do build: copia a ROM com o cabeçalho ajustado e grava o registro. Devolve a versão.
Dictionary finish(const String &p_project_dir, const Dictionary &p_draft, const String &p_rom_path, String &r_error);
// Texto de uma versão (LEIA-ME para quem testa, ou a entrada do CHANGELOG.md).
String release_markdown(const Dictionary &p_release, bool p_for_testers);

} // namespace RetroRomReleases

// Janela "Versões para teste": a lista das versões à esquerda e o formulário da próxima à direita.
class RetroReleaseDialog : public AcceptDialog {
	GDCLASS(RetroReleaseDialog, AcceptDialog);

	Array releases; // Da mais nova para a mais antiga, como na lista.
	ItemList *list = nullptr;
	RichTextLabel *details = nullptr;
	Button *show_button = nullptr;
	Button *copy_button = nullptr;
	LineEdit *version_edit = nullptr;
	LineEdit *title_edit = nullptr;
	TextEdit *changes_edit = nullptr;
	TextEdit *notes_edit = nullptr;
	Label *status = nullptr;
	Button *build_only = nullptr;
	bool working = false;

	void _selected(int p_index);
	void _show_in_folder();
	void _copy_notes();
	void _custom_action(const StringName &p_action);

protected:
	virtual void ok_pressed() override;
	static void _bind_methods();

public:
	void open();
	void refresh(); // Lista e próxima versão sugerida.
	void set_status(const String &p_text, bool p_error);
	void release_done(const Dictionary &p_release); // Chamado pelo plugin no fim do build.
	void release_failed(const String &p_reason);

	RetroReleaseDialog();
};
