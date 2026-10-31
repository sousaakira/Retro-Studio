#include "retro_ai_server.h"

#include "../scene/md_nodes.h"
#include "../scene/md_personagem.h"
#include "retro_ai_chat.h"
#include "retro_animation_editor.h"
#include "retro_guia.gen.h"
#include "retro_sgdk_plugin.h"

#include "core/config/project_settings.h"
#include "core/crypto/crypto_core.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/io/resource_loader.h"
#include "core/io/resource_uid.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "core/os/os.h"
#include "core/os/time.h"
#include "core/version.h"
#include "editor/editor_data.h"
#include "editor/editor_interface.h"
#include "editor/editor_node.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/dialogs.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/2d/tile_map_layer.h"
#include "scene/main/viewport.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/resources/packed_scene.h"
#include "servers/display/display_server.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

template <typename... Args>
Array arr(Args... p_args) {
	Array out;
	(out.push_back(Variant(p_args)), ...);
	return out;
}

const char *PROTOCOL_VERSIONS[] = { "2025-06-18", "2025-03-26", "2024-11-05", nullptr };

// Tipos que a IA pode criar: os mesmos da janela "Criar Node" do Retro Studio.
bool creatable(const String &p_type) {
	return p_type.begins_with("MD") || p_type == "Node" || p_type == "Node2D" || p_type == "AnimationPlayer";
}

// Valor do Godot → JSON legível (vetores viram listas, recursos viram o caminho).
Variant to_json(const Variant &p_value, int p_depth = 0) {
	switch (p_value.get_type()) {
		case Variant::NIL:
		case Variant::BOOL:
		case Variant::INT:
		case Variant::FLOAT:
		case Variant::STRING:
			return p_value;
		case Variant::STRING_NAME:
		case Variant::NODE_PATH:
			return String(p_value);
		case Variant::VECTOR2: {
			const Vector2 v = p_value;
			return arr(v.x, v.y);
		}
		case Variant::VECTOR2I: {
			const Vector2i v = p_value;
			return arr(v.x, v.y);
		}
		case Variant::RECT2: {
			const Rect2 r = p_value;
			return arr(r.position.x, r.position.y, r.size.x, r.size.y);
		}
		case Variant::RECT2I: {
			const Rect2i r = p_value;
			return arr(r.position.x, r.position.y, r.size.x, r.size.y);
		}
		case Variant::COLOR:
			return "#" + Color(p_value).to_html(true);
		case Variant::OBJECT: {
			const Ref<Resource> resource = p_value;
			if (resource.is_valid()) {
				return resource->get_path().is_empty() || resource->get_path().contains("::") ? "<" + resource->get_class() + U(" embutido>") : resource->get_path();
			}
			return Variant();
		}
		case Variant::ARRAY: {
			const Array in = p_value;
			if (p_depth > 3 || in.size() > 64) {
				return vformat(U("<%d itens>"), in.size());
			}
			Array out;
			for (const Variant &item : in) {
				out.push_back(to_json(item, p_depth + 1));
			}
			return out;
		}
		case Variant::DICTIONARY: {
			const Dictionary in = p_value;
			if (p_depth > 3) {
				return vformat(U("<%d chaves>"), in.size());
			}
			Dictionary out;
			for (const Variant &key : in.keys()) {
				out[String(key)] = to_json(in[key], p_depth + 1);
			}
			return out;
		}
		default:
			break;
	}
	if (p_value.is_array()) {
		const Array items = p_value;
		if (items.size() > 32) {
			return vformat(U("<%d itens>"), items.size());
		}
		return to_json(items, p_depth + 1);
	}
	return String(p_value);
}

// JSON → valor do tipo da propriedade. Devolve falso se não der para converter.
bool from_json(const Variant &p_json, Variant::Type p_type, Variant &r_value, String &r_error) {
	const Array list = p_json.get_type() == Variant::ARRAY ? Array(p_json) : Array();
	switch (p_type) {
		case Variant::BOOL:
			r_value = bool(p_json);
			return true;
		case Variant::INT:
			r_value = int64_t(Math::round(double(p_json)));
			return true;
		case Variant::FLOAT:
			r_value = double(p_json);
			return true;
		case Variant::STRING:
			r_value = String(p_json);
			return true;
		case Variant::STRING_NAME:
			r_value = StringName(String(p_json));
			return true;
		case Variant::NODE_PATH:
			r_value = NodePath(String(p_json));
			return true;
		case Variant::VECTOR2:
		case Variant::VECTOR2I:
			if (list.size() != 2) {
				r_error = U("use [x, y]");
				return false;
			}
			r_value = p_type == Variant::VECTOR2 ? Variant(Vector2(list[0], list[1])) : Variant(Vector2i(int(list[0]), int(list[1])));
			return true;
		case Variant::RECT2:
		case Variant::RECT2I:
			if (list.size() != 4) {
				r_error = U("use [x, y, largura, altura]");
				return false;
			}
			r_value = p_type == Variant::RECT2 ? Variant(Rect2(list[0], list[1], list[2], list[3])) : Variant(Rect2i(int(list[0]), int(list[1]), int(list[2]), int(list[3])));
			return true;
		case Variant::COLOR:
			r_value = Color::html(String(p_json));
			return true;
		case Variant::OBJECT: {
			if (p_json.get_type() == Variant::NIL || String(p_json).is_empty()) {
				r_value = Variant();
				return true;
			}
			const Ref<Resource> resource = ResourceLoader::load(String(p_json));
			if (resource.is_null()) {
				r_error = U("não foi possível carregar ") + String(p_json);
				return false;
			}
			r_value = resource;
			return true;
		}
		default:
			r_error = U("tipo ") + Variant::get_type_name(p_type) + U(" não suportado");
			return false;
	}
}

bool find_property(Object *p_object, const String &p_name, PropertyInfo &r_info) {
	List<PropertyInfo> properties;
	p_object->get_property_list(&properties);
	for (const PropertyInfo &info : properties) {
		if (info.name == p_name) {
			r_info = info;
			return true;
		}
	}
	return false;
}

// Propriedades que valem a pena mostrar: as editáveis e salvas, diferentes do padrão.
Dictionary node_properties(Node *p_node) {
	Dictionary out;
	List<PropertyInfo> properties;
	p_node->get_property_list(&properties);
	for (const PropertyInfo &info : properties) {
		const String name = info.name;
		if (!(info.usage & PROPERTY_USAGE_STORAGE) || !(info.usage & PROPERTY_USAGE_EDITOR) || name == "position" || name == "script" || name.begins_with("metadata/") || name.begins_with("process_") || name == "physics_interpolation_mode" || name == "auto_translate_mode" || name == "editor_description" || name == "unique_name_in_owner") {
			continue;
		}
		bool valid = false;
		const Variant fallback = ClassDB::class_get_default_property_value(p_node->get_class_name(), info.name, &valid);
		const Variant value = p_node->get(info.name);
		if (valid && value == fallback) {
			continue;
		}
		out[name] = to_json(value);
	}
	return out;
}

Dictionary describe(Node *p_node, Node *p_root, int p_depth) {
	Dictionary out;
	out["nome"] = String(p_node->get_name());
	out["tipo"] = p_node->get_class();
	out["caminho"] = p_node == p_root ? String(".") : String(p_root->get_path_to(p_node));
	if (Node2D *node_2d = Object::cast_to<Node2D>(p_node)) {
		out["posicao"] = to_json(node_2d->get_position());
	}
	if (!p_node->get_scene_file_path().is_empty() && p_node != p_root) {
		out["instancia_de"] = p_node->get_scene_file_path();
	}
	out["propriedades"] = node_properties(p_node);
	const PackedStringArray warnings = p_node->get_configuration_warnings();
	if (!warnings.is_empty()) {
		out["avisos"] = warnings;
	}
	if (p_depth < 32 && p_node->get_child_count() > 0 && (p_node == p_root || p_node->get_scene_file_path().is_empty())) {
		Array children;
		for (int i = 0; i < p_node->get_child_count(); i++) {
			Node *child = p_node->get_child(i);
			if (child->get_owner() == p_root || child->get_owner() == nullptr) {
				children.push_back(describe(child, p_root, p_depth + 1));
			}
		}
		out["filhos"] = children;
	}
	return out;
}

// Caminho dado pela IA → res:// dentro do projeto (vazio se sair dele).
String project_path(const String &p_path) {
	String path = p_path.strip_edges();
	if (path.is_empty()) {
		return String();
	}
	if (!path.begins_with("res://")) {
		path = path.is_absolute_path() ? ProjectSettings::get_singleton()->localize_path(path) : "res://" + path.trim_prefix("./");
	}
	path = path.simplify_path();
	if (!path.begins_with("res://") || path.contains("..") || path.begins_with("res://.godot")) {
		return String();
	}
	return path;
}

