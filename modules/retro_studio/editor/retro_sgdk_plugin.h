#pragma once

// Compilar e rodar: o jogo é compilado pelo make do projeto com o SGDK do MarsDev e aberto no
// emulador. A saída aparece no painel "SGDK", com os erros do gcc levando ao arquivo e à linha.

#include "core/os/mutex.h"
#include "core/os/os.h"
#include "core/os/thread.h"
#include "core/templates/safe_refcount.h"
#include "editor/plugins/editor_plugin.h"

class Button;
class RichTextLabel;
class VBoxContainer;

class RetroSgdkPlugin : public EditorPlugin {
	GDCLASS(RetroSgdkPlugin, EditorPlugin);

	Button *build_button = nullptr;
	Button *run_button = nullptr;
	VBoxContainer *panel = nullptr;
	RichTextLabel *output = nullptr;

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
	ProcessID emulator_pid = 0;

	static void _build_thread(void *p_self);
	String _rom_path() const;
	void _append(const String &p_text, const Color &p_color = Color(0, 0, 0, 0));
	void _append_output(const String &p_text);
	String _diagnostic_target(const String &p_line, String &r_kind) const;
	void _open_diagnostic(const Variant &p_meta);
	void _start_build(bool p_run_after);
	void _finish_build();
	void _run_rom();
	void _create_scene_code();
	void _update_icons();

protected:
	void _notification(int p_what);

public:
	virtual String get_plugin_name() const override { return "RetroSgdk"; }

	RetroSgdkPlugin();
	~RetroSgdkPlugin();
};
