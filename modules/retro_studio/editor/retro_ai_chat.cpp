#include "retro_ai_chat.h"

#include "retro_ai_server.h"

#include "core/config/project_settings.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/gui/option_button.h"
#include "scene/gui/rich_text_label.h"
#include "scene/gui/text_edit.h"
#include "scene/main/viewport.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

struct Agente {
	const char *name;
	const char *setting;
	const char *command;
	const char *install;
};

// Comando de cada agente (ajustável em Configurações do Editor → Retro Studio → Ia).
const Agente AGENTES[] = {
	{ "Claude", "retro_studio/ia/comando_claude", "claude-agent-acp", "npm install -g @agentclientprotocol/claude-agent-acp (e o Claude Code com login feito)" },
	{ "Codex", "retro_studio/ia/comando_codex", "codex-acp", "npm install -g @agentclientprotocol/codex-acp (e codex login)" },
	{ "OpenCode", "retro_studio/ia/comando_opencode", "opencode acp", "curl -fsSL https://opencode.ai/install | bash (e opencode auth login)" },
};

// Markdown simples → BBCode do RichTextLabel: blocos de código, `código`, **negrito** e títulos.
String markdown(const String &p_text) {
	String out;
	bool code_block = false;
	const Vector<String> lines = p_text.split("\n");
	for (int i = 0; i < lines.size(); i++) {
		String line = lines[i].replace("[", "[lb]");
		if (line.strip_edges().begins_with("```")) {
			out += code_block ? "[/code][/bgcolor]" : "[bgcolor=#00000040][code]";
			code_block = !code_block;
			continue;
		}
		if (!code_block) {
			String converted;
			bool bold = false, mono = false;
			for (int c = 0; c < line.length(); c++) {
				if (line[c] == '`') {
					converted += mono ? "[/code]" : "[code]";
					mono = !mono;
				} else if (!mono && line[c] == '*' && c + 1 < line.length() && line[c + 1] == '*') {
					converted += bold ? "[/b]" : "[b]";
					bold = !bold;
					c++;
				} else {
					converted += line[c];
				}
			}
			converted += mono ? "[/code]" : "";
			converted += bold ? "[/b]" : "";
			line = converted;
			const String trimmed = line.strip_edges(true, false);
			if (trimmed.begins_with("#")) {
				line = "[b]" + trimmed.lstrip("# ") + "[/b]";
			}
		}
		out += line + (i < lines.size() - 1 ? "\n" : "");
	}
	if (code_block) {
		out += "[/code][/bgcolor]";
	}
	return out;
}

} // namespace

// ---- Processo do agente ----

void RetroAiChat::_start_agent() {
	_stop_agent();
	const int index = agent_option->get_selected();
	const String command = String(EDITOR_GET(AGENTES[index].setting)).strip_edges();
	if (command.is_empty()) {
		_add(Item::ERRO, U("Nenhum comando configurado para este agente."));
		return;
	}
	// Aberto pelo menu do sistema, o editor não herda o PATH do terminal: lê o do shell de login uma vez.
	if (login_path.is_empty()) {
		String shell = OS::get_singleton()->get_environment("SHELL");
		if (shell.is_empty()) {
			shell = "/bin/bash";
		}
		List<String> args;
		args.push_back("-ilc");
		args.push_back("printf '\\n__RETRO_PATH__%s\\n' \"$PATH\"");
		String output;
		OS::get_singleton()->execute(shell, args, &output);
		const int at = output.rfind("__RETRO_PATH__");
		login_path = at >= 0 ? output.substr(at + 14).get_slice("\n", 0).strip_edges() : String();
		const String home = OS::get_singleton()->get_environment("HOME");
		for (const String &extra : { home.path_join(".local/bin"), home.path_join(".asdf/shims"), home.path_join(".npm-global/bin"), home.path_join(".bun/bin"), home.path_join(".opencode/bin"), String("/usr/local/bin"), OS::get_singleton()->get_environment("PATH") }) {
			if (!extra.is_empty() && !login_path.split(":").has(extra)) {
				login_path += (login_path.is_empty() ? "" : ":") + extra;
			}
		}
	}
	List<String> args;
	args.push_back("PATH=" + login_path);
	for (const String &part : command.split(" ", false)) {
		args.push_back(part);
	}
	const Dictionary process = OS::get_singleton()->execute_with_pipe("/usr/bin/env", args, false);
	stdio = process.get("stdio", Ref<FileAccess>());
	stderr_pipe = process.get("stderr", Ref<FileAccess>());
	pid = process.get("pid", 0);
	if (stdio.is_null() || !pid) {
		_add(Item::ERRO, U("Não foi possível iniciar ") + command);
		return;
	}
	inbox.clear();
	stderr_text = String();
	requests.clear();
	session_id = String();
	_set_status(vformat(U("Iniciando %s…"), AGENTES[index].name));
	Dictionary fs;
	fs["readTextFile"] = false;
	fs["writeTextFile"] = false;
	Dictionary capabilities;
	capabilities["fs"] = fs;
	capabilities["terminal"] = false;
	Dictionary info;
	info["name"] = "retro-studio";
	info["title"] = "Retro Studio";
	info["version"] = "1";
	Dictionary params;
	params["protocolVersion"] = 1;
	params["clientCapabilities"] = capabilities;
	params["clientInfo"] = info;
	_request("initialize", params);
	set_process(true);
}

