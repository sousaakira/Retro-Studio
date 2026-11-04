#include "retro_instrument_browser.h"

#include "retro_instrument_formats.h"
#include "retro_map_ui.h"
#include "retro_song.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/ip.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "core/os/time.h"
#include "editor/editor_node.h"
#include "editor/editor_string_names.h"
#include "editor/file_system/editor_paths.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/link_button.h"
#include "scene/gui/option_button.h"
#include "scene/gui/tree.h"
#include "scene/main/http_request.h"
#include "scene/scene_string_names.h"

static constexpr const char *OWNER = "tildearrow";
static constexpr const char *REPO = "furnace";
static constexpr const char *REF = "master";
static constexpr const char *ROOT = "instruments";
static constexpr const char *SOURCE_URL = "https://github.com/tildearrow/furnace/tree/master/instruments";
static constexpr const char *CREDIT = "Instrumentos da comunidade do Furnace Tracker (pasta instruments do repositório tildearrow/furnace).";
// Pastas com instrumentos do Mega Drive: YM2612 (OPN) e PSG (SN76489).
static const char *FOLDERS[3][2] = { { "OPN", "FM · YM2612" }, { "uhrwerk", "FM · série Uhrwerk" }, { "SN7", "PSG · SN76489" } };
static constexpr int64_t TREE_TTL = 24 * 3600;
static constexpr int FILE_LIMIT = 1024 * 1024;
static constexpr int URL_LIMIT = 2 * 1024 * 1024;
static constexpr int PAGE = 150;

static bool _instrument_file(const String &p_path) {
	const String lower = p_path.to_lower();
	return lower.ends_with(".tfi") || lower.ends_with(".dmp") || lower.ends_with(".fui") || lower.ends_with(".opni") || lower.ends_with(".wopn");
}

static bool _known_folder(const String &p_folder) {
	for (const auto &folder : FOLDERS) {
		if (p_folder == folder[0]) {
			return true;
		}
	}
	return false;
}

// Busca sem acentos e sem maiúsculas.
static String _normalize(const String &p_text) {
	static const char32_t *FROM = U"àáâãäåèéêëìíîïòóôõöùúûüçñýÿ";
	static const char *TO = "aaaaaaeeeeiiiiooooouuuucnyy";
	String text = p_text.to_lower();
	for (int i = 0; i < text.length(); i++) {
		for (int k = 0; FROM[k]; k++) {
			if (text[i] == FROM[k]) {
				text[i] = TO[k];
				break;
			}
		}
	}
	return text;
}

void RetroInstrumentBrowser::_bind_methods() {
	ADD_SIGNAL(MethodInfo("import_instruments", PropertyInfo(Variant::ARRAY, "instruments"), PropertyInfo(Variant::BOOL, "choose"), PropertyInfo(Variant::PACKED_STRING_ARRAY, "warnings")));
	ADD_SIGNAL(MethodInfo("preview_instrument", PropertyInfo(Variant::DICTIONARY, "instrument"), PropertyInfo(Variant::INT, "note")));
	ADD_SIGNAL(MethodInfo("close"));
}

bool RetroInstrumentBrowser::is_private_address(const String &p_address) {
	const String host = p_address.to_lower();
	const PackedStringArray parts = host.split(".");
	if (parts.size() == 4 && host.is_valid_ip_address()) {
		const int a = parts[0].to_int(), b = parts[1].to_int();
		return a == 10 || a == 127 || a == 0 || a >= 224 || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127);
	}
	if (host.begins_with("::ffff:")) {
		const String v4 = host.substr(7);
		return v4.split(".").size() == 4 && v4.is_valid_ip_address() ? is_private_address(v4) : true;
	}
	return host == "::1" || host == "::" || host.begins_with("fc") || host.begins_with("fd") || host.begins_with("fe8") || host.begins_with("fe9") || host.begins_with("fea") || host.begins_with("feb");
}

