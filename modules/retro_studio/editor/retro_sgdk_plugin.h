#pragma once

// Compilar e rodar: o jogo é compilado pelo make do projeto com o SGDK do MarsDev e aberto no
// emulador. A saída aparece no painel "SGDK", com os erros do gcc levando ao arquivo e à linha.

#include "core/io/file_access.h"
#include "core/os/mutex.h"
#include "core/os/os.h"
#include "core/os/thread.h"
#include "core/templates/hash_set.h"
#include "core/templates/safe_refcount.h"
#include "editor/plugins/editor_plugin.h"

class Button;
class HBoxContainer;
class Label;
class ProgressBar;
class RetroReleaseDialog;
class RichTextLabel;
class VBoxContainer;

class RetroSgdkPlugin : public EditorPlugin {
	GDCLASS(RetroSgdkPlugin, EditorPlugin);

	Button *build_button = nullptr;
	Button *run_button = nullptr;
	Button *release_button = nullptr;
	RetroReleaseDialog *release_dialog = nullptr;
	// Versão para teste em andamento: o rascunho que o build limpo de release completa.
	Dictionary release_draft;
	bool clean_build = false;
	VBoxContainer *panel = nullptr;
	RichTextLabel *output = nullptr;

	// Andamento do build na barra de cima: o botão usado (compilar ou rodar) gira enquanto o build roda
	// e, clicado de novo, para o build; ao lado, a etapa e uma barra. No fim, o resultado fica uns segundos.
	HBoxContainer *progress_box = nullptr;
	Label *progress_label = nullptr;
	ProgressBar *progress_bar = nullptr;
	Button *busy_button = nullptr;
	int busy_frame = 0;
	double busy_time = 0;
	int progress_total = 1; // Passos de compilação esperados (fontes .c/.s e recursos .res do projeto).
	int progress_done = 0;
	uint64_t progress_hide_msec = 0; // Quando esconder o resultado (0 = não esconder).
	bool build_canceled = false;
	bool start_pending = false;
	// Linha de comando (testes e CI): retro-studio --headless --editor --path <projeto> -- --retro-build
	// (gera as cenas e compila; sai com 0 se a ROM ficou pronta) ou -- --retro-export (só gera as cenas).
	int cli_mode = 0; // 0 = nenhum, 1 = só gerar, 2 = gerar e compilar.
	int cli_idle_frames = 0;
	bool cli_started = false;
	void _cli_tick();
	void _cli_quit(bool p_ok); // Clique recebido: a barra aparece antes de as cenas serem geradas.
	void _deferred_start(bool p_run);
	int _count_build_steps() const;
	void _progress_line(const String &p_line);
	void _progress_set(double p_value, const String &p_text);
	void _progress_end(bool p_ok, const String &p_text);
	void _button_pressed(bool p_run);
	void _stop_build();

	Thread build_thread;
	SafeFlag building;
	Mutex pipe_mutex;
	String pipe; // Saída do make ainda não mostrada (escrita pela thread do build).
	String project_dir;
	PackedStringArray usage; // Uso de VRAM das cenas no último build.
	String gdk;
	int exit_code = 0;
	bool run_after_build = false;
	int error_count = 0;
	int warning_count = 0;
	String first_problem;
	// Erros do ld ("undefined reference to `x'"): a função da linha "in function" anterior e os já contados.
	String link_function;
	HashSet<String> link_errors;
	String _link_target(const String &p_function, const String &p_symbol) const;
	ProcessID emulator_pid = 0;
	// Relatório do último build, para a IA (servidor MCP): resultado, problemas e o fim do log.
	Dictionary report;
	PackedStringArray report_problems;
	Array report_errors; // {file, line, column, message, type}, para o painel IA (erros clicáveis).
	SafeNumeric<int64_t> build_pid;
	String report_log;
	static RetroSgdkPlugin *singleton;
	void _report_finish(bool p_ok, const String &p_reason);

	static void _build_thread(void *p_self);
	// Roda um programa e manda a saída (stdout e stderr) ao painel até ele terminar; devolve o código
	// de saída (-1 se não abriu). r_pid recebe o pid enquanto o processo roda.
	static int _stream_process(RetroSgdkPlugin *p_self, const String &p_path, const List<String> &p_args, SafeNumeric<int64_t> *r_pid);
	static void _read_pipe(RetroSgdkPlugin *p_self, const Ref<FileAccess> &p_pipe);
	static void _read_stderr_thread(void *p_data);

	// Ambiente (kit SGDK, Java, make, emulador): conferido numa thread ao abrir o editor, quando o build
	// ou o emulador acusam falta de algo e depois de reparar. Com problema, uma faixa no topo do painel
	// SGDK diz o que falta e oferece o Reparar (roda o instalar.sh --reparar da instalação).
	HBoxContainer *env_bar = nullptr;
	Label *env_label = nullptr;
	Button *env_repair = nullptr;
	Thread env_thread;
	SafeFlag env_checking;
	Mutex env_mutex;
	String env_gdk;
	String env_emulator;
	Vector<String> env_problems;
	Vector<String> env_deps;
	bool env_announce = false;
	Thread repair_thread;
	SafeFlag repairing;
	int repair_exit = 0;
	static void _env_thread(void *p_self);
	static void _repair_thread(void *p_self);
	void _check_environment(bool p_announce);
	void _environment_checked();
	void _show_environment(bool p_open_panel);
	void _start_repair();
	String _repair_hint(const Vector<String> &p_dependencies) const;
	String _rom_path() const;
	void _append(const String &p_text, const Color &p_color = Color(0, 0, 0, 0));
	void _append_output(const String &p_text);
	String _diagnostic_target(const String &p_line, String &r_kind) const;
	void _open_diagnostic(const Variant &p_meta);
	void _start_build(bool p_run_after);
	void _open_releases();
	void _finish_build();
	void _run_rom();
	void _create_scene_code();
	void _create_actor_code(); // Cria (ou abre) o .c do MDAtor selecionado.
	void _update_collision_types(); // Põe o TileSet com todos os tipos prontos nas MDColisao da cena.
	void _update_icons();

protected:
	void _notification(int p_what);

public:
	virtual String get_plugin_name() const override { return "RetroSgdk"; }

	static RetroSgdkPlugin *get_singleton() { return singleton; }
	// Começa o build (e, com p_run, abre o emulador no fim). Falso se já há um build ou se ele parou
	// antes do make (o motivo fica no relatório).
	bool start_build_for_ai(bool p_run);
	// Versão para teste: confere o pedido, grava o header da versão e começa o build limpo. A versão
	// sai no relatório do build ("versao"). Falso com r_error se não começou.
	bool start_release(const Dictionary &p_request, String &r_error);
	bool is_building() const { return building.is_set() || build_thread.is_started(); }
	Dictionary get_report() const;
	ProcessID get_emulator_pid() const { return emulator_pid; }
	// Resumo do último build no formato do painel IA (summarizeBuild do Retro Studio em Electron).
	Dictionary get_summary() const;
	void stop_all(); // Interrompe o build e fecha o emulador (/stop do painel IA).
	void open_problem(const Dictionary &p_problem); // Abre o arquivo do erro na linha.

	RetroSgdkPlugin();
	~RetroSgdkPlugin();
};
