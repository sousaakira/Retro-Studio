#pragma once

#include "retro_acp.h"

#include "core/os/thread.h"
#include "core/templates/hash_set.h"
#include "core/templates/safe_refcount.h"
#include "core/templates/local_vector.h"
#include "scene/gui/box_container.h"

class AcceptDialog;
class Button;
class ColorRect;
class ConfirmationDialog;
class EditorFileDialog;
class HFlowContainer;
class Label;
class LineEdit;
class ItemList;
class OptionButton;
class PanelContainer;
class PopupPanel;
class ProgressBar;
class RichTextLabel;
class ScrollContainer;
class TextEdit;
class TextureRect;

// Painel "IA" (ao lado do Inspetor), porte do src/components/AcpAgentPanel.vue do Retro Studio
// atual: conversa com um agente ACP — OpenCode, Codex ou Claude — sobre o projeto aberto, com
// sessões (nova, histórico, retomar), modo e modelo do agente, permissões (lembrar "sempre"),
// chips de contexto, imagens, revisão do que o agente grava, login e configurações. O agente recebe o
// servidor MCP "retro-studio" (ponte em node + socket de controle do editor).
class RetroAiPanel : public VBoxContainer {
	GDCLASS(RetroAiPanel, VBoxContainer)

	enum Status {
		STATUS_IDLE,
		STATUS_STARTING,
		STATUS_READY,
		STATUS_BUSY,
		STATUS_ERROR,
	};

	struct Entry {
		String kind; // user, agent, thought, system, tool, diff, review.
		String text;
		String title; // Ferramenta.
		String status; // Ferramenta: pending, in_progress, completed, failed.
		String tool_id;
		String path; // diff/review.
		String preview;
		Array errors; // system: erros de compilação clicáveis.
		Vector<Ref<Image>> images; // user.
		String previous_content; // review: o que havia antes (Rejeitar volta a ele).
		String new_content;
		bool was_new_file = false;
		bool resolved = false; // review já aceita ou rejeitada.
		bool dirty = true;
		Control *root = nullptr;
		RichTextLabel *body = nullptr;
		Label *status_label = nullptr;
		Label *title_label = nullptr;
		ColorRect *dot = nullptr;
		HBoxContainer *review_actions = nullptr;
	};

	struct PendingImage {
		Ref<Image> image;
		String mime_type;
		String data; // base64.
		int bytes = 0;
	};

	// ---- estado (como os refs do componente Vue) ----
	Ref<RetroAcp> acp;
	Status status = STATUS_IDLE;
	bool replaying = false;
	String provider = "opencode";
	String agent_title;
	Dictionary agent_capabilities;
	Array auth_methods;
	Dictionary auth_status; // {hasCredentials, providers, loginCommand}; vazio = desconhecido.
	bool auth_error_hint = false;
	bool agent_install_required = false;
	String session_id;
	String pending_session_id;
	Array sessions;
	bool session_history_loading = false;
	String session_history_error;
	Array config_options;
	bool supports_images = false;
	bool show_details = false;
	bool onboarding_seen = true;
	bool chip_file = true;
	bool chip_build = true;
	bool chip_tilemap = true;
	bool chip_rom = false;
	// Permissões: fila (o agente pode pedir várias) e memória do "sempre" desta sessão.
	Dictionary permission;
	Vector<Dictionary> permission_queue;
	uint64_t permission_since = 0;
	bool answering_permission = false;
	HashMap<String, String> permission_memory; // chave -> allow/reject.
	// Contexto já enviado nesta sessão (cada nota e cada versão do arquivo seguem uma vez só).
	String sent_session;
	HashSet<String> sent_notes;
	HashMap<String, String> sent_files;
	Vector<PendingImage> pending_images;
	String image_error;
	LocalVector<Entry *> entries;
	HashMap<String, Entry *> tool_index;
	bool render_queued = false;
	bool stick_to_bottom = true;
	bool started_once = false;
	uint64_t last_chip_refresh = 0;
	float pulse = 0;
	// "claude auth status" demora (até 10 s): roda numa thread e o resultado chega no poll().
	Thread auth_thread;
	SafeFlag auth_done;
	SafeNumeric<int> auth_result; // -1 desconhecido, 0 sem login, 1 com login.
	static void _claude_auth_thread(void *p_self);
	void _apply_claude_auth();
	String queued_prompt; // Pedido feito antes de a sessão ficar pronta (Ctrl+K).