String RetroInstrumentBrowser::check_public_https(const String &p_url, String *r_host) {
	const String url = p_url.strip_edges();
	if (!url.to_lower().begins_with("https://")) {
		return U("Use um link https.");
	}
	String authority = url.substr(8);
	for (const char *stop : { "/", "?", "#" }) {
		const int at = authority.find(stop);
		if (at >= 0) {
			authority = authority.substr(0, at);
		}
	}
	if (authority.contains("@")) {
		return U("Link com usuário e senha não é aceito.");
	}
	String host = authority;
	if (host.begins_with("[")) {
		host = host.substr(1, host.find("]") - 1);
	} else if (host.contains(":")) {
		host = host.get_slicec(':', 0);
	}
	host = host.to_lower();
	if (host.is_empty()) {
		return U("Link inválido.");
	}
	const bool ip = host.is_valid_ip_address();
	if (host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || (!host.contains(".") && !ip)) {
		return U("Endereço local não é aceito.");
	}
	if (ip && is_private_address(host)) {
		return U("Endereço de rede local não é aceito.");
	}
	if (r_host) {
		*r_host = host;
	}
	return String();
}

RetroInstrumentBrowser::RetroInstrumentBrowser() {
	HBoxContainer *head = memnew(HBoxContainer);
	add_child(head);
	Label *title = memnew(Label);
	title->set_text("Instrumentos da internet");
	title->set_theme_type_variation(SNAME("HeaderSmall"));
	title->set_h_size_flags(SIZE_EXPAND_FILL);
	head->add_child(title);
	Button *done = memnew(Button);
	done->set_text("Concluir");
	done->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentBrowser::_emit_close));
	head->add_child(done);
	credit = memnew(Label);
	credit->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	credit->set_modulate(Color(1, 1, 1, 0.6));
	credit->set_text(U(CREDIT));
	add_child(credit);
	LinkButton *source = memnew(LinkButton);
	source->set_text("Ver no GitHub");
	source->set_uri(SOURCE_URL);
	add_child(source);
	status = memnew(Label);
	status->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	add_child(status);

	folder_select = memnew(OptionButton);
	for (const auto &folder : FOLDERS) {
		folder_select->add_item(U(folder[1]));
	}
	folder_select->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentBrowser::_folder_selected));
	add_child(folder_select);
	query = memnew(LineEdit);
	query->set_placeholder(U("Buscar (ex.: bass, piano, snare)"));
	query->set_clear_button_enabled(true);
	query->connect(SceneStringName(text_changed), callable_mp(this, &RetroInstrumentBrowser::_query_changed));
	add_child(query);
	category_select = memnew(OptionButton);
	category_select->set_clip_text(true);
	category_select->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentBrowser::_category_selected));
	add_child(category_select);
	count_label = memnew(Label);
	count_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	count_label->set_modulate(Color(1, 1, 1, 0.6));
	add_child(count_label);
	results = memnew(Tree);
	results->set_columns(2);
	results->set_hide_root(true);
	results->set_v_size_flags(SIZE_EXPAND_FILL);
	results->set_custom_minimum_size(Size2(0, 200) * EDSCALE);
	results->set_column_expand(1, false);
	results->set_column_custom_minimum_width(1, 110 * EDSCALE);
	results->connect("item_edited", callable_mp(this, &RetroInstrumentBrowser::_item_edited));
	results->connect("button_clicked", callable_mp(this, &RetroInstrumentBrowser::_button_clicked));
	add_child(results);
	more_button = memnew(Button);
	more_button->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentBrowser::_more));
	add_child(more_button);
	HBoxContainer *actions = memnew(HBoxContainer);
	add_child(actions);
	import_button = memnew(Button);
	import_button->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentBrowser::_import_selected));
	actions->add_child(import_button);
	refresh_button = memnew(Button);
	refresh_button->set_text("Atualizar lista");
	refresh_button->set_tooltip_text(U("Buscar a lista de novo no GitHub"));
	refresh_button->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentBrowser::_refresh));
	actions->add_child(refresh_button);

	_section(this, "De um link");
	HBoxContainer *link_row = memnew(HBoxContainer);
	add_child(link_row);
	link = memnew(LineEdit);
	link->set_placeholder(U("https://…/instrumento.fui"));
	link->set_h_size_flags(SIZE_EXPAND_FILL);
	link->connect(SceneStringName(text_submitted), callable_mp(this, &RetroInstrumentBrowser::_import_link).unbind(1));
	link_row->add_child(link);
	link_button = memnew(Button);
	link_button->set_text("Baixar");
	link_button->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentBrowser::_import_link));
	link_row->add_child(link_button);
	_help(this, U("Arquivos .tfi, .dmp, .fui, .opni ou .wopn por https (até 2 MiB). Endereços da rede local não são aceitos."));

	http = memnew(HTTPRequest);
	http->set_use_threads(true);
	http->connect("request_completed", callable_mp(this, &RetroInstrumentBrowser::_completed));
	add_child(http);
	_fill_results();
}