Dictionary text_result(const String &p_text, bool p_error = false) {
	Dictionary item;
	item["type"] = "text";
	item["text"] = p_text;
	Dictionary result;
	result["content"] = arr(item);
	result["isError"] = p_error;
	return result;
}

Dictionary json_result(const Variant &p_value) {
	return text_result(JSON::stringify(p_value, "  ", false));
}

Dictionary tool(const String &p_name, const String &p_description, const Dictionary &p_properties = Dictionary(), const PackedStringArray &p_required = PackedStringArray()) {
	Dictionary schema;
	schema["type"] = "object";
	schema["properties"] = p_properties;
	if (!p_required.is_empty()) {
		schema["required"] = p_required;
	}
	Dictionary out;
	out["name"] = p_name;
	out["description"] = p_description;
	out["inputSchema"] = schema;
	return out;
}

Dictionary prop(const String &p_type, const String &p_description) {
	Dictionary out;
	out["type"] = p_type;
	out["description"] = p_description;
	return out;
}

void list_files(const String &p_dir, PackedStringArray &r_files, int p_limit) {
	Ref<DirAccess> dir = DirAccess::open(p_dir);
	if (dir.is_null()) {
		return;
	}
	PackedStringArray dirs = dir->get_directories();
	PackedStringArray files = dir->get_files();
	dirs.sort();
	files.sort();
	for (const String &file : files) {
		if (r_files.size() >= p_limit) {
			return;
		}
		if (!file.ends_with(".import") && !file.ends_with(".uid")) {
			r_files.push_back(p_dir.path_join(file));
		}
	}
	for (const String &sub : dirs) {
		if (!sub.begins_with(".") && sub != "out") {
			list_files(p_dir.path_join(sub), r_files, p_limit);
		}
	}
}


// Personagem do gestor de animações em JSON: animações, tempos, repetição, ataque, corpo e célula.
Dictionary character_summary(const Ref<MDPersonagem> &personagem) {
	Dictionary out;
	out["nome"] = personagem->get_character_name();
	out["corpo"] = to_json(personagem->get_body_box());
	const MDPersonagem::Celula cell = personagem->get_cell();
	out["celula"] = to_json(cell.size);
	out["pes_na_celula"] = to_json(cell.anchor);
	Array animations;
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		Dictionary a;
		a["nome"] = anim.name;
		a["quadros"] = anim.frames.size();
		a["fps"] = anim.fps;
		a["repete"] = anim.loop;
		Array ticks;
		for (const MDPersonagem::Quadro &q : anim.frames) {
			ticks.push_back(q.ticks);
		}
		a["tempos"] = ticks;
		if (anim.attack) {
			Dictionary attack;
			attack["caixa"] = to_json(anim.attack_box);
			attack["quadros"] = arr(anim.attack_first + 1, anim.attack_last + 1);
			a["ataque"] = attack;
		}
		animations.push_back(a);
	}
	out["animacoes"] = animations;
	return out;
}

Dictionary rect_dict(const Rect2i &p_rect) {
	Dictionary d;
	d["x"] = p_rect.position.x;
	d["y"] = p_rect.position.y;
	d["width"] = p_rect.size.x;
	d["height"] = p_rect.size.y;
	return d;
}

// [x, y, largura, altura] → Rect2i (tamanho 0 se não for uma lista de 4 números).
Rect2i json_rect(const Variant &p_value) {
	const Array list = p_value.get_type() == Variant::ARRAY ? Array(p_value) : Array();
	return list.size() == 4 ? Rect2i(int(list[0]), int(list[1]), int(list[2]), int(list[3])) : Rect2i();
}

// Programa do sistema (xdotool, import) pelo caminho; vazio se não existir.
String system_tool(const String &p_name) {
	List<String> args;
	args.push_back("-c");
	args.push_back("command -v " + p_name);
	String output;
	OS::get_singleton()->execute("/bin/sh", args, &output);
	return output.strip_edges();
}

} // namespace

// ---- Servidor ----

String RetroAiPlugin::get_url() const {
	return port ? vformat("http://127.0.0.1:%d/mcp/%s", port, token) : String();
}

void RetroAiPlugin::_start_server() {
	if (!bool(EDITOR_GET("retro_studio/ia/servidor_mcp"))) {
		start_error = U("Desligado em Configurações do Editor → Retro Studio → Ia → Servidor Mcp.");
		return;
	}
	// Token guardado em ~/.retrostudio/ia/token (só o dono lê), para a URL não mudar entre aberturas.
	const String folder = OS::get_singleton()->get_environment("HOME").path_join(".retrostudio/ia");
	DirAccess::make_dir_recursive_absolute(folder);
	FileAccess::set_unix_permissions(folder, FileAccess::UNIX_READ_OWNER | FileAccess::UNIX_WRITE_OWNER | FileAccess::UNIX_EXECUTE_OWNER);
	const String token_file = folder.path_join("token");
	token = FileAccess::get_file_as_string(token_file).strip_edges();
	if (token.length() < 32) {
		uint8_t bytes[16];
		OS::get_singleton()->get_entropy(bytes, sizeof(bytes));
		token = String::hex_encode_buffer(bytes, sizeof(bytes));
		const Ref<FileAccess> file = FileAccess::open(token_file, FileAccess::WRITE);
		if (file.is_valid()) {
			file->store_string(token + "\n");
			file->close();
			FileAccess::set_unix_permissions(token_file, FileAccess::UNIX_READ_OWNER | FileAccess::UNIX_WRITE_OWNER);
		}
	}
	server.instantiate();
	const int first = EDITOR_GET("retro_studio/ia/porta");
	for (int candidate = first; candidate < first + 10; candidate++) {
		if (server->listen(candidate, IPAddress("127.0.0.1")) == OK) {
			port = candidate;
			return;
		}
	}
	start_error = vformat(U("Nenhuma porta livre entre %d e %d."), first, first + 9);
	server.unref();
}

void RetroAiPlugin::_poll() {
	// Salvar cenas (antes do build) roda um ciclo do editor por dentro, que chamaria _poll de novo
	// no meio do atendimento.
	if (server.is_null() || polling) {
		return;
	}
	polling = true;
	while (server->is_connection_available() && connections.size() < 16) {
		Conexao conn;
		conn.peer = server->take_connection();
		conn.since = OS::get_singleton()->get_ticks_msec();
		connections.push_back(conn);
	}
	RetroSgdkPlugin *build = RetroSgdkPlugin::get_singleton();
	for (int i = connections.size() - 1; i >= 0; i--) {
		Conexao &conn = connections.write[i];
		conn.peer->poll();
		bool done = conn.peer->get_status() != StreamPeerSocket::STATUS_CONNECTED;
		if (!done && conn.waiting_build) {
			// Build pedido pela IA: responde com o relatório quando ele termina.
			if (!build || !build->is_building()) {
				Dictionary response;
				response["jsonrpc"] = "2.0";
				response["id"] = conn.build_id;
				response["result"] = json_result(build ? build->get_report() : Dictionary());
				_respond(conn, 200, JSON::stringify(response));
				done = true;
			}
		} else if (!done) {
			const int available = conn.peer->get_available_bytes();
			if (available > 0) {
				const int old = conn.buffer.size();
				conn.buffer.resize(old + available);
				int received = 0;
				conn.peer->get_partial_data(conn.buffer.ptrw() + old, available, received);
				conn.buffer.resize(old + received);
			}
			done = _handle(conn);
			if (!done && OS::get_singleton()->get_ticks_msec() - conn.since > 15000) {
				done = true; // Pedido incompleto há muito tempo.
			}
		}
		if (done) {
			conn.peer->disconnect_from_host();
			connections.remove_at(i);
		}
	}
	polling = false;
}

void RetroAiPlugin::_respond(Conexao &r_conn, int p_status, const String &p_body, const String &p_extra_headers) {
	const char *reason = p_status == 200 ? "OK" : p_status == 202 ? "Accepted" : p_status == 400 ? "Bad Request" : p_status == 403 ? "Forbidden" : p_status == 404 ? "Not Found" : p_status == 405 ? "Method Not Allowed" : "Error";
	const CharString body = p_body.utf8();
	const String head = vformat("HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\nCache-Control: no-store\r\n%s\r\n", p_status, reason, body.length(), p_extra_headers);
	const CharString head_utf8 = head.utf8();
	r_conn.peer->set_no_delay(true);
	r_conn.peer->put_data((const uint8_t *)head_utf8.get_data(), head_utf8.length());
	if (body.length()) {
		r_conn.peer->put_data((const uint8_t *)body.get_data(), body.length());
	}
}

