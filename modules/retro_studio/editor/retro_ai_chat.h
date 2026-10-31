#pragma once

// Painel "IA": conversa com um agente (Claude, Codex ou OpenCode) dentro do editor. O agente roda como
// processo filho falando o Agent Client Protocol (JSON-RPC, uma mensagem por linha no stdio) e recebe
// o servidor MCP do Retro Studio na sessão, para ler e mexer nas cenas, compilar e olhar a tela.

#include "core/io/file_access.h"
#include "core/os/os.h"
#include "editor/docks/editor_dock.h"

class Button;
class Label;
class OptionButton;
class RetroAiPlugin;
class RichTextLabel;
class TextEdit;

class RetroAiChat : public EditorDock {
	GDCLASS(RetroAiChat, EditorDock);

	struct Item {
		enum Tipo {
			VOCE,
			AGENTE,
			FERRAMENTA,
			PERMISSAO,
			AVISO,
			ERRO,
		};
		Tipo kind = AVISO;
		String text;
		String id; // toolCallId, ou o id do pedido de permissão.
		String status;
		Array options; // Opções de permissão: [{optionId, name, kind}].
		bool answered = false;
	};

	RetroAiPlugin *plugin = nullptr;
	OptionButton *agent_option = nullptr;
	Button *new_button = nullptr;
	Label *status_label = nullptr;
	RichTextLabel *transcript = nullptr;
	TextEdit *input = nullptr;
	Button *send_button = nullptr;

	Vector<Item> items;
	bool dirty = false;
	String login_path; // PATH do shell de login (asdf, nvm, npm global…), lido uma vez.

	ProcessID pid = 0;
	Ref<FileAccess> stdio;
	Ref<FileAccess> stderr_pipe;
	Vector<uint8_t> inbox;
	String stderr_text;
	int next_id = 1;
	HashMap<int, String> requests; // id → método que esperamos responder.
	String session_id;
	bool busy = false; // Um prompt em andamento.
	bool http_mcp = false;

	void _agent_changed(int p_index);
	void _new_conversation();
	void _start_agent();
	void _stop_agent();
	void _send();
	void _cancel();
	void _input_gui(const Ref<InputEvent> &p_event);
	void _meta_clicked(const Variant &p_meta);

	void _write(const Dictionary &p_message);
	int _request(const String &p_method, const Dictionary &p_params);
	void _reply(const Variant &p_id, const Variant &p_result);
	void _read();
	void _on_message(const Dictionary &p_message);
	void _on_update(const Dictionary &p_update);
	void _new_session();

	void _add(Item::Tipo p_kind, const String &p_text);
	void _render();
	void _set_status(const String &p_text);
	void _update_buttons();

protected:
	void _notification(int p_what);

public:
	explicit RetroAiChat(RetroAiPlugin *p_plugin);
	~RetroAiChat();
};
