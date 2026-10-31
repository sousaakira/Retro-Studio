#include "retro_clangd.h"

#include "core/io/dir_access.h"
#include "core/io/json.h"
#include "core/os/os.h"

String RetroClangd::path_to_uri(const String &p_path) {
	return "file://" + p_path.replace("%", "%25").replace(" ", "%20");
}

String RetroClangd::uri_to_path(const String &p_uri) {
	if (!p_uri.begins_with("file://")) {
		return String();
	}
	return p_uri.substr(7).uri_decode();
}

static void _collect_c_files(const String &p_dir, Array &r_files) {
	Ref<DirAccess> dir = DirAccess::open(p_dir);
	if (dir.is_null()) {
		return;
	}
	dir->list_dir_begin();
	for (String name = dir->get_next(); !name.is_empty(); name = dir->get_next()) {
		if (name.begins_with(".")) {
			continue;
		}
		const String full = p_dir.path_join(name);
		if (dir->current_is_dir()) {
			_collect_c_files(full, r_files);
		} else if (name.get_extension() == "c") {
			r_files.push_back(full);
		}
	}
	dir->list_dir_end();
}

Error RetroClangd::write_compile_commands(const String &p_project_dir, const String &p_out_dir, const String &p_gdk_dir) {
	// As mesmas opções do Retro Studio atual (electron/retro/compileFlags.js).
	Array flags;
	flags.push_back("-xc");
	flags.push_back("-std=c11");
	flags.push_back("-D__SGDK__");
	flags.push_back("-D__MEGA_DRIVE__");
	flags.push_back("-I" + p_project_dir.path_join("inc"));
	flags.push_back("-I" + p_project_dir.path_join("res"));
	flags.push_back("-I" + p_project_dir.path_join("src"));
	flags.push_back("-I" + p_project_dir);
	const String gdk_inc = p_gdk_dir.path_join("inc");
	if (DirAccess::exists(gdk_inc)) {
		flags.push_back("-I" + gdk_inc);
	}
	if (DirAccess::exists(p_gdk_dir.path_join("res"))) {
		flags.push_back("-I" + p_gdk_dir.path_join("res"));
	}

	Array files;
	_collect_c_files(p_project_dir.path_join("src"), files);
	Array commands;
	for (int i = 0; i < files.size(); i++) {
		Array arguments;
		arguments.push_back("clang");
		arguments.append_array(flags);
		arguments.push_back(files[i]);
		Dictionary entry;
		entry["directory"] = p_project_dir;
		entry["file"] = files[i];
		entry["arguments"] = arguments;
		commands.push_back(entry);
	}

	Error err = DirAccess::make_dir_recursive_absolute(p_out_dir);
	ERR_FAIL_COND_V(err != OK, err);
	Ref<FileAccess> file = FileAccess::open(p_out_dir.path_join("compile_commands.json"), FileAccess::WRITE, &err);
	ERR_FAIL_COND_V(file.is_null(), err);
	file->store_string(JSON::stringify(commands, "  ", false));
	return OK;
}

Error RetroClangd::start(const String &p_clangd, const String &p_project_dir, const String &p_compile_commands_dir) {
	if (running.is_set()) {
		return OK;
	}
	List<String> args;
	args.push_back("--compile-commands-dir=" + p_compile_commands_dir);
	args.push_back("--background-index=false");
	args.push_back("--clang-tidy=false");
	args.push_back("--header-insertion=never");
	args.push_back("--log=error");
	const Dictionary process = OS::get_singleton()->execute_with_pipe(p_clangd, args, true);
	stdio = process.get("stdio", Ref<FileAccess>());
	if (stdio.is_null()) {
		return ERR_CANT_CREATE;
	}
	stderr_pipe = process.get("stderr", Ref<FileAccess>());
	pid = process.get("pid", 0);
	running.set();
	initialized = false;
	reader.start(_read_thread, this);
	if (stderr_pipe.is_valid()) {
		stderr_reader.start(_drain_stderr, this);
	}

	Dictionary capabilities;
	Dictionary text_document;
	Dictionary completion;
	Dictionary completion_item;
	completion_item["snippetSupport"] = false;
	completion["completionItem"] = completion_item;
	text_document["completion"] = completion;
	text_document["definition"] = Dictionary();
	capabilities["textDocument"] = text_document;

	Dictionary params;
	params["processId"] = OS::get_singleton()->get_process_id();
	params["rootUri"] = path_to_uri(p_project_dir);
	params["capabilities"] = capabilities;

	initialize_id = next_id++;
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["id"] = initialize_id;
	message["method"] = "initialize";
	message["params"] = params;
	_write(message);
	return OK;
}