bool RetroAiPlugin::_handle(Conexao &r_conn) {
	// Cabeçalhos completos?
	const Vector<uint8_t> &bytes = r_conn.buffer;
	int header_end = -1;
	for (int i = 3; i < bytes.size(); i++) {
		if (bytes[i - 3] == '\r' && bytes[i - 2] == '\n' && bytes[i - 1] == '\r' && bytes[i] == '\n') {
			header_end = i + 1;
			break;
		}
	}
	if (header_end < 0) {
		if (bytes.size() > 65536) {
			_respond(r_conn, 400, "{}");
			return true;
		}
		return false;
	}
	const Vector<String> lines = String::utf8((const char *)bytes.ptr(), header_end).split("\r\n");
	const Vector<String> request = lines[0].split(" ");
	if (request.size() < 2) {
		_respond(r_conn, 400, "{}");
		return true;
	}
	HashMap<String, String> headers;
	for (int i = 1; i < lines.size(); i++) {
		const int colon = lines[i].find_char(':');
		if (colon > 0) {
			headers[lines[i].substr(0, colon).strip_edges().to_lower()] = lines[i].substr(colon + 1).strip_edges();
		}
	}
	const int length = headers.has("content-length") ? headers["content-length"].to_int() : 0;
	if (length > 4 * 1024 * 1024) {
		_respond(r_conn, 400, "{}");
		return true;
	}
	if (bytes.size() < header_end + length) {
		return false; // Corpo ainda chegando.
	}
	// Página web tentando falar com o servidor (DNS rebinding): recusa.
	if (headers.has("origin")) {
		const String origin = headers["origin"];
		if (!origin.begins_with("http://127.0.0.1") && !origin.begins_with("http://localhost")) {
			_respond(r_conn, 403, "{}");
			return true;
		}
	}
	const String path = request[1].split("?")[0];
	if (token.is_empty() || (path != "/mcp/" + token && path != "/mcp/" + token + "/")) {
		_respond(r_conn, 404, "{}");
		return true;
	}
	if (request[0] != "POST") {
		_respond(r_conn, request[0] == "DELETE" ? 200 : 405, "{}", "Allow: POST\r\n");
		return true;
	}
	JSON json;
	if (json.parse(String::utf8((const char *)bytes.ptr() + header_end, length)) != OK) {
		Dictionary error;
		error["code"] = -32700;
		error["message"] = "Parse error";
		Dictionary response;
		response["jsonrpc"] = "2.0";
		response["id"] = Variant();
		response["error"] = error;
		_respond(r_conn, 400, JSON::stringify(response));
		return true;
	}
	const Variant message = json.get_data();
	const String session = "Mcp-Session-Id: retro-studio\r\n";
	if (message.get_type() == Variant::DICTIONARY) {
		bool deferred = false;
		const Variant response = _rpc(message, r_conn, deferred);
		if (deferred) {
			r_conn.buffer.clear();
			return false; // Responde quando o build terminar.
		}
		if (response.get_type() == Variant::NIL) {
			_respond(r_conn, 202, "", session); // Notificação: sem resposta.
		} else {
			_respond(r_conn, 200, JSON::stringify(response), session);
		}
		return true;
	}
	if (message.get_type() == Variant::ARRAY) {
		Array responses;
		for (const Variant &item : Array(message)) {
			bool deferred = false;
			const Variant response = item.get_type() == Variant::DICTIONARY ? _rpc(item, r_conn, deferred) : Variant();
			if (response.get_type() != Variant::NIL && !deferred) {
				responses.push_back(response);
			}
		}
		_respond(r_conn, responses.is_empty() ? 202 : 200, responses.is_empty() ? String() : JSON::stringify(responses), session);
		return true;
	}
	_respond(r_conn, 400, "{}");
	return true;
}

Variant RetroAiPlugin::_rpc(const Dictionary &p_request, Conexao &r_conn, bool &r_deferred) {
	const String method = p_request.get("method", "");
	if (!p_request.has("id")) {
		return Variant(); // Notificação (notifications/initialized, cancelled…).
	}
	Dictionary response;
	response["jsonrpc"] = "2.0";
	// O JSON do Godot lê todo número como real: o id volta inteiro, como veio.
	const Variant id = p_request["id"];
	response["id"] = id.get_type() == Variant::FLOAT && double(id) == Math::floor(double(id)) ? Variant(int64_t(double(id))) : id;
	const Dictionary params = p_request.get("params", Dictionary());
	if (method == "initialize") {
		String version = PROTOCOL_VERSIONS[0];
		for (int i = 0; PROTOCOL_VERSIONS[i]; i++) {
			if (String(params.get("protocolVersion", "")) == PROTOCOL_VERSIONS[i]) {
				version = PROTOCOL_VERSIONS[i];
			}
		}
		Dictionary tools;
		tools["listChanged"] = false;
		Dictionary capabilities;
		capabilities["tools"] = tools;
		Dictionary info;
		info["name"] = "retro-studio";
		info["version"] = GODOT_VERSION_NUMBER;
		Dictionary result;
		result["protocolVersion"] = version;
		result["capabilities"] = capabilities;
		result["serverInfo"] = info;
		result["instructions"] = U("Retro Studio: editor de jogos de Mega Drive feito sobre o Godot. O jogo é montado em cenas (.tscn) com nodes MD* (MDCena na raiz, MDMapa, MDJogador, MDInimigo…), que o build converte para C e recursos do SGDK. Comece pelo guia (guide) e por project_info. Mudanças em nodes (node_add, node_set, node_remove) entram no desfazer do editor e só vão para o disco com scene_save; build_run compila (e roda) e devolve erros e uso de VRAM. Código próprio de cada cena fica em src/<cena>.c (funções <cena>_iniciar e <cena>_atualizar); não edite src/gerado nem res/gerado. Textos para o usuário em português do Brasil.");
		response["result"] = result;
	} else if (method == "ping") {
		response["result"] = Dictionary();
	} else if (method == "tools/list") {
		Dictionary result;
		result["tools"] = _tools();
		response["result"] = result;
	} else if (method == "tools/call") {
		const Dictionary result = _call(params.get("name", ""), params.get("arguments", Dictionary()), r_conn, r_deferred);
		if (r_deferred) {
			r_conn.build_id = response["id"];
			return Variant();
		}
		response["result"] = result;
	} else {
		Dictionary error;
		error["code"] = -32601;
		error["message"] = "Method not found: " + method;
		response["error"] = error;
	}
	return response;
}

// ---- Ferramentas ----

