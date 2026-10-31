#include "retro_acp.h"

#include "retro_env.h"

#include "core/io/json.h"
#include "core/os/os.h"

// O JSON do Godot lê todo número como float; o id volta ao agente como inteiro quando for inteiro
// (o codex-acp, em Rust, recusa "1.0" onde espera 1).
static Variant _json_id(const Variant &p_id) {
	if (p_id.get_type() == Variant::FLOAT && double(p_id) == Math::floor(double(p_id))) {
		return int64_t(double(p_id));
	}
	return p_id;
}

Error RetroAcp::start(const String &p_command, const Vector<String> &p_args, const String &p_cwd) {
	if (running.is_set()) {
		return OK;
	}
	// sh entra na pasta do projeto e troca de processo (exec) até o agente: o pid devolvido é o do
	// agente. O Godot já cria o processo como líder de uma sessão própria (setsid no fork), então o
	// grupo do pid reúne o agente e os filhos dele. (Um /usr/bin/setsid aqui faria um fork e o
	// agente escaparia do grupo: parar não o mataria e a leitura do pipe nunca terminaria.)
	List<String> args;
	args.push_back("-c");
	args.push_back("cd \"$0\" && exec \"$@\"");
	args.push_back(p_cwd);
	args.push_back("/usr/bin/env");
	args.push_back("PATH=" + retro_user_path());
	args.push_back("TERM=dumb");
	args.push_back(p_command);
	for (const String &arg : p_args) {
		args.push_back(arg);
	}
	const Dictionary process = OS::get_singleton()->execute_with_pipe("/bin/sh", args, true); // Pipes que bloqueiam: a thread espera os dados.
	stdio = process.get("stdio", Ref<FileAccess>());
	if (stdio.is_null()) {
		return ERR_CANT_CREATE;
	}
	stderr_pipe = process.get("stderr", Ref<FileAccess>());
	pid = process.get("pid", 0);
	{
		MutexLock lock(inbox_mutex);
		stderr_tail = String();
		inbox.clear();
	}
	running.set();
	reader.start(_read_thread, this);
	if (stderr_pipe.is_valid()) {
		stderr_reader.start(_drain_stderr, this);
	}
	return OK;
}

void RetroAcp::_signal_group(ProcessID p_pid, const char *p_signal) {
	List<String> args;
	args.push_back(p_signal);
	args.push_back("--");
	args.push_back("-" + itos(p_pid));
	OS::get_singleton()->execute("/bin/kill", args);
}

// Agentes encerrados cujas threads de leitura ainda não terminaram (o pipe fecha quando o último
// processo do grupo sai). Ficam aqui, sem travar a interface, até reap() recolher.
static Vector<Ref<RetroAcp>> retired;

void RetroAcp::reap() {
	for (int i = retired.size() - 1; i >= 0; i--) {
		Ref<RetroAcp> item = retired[i];
		if (item->reader_done.is_set() && (!item->stderr_reader.is_started() || item->stderr_done.is_set())) {
			item->_join();
			retired.remove_at(i);
		} else if (item->pid && OS::get_singleton()->get_ticks_msec() - item->stopped_at > 3000) {
			_signal_group(item->pid, "-KILL"); // Não saiu com TERM em 3 s.
			item->stopped_at = OS::get_singleton()->get_ticks_msec();
		}
	}
}

// Saída do editor: mata o que sobrou e espera as threads (o pipe fecha com o fim do grupo).
void RetroAcp::shutdown_all() {
	for (const Ref<RetroAcp> &item : retired) {
		if (item->pid) {
			_signal_group(item->pid, "-KILL");
		}
		// Até 2 s para o pipe fechar; se um processo fora do grupo ainda o segura, o objeto fica
		// sem liberar (a thread ainda o usa) e o editor fecha mesmo assim.
		const uint64_t limit = OS::get_singleton()->get_ticks_msec() + 2000;
		while (!(item->reader_done.is_set() && (!item->stderr_reader.is_started() || item->stderr_done.is_set())) && OS::get_singleton()->get_ticks_msec() < limit) {
			OS::get_singleton()->delay_usec(20000);
		}
		if (item->reader_done.is_set() && (!item->stderr_reader.is_started() || item->stderr_done.is_set())) {
			item->_join();
		} else {
			item->reference();
		}
	}
	retired.clear();
}

void RetroAcp::_join() {
	if (pid) {
		OS::get_singleton()->is_process_running(pid); // waitpid: recolhe o processo (sem zumbi).
	}
	if (reader.is_started()) {
		reader.wait_to_finish();
	}
	if (stderr_reader.is_started()) {
		stderr_reader.wait_to_finish();
	}
	stdio.unref();
	stderr_pipe.unref();
	pid = 0;
}