void RetroAiChat::_stop_agent() {
	if (pid && OS::get_singleton()->is_process_running(pid)) {
		OS::get_singleton()->kill(pid);
	}
	pid = 0;
	stdio.unref();
	stderr_pipe.unref();
	session_id = String();
	busy = false;
	_update_buttons();
}

void RetroAiChat::_write(const Dictionary &p_message) {
	if (stdio.is_null()) {
		return;
	}
	Dictionary message = p_message;
	message["jsonrpc"] = "2.0";
	const CharString line = (JSON::stringify(message) + "\n").utf8();
	stdio->store_buffer((const uint8_t *)line.get_data(), line.length());
}

int RetroAiChat::_request(const String &p_method, const Dictionary &p_params) {
	const int id = next_id++;
	Dictionary message;
	message["id"] = id;
	message["method"] = p_method;
	message["params"] = p_params;
	requests[id] = p_method;
	_write(message);
	return id;
}

void RetroAiChat::_reply(const Variant &p_id, const Variant &p_result) {
	Dictionary message;
	message["id"] = p_id;
	message["result"] = p_result;
	_write(message);
}

void RetroAiChat::_read() {
	if (stdio.is_null()) {
		return;
	}
	uint8_t buffer[16384];
	while (true) {
		const uint64_t count = stdio->get_buffer(buffer, sizeof(buffer));
		if (count == 0 || count == uint64_t(-1)) {
			break;
		}
		for (uint64_t i = 0; i < count; i++) {
			inbox.push_back(buffer[i]);
		}
	}
	if (stderr_pipe.is_valid()) {
		while (true) {
			const uint64_t count = stderr_pipe->get_buffer(buffer, sizeof(buffer));
			if (count == 0 || count == uint64_t(-1)) {
				break;
			}
			stderr_text += String::utf8((const char *)buffer, count);
			if (stderr_text.length() > 8000) {
				stderr_text = stderr_text.substr(stderr_text.length() - 6000);
			}
		}
	}
	// Uma mensagem JSON por linha.
	int start = 0;
	for (int i = 0; i < inbox.size(); i++) {
		if (inbox[i] != '\n') {
			continue;
		}
		const String line = String::utf8((const char *)inbox.ptr() + start, i - start).strip_edges();
		start = i + 1;
		if (line.is_empty()) {
			continue;
		}
		JSON json;
		if (json.parse(line) == OK && json.get_data().get_type() == Variant::DICTIONARY) {
			_on_message(json.get_data());
		}
	}
	if (start > 0) {
		inbox = inbox.slice(start);
	}
}