Array RetroAiPlugin::_tools() const {
	Array list;
	Dictionary scene_path;
	scene_path["path"] = prop("string", U("Cena (res://… .tscn). Vazio = a cena aberta no editor."));
	Dictionary node_ref;
	node_ref["node"] = prop("string", U("Caminho do node a partir da raiz da cena, como em scene_read (\".\" = a raiz)."));
	Dictionary props_obj = prop("object", U("Propriedades a definir: {\"nome\": valor}. Vetores como [x, y], retângulos como [x, y, largura, altura], cores como \"#rrggbb\", recursos pelo caminho res://."));

	list.push_back(tool("guide", U("Guia do Retro Studio: nodes MD*, propriedades, limites do console, personagens, cutscenes e código C da cena. Leia antes de editar.")));
	list.push_back(tool("project_info", U("Projeto aberto: pasta, cena principal, cenas, personagens (.charset.json), código C, cena em edição e se a ROM existe.")));
	Dictionary tree_args;
	tree_args["path"] = prop("string", U("Pasta (res://…). Vazio = o projeto todo."));
	list.push_back(tool("project_tree", U("Arquivos do projeto (sem .godot e out)."), tree_args));
	list.push_back(tool("ide_state", U("Estado do editor: cena em edição, cenas abertas, nodes selecionados e se há um build rodando.")));
	list.push_back(tool("scene_read", U("Árvore de nodes de uma cena com tipo, posição, propriedades diferentes do padrão e avisos de cada node. A cena aberta é lida como está no editor (com mudanças não salvas)."), scene_path));
	Dictionary open_args;
	open_args["path"] = prop("string", U("Cena a abrir (res://… .tscn)."));
	list.push_back(tool("scene_open", U("Abre a cena no editor (passa a ser a cena em edição)."), open_args, PackedStringArray({ "path" })));
	Dictionary new_args;
	new_args["path"] = prop("string", U("Arquivo da cena nova (res://… .tscn)."));
	new_args["name"] = prop("string", U("Nome da raiz (MDCena). Vazio = nome do arquivo."));
	list.push_back(tool("scene_new", U("Cria uma cena nova com uma MDCena na raiz e a abre."), new_args, PackedStringArray({ "path" })));
	list.push_back(tool("scene_save", U("Salva a cena em edição no disco.")));
	Dictionary add_args;
	add_args["type"] = prop("string", U("Tipo: MDFundo, MDMapa, MDColisao, MDSprite, MDJogador, MDInimigo, MDItem, MDPlataforma, MDSaida, MDRetorno, MDTexto, Node2D, Node ou AnimationPlayer."));
	add_args["parent"] = prop("string", U("Pai, a partir da raiz (\".\" = a raiz, o padrão)."));
	add_args["name"] = prop("string", U("Nome do node."));
	add_args["properties"] = props_obj;
	list.push_back(tool("node_add", U("Cria um node na cena em edição (com desfazer). Devolve o caminho e os avisos do node."), add_args, PackedStringArray({ "type" })));
	Dictionary set_args = node_ref.duplicate();
	set_args["properties"] = props_obj;
	list.push_back(tool("node_set", U("Altera propriedades de um node da cena em edição (com desfazer). \"position\" e \"name\" também valem."), set_args, PackedStringArray({ "node", "properties" })));
	list.push_back(tool("node_remove", U("Remove um node (e os filhos) da cena em edição (com desfazer)."), node_ref, PackedStringArray({ "node" })));
	Dictionary read_args;
	read_args["path"] = prop("string", U("Arquivo do projeto (res://… ou relativo)."));
	list.push_back(tool("file_read", U("Lê um arquivo de texto do projeto (código C, .res, .charset.json, .tscn…)."), read_args, PackedStringArray({ "path" })));
	Dictionary write_args = read_args.duplicate();
	write_args["content"] = prop("string", U("Conteúdo completo do arquivo."));
	list.push_back(tool("file_write", U("Grava um arquivo de texto do projeto (cria as pastas). Para cenas abertas use as ferramentas de node; src/gerado e res/gerado são refeitos a cada build."), write_args, PackedStringArray({ "path", "content" })));
	Dictionary character_args;
	character_args["path"] = prop("string", U("Personagem (res://… .charset.json)."));
	list.push_back(tool("character_read", U("Animações de um personagem do gestor de animações: nomes, quadros, tempos (1/60 s), repetição, caixa de ataque, corpo e a célula comum."), character_args, PackedStringArray({ "path" })));
	Dictionary build_args;
	build_args["run"] = prop("boolean", U("Também abre a ROM no emulador ao terminar."));
	Dictionary find_args;
	find_args["sheet"] = prop("string", U("Folha (res://… .png)."));
	find_args["region"] = prop("array", U("Região [x, y, largura, altura]; sem ela, a folha inteira."));
	list.push_back(tool("sheet_find_drawings", U("Acha os desenhos numa folha (fundo transparente ou da cor do canto): retângulos na ordem de leitura, com a mesma altura em cada faixa — prontos para virar quadros de uma animação."), find_args, PackedStringArray({ "sheet" })));
	Dictionary create_args;
	create_args["sheet"] = prop("string", U("Folha (res://… .png) do personagem."));
	list.push_back(tool("character_create", U("Cria um personagem vazio (.charset.json ao lado da folha) e devolve o caminho."), create_args, PackedStringArray({ "sheet" })));
	Dictionary anim_args;
	anim_args["name"] = prop("string", U("Animação a criar ou mudar."));
	anim_args["new_name"] = prop("string", U("Novo nome."));
	anim_args["remove"] = prop("boolean", U("Remove a animação."));
	anim_args["sheet"] = prop("string", U("Folha dos quadros (res://… .png; entra no personagem se for nova). Padrão: a primeira."));
	anim_args["frames"] = prop("array", U("Quadros livres: lista de [x, y, largura, altura] na folha (substitui os quadros). Os pés vão para a base, no meio dos pixels mais baixos."));
	anim_args["from_region"] = prop("array", U("Região [x, y, largura, altura]: cada desenho dela vira um quadro (como sheet_find_drawings)."));
	anim_args["grid"] = prop("object", U("Faixa em grade: {\"region\": [x, y, l, a], \"frame\": [largura, altura], \"gap\": [x, y]}."));
	anim_args["fps"] = prop("integer", U("Velocidade dos quadros sem tempo próprio."));
	anim_args["loop"] = prop("boolean", U("Repete (falso: para no último quadro)."));
	anim_args["ticks"] = prop("array", U("Tempo de cada quadro em 1/60 s (quadros livres)."));
	anim_args["attack"] = prop("object", U("Caixa de ataque {\"box\": [x, y, l, a] relativa aos pés, \"first\": 1, \"last\": 2} (quadros a partir de 1), ou false para tirar."));
	Dictionary edit_args;
	edit_args["path"] = prop("string", U("Personagem (res://… .charset.json)."));
	edit_args["body"] = prop("array", U("Caixa do corpo [x, y, largura, altura], relativa aos pés."));
	edit_args["animation"] = prop("object", U("Mudança numa animação (veja os campos na descrição)."));
	edit_args["animation"].operator Dictionary()["properties"] = anim_args;
	list.push_back(tool("character_edit", U("Cria, muda ou remove uma animação de um personagem e/ou a caixa do corpo. Grava o .charset.json; o gestor de animações e os nodes que usam o personagem se atualizam na hora. Devolve o personagem como character_read."), edit_args, PackedStringArray({ "path" })));
	Dictionary map_args;
	map_args["node"] = prop("string", U("MDMapa ou MDColisao da cena em edição."));
	map_args["rect"] = prop("array", U("Região em células [x, y, largura, altura]; padrão: a usada (até 64×64)."));
	list.push_back(tool("map_read", U("Células de um mapa: tamanho do tile, grade do atlas do TileSet, região usada e as células [x, y, atlas_x, atlas_y] da região. Numa MDColisao, o tipo de cada tile do atlas."), map_args, PackedStringArray({ "node" })));
	Dictionary paint_args;
	paint_args["node"] = prop("string", U("MDMapa ou MDColisao da cena em edição."));
	paint_args["cells"] = prop("array", U("Células [x, y, atlas_x, atlas_y]; atlas_x = -1 apaga."));
	paint_args["fill"] = prop("object", U("Preenche {\"rect\": [x, y, l, a], \"tile\": [atlas_x, atlas_y]}."));
	paint_args["erase_rect"] = prop("array", U("Apaga a região [x, y, largura, altura]."));
	list.push_back(tool("map_paint", U("Pinta ou apaga células de um mapa da cena em edição (com desfazer)."), paint_args, PackedStringArray({ "node" })));
	list.push_back(tool("emulator_screenshot", U("Tela do jogo rodando no emulador (abra com build_run run=true). Precisa de X11 com xdotool e ImageMagick (import).")));
	Dictionary press_args;
	press_args["buttons"] = prop("array", U("Botões apertados juntos: up, down, left, right, a, b, c, start."));
	press_args["ms"] = prop("integer", U("Quanto tempo segurar, em milissegundos (padrão 200, máximo 5000)."));
	list.push_back(tool("emulator_press", U("Aperta botões do controle 1 no emulador (segura pelo tempo pedido e solta). Use com emulator_screenshot para testar o jogo."), press_args, PackedStringArray({ "buttons" })));
	list.push_back(tool("build_run", U("Salva as cenas, gera o código da cena principal e das alcançadas, compila com o SGDK e espera terminar. Devolve ok, problemas (erros do gcc e das cenas), uso de VRAM por cena e o fim do log."), build_args));
	list.push_back(tool("build_errors", U("Relatório do último build (o mesmo de build_run).")));
	Dictionary shot_args;
	shot_args["area"] = prop("string", U("\"cena\" (a vista 2D da cena em edição, o padrão) ou \"editor\" (a janela inteira)."));
	list.push_back(tool("ide_screenshot", U("Captura da vista 2D da cena ou da janela do editor (PNG)."), shot_args));
	return list;
}

