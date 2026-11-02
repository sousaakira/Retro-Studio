#include "retro_ai_panel.h"

#include "retro_env.h"
#include "retro_ai_server.h"

#include "core/config/project_settings.h"
#include "core/crypto/crypto_core.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "core/os/time.h"
#include "core/version.h"
#include "editor/docks/editor_dock.h"
#include "editor/docks/editor_dock_manager.h"
#include "editor/editor_string_names.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_file_dialog.h"
#include "editor/gui/editor_toaster.h"
#include "editor/script/script_editor_base.h"
#include "editor/script/script_editor_plugin.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/center_container.h"
#include "scene/gui/code_edit.h"
#include "scene/gui/color_rect.h"
#include "scene/gui/dialogs.h"
#include "scene/gui/flow_container.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/option_button.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/popup.h"
#include "scene/gui/progress_bar.h"
#include "scene/gui/rich_text_label.h"
#include "scene/gui/scroll_bar.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/text_edit.h"
#include "scene/gui/texture_button.h"
#include "scene/gui/texture_rect.h"
#include "scene/main/scene_tree.h"
#include "scene/resources/image_texture.h"
#include "scene/resources/style_box_flat.h"
#include "scene/resources/text_file.h"
#include "servers/display/display_server.h"
#include "scene/scene_string_names.h"

static String U(const char *p_text) {
	return String::utf8(p_text);
}

// Limites de shared/ai/imageAttachments.js.
static constexpr int MAX_IMAGE_COUNT = 4;
static constexpr int MAX_IMAGE_BYTES = 8 * 1024 * 1024;
static constexpr int MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
static constexpr int64_t MAX_IMAGE_PIXELS = 40000000;
static constexpr int MAX_UNSAVED_FILE_CHARS = 32000;
static constexpr uint64_t PERMISSION_TIMEOUT_MS = 300000;
static constexpr int STICK_TO_BOTTOM_PX = 80;

static const char *PROVIDERS[3] = { "opencode", "codex", "claude" };

static Ref<StyleBoxFlat> _round(const Color &p_color, int p_radius, int p_margin = 0) {
	Ref<StyleBoxFlat> style;
	style.instantiate();
	style->set_bg_color(p_color);
	style->set_corner_radius_all(p_radius * EDSCALE);
	style->set_content_margin_all(p_margin * EDSCALE);
	return style;
}

static Color _status_color(int p_status) {
	switch (p_status) {
		case 1:
			return Color("#e5c07b"); // Conectando.
		case 2:
			return Color("#3fb950"); // Pronto.
		case 3:
			return Color("#58a6ff"); // Trabalhando.
		case 4:
			return Color("#f85149"); // Erro.
		default:
			return Color("#8a8f98");
	}
}

// ---- textos ----

String RetroAiPanel::_provider_label(const String &p_provider) {
	if (p_provider == "codex") {
		return "Codex";
	}
	if (p_provider == "claude") {
		return "Claude";
	}
	return "OpenCode";
}

String RetroAiPanel::_setting_key(const String &p_provider) const {
	return "retro_studio/ai/" + p_provider + "_path";
}

String RetroAiPanel::_install_command() const {
	return String("npm install -g @agentclientprotocol/") + (provider == "claude" ? "claude-agent-acp" : "codex-acp");
}

String RetroAiPanel::_login_command() const {
	if (auth_status.has("loginCommand")) {
		return auth_status["loginCommand"];
	}
	return provider == "codex" ? "codex login" : (provider == "claude" ? "claude auth login" : "opencode auth login");
}

String RetroAiPanel::_status_label() const {
	switch (status) {
		case STATUS_STARTING:
			return replaying ? U("Carregando sessão…") : U("Conectando…");
		case STATUS_READY:
			return U("Pronto");
		case STATUS_BUSY:
			return U("Trabalhando…");
		case STATUS_ERROR:
			return U("Erro");
		default:
			return U("Parado");
	}
}

bool RetroAiPanel::_is_terminal_status(const String &p_status) {
	const String status = p_status.to_lower();
	return status == "completed" || status == "failed" || status == "cancelled" || status == "canceled";
}

String RetroAiPanel::_tool_status_label(const String &p_status) const {
	const String status = p_status.to_lower();
	if (status == "completed") {
		return "ok";
	}
	if (status == "failed") {
		return U("falhou");
	}
	if (status == "in_progress" || status == "pending") {
		return U("…");
	}
	return p_status;
}

bool RetroAiPanel::_looks_like_auth_error(const String &p_message) {
	const String text = p_message.to_lower();
	static const char *WORDS[] = { "auth", "unauthor", "api key", "api_key", "apikey", "credential", "login", "not logged", "401", "403", nullptr };
	for (int i = 0; WORDS[i]; i++) {
		if (text.contains(WORDS[i])) {
			return true;
		}
	}
	return text.contains("provider") && text.contains("missing");
}

String RetroAiPanel::_escape(const String &p_text) {
	return p_text.replace("[", "[lb]");
}

// Markdown do agente em BBCode: títulos, listas, citações, blocos de código, `código`, **negrito**,
// *itálico* e [links](url) (como o marked do painel antigo, sem HTML).
String RetroAiPanel::_markdown(const String &p_text) {
	String out;
	const Vector<String> lines = p_text.split("\n");
	bool in_code = false;
	String code;
	auto inline_md = [](const String &p_line) {
		String result;
		bool code_span = false, bold = false, italic = false;
		for (int i = 0; i < p_line.length(); i++) {
			const char32_t c = p_line[i];
			if (c == '`') {
				result += code_span ? "[/code]" : "[code]";
				code_span = !code_span;
			} else if (code_span) {
				result += c == '[' ? String("[lb]") : String::chr(c);
			} else if (c == '*' && i + 1 < p_line.length() && p_line[i + 1] == '*') {
				result += bold ? "[/b]" : "[b]";
				bold = !bold;
				i++;
			} else if ((c == '*' || c == '_') && i + 1 < p_line.length() && p_line[i + 1] != ' ' && (italic || (i == 0 || p_line[i - 1] == ' ' || p_line[i - 1] == '('))) {
				result += italic ? "[/i]" : "[i]";
				italic = !italic;
			} else if (c == '[') {
				const int close = p_line.find("](", i);
				const int end = close >= 0 ? p_line.find_char(')', close) : -1;
				if (close > i && end > close) {
					const String label = p_line.substr(i + 1, close - i - 1);
					const String url = p_line.substr(close + 2, end - close - 2);
					result += "[url=" + url.replace("]", "") + "]" + label.replace("[", "[lb]") + "[/url]";
					i = end;
				} else {
					result += "[lb]";
				}
			} else {
				result += c;
			}
		}
		if (code_span) {
			result += "[/code]";
		}
		if (bold) {
			result += "[/b]";
		}
		if (italic) {
			result += "[/i]";
		}
		return result;
	};
	for (int n = 0; n < lines.size(); n++) {
		const String line = lines[n];
		const String trimmed = line.strip_edges();
		if (trimmed.begins_with("```")) {
			if (in_code) {
				out += "[bgcolor=#00000040][code]" + _escape(code.trim_suffix("\n")) + "[/code][/bgcolor]\n";
				code = String();
			}
			in_code = !in_code;
			continue;
		}
		if (in_code) {
			code += line + "\n";
			continue;
		}
		if (trimmed.begins_with("#")) {
			int level = 0;
			while (level < trimmed.length() && trimmed[level] == '#') {
				level++;
			}
			out += "[b]" + inline_md(trimmed.substr(level).strip_edges()) + "[/b]\n";
		} else if (trimmed.begins_with("- ") || trimmed.begins_with("* ") || trimmed.begins_with("+ ")) {
			const int indent = line.length() - line.lstrip(" ").length();
			out += String("  ").repeat(indent / 2) + U("• ") + inline_md(trimmed.substr(2)) + "\n";
		} else if (trimmed.begins_with(">")) {
			out += "[color=#8a8f98]" + inline_md(trimmed.substr(1).strip_edges()) + "[/color]\n";
		} else if (trimmed == "---" || trimmed == "***") {
			out += U("────────") + "\n";
		} else {
			out += inline_md(line) + "\n";
		}
	}
	if (in_code) {
		out += "[bgcolor=#00000040][code]" + _escape(code.trim_suffix("\n")) + "[/code][/bgcolor]\n";
	}
	return out.trim_suffix("\n");
}

String RetroAiPanel::_project_dir() const {
	return ProjectSettings::get_singleton()->get_resource_path();
}

// ---- lista de mensagens ----

RetroAiPanel::Entry *RetroAiPanel::_push_entry(const String &p_kind, const String &p_text) {
	Entry *entry = memnew(Entry);
	entry->kind = p_kind;
	entry->text = p_text;
	entries.push_back(entry);
	_build_entry(entry);
	_queue_render();
	return entry;
}

void RetroAiPanel::_push_system(const String &p_text, const Array &p_errors) {
	Entry *entry = _push_entry("system", p_text);
	entry->errors = p_errors;
	_build_entry(entry);
}

void RetroAiPanel::_append_chunk(const String &p_kind, const String &p_text) {
	Entry *last = entries.is_empty() ? nullptr : entries[entries.size() - 1];
	if (last && last->kind == p_kind) {
		last->text += p_text;
		_touch(last);
	} else {
		_push_entry(p_kind, p_text);
	}
}

void RetroAiPanel::_touch(Entry *p_entry) {
	p_entry->dirty = true;
	_queue_render();
}

void RetroAiPanel::_clear_entries() {
	for (Entry *entry : entries) {
		if (entry->root) {
			entry->root->queue_free();
		}
		memdelete(entry);
	}
	entries.clear();
	tool_index.clear();
	stick_to_bottom = true;
	_update_visibility();
}

static Label *_small_label(const String &p_text, const Color &p_color = Color(1, 1, 1, 0.6)) {
	Label *label = memnew(Label);
	label->set_text(p_text);
	label->add_theme_color_override(SceneStringName(font_color), p_color);
	return label;
}

static RichTextLabel *_rich_body() {
	RichTextLabel *body = memnew(RichTextLabel);
	body->set_use_bbcode(true);
	body->set_fit_content(true);
	body->set_selection_enabled(true);
	body->set_context_menu_enabled(true);
	body->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	body->set_scroll_active(false);
	return body;
}

// Monta os controles de uma entrada (avatar e nome, texto, imagens, erros, ferramenta, diff, revisão).
void RetroAiPanel::_build_entry(Entry *p_entry) {
	if (p_entry->root) {
		p_entry->root->queue_free();
		p_entry->root = nullptr;
	}
	VBoxContainer *root = memnew(VBoxContainer);
	root->add_theme_constant_override("separation", 2 * EDSCALE);
	p_entry->root = root;
	if (p_entry->kind == "tool") {
		HBoxContainer *row = memnew(HBoxContainer);
		root->add_child(row);
		CenterContainer *dot_box = memnew(CenterContainer);
		row->add_child(dot_box);
		p_entry->dot = memnew(ColorRect);
		p_entry->dot->set_custom_minimum_size(Size2(7, 7) * EDSCALE);
		dot_box->add_child(p_entry->dot);
		p_entry->title_label = memnew(Label);
		p_entry->title_label->set_h_size_flags(SIZE_EXPAND_FILL);
		p_entry->title_label->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
		p_entry->title_label->add_theme_color_override(SceneStringName(font_color), Color(1, 1, 1, 0.75));
		row->add_child(p_entry->title_label);
		p_entry->status_label = _small_label(String());
		row->add_child(p_entry->status_label);
	} else if (p_entry->kind == "thought") {
		root->add_child(_small_label(U("Raciocínio"), Color(0.75, 0.7, 1.0, 0.8)));
		p_entry->body = _rich_body();
		p_entry->body->add_theme_color_override("default_color", Color(1, 1, 1, 0.55));
		root->add_child(p_entry->body);
	} else if (p_entry->kind == "diff" || p_entry->kind == "review") {
		HBoxContainer *meta = memnew(HBoxContainer);
		root->add_child(meta);
		PanelContainer *avatar = memnew(PanelContainer);
		avatar->add_theme_style_override(SceneStringName(panel), _round(Color("#d29922"), 9, 2));
		Label *mark = memnew(Label);
		mark->set_text(U("Δ"));
		mark->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
		mark->set_custom_minimum_size(Size2(16, 0) * EDSCALE);
		avatar->add_child(mark);
		meta->add_child(avatar);
		meta->add_child(_small_label(p_entry->kind == "diff" ? String("Diff") : U("Alteração do agente"), Color(1, 1, 1, 0.85)));
		const Vector<String> parts = p_entry->path.replace("\\", "/").split("/");
		root->add_child(_small_label(parts.size() >= 2 ? parts[parts.size() - 2] + "/" + parts[parts.size() - 1] : p_entry->path));
		RichTextLabel *preview = _rich_body();
		preview->set_text("[bgcolor=#00000040][code]" + _escape(p_entry->preview) + "[/code][/bgcolor]");
		root->add_child(preview);
		HBoxContainer *actions = memnew(HBoxContainer);
		root->add_child(actions);
		if (p_entry->kind == "review") {
			p_entry->review_actions = actions;
			const int index = entries.find(p_entry);
			Button *accept = memnew(Button);
			accept->set_text(U("Aceitar"));
			accept->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_review_answer).bind(true, index));
			actions->add_child(accept);
			Button *reject = memnew(Button);
			reject->set_text(U("Rejeitar"));
			reject->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_review_answer).bind(false, index));
			actions->add_child(reject);
		}
		Button *open = memnew(Button);
		open->set_text(U("Abrir arquivo"));
		open->set_flat(true);
		open->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_open_path).bind(p_entry->path));
		actions->add_child(open);
		p_entry->status_label = _small_label(String());
		actions->add_child(p_entry->status_label);
	} else {
		HBoxContainer *meta = memnew(HBoxContainer);
		root->add_child(meta);
		PanelContainer *avatar = memnew(PanelContainer);
		const Color avatar_color = p_entry->kind == "user" ? Color("#1f6feb") : (p_entry->kind == "agent" ? Color("#238636") : Color("#484f58"));
		avatar->add_theme_style_override(SceneStringName(panel), _round(avatar_color, 9, 2));
		Label *mark = memnew(Label);
		mark->set_text(p_entry->kind == "user" ? String("U") : (p_entry->kind == "agent" ? String("AI") : U("·")));
		mark->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
		mark->set_custom_minimum_size(Size2(16, 0) * EDSCALE);
		avatar->add_child(mark);
		meta->add_child(avatar);
		p_entry->title_label = _small_label(String(), Color(1, 1, 1, 0.85));
		meta->add_child(p_entry->title_label);
		p_entry->body = _rich_body();
		root->add_child(p_entry->body);
		if (!p_entry->images.is_empty()) {
			HFlowContainer *images = memnew(HFlowContainer);
			root->add_child(images);
			for (const Ref<Image> &image : p_entry->images) {
				Ref<Image> thumb = image->duplicate();
				const float scale = MIN(1.0f, 96.0f / MAX(thumb->get_width(), thumb->get_height()));
				thumb->resize(MAX(1, int(thumb->get_width() * scale)), MAX(1, int(thumb->get_height() * scale)));
				TextureButton *button = memnew(TextureButton);
				button->set_texture_normal(ImageTexture::create_from_image(thumb));
				button->set_tooltip_text(U("Ampliar imagem"));
				button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_preview_image).bind(image));
				images->add_child(button);
			}
		}
		if (!p_entry->errors.is_empty()) {
			VBoxContainer *list = memnew(VBoxContainer);
			root->add_child(list);
			for (int i = 0; i < MIN(30, p_entry->errors.size()); i++) {
				const Dictionary error = p_entry->errors[i];
				Button *link = memnew(Button);
				link->set_flat(true);
				link->set_text_alignment(HORIZONTAL_ALIGNMENT_LEFT);
				link->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
				String location;
				for (const char *key : { "file", "line", "column" }) {
					if (error.has(key) && String(error[key]) != "") {
						location += (location.is_empty() ? "" : ":") + String(error[key]);
					}
				}
				link->set_text((location.is_empty() ? String("?") : location) + " " + String(error.get("message", error.get("type", ""))));
				link->add_theme_color_override(SceneStringName(font_color), Color("#ff7b72"));
				link->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_open_error).bind(error));
				list->add_child(link);
			}
		}
	}
	if (p_entry->body) {
		p_entry->body->connect("meta_clicked", callable_mp(this, &RetroAiPanel::_open_path)); // Links do agente.
	}
	messages->add_child(root);
	messages->move_child(processing, -1);
	messages->move_child(activity, -1);
	p_entry->dirty = true;
}