void RetroAiChat::_on_message(const Dictionary &p_message) {
	const String method = p_message.get("method", "");
	// Resposta a um pedido nosso.
	if (method.is_empty() && p_message.has("id")) {
		const int id = int(p_message["id"]);
		const String asked = requests.has(id) ? requests[id] : String();
		requests.erase(id);
		if (p_message.has("error")) {
			const Dictionary error = p_message["error"];
			String message = error.get("message", "");
			if (asked == "session/new" && (int(error.get("code", 0)) == -32000 || message.to_lower().contains("auth"))) {
				message += U("\nFaça o login do agente no terminal (claude e depois /login; codex login; opencode auth login) e comece uma conversa nova.");
			}
			_add(Item::ERRO, vformat(U("%s: %s"), asked, message));
			if (asked == "session/prompt") {
				busy = false;
				_update_buttons();
			}
			return;
		}
		const Dictionary result = p_message.get("result", Dictionary());
		if (asked == "initialize") {
			const Dictionary capabilities = result.get("agentCapabilities", Dictionary());
			http_mcp = Dictionary(capabilities.get("mcpCapabilities", Dictionary())).get("http", false);
			_new_session();
		} else if (asked == "session/new") {
			session_id = result.get("sessionId", "");
			String model;
			const Dictionary models = result.get("models", Dictionary());
			if (models.has("currentModelId")) {
				model = " · " + String(models["currentModelId"]);
			}
			_set_status(vformat(U("%s conectado%s"), AGENTES[agent_option->get_selected()].name, model));
			if (!http_mcp) {
				_add(Item::AVISO, U("Este agente não aceita MCP por HTTP na sessão: ele conversa, mas só mexe no Retro Studio se você o cadastrar pelo comando de Projeto → Ferramentas → Conectar agente de IA."));
			}
			_update_buttons();
			input->grab_focus();
		} else if (asked == "session/prompt") {
			busy = false;
			const String reason = result.get("stopReason", "");
			if (reason == "cancelled") {
				_add(Item::AVISO, U("Parado."));
			} else if (reason == "max_tokens" || reason == "max_turn_requests") {
				_add(Item::AVISO, U("O agente parou no limite da resposta."));
			}
			_set_status(vformat(U("%s conectado"), AGENTES[agent_option->get_selected()].name));
			_update_buttons();
		}
		return;
	}
	const Dictionary params = p_message.get("params", Dictionary());
	if (method == "session/update") {
		_on_update(params.get("update", Dictionary()));
		return;
	}
	if (method == "session/request_permission" && p_message.has("id")) {
		const Dictionary call = params.get("toolCall", Dictionary());
		Item item;
		item.kind = Item::PERMISSAO;
		item.id = JSON::stringify(p_message["id"]);
		const String tool_title = call.get("title", U("uma ferramenta"));
		item.text = tool_title.begins_with("mcp__retro-studio__") ? "Retro Studio: " + tool_title.trim_prefix("mcp__retro-studio__") : tool_title;
		item.options = params.get("options", Array());
		items.push_back(item);
		dirty = true;
		return;
	}
	if (p_message.has("id")) {
		// Pedido que não atendemos (fs, terminal): o agente usa as próprias ferramentas.
		Dictionary error;
		error["code"] = -32601;
		error["message"] = "Method not supported by Retro Studio: " + method;
		Dictionary message;
		message["id"] = p_message["id"];
		message["error"] = error;
		_write(message);
	}
}