void RetroInstrumentBrowser::_notification(int p_what) {
}

void RetroInstrumentBrowser::_emit_close() {
	emit_signal(SNAME("close"));
}

String RetroInstrumentBrowser::_cache_dir() const {
	return EditorPaths::get_singleton()->get_cache_dir().path_join("retro_instruments");
}

void RetroInstrumentBrowser::open() {
	if (!loaded && !running) {
		_load(false);
	}
}

void RetroInstrumentBrowser::_refresh() {
	_load(true);
}

void RetroInstrumentBrowser::_load(bool p_refresh) {
	const String file = _cache_dir().path_join("furnace-tree.json");
	const Variant cached = FileAccess::exists(file) ? JSON::parse_string(FileAccess::get_file_as_string(file)) : Variant();
	if (!p_refresh && cached.get_type() == Variant::DICTIONARY) {
		const Dictionary data = cached;
		const int64_t fetched = int64_t(double(data.get("fetchedAt", 0)) / 1000);
		if (Variant(data.get("tree", Variant())).get_type() == Variant::ARRAY && Time::get_singleton()->get_unix_time_from_system() - fetched <= TREE_TTL) {
			stale = false;
			_use_tree(data["tree"]);
			return;
		}
	}
	Job job;
	job.kind = JOB_TREE;
	job.url = vformat("https://api.github.com/repos/%s/%s/git/trees/%s:%s?recursive=1", OWNER, REPO, REF, ROOT);
	job.limit = 8 * 1024 * 1024;
	status->set_text(U("Carregando a biblioteca…"));
	_enqueue(job);
}

static bool _entry_less(const Variant &p_a, const Variant &p_b) {
	const Dictionary a = p_a, b = p_b;
	for (const char *key : { "folder", "category", "name" }) {
		const int compare = String(a[key]).nocasecmp_to(String(b[key]));
		if (compare != 0) {
			return compare < 0;
		}
	}
	return false;
}

void RetroInstrumentBrowser::_use_tree(const Array &p_tree) {
	entries.clear();
	for (const Variant &value : p_tree) {
		const Dictionary item = value;
		const String path = item.get("path", "");
		// "(OPM)" no nome: patch do YM2151 (arcade), outro chip.
		if (!_instrument_file(path) || int64_t(item.get("size", 0)) > FILE_LIMIT || !_known_folder(path.get_slicec('/', 0)) || path.to_lower().contains("(opm)")) {
			continue;
		}
		const PackedStringArray parts = path.split("/");
		const String file = parts[parts.size() - 1];
		Dictionary entry;
		entry["path"] = path;
		entry["sha"] = item.get("sha", "");
		entry["size"] = item.get("size", 0);
		entry["folder"] = parts[0];
		entry["category"] = parts.size() > 2 ? String("/").join(parts.slice(1, parts.size() - 1)) : String();
		entry["name"] = file.get_basename();
		entry["format"] = file.get_extension().to_lower();
		entries.push_back(entry);
	}
	entries.sort_custom(callable_mp_static(&_entry_less));
	loaded = true;
	status->set_text(stale ? U("Sem conexão: mostrando a lista guardada.") : String());
	_fill_categories();
	_fill_results();
}

Dictionary RetroInstrumentBrowser::_entry(const String &p_path) const {
	for (const Variant &value : entries) {
		if (String(Dictionary(value)["path"]) == p_path) {
			return value;
		}
	}
	return Dictionary();
}

void RetroInstrumentBrowser::_fill_categories() {
	const String folder = FOLDERS[CLAMP(folder_select->get_selected(), 0, 2)][0];
	PackedStringArray categories;
	for (const Variant &value : entries) {
		const Dictionary entry = value;
		const String category = entry["category"];
		if (String(entry["folder"]) == folder && !category.is_empty() && !categories.has(category)) {
			categories.push_back(category);
		}
	}
	categories.sort();
	category_select->clear();
	category_select->add_item("Todas as categorias");
	category_select->set_item_metadata(0, String());
	for (const String &category : categories) {
		category_select->add_item(category);
		category_select->set_item_metadata(category_select->get_item_count() - 1, category);
	}
}

