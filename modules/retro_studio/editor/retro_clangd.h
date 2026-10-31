#pragma once

#include "core/io/file_access.h"
#include "core/object/ref_counted.h"
#include "core/os/mutex.h"
#include "core/os/process_id.h"
#include "core/os/thread.h"
#include "core/templates/hash_map.h"
#include "core/templates/safe_refcount.h"
#include "core/variant/callable.h"

// Cliente LSP mínimo para o clangd: inicia o processo, troca mensagens JSON-RPC pelo stdin/stdout e
// entrega as respostas na thread principal (poll). A lista de compilação é gerada no cache do editor
// (.retrostudio/editor-cache/clangd/compile_commands.json), sem mexer nos arquivos do projeto.
class RetroClangd : public RefCounted {
	GDCLASS(RetroClangd, RefCounted)

	Ref<FileAccess> stdio;
	Ref<FileAccess> stderr_pipe;
	ProcessID pid = 0;
	Thread reader;
	Thread stderr_reader; // Só esvazia o stderr, para o clangd nunca travar com o pipe cheio.
	Callable notification_handler;
	SafeFlag running;
	Mutex inbox_mutex;
	Vector<Dictionary> inbox;

	bool initialized = false;
	Vector<Dictionary> outbox; // Mensagens que esperam a resposta do initialize.
	int next_id = 1;
	int initialize_id = 0;
	HashMap<int, Callable> pending;

	static void _read_thread(void *p_self);
	static void _drain_stderr(void *p_self);
	void _write(const Dictionary &p_message);
	void _send(const Dictionary &p_message);

public:
	static String path_to_uri(const String &p_path);
	static String uri_to_path(const String &p_uri);
	// Gera compile_commands.json (todos os .c de src/) com as opções do SGDK/MarsDev.
	static Error write_compile_commands(const String &p_project_dir, const String &p_out_dir, const String &p_gdk_dir);

	Error start(const String &p_clangd, const String &p_project_dir, const String &p_compile_commands_dir);
	void stop();
	bool is_running() const { return running.is_set(); }

	// p_on_result recebe o campo "result" da resposta (ou null em caso de erro).
	int request(const String &p_method, const Variant &p_params, const Callable &p_on_result);
	void notify(const String &p_method, const Variant &p_params);
	// Recebe (método, params) das notificações do servidor, como textDocument/publishDiagnostics.
	void set_notification_handler(const Callable &p_handler) { notification_handler = p_handler; }
	void poll();

	~RetroClangd();
};
