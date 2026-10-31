#include "retro_env.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/os/mutex.h"
#include "core/os/os.h"
#include "core/templates/hash_set.h"

// Aberto pelo menu do sistema, o editor não herda o PATH do terminal: o que o asdf, o nvm, o mise
// ou o npm global acrescentam no .zshrc/.bashrc fica de fora e o make não acha o node. Como o
// Retro Studio atual (electron/shellPath.js): pergunta o PATH ao shell de login interativo do
// usuário (até 5 s) e junta as pastas conhecidas, sem repetir e sem pastas inexistentes.
String retro_user_path() {
	// Lido na primeira vez (compilação na thread de build ou agente de IA na principal).
	static Mutex mutex;
	MutexLock lock(mutex);
	static String cached;
	if (!cached.is_empty()) {
		return cached;
	}
	const String mark = "__RETRO_STUDIO_PATH__";
	String shell_path;
	const String shell = OS::get_singleton()->has_environment("SHELL") ? OS::get_singleton()->get_environment("SHELL") : String("/bin/bash");
	if (FileAccess::exists("/usr/bin/timeout") && FileAccess::exists(shell)) {
		List<String> args;
		args.push_back("TERM=dumb");
		args.push_back("/usr/bin/timeout");
		args.push_back("5");
		args.push_back(shell);
		args.push_back("-ilc");
		args.push_back(shell.get_file() == "fish" ? "printf '%s' " + mark + "; string join : $PATH; printf '%s' " + mark : "printf '%s%s%s' " + mark + " \"$PATH\" " + mark);
		String output;
		OS::get_singleton()->execute("/usr/bin/env", args, &output);
		const Vector<String> parts = output.split(mark);
		if (parts.size() >= 3) {
			shell_path = parts[1].strip_edges();
		}
	}
	const String user_home = OS::get_singleton()->get_environment("HOME");
	Vector<String> known;
	known.push_back(user_home.path_join(".asdf/shims"));
	known.push_back(user_home.path_join(".local/share/mise/shims"));
	known.push_back(user_home.path_join(".volta/bin"));
	known.push_back(user_home.path_join(".npm-global/bin"));
	known.push_back(user_home.path_join(".local/bin"));
	known.push_back(user_home.path_join(".bun/bin"));
	known.push_back("/usr/local/bin");
	// nvm: a versão mais nova instalada.
	Ref<DirAccess> nvm = DirAccess::open(user_home.path_join(".nvm/versions/node"));
	if (nvm.is_valid()) {
		PackedStringArray versions = nvm->get_directories();
		if (!versions.is_empty()) {
			versions.sort_custom<FileNoCaseComparator>();
			known.push_back(user_home.path_join(".nvm/versions/node").path_join(versions[versions.size() - 1]).path_join("bin"));
		}
	}
	HashSet<String> seen;
	Vector<String> merged;
	const String lists = OS::get_singleton()->get_environment("PATH") + ":" + shell_path + ":" + String(":").join(known);
	for (const String &dir : lists.split(":", false)) {
		const String clean = dir.strip_edges();
		if (!clean.is_empty() && !seen.has(clean) && DirAccess::exists(clean)) {
			seen.insert(clean);
			merged.push_back(clean);
		}
	}
	cached = String(":").join(merged);
	return cached;
}

String retro_find_executable(const String &p_name) {
	if (p_name.is_absolute_path()) {
		return FileAccess::exists(p_name) ? p_name : String();
	}
	for (const String &dir : retro_user_path().split(":", false)) {
		const String candidate = dir.path_join(p_name);
		if (FileAccess::exists(candidate)) {
			return candidate;
		}
	}
	return String();
}
