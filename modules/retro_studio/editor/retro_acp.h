#pragma once

#include "core/io/file_access.h"
#include "core/object/ref_counted.h"
#include "core/os/mutex.h"
#include "core/os/process_id.h"
#include "core/os/thread.h"
#include "core/templates/hash_map.h"
#include "core/templates/safe_refcount.h"
#include "core/variant/callable.h"

// Cliente ACP (Agent Client Protocol v1) para agentes externos — Claude (claude-agent-acp), Codex
// (codex-acp), OpenCode (opencode acp) —, como o electron/ai/acp/AcpClient.js do Retro Studio atual:
// JSON-RPC 2.0, uma mensagem por linha no stdin/stdout do agente. A leitura roda numa thread e as
// mensagens chegam à thread principal pelo poll().
class RetroAcp : public RefCounted {
	GDCLASS(RetroAcp, RefCounted)

	Ref<FileAccess> stdio;
	Ref<FileAccess> stderr_pipe;
	ProcessID pid = 0;
	Thread reader;
	Thread stderr_reader;
	SafeFlag running;
	SafeFlag reader_done;
	SafeFlag stderr_done;
	uint64_t stopped_at = 0;
	static void _signal_group(ProcessID p_pid, const char *p_signal);
	void _join();
	Mutex inbox_mutex;
	Vector<Variant> inbox; // Mensagens lidas; um Dictionary {"__exit": true} avisa o fim do processo.
	String stderr_tail; // Últimas linhas do stderr (protegido por inbox_mutex), para explicar falhas.
	String stderr_new; // stderr ainda não entregue por take_stderr().
	int next_id = 1;
	HashMap<int, Callable> pending; // id -> Callable(result, error).
	Callable message_handler; // (método, params, id) das notificações e pedidos do agente.
	Callable exit_handler;

	static void _read_thread(void *p_self);
	static void _drain_stderr(void *p_self);
	void _write(const Dictionary &p_message);

public:
	// Inicia o agente em p_cwd, com o PATH do usuário e num grupo de processos próprio (o Codex e o
	// Claude abrem filhos; parar encerra o grupo inteiro).
	Error start(const String &p_command, const Vector<String> &p_args, const String &p_cwd);
	void stop();
	bool is_running() const { return running.is_set(); }
	String get_stderr_tail();
	String take_stderr(); // O que chegou no stderr desde a última chamada (detecta erro de login).

	// p_on_result recebe (result, error): error é o Dictionary de erro do JSON-RPC ou null.
	int request(const String &p_method, const Variant &p_params, const Callable &p_on_result);
	void notify(const String &p_method, const Variant &p_params);
	void respond(const Variant &p_id, const Variant &p_result);
	void respond_error(const Variant &p_id, int p_code, const String &p_message);

	void set_message_handler(const Callable &p_handler) { message_handler = p_handler; }
	void set_exit_handler(const Callable &p_handler) { exit_handler = p_handler; }
	void poll();
	// Recolhe agentes encerrados cujas threads já terminaram (chamar a cada quadro).
	static void reap();
	static void shutdown_all();
	~RetroAcp();
};