Dictionary RetroAiPlugin::_call(const String &p_name, const Dictionary &p_args, Conexao &r_conn, bool &r_deferred) {
	EditorInterface *editor = EditorInterface::get_singleton();
	Node *root = editor->get_edited_scene_root();
	auto edited_node = [&](const String &p_path, String &r_error) -> Node * {
		if (!root) {
			r_error = U("Nenhuma cena aberta no editor (use scene_open).");
			return nullptr;
		}
		const String path = p_path.strip_edges();
		Node *node = path.is_empty() || path == "." || path == String(root->get_name()) ? root : root->get_node_or_null(NodePath(path));
		if (!node) {
			r_error = U("Node não encontrado na cena em edição: ") + p_path;
		}
		return node;
	};
	auto apply_properties = [&](Node *p_node, const Dictionary &p_props, Vector<Pair<StringName, Variant>> &r_values, String &r_error) {
		for (const Variant &key : p_props.keys()) {
			const String name = key;
			PropertyInfo info;
			if (name == "name") {
				r_values.push_back(Pair<StringName, Variant>("name", StringName(String(p_props[key]))));
				continue;
			}
			if (!find_property(p_node, name, info) || !(info.usage & PROPERTY_USAGE_STORAGE)) {
				r_error = vformat(U("%s não tem a propriedade \"%s\"."), p_node->get_class(), name);
				return false;
			}
			Variant value;
			String problem;
			if (!from_json(p_props[key], info.type, value, problem)) {
				r_error = vformat("%s: %s.", name, problem);
				return false;
			}
			r_values.push_back(Pair<StringName, Variant>(info.name, value));
		}
		return true;
	};

	if (p_name == "guide") {
		return text_result(String::utf8((const char *)RETRO_GUIA));
	}
	if (p_name == "project_info") {
		Dictionary out;
		out["nome"] = GLOBAL_GET("application/config/name");
		out["pasta"] = ProjectSettings::get_singleton()->get_resource_path();
		out["cena_principal"] = ResourceUID::ensure_path(GLOBAL_GET("application/run/main_scene"));
		PackedStringArray files;
		list_files("res://", files, 2000);
		PackedStringArray scenes, characters, code;
		for (const String &file : files) {
			if (file.ends_with(".tscn")) {
				scenes.push_back(file);
			} else if (file.ends_with(".charset.json")) {
				characters.push_back(file);
			} else if ((file.ends_with(".c") || file.ends_with(".h")) && !file.contains("/gerado/") && !file.contains("_gerado.")) {
				code.push_back(file);
			}
		}
		out["cenas"] = scenes;
		out["personagens"] = characters;
		out["codigo_c"] = code;
		out["cena_em_edicao"] = root ? root->get_scene_file_path() : String();
		out["rom"] = FileAccess::exists("res://out/rom.bin") ? String("res://out/rom.bin") : String();
		return json_result(out);
	}
	if (p_name == "project_tree") {
		const String base = p_args.get("path", "").operator String().is_empty() ? String("res://") : project_path(p_args["path"]);
		if (base.is_empty()) {
			return text_result(U("Caminho fora do projeto."), true);
		}
		PackedStringArray files;
		list_files(base, files, 800);
		return text_result(String("\n").join(files));
	}
	if (p_name == "ide_state") {
		Dictionary out;
		out["cena_em_edicao"] = root ? root->get_scene_file_path() : String();
		out["cenas_abertas"] = editor->get_open_scenes();
		PackedStringArray selected;
		for (Node *node : editor->get_selection()->get_top_selected_node_list()) {
			selected.push_back(root ? String(root->get_path_to(node)) : String(node->get_name()));
		}
		out["selecionados"] = selected;
		out["build_rodando"] = RetroSgdkPlugin::get_singleton() && RetroSgdkPlugin::get_singleton()->is_building();
		return json_result(out);
	}
	if (p_name == "scene_read") {
		const String requested = p_args.get("path", "");
		const String path = requested.is_empty() ? String() : project_path(requested);
		if (!requested.is_empty() && path.is_empty()) {
			return text_result(U("Caminho fora do projeto."), true);
		}
		if (path.is_empty() || (root && root->get_scene_file_path() == path)) {
			if (!root) {
				return text_result(U("Nenhuma cena aberta no editor; informe path."), true);
			}
			Dictionary out = describe(root, root, 0);
			out["arquivo"] = root->get_scene_file_path();
			out["nao_salva"] = EditorUndoRedoManager::get_singleton()->is_history_unsaved(EditorNode::get_editor_data().get_current_edited_scene_history_id());
			return json_result(out);
		}
		const Ref<PackedScene> scene = ResourceLoader::load(path);
		if (scene.is_null()) {
			return text_result(U("Não foi possível carregar a cena ") + path, true);
		}
		Node *instance = scene->instantiate(PackedScene::GEN_EDIT_STATE_INSTANCE);
		if (!instance) {
			return text_result(U("A cena não pôde ser instanciada: ") + path, true);
		}
		Dictionary out = describe(instance, instance, 0);
		out["arquivo"] = path;
		memdelete(instance);
		return json_result(out);
	}
	if (p_name == "scene_open") {
		const String path = project_path(p_args.get("path", ""));
		if (path.is_empty() || !FileAccess::exists(path)) {
			return text_result(U("Cena não encontrada: ") + String(p_args.get("path", "")), true);
		}
		editor->open_scene_from_path(path);
		return text_result(U("Aberta: ") + path);
	}
	if (p_name == "scene_new") {
		const String path = project_path(p_args.get("path", ""));
		if (path.is_empty() || !path.ends_with(".tscn")) {
			return text_result(U("Informe um arquivo .tscn dentro do projeto."), true);
		}
		if (FileAccess::exists(path)) {
			return text_result(U("Já existe: ") + path, true);
		}
		String name = p_args.get("name", "");
		if (name.is_empty()) {
			name = path.get_file().get_basename().capitalize().replace(" ", "");
		}
		DirAccess::make_dir_recursive_absolute(ProjectSettings::get_singleton()->globalize_path(path.get_base_dir()));
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			return text_result(U("Não foi possível criar ") + path, true);
		}
		file->store_string(vformat("[gd_scene format=3]\n\n[node name=\"%s\" type=\"MDCena\"]\n", name.c_escape()));
		file->close();
		EditorFileSystem::get_singleton()->update_file(path);
		editor->open_scene_from_path(path);
		return text_result(U("Criada e aberta: ") + path);
	}
	if (p_name == "scene_save") {
		if (!root) {
			return text_result(U("Nenhuma cena aberta."), true);
		}
		return editor->save_scene() == OK ? text_result(U("Salva: ") + root->get_scene_file_path()) : text_result(U("Não foi possível salvar a cena."), true);
	}
	if (p_name == "node_add") {
		String error;
		Node *parent = edited_node(p_args.get("parent", "."), error);
		if (!parent) {
			return text_result(error, true);
		}
		const String type = p_args.get("type", "");
		if (!creatable(type) || !ClassDB::can_instantiate(type)) {
			return text_result(U("Tipo não permitido: ") + type + U(" (use os nodes MD*, Node, Node2D ou AnimationPlayer)."), true);
		}
		Node *node = Object::cast_to<Node>(ClassDB::instantiate(type));
		if (!node) {
			return text_result(U("Não foi possível criar ") + type, true);
		}
		const String name = p_args.get("name", "");
		node->set_name(name.is_empty() ? type : name);
		Vector<Pair<StringName, Variant>> values;
		if (!apply_properties(node, p_args.get("properties", Dictionary()), values, error)) {
			memdelete(node);
			return text_result(error, true);
		}
		for (const Pair<StringName, Variant> &value : values) {
			node->set(value.first, value.second);
		}
		EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
		undo_redo->create_action(U("IA: criar ") + String(node->get_name()), UndoRedo::MERGE_DISABLE, root);
		undo_redo->add_do_method(parent, "add_child", node, true);
		undo_redo->add_do_method(node, "set_owner", root);
		undo_redo->add_do_reference(node);
		undo_redo->add_undo_method(parent, "remove_child", node);
		undo_redo->commit_action();
		Dictionary out;
		out["caminho"] = String(root->get_path_to(node));
		out["avisos"] = node->get_configuration_warnings();
		return json_result(out);
	}
	if (p_name == "node_set") {
		String error;
		Node *node = edited_node(p_args.get("node", ""), error);
		if (!node) {
			return text_result(error, true);
		}
		Vector<Pair<StringName, Variant>> values;
		if (!apply_properties(node, p_args.get("properties", Dictionary()), values, error)) {
			return text_result(error, true);
		}
		EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
		undo_redo->create_action(U("IA: alterar ") + String(node->get_name()), UndoRedo::MERGE_DISABLE, root);
		for (const Pair<StringName, Variant> &value : values) {
			undo_redo->add_do_property(node, value.first, value.second);
			undo_redo->add_undo_property(node, value.first, node->get(value.first));
		}
		undo_redo->commit_action();
		Dictionary out;
		out["caminho"] = node == root ? String(".") : String(root->get_path_to(node));
		out["avisos"] = node->get_configuration_warnings();
		return json_result(out);
	}
	if (p_name == "node_remove") {
		String error;
		Node *node = edited_node(p_args.get("node", ""), error);
		if (!node) {
			return text_result(error, true);
		}
		if (node == root) {
			return text_result(U("A raiz da cena não pode ser removida."), true);
		}
		Array owned;
		List<Node *> stack;
		stack.push_back(node);
		while (!stack.is_empty()) {
			Node *current = stack.front()->get();
			stack.pop_front();
			if (current->get_owner() == root) {
				owned.push_back(current);
			}
			for (int i = 0; i < current->get_child_count(); i++) {
				stack.push_back(current->get_child(i));
			}
		}
		Node *parent = node->get_parent();
		EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
		undo_redo->create_action(U("IA: remover ") + String(node->get_name()), UndoRedo::MERGE_DISABLE, root);
		undo_redo->add_do_method(parent, "remove_child", node);
		undo_redo->add_undo_method(parent, "add_child", node, true);
		undo_redo->add_undo_method(parent, "move_child", node, node->get_index());
		undo_redo->add_undo_method(this, "_set_owners", root, owned);
		undo_redo->add_undo_reference(node);
		undo_redo->commit_action();
		return text_result(U("Removido: ") + String(p_args.get("node", "")));
	}
	if (p_name == "file_read") {
		const String path = project_path(p_args.get("path", ""));
		if (path.is_empty() || !FileAccess::exists(path)) {
			return text_result(U("Arquivo não encontrado no projeto: ") + String(p_args.get("path", "")), true);
		}
		const Vector<uint8_t> bytes = FileAccess::get_file_as_bytes(path);
		if (bytes.size() > 512 * 1024) {
			return text_result(vformat(U("Arquivo grande demais para ler (%d bytes)."), bytes.size()), true);
		}
		return text_result(String::utf8((const char *)bytes.ptr(), bytes.size()));
	}
	if (p_name == "file_write") {
		const String path = project_path(p_args.get("path", ""));
		if (path.is_empty()) {
			return text_result(U("Caminho fora do projeto."), true);
		}
		for (const String &open : editor->get_open_scenes()) {
			if (open == path) {
				return text_result(U("A cena está aberta no editor: use node_add/node_set/node_remove e scene_save."), true);
			}
		}
		const String content = p_args.get("content", "");
		if (content.utf8().length() > 1024 * 1024) {
			return text_result(U("Conteúdo grande demais (limite de 1 MB)."), true);
		}
		DirAccess::make_dir_recursive_absolute(ProjectSettings::get_singleton()->globalize_path(path.get_base_dir()));
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			return text_result(U("Não foi possível gravar ") + path, true);
		}
		file->store_string(content);
		file->close();
		EditorFileSystem::get_singleton()->update_file(path);
		String note = U("Gravado: ") + path;
		if (path.contains("/gerado/") || path == "res://res/cenas_gerado.res") {
			note += U(" (atenção: arquivos gerados são refeitos a cada build)");
		}
		return text_result(note);
	}
	if (p_name == "character_read") {
		const String path = project_path(p_args.get("path", ""));
		const Ref<MDPersonagem> personagem = path.is_empty() ? Ref<MDPersonagem>() : Ref<MDPersonagem>(ResourceLoader::load(path));
		if (personagem.is_null()) {
			return text_result(U("Personagem não encontrado: ") + String(p_args.get("path", "")), true);
		}
		return json_result(character_summary(personagem));
	}
	if (p_name == "sheet_find_drawings") {
		const String sheet = project_path(p_args.get("sheet", ""));
		const Ref<Image> image = sheet.is_empty() ? Ref<Image>() : MDPersonagem::load_sheet(sheet);
		if (image.is_null()) {
			return text_result(U("Folha não encontrada: ") + String(p_args.get("sheet", "")), true);
		}
		Rect2i region = json_rect(p_args.get("region", Variant()));
		if (!region.has_area()) {
			region = Rect2i(Vector2i(), image->get_size());
		}
		Array rects;
		for (const Rect2i &rect : MDPersonagem::split_drawings(image, region)) {
			rects.push_back(to_json(rect));
		}
		Dictionary out;
		out["folha"] = to_json(image->get_size());
		out["desenhos"] = rects;
		return json_result(out);
	}
	if (p_name == "character_create") {
		const String sheet = project_path(p_args.get("sheet", ""));
		if (sheet.is_empty() || !FileAccess::exists(sheet)) {
			return text_result(U("Folha não encontrada: ") + String(p_args.get("sheet", "")), true);
		}
		String problem;
		const String path = RetroAnimationEditor::create_character(sheet, problem);
		if (path.is_empty()) {
			return text_result(problem, true);
		}
		EditorFileSystem::get_singleton()->update_file(path);
		return text_result(U("Criado: ") + path);
	}
	if (p_name == "character_edit") {
		const String path = project_path(p_args.get("path", ""));
		const Ref<MDPersonagem> personagem = path.is_empty() ? Ref<MDPersonagem>() : Ref<MDPersonagem>(ResourceLoader::load(path));
		if (personagem.is_null()) {
			return text_result(U("Personagem não encontrado: ") + String(p_args.get("path", "")), true);
		}
		// O mesmo dicionário que o gestor de animações edita: as mudanças aparecem nele.
		Dictionary charset = personagem->get_data();
		const Dictionary before = charset.duplicate(true);
		auto fail = [&](const String &p_problem) {
			(void)personagem->set_data(before);
			return text_result(p_problem, true);
		};
		if (p_args.has("body")) {
			const Rect2i body = json_rect(p_args["body"]);
			if (!body.has_area()) {
				return fail(U("body: use [x, y, largura, altura]."));
			}
			charset["bodyBox"] = rect_dict(body);
		}
		const Dictionary change = p_args.get("animation", Dictionary());
		if (!change.is_empty()) {
			const String name = change.get("name", "");
			if (name.is_empty()) {
				return fail(U("animation.name é obrigatório."));
			}
			Array list = charset.get("animations", Array());
			charset["animations"] = list;
			int index = -1;
			for (int i = 0; i < list.size(); i++) {
				if (String(Dictionary(list[i]).get("name", "")) == name) {
					index = i;
				}
			}
			if (bool(change.get("remove", false))) {
				if (index < 0) {
					return fail(U("Animação não existe: ") + name);
				}
				list.remove_at(index);
			} else {
				if (index < 0) {
					Dictionary created;
					created["id"] = vformat("anim-%d-ia", int64_t(OS::get_singleton()->get_unix_time() * 1000) + list.size());
					created["name"] = name;
					created["fps"] = 8;
					created["loop"] = true;
					list.push_back(created);
					index = list.size() - 1;
				}
				Dictionary anim = list[index];
				if (change.has("new_name")) {
					anim["name"] = change["new_name"];
				}
				// Folha: a pedida (entra no personagem se for nova) ou a primeira.
				String source_id;
				Ref<Image> image;
				const String sheet = change.has("sheet") ? project_path(change["sheet"]) : String();
				const HashMap<String, String> sources = personagem->get_sources();
				if (!sheet.is_empty()) {
					for (const KeyValue<String, String> &E : sources) {
						if (E.value == sheet) {
							source_id = E.key;
						}
					}
					if (source_id.is_empty()) {
						if (!FileAccess::exists(sheet)) {
							return fail(U("Folha não encontrada: ") + sheet);
						}
						Array source_list = charset.get("sources", Array());
						for (int n = source_list.size() + 1; source_id.is_empty() || sources.has(source_id); n++) {
							source_id = "sheet-" + itos(n);
						}
						Dictionary source;
						source["id"] = source_id;
						source["name"] = sheet.get_file();
						source["path"] = sheet.trim_prefix("res://");
						source_list.push_back(source);
						charset["sources"] = source_list;
					}
					image = MDPersonagem::load_sheet(sheet);
				} else {
					const Array source_list = charset.get("sources", Array());
					source_id = source_list.is_empty() ? String("sheet-1") : String(Dictionary(source_list[0]).get("id", "sheet-1"));
					if (sources.has(source_id)) {
						image = MDPersonagem::load_sheet(sources[source_id]);
					}
				}
				Vector<Rect2i> rects;
				if (change.has("from_region")) {
					rects = MDPersonagem::split_drawings(image, json_rect(change["from_region"]));
					if (rects.is_empty()) {
						return fail(U("Nenhum desenho na região (tudo transparente ou da cor do fundo)."));
					}
				} else if (change.has("frames")) {
					for (const Variant &item : Array(change["frames"])) {
						const Rect2i rect = json_rect(item);
						if (!rect.has_area()) {
							return fail(U("frames: cada quadro é [x, y, largura, altura]."));
						}
						rects.push_back(rect);
					}
				}
				if (!rects.is_empty()) {
					Array frames;
					Vector2i biggest;
					for (const Rect2i &rect : rects) {
						Dictionary f = rect_dict(rect);
						f["anchorX"] = MDPersonagem::feet_x(image, rect);
						f["anchorY"] = rect.size.y;
						f["sourceId"] = source_id;
						frames.push_back(f);
						biggest = biggest.max(rect.size);
					}
					anim["frames"] = frames;
					anim["region"] = rect_dict(rects[0]);
					anim["columns"] = frames.size();
					anim["rows"] = 1;
					anim["frameCount"] = frames.size();
					anim["frameWidth"] = biggest.x;
					anim["frameHeight"] = biggest.y;
					anim["anchorX"] = Dictionary(frames[0])["anchorX"];
					anim["anchorY"] = Dictionary(frames[0])["anchorY"];
					anim["sourceId"] = source_id;
				} else if (change.has("grid")) {
					const Dictionary grid = change["grid"];
					const Rect2i region = json_rect(grid.get("region", Variant()));
					const Array frame = grid.get("frame", Array());
					const Array gap = grid.get("gap", arr(0, 0));
					if (!region.has_area() || frame.size() != 2 || gap.size() != 2) {
						return fail(U("grid: use {\"region\": [x, y, l, a], \"frame\": [largura, altura], \"gap\": [x, y]}."));
					}
					const Vector2i size(MAX(1, int(frame[0])), MAX(1, int(frame[1])));
					const Vector2i spacing(MAX(0, int(gap[0])), MAX(0, int(gap[1])));
					const Vector2i count((region.size.x + spacing.x) / (size.x + spacing.x), (region.size.y + spacing.y) / (size.y + spacing.y));
					if (count.x * count.y == 0) {
						return fail(U("A grade não cabe na região."));
					}
					anim.erase("frames");
					anim["region"] = rect_dict(region);
					anim["frameWidth"] = size.x;
					anim["frameHeight"] = size.y;
					anim["spacingX"] = spacing.x;
					anim["spacingY"] = spacing.y;
					anim["columns"] = count.x;
					anim["rows"] = count.y;
					anim["frameCount"] = MIN(count.x * count.y, 255);
					anim["anchorX"] = size.x / 2;
					anim["anchorY"] = size.y;
					anim["sourceId"] = source_id;
				}
				if (change.has("fps")) {
					anim["fps"] = CLAMP(int(change["fps"]), 1, 60);
				}
				if (change.has("loop")) {
					anim["loop"] = bool(change["loop"]);
				}
				if (change.has("ticks")) {
					if (anim.get("frames", Variant()).get_type() != Variant::ARRAY) {
						return fail(U("ticks vale para quadros livres (frames ou from_region), não para faixa em grade."));
					}
					const Array frames = anim["frames"];
					const Array ticks = change["ticks"];
					for (int i = 0; i < MIN(frames.size(), ticks.size()); i++) {
						Dictionary frame = frames[i];
						frame["durationTicks"] = CLAMP(int(ticks[i]), 1, 255);
					}
				}
				if (change.has("attack")) {
					if (change["attack"].get_type() == Variant::BOOL) {
						Dictionary attack = anim.get("attack", Dictionary());
						attack["enabled"] = bool(change["attack"]);
						anim["attack"] = attack;
					} else {
						const Dictionary given = change["attack"];
						const Rect2i box = json_rect(given.get("box", Variant()));
						if (!box.has_area()) {
							return fail(U("attack.box: use [x, y, largura, altura], relativa aos pés."));
						}
						Dictionary attack = rect_dict(box);
						attack["enabled"] = true;
						attack["firstFrame"] = MAX(0, int(given.get("first", 1)) - 1);
						attack["lastFrame"] = MAX(0, int(given.get("last", given.get("first", 1))) - 1);
						anim["attack"] = attack;
					}
				}
			}
		}
		const String problem = personagem->set_data(charset);
		if (!problem.is_empty()) {
			return fail(problem);
		}
		if (personagem->save_to_file(path) != OK) {
			return text_result(U("Não foi possível gravar ") + path, true);
		}
		EditorFileSystem::get_singleton()->update_file(path);
		return json_result(character_summary(personagem));
	}
	if (p_name == "map_read" || p_name == "map_paint") {
		String error;
		TileMapLayer *layer = Object::cast_to<TileMapLayer>(edited_node(p_args.get("node", ""), error));
		if (!layer) {
			return text_result(error.is_empty() ? U("O node não é um mapa (MDMapa ou MDColisao).") : error, true);
		}
		const Ref<TileSet> tile_set = layer->get_tile_set();
		if (tile_set.is_null() || tile_set->get_source_count() == 0) {
			return text_result(U("O mapa não tem TileSet com atlas."), true);
		}
		const int source_id = tile_set->get_source_id(0);
		const Ref<TileSetAtlasSource> atlas = tile_set->get_source(source_id);
		if (atlas.is_null()) {
			return text_result(U("A primeira fonte do TileSet não é um atlas."), true);
		}
		if (p_name == "map_read") {
			Rect2i rect = json_rect(p_args.get("rect", Variant()));
			const Rect2i used = layer->get_used_rect();
			bool truncated = false;
			if (!rect.has_area()) {
				rect = used;
			}
			if (rect.size.x > 64 || rect.size.y > 64) {
				rect.size = rect.size.mini(64);
				truncated = true;
			}
			Array cells;
			for (int y = rect.position.y; y < rect.get_end().y; y++) {
				for (int x = rect.position.x; x < rect.get_end().x; x++) {
					if (layer->get_cell_source_id(Vector2i(x, y)) >= 0) {
						const Vector2i coords = layer->get_cell_atlas_coords(Vector2i(x, y));
						cells.push_back(arr(x, y, coords.x, coords.y));
					}
				}
			}
			Dictionary out;
			out["tile"] = to_json(tile_set->get_tile_size());
			out["atlas"] = atlas->get_texture().is_valid() ? atlas->get_texture()->get_path() : String();
			out["grade_do_atlas"] = to_json(atlas->get_atlas_grid_size());
			out["usada"] = to_json(used);
			out["regiao"] = to_json(rect);
			out["cortada_em_64"] = truncated;
			out["celulas"] = cells;
			if (Object::cast_to<MDColisao>(layer)) {
				// Dado personalizado "tipo" de cada tile (sem ele, sólido).
				const bool typed = tile_set->get_custom_data_layer_by_name("tipo") >= 0;
				Array types;
				for (int i = 0; i < atlas->get_tiles_count(); i++) {
					const Vector2i coords = atlas->get_tile_id(i);
					const TileData *tile = atlas->get_tile_data(coords, 0);
					const String tipo = typed && tile ? String(tile->get_custom_data("tipo")) : String();
					types.push_back(arr(coords.x, coords.y, tipo.is_empty() ? String("solido") : tipo));
				}
				out["tipos_do_atlas"] = types;
			}
			return json_result(out);
		}
		const Variant old_data = layer->get("tile_map_data");
		int painted = 0;
		auto paint = [&](const Vector2i &p_cell, const Vector2i &p_tile) {
			if (p_tile.x < 0) {
				layer->erase_cell(p_cell);
			} else {
				layer->set_cell(p_cell, source_id, p_tile);
			}
			painted++;
		};
		for (const Variant &item : Array(p_args.get("cells", Array()))) {
			const Array cell = item;
			if (cell.size() != 4 || (int(cell[2]) >= 0 && !atlas->has_tile(Vector2i(cell[2], cell[3])))) {
				layer->set("tile_map_data", old_data);
				return text_result(U("Célula inválida (use [x, y, atlas_x, atlas_y] com um tile que existe no atlas): ") + JSON::stringify(item), true);
			}
			paint(Vector2i(cell[0], cell[1]), Vector2i(cell[2], cell[3]));
		}
		if (p_args.has("fill")) {
			const Dictionary fill = p_args["fill"];
			const Rect2i rect = json_rect(fill.get("rect", Variant()));
			const Array tile = fill.get("tile", Array());
			if (!rect.has_area() || tile.size() != 2 || !atlas->has_tile(Vector2i(tile[0], tile[1])) || rect.get_area() > 65536) {
				layer->set("tile_map_data", old_data);
				return text_result(U("fill: use {\"rect\": [x, y, l, a], \"tile\": [atlas_x, atlas_y]} com um tile do atlas (até 65536 células)."), true);
			}
			for (int y = rect.position.y; y < rect.get_end().y; y++) {
				for (int x = rect.position.x; x < rect.get_end().x; x++) {
					paint(Vector2i(x, y), Vector2i(tile[0], tile[1]));
				}
			}
		}
		if (p_args.has("erase_rect")) {
			const Rect2i rect = json_rect(p_args["erase_rect"]);
			for (int y = rect.position.y; y < rect.get_end().y && rect.get_area() <= 65536; y++) {
				for (int x = rect.position.x; x < rect.get_end().x; x++) {
					paint(Vector2i(x, y), Vector2i(-1, -1));
				}
			}
		}
		EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
		undo_redo->create_action(U("IA: pintar ") + String(layer->get_name()), UndoRedo::MERGE_DISABLE, root);
		undo_redo->add_do_property(layer, "tile_map_data", layer->get("tile_map_data"));
		undo_redo->add_undo_property(layer, "tile_map_data", old_data);
		undo_redo->commit_action(false);
		return text_result(vformat(U("%d células pintadas em %s (com desfazer)."), painted, String(layer->get_name())));
	}
	if (p_name == "emulator_screenshot" || p_name == "emulator_press") {
		RetroSgdkPlugin *build = RetroSgdkPlugin::get_singleton();
		const ProcessID emulator = build ? build->get_emulator_pid() : 0;
		if (!emulator || !OS::get_singleton()->is_process_running(emulator)) {
			return text_result(U("O emulador não está aberto: rode o jogo com build_run e run=true."), true);
		}
		const String xdotool = system_tool("xdotool");
		if (xdotool.is_empty()) {
			return text_result(U("Falta o xdotool (sudo apt install xdotool). Funciona em X11 ou XWayland."), true);
		}
		List<String> search;
		search.push_back("search");
		search.push_back("--pid");
		search.push_back(itos(emulator));
		String windows;
		OS::get_singleton()->execute(xdotool, search, &windows);
		const String window = windows.strip_edges().get_slice("\n", windows.strip_edges().get_slice_count("\n") - 1).strip_edges();
		if (window.is_empty()) {
			return text_result(U("Não achei a janela do emulador."), true);
		}
		if (p_name == "emulator_press") {
			static const char *names[] = { "up", "down", "left", "right", "a", "b", "c", "start", nullptr };
			static const char *keys[] = { "Up", "Down", "Left", "Right", "a", "s", "d", "Return", nullptr };
			PackedStringArray pressed;
			for (const Variant &item : Array(p_args.get("buttons", Array()))) {
				const String button = String(item).to_lower();
				int found = -1;
				for (int i = 0; names[i]; i++) {
					if (button == names[i]) {
						found = i;
					}
				}
				if (found < 0) {
					return text_result(U("Botão desconhecido: ") + button + U(" (use up, down, left, right, a, b, c, start)."), true);
				}
				pressed.push_back(keys[found]);
			}
			if (pressed.is_empty()) {
				return text_result(U("Informe buttons."), true);
			}
			const int ms = CLAMP(int(p_args.get("ms", 200)), 30, 5000);
			// Traz a janela para a frente (falha sem gerenciador de janelas, o que não impede o resto) e
			// dá o foco a ela antes das teclas.
			List<String> activate;
			activate.push_back("windowactivate");
			activate.push_back(window);
			OS::get_singleton()->execute(xdotool, activate);
			List<String> args;
			args.push_back("windowfocus");
			args.push_back("--sync");
			args.push_back(window);
			args.push_back("keydown");
			for (const String &key : pressed) {
				args.push_back(key);
			}
			args.push_back("sleep");
			args.push_back(String::num(ms / 1000.0, 3));
			args.push_back("keyup");
			for (const String &key : pressed) {
				args.push_back(key);
			}
			OS::get_singleton()->execute(xdotool, args);
			return text_result(vformat(U("Apertado %s por %d ms."), String("+").join(pressed), ms));
		}
		const String import = system_tool("import");
		if (import.is_empty()) {
			return text_result(U("Falta o import do ImageMagick (sudo apt install imagemagick)."), true);
		}
		const String file = OS::get_singleton()->get_environment("HOME").path_join(".retrostudio/ia/emulador.png");
		List<String> args;
		args.push_back("-window");
		args.push_back(window);
		args.push_back(file);
		OS::get_singleton()->execute(import, args);
		Ref<Image> image;
		image.instantiate();
		if (image->load(file) != OK || image->is_empty()) {
			return text_result(U("Não foi possível capturar a janela do emulador."), true);
		}
		if (image->get_width() > 960) {
			image->resize(960, image->get_height() * 960 / image->get_width(), Image::INTERPOLATE_NEAREST);
		}
		const Vector<uint8_t> png = image->save_png_to_buffer();
		Dictionary item;
		item["type"] = "image";
		item["mimeType"] = "image/png";
		item["data"] = CryptoCore::b64_encode_str(png.ptr(), png.size());
		Dictionary result;
		result["content"] = arr(item);
		result["isError"] = false;
		return result;
	}
	if (p_name == "build_run" || p_name == "build_errors") {
		RetroSgdkPlugin *build = RetroSgdkPlugin::get_singleton();
		if (!build) {
			return text_result(U("O plugin de build não está carregado."), true);
		}
		if (p_name == "build_errors") {
			return json_result(build->get_report());
		}
		if (build->is_building()) {
			return text_result(U("Já há um build rodando; tente de novo quando ele terminar."), true);
		}
		if (build->start_build_for_ai(bool(p_args.get("run", false)))) {
			r_deferred = true;
			r_conn.waiting_build = true;
			return Dictionary();
		}
		return json_result(build->get_report()); // Parou antes do make (cenas com problemas, sem Makefile).
	}
	if (p_name == "ide_screenshot") {
		const String area = p_args.get("area", "cena");
		Viewport *viewport = area == "editor" ? EditorNode::get_singleton()->get_viewport() : static_cast<Viewport *>(editor->get_editor_viewport_2d());
		Ref<Image> image = viewport && viewport->get_texture().is_valid() ? viewport->get_texture()->get_image() : Ref<Image>();
		if (image.is_null() || image->is_empty()) {
			return text_result(U("Não foi possível capturar a tela (a vista 2D precisa ter sido mostrada)."), true);
		}
		if (image->get_width() > 1280) {
			image->resize(1280, image->get_height() * 1280 / image->get_width(), Image::INTERPOLATE_BILINEAR);
		}
		const Vector<uint8_t> png = image->save_png_to_buffer();
		Dictionary item;
		item["type"] = "image";
		item["mimeType"] = "image/png";
		item["data"] = CryptoCore::b64_encode_str(png.ptr(), png.size());
		Dictionary result;
		result["content"] = arr(item);
		result["isError"] = false;
		return result;
	}
	return text_result(U("Ferramenta desconhecida: ") + p_name, true);
}