Array RetroInstrumentBrowser::_filtered() const {
	Array result;
	const String folder = FOLDERS[CLAMP(folder_select->get_selected(), 0, 2)][0];
	const String category = category_select->get_selected() > 0 ? String(category_select->get_item_metadata(category_select->get_selected())) : String();
	const PackedStringArray words = _normalize(query->get_text()).split(" ", false);
	for (const Variant &value : entries) {
		const Dictionary entry = value;
		const String own = entry["category"];
		if (String(entry["folder"]) != folder || (!category.is_empty() && own != category && !own.begins_with(category + "/"))) {
			continue;
		}
		const String haystack = _normalize(String(entry["name"]) + " " + own);
		bool match = true;
		for (const String &word : words) {
			match = match && haystack.contains(word);
		}
		if (match) {
			result.push_back(entry);
		}
	}
	return result;
}

void RetroInstrumentBrowser::_fill_results() {
	results->clear();
	TreeItem *root = results->create_item();
	const Array filtered = _filtered();
	const Ref<Texture2D> play = EditorNode::get_singleton() ? EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("Play"), EditorStringName(EditorIcons)) : Ref<Texture2D>();
	for (int i = 0; i < MIN(limit, filtered.size()); i++) {
		const Dictionary entry = filtered[i];
		const String path = entry["path"];
		TreeItem *item = results->create_item(root);
		item->set_cell_mode(0, TreeItem::CELL_MODE_CHECK);
		item->set_editable(0, true);
		item->set_checked(0, selected.has(path));
		item->set_text(0, entry["name"]);
		item->set_metadata(0, path);
		item->set_text(1, (String(entry["category"]).is_empty() ? U("—") : String(entry["category"])) + U(" · ") + String(entry["format"]).to_upper());
		item->set_tooltip_text(1, item->get_text(1));
		if (play.is_valid()) {
			item->add_button(1, play, 0, false, U("Ouvir ") + String(entry["name"]));
		}
		if (parsed.has(path) && parsed[path].has("error")) {
			item->set_custom_color(0, Color(1, 0.55, 0.5));
			item->set_tooltip_text(0, parsed[path]["error"]);
		}
	}
	count_label->set_text(loaded ? itos(filtered.size()) + U(" instrumento(s). ▶ ouve antes de importar; marque os que quiser.") : String());
	more_button->set_visible(filtered.size() > limit);
	more_button->set_text(U("Mostrar mais (") + itos(filtered.size() - limit) + ")");
	import_button->set_text(U("Importar ") + (selected.is_empty() ? String() : itos(selected.size()) + " ") + U("selecionado(s)"));
	import_button->set_disabled(selected.is_empty() || running);
	refresh_button->set_disabled(running);
}

void RetroInstrumentBrowser::_folder_selected(int p_index) {
	limit = PAGE;
	_fill_categories();
	_fill_results();
}

void RetroInstrumentBrowser::_category_selected(int p_index) {
	limit = PAGE;
	_fill_results();
}

void RetroInstrumentBrowser::_query_changed(const String &p_text) {
	limit = PAGE;
	_fill_results();
}

void RetroInstrumentBrowser::_more() {
	limit += PAGE;
	_fill_results();
}

void RetroInstrumentBrowser::_item_edited() {
	TreeItem *item = results->get_edited();
	if (!item) {
		return;
	}
	const String path = item->get_metadata(0);
	if (item->is_checked(0)) {
		selected.insert(path);
	} else {
		selected.erase(path);
	}
	import_button->set_text(U("Importar ") + (selected.is_empty() ? String() : itos(selected.size()) + " ") + U("selecionado(s)"));
	import_button->set_disabled(selected.is_empty() || running);
}

void RetroInstrumentBrowser::_button_clicked(TreeItem *p_item, int p_column, int p_id, MouseButton p_button) {
	if (p_button != MouseButton::LEFT || !p_item) {
		return;
	}
	_fetch(p_item->get_metadata(0), PURPOSE_PREVIEW);
}

// ---- downloads ----

void RetroInstrumentBrowser::_enqueue(const Job &p_job) {
	jobs.push_back(p_job);
	if (!running) {
		_next();
	}
}