void RetroAcp::stop() {
	const bool was_running = running.is_set();
	running.clear();
	if (pid) {
		// O grupo inteiro (o agente e os filhos dele); o fim dos processos fecha os pipes e solta as threads.
		_signal_group(pid, "-TERM");
		stopped_at = OS::get_singleton()->get_ticks_msec();
	}
	// Sem esperar aqui: a interface não pode travar se o agente demorar a sair.
	if (reader.is_started() && !reader_done.is_set()) {
		retired.push_back(Ref<RetroAcp>(this));
	} else {
		_join();
	}
	// Quem esperava resposta recebe um erro (a conversa não fica presa em "pensando").
	if (was_running) {
		Dictionary error;
		error["message"] = String::utf8("O agente foi encerrado.");
		Vector<Callable> waiting;
		for (const KeyValue<int, Callable> &entry : pending) {
			waiting.push_back(entry.value);
		}
		pending.clear();
		for (const Callable &callback : waiting) {
			callback.call(Variant(), error);
		}
	}
}

RetroAcp::~RetroAcp() {
	// Só chega aqui com as threads terminadas (stop() deixa o objeto em retired até lá).
	message_handler = Callable();
	exit_handler = Callable();
	pending.clear();
	_join();
}

String RetroAcp::take_stderr() {
	MutexLock lock(inbox_mutex);
	const String text = stderr_new;
	stderr_new = String();
	return text;
}

String RetroAcp::get_stderr_tail() {
	MutexLock lock(inbox_mutex);
	return stderr_tail;
}

void RetroAcp::_write(const Dictionary &p_message) {
	if (stdio.is_null()) {
		return;
	}
	const CharString line = (JSON::stringify(p_message, "", false) + "\n").utf8();
	stdio->store_buffer((const uint8_t *)line.get_data(), line.length());
	stdio->flush();
}

int RetroAcp::request(const String &p_method, const Variant &p_params, const Callable &p_on_result) {
	const int id = next_id++;
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["id"] = id;
	message["method"] = p_method;
	message["params"] = p_params;
	pending[id] = p_on_result;
	_write(message);
	return id;
}

void RetroAcp::notify(const String &p_method, const Variant &p_params) {
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["method"] = p_method;
	message["params"] = p_params;
	_write(message);
}

void RetroAcp::respond(const Variant &p_id, const Variant &p_result) {
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["id"] = _json_id(p_id);
	message["result"] = p_result;
	_write(message);
}

void RetroAcp::respond_error(const Variant &p_id, int p_code, const String &p_message) {
	Dictionary error;
	error["code"] = p_code;
	error["message"] = p_message;
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["id"] = _json_id(p_id);
	message["error"] = error;
	_write(message);
}

void RetroAcp::_read_thread(void *p_self) {
	RetroAcp *self = static_cast<RetroAcp *>(p_self);
	Ref<FileAccess> pipe = self->stdio;
	Vector<uint8_t> line;
	uint8_t buffer[4096];
	while (true) {
		const uint64_t count = pipe->get_buffer(buffer, sizeof(buffer));
		if (count == 0) {
			break;
		}
		for (uint64_t i = 0; i < count; i++) {
			if (buffer[i] != '\n') {
				line.push_back(buffer[i]);
				continue;
			}
			const String text = String::utf8((const char *)line.ptr(), line.size()).strip_edges();
			line.clear();
			if (text.is_empty()) {
				continue;
			}
			JSON json;
			if (json.parse(text) != OK || json.get_data().get_type() != Variant::DICTIONARY) {
				continue; // Linha que não é JSON-RPC (log do agente no stdout): ignora.
			}
			MutexLock lock(self->inbox_mutex);
			self->inbox.push_back(json.get_data());
		}
	}
	Dictionary exit;
	exit["__exit"] = true;
	{
		MutexLock lock(self->inbox_mutex);
		self->inbox.push_back(exit);
	}
	self->reader_done.set();
}

void RetroAcp::_drain_stderr(void *p_self) {
	RetroAcp *self = static_cast<RetroAcp *>(p_self);
	Ref<FileAccess> pipe = self->stderr_pipe;
	uint8_t buffer[4096];
	while (true) {
		const uint64_t count = pipe->get_buffer(buffer, sizeof(buffer));
		if (count == 0) {
			break;
		}
		MutexLock lock(self->inbox_mutex);
		const String text = String::utf8((const char *)buffer, count);
		self->stderr_tail += text;
		self->stderr_new += text;
		if (self->stderr_new.length() > 8000) {
			self->stderr_new = self->stderr_new.right(8000);
		}
		if (self->stderr_tail.length() > 4000) {
			self->stderr_tail = self->stderr_tail.right(4000);
		}
	}
	self->stderr_done.set();
}

void RetroAcp::poll() {
	Vector<Variant> messages;
	{
		MutexLock lock(inbox_mutex);
		messages = inbox;
		inbox.clear();
	}
	for (const Variant &item : messages) {
		const Dictionary message = item;
		if (message.has("__exit")) {
			const bool expected = !running.is_set();
			running.clear();
			if (!expected && exit_handler.is_valid()) {
				exit_handler.call();
			}
			continue;
		}
		const bool is_response = message.has("id") && !message.has("method") && (message.has("result") || message.has("error"));
		if (is_response) {
			const int id = int(message["id"]);
			if (pending.has(id)) {
				const Callable callback = pending[id];
				pending.erase(id);
				callback.call(message.get("result", Variant()), message.get("error", Variant()));
			}
			continue;
		}
		if (message.has("method") && message_handler.is_valid()) {
			message_handler.call(message["method"], message.get("params", Dictionary()), message.get("id", Variant()));
		}
	}
}