// Atualiza o texto, o estado e as cores de uma entrada já montada.
void RetroAiPanel::_update_entry(Entry *p_entry) {
	p_entry->dirty = false;
	if (p_entry->kind == "tool") {
		p_entry->title_label->set_text(p_entry->title);
		p_entry->title_label->set_tooltip_text(p_entry->title);
		p_entry->status_label->set_text(_tool_status_label(p_entry->status));
		const String status = p_entry->status.to_lower();
		p_entry->dot->set_color(status == "completed" ? Color("#3fb950") : (status == "failed" ? Color("#f85149") : Color("#d29922")));
		return;
	}
	if (p_entry->kind == "review") {
		if (p_entry->resolved && p_entry->review_actions) {
			for (int i = 0; i < 2 && i < p_entry->review_actions->get_child_count(); i++) {
				Object::cast_to<Button>(p_entry->review_actions->get_child(i))->set_disabled(true);
			}
		}
		p_entry->status_label->set_text(p_entry->text);
		return;
	}
	if (p_entry->kind == "diff") {
		return;
	}
	if (p_entry->title_label) {
		p_entry->title_label->set_text(p_entry->kind == "user" ? U("Você") : (p_entry->kind == "agent" ? (agent_title.is_empty() ? _provider_label(provider) : agent_title) : String("System")));
	}
	if (p_entry->body) {
		p_entry->body->set_text(p_entry->kind == "user" ? _escape(p_entry->text) : _markdown(p_entry->text));
		p_entry->body->set_visible(!p_entry->text.is_empty());
	}
}

void RetroAiPanel::_queue_render() {
	if (!render_queued) {
		render_queued = true;
		callable_mp(this, &RetroAiPanel::_flush_render).call_deferred();
	}
}

void RetroAiPanel::_flush_render() {
	render_queued = false;
	for (Entry *entry : entries) {
		if (entry->dirty) {
			_update_entry(entry);
		}
	}
	_update_visibility();
	if (stick_to_bottom && !replaying && is_inside_tree()) {
		// No próximo quadro: o contêiner ainda vai medir o texto novo.
		if (!get_tree()->is_connected(SNAME("process_frame"), callable_mp(this, &RetroAiPanel::_scroll_to_bottom))) {
			get_tree()->connect(SNAME("process_frame"), callable_mp(this, &RetroAiPanel::_scroll_to_bottom), Object::CONNECT_ONE_SHOT);
		}
	}
}

void RetroAiPanel::_scroll_to_bottom() {
	messages_scroll->set_v_scroll(int(messages_scroll->get_v_scroll_bar()->get_max()));
}

void RetroAiPanel::_on_scroll(double p_value) {
	ScrollBar *bar = messages_scroll->get_v_scroll_bar();
	stick_to_bottom = bar->get_max() - p_value - bar->get_page() < STICK_TO_BOTTOM_PX * EDSCALE;
}

// Detalhes (ferramentas e raciocínio) escondidos viram um resumo; tela vazia; "processando".
void RetroAiPanel::_update_visibility() {
	int visible = 0, tools = 0, active = 0, thoughts = 0;
	for (Entry *entry : entries) {
		const bool detail = entry->kind == "tool" || entry->kind == "thought";
		if (entry->root) {
			entry->root->set_visible(show_details || !detail);
		}
		visible += show_details || !detail ? 1 : 0;
		if (entry->kind == "tool") {
			tools++;
			active += _is_terminal_status(entry->status) ? 0 : 1;
		} else if (entry->kind == "thought") {
			thoughts++;
		}
	}
	String summary;
	if (!show_details && (tools || thoughts)) {
		if (active) {
			summary = vformat(U("%d em andamento"), active);
		} else if (tools) {
			summary = vformat(U("%d ferramentas"), tools);
		}
		if (thoughts) {
			summary += (summary.is_empty() ? "" : U(" · ")) + U("raciocínio");
		}
	}
	activity->set_visible(!summary.is_empty());
	activity->set_text(summary + (summary.is_empty() ? "" : U("   detalhes")));
	const bool busy = status == STATUS_BUSY || status == STATUS_STARTING;
	processing->set_visible(busy);
	processing_label->set_text(replaying || status == STATUS_STARTING ? (replaying ? U("Carregando sessão…") : U("Conectando…")) : U("Trabalhando…"));
	empty_state->set_visible(visible == 0 && summary.is_empty() && status == STATUS_READY && !replaying);
	onboarding_dismiss->set_visible(!onboarding_seen);
}

void RetroAiPanel::_update_header() {
	const bool busy = status == STATUS_BUSY || status == STATUS_STARTING;
	brand_title->set_text(agent_title.is_empty() ? _provider_label(provider) : agent_title);
	status_text->set_text(_status_label());
	status_dot->add_theme_style_override(SceneStringName(panel), _round(_status_color(status), 4));
	status_dot->set_tooltip_text(_status_label());
	for (int i = 0; i < 3; i++) {
		if (provider == PROVIDERS[i]) {
			provider_switch->select(i);
		}
	}
	provider_switch->set_disabled(busy || status == STATUS_STARTING);
	new_button->set_disabled(busy);
	restart_button->set_disabled(busy);
	restart_button->set_tooltip_text(pending_session_id.is_empty() ? U("Recarregar sessão atual") : U("Tentar recuperar esta sessão novamente"));
	cancel_button->set_disabled(!busy || status == STATUS_STARTING);
	details_button->set_pressed_no_signal(show_details);
	details_button->set_tooltip_text(show_details ? U("Ocultar detalhes") : U("Mostrar detalhes (ferramentas e pensamento)"));
	progress->set_visible(busy);
	const bool show_auth = auth_error_hint || (auth_status.has("hasCredentials") && auth_status["hasCredentials"].get_type() == Variant::BOOL && !bool(auth_status["hasCredentials"]));
	auth_banner->set_visible(show_auth);
	auth_message->set_text(auth_error_hint ? vformat(U("Parece um erro de autenticação. Faça login no %s e tente de novo."), _provider_label(provider)) : U("Nenhuma credencial detectada para o agente selecionado."));
	auth_login_button->set_text(provider == "codex" ? U("Conectar ao Codex") : U("Abrir login no terminal"));
	install_banner->set_visible(agent_install_required);
	install_title->set_text(vformat(U("%s ACP não instalado"), _provider_label(provider)));
	install_command->set_text(_install_command());
	_update_composer();
	_update_visibility();
}

Dictionary RetroAiPanel::_config_option(const String &p_category) const {
	for (int i = 0; i < config_options.size(); i++) {
		const Dictionary option = config_options[i];
		if (String(option.get("category", "")) == p_category || String(option.get("id", "")) == p_category) {
			return option;
		}
	}
	return Dictionary();
}

static String _option_display(const Dictionary &p_option, const String &p_fallback) {
	if (p_option.is_empty()) {
		return p_fallback;
	}
	const Array options = p_option.get("options", Array());
	for (int i = 0; i < options.size(); i++) {
		const Dictionary item = options[i];
		if (item.get("value", Variant()) == p_option.get("currentValue", Variant())) {
			return item.get("name", p_fallback);
		}
	}
	return String(p_option.get("currentValue", p_fallback));
}

static String _format_session_time(const String &p_iso) {
	const int64_t unix_time = Time::get_singleton()->get_unix_time_from_datetime_string(p_iso.replace("Z", ""));
	if (unix_time <= 0) {
		return p_iso;
	}
	const Dictionary zone = Time::get_singleton()->get_time_zone_from_system();
	const Dictionary date = Time::get_singleton()->get_datetime_dict_from_unix_time(unix_time + int64_t(zone.get("bias", 0)) * 60);
	static const char *MONTHS[12] = { "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez" };
	return vformat("%02d %s %02d:%02d", int(date["day"]), MONTHS[CLAMP(int(date["month"]) - 1, 0, 11)], int(date["hour"]), int(date["minute"]));
}

static String _session_title(const Dictionary &p_session) {
	const String title = String(p_session.get("title", "")).strip_edges();
	if (!title.is_empty() && !title.to_lower().begins_with("new session")) {
		return title;
	}
	if (!String(p_session.get("updatedAt", "")).is_empty()) {
		return _format_session_time(p_session["updatedAt"]);
	}
	const String id = p_session.get("sessionId", "");
	return id.is_empty() ? U("Sessão") : id.left(12);
}

bool RetroAiPanel::_can_send() const {
	return status == STATUS_READY && !session_id.is_empty() && (!input->get_text().strip_edges().is_empty() || !pending_images.is_empty()) &&
			(pending_images.is_empty() || supports_images);
}

void RetroAiPanel::_update_composer() {
	const bool ready = status == STATUS_READY;
	const bool busy = status == STATUS_BUSY || status == STATUS_STARTING;
	input->set_editable(status == STATUS_READY || status == STATUS_ERROR);
	send_button->set_text(busy ? U("…") : U("Enviar"));
	send_button->set_disabled(!_can_send());
	attach_button->set_disabled(!(ready && supports_images));
	attach_button->set_tooltip_text(supports_images ? U("Anexar imagem") : U("Este agente não anunciou suporte a imagens."));
	history_button->set_disabled(!ready || busy);
	session_select->set_visible(!sessions.is_empty());
	String session_name = session_id.is_empty() ? U("Sessão") : U("Sessão atual");
	for (int i = 0; i < sessions.size(); i++) {
		if (String(Dictionary(sessions[i]).get("sessionId", "")) == session_id) {
			session_name = _session_title(sessions[i]);
		}
	}
	session_select->set_text(session_name + U(" ▾"));
	session_select->set_tooltip_text(session_name);
	const Dictionary mode = _config_option("mode");
	mode_select->set_visible(!mode.is_empty());
	mode_select->set_text(_option_display(mode, U("Modo")) + U(" ▾"));
	const Dictionary model = _config_option("model");
	model_select->set_visible(!model.is_empty());
	model_select->set_text(_option_display(model, U("Modelo")) + U(" ▾"));
	model_select->set_tooltip_text(_option_display(model, U("Modelo")));
	image_hint->set_visible(ready);
	image_hint->set_text(supports_images ? U("Cole um print com Ctrl+V ou anexe uma imagem.") : U("Este agente não anunciou suporte a imagens."));
	image_error_label->set_visible(!image_error.is_empty());
	image_error_label->set_text(image_error);
}

// Chips de contexto: arquivo aberto, erros do build, tilemap aberto e a última ROM.
void RetroAiPanel::_refresh_chips() {
	RetroAiPlugin *plugin = RetroAiPlugin::singleton;
	if (!plugin) {
		return;
	}
	const Dictionary snapshot = plugin->ai_snapshot();
	const String file = snapshot.get("filePath", "");
	const Array errors = snapshot.get("errors", Array());
	const Dictionary tilemap = snapshot.get("tilemap", Dictionary());
	const String rom = snapshot.get("romPath", "");
	struct Chip {
		String label, detail, title;
		bool available, active;
	};
	const Chip list[4] = {
		{ U("Arquivo"), file.get_file(), file.is_empty() ? U("Nenhum arquivo aberto") : file, !file.is_empty(), chip_file && !file.is_empty() },
		{ "Build", errors.is_empty() ? String() : itos(errors.size()), errors.is_empty() ? U("Sem erros de build") : vformat(U("%d erro(s) de compilação"), errors.size()), !errors.is_empty(), chip_build && !errors.is_empty() },
		{ "Tilemap", tilemap.get("name", ""), tilemap.is_empty() ? U("Nenhum tilemap recente") : String(tilemap["path"]), !tilemap.is_empty(), chip_tilemap && !tilemap.is_empty() },
		{ "ROM", rom.get_file(), rom.is_empty() ? U("Nenhuma ROM de build") : rom, !rom.is_empty(), chip_rom && !rom.is_empty() },
	};
	for (int i = 0; i < 4; i++) {
		chip_buttons[i]->set_text(list[i].label + (list[i].detail.is_empty() ? String() : "  " + list[i].detail));
		chip_buttons[i]->set_tooltip_text(list[i].title);
		chip_buttons[i]->set_disabled(!list[i].available);
		chip_buttons[i]->set_pressed_no_signal(list[i].active);
	}
	last_chip_refresh = OS::get_singleton()->get_ticks_msec();
}

void RetroAiPanel::_chip_toggled(int p_chip) {
	bool *states[4] = { &chip_file, &chip_build, &chip_tilemap, &chip_rom };
	*states[p_chip] = !*states[p_chip];
	_refresh_chips();
}

// ---- sessão (startSession, openSession, restart… do componente antigo) ----

// O servidor MCP do próprio editor (HTTP em 127.0.0.1, com o token na URL): o agente recebe as
// ferramentas do Retro Studio sem precisar de node nem de uma ponte por socket.
Array RetroAiPanel::_mcp_servers() {
	Array servers;
	const String url = RetroAiPlugin::singleton ? RetroAiPlugin::singleton->get_url() : String();
	const bool http = Dictionary(agent_capabilities.get("mcpCapabilities", Dictionary())).get("http", false);
	if (url.is_empty() || !http) {
		return servers;
	}
	Dictionary server;
	server["type"] = "http";
	server["name"] = "retro-studio";
	server["url"] = url;
	server["headers"] = Array();
	servers.push_back(server);
	return servers;
}