void RetroAiChat::_on_update(const Dictionary &p_update) {
	const String kind = p_update.get("sessionUpdate", "");
	if (kind == "agent_message_chunk") {
		const Dictionary content = p_update.get("content", Dictionary());
		const String text = content.get("text", "");
		if (!items.is_empty() && items[items.size() - 1].kind == Item::AGENTE) {
			items.write[items.size() - 1].text += text;
		} else {
			_add(Item::AGENTE, text);
		}
		dirty = true;
	} else if (kind == "agent_thought_chunk") {
		_set_status(U("Pensando…"));
	} else if (kind == "tool_call" || kind == "tool_call_update") {
		const String id = p_update.get("toolCallId", "");
		int found = -1;
		for (int i = items.size() - 1; i >= 0 && found < 0; i--) {
			if (items[i].kind == Item::FERRAMENTA && items[i].id == id) {
				found = i;
			}
		}
		if (found < 0) {
			Item item;
			item.kind = Item::FERRAMENTA;
			item.id = id;
			items.push_back(item);
			found = items.size() - 1;
		}
		Item &item = items.write[found];
		if (p_update.has("title")) {
			// "mcp__retro-studio__scene_read" → "Retro Studio: scene_read".
			const String tool_title = p_update["title"];
			item.text = tool_title.begins_with("mcp__retro-studio__") ? "Retro Studio: " + tool_title.trim_prefix("mcp__retro-studio__") : tool_title;
		}
		if (p_update.has("status")) {
			item.status = p_update["status"];
		}
		_set_status(item.status == "completed" || item.status == "failed" ? U("Respondendo…") : U("Usando: ") + item.text);
		dirty = true;
	} else if (kind == "plan") {
		String plan;
		for (const Variant &entry : Array(p_update.get("entries", Array()))) {
			const Dictionary e = entry;
			const String status = e.get("status", "");
			plan += (status == "completed" ? U("✓ ") : status == "in_progress" ? U("▸ ") : U("· ")) + String(e.get("content", "")) + "\n";
		}
		_add(Item::AVISO, U("Plano:\n") + plan.strip_edges());
	}
}

void RetroAiChat::_new_session() {
	Array servers;
	const String url = plugin ? plugin->get_url() : String();
	if (http_mcp && !url.is_empty()) {
		Dictionary server;
		server["type"] = "http";
		server["name"] = "retro-studio";
		server["url"] = url;
		server["headers"] = Array();
		servers.push_back(server);
	}
	Dictionary params;
	params["cwd"] = ProjectSettings::get_singleton()->globalize_path("res://").trim_suffix("/");
	params["mcpServers"] = servers;
	_request("session/new", params);
	_set_status(U("Abrindo a conversa…"));
}

// ---- Interface ----

void RetroAiChat::_agent_changed(int p_index) {
	EditorSettings::get_singleton()->set_setting("retro_studio/ia/agente", p_index);
	if (pid) {
		// Outro agente é outro processo.
		_stop_agent();
		items.clear();
		_start_agent();
	}
}

void RetroAiChat::_new_conversation() {
	items.clear();
	dirty = true;
	if (pid && OS::get_singleton()->is_process_running(pid) && !session_id.is_empty()) {
		session_id = String();
		_new_session();
	} else {
		_start_agent();
	}
	_update_buttons();
}

void RetroAiChat::_send() {
	if (busy) {
		_cancel();
		return;
	}
	const String text = input->get_text().strip_edges();
	if (text.is_empty()) {
		return;
	}
	if (session_id.is_empty()) {
		if (!pid) {
			_start_agent();
		}
		_add(Item::AVISO, U("Espere o agente conectar e envie de novo."));
		return;
	}
	_add(Item::VOCE, text);
	input->set_text(String());
	Dictionary block;
	block["type"] = "text";
	block["text"] = text;
	Array prompt;
	prompt.push_back(block);
	Dictionary params;
	params["sessionId"] = session_id;
	params["prompt"] = prompt;
	_request("session/prompt", params);
	busy = true;
	_set_status(U("Pensando…"));
	_update_buttons();
}

void RetroAiChat::_cancel() {
	if (session_id.is_empty()) {
		return;
	}
	Dictionary params;
	params["sessionId"] = session_id;
	Dictionary message;
	message["method"] = "session/cancel";
	message["params"] = params;
	_write(message);
	// Permissões pendentes: o agente recebe "cancelado".
	for (Item &item : items) {
		if (item.kind == Item::PERMISSAO && !item.answered) {
			item.answered = true;
			item.status = U("cancelado");
			JSON json;
			json.parse(item.id);
			Dictionary outcome;
			outcome["outcome"] = "cancelled";
			Dictionary result;
			result["outcome"] = outcome;
			_reply(json.get_data(), result);
		}
	}
	dirty = true;
}