void RetroInstrumentBrowser::_next() {
	if (jobs.is_empty()) {
		running = false;
		_fill_results();
		return;
	}
	running = true;
	current = jobs.front()->get();
	jobs.pop_front();
	_request(current.url);
}

void RetroInstrumentBrowser::_request(const String &p_url) {
	String host;
	const String problem = check_public_https(p_url, &host);
	if (!problem.is_empty()) {
		_fail(problem);
		return;
	}
	// Um nome que resolve para a rede local também é recusado.
	if (!host.is_valid_ip_address()) {
		const PackedStringArray addresses = IP::get_singleton()->resolve_hostname_addresses(host);
		if (addresses.is_empty()) {
			_fail(U("Não foi possível encontrar ") + host + ".");
			return;
		}
		for (const String &address : addresses) {
			if (is_private_address(address)) {
				_fail(U("O endereço aponta para a rede local; não é aceito."));
				return;
			}
		}
	}
	http->cancel_request();
	http->set_max_redirects(0);
	http->set_body_size_limit(current.limit);
	http->set_timeout(20);
	Vector<String> headers;
	headers.push_back("User-Agent: RetroStudio");
	headers.push_back("Accept: */*");
	current.url = p_url;
	if (http->request(p_url, headers) != OK) {
		_fail(U("Não foi possível começar o download."));
	}
}

static String _header(const PackedStringArray &p_headers, const String &p_name) {
	for (const String &header : p_headers) {
		if (header.to_lower().begins_with(p_name.to_lower() + ":")) {
			return header.substr(p_name.length() + 1).strip_edges();
		}
	}
	return String();
}

void RetroInstrumentBrowser::_completed(int p_result, int p_code, const PackedStringArray &p_headers, const PackedByteArray &p_body) {
	const String location = _header(p_headers, "Location");
	if ((p_result == HTTPRequest::RESULT_REDIRECT_LIMIT_REACHED || (p_code >= 300 && p_code < 400)) && !location.is_empty()) {
		if (current.redirects <= 0) {
			_fail(U("Redirecionamentos demais."));
			return;
		}
		current.redirects--;
		String target = location;
		if (!target.begins_with("http://") && !target.begins_with("https://")) {
			const int start = current.url.find("/", 8);
			const String origin = start < 0 ? current.url : current.url.substr(0, start);
			target = target.begins_with("/") ? origin + target : current.url.get_base_dir() + "/" + target;
		}
		_request(target);
		return;
	}
	if (p_result == HTTPRequest::RESULT_BODY_SIZE_LIMIT_EXCEEDED) {
		_fail(U("Arquivo grande demais."));
		return;
	}
	if (p_result == HTTPRequest::RESULT_TIMEOUT) {
		_fail(U("O download demorou demais."));
		return;
	}
	if (p_result != HTTPRequest::RESULT_SUCCESS) {
		_fail(U("Não foi possível baixar (sem conexão?)."));
		return;
	}
	if (p_code == 403 && _header(p_headers, "x-ratelimit-remaining") == "0") {
		_fail(U("O GitHub limitou as consultas por agora (60 por hora sem login). Tente de novo mais tarde."));
		return;
	}
	if (p_code < 200 || p_code >= 300) {
		_fail(U("O servidor respondeu ") + itos(p_code) + ".");
		return;
	}
	const Job job = current;
	if (job.kind == JOB_TREE) {
		String text;
		text.append_utf8((const char *)p_body.ptr(), p_body.size());
		const Variant data = JSON::parse_string(text);
		if (data.get_type() != Variant::DICTIONARY || Variant(Dictionary(data).get("tree", Variant())).get_type() != Variant::ARRAY) {
			_fail(U("Resposta inesperada do GitHub."));
			return;
		}
		Array tree;
		for (const Variant &value : Array(Dictionary(data)["tree"])) {
			const Dictionary item = value;
			if (String(item.get("type", "")) == "blob" && item.get("path", Variant()).get_type() == Variant::STRING && item.get("sha", Variant()).get_type() == Variant::STRING) {
				Dictionary entry;
				entry["path"] = item["path"];
				entry["sha"] = item["sha"];
				entry["size"] = item.get("size", 0);
				tree.push_back(entry);
			}
		}
		Dictionary cache;
		cache["fetchedAt"] = int64_t(Time::get_singleton()->get_unix_time_from_system() * 1000);
		cache["tree"] = tree;
		DirAccess::make_dir_recursive_absolute(_cache_dir());
		Ref<FileAccess> file = FileAccess::open(_cache_dir().path_join("furnace-tree.json"), FileAccess::WRITE);
		if (file.is_valid()) {
			file->store_string(JSON::stringify(cache, "", false));
		}
		stale = false;
		_use_tree(tree);
	} else if (job.kind == JOB_FILE) {
		const Dictionary entry = _entry(job.path);
		const String target = _cache_dir().path_join("furnace").path_join(entry.get("sha", ""));
		DirAccess::make_dir_recursive_absolute(target.get_base_dir());
		Ref<FileAccess> file = FileAccess::open(target, FileAccess::WRITE);
		if (file.is_valid()) {
			file->store_buffer(p_body.ptr(), p_body.size());
		}
		file.unref();
		_file_ready(job.path, p_body, job.purpose);
	} else {
		// Link: o nome vem do fim do endereço final (depois dos redirecionamentos).
		String name = job.url.get_slicec('?', 0).get_slicec('#', 0).get_file().uri_decode();
		if (name.is_empty()) {
			name = "instrumento";
		}
		PackedStringArray warnings;
		String error;
		Array list = RetroInstrumentFormats::import_file(name, p_body, warnings, error);
		if (!error.is_empty()) {
			status->set_text(U("Não foi possível importar o link: ") + error);
		} else {
			for (int i = 0; i < list.size(); i++) {
				Dictionary item = list[i];
				item["source"] = job.url.substr(0, 200);
				list[i] = item;
			}
			emit_signal(SNAME("import_instruments"), list, list.size() > 1, warnings);
			status->set_text(list.size() > 1 ? U("O arquivo tem ") + itos(list.size()) + U(" instrumentos: escolha quais entram.") : U("Instrumento importado para a música."));
			link->clear();
		}
	}
	_next();
}