void RetroAiPanel::_start_session(const String &p_mode, const String &p_session) {
	started_once = true;
	_shutdown_acp();
	status = STATUS_STARTING;
	supports_images = false;
	agent_install_required = false;
	session_id = String();
	_drop_permissions(false);
	config_options.clear();
	replaying = false;
	_refresh_auth_status();
	auth_error_hint = false;
	_update_header();

	// Executável: o caminho das configurações, o PATH do usuário ou ~/.opencode/bin/opencode.
	String command = EDITOR_GET(_setting_key(provider));
	if (!command.is_empty() && !FileAccess::exists(command)) {
		command = String();
	}
	if (command.is_empty()) {
		const String home = retro_home();
		if (provider == "opencode") {
			command = FileAccess::exists(home.path_join(".opencode/bin/opencode")) ? home.path_join(".opencode/bin/opencode") : retro_find_executable("opencode");
		} else {
			const String name = provider == "claude" ? "claude-agent-acp" : "codex-acp";
			command = retro_find_executable(name);
			if (command.is_empty() && FileAccess::exists(home.path_join(".npm-global/bin").path_join(name))) {
				command = home.path_join(".npm-global/bin").path_join(name);
			}
		}
	}
	if (command.is_empty()) {
		_fail_start(provider == "claude" ? U("Claude ACP não encontrado. Instale @agentclientprotocol/claude-agent-acp ou configure o caminho do executável claude-agent-acp.") : (provider == "codex" ? U("Codex ACP não encontrado. Instale @agentclientprotocol/codex-acp ou configure o caminho do executável.") : U("OpenCode não encontrado. Instale o CLI ou configure o caminho.")), p_mode);
		return;
	}
	Vector<String> args;
	if (provider == "opencode") {
		args.push_back("acp");
		args.push_back("--cwd");
		args.push_back(_project_dir());
	}
	acp.instantiate();
	acp->set_message_handler(callable_mp(this, &RetroAiPanel::_agent_message));
	acp->set_exit_handler(callable_mp(this, &RetroAiPanel::_agent_exited));
	if (acp->start(command, args, _project_dir()) != OK) {
		acp.unref();
		_fail_start(U("Binário ACP não encontrado: ") + command, p_mode);
		return;
	}
	Dictionary fs;
	fs["readTextFile"] = true;
	fs["writeTextFile"] = true;
	Dictionary capabilities;
	capabilities["fs"] = fs;
	capabilities["terminal"] = false;
	Dictionary client;
	client["name"] = "retro-studio";
	client["title"] = "Retro Studio";
	client["version"] = GODOT_VERSION_NUMBER;
	Dictionary params;
	params["protocolVersion"] = 1;
	params["clientCapabilities"] = capabilities;
	params["clientInfo"] = client;
	acp->request("initialize", params, callable_mp(this, &RetroAiPanel::_initialized).bind(p_mode, p_session));
}

void RetroAiPanel::_fail_start(const String &p_message, const String &p_mode) {
	_shutdown_acp();
	status = STATUS_ERROR;
	if (p_message.contains(U("Codex ACP não encontrado")) || p_message.contains(U("Claude ACP não encontrado"))) {
		agent_install_required = true;
	}
	if (_looks_like_auth_error(p_message)) {
		auth_error_hint = true;
	}
	String message = p_message;
	if (p_mode == "load" && message.to_lower().contains("session is in use by another codex client")) {
		message = U("Esta sessão está aberta em outro cliente do Codex. Feche-a lá e clique em ↻ para tentar novamente.");
	}
	_push_system(message);
	_finish_replay();
}

void RetroAiPanel::_initialized(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session) {
	if (acp.is_null()) {
		return;
	}
	if (p_error.get_type() != Variant::NIL) {
		_fail_start(Dictionary(p_error).get("message", U("O agente recusou o início.")), p_mode);
		return;
	}
	const Dictionary result = p_result;
	if (int(result.get("protocolVersion", 0)) != 1) {
		_fail_start(U("Protocolo ACP incompatível: ") + String(result.get("protocolVersion", "")), p_mode);
		return;
	}
	agent_capabilities = result.get("agentCapabilities", Dictionary());
	const Dictionary info = result.get("agentInfo", Dictionary());
	agent_title = info.get("title", info.get("name", _provider_label(provider)));
	auth_methods = result.get("authMethods", Array());
	supports_images = bool(Dictionary(agent_capabilities.get("promptCapabilities", Dictionary())).get("image", false));
	// O Codex precisa entrar na conta antes do session/new: o processo fica vivo para o
	// "Conectar ao Codex" chamar authenticate.
	if (provider == "codex" && auth_status.has("hasCredentials") && !bool(auth_status["hasCredentials"])) {
		status = STATUS_READY;
		_update_header();
		_finish_replay();
		return;
	}
	_open_on_client(p_mode, p_session);
}

void RetroAiPanel::_open_on_client(const String &p_mode, const String &p_session) {
	Dictionary params;
	params["cwd"] = _project_dir();
	params["mcpServers"] = _mcp_servers();
	if (p_mode == "load" && !p_session.is_empty()) {
		if (!bool(agent_capabilities.get("loadSession", false))) {
			_fail_start(U("Este agente ACP não oferece suporte à recuperação de sessões (session/load)."), p_mode);
			return;
		}
		replaying = true;
		_clear_entries();
		status = STATUS_STARTING;
		_update_header();
		params["sessionId"] = p_session;
		acp->request("session/load", params, callable_mp(this, &RetroAiPanel::_session_opened).bind(p_mode, p_session));
		return;
	}
	acp->request("session/new", params, callable_mp(this, &RetroAiPanel::_session_opened).bind(p_mode, p_session));
}

void RetroAiPanel::_session_opened(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session) {
	if (acp.is_null()) {
		return;
	}
	if (p_error.get_type() != Variant::NIL) {
		const String message = Dictionary(p_error).get("message", U("erro desconhecido"));
		_fail_start(p_mode == "load" ? vformat(U("Não foi possível recuperar a sessão %s: %s"), p_session, message) : message, p_mode);
		return;
	}
	const Dictionary result = p_result.get_type() == Variant::DICTIONARY ? Dictionary(p_result) : Dictionary();
	session_id = result.get("sessionId", p_session);
	pending_session_id = String();
	_apply_config_options(result.get("configOptions", Variant()));
	status = STATUS_READY;
	if (p_mode == "load") {
		_push_system(U("Sessão anterior deste projeto retomada."));
	} else if (p_mode == "created") {
		_push_system(U("Nova sessão criada."));
	}
	_finish_replay();
	if (Dictionary(agent_capabilities.get("sessionCapabilities", Dictionary())).has("list")) {
		_list_sessions(String(), Array(), 0);
	}
	if (!queued_prompt.is_empty()) {
		const String text = queued_prompt;
		queued_prompt = String();
		_send_text(text, false);
	}
}

void RetroAiPanel::_list_sessions(const String &p_cursor, const Array &p_found, int p_page) {
	if (acp.is_null()) {
		return;
	}
	Dictionary params;
	params["cwd"] = _project_dir();
	if (!p_cursor.is_empty()) {
		params["cursor"] = p_cursor;
	}
	acp->request("session/list", params, callable_mp(this, &RetroAiPanel::_sessions_listed).bind(p_found, p_page));
}

void RetroAiPanel::_sessions_listed(const Variant &p_result, const Variant &p_error, const Array &p_found, int p_page) {
	Array found = p_found;
	if (p_error.get_type() != Variant::NIL) {
		session_history_loading = false;
		session_history_error = Dictionary(p_error).get("message", U("Não foi possível carregar o histórico de sessões."));
		if (open_menu == "history") {
			_fill_menu();
		}
		return;
	}
	const Dictionary result = p_result;
	found.append_array(result.get("sessions", Array()));
	const String next = result.get("nextCursor", "");
	if (!next.is_empty() && p_page < 100) {
		_list_sessions(next, found, p_page + 1);
		return;
	}
	// Uma vez cada sessão (a lista já vem da mais recente para a mais antiga).
	HashSet<String> seen;
	sessions.clear();
	for (int i = 0; i < found.size(); i++) {
		const String id = Dictionary(found[i]).get("sessionId", "");
		if (!id.is_empty() && !seen.has(id)) {
			seen.insert(id);
			sessions.push_back(found[i]);
		}
	}
	session_history_loading = false;
	session_history_error = String();
	_update_composer();
	if (open_menu == "history" || open_menu == "session") {
		_fill_menu();
	}
}

void RetroAiPanel::_history_listed(const Variant &p_result, const Variant &p_error, const Array &p_found, int p_page) {
	_sessions_listed(p_result, p_error, p_found, p_page);
}

void RetroAiPanel::_apply_config_options(const Variant &p_options) {
	if (p_options.get_type() == Variant::ARRAY) {
		config_options = p_options;
		_update_composer();
	}
}

void RetroAiPanel::_finish_replay() {
	replaying = false;
	_update_header();
	_queue_render();
	stick_to_bottom = true;
}

void RetroAiPanel::_shutdown_acp() {
	if (acp.is_valid()) {
		Ref<RetroAcp> old = acp;
		acp.unref();
		old->set_exit_handler(Callable());
		old->set_message_handler(Callable());
		old->stop();
	}
}

void RetroAiPanel::_stop_session() {
	_shutdown_acp();
	status = STATUS_IDLE;
	session_id = String();
	_update_header();
}

// Reinicia o processo ACP e recarrega a mesma sessão (histórico).
void RetroAiPanel::_restart() {
	_close_menu();
	const String keep = pending_session_id.is_empty() ? session_id : pending_session_id;
	_clear_entries();
	_stop_session();
	_start_session(keep.is_empty() ? "new" : "load", keep);
}

// Conversa nova neste projeto; reaproveita o processo quando ele está pronto.
void RetroAiPanel::_create_new_session() {
	_close_menu();
	if (status == STATUS_BUSY || status == STATUS_STARTING) {
		return;
	}
	_clear_entries();
	if (status == STATUS_READY && acp.is_valid() && acp->is_running()) {
		status = STATUS_STARTING;
		replaying = false;
		_drop_permissions(false);
		_update_header();
		_reopen("created", String());
		return;
	}
	_stop_session();
	_start_session("new");
}

void RetroAiPanel::_load_existing_session(const String &p_session) {
	_close_menu();
	if (p_session.is_empty() || p_session == session_id || status == STATUS_BUSY || status == STATUS_STARTING) {
		return;
	}
	pending_session_id = p_session;
	_clear_entries();
	if (status == STATUS_READY && acp.is_valid() && acp->is_running()) {
		status = STATUS_STARTING;
		replaying = true;
		_drop_permissions(false);
		_update_header();
		_reopen("load", p_session);
		return;
	}
	_stop_session();
	_start_session("load", p_session);
}

// Troca de conversa no mesmo processo (como o Zed): fecha a atual e abre/carrega a outra.
void RetroAiPanel::_reopen(const String &p_mode, const String &p_session) {
	// Capacidade anunciada como objeto ({}): conta a presença, como o !! do JavaScript.
	if (!session_id.is_empty() && Dictionary(agent_capabilities.get("sessionCapabilities", Dictionary())).has("close")) {
		Dictionary params;
		params["sessionId"] = session_id;
		acp->request("session/close", params, callable_mp(this, &RetroAiPanel::_session_closed).bind(p_mode, p_session));
		return;
	}
	if (!session_id.is_empty()) {
		Dictionary params;
		params["sessionId"] = session_id;
		acp->notify("session/cancel", params);
	}
	_session_closed(Variant(), Variant(), p_mode, p_session);
}

void RetroAiPanel::_session_closed(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session) {
	if (acp.is_null()) {
		return;
	}
	session_id = String();
	_open_on_client(p_mode, p_session);
}

void RetroAiPanel::_switch_provider(int p_index) {
	const String selected = PROVIDERS[CLAMP(p_index, 0, 2)];
	if (status == STATUS_BUSY || status == STATUS_STARTING || selected == provider) {
		_update_header();
		return;
	}
	provider = selected;
	permission_memory.clear();
	auth_methods.clear();
	agent_title = String();
	EditorSettings::get_singleton()->set_setting("retro_studio/ai/provider", provider);
	EditorSettings::save();
	_close_menu();
	_clear_entries();
	pending_session_id = String();
	_stop_session();
	_start_session("new");
}

void RetroAiPanel::_cancel() {
	_drop_permissions(true);
	if (acp.is_valid() && !session_id.is_empty()) {
		Dictionary params;
		params["sessionId"] = session_id;
		acp->notify("session/cancel", params);
	}
}

void RetroAiPanel::_agent_exited() {
	_shutdown_acp();
	status = STATUS_ERROR;
	replaying = false;
	_push_system(U("Processo ACP do agente encerrado."));
	_update_header();
}

// ---- envio ----

// O histórico da sessão já guarda o que foi enviado: cada nota segue uma vez por sessão.
Array RetroAiPanel::_context_notes() {
	RetroAiPlugin *plugin = RetroAiPlugin::singleton;
	const Dictionary snapshot = plugin ? plugin->ai_snapshot() : Dictionary();
	Array notes;
	notes.push_back(U("--- RETRO STUDIO TOOLS ---\nRetro Studio is a Sega Mega Drive game editor built on Godot: the game is made of scenes (.tscn) with MD* nodes (MDCena root, MDMapa, MDColisao, MDJogador, MDInimigo, MDItem, MDSprite…), converted to SGDK C code at build time. Read the guide first (guide). MCP server retro-studio acts on the project open in the IDE: project_info, project_tree, ide_state, scene_read (node tree with properties and warnings), scene_open/scene_new/scene_save, node_add/node_set/node_remove (with the editor undo), file_read/file_write (project files; never edit src/gerado or res/gerado), character_read, sheet_find_drawings, character_create, character_edit (animations of .charset.json characters), map_read/map_paint (MDMapa/MDColisao cells, with undo), build_run (save, generate, compile, optionally run; returns problems and VRAM usage), build_errors, ide_screenshot, emulator_screenshot and emulator_press (play the running game). Prefer build_run to compile. UI slash /build /play /stop also works. Answer the user in Brazilian Portuguese."));
	const Array errors = snapshot.get("errors", Array());
	if (chip_build && !errors.is_empty()) {
		String lines;
		for (int i = 0; i < MIN(20, errors.size()); i++) {
			const Dictionary error = errors[i];
			String location;
			for (const char *key : { "file", "line", "column" }) {
				if (error.has(key) && String(error[key]) != "") {
					location += (location.is_empty() ? "" : ":") + String(error[key]);
				}
			}
			lines += ("- " + (location.is_empty() ? String("?") : location) + " " + String(error.get("message", error.get("type", "")))).strip_edges() + "\n";
		}
		notes.push_back(vformat("--- SGDK BUILD ERRORS (%d) ---\n", errors.size()) + lines.strip_edges());
	}
	const Dictionary tilemap = snapshot.get("tilemap", Dictionary());
	if (chip_tilemap && !tilemap.is_empty()) {
		// Notas em aberto do mapa, como o chip Tilemap do antigo.
		const Array marked = tilemap.get("notes", Array());
		String open;
		if (!marked.is_empty()) {
			open = vformat("\nopen notes (MDNota nodes; notes_list for details, note_image to see the area, note_update to answer; pixels, tile = %d px):", int(tilemap.get("tileSize", 8)));
			for (int i = 0; i < marked.size(); i++) {
				open += "\n- " + String(marked[i]);
			}
		}
		notes.push_back("--- TILEMAP ---\nname: " + String(tilemap.get("name", "")) + "\npath: " + String(tilemap.get("path", "")) + open);
	}
	const String rom = snapshot.get("romPath", "");
	if (chip_rom && !rom.is_empty()) {
		notes.push_back("--- LAST ROM ---\n" + rom);
	}
	if (sent_session != session_id) {
		sent_session = session_id;
		sent_notes.clear();
		sent_files.clear();
	}
	Array fresh;
	for (int i = 0; i < notes.size(); i++) {
		if (!sent_notes.has(notes[i])) {
			sent_notes.insert(notes[i]);
			fresh.push_back(notes[i]);
		}
	}
	return fresh;
}