void RetroAiChat::_input_gui(const Ref<InputEvent> &p_event) {
	const Ref<InputEventKey> key = p_event;
	if (key.is_valid() && key->is_pressed() && (key->get_keycode() == Key::ENTER || key->get_keycode() == Key::KP_ENTER) && !key->is_shift_pressed()) {
		get_viewport()->set_input_as_handled();
		_send();
	}
}

// Links da conversa: "permissao:<índice>:<optionId>".
void RetroAiChat::_meta_clicked(const Variant &p_meta) {
	const String meta = p_meta;
	if (!meta.begins_with("permissao:")) {
		return;
	}
	const int index = meta.get_slice(":", 1).to_int();
	const String option = meta.get_slicec(':', 2);
	if (index < 0 || index >= items.size() || items[index].answered) {
		return;
	}
	Item &item = items.write[index];
	item.answered = true;
	for (const Variant &entry : item.options) {
		const Dictionary o = entry;
		if (String(o.get("optionId", "")) == option) {
			item.status = o.get("name", option);
		}
	}
	JSON json;
	json.parse(item.id);
	Dictionary outcome;
	outcome["outcome"] = "selected";
	outcome["optionId"] = option;
	Dictionary result;
	result["outcome"] = outcome;
	_reply(json.get_data(), result);
	dirty = true;
}

void RetroAiChat::_add(Item::Tipo p_kind, const String &p_text) {
	Item item;
	item.kind = p_kind;
	item.text = p_text;
	items.push_back(item);
	dirty = true;
}

void RetroAiChat::_render() {
	dirty = false;
	String text;
	for (int i = 0; i < items.size(); i++) {
		const Item &item = items[i];
		switch (item.kind) {
			case Item::VOCE:
				text += U("[color=#8fc8ff][b]Você[/b][/color]\n") + item.text.replace("[", "[lb]") + "\n\n";
				break;
			case Item::AGENTE:
				text += vformat(U("[color=#b9f5a8][b]%s[/b][/color]\n"), AGENTES[agent_option->get_selected()].name) + markdown(item.text.strip_edges()) + "\n\n";
				break;
			case Item::FERRAMENTA: {
				const String mark = item.status == "completed" ? U("✓") : item.status == "failed" ? U("✗") : U("…");
				text += vformat("[color=#a0a0b0]%s %s[/color]\n", mark, item.text.replace("[", "[lb]"));
			} break;
			case Item::PERMISSAO: {
				text += vformat(U("[color=#ffd479]Permitir: %s?[/color] "), item.text.replace("[", "[lb]"));
				if (item.answered) {
					text += "[color=#a0a0b0](" + item.status + ")[/color]\n\n";
				} else {
					for (const Variant &entry : item.options) {
						const Dictionary o = entry;
						text += vformat("[url=permissao:%d:%s]%s[/url]  ", i, String(o.get("optionId", "")), String(o.get("name", "")));
					}
					text += "\n\n";
				}
			} break;
			case Item::AVISO:
				text += "[color=#a0a0b0][i]" + item.text.replace("[", "[lb]") + "[/i][/color]\n\n";
				break;
			case Item::ERRO:
				text += "[color=#ff8080]" + item.text.replace("[", "[lb]") + "[/color]\n\n";
				break;
		}
	}
	transcript->set_text(text);
}

void RetroAiChat::_set_status(const String &p_text) {
	status_label->set_text(p_text);
}

void RetroAiChat::_update_buttons() {
	send_button->set_text(busy ? U("Parar") : U("Enviar"));
	send_button->set_tooltip_text(busy ? U("Para a resposta do agente.") : U("Envia a mensagem (Enter; Shift+Enter quebra a linha)."));
}