void RetroAiPlugin::_copy_field(int p_index) {
	DisplayServer::get_singleton()->clipboard_set(connect_fields[p_index]->get_text());
}

void RetroAiPlugin::_set_owners(Node *p_owner, const Array &p_nodes) {
	for (const Variant &item : p_nodes) {
		if (Node *node = Object::cast_to<Node>(item)) {
			node->set_owner(p_owner);
		}
	}
}

// ---- Conectar agente ----

void RetroAiPlugin::_show_connect() {
	const String url = get_url();
	connect_status->set_text(url.is_empty() ? U("Servidor MCP parado: ") + start_error : vformat(U("Servidor MCP ativo neste editor, porta %d. Cadastre o Retro Studio no agente uma vez (a URL fica a mesma entre aberturas):"), port));
	connect_fields[0]->set_text(url);
	connect_fields[1]->set_text("claude mcp add --transport http retro-studio " + url);
	connect_fields[2]->set_text("codex mcp add retro-studio --url " + url);
	connect_fields[3]->set_text("\"mcp\": { \"retro-studio\": { \"type\": \"remote\", \"url\": \"" + url + "\" } }");
	connect_dialog->reset_size();
	connect_dialog->popup_centered();
}

void RetroAiPlugin::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			_start_server();
			set_process(true);
		} break;
		case NOTIFICATION_EXIT_TREE: {
			if (server.is_valid()) {
				server->stop();
			}
		} break;
		case NOTIFICATION_PROCESS: {
			_poll();
		} break;
	}
}