void RetroAiPanel::_send() {
	if (!_can_send()) {
		return;
	}
	_send_text(input->get_text().strip_edges(), true);
}

void RetroAiPanel::_send_text(const String &p_text, bool p_from_input) {
	const Vector<PendingImage> images = p_from_input ? pending_images : Vector<PendingImage>();
	if ((p_text.is_empty() && images.is_empty()) || status != STATUS_READY || acp.is_null()) {
		return;
	}
	// Atalhos locais: /build /play /stop.
	const String command = p_text.to_lower();
	if (images.is_empty() && (command == "/build" || command == "/play" || command == "/stop")) {
		if (p_from_input) {
			input->clear();
		}
		stick_to_bottom = true;
		_push_entry("user", p_text);
		RetroAiPlugin *plugin = RetroAiPlugin::singleton;
		if (command == "/build") {
			_push_system(U("Build iniciado…"));
		} else if (command == "/play") {
			_push_system(U("Play iniciado…"));
		}
		if (plugin) {
			plugin->ai_action(command.substr(1));
		}
		if (command == "/stop") {
			_push_system(U("Build/play interrompido."));
		}
		return;
	}
	_close_menu();
	_refresh_chips();
	image_error = String();
	Entry *entry = _push_entry("user", p_text);
	for (const PendingImage &image : images) {
		entry->images.push_back(image.image);
	}
	if (!images.is_empty()) {
		_build_entry(entry);
	}
	if (p_from_input) {
		input->clear();
	}
	status = STATUS_BUSY;
	stick_to_bottom = true;
	_update_header();

	Array prompt;
	if (!p_text.is_empty() || images.is_empty()) {
		Dictionary block;
		block["type"] = "text";
		block["text"] = p_text;
		prompt.push_back(block);
	}
	for (const PendingImage &image : images) {
		Dictionary block;
		block["type"] = "image";
		block["mimeType"] = image.mime_type;
		block["data"] = image.data;
		prompt.push_back(block);
	}
	const Array notes = _context_notes();
	for (int i = 0; i < notes.size(); i++) {
		Dictionary block;
		block["type"] = "text";
		block["text"] = notes[i];
		prompt.push_back(block);
	}
	// Arquivo atual: só o link; o conteúdo segue quando há alteração não salva que o agente não viu.
	RetroAiPlugin *plugin = RetroAiPlugin::singleton;
	const Dictionary snapshot = plugin ? plugin->ai_snapshot() : Dictionary();
	const String file = chip_file ? String(snapshot.get("filePath", "")) : String();
	if (!file.is_empty()) {
		String content;
		if (bool(snapshot.get("fileDirty", false))) {
			content = snapshot.get("fileContent", "");
			if (content.length() > MAX_UNSAVED_FILE_CHARS || (sent_files.has(file) && sent_files[file] == content)) {
				content = String();
			} else {
				sent_files[file] = content;
			}
		}
		const String uri = "file://" + file;
		Dictionary block;
		if (content.is_empty()) {
			block["type"] = "resource_link";
			block["uri"] = uri;
			block["name"] = file.get_file();
		} else if (bool(Dictionary(agent_capabilities.get("promptCapabilities", Dictionary())).get("embeddedContext", false))) {
			Dictionary resource;
			resource["uri"] = uri;
			resource["mimeType"] = "text/plain";
			resource["text"] = content;
			block["type"] = "resource";
			block["resource"] = resource;
		} else {
			block["type"] = "text";
			block["text"] = "--- " + file + U(" (não salvo) ---\n") + content;
		}
		prompt.push_back(block);
	}
	Dictionary params;
	params["sessionId"] = session_id;
	params["prompt"] = prompt;
	acp->request("session/prompt", params, callable_mp(this, &RetroAiPanel::_prompt_done).bind(p_text, p_from_input, images.size()));
}

void RetroAiPanel::_prompt_done(const Variant &p_result, const Variant &p_error, const String &p_text, bool p_from_input, int p_image_count) {
	if (p_error.get_type() != Variant::NIL) {
		// O agente pode não ter recebido o contexto: na próxima mensagem ele segue de novo.
		sent_session = String();
		const String message = Dictionary(p_error).get("message", U("erro desconhecido"));
		if (p_from_input && input->get_text().is_empty()) {
			input->set_text(p_text);
		}
		if (p_image_count) {
			image_error = U("O envio falhou. Suas imagens foram mantidas para tentar novamente.");
		}
		if (_looks_like_auth_error(message)) {
			auth_error_hint = true;
		}
		_push_system(message);
	} else {
		if (p_from_input && p_image_count) {
			pending_images.remove_at(0); // As imagens enviadas saem da lista (as do começo).
			for (int i = 1; i < p_image_count && !pending_images.is_empty(); i++) {
				pending_images.remove_at(0);
			}
			_update_pending_images();
		}
		const String reason = Dictionary(p_result).get("stopReason", "");
		if (!reason.is_empty() && reason != "end_turn") {
			_push_system(U("Parou: ") + reason);
		}
	}
	if (status == STATUS_BUSY) {
		status = STATUS_READY;
	}
	_drop_permissions(false);
	_update_header();
}

void RetroAiPanel::_input_gui(const Ref<InputEvent> &p_event) {
	Ref<InputEventKey> key = p_event;
	if (key.is_null() || !key->is_pressed()) {
		return;
	}
	if ((key->get_keycode() == Key::ENTER || key->get_keycode() == Key::KP_ENTER) && !key->is_shift_pressed()) {
		input->accept_event();
		_send();
		return;
	}
	// Ctrl+V com imagem na área de transferência anexa a imagem; texto continua colando normal.
	if (key->is_command_or_control_pressed() && key->get_keycode() == Key::V && DisplayServer::get_singleton()->clipboard_has_image()) {
		const Ref<Image> image = DisplayServer::get_singleton()->clipboard_get_image();
		if (image.is_valid() && !image->is_empty()) {
			input->accept_event();
			if (!supports_images) {
				image_error = U("Este agente não anunciou suporte a imagens.");
				_update_composer();
				return;
			}
			_add_image(image, "image/png", image->save_png_to_buffer());
		}
	}
	callable_mp(this, &RetroAiPanel::_update_composer).call_deferred();
}

// ---- agente → editor ----

String RetroAiPanel::_confined_path(const String &p_path) const {
	const String root = _project_dir().simplify_path();
	String path = p_path.begins_with("file://") ? p_path.trim_prefix("file://") : p_path;
	if (path.is_relative_path()) {
		path = root.path_join(path);
	}
	path = path.simplify_path();
	return path == root || path.begins_with(root + "/") ? path : String();
}

// Conteúdo do editor de código quando o arquivo está aberto com alteração não salva.
String RetroAiPanel::_unsaved_buffer(const String &p_path) const {
	if (!ScriptEditor::get_singleton()) {
		return String();
	}
	const String local = ProjectSettings::get_singleton()->localize_path(p_path);
	const Array editors = ScriptEditor::get_singleton()->call("get_open_script_editors"); // O método público é registrado só no ClassDB.
	for (int i = 0; i < editors.size(); i++) {
		ScriptEditorBase *editor = Object::cast_to<ScriptEditorBase>(editors[i]);
		const Ref<Resource> resource = editor ? editor->get_edited_resource() : Ref<Resource>();
		if (resource.is_valid() && resource->get_path() == local && editor->is_unsaved()) {
			CodeEdit *code = Object::cast_to<CodeEdit>(editor->get_base_editor());
			return code ? code->get_text() : String();
		}
	}
	return String();
}

void RetroAiPanel::_agent_message(const String &p_method, const Variant &p_params, const Variant &p_id) {
	const Dictionary params = p_params.get_type() == Variant::DICTIONARY ? Dictionary(p_params) : Dictionary();
	if (p_method == "session/update") {
		_handle_update(params.get("update", Dictionary()));
		return;
	}
	if (p_method == "session/request_permission") {
		Dictionary request = params.duplicate();
		request["id"] = p_id;
		_permission_request(request);
		return;
	}
	if (p_method == "fs/read_text_file") {
		const String path = _confined_path(params.get("path", ""));
		if (path.is_empty()) {
			acp->respond_error(p_id, -32000, U("Path fora do workspace: ") + String(params.get("path", "")));
			return;
		}
		String content = _unsaved_buffer(path);
		if (content.is_empty()) {
			if (!FileAccess::exists(path)) {
				acp->respond_error(p_id, -32000, U("Arquivo não encontrado: ") + path);
				return;
			}
			content = FileAccess::get_file_as_string(path);
		}
		if (params.has("line") || params.has("limit")) {
			const Vector<String> lines = content.split("\n");
			const int start = MAX(0, int(params.get("line", 1)) - 1);
			const int end = params.has("limit") ? start + int(params["limit"]) : lines.size();
			content = String("\n").join(lines.slice(start, MIN(lines.size(), end)));
		}
		Dictionary result;
		result["content"] = content;
		acp->respond(p_id, result);
		return;
	}
	if (p_method == "fs/write_text_file") {
		const String path = _confined_path(params.get("path", ""));
		if (path.is_empty()) {
			acp->respond_error(p_id, -32000, U("Path fora do workspace: ") + String(params.get("path", "")));
			return;
		}
		const bool was_new = !FileAccess::exists(path);
		String previous = _unsaved_buffer(path);
		if (previous.is_empty() && !was_new) {
			previous = FileAccess::get_file_as_string(path);
		}
		const String content = params.get("content", "");
		DirAccess::make_dir_recursive_absolute(path.get_base_dir());
		Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			acp->respond_error(p_id, -32000, U("Não foi possível gravar ") + path);
			return;
		}
		file->store_string(content);
		file.unref();
		acp->respond(p_id, Variant());
		_file_written(path, previous, content, was_new);
		return;
	}
	if (p_id.get_type() != Variant::NIL) {
		acp->respond_error(p_id, -32601, "Method not found: " + p_method);
	}
}

void RetroAiPanel::_handle_update(const Dictionary &p_update) {
	const String kind = p_update.get("sessionUpdate", "");
	const Dictionary content = p_update.get("content", Dictionary());
	if (kind == "agent_message_chunk" && !String(content.get("text", "")).is_empty()) {
		_append_chunk("agent", content["text"]);
	} else if (kind == "agent_thought_chunk" && !String(content.get("text", "")).is_empty()) {
		_append_chunk("thought", content["text"]);
	} else if (kind == "user_message_chunk" && !String(content.get("text", "")).is_empty()) {
		_append_chunk("user", content["text"]);
	} else if (kind == "user_message_chunk" && String(content.get("type", "")) == "image") {
		// Imagem do histórico (replay): junta à última mensagem do usuário.
		const String mime = content.get("mimeType", "");
		const CharString encoded = String(content.get("data", "")).utf8();
		Vector<uint8_t> bytes;
		bytes.resize(encoded.length());
		size_t length = 0;
		CryptoCore::b64_decode(bytes.ptrw(), bytes.size(), &length, (const uint8_t *)encoded.get_data(), encoded.length());
		bytes.resize(length);
		Ref<Image> image;
		image.instantiate();
		const Error loaded = mime == "image/jpeg" ? image->load_jpg_from_buffer(bytes) : (mime == "image/webp" ? image->load_webp_from_buffer(bytes) : image->load_png_from_buffer(bytes));
		if (loaded == OK) {
			Entry *last = entries.is_empty() ? nullptr : entries[entries.size() - 1];
			if (!last || last->kind != "user") {
				last = _push_entry("user");
			}
			last->images.push_back(image);
			_build_entry(last);
		}
	} else if (kind == "tool_call" || kind == "tool_call_update") {
		_upsert_tool(p_update);
		if (String(p_update.get("status", "")) == "completed") {
			_sync_open_files(); // O agente pode ter gravado direto no disco (sem fs/write_text_file).
		}
	} else if (kind == "plan" && p_update.get("entries", Variant()).get_type() == Variant::ARRAY) {
		const Array plan = p_update["entries"];
		String text = "Plano";
		for (int i = 0; i < plan.size(); i++) {
			const Dictionary step = plan[i];
			text += "\n- [" + String(step.get("status", "pending")) + "] " + String(step.get("content", ""));
		}
		_push_system(text);
	} else if (kind == "config_option_update") {
		_apply_config_options(p_update.get("configOptions", Variant()));
	}
}

void RetroAiPanel::_upsert_tool(const Dictionary &p_update) {
	const String id = p_update.get("toolCallId", "");
	Entry *entry = tool_index.has(id) ? tool_index[id] : nullptr;
	if (!entry) {
		entry = _push_entry("tool");
		entry->tool_id = id;
		entry->title = p_update.get("title", id);
		entry->status = p_update.get("status", "pending");
		tool_index[id] = entry;
	} else {
		if (!String(p_update.get("title", "")).is_empty()) {
			entry->title = p_update["title"];
		}
		if (!String(p_update.get("status", "")).is_empty()) {
			entry->status = p_update["status"];
		}
		_touch(entry);
	}
	const Array blocks = p_update.get("content", Array());
	for (int i = 0; i < blocks.size(); i++) {
		const Dictionary block = blocks[i];
		if (String(block.get("type", "")) != "diff") {
			continue;
		}
		const Vector<String> lines = String(block.get("newText", "")).split("\n");
		String preview = String("\n").join(lines.slice(0, 40));
		if (lines.size() > 40) {
			preview += vformat(U("\n… (+%d linhas)"), lines.size() - 40);
		}
		Entry *diff = memnew(Entry);
		diff->kind = "diff";
		diff->path = block.get("path", "");
		diff->preview = preview;
		entries.push_back(diff);
		_build_entry(diff);
		_queue_render();
	}
}