void RetroAiChat::_notification(int p_what) {
	if (p_what != NOTIFICATION_PROCESS) {
		return;
	}
	_read();
	if (pid && !OS::get_singleton()->is_process_running(pid)) {
		const String tail = stderr_text.strip_edges().right(600);
		const int index = agent_option->get_selected();
		String message = vformat(U("O agente %s encerrou."), AGENTES[index].name);
		if (!tail.is_empty()) {
			message += "\n" + tail;
		}
		if (tail.contains("No such file") || tail.contains("not found")) {
			message += U("\nPara instalar: ") + String::utf8(AGENTES[index].install);
		}
		_add(Item::ERRO, message);
		pid = 0;
		stdio.unref();
		stderr_pipe.unref();
		session_id = String();
		busy = false;
		_set_status(U("Desconectado"));
		_update_buttons();
	}
	if (dirty) {
		_render();
	}
}

RetroAiChat::RetroAiChat(RetroAiPlugin *p_plugin) {
	plugin = p_plugin;
	set_name(U("IA"));
	set_default_slot(EditorDock::DOCK_SLOT_RIGHT_UL);
	for (const Agente &agente : AGENTES) {
		EDITOR_DEF(agente.setting, agente.command);
	}
	EDITOR_DEF("retro_studio/ia/agente", 0);

	VBoxContainer *box = memnew(VBoxContainer);
	box->set_v_size_flags(SIZE_EXPAND_FILL);
	add_child(box);
	HBoxContainer *top = memnew(HBoxContainer);
	box->add_child(top);
	agent_option = memnew(OptionButton);
	for (const Agente &agente : AGENTES) {
		agent_option->add_item(agente.name);
	}
	agent_option->select(CLAMP(int(EDITOR_GET("retro_studio/ia/agente")), 0, 2));
	agent_option->set_tooltip_text(U("Agente da conversa. O comando de cada um fica em Configurações do Editor → Retro Studio → Ia."));
	agent_option->connect(SceneStringName(item_selected), callable_mp(this, &RetroAiChat::_agent_changed));
	top->add_child(agent_option);
	status_label = memnew(Label(U("Desconectado")));
	status_label->set_h_size_flags(SIZE_EXPAND_FILL);
	status_label->set_clip_text(true);
	status_label->set_modulate(Color(1, 1, 1, 0.7));
	top->add_child(status_label);
	new_button = memnew(Button(U("Nova conversa")));
	new_button->set_tooltip_text(U("Começa uma conversa nova (inicia o agente, se preciso)."));
	new_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiChat::_new_conversation));
	top->add_child(new_button);

	transcript = memnew(RichTextLabel);
	transcript->set_use_bbcode(true);
	transcript->set_v_size_flags(SIZE_EXPAND_FILL);
	transcript->set_selection_enabled(true);
	transcript->set_context_menu_enabled(true);
	transcript->set_scroll_follow(true);
	transcript->set_meta_underline(true);
	transcript->set_custom_minimum_size(Size2(0, 200) * EDSCALE);
	transcript->connect("meta_clicked", callable_mp(this, &RetroAiChat::_meta_clicked));
	box->add_child(transcript);

	HBoxContainer *bottom = memnew(HBoxContainer);
	box->add_child(bottom);
	input = memnew(TextEdit);
	input->set_h_size_flags(SIZE_EXPAND_FILL);
	input->set_custom_minimum_size(Size2(0, 70) * EDSCALE);
	input->set_line_wrapping_mode(TextEdit::LINE_WRAPPING_BOUNDARY);
	input->set_placeholder(U("Peça algo ao agente: \"coloque três moedas antes do primeiro buraco e compile\""));
	input->connect(SceneStringName(gui_input), callable_mp(this, &RetroAiChat::_input_gui));
	bottom->add_child(input);
	send_button = memnew(Button);
	send_button->set_v_size_flags(SIZE_SHRINK_END);
	send_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiChat::_send));
	bottom->add_child(send_button);
	_update_buttons();
	_add(Item::AVISO, U("Escolha o agente e clique em Nova conversa. Ele recebe as ferramentas do Retro Studio (ler e mexer nas cenas, compilar, ver a tela), e o que ele muda nos nodes sai com Ctrl+Z."));
	set_process(true);
}

RetroAiChat::~RetroAiChat() {
	_stop_agent();
}