void RetroInstrumentBrowser::_fail(const String &p_message) {
	const Job job = current;
	if (job.kind == JOB_TREE) {
		// Sem internet (ou limite do GitHub): usa a listagem antiga, se houver.
		const String file = _cache_dir().path_join("furnace-tree.json");
		const Variant cached = FileAccess::exists(file) ? JSON::parse_string(FileAccess::get_file_as_string(file)) : Variant();
		if (cached.get_type() == Variant::DICTIONARY && Variant(Dictionary(cached).get("tree", Variant())).get_type() == Variant::ARRAY) {
			stale = true;
			_use_tree(Dictionary(cached)["tree"]);
		} else {
			status->set_text(p_message);
		}
	} else if (job.kind == JOB_FILE) {
		Dictionary result;
		result["error"] = p_message;
		parsed[job.path] = result;
		_parsed_done(job.path, job.purpose);
	} else {
		status->set_text(U("Não foi possível importar o link: ") + p_message);
	}
	_next();
}

void RetroInstrumentBrowser::_fetch(const String &p_path, int p_purpose_value) {
	const Purpose p_purpose = Purpose(p_purpose_value);
	if (parsed.has(p_path)) {
		_parsed_done(p_path, p_purpose);
		return;
	}
	const Dictionary entry = _entry(p_path);
	const String sha = entry.get("sha", "");
	bool valid_sha = sha.length() == 40;
	for (int i = 0; valid_sha && i < 40; i++) {
		valid_sha = is_hex_digit(sha[i]) && !(sha[i] >= 'A' && sha[i] <= 'F');
	}
	if (entry.is_empty() || !valid_sha) {
		Dictionary result;
		result["error"] = U("Instrumento fora da biblioteca.");
		parsed[p_path] = result;
		_parsed_done(p_path, p_purpose);
		return;
	}
	const String cached = _cache_dir().path_join("furnace").path_join(sha);
	if (FileAccess::exists(cached)) {
		_file_ready(p_path, FileAccess::get_file_as_bytes(cached), p_purpose);
		return;
	}
	PackedStringArray parts;
	parts.push_back(ROOT);
	for (const String &part : p_path.split("/")) {
		parts.push_back(part.uri_encode());
	}
	Job job;
	job.kind = JOB_FILE;
	job.path = p_path;
	job.url = vformat("https://raw.githubusercontent.com/%s/%s/%s/", OWNER, REPO, REF) + String("/").join(parts);
	job.redirects = 0;
	job.limit = FILE_LIMIT;
	job.purpose = p_purpose;
	status->set_text(U("Baixando ") + String(entry["name"]) + U("…"));
	_enqueue(job);
}