void RetroAiPlugin::_bind_methods() {
	ClassDB::bind_method(D_METHOD("_set_owners", "owner", "nodes"), &RetroAiPlugin::_set_owners);
}

RetroAiPlugin::RetroAiPlugin() {
	EDITOR_DEF("retro_studio/ia/servidor_mcp", true);
	EDITOR_DEF("retro_studio/ia/porta", 7650);
	EditorSettings::get_singleton()->add_property_hint(PropertyInfo(Variant::INT, "retro_studio/ia/porta", PROPERTY_HINT_RANGE, "1024,65535,1"));

	connect_dialog = memnew(AcceptDialog);
	connect_dialog->set_title(U("Conectar agente de IA"));
	VBoxContainer *box = memnew(VBoxContainer);
	connect_dialog->add_child(box);
	connect_status = memnew(Label);
	connect_status->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	connect_status->set_custom_minimum_size(Size2(720, 0) * EDSCALE);
	box->add_child(connect_status);
	GridContainer *grid = memnew(GridContainer);
	grid->set_columns(3);
	box->add_child(grid);
	const char *labels[] = { "URL", "Claude Code", "Codex", "OpenCode (opencode.json)" };
	for (int i = 0; i < 4; i++) {
		grid->add_child(memnew(Label(U(labels[i]))));
		connect_fields[i] = memnew(LineEdit);
		connect_fields[i]->set_editable(false);
		connect_fields[i]->set_h_size_flags(Control::SIZE_EXPAND_FILL);
		connect_fields[i]->set_custom_minimum_size(Size2(520, 0) * EDSCALE);
		grid->add_child(connect_fields[i]);
		Button *copy = memnew(Button(U("Copiar")));
		copy->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPlugin::_copy_field).bind(i));
		grid->add_child(copy);
	}
	Label *note = memnew(Label(U("O servidor só aceita conexões deste computador, e a URL leva um token guardado em ~/.retrostudio/ia/token. Mudanças da IA nos nodes entram no desfazer do editor (Ctrl+Z). Depois de cadastrar, peça ao agente para ler o guia do Retro Studio (ferramenta guide).")));
	note->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	note->set_custom_minimum_size(Size2(720, 0) * EDSCALE);
	note->set_modulate(Color(1, 1, 1, 0.7));
	box->add_child(note);
	EditorNode::get_singleton()->get_gui_base()->add_child(connect_dialog);
	add_tool_menu_item(U("Conectar agente de IA…"), callable_mp(this, &RetroAiPlugin::_show_connect));
	add_dock(memnew(RetroAiChat(this)));
}

RetroAiPlugin::~RetroAiPlugin() {
	remove_tool_menu_item(U("Conectar agente de IA…"));
}