// Textos abertos no editor (código C, .res…) sem alteração não salva que mudaram no disco — o agente
// gravou com a própria ferramenta — passam a mostrar o arquivo novo.
void RetroAiPanel::_sync_open_files() {
	if (!ScriptEditor::get_singleton()) {
		return;
	}
	const Array editors = ScriptEditor::get_singleton()->call("get_open_script_editors");
	for (int i = 0; i < editors.size(); i++) {
		ScriptEditorBase *editor = Object::cast_to<ScriptEditorBase>(editors[i]);
		const Ref<TextFile> text = editor ? Ref<TextFile>(editor->get_edited_resource()) : Ref<TextFile>();
		if (text.is_null() || text->get_path().is_empty() || editor->is_unsaved() || !FileAccess::exists(text->get_path())) {
			continue;
		}
		const String disk = FileAccess::get_file_as_string(text->get_path());
		if (disk != text->get_text()) {
			text->set_text(disk);
			if (TextEditorBase *text_editor = Object::cast_to<TextEditorBase>(editor)) {
				text_editor->reload_text();
			}
			editor->tag_saved_version();
		}
	}
}

void RetroAiPanel::_reload_file(const String &p_path, const String &p_content) {
	const String local = ProjectSettings::get_singleton()->localize_path(p_path);
	if (EditorFileSystem::get_singleton()) {
		EditorFileSystem::get_singleton()->update_file(local);
	}
	if (ScriptEditor::get_singleton()) {
		ScriptEditor::get_singleton()->reload_scripts(true);
		// Código C e outros textos abrem como TextFile, que o reload_scripts não alcança: o editor
		// aberto recebe o que o agente gravou.
		const Array editors = ScriptEditor::get_singleton()->call("get_open_script_editors");
		for (int i = 0; i < editors.size(); i++) {
			ScriptEditorBase *editor = Object::cast_to<ScriptEditorBase>(editors[i]);
			const Ref<TextFile> text = editor ? Ref<TextFile>(editor->get_edited_resource()) : Ref<TextFile>();
			if (text.is_valid() && text->get_path() == local) {
				text->set_text(p_content);
				if (TextEditorBase *text_editor = Object::cast_to<TextEditorBase>(editor)) {
					text_editor->reload_text();
				}
				editor->tag_saved_version();
			}
		}
	}
}

// O agente gravou um arquivo: a alteração fica para revisão (Aceitar mantém; Rejeitar desfaz).
void RetroAiPanel::_file_written(const String &p_path, const String &p_previous, const String &p_content, bool p_was_new) {
	_reload_file(p_path, p_content);
	if (replaying) {
		return;
	}
	if (p_previous == p_content) {
		_push_system(vformat(U("Arquivo atualizado: %s"), p_path.get_file()));
		return;
	}
	// Prévia: as linhas que mudaram (com o sinal de - e +), como o diff inline do editor antigo.
	const Vector<String> before = p_previous.split("\n");
	const Vector<String> after = p_content.split("\n");
	int start = 0;
	while (start < before.size() && start < after.size() && before[start] == after[start]) {
		start++;
	}
	int end_before = before.size() - 1, end_after = after.size() - 1;
	while (end_before >= start && end_after >= start && before[end_before] == after[end_after]) {
		end_before--;
		end_after--;
	}
	String preview;
	int shown = 0;
	for (int i = start; i <= end_before && shown < 20; i++, shown++) {
		preview += "- " + before[i] + "\n";
	}
	for (int i = start; i <= end_after && shown < 40; i++, shown++) {
		preview += "+ " + after[i] + "\n";
	}
	const int total = (end_before - start + 1) + (end_after - start + 1);
	if (total > shown) {
		preview += vformat(U("… (+%d linhas)"), total - shown);
	}
	Entry *review = memnew(Entry);
	review->kind = "review";
	review->path = p_path;
	review->preview = vformat(U("linha %d\n"), start + 1) + preview.strip_edges();
	review->previous_content = p_previous;
	review->new_content = p_content;
	review->was_new_file = p_was_new;
	entries.push_back(review);
	_build_entry(review);
	_queue_render();
	_push_system(vformat(U("Alteração pendente de revisão: %s"), p_path.get_file()));
}

void RetroAiPanel::_review_answer(bool p_accept, int p_entry) {
	if (p_entry < 0 || p_entry >= int(entries.size())) {
		return;
	}
	Entry *review = entries[p_entry];
	if (review->resolved) {
		return;
	}
	review->resolved = true;
	if (p_accept) {
		review->text = U("Aceita");
	} else {
		if (review->was_new_file) {
			DirAccess::remove_absolute(review->path);
		} else {
			Ref<FileAccess> file = FileAccess::open(review->path, FileAccess::WRITE);
			if (file.is_valid()) {
				file->store_string(review->previous_content);
			}
		}
		_reload_file(review->path, review->previous_content);
		review->text = U("Rejeitada");
	}
	_touch(review);
}

// ---- permissões ----

String RetroAiPanel::_permission_key(const Dictionary &p_tool_call) const {
	const String kind = p_tool_call.get("kind", "other");
	const Array locations = p_tool_call.get("locations", Array());
	PackedStringArray paths;
	for (int i = 0; i < locations.size(); i++) {
		const String path = Dictionary(locations[i]).get("path", "");
		if (!path.is_empty()) {
			paths.push_back(path);
		}
	}
	paths.sort();
	if (!paths.is_empty()) {
		return kind + ":" + String("|").join(paths);
	}
	if (!String(p_tool_call.get("title", "")).is_empty()) {
		return kind + ":" + String(p_tool_call["title"]);
	}
	return kind + ":*";
}

static Dictionary _find_option(const Array &p_options, const char *p_first, const char *p_second) {
	for (const char *kind : { p_first, p_second }) {
		for (int i = 0; i < p_options.size(); i++) {
			if (String(Dictionary(p_options[i]).get("kind", "")) == kind) {
				return p_options[i];
			}
		}
	}
	return Dictionary();
}

void RetroAiPanel::_permission_request(const Dictionary &p_request) {
	const Dictionary tool = p_request.get("toolCall", Dictionary());
	const String key = _permission_key(tool);
	const String any = String(tool.get("kind", "other")) + ":*";
	const String remembered = permission_memory.has(key) ? permission_memory[key] : (permission_memory.has(any) ? permission_memory[any] : String());
	if (!remembered.is_empty()) {
		const Dictionary option = remembered == "allow" ? _find_option(p_request.get("options", Array()), "allow_always", "allow_once") : _find_option(p_request.get("options", Array()), "reject_always", "reject_once");
		if (!option.is_empty()) {
			Dictionary outcome;
			outcome["outcome"] = "selected";
			outcome["optionId"] = option["optionId"];
			Dictionary result;
			result["outcome"] = outcome;
			acp->respond(p_request["id"], result);
			_push_system(remembered == "allow" ? U("Permissão concedida automaticamente (lembrar).") : U("Permissão negada automaticamente (lembrar)."));
			return;
		}
	}
	// Agentes pedem permissão para várias ferramentas ao mesmo tempo: cada pedido espera a sua vez.
	if (!permission.is_empty()) {
		permission_queue.push_back(p_request);
	} else {
		permission = p_request;
		_show_permission();
	}
}

void RetroAiPanel::_show_permission() {
	permission_box->set_visible(!permission.is_empty());
	if (permission.is_empty()) {
		return;
	}
	permission_since = OS::get_singleton()->get_ticks_msec();
	const Dictionary tool = permission.get("toolCall", Dictionary());
	static const char *KINDS[][2] = { { "read", "Leitura" }, { "edit", "Edição" }, { "delete", "Exclusão" }, { "move", "Mover" }, { "search", "Busca" },
		{ "execute", "Executar" }, { "think", "Raciocínio" }, { "fetch", "Fetch" }, { "other", "Ação" } };
	const String kind = tool.get("kind", "other");
	String kind_label = kind;
	for (const auto &item : KINDS) {
		if (kind == item[0]) {
			kind_label = U(item[1]);
		}
	}
	permission_kind->set_text(kind_label);
	permission_tool->set_text(tool.get("title", tool.get("toolCallId", U("O agente pediu autorização para executar uma ação."))));
	const Array locations = tool.get("locations", Array());
	PackedStringArray paths;
	for (int i = 0; i < locations.size(); i++) {
		const Dictionary location = locations[i];
		const String base = String(location.get("path", "")).get_file();
		if (!base.is_empty()) {
			paths.push_back(location.has("line") && location["line"].get_type() != Variant::NIL ? base + ":" + itos(int64_t(location["line"])) : base);
		}
	}
	permission_paths->set_visible(!paths.is_empty());
	permission_paths->set_text(String(", ").join(paths));
	while (permission_actions->get_child_count() > 0) {
		Node *child = permission_actions->get_child(0);
		permission_actions->remove_child(child);
		child->queue_free();
	}
	// Ordem: permitir sempre, permitir uma vez, negar, negar sempre.
	static const char *ORDER[4][2] = { { "allow_always", "Permitir sempre" }, { "allow_once", "Permitir uma vez" }, { "reject_once", "Negar" }, { "reject_always", "Negar sempre" } };
	const Array options = permission.get("options", Array());
	Vector<int> order;
	for (int rank = 0; rank <= 4; rank++) {
		for (int i = 0; i < options.size(); i++) {
			const String option_kind = Dictionary(options[i]).get("kind", "");
			int option_rank = 4;
			for (int k = 0; k < 4; k++) {
				if (option_kind == ORDER[k][0]) {
					option_rank = k;
				}
			}
			if (option_rank == rank) {
				order.push_back(i);
			}
		}
	}
	for (int i : order) {
		const Dictionary option = options[i];
		const String option_kind = option.get("kind", "");
		String label = option.get("name", option_kind);
		for (int k = 0; k < 4; k++) {
			if (option_kind == ORDER[k][0]) {
				label = U(ORDER[k][1]);
			}
		}
		Button *button = memnew(Button);
		button->set_text(label);
		button->set_disabled(answering_permission);
		if (option_kind.begins_with("allow")) {
			button->add_theme_color_override(SceneStringName(font_color), Color("#3fb950"));
		} else if (option_kind.begins_with("reject")) {
			button->add_theme_color_override(SceneStringName(font_color), Color("#ff7b72"));
		}
		button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_answer_permission).bind(i));
		permission_actions->add_child(button);
	}
}

void RetroAiPanel::_next_permission() {
	permission = permission_queue.is_empty() ? Dictionary() : permission_queue[0];
	if (!permission_queue.is_empty()) {
		permission_queue.remove_at(0);
	}
	_show_permission();
}

void RetroAiPanel::_drop_permissions(bool p_cancel_pending) {
	if (p_cancel_pending && acp.is_valid()) {
		Vector<Dictionary> pending = permission_queue;
		if (!permission.is_empty()) {
			pending.insert(0, permission);
		}
		for (const Dictionary &item : pending) {
			Dictionary outcome;
			outcome["outcome"] = "cancelled";
			Dictionary result;
			result["outcome"] = outcome;
			acp->respond(item["id"], result);
		}
	}
	permission_queue.clear();
	permission = Dictionary();
	_show_permission();
}

void RetroAiPanel::_answer_permission(int p_option) {
	if (permission.is_empty() || answering_permission || acp.is_null()) {
		return;
	}
	const Array options = permission.get("options", Array());
	if (p_option < 0 || p_option >= options.size()) {
		return;
	}
	const Dictionary option = options[p_option];
	const String kind = option.get("kind", "");
	if (kind == "allow_always" || kind == "reject_always") {
		const String decision = kind.begins_with("allow") ? "allow" : "reject";
		const Dictionary tool = permission.get("toolCall", Dictionary());
		permission_memory[_permission_key(tool)] = decision;
		// Também por tipo genérico para execute sem caminho.
		if (Array(tool.get("locations", Array())).is_empty()) {
			permission_memory[String(tool.get("kind", "other")) + ":*"] = decision;
		}
	}
	Dictionary outcome;
	outcome["outcome"] = "selected";
	outcome["optionId"] = option.get("optionId", "");
	Dictionary result;
	result["outcome"] = outcome;
	acp->respond(permission["id"], result);
	_next_permission();
}

// O pedido esperou demais (5 min): cancela, como o processo principal do antigo.
void RetroAiPanel::_expire_permission() {
	if (permission.is_empty() || acp.is_null()) {
		return;
	}
	Dictionary outcome;
	outcome["outcome"] = "cancelled";
	Dictionary result;
	result["outcome"] = outcome;
	acp->respond(permission["id"], result);
	_push_system(U("O agente não esperava mais esta resposta (o pedido expirou ou a conversa foi reiniciada). Peça de novo; se repetir, use ↻ para reconectar."));
	_next_permission();
}

// ---- login, instalação, configurações ----

// Credenciais do agente sem expor nada da conta (como checkAuthStatus do antigo).
void RetroAiPanel::_refresh_auth_status() {
	auth_status = Dictionary();
	const String home = retro_home();
	Variant has_credentials;
	Array providers;
	if (provider == "claude") {
		if (OS::get_singleton()->has_environment("ANTHROPIC_API_KEY") || OS::get_singleton()->has_environment("CLAUDE_CODE_OAUTH_TOKEN")) {
			has_credentials = true;
			providers.push_back("Claude");
		} else if (!auth_thread.is_started()) {
			// Pergunta ao CLI em segundo plano; até a resposta, "desconhecido" (sem aviso de login).
			auth_done.clear();
			auth_result.set(-1);
			auth_thread.start(_claude_auth_thread, this);
		}
		auth_status["loginCommand"] = "claude auth login";
	} else if (provider == "codex") {
		has_credentials = OS::get_singleton()->has_environment("CODEX_API_KEY") || OS::get_singleton()->has_environment("OPENAI_API_KEY") || FileAccess::exists(home.path_join(".codex/auth.json"));
		if (bool(has_credentials)) {
			providers.push_back("Codex");
		}
		auth_status["loginCommand"] = "codex login";
	} else {
		const String data_home = OS::get_singleton()->has_environment("XDG_DATA_HOME") ? OS::get_singleton()->get_environment("XDG_DATA_HOME") : home.path_join(".local/share");
		JSON json;
		has_credentials = false;
		if (json.parse(FileAccess::get_file_as_string(data_home.path_join("opencode/auth.json"))) == OK && json.get_data().get_type() == Variant::DICTIONARY) {
			providers = Dictionary(json.get_data()).keys();
			has_credentials = !providers.is_empty();
		}
		auth_status["loginCommand"] = "opencode auth login";
	}
	if (has_credentials.get_type() == Variant::BOOL) {
		auth_status["hasCredentials"] = has_credentials;
		if (bool(has_credentials)) {
			auth_error_hint = false;
		}
	}
	auth_status["providers"] = providers;
}

