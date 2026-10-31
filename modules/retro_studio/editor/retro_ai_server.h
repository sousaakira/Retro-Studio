#pragma once

// Servidor MCP do Retro Studio: um agente de IA (Claude Code, Codex, OpenCode…) usa o editor como uma
// pessoa usa — lê o projeto e as cenas, cria e altera nodes (pelo desfazer do editor), grava o código
// C, compila, roda no emulador e olha a tela. Transporte "Streamable HTTP" do MCP, só em 127.0.0.1,
// com um token no caminho (http://127.0.0.1:<porta>/mcp/<token>); respostas em JSON, sem SSE.

#include "core/io/stream_peer_tcp.h"
#include "core/io/tcp_server.h"
#include "editor/plugins/editor_plugin.h"

class AcceptDialog;
class EditorDock;
class RetroAiPanel;
class Label;
class LineEdit;

class RetroAiPlugin : public EditorPlugin {
	GDCLASS(RetroAiPlugin, EditorPlugin);

	struct Conexao {
		Ref<StreamPeerTCP> peer;
		Vector<uint8_t> buffer;
		uint64_t since = 0;
		bool waiting_build = false; // Resposta adiada até o fim do build.
		Variant build_id;
	};

	Ref<TCPServer> server;
	Vector<Conexao> connections;
	String token;
	int port = 0;
	String start_error;
	bool polling = false;
	RetroAiPanel *ai_panel = nullptr;
	EditorDock *ai_dock = nullptr;
	bool was_building = false; // Para avisar o painel IA quando um build termina.

	AcceptDialog *connect_dialog = nullptr;
	Label *connect_status = nullptr;
	LineEdit *connect_fields[4] = {};

	void _start_server();
	void _poll();
	bool _handle(Conexao &r_conn); // Verdadeiro quando respondeu (a conexão pode fechar).
	void _respond(Conexao &r_conn, int p_status, const String &p_body, const String &p_extra_headers = String());
	Variant _rpc(const Dictionary &p_request, Conexao &r_conn, bool &r_deferred);
	Array _tools() const;
	Dictionary _call(const String &p_name, const Dictionary &p_args, Conexao &r_conn, bool &r_deferred);
	void _show_connect();
	void _copy_field(int p_index);
	void _set_owners(Node *p_owner, const Array &p_nodes);

protected:
	void _notification(int p_what);
	static void _bind_methods();

public:
	static RetroAiPlugin *singleton;
	virtual String get_plugin_name() const override { return "RetroAi"; }
	virtual void shortcut_input(const Ref<InputEvent> &p_event) override;
	String get_url() const;
	// Ganchos do painel IA (os mesmos do plugin do Retro Studio Godot anterior).
	Dictionary ai_snapshot(); // Arquivo atual (e se tem alteração não salva), erros do build, mapa e ROM.
	void ai_action(const String &p_action); // build, play ou stop (atalhos /build /play /stop).
	void open_problem(const Dictionary &p_problem); // Abre o arquivo do erro na linha.

	RetroAiPlugin();
	~RetroAiPlugin();
};