	// ---- interface ----
	PanelContainer *header = nullptr;
	PanelContainer *brand_mark = nullptr;
	Label *brand_title = nullptr;
	PanelContainer *status_dot = nullptr;
	Label *status_text = nullptr;
	OptionButton *provider_switch = nullptr;
	Button *new_button = nullptr;
	Button *details_button = nullptr;
	Button *restart_button = nullptr;
	Button *cancel_button = nullptr;
	Button *settings_button = nullptr;
	Button *close_button = nullptr;
	ProgressBar *progress = nullptr;
	PanelContainer *auth_banner = nullptr;
	Label *auth_message = nullptr;
	Button *auth_login_button = nullptr;
	PanelContainer *install_banner = nullptr;
	Label *install_title = nullptr;
	Label *install_command = nullptr;
	ScrollContainer *messages_scroll = nullptr;
	VBoxContainer *messages = nullptr;
	VBoxContainer *empty_state = nullptr;
	Button *onboarding_dismiss = nullptr;
	HBoxContainer *processing = nullptr;
	Label *processing_dots = nullptr;
	Label *processing_label = nullptr;
	Button *activity = nullptr;
	PanelContainer *permission_box = nullptr;
	Label *permission_kind = nullptr;
	Label *permission_tool = nullptr;
	Label *permission_paths = nullptr;
	HFlowContainer *permission_actions = nullptr;
	HFlowContainer *chips = nullptr;
	Button *chip_buttons[4] = {};
	HFlowContainer *pending_box = nullptr;
	Label *image_error_label = nullptr;
	Label *image_hint = nullptr;
	TextEdit *input = nullptr;
	Button *attach_button = nullptr;
	Button *history_button = nullptr;
	Button *session_select = nullptr;
	Button *mode_select = nullptr;
	Button *model_select = nullptr;
	Button *send_button = nullptr;
	PopupPanel *menu = nullptr; // Histórico, sessão, modo e modelo usam o mesmo popup.
	VBoxContainer *menu_box = nullptr;
	String open_menu;
	LineEdit *model_search = nullptr;
	VBoxContainer *model_list = nullptr;
	EditorFileDialog *image_dialog = nullptr;
	AcceptDialog *image_preview = nullptr;
	TextureRect *image_preview_rect = nullptr;
	ConfirmationDialog *settings_dialog = nullptr;
	OptionButton *settings_provider = nullptr;
	LineEdit *settings_path = nullptr;
	Label *settings_path_hint = nullptr;
	VBoxContainer *settings_auth = nullptr;
	Label *settings_auth_text = nullptr;
	Label *settings_provider_hint = nullptr;

	// ---- textos e formatos ----
	static String _provider_label(const String &p_provider);
	String _setting_key(const String &p_provider) const;
	String _install_command() const;
	String _login_command() const;
	String _status_label() const;
	static String _markdown(const String &p_text);
	static String _escape(const String &p_text);
	static bool _is_terminal_status(const String &p_status);
	String _tool_status_label(const String &p_status) const;
	static bool _looks_like_auth_error(const String &p_message);
	String _project_dir() const;
	String _project_dir_aberto() const;
	bool listing_alias = false; // Listando as sessões do caminho do link (depois das do caminho real).

	// ---- conversa ----
	Entry *_push_entry(const String &p_kind, const String &p_text = String());
	void _push_system(const String &p_text, const Array &p_errors = Array());
	void _append_chunk(const String &p_kind, const String &p_text);
	void _touch(Entry *p_entry);
	void _clear_entries();
	void _build_entry(Entry *p_entry);
	void _update_entry(Entry *p_entry);
	void _queue_render();
	void _flush_render();
	void _scroll_to_bottom();
	void _on_scroll(double p_value);
	void _update_visibility();
	void _update_header();
	void _update_composer();
	void _refresh_chips();