void RetroAiPanel::_claude_auth_thread(void *p_self) {
	RetroAiPanel *self = static_cast<RetroAiPanel *>(p_self);
	const String home = retro_home();
#ifdef WINDOWS_ENABLED
	const String claude = FileAccess::exists(home.path_join(".local/bin/claude.exe")) ? home.path_join(".local/bin/claude.exe") : retro_find_executable("claude");
	if (!claude.is_empty()) {
		List<String> args;
		String program = claude;
		if (claude.get_extension().to_lower() == "cmd") {
			program = "cmd.exe";
			args.push_back("/d");
			args.push_back("/c");
			args.push_back(claude);
		}
		args.push_back("auth");
		args.push_back("status");
		String output;
		OS::get_singleton()->execute(program, args, &output);
		JSON json;
		if (json.parse(output.strip_edges()) == OK && json.get_data().get_type() == Variant::DICTIONARY && Dictionary(json.get_data()).get("loggedIn", Variant()).get_type() == Variant::BOOL) {
			self->auth_result.set(bool(Dictionary(json.get_data())["loggedIn"]) ? 1 : 0);
		}
	}
	self->auth_done.set();
#else
	const String claude = FileAccess::exists(home.path_join(".local/bin/claude")) ? home.path_join(".local/bin/claude") : retro_find_executable("claude");
	if (!claude.is_empty()) {
		List<String> args;
		args.push_back("PATH=" + retro_user_path());
		args.push_back("/usr/bin/timeout");
		args.push_back("10");
		args.push_back(claude);
		args.push_back("auth");
		args.push_back("status");
		String output;
		OS::get_singleton()->execute("/usr/bin/env", args, &output);
		JSON json;
		if (json.parse(output.strip_edges()) == OK && json.get_data().get_type() == Variant::DICTIONARY && Dictionary(json.get_data()).get("loggedIn", Variant()).get_type() == Variant::BOOL) {
			self->auth_result.set(bool(Dictionary(json.get_data())["loggedIn"]) ? 1 : 0);
		}
	}
	self->auth_done.set();
#endif
}

void RetroAiPanel::_apply_claude_auth() {
	auth_thread.wait_to_finish();
	if (provider != "claude" || auth_result.get() < 0) {
		return;
	}
	const bool logged = auth_result.get() == 1;
	auth_status["hasCredentials"] = logged;
	Array providers;
	if (logged) {
		providers.push_back("Claude");
		auth_error_hint = false;
	}
	auth_status["providers"] = providers;
	_update_header();
	if (settings_dialog->is_visible()) {
		_update_settings_dialog();
	}
}

void RetroAiPanel::_run_auth_login() {
	if (provider == "codex" && !auth_methods.is_empty() && acp.is_valid()) {
		const Dictionary method = auth_methods[0];
		const String id = method.get("id", method.get("methodId", ""));
		if (!id.is_empty()) {
			Dictionary params;
			params["methodId"] = id;
			acp->request("authenticate", params, callable_mp(this, &RetroAiPanel::_authenticated));
			return;
		}
	}
	// Abre um terminal com o comando de login (o antigo usava o terminal integrado).
	const String command = _login_command();
#ifdef WINDOWS_ENABLED
	{
		// Uma janela do prompt de comando com o login; fica aberta no fim.
		List<String> args;
		args.push_back("/d");
		args.push_back("/c");
		args.push_back("start");
		args.push_back("Retro Studio");
		args.push_back("cmd.exe");
		args.push_back("/k");
		args.push_back(command);
		if (OS::get_singleton()->create_process("cmd.exe", args) == OK) {
			_push_system(vformat(U("Janela aberta com %s — conclua o fluxo e clique em Verificar."), command));
			return;
		}
		_push_system(command);
		return;
	}
#endif
	const String script = "export PATH=\"$1\"; " + command + U("; echo; echo 'Pode fechar esta janela.'; read x");
	static const char *TERMINALS[][2] = { { "x-terminal-emulator", "-e" }, { "gnome-terminal", "--" }, { "konsole", "-e" }, { "xfce4-terminal", "-x" }, { "kitty", "" }, { "alacritty", "-e" }, { "xterm", "-e" } };
	for (const auto &terminal : TERMINALS) {
		const String path = retro_find_executable(terminal[0]);
		if (path.is_empty()) {
			continue;
		}
		List<String> args;
		if (String(terminal[1]) != "") {
			args.push_back(terminal[1]);
		}
		args.push_back("sh");
		args.push_back("-c");
		args.push_back(script);
		args.push_back("retro-studio-login");
		args.push_back(retro_user_path());
		if (OS::get_singleton()->create_process(path, args) == OK) {
			_push_system(vformat(U("Terminal aberto com %s — conclua o fluxo e clique em Verificar."), command));
			return;
		}
	}
	_push_system(command);
}

void RetroAiPanel::_authenticated(const Variant &p_result, const Variant &p_error) {
	if (p_error.get_type() != Variant::NIL) {
		_push_system(Dictionary(p_error).get("message", U("erro desconhecido")));
		return;
	}
	_refresh_auth_status();
	auth_error_hint = false;
	_start_session("new");
}

void RetroAiPanel::_copy_auth_command() {
	DisplayServer::get_singleton()->clipboard_set(_login_command());
	EditorToaster::get_singleton()->popup_str(U("Comando copiado"));
}

void RetroAiPanel::_copy_install_command() {
	DisplayServer::get_singleton()->clipboard_set(_install_command());
	EditorToaster::get_singleton()->popup_str(U("Comando de instalação copiado."));
}

void RetroAiPanel::_retry_install() {
	agent_install_required = false;
	_clear_entries();
	_start_session("new");
}

void RetroAiPanel::_update_settings_dialog() {
	const String draft = PROVIDERS[CLAMP(settings_provider->get_selected(), 0, 2)];
	settings_path->set_placeholder(draft == "claude" ? String("claude-agent-acp") : (draft == "codex" ? String("codex-acp") : String("~/.opencode/bin/opencode")));
	settings_path_hint->set_text(draft == "claude" ? U("Caminho do claude-agent-acp (não do claude). Vazio: procurar no PATH ou ~/.npm-global/bin. Login: claude auth login.") : (draft == "codex" ? U("Informe o caminho do executável codex-acp. Instale globalmente com: npm install -g @agentclientprotocol/codex-acp.") : U("Deixe vazio para detectar automaticamente (PATH ou ~/.opencode/bin/opencode).")));
	settings_provider_hint->set_visible(draft != provider);
	settings_auth->set_visible(draft == provider);
	const bool has = auth_status.has("hasCredentials") && bool(auth_status["hasCredentials"]);
	settings_auth_text->set_text(has ? vformat(U("%d provedor(es) configurado(s)"), Array(auth_status.get("providers", Array())).size()) : U("Nenhuma credencial detectada para o agente selecionado."));
}

void RetroAiPanel::_open_settings() {
	_close_menu();
	for (int i = 0; i < 3; i++) {
		if (provider == PROVIDERS[i]) {
			settings_provider->select(i);
		}
	}
	settings_path->set_text(EDITOR_GET(_setting_key(provider)));
	_refresh_auth_status();
	_update_settings_dialog();
	settings_dialog->popup_centered(Size2(460, 0) * EDSCALE);
}

void RetroAiPanel::_settings_provider_changed(int p_index) {
	settings_path->set_text(EDITOR_GET(_setting_key(PROVIDERS[CLAMP(p_index, 0, 2)])));
	_update_settings_dialog();
}

void RetroAiPanel::_save_settings() {
	const String draft = PROVIDERS[CLAMP(settings_provider->get_selected(), 0, 2)];
	const String path = settings_path->get_text().strip_edges();
	const bool changed = draft != provider || path != String(EDITOR_GET(_setting_key(draft)));
	EditorSettings::get_singleton()->set_setting("retro_studio/ai/provider", draft);
	EditorSettings::get_singleton()->set_setting(_setting_key(draft), path);
	EditorSettings::save();
	_push_system(U("Configuração salva. Recarregue a sessão se mudar o binário."));
	if (changed) {
		provider = draft;
		permission_memory.clear();
		auth_methods.clear();
		agent_title = String();
		_clear_entries();
		_stop_session();
		_start_session("new");
	} else {
		_refresh_auth_status();
		_update_header();
	}
}

void RetroAiPanel::_toggle_details() {
	show_details = !show_details;
	EditorSettings::get_singleton()->set_setting("retro_studio/ai/show_details", show_details);
	EditorSettings::save();
	_update_header();
}

void RetroAiPanel::_dismiss_onboarding() {
	onboarding_seen = true;
	EditorSettings::get_singleton()->set_setting("retro_studio/ai/onboarding_seen", true);
	EditorSettings::save();
	_update_visibility();
}

void RetroAiPanel::_close_panel() {
	EditorDock *dock = Object::cast_to<EditorDock>(get_parent());
	if (dock && EditorDockManager::get_singleton()) {
		EditorDockManager::get_singleton()->close_dock(dock);
	}
}

// ---- menus (histórico, sessão, modo, modelo) ----

void RetroAiPanel::_open_menu(const String &p_which, Control *p_anchor) {
	if (open_menu == p_which && menu->is_visible()) {
		_close_menu();
		return;
	}
	open_menu = p_which;
	_fill_menu();
	menu->reset_size();
	const Size2 size = menu->get_contents_minimum_size().max(Size2(260, 0) * EDSCALE);
	const Point2 anchor = p_anchor->get_screen_position();
	menu->popup(Rect2i(Point2i(anchor.x, MAX(0, int(anchor.y - size.y - 4))), Size2i(size)));
	if (p_which == "model" && model_search) {
		model_search->grab_focus();
	}
}

void RetroAiPanel::_close_menu() {
	open_menu = String();
	if (menu && menu->is_visible()) {
		menu->hide();
	}
}

static Button *_menu_item(const String &p_name, const String &p_description, bool p_active) {
	Button *button = memnew(Button);
	button->set_flat(true);
	button->set_text_alignment(HORIZONTAL_ALIGNMENT_LEFT);
	button->set_text((p_active ? U("✓ ") : U("   ")) + p_name + (p_description.is_empty() ? String() : "\n     " + p_description));
	return button;
}

void RetroAiPanel::_fill_menu() {
	while (menu_box->get_child_count() > 0) {
		Node *child = menu_box->get_child(0);
		menu_box->remove_child(child);
		child->queue_free();
	}
	model_search = nullptr;
	model_list = nullptr;
	const bool busy = status == STATUS_BUSY || status == STATUS_STARTING;
	if (open_menu == "history" || open_menu == "session") {
		if (open_menu == "history") {
			HBoxContainer *heading = memnew(HBoxContainer);
			menu_box->add_child(heading);
			Label *title = memnew(Label);
			title->set_text(U("Histórico de sessões"));
			title->set_h_size_flags(SIZE_EXPAND_FILL);
			heading->add_child(title);
			Button *refresh = memnew(Button);
			refresh->set_flat(true);
			refresh->set_text(session_history_loading ? U("…") : U("↻"));
			refresh->set_tooltip_text(U("Atualizar sessões"));
			refresh->set_disabled(session_history_loading);
			refresh->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_refresh_history));
			heading->add_child(refresh);
		}
		ScrollContainer *scroll = memnew(ScrollContainer);
		scroll->set_custom_minimum_size(Size2(300, MIN(320, 46 * MAX(1, sessions.size()))) * EDSCALE);
		scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
		menu_box->add_child(scroll);
		VBoxContainer *list = memnew(VBoxContainer);
		list->set_h_size_flags(SIZE_EXPAND_FILL);
		scroll->add_child(list);
		for (int i = 0; i < sessions.size(); i++) {
			const Dictionary session = sessions[i];
			const String id = session.get("sessionId", "");
			Button *item = _menu_item(_session_title(session), String(session.get("updatedAt", "")).is_empty() ? String() : _format_session_time(session["updatedAt"]), id == session_id);
			item->set_disabled(open_menu == "history" && (id == session_id || busy));
			item->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_menu_session_chosen).bind(id));
			list->add_child(item);
		}
		if (sessions.is_empty() && !session_history_loading) {
			list->add_child(_small_label(U("Nenhuma sessão anterior encontrada.")));
		}
		if (open_menu == "history" && !session_history_error.is_empty()) {
			menu_box->add_child(_small_label(session_history_error, Color("#ff7b72")));
		}
		if (open_menu == "session") {
			Button *create = _menu_item(U("Nova sessão"), String(), false);
			create->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_create_new_session));
			menu_box->add_child(create);
		}
	} else if (open_menu == "mode") {
		const Dictionary mode = _config_option("mode");
		const Array options = mode.get("options", Array());
		for (int i = 0; i < options.size(); i++) {
			const Dictionary option = options[i];
			Button *item = _menu_item(option.get("name", option.get("value", "")), option.get("description", ""), option.get("value", Variant()) == mode.get("currentValue", Variant()));
			item->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_menu_config_chosen).bind(String(mode.get("id", "")), String(option.get("value", ""))));
			menu_box->add_child(item);
		}
	} else if (open_menu == "model") {
		model_search = memnew(LineEdit);
		model_search->set_placeholder(U("Buscar modelo…"));
		model_search->set_clear_button_enabled(true);
		model_search->connect(SceneStringName(text_changed), callable_mp(this, &RetroAiPanel::_fill_model_list));
		menu_box->add_child(model_search);
		ScrollContainer *scroll = memnew(ScrollContainer);
		scroll->set_custom_minimum_size(Size2(300, 320) * EDSCALE);
		scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
		menu_box->add_child(scroll);
		model_list = memnew(VBoxContainer);
		model_list->set_h_size_flags(SIZE_EXPAND_FILL);
		scroll->add_child(model_list);
		_fill_model_list();
	}
}

// Modelos agrupados pelo provedor (o que vem antes da barra no valor), com busca.
void RetroAiPanel::_fill_model_list(const String &p_query) {
	if (!model_list) {
		return;
	}
	while (model_list->get_child_count() > 0) {
		Node *child = model_list->get_child(0);
		model_list->remove_child(child);
		child->queue_free();
	}
	const Dictionary model = _config_option("model");
	const Array options = model.get("options", Array());
	const String query = p_query.strip_edges().to_lower();
	Vector<String> groups;
	HashMap<String, Vector<Dictionary>> by_group;
	for (int i = 0; i < options.size(); i++) {
		const Dictionary option = options[i];
		if (!query.is_empty() && !String(option.get("name", "")).to_lower().contains(query) && !String(option.get("value", "")).to_lower().contains(query)) {
			continue;
		}
		String group = String(option.get("value", "")).get_slicec('/', 0);
		if (group.is_empty()) {
			group = "other";
		}
		if (!by_group.has(group)) {
			groups.push_back(group);
			by_group[group] = Vector<Dictionary>();
		}
		by_group[group].push_back(option);
	}
	for (const String &group : groups) {
		model_list->add_child(_small_label(group));
		for (const Dictionary &option : by_group[group]) {
			Button *item = _menu_item(option.get("name", option.get("value", "")), String(), option.get("value", Variant()) == model.get("currentValue", Variant()));
			item->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_menu_config_chosen).bind(String(model.get("id", "")), String(option.get("value", ""))));
			model_list->add_child(item);
		}
	}
	if (groups.is_empty()) {
		model_list->add_child(_small_label(U("Nenhum modelo encontrado")));
	}
}