void RetroClangd::stop() {
	if (!running.is_set()) {
		return;
	}
	running.clear();
	if (pid) {
		OS::get_singleton()->kill(pid); // O fim do processo fecha o pipe e libera a thread de leitura.
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
	pending.clear();
	outbox.clear();
}

RetroClangd::~RetroClangd() {
	stop();
}

void RetroClangd::_write(const Dictionary &p_message) {
	if (stdio.is_null()) {
		return;
	}
	const CharString body = JSON::stringify(p_message, "", false).utf8();
	const CharString header = vformat("Content-Length: %d\r\n\r\n", body.length()).utf8();
	stdio->store_buffer((const uint8_t *)header.get_data(), header.length());
	stdio->store_buffer((const uint8_t *)body.get_data(), body.length());
}

void RetroClangd::_send(const Dictionary &p_message) {
	if (initialized) {
		_write(p_message);
	} else {
		outbox.push_back(p_message);
	}
}

int RetroClangd::request(const String &p_method, const Variant &p_params, const Callable &p_on_result) {
	const int id = next_id++;
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["id"] = id;
	message["method"] = p_method;
	message["params"] = p_params;
	pending[id] = p_on_result;
	_send(message);
	return id;
}

void RetroClangd::notify(const String &p_method, const Variant &p_params) {
	Dictionary message;
	message["jsonrpc"] = "2.0";
	message["method"] = p_method;
	message["params"] = p_params;
	_send(message);
}

void RetroClangd::_read_thread(void *p_self) {
	RetroClangd *self = static_cast<RetroClangd *>(p_self);
	Ref<FileAccess> pipe = self->stdio;
	while (self->running.is_set()) {
		// Cabeçalhos: linhas até uma linha vazia; só o Content-Length importa.
		int64_t length = -1;
		String line;
		bool eof = false;
		while (true) {
			uint8_t byte = 0;
			if (pipe->get_buffer(&byte, 1) != 1) {
				eof = true;
				break;
			}
			if (byte == '\n') {
				line = line.strip_edges();
				if (line.is_empty()) {
					break;
				}
				if (line.to_lower().begins_with("content-length:")) {
					length = line.get_slicec(':', 1).strip_edges().to_int();
				}
				line = String();
			} else {
				line += char32_t(byte);
			}
		}
		if (eof || length < 0) {
			break;
		}
		Vector<uint8_t> body;
		body.resize(length);
		int64_t got = 0;
		while (got < length) {
			const uint64_t count = pipe->get_buffer(body.ptrw() + got, length - got);
			if (count == 0) {
				eof = true;
				break;
			}
			got += count;
		}
		if (eof) {
			break;
		}
		JSON json;
		if (json.parse(String::utf8((const char *)body.ptr(), length)) != OK || json.get_data().get_type() != Variant::DICTIONARY) {
			continue;
		}
		MutexLock lock(self->inbox_mutex);
		self->inbox.push_back(json.get_data());
	}
	self->running.clear();
}

void RetroClangd::_drain_stderr(void *p_self) {
	RetroClangd *self = static_cast<RetroClangd *>(p_self);
	Ref<FileAccess> pipe = self->stderr_pipe;
	uint8_t buffer[4096];
	while (pipe->get_buffer(buffer, sizeof(buffer)) > 0) {
		// Descarta: com --log=error quase nada chega aqui.
	}
}

void RetroClangd::poll() {
	Vector<Dictionary> messages;
	{
		MutexLock lock(inbox_mutex);
		messages = inbox;
		inbox.clear();
	}
	for (const Dictionary &message : messages) {
		if (message.has("method")) {
			if (!message.has("id") && notification_handler.is_valid()) {
				notification_handler.call(message["method"], message.get("params", Variant()));
			}
			continue; // Pedidos do servidor (progresso etc.) não são respondidos.
		}
		if (!message.has("id")) {
			continue;
		}
		const int id = message["id"];
		if (id == initialize_id && !initialized) {
			initialized = true;
			Dictionary note;
			note["jsonrpc"] = "2.0";
			note["method"] = "initialized";
			note["params"] = Dictionary();
			_write(note);
			for (const Dictionary &queued : outbox) {
				_write(queued);
			}
			outbox.clear();
			continue;
		}
		if (!pending.has(id)) {
			continue;
		}
		const Callable callback = pending[id];
		pending.erase(id);
		if (callback.is_valid()) {
			callback.call(message.get("result", Variant()));
		}
	}
}