	// ---- sessão ----
	void _start_session(const String &p_mode = "new", const String &p_session = String());
	void _initialized(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session);
	void _open_on_client(const String &p_mode, const String &p_session);
	Array _mcp_servers();
	void _session_opened(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session);
	void _list_sessions(const String &p_cursor, const Array &p_found, int p_page);
	void _sessions_listed(const Variant &p_result, const Variant &p_error, const Array &p_found, int p_page);
	void _apply_session(const Dictionary &p_result);
	void _apply_config_options(const Variant &p_options);
	void _stop_session();
	void _shutdown_acp();
	void _restart();
	void _create_new_session();
	void _load_existing_session(const String &p_session);
	void _reopen(const String &p_mode, const String &p_session);
	void _session_closed(const Variant &p_result, const Variant &p_error, const String &p_mode, const String &p_session);
	void _finish_replay();
	void _switch_provider(int p_index);
	void _cancel();
	void _agent_exited();
	void _fail_start(const String &p_message, const String &p_mode);

	// ---- envio ----
	void _send();
	void _send_text(const String &p_text, bool p_from_input);
	void _prompt_done(const Variant &p_result, const Variant &p_error, const String &p_text, bool p_from_input, int p_image_count);
	Array _context_notes();
	bool _can_send() const;
	void _input_gui(const Ref<InputEvent> &p_event);

	// ---- agente → editor ----
	void _agent_message(const String &p_method, const Variant &p_params, const Variant &p_id);
	void _handle_update(const Dictionary &p_update);
	void _upsert_tool(const Dictionary &p_update);
	String _confined_path(const String &p_path) const;
	String _unsaved_buffer(const String &p_path) const;
	void _file_written(const String &p_path, const String &p_previous, const String &p_content, bool p_was_new);
	void _review_answer(bool p_accept, int p_entry);
	void _reload_file(const String &p_path, const String &p_content);
	void _sync_open_files();

	// ---- permissões ----
	String _permission_key(const Dictionary &p_tool_call) const;
	void _permission_request(const Dictionary &p_request);
	void _show_permission();
	void _next_permission();
	void _drop_permissions(bool p_cancel_pending);
	void _answer_permission(int p_option);
	void _expire_permission();

	// ---- login, instalação, configurações ----
	void _refresh_auth_status();
	void _run_auth_login();
	void _authenticated(const Variant &p_result, const Variant &p_error);
	void _copy_auth_command();
	void _copy_install_command();
	void _retry_install();
	void _open_settings();
	void _settings_provider_changed(int p_index);
	void _save_settings();
	void _update_settings_dialog();
	void _toggle_details();
	void _dismiss_onboarding();
	void _close_panel();

	// ---- menus ----
	void _open_menu(const String &p_which, Control *p_anchor);
	void _close_menu();
	void _fill_menu();
	void _fill_model_list(const String &p_query = String());
	void _history_pressed();
	void _session_pressed();
	void _mode_pressed();
	void _model_pressed();
	void _refresh_history();
	void _history_listed(const Variant &p_result, const Variant &p_error, const Array &p_found, int p_page);
	void _menu_session_chosen(const String &p_session);
	void _menu_config_chosen(const String &p_config, const String &p_value);
	void _config_set(const Variant &p_result, const Variant &p_error);
	Dictionary _config_option(const String &p_category) const;

	// ---- imagens ----
	void _attach_pressed();
	void _images_chosen(const PackedStringArray &p_paths);
	bool _add_image(const Ref<Image> &p_image, const String &p_mime, const Vector<uint8_t> &p_bytes);
	void _remove_image(int p_index);
	void _preview_image(const Ref<Image> &p_image);
	void _update_pending_images();
	void _chip_toggled(int p_chip);
	void _open_error(const Dictionary &p_error);
	void _open_path(const String &p_path);

protected:
	void _notification(int p_what);
	static void _bind_methods() {}

public:
	void poll();
	// Avisos do editor (como os eventos window do Retro Studio atual).
	void build_finished(const Dictionary &p_summary);
	void play_started();
	void focus_input(); // Ctrl+L.
	void queue_edit_selection(const String &p_instruction, const String &p_code, const String &p_path, int p_from_line, int p_to_line); // Ctrl+K.
	RetroAiPanel();
	~RetroAiPanel();
};