void RetroAiPanel::_history_pressed() {
	_open_menu("history", history_button);
	if (open_menu == "history") {
		_refresh_history();
	}
}

void RetroAiPanel::_session_pressed() {
	_open_menu("session", session_select);
}

void RetroAiPanel::_mode_pressed() {
	_open_menu("mode", mode_select);
}

void RetroAiPanel::_model_pressed() {
	_open_menu("model", model_select);
}

void RetroAiPanel::_refresh_history() {
	if (session_history_loading || acp.is_null()) {
		return;
	}
	if (!Dictionary(agent_capabilities.get("sessionCapabilities", Dictionary())).has("list")) {
		session_history_error = U("Não foi possível carregar o histórico de sessões.");
		_fill_menu();
		return;
	}
	session_history_loading = true;
	session_history_error = String();
	_fill_menu();
	_list_sessions(String(), Array(), 0);
}

void RetroAiPanel::_menu_session_chosen(const String &p_session) {
	_load_existing_session(p_session);
}

void RetroAiPanel::_menu_config_chosen(const String &p_config, const String &p_value) {
	_close_menu();
	if (acp.is_null() || session_id.is_empty()) {
		return;
	}
	Dictionary params;
	params["sessionId"] = session_id;
	params["configId"] = p_config;
	params["value"] = p_value;
	acp->request("session/set_config_option", params, callable_mp(this, &RetroAiPanel::_config_set));
}

void RetroAiPanel::_config_set(const Variant &p_result, const Variant &p_error) {
	if (p_error.get_type() != Variant::NIL) {
		_push_system(Dictionary(p_error).get("message", U("erro desconhecido")));
		return;
	}
	_apply_config_options(Dictionary(p_result).get("configOptions", Variant()));
}

// ---- imagens ----

void RetroAiPanel::_attach_pressed() {
	image_dialog->popup_file_dialog();
}

void RetroAiPanel::_images_chosen(const PackedStringArray &p_paths) {
	for (const String &path : p_paths) {
		const Vector<uint8_t> bytes = FileAccess::get_file_as_bytes(path);
		const String extension = path.get_extension().to_lower();
		const String mime = extension == "png" ? "image/png" : (extension == "webp" ? "image/webp" : "image/jpeg");
		Ref<Image> image;
		image.instantiate();
		const Error loaded = mime == "image/png" ? image->load_png_from_buffer(bytes) : (mime == "image/webp" ? image->load_webp_from_buffer(bytes) : image->load_jpg_from_buffer(bytes));
		if (loaded != OK) {
			image_error = U("Não foi possível ler esta imagem. Tente copiar o print novamente.");
			_update_composer();
			return;
		}
		if (!_add_image(image, mime, bytes)) {
			return;
		}
	}
	input->grab_focus();
}

bool RetroAiPanel::_add_image(const Ref<Image> &p_image, const String &p_mime, const Vector<uint8_t> &p_bytes) {
	image_error = String();
	int total = p_bytes.size();
	for (const PendingImage &image : pending_images) {
		total += image.bytes;
	}
	if (pending_images.size() + 1 > MAX_IMAGE_COUNT) {
		image_error = vformat(U("Anexe até %d imagens por mensagem."), MAX_IMAGE_COUNT);
	} else if (p_bytes.size() > MAX_IMAGE_BYTES) {
		image_error = vformat(U("Cada imagem pode ter até %d MB."), MAX_IMAGE_BYTES / 1024 / 1024);
	} else if (total > MAX_TOTAL_IMAGE_BYTES) {
		image_error = vformat(U("As imagens juntas podem ter até %d MB."), MAX_TOTAL_IMAGE_BYTES / 1024 / 1024);
	} else if (int64_t(p_image->get_width()) * p_image->get_height() > MAX_IMAGE_PIXELS) {
		image_error = U("Esta imagem é grande demais. Recorte ou reduza a resolução.");
	}
	if (!image_error.is_empty()) {
		_update_composer();
		return false;
	}
	PendingImage image;
	image.image = p_image;
	image.mime_type = p_mime;
	image.bytes = p_bytes.size();
	image.data = CryptoCore::b64_encode_str(p_bytes.ptr(), p_bytes.size());
	pending_images.push_back(image);
	_update_pending_images();
	return true;
}

void RetroAiPanel::_remove_image(int p_index) {
	if (p_index >= 0 && p_index < pending_images.size()) {
		pending_images.remove_at(p_index);
	}
	image_error = String();
	_update_pending_images();
}

void RetroAiPanel::_update_pending_images() {
	while (pending_box->get_child_count() > 0) {
		Node *child = pending_box->get_child(0);
		pending_box->remove_child(child);
		child->queue_free();
	}
	for (int i = 0; i < pending_images.size(); i++) {
		const PendingImage &image = pending_images[i];
		VBoxContainer *item = memnew(VBoxContainer);
		Ref<Image> thumb = image.image->duplicate();
		const float scale = MIN(1.0f, 56.0f * EDSCALE / MAX(thumb->get_width(), thumb->get_height()));
		thumb->resize(MAX(1, int(thumb->get_width() * scale)), MAX(1, int(thumb->get_height() * scale)));
		TextureButton *preview = memnew(TextureButton);
		preview->set_texture_normal(ImageTexture::create_from_image(thumb));
		preview->set_tooltip_text(U("Ampliar imagem"));
		preview->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_preview_image).bind(image.image));
		item->add_child(preview);
		HBoxContainer *row = memnew(HBoxContainer);
		item->add_child(row);
		row->add_child(_small_label(vformat(U("%d × %d"), image.image->get_width(), image.image->get_height())));
		Button *remove = memnew(Button);
		remove->set_flat(true);
		remove->set_text(U("×"));
		remove->set_tooltip_text(vformat(U("Remover %s"), U("Imagem")));
		remove->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_remove_image).bind(i));
		row->add_child(remove);
		pending_box->add_child(item);
	}
	pending_box->set_visible(!pending_images.is_empty());
	_update_composer();
}

void RetroAiPanel::_preview_image(const Ref<Image> &p_image) {
	image_preview_rect->set_texture(ImageTexture::create_from_image(p_image));
	image_preview->popup_centered_ratio(0.6);
}

void RetroAiPanel::_open_error(const Dictionary &p_error) {
	if (RetroAiPlugin::singleton) {
		RetroAiPlugin::singleton->open_problem(p_error);
	}
}

void RetroAiPanel::_open_path(const String &p_path) {
	if (p_path.begins_with("http://") || p_path.begins_with("https://")) {
		OS::get_singleton()->shell_open(p_path);
		return;
	}
	const String path = _confined_path(p_path);
	if (path.is_empty() || !FileAccess::exists(path)) {
		return;
	}
	Dictionary problem;
	problem["file"] = path;
	problem["line"] = 1;
	problem["column"] = 1;
	_open_error(problem);
}

// ---- avisos do editor ----

void RetroAiPanel::build_finished(const Dictionary &p_summary) {
	_refresh_chips();
	if (bool(p_summary.get("success", false))) {
		const String rom = String(p_summary.get("romPath", "")).get_file();
		_push_system(rom.is_empty() ? U("Build concluído com sucesso.") : vformat(U("Build OK — ROM: %s"), rom));
		return;
	}
	const Array errors = p_summary.get("errors", Array());
	_push_system(vformat(U("Build falhou com %d erro(s). Ative o chip Build para incluir no próximo prompt."), errors.size()), errors);
	chip_build = true;
	_refresh_chips();
}

void RetroAiPanel::play_started() {
	_push_system(U("Play iniciado…"));
}

void RetroAiPanel::focus_input() {
	EditorDock *dock = Object::cast_to<EditorDock>(get_parent());
	if (dock && EditorDockManager::get_singleton()) {
		EditorDockManager::get_singleton()->open_dock(dock);
		EditorDockManager::get_singleton()->focus_dock(dock);
	}
	if (status == STATUS_IDLE || status == STATUS_ERROR) {
		_clear_entries();
		_start_session("new");
	}
	input->grab_focus();
}

// Ctrl+K: a instrução e o trecho selecionado viram um pedido de edição (como queueEditSelection).
void RetroAiPanel::queue_edit_selection(const String &p_instruction, const String &p_code, const String &p_path, int p_from_line, int p_to_line) {
	const String instruction = p_instruction.strip_edges();
	if (instruction.is_empty()) {
		return;
	}
	const String location = p_from_line > 0 ? vformat("linhas %d-%d", p_from_line, p_to_line) : U("seleção");
	const String prompt = vformat(U("Edite a %s do arquivo `%s` conforme a instrução:\n%s\n\nCódigo selecionado:\n```\n%s\n```\n\nAplique a alteração gravando o arquivo. Preserve o restante do arquivo. Depois explique brevemente o que mudou."),
			location, p_path.is_empty() ? U("arquivo atual") : p_path, instruction, p_code);
	chip_file = true;
	focus_input();
	if (status == STATUS_READY) {
		_send_text(prompt, false);
	} else if (status == STATUS_STARTING) {
		queued_prompt = prompt;
	} else {
		_push_system(U("Painel ACP ainda não está pronto. Tente de novo em instantes."));
		input->set_text(instruction);
	}
}

void RetroAiPanel::poll() {
	RetroAcp::reap();
	if (auth_thread.is_started() && auth_done.is_set()) {
		_apply_claude_auth();
	}
	if (acp.is_valid()) {
		Ref<RetroAcp> keep = acp; // Um handler pode encerrar o agente no meio do poll.
		keep->poll();
		if (keep.is_valid() && _looks_like_auth_error(keep->take_stderr())) {
			auth_error_hint = true;
			_update_header();
		}
	}
	if (!permission.is_empty() && OS::get_singleton()->get_ticks_msec() - permission_since > PERMISSION_TIMEOUT_MS) {
		_expire_permission();
	}
	if (is_visible_in_tree()) {
		const uint64_t now = OS::get_singleton()->get_ticks_msec();
		if (now - last_chip_refresh > 1500) {
			_refresh_chips();
		}
		const bool busy = status == STATUS_BUSY || status == STATUS_STARTING;
		if (busy) {
			// Bolinhas do "processando" e a marca pulsando, como no painel antigo.
			static const char *DOTS[3] = { "●○○", "○●○", "○○●" };
			processing_dots->set_text(U(DOTS[(now / 350) % 3]));
			brand_mark->set_modulate(Color(1, 1, 1, 0.55 + 0.45 * Math::abs(Math::sin(now / 400.0))));
		} else {
			brand_mark->set_modulate(Color(1, 1, 1, 1));
		}
	}
}

void RetroAiPanel::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_THEME_CHANGED: {
			new_button->set_button_icon(get_editor_theme_icon(SNAME("Add")));
			details_button->set_button_icon(get_editor_theme_icon(SNAME("Filter")));
			restart_button->set_button_icon(get_editor_theme_icon(SNAME("Reload")));
			cancel_button->set_button_icon(get_editor_theme_icon(SNAME("Stop")));
			settings_button->set_button_icon(get_editor_theme_icon(SNAME("Tools")));
			close_button->set_button_icon(get_editor_theme_icon(SNAME("Close")));
			attach_button->set_button_icon(get_editor_theme_icon(SNAME("ImageTexture")));
			history_button->set_button_icon(get_editor_theme_icon(SNAME("History")));
		} break;
		case NOTIFICATION_VISIBILITY_CHANGED: {
			// Abrir o painel começa uma conversa nova (as antigas ficam no histórico).
			if (is_visible_in_tree()) {
				_refresh_chips();
				if (status == STATUS_IDLE || status == STATUS_ERROR) {
					if (!started_once || status == STATUS_ERROR) {
						_clear_entries();
						_start_session("new");
					}
				}
				input->call_deferred(SNAME("grab_focus"));
			} else {
				_close_menu();
			}
		} break;
	}
}

// ---- montagem ----

static Button *_icon_button(const String &p_tooltip) {
	Button *button = memnew(Button);
	button->set_flat(true);
	button->set_focus_mode(Control::FOCUS_NONE);
	button->set_tooltip_text(p_tooltip);
	return button;
}

static PanelContainer *_banner(VBoxContainer *p_parent, const Color &p_color) {
	PanelContainer *banner = memnew(PanelContainer);
	Ref<StyleBoxFlat> style = _round(Color(p_color, 0.14), 6, 8);
	style->set_border_width_all(1);
	style->set_border_color(Color(p_color, 0.5));
	banner->add_theme_style_override(SceneStringName(panel), style);
	banner->hide();
	p_parent->add_child(banner);
	return banner;
}