void RetroInstrumentBrowser::_file_ready(const String &p_path, const Vector<uint8_t> &p_bytes, Purpose p_purpose) {
	PackedStringArray warnings;
	String error;
	Array list = RetroInstrumentFormats::import_file(p_path.get_file(), p_bytes, warnings, error);
	Dictionary result;
	if (!error.is_empty()) {
		result["error"] = error;
	} else {
		for (int i = 0; i < list.size(); i++) {
			Dictionary item = list[i];
			item["source"] = "Furnace: " + p_path;
			list[i] = item;
		}
		result["instruments"] = list;
		result["warnings"] = warnings;
	}
	parsed[p_path] = result;
	_parsed_done(p_path, p_purpose);
}

void RetroInstrumentBrowser::_parsed_done(const String &p_path, Purpose p_purpose) {
	status->set_text(String());
	const Dictionary result = parsed[p_path];
	if (p_purpose == PURPOSE_PREVIEW) {
		if (result.has("error")) {
			status->set_text(Dictionary(_entry(p_path)).get("name", p_path).operator String() + ": " + String(result["error"]));
		} else if (!Array(result["instruments"]).is_empty()) {
			// Altura da prévia pela categoria (baixo grave, bateria no meio).
			const Dictionary entry = _entry(p_path);
			const String text = String(entry.get("category", "")) + String(entry.get("name", ""));
			const String lower = text.to_lower();
			const int note = (lower.contains("bass") || lower.contains("baixo")) ? 45 : ((lower.contains("drum") || lower.contains("perc") || lower.contains("kick") || lower.contains("snare") || lower.contains("hat")) ? 50 : 60);
			emit_signal(SNAME("preview_instrument"), Array(result["instruments"])[0], note);
		}
		_fill_results();
	} else if (p_purpose == PURPOSE_BATCH) {
		const Dictionary entry = _entry(p_path);
		if (result.has("error")) {
			batch_failed.push_back(String(entry.get("name", p_path)) + ": " + String(result["error"]));
		} else {
			batch_found.append_array(result["instruments"]);
		}
		batch_index++;
		_batch_step();
	}
}

void RetroInstrumentBrowser::_import_selected() {
	batch.clear();
	for (const Variant &value : entries) {
		const String path = Dictionary(value)["path"];
		if (selected.has(path)) {
			batch.push_back(path);
		}
	}
	batch_index = 0;
	batch_found.clear();
	batch_failed.clear();
	_batch_step();
}

void RetroInstrumentBrowser::_batch_step() {
	if (batch_index < batch.size()) {
		status->set_text(U("Baixando ") + itos(batch_index + 1) + U(" de ") + itos(batch.size()) + U("…"));
		// call_deferred: um arquivo em cache termina na hora, sem empilhar chamadas.
		callable_mp(this, &RetroInstrumentBrowser::_fetch).call_deferred(batch[batch_index], int(PURPOSE_BATCH));
		return;
	}
	if (!batch_found.is_empty()) {
		emit_signal(SNAME("import_instruments"), batch_found, false, PackedStringArray());
	}
	String notice = batch_found.is_empty() ? String() : itos(batch_found.size()) + U(" instrumento(s) importado(s) para a música.");
	if (!batch_failed.is_empty()) {
		notice += U(" Não importados: ") + String("; ").join(batch_failed);
	}
	status->set_text(notice.strip_edges());
	selected.clear();
	batch.clear();
	_fill_results();
}

void RetroInstrumentBrowser::_import_link() {
	const String url = link->get_text().strip_edges();
	if (url.is_empty()) {
		return;
	}
	if (url.length() > 2048) {
		status->set_text(U("Link inválido."));
		return;
	}
	Job job;
	job.kind = JOB_LINK;
	job.url = url;
	job.redirects = 3;
	job.limit = URL_LIMIT;
	status->set_text(U("Baixando o link…"));
	_enqueue(job);
}