RetroAiPanel::RetroAiPanel() {
	set_name("IA");
	add_theme_constant_override("separation", 4 * EDSCALE);
	EDITOR_DEF("retro_studio/ai/provider", "opencode");
	for (const char *item : PROVIDERS) {
		EDITOR_DEF(String("retro_studio/ai/") + item + "_path", "");
	}
	EDITOR_DEF("retro_studio/ai/show_details", false);
	EDITOR_DEF("retro_studio/ai/onboarding_seen", false);
	provider = EDITOR_GET("retro_studio/ai/provider");
	if (provider != "codex" && provider != "claude") {
		provider = "opencode";
	}
	show_details = EDITOR_GET("retro_studio/ai/show_details");
	onboarding_seen = EDITOR_GET("retro_studio/ai/onboarding_seen");

	// Cabeçalho: marca e nome do agente, estado, provedor e botões.
	VBoxContainer *head = memnew(VBoxContainer);
	add_child(head);
	HBoxContainer *head_main = memnew(HBoxContainer);
	head->add_child(head_main);
	CenterContainer *mark_box = memnew(CenterContainer);
	head_main->add_child(mark_box);
	brand_mark = memnew(PanelContainer);
	brand_mark->set_custom_minimum_size(Size2(10, 10) * EDSCALE);
	brand_mark->add_theme_style_override(SceneStringName(panel), _round(Color("#00aeee"), 5));
	mark_box->add_child(brand_mark);
	brand_title = memnew(Label);
	brand_title->set_h_size_flags(SIZE_EXPAND_FILL);
	brand_title->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	head_main->add_child(brand_title);
	CenterContainer *dot_box = memnew(CenterContainer);
	head_main->add_child(dot_box);
	status_dot = memnew(PanelContainer);
	status_dot->set_custom_minimum_size(Size2(8, 8) * EDSCALE);
	dot_box->add_child(status_dot);
	status_text = _small_label(String());
	head_main->add_child(status_text);

	HBoxContainer *tools = memnew(HBoxContainer);
	head->add_child(tools);
	provider_switch = memnew(OptionButton);
	provider_switch->add_item("OpenCode");
	provider_switch->add_item("Codex");
	provider_switch->add_item("Claude");
	provider_switch->set_tooltip_text(U("Agente"));
	provider_switch->connect(SceneStringName(item_selected), callable_mp(this, &RetroAiPanel::_switch_provider));
	tools->add_child(provider_switch);
	Control *tools_spacer = memnew(Control);
	tools_spacer->set_h_size_flags(SIZE_EXPAND_FILL);
	tools->add_child(tools_spacer);
	new_button = _icon_button(U("Nova sessão"));
	new_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_create_new_session));
	tools->add_child(new_button);
	details_button = _icon_button(U("Mostrar detalhes (ferramentas e pensamento)"));
	details_button->set_toggle_mode(true);
	details_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_toggle_details));
	tools->add_child(details_button);
	restart_button = _icon_button(U("Recarregar sessão atual"));
	restart_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_restart));
	tools->add_child(restart_button);
	cancel_button = _icon_button(U("Cancelar turno"));
	cancel_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_cancel));
	tools->add_child(cancel_button);
	settings_button = _icon_button(U("Configurações do agente"));
	settings_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_open_settings));
	tools->add_child(settings_button);
	close_button = _icon_button(U("Fechar"));
	close_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_close_panel));
	tools->add_child(close_button);
	progress = memnew(ProgressBar);
	progress->set_indeterminate(true);
	progress->set_show_percentage(false);
	progress->set_custom_minimum_size(Size2(0, 3) * EDSCALE);
	progress->hide();
	head->add_child(progress);

	// Login e instalação.
	auth_banner = _banner(this, Color("#d29922"));
	VBoxContainer *auth_box = memnew(VBoxContainer);
	auth_banner->add_child(auth_box);
	Label *auth_title = memnew(Label);
	auth_title->set_text(U("Autenticação do agente"));
	auth_box->add_child(auth_title);
	auth_message = memnew(Label);
	auth_message->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	auth_message->set_custom_minimum_size(Size2(180, 0) * EDSCALE);
	auth_box->add_child(auth_message);
	HFlowContainer *auth_actions = memnew(HFlowContainer);
	auth_box->add_child(auth_actions);
	auth_login_button = memnew(Button);
	auth_login_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_run_auth_login));
	auth_actions->add_child(auth_login_button);
	Button *auth_copy = memnew(Button);
	auth_copy->set_flat(true);
	auth_copy->set_text(U("Copiar comando"));
	auth_copy->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_copy_auth_command));
	auth_actions->add_child(auth_copy);
	Button *auth_recheck = memnew(Button);
	auth_recheck->set_flat(true);
	auth_recheck->set_text(U("Verificar de novo"));
	auth_recheck->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_refresh_auth_status));
	auth_recheck->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_update_header));
	auth_actions->add_child(auth_recheck);

	install_banner = _banner(this, Color("#f85149"));
	VBoxContainer *install_box = memnew(VBoxContainer);
	install_banner->add_child(install_box);
	install_title = memnew(Label);
	install_box->add_child(install_title);
	Label *install_prompt = memnew(Label);
	install_prompt->set_text(U("Instale o adaptador no terminal e tente conectar novamente."));
	install_prompt->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	install_prompt->set_custom_minimum_size(Size2(180, 0) * EDSCALE);
	install_box->add_child(install_prompt);
	install_command = memnew(Label);
	install_command->set_autowrap_mode(TextServer::AUTOWRAP_ARBITRARY);
	install_command->set_custom_minimum_size(Size2(180, 0) * EDSCALE);
	install_box->add_child(install_command);
	HFlowContainer *install_actions = memnew(HFlowContainer);
	install_box->add_child(install_actions);
	Button *install_copy = memnew(Button);
	install_copy->set_text(U("Copiar comando de instalação"));
	install_copy->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_copy_install_command));
	install_actions->add_child(install_copy);
	Button *install_retry = memnew(Button);
	install_retry->set_flat(true);
	install_retry->set_text(U("Já instalei — verificar novamente"));
	install_retry->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_retry_install));
	install_actions->add_child(install_retry);

	// Mensagens.
	messages_scroll = memnew(ScrollContainer);
	messages_scroll->set_v_size_flags(SIZE_EXPAND_FILL);
	messages_scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	messages_scroll->get_v_scroll_bar()->connect(SceneStringName(value_changed), callable_mp(this, &RetroAiPanel::_on_scroll));
	add_child(messages_scroll);
	messages = memnew(VBoxContainer);
	messages->set_h_size_flags(SIZE_EXPAND_FILL);
	messages->add_theme_constant_override("separation", 10 * EDSCALE);
	messages_scroll->add_child(messages);

	empty_state = memnew(VBoxContainer);
	messages->add_child(empty_state);
	Label *empty_title = memnew(Label);
	empty_title->set_text(U("Agente pronto"));
	empty_state->add_child(empty_title);
	static const char *ONBOARDING[] = {
		"Envie uma mensagem ao agente selecionado. O arquivo aberto entra no contexto automaticamente.",
		"• Escolha OpenCode, Codex ou Claude no seletor de agente e instale o respectivo executável ACP.",
		"• Use o botão de autenticação para entrar com o agente selecionado.",
		"• Ctrl+L abre este painel; use /build e /play no chat para compilar e executar o projeto Retro.",
		"• Ctrl+K no código C envia a seleção e o que mudar nela ao agente (revisão Aceitar/Rejeitar aqui no painel).",
		"• O agente lê e mexe nas cenas, personagens e mapas, compila, roda e joga pelo emulador com as ferramentas do Retro Studio (scene_read, node_set, character_edit, map_paint, build_run, emulator_press…). As mudanças nos nodes saem com Ctrl+Z.",
		nullptr,
	};
	for (int i = 0; ONBOARDING[i]; i++) {
		Label *line = _small_label(U(ONBOARDING[i]));
		line->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		line->set_custom_minimum_size(Size2(160, 0) * EDSCALE);
		empty_state->add_child(line);
	}
	onboarding_dismiss = memnew(Button);
	onboarding_dismiss->set_flat(true);
	onboarding_dismiss->set_text(U("Entendi, não mostrar de novo"));
	onboarding_dismiss->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_dismiss_onboarding));
	empty_state->add_child(onboarding_dismiss);

	processing = memnew(HBoxContainer);
	processing_dots = _small_label(String(), Color("#58a6ff"));
	processing->add_child(processing_dots);
	processing_label = _small_label(String());
	processing->add_child(processing_label);
	processing->hide();
	messages->add_child(processing);
	activity = memnew(Button);
	activity->set_flat(true);
	activity->set_text_alignment(HORIZONTAL_ALIGNMENT_LEFT);
	activity->set_tooltip_text(U("Mostrar detalhes (ferramentas e pensamento)"));
	activity->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_toggle_details));
	activity->hide();
	messages->add_child(activity);

	// Permissão.
	permission_box = _banner(this, Color("#58a6ff"));
	VBoxContainer *permission_column = memnew(VBoxContainer);
	permission_box->add_child(permission_column);
	Label *permission_title = memnew(Label);
	permission_title->set_text(U("Permissão necessária"));
	permission_column->add_child(permission_title);
	HBoxContainer *permission_meta = memnew(HBoxContainer);
	permission_column->add_child(permission_meta);
	permission_kind = _small_label(String(), Color("#e5c07b"));
	permission_meta->add_child(permission_kind);
	permission_tool = memnew(Label);
	permission_tool->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	permission_tool->set_h_size_flags(SIZE_EXPAND_FILL);
	permission_tool->set_custom_minimum_size(Size2(140, 0) * EDSCALE);
	permission_meta->add_child(permission_tool);
	permission_paths = _small_label(String());
	permission_paths->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	permission_column->add_child(permission_paths);
	Label *permission_hint = _small_label(U("Permitir sempre vale para ações parecidas nesta sessão."));
	permission_hint->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	permission_hint->set_custom_minimum_size(Size2(160, 0) * EDSCALE);
	permission_column->add_child(permission_hint);
	permission_actions = memnew(HFlowContainer);
	permission_column->add_child(permission_actions);

	// Contexto, imagens e campo de mensagem.
	chips = memnew(HFlowContainer);
	chips->set_tooltip_text(U("Contexto SGDK"));
	add_child(chips);
	for (int i = 0; i < 4; i++) {
		chip_buttons[i] = memnew(Button);
		chip_buttons[i]->set_toggle_mode(true);
		chip_buttons[i]->set_focus_mode(FOCUS_NONE);
		chip_buttons[i]->add_theme_font_size_override(SceneStringName(font_size), int(12 * EDSCALE));
		chip_buttons[i]->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_chip_toggled).bind(i));
		chips->add_child(chip_buttons[i]);
	}
	pending_box = memnew(HFlowContainer);
	pending_box->hide();
	add_child(pending_box);
	image_error_label = _small_label(String(), Color("#ff7b72"));
	image_error_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	image_error_label->set_custom_minimum_size(Size2(160, 0) * EDSCALE);
	image_error_label->hide();
	add_child(image_error_label);
	image_hint = _small_label(String());
	image_hint->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	add_child(image_hint);
	input = memnew(TextEdit);
	input->set_custom_minimum_size(Size2(0, 64) * EDSCALE);
	input->set_line_wrapping_mode(TextEdit::LINE_WRAPPING_BOUNDARY);
	input->set_placeholder(U("Pergunte ao agente… (Enter envia, Shift+Enter quebra linha)"));
	input->connect(SceneStringName(gui_input), callable_mp(this, &RetroAiPanel::_input_gui));
	input->connect(SceneStringName(text_changed), callable_mp(this, &RetroAiPanel::_update_composer));
	add_child(input);
	HBoxContainer *bar = memnew(HBoxContainer);
	add_child(bar);
	attach_button = _icon_button(U("Anexar imagem"));
	attach_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_attach_pressed));
	bar->add_child(attach_button);
	history_button = _icon_button(U("Histórico de sessões"));
	history_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_history_pressed));
	bar->add_child(history_button);
	auto selector = [&](void (RetroAiPanel::*p_method)()) {
		Button *button = memnew(Button);
		button->set_flat(true);
		button->set_focus_mode(FOCUS_NONE);
		button->set_clip_text(true);
		button->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
		button->set_h_size_flags(SIZE_EXPAND_FILL);
		button->set_custom_minimum_size(Size2(40, 0) * EDSCALE);
		button->add_theme_font_size_override(SceneStringName(font_size), int(12 * EDSCALE));
		button->connect(SceneStringName(pressed), callable_mp(this, p_method));
		button->hide();
		bar->add_child(button);
		return button;
	};
	session_select = selector(&RetroAiPanel::_session_pressed);
	mode_select = selector(&RetroAiPanel::_mode_pressed);
	model_select = selector(&RetroAiPanel::_model_pressed);
	send_button = memnew(Button);
	send_button->set_text(U("Enviar"));
	send_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_send));
	bar->add_child(send_button);

	menu = memnew(PopupPanel);
	menu->connect("popup_hide", callable_mp(this, &RetroAiPanel::_close_menu));
	add_child(menu);
	menu_box = memnew(VBoxContainer);
	menu->add_child(menu_box);

	image_dialog = memnew(EditorFileDialog);
	image_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILES);
	image_dialog->set_access(EditorFileDialog::ACCESS_FILESYSTEM);
	image_dialog->add_filter("*.png,*.jpg,*.jpeg,*.webp", U("Imagens"));
	image_dialog->set_title(U("Anexar imagem"));
	image_dialog->connect("files_selected", callable_mp(this, &RetroAiPanel::_images_chosen));
	add_child(image_dialog);
	image_preview = memnew(AcceptDialog);
	image_preview->set_title(U("Imagem"));
	image_preview->set_ok_button_text(U("Fechar"));
	image_preview_rect = memnew(TextureRect);
	image_preview_rect->set_expand_mode(TextureRect::EXPAND_IGNORE_SIZE);
	image_preview_rect->set_stretch_mode(TextureRect::STRETCH_KEEP_ASPECT_CENTERED);
	image_preview_rect->set_texture_filter(TEXTURE_FILTER_NEAREST);
	image_preview->add_child(image_preview_rect);
	add_child(image_preview);

	// Configurações do agente.
	settings_dialog = memnew(ConfirmationDialog);
	settings_dialog->set_title(U("Agente ACP"));
	settings_dialog->set_ok_button_text(U("Salvar"));
	settings_dialog->set_cancel_button_text(U("Cancelar"));
	settings_dialog->connect(SceneStringName(confirmed), callable_mp(this, &RetroAiPanel::_save_settings));
	add_child(settings_dialog);
	VBoxContainer *settings_body = memnew(VBoxContainer);
	settings_dialog->add_child(settings_body);
	settings_body->add_child(_small_label(U("Agente"), Color(1, 1, 1, 0.85)));
	settings_provider = memnew(OptionButton);
	settings_provider->add_item("OpenCode");
	settings_provider->add_item("Codex");
	settings_provider->add_item("Claude");
	settings_provider->connect(SceneStringName(item_selected), callable_mp(this, &RetroAiPanel::_settings_provider_changed));
	settings_body->add_child(settings_provider);
	settings_body->add_child(_small_label(U("Caminho do binário"), Color(1, 1, 1, 0.85)));
	settings_path_hint = _small_label(String());
	settings_path_hint->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	settings_path_hint->set_custom_minimum_size(Size2(400, 0) * EDSCALE);
	settings_body->add_child(settings_path_hint);
	settings_path = memnew(LineEdit);
	settings_body->add_child(settings_path);
	settings_provider_hint = _small_label(U("Salve a seleção do agente antes de fazer login nele."));
	settings_body->add_child(settings_provider_hint);
	settings_auth = memnew(VBoxContainer);
	settings_body->add_child(settings_auth);
	settings_auth->add_child(_small_label(U("Credenciais"), Color(1, 1, 1, 0.85)));
	settings_auth_text = _small_label(String());
	settings_auth->add_child(settings_auth_text);
	HBoxContainer *settings_auth_actions = memnew(HBoxContainer);
	settings_auth->add_child(settings_auth_actions);
	Button *settings_login = memnew(Button);
	settings_login->set_text(U("Abrir login no terminal"));
	settings_login->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_run_auth_login));
	settings_auth_actions->add_child(settings_login);
	Button *settings_recheck = memnew(Button);
	settings_recheck->set_flat(true);
	settings_recheck->set_text(U("Verificar de novo"));
	settings_recheck->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_refresh_auth_status));
	settings_recheck->connect(SceneStringName(pressed), callable_mp(this, &RetroAiPanel::_update_settings_dialog));
	settings_auth_actions->add_child(settings_recheck);

	_update_header();
}

RetroAiPanel::~RetroAiPanel() {
	// Os filhos já foram liberados aqui: só encerra o agente e as entradas.
	if (acp.is_valid()) {
		acp->set_exit_handler(Callable());
		acp->set_message_handler(Callable());
		acp->stop();
		acp.unref();
	}
	RetroAcp::shutdown_all();
	if (auth_thread.is_started()) {
		auth_thread.wait_to_finish(); // No máximo os 10 s do timeout do "claude auth status".
	}
	for (Entry *entry : entries) {
		memdelete(entry);
	}
	entries.clear();
}
