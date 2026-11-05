#include "retro_git.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/os/os.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

// Variáveis de ambiente trocadas só durante um comando de rede e devolvidas depois.
struct EnvOverride {
	String name;
	bool had = false;
	String old;

	EnvOverride(const String &p_name, const String &p_value) :
			name(p_name) {
		OS *os = OS::get_singleton();
		had = os->has_environment(name);
		old = had ? os->get_environment(name) : String();
		os->set_environment(name, p_value);
	}
	~EnvOverride() {
		if (had) {
			OS::get_singleton()->set_environment(name, old);
		} else {
			OS::get_singleton()->unset_environment(name);
		}
	}
};

EditorVCSInterface::ChangeType change_of(char32_t p_code) {
	switch (p_code) {
		case 'A':
		case 'C':
		case '?':
			return EditorVCSInterface::CHANGE_TYPE_NEW;
		case 'D':
			return EditorVCSInterface::CHANGE_TYPE_DELETED;
		case 'R':
			return EditorVCSInterface::CHANGE_TYPE_RENAMED;
		case 'T':
			return EditorVCSInterface::CHANGE_TYPE_TYPECHANGE;
		case 'U':
			return EditorVCSInterface::CHANGE_TYPE_UNMERGED;
		default:
			return EditorVCSInterface::CHANGE_TYPE_MODIFIED;
	}
}

// "@@ -a,b +c,d @@": sem a contagem, vale 1.
bool parse_range(const String &p_text, int &r_start, int &r_count) {
	const int comma = p_text.find_char(',');
	if (comma < 0) {
		r_start = p_text.to_int();
		r_count = 1;
	} else {
		r_start = p_text.substr(0, comma).to_int();
		r_count = p_text.substr(comma + 1).to_int();
	}
	return true;
}

String strip_side(const String &p_path) {
	if (p_path.begins_with("a/") || p_path.begins_with("b/")) {
		return p_path.substr(2);
	}
	return p_path;
}

// Caminho do git status a partir de r_pos: cru até " -> " ou o fim, ou entre aspas no estilo C
// ("a b.txt", "x\\"y"; \ooo em octal são bytes UTF-8). r_pos termina logo depois do caminho.
String unquote(const String &p_line, int &r_pos) {
	if (r_pos >= p_line.length() || p_line[r_pos] != '"') {
		const int arrow = p_line.find(" -> ", r_pos);
		const int end = arrow >= 0 ? arrow : p_line.length();
		const String path = p_line.substr(r_pos, end - r_pos);
		r_pos = end;
		return path;
	}
	LocalVector<char> bytes;
	int i = r_pos + 1;
	while (i < p_line.length() && p_line[i] != '"') {
		char32_t c = p_line[i];
		if (c == '\\' && i + 1 < p_line.length()) {
			const char32_t n = p_line[i + 1];
			if (n >= '0' && n <= '7' && i + 3 < p_line.length()) {
				const int value = (p_line[i + 1] - '0') * 64 + (p_line[i + 2] - '0') * 8 + (p_line[i + 3] - '0');
				bytes.push_back(char(value));
				i += 4;
				continue;
			}
			const char escaped = n == 'n' ? '\n' : n == 't' ? '\t' : n == 'a' ? '\a' : n == 'b' ? '\b' : n == 'f' ? '\f' : n == 'v' ? '\v' : n == 'r' ? '\r' : char(n);
			bytes.push_back(escaped);
			i += 2;
			continue;
		}
		const CharString utf8 = String::chr(c).utf8();
		for (int k = 0; k < utf8.length(); k++) {
			bytes.push_back(utf8[k]);
		}
		i++;
	}
	r_pos = MIN(i + 1, p_line.length());
	return bytes.is_empty() ? String() : String::utf8(bytes.ptr(), bytes.size());
}

#ifdef WINDOWS_ENABLED
// Regras do CommandLineToArgvW: cada aspa vira \" (e as barras logo antes dela dobram); se o
// OS::execute for envolver o argumento em aspas, as barras do fim também dobram.
String windows_escape(const String &p_arg) {
	static const char32_t wraps[] = U" &()[]{}^=;!'+,`~";
	bool wrapped = false;
	for (int i = 0; i < p_arg.length() && !wrapped; i++) {
		for (int k = 0; wraps[k]; k++) {
			if (p_arg[i] == wraps[k]) {
				wrapped = true;
				break;
			}
		}
	}
	if (!p_arg.contains("\"") && !(wrapped && p_arg.ends_with("\\"))) {
		return p_arg;
	}
	String out;
	int slashes = 0;
	for (int i = 0; i < p_arg.length(); i++) {
		const char32_t c = p_arg[i];
		if (c == '\\') {
			slashes++;
			continue;
		}
		if (c == '"') {
			out += String("\\").repeat(slashes * 2 + 1) + "\"";
		} else {
			out += String("\\").repeat(slashes) + String::chr(c);
		}
		slashes = 0;
	}
	out += String("\\").repeat(wrapped ? slashes * 2 : slashes);
	return out;
}
#endif

} // namespace

RetroGit::Result RetroGit::_run(const Vector<String> &p_args, bool p_stderr, bool p_network) const {
	List<String> args;
	args.push_back("-C");
	args.push_back(project_dir);
	// Caminhos não viram curinga. Os nomes de arquivo do status ficam com core.quotepath padrão
	// (acentos em octal, só ASCII): no Windows o Godot lê a saída na página de código do sistema.
	args.push_back("--literal-pathspecs");

	// Rede: nunca esperar senha num terminal que não existe; o erro aparece no painel.
	LocalVector<EnvOverride *> env;
	if (p_network) {
		env.push_back(memnew(EnvOverride("GIT_TERMINAL_PROMPT", "0")));
		if (!password.is_empty()) {
			// Ajudante de credenciais da sessão: lê usuário/senha do ambiente deste comando
			// (a senha nunca vai na linha de comando nem para arquivo).
			env.push_back(memnew(EnvOverride("RETRO_GIT_USERNAME", username)));
			env.push_back(memnew(EnvOverride("RETRO_GIT_PASSWORD", password)));
			args.push_back("-c");
			args.push_back("credential.helper=");
			args.push_back("-c");
			args.push_back("credential.helper=!f() { echo \"username=$RETRO_GIT_USERNAME\"; echo \"password=$RETRO_GIT_PASSWORD\"; }; f");
		}
		String ssh = "ssh -o BatchMode=yes";
		if (!ssh_private_key.is_empty()) {
			ssh += " -o IdentitiesOnly=yes -i \"" + ssh_private_key.replace("\\", "/") + "\"";
		}
		if (!OS::get_singleton()->has_environment("GIT_SSH_COMMAND") || !ssh_private_key.is_empty()) {
			env.push_back(memnew(EnvOverride("GIT_SSH_COMMAND", ssh)));
		}
	}

	for (const String &arg : p_args) {
		args.push_back(arg);
	}
#ifdef WINDOWS_ENABLED
	// O OS::execute do Windows põe aspas nos argumentos com espaço, mas não escapa as aspas de dentro.
	for (String &arg : args) {
		arg = windows_escape(arg);
	}
#endif
	Result result;
	const Error err = OS::get_singleton()->execute("git", args, &result.output, &result.code, p_stderr);
	result.ok = err == OK && result.code == 0;
	if (err != OK) {
		result.code = -1;
	}

	for (int i = int(env.size()) - 1; i >= 0; i--) {
		memdelete(env[i]);
	}
	return result;
}

String RetroGit::_capture(const Vector<String> &p_args) const {
	// A saída com texto livre (diff, histórico) vai para um arquivo lido em UTF-8: pelo cano, o
	// Windows a decodificaria na página de código do sistema e estragaria os acentos.
	const String path = OS::get_singleton()->get_temp_path().path_join(vformat("retro-git-%d.txt", OS::get_singleton()->get_process_id()));
	Vector<String> args = { "-c", "core.quotepath=false" };
	for (int i = 0; i < p_args.size(); i++) {
		args.push_back(p_args[i]);
		if (i == 0) {
			args.push_back("--output=" + path);
		}
	}
	String text;
	if (_run(args).ok) {
		text = FileAccess::get_file_as_string(path);
	}
	DirAccess::remove_absolute(path);
	return text;
}

bool RetroGit::_run_or_warn(const Vector<String> &p_args, bool p_network) {
	const Result result = _run(p_args, true, p_network);
	if (!result.ok) {
		String message = result.output.strip_edges();
		if (message.is_empty()) {
			message = U("O comando git ") + p_args[0] + U(" falhou.");
		}
		// Os erros mais comuns ganham uma explicação antes da mensagem do Git (que vem no idioma dele).
		String hint;
		if (message.contains("[rejected]") || message.contains("non-fast-forward") || message.contains("fetch first")) {
			hint = U("O remoto tem commits que este projeto ainda não tem. Use Puxar (↓) e depois envie de novo.");
		} else if (message.contains("Please tell me who you are") || message.contains("user.email")) {
			hint = U("O Git ainda não sabe o seu nome e e-mail. Num terminal, rode:\n  git config --global user.name \"Seu Nome\"\n  git config --global user.email \"voce@exemplo.com\"");
		} else if (message.contains("Authentication failed") || message.contains("could not read Username") || message.contains("terminal prompts disabled") || message.contains("Permission denied (publickey")) {
			hint = U("O remoto pediu login. Configure o acesso no Git do computador (gerenciador de credenciais ou chave SSH) ou preencha usuário e senha/token em Projeto → Controle de Versão → Configurações.");
		} else if (message.contains("CONFLICT") || message.contains("Merge conflict")) {
			hint = U("Há conflitos: os arquivos em conflito precisam ser acertados à mão antes do commit.");
		} else if (message.contains("would be overwritten")) {
			hint = U("Há alterações sem commit que seriam perdidas. Faça o commit (ou descarte) antes.");
		} else if (message.contains("not fully merged")) {
			hint = U("Este ramo tem commits que não estão em nenhum outro; por segurança ele não foi apagado.");
		}
		popup_error(hint.is_empty() ? message : hint + "\n\n" + message);
	}
	return result.ok;
}

bool RetroGit::_has_head() const {
	return _run({ "rev-parse", "--verify", "-q", "HEAD" }).ok;
}

String RetroGit::_relative(const String &p_repo_path) const {
	if (prefix.is_empty()) {
		return p_repo_path;
	}
	return p_repo_path.begins_with(prefix) ? p_repo_path.substr(prefix.length()) : String();
}

bool RetroGit::initialize(const String &p_project_path) {
	project_dir = p_project_path.simplify_path();
	if (project_dir.ends_with("/") && project_dir.length() > 1) {
		project_dir = project_dir.substr(0, project_dir.length() - 1);
	}

	const Result version = _run({ "--version" });
	if (version.code < 0) {
		popup_error(U("O Git não foi encontrado neste computador.\n\nInstale o Git (no Windows: https://git-scm.com/download/win; no Linux: pelo gerenciador de pacotes) e abra o painel de novo."));
		return false;
	}

	if (!_run({ "rev-parse", "--show-toplevel" }).ok) {
		// Projeto ainda fora do Git: o usuário ligou o controle de versão, então cria o repositório.
		if (!_run_or_warn({ "-c", "init.defaultBranch=main", "init", "-q" })) {
			return false;
		}
		if (!FileAccess::exists(project_dir.path_join(".gitignore"))) {
			String dir = project_dir;
			EditorVCSInterface::create_vcs_metadata_files(EditorVCSInterface::VCSMetadata::GIT, dir);
		}
	}
	// Caminho do projeto dentro do repositório, achado subindo até o .git (sem passar o nome da
	// pasta pela saída do git, que no Windows perderia os acentos).
	prefix = String();
	String dir = project_dir;
	for (int i = 0; i < 64; i++) {
		const String git = dir.path_join(".git");
		if (DirAccess::exists(git) || FileAccess::exists(git)) {
			if (dir != project_dir) {
				prefix = project_dir.substr(dir.length()).trim_prefix("/") + "/";
			}
			break;
		}
		const String parent = dir.get_base_dir();
		if (parent.is_empty() || parent == dir) {
			break;
		}
		dir = parent;
	}
	return true;
}

void RetroGit::set_credentials(const String &p_username, const String &p_password, const String &p_ssh_public_key_path, const String &p_ssh_private_key_path, const String &p_ssh_passphrase) {
	username = p_username.strip_edges();
	password = p_password;
	ssh_private_key = p_ssh_private_key_path.strip_edges();
}

List<EditorVCSInterface::StatusFile> RetroGit::get_modified_files_data() {
	List<StatusFile> files;
	// Sem -z: o Godot lê a saída como texto e troca o separador nulo. Os caminhos com aspas,
	// barra ou espaço vêm entre aspas no estilo C (os acentos ficam crus com core.quotepath=false).
	const Result result = _run({ "status", "--porcelain=v1", "-uall", "--", "." });
	if (!result.ok) {
		return files;
	}
	for (const String &raw : result.output.split("\n", false)) {
		const String entry = raw.trim_suffix("\r");
		if (entry.length() < 4) {
			continue;
		}
		const char32_t x = entry[0];
		const char32_t y = entry[1];
		int end = 3;
		String path = unquote(entry, end);
		if ((x == 'R' || x == 'C') && entry.substr(end).begins_with(" -> ")) {
			end += 4;
			path = unquote(entry, end); // "antigo -> novo": vale o novo.
		}
		path = _relative(path);
		if (path.is_empty() || x == '!') {
			continue;
		}
		StatusFile file;
		file.file_path = path;
		if (x == '?') {
			file.area = TREE_AREA_UNSTAGED;
			file.change_type = CHANGE_TYPE_NEW;
			files.push_back(file);
			continue;
		}
		if (x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D')) {
			file.area = TREE_AREA_UNSTAGED;
			file.change_type = CHANGE_TYPE_UNMERGED;
			files.push_back(file);
			continue;
		}
		if (x != ' ') {
			file.area = TREE_AREA_STAGED;
			file.change_type = change_of(x);
			files.push_back(file);
		}
		if (y != ' ') {
			file.area = TREE_AREA_UNSTAGED;
			file.change_type = change_of(y);
			files.push_back(file);
		}
	}
	return files;
}

void RetroGit::stage_file(const String &p_file_path) {
	_run_or_warn({ "add", "-A", "--", p_file_path });
}

void RetroGit::unstage_file(const String &p_file_path) {
	if (_has_head()) {
		_run_or_warn({ "reset", "-q", "HEAD", "--", p_file_path });
	} else {
		// Antes do primeiro commit não há HEAD: só tira do índice.
		_run_or_warn({ "rm", "--cached", "-q", "-r", "--", p_file_path });
	}
}

void RetroGit::discard_file(const String &p_file_path) {
	_run_or_warn({ "checkout", "-q", "--", p_file_path });
}

void RetroGit::commit(const String &p_msg, bool p_amend) {
	// A mensagem vai por arquivo em UTF-8: aspas, quebras de linha e acentos chegam inteiros em qualquer sistema.
	const String path = OS::get_singleton()->get_temp_path().path_join(vformat("retro-git-msg-%d.txt", OS::get_singleton()->get_process_id()));
	{
		const Ref<FileAccess> f = FileAccess::open(path, FileAccess::WRITE);
		if (f.is_null()) {
			popup_error(U("Não deu para preparar a mensagem do commit (pasta temporária sem acesso)."));
			return;
		}
		f->store_string(p_msg);
	}
	Vector<String> args = { "commit", "-q", "-F", path };
	if (p_amend) {
		args.push_back("--amend");
	}
	_run_or_warn(args);
	DirAccess::remove_absolute(path);
}

Dictionary RetroGit::_new_file_diff(const String &p_path) {
	Dictionary file = create_diff_file(p_path, p_path);
	const String absolute = project_dir.path_join(p_path);
	const Ref<FileAccess> f = FileAccess::open(absolute, FileAccess::READ);
	if (f.is_null() || f->get_length() > 2 * 1024 * 1024) {
		return file;
	}
	const Vector<uint8_t> bytes = f->get_buffer(f->get_length());
	for (int i = 0; i < MIN(bytes.size(), 8000); i++) {
		if (bytes[i] == 0) {
			return file; // Binário (PNG, ROM...): só o nome.
		}
	}
	String text;
	text.append_utf8((const char *)bytes.ptr(), bytes.size());
	Vector<String> lines = text.split("\n");
	if (!lines.is_empty() && lines[lines.size() - 1].is_empty()) {
		lines.resize(lines.size() - 1);
	}
	Dictionary hunk = create_diff_hunk(0, 1, 0, lines.size());
	TypedArray<Dictionary> diff_lines;
	for (int i = 0; i < lines.size(); i++) {
		diff_lines.push_back(create_diff_line(i + 1, -1, lines[i].trim_suffix("\r") + "\n", "+"));
	}
	hunk = add_line_diffs_into_diff_hunk(hunk, diff_lines);
	TypedArray<Dictionary> hunks;
	hunks.push_back(hunk);
	return add_diff_hunks_into_diff_file(file, hunks);
}

TypedArray<Dictionary> RetroGit::_parse_diff(const String &p_text) {
	TypedArray<Dictionary> files;
	Dictionary file;
	TypedArray<Dictionary> hunks;
	Dictionary hunk;
	TypedArray<Dictionary> lines;
	int old_line = 0, new_line = 0, old_left = 0, new_left = 0;
	bool in_hunk = false;

	auto close_hunk = [&]() {
		if (!hunk.is_empty()) {
			hunks.push_back(add_line_diffs_into_diff_hunk(hunk, lines));
		}
		hunk = Dictionary();
		lines = TypedArray<Dictionary>();
		in_hunk = false;
	};
	auto close_file = [&]() {
		close_hunk();
		if (!file.is_empty()) {
			files.push_back(add_diff_hunks_into_diff_file(file, hunks));
		}
		file = Dictionary();
		hunks = TypedArray<Dictionary>();
	};

	for (const String &raw : p_text.split("\n")) {
		const String line = raw.trim_suffix("\r");
		if (in_hunk && (old_left > 0 || new_left > 0)) {
			const char32_t mark = line.is_empty() ? ' ' : line[0];
			const String content = line.is_empty() ? String("\n") : line.substr(1) + "\n";
			if (mark == '+') {
				lines.push_back(create_diff_line(new_line++, -1, content, "+"));
				new_left--;
			} else if (mark == '-') {
				lines.push_back(create_diff_line(-1, old_line++, content, "-"));
				old_left--;
			} else if (mark == '\\') {
				// "\ No newline at end of file"
			} else {
				lines.push_back(create_diff_line(new_line++, old_line++, content, " "));
				old_left--;
				new_left--;
			}
			continue;
		}
		if (line.begins_with("\\")) {
			continue;
		}
		if (line.begins_with("diff --git ")) {
			close_file();
			// "diff --git a/x b/x": os nomes certos chegam nas linhas ---/+++; isto vale para binários.
			const int split = line.find(" b/");
			const String old_path = split > 0 ? line.substr(11, split - 11) : String();
			const String new_path = split > 0 ? line.substr(split + 1) : String();
			file = create_diff_file(strip_side(new_path), strip_side(old_path));
		} else if (line.begins_with("--- ") && !file.is_empty()) {
			const String path = line.substr(4);
			if (path != "/dev/null") {
				file["old_file"] = strip_side(path);
			}
		} else if (line.begins_with("+++ ") && !file.is_empty()) {
			const String path = line.substr(4);
			if (path != "/dev/null") {
				file["new_file"] = strip_side(path);
			}
		} else if (line.begins_with("@@ ") && !file.is_empty()) {
			close_hunk();
			const Vector<String> parts = line.split(" ", false);
			if (parts.size() < 3) {
				continue;
			}
			int old_start = 0, old_count = 0, new_start = 0, new_count = 0;
			parse_range(parts[1].substr(1), old_start, old_count);
			parse_range(parts[2].substr(1), new_start, new_count);
			hunk = create_diff_hunk(old_start, new_start, old_count, new_count);
			old_line = old_start;
			new_line = new_start;
			old_left = old_count;
			new_left = new_count;
			in_hunk = true;
		}
	}
	close_file();
	return files;
}

List<EditorVCSInterface::DiffFile> RetroGit::get_diff(const String &p_identifier, TreeArea p_area) {
	TypedArray<Dictionary> files;
	if (p_area == TREE_AREA_COMMIT) {
		files = _parse_diff(_capture({ "show", "--no-color", "--no-ext-diff", "--format=", p_identifier }));
	} else if (p_area == TREE_AREA_STAGED) {
		files = _parse_diff(_capture({ "diff", "--cached", "--no-color", "--no-ext-diff", "--", p_identifier }));
	} else {
		const bool untracked = !_run({ "ls-files", "--error-unmatch", "--", p_identifier }).ok;
		if (untracked) {
			files.push_back(_new_file_diff(p_identifier));
		} else {
			files = _parse_diff(_capture({ "diff", "--no-color", "--no-ext-diff", "--", p_identifier }));
		}
	}
	List<DiffFile> result;
	for (int i = 0; i < files.size(); i++) {
		result.push_back(_convert_diff_file(files[i]));
	}
	return result;
}

List<EditorVCSInterface::Commit> RetroGit::get_previous_commits(int p_max_commits) {
	List<Commit> commits;
	if (!_has_head()) {
		return commits;
	}
	const String output = _capture({ "log", "-n", itos(MAX(p_max_commits, 1)), "--format=%H%x1f%an <%ae>%x1f%at%x1f%ai%x1f%B%x1e" });
	for (const String &record : output.split(String::chr(0x1e), false)) {
		const Vector<String> fields = record.strip_edges().split(String::chr(0x1f));
		if (fields.size() < 5) {
			continue;
		}
		// "%ai" termina no fuso: "-0300" → -180 minutos.
		const String zone = fields[3].get_slicec(' ', 2);
		int64_t offset = 0;
		if (zone.length() == 5) {
			offset = zone.substr(1, 2).to_int() * 60 + zone.substr(3, 2).to_int();
			if (zone[0] == '-') {
				offset = -offset;
			}
		}
		Commit commit;
		commit.id = fields[0];
		commit.author = fields[1];
		commit.unix_timestamp = fields[2].to_int();
		commit.offset_minutes = offset;
		commit.msg = fields[4].strip_edges();
		commits.push_back(commit);
	}
	return commits;
}

List<String> RetroGit::get_branch_list() {
	List<String> branches;
	for (const String &name : _run({ "for-each-ref", "--format=%(refname:short)", "refs/heads" }).output.split("\n", false)) {
		branches.push_back(name.strip_edges());
	}
	if (branches.is_empty()) {
		// Antes do primeiro commit o ramo ainda não existe como referência.
		const String current = get_current_branch_name();
		if (!current.is_empty()) {
			branches.push_back(current);
		}
	}
	return branches;
}

List<String> RetroGit::get_remotes() {
	List<String> remotes;
	for (const String &name : _run({ "remote" }).output.split("\n", false)) {
		remotes.push_back(name.strip_edges());
	}
	return remotes;
}

void RetroGit::create_branch(const String &p_branch_name) {
	_run_or_warn({ "branch", "--", p_branch_name.strip_edges() });
}

void RetroGit::remove_branch(const String &p_branch_name) {
	// -d recusa apagar um ramo com commits que ainda não estão em outro: a mensagem do git explica.
	_run_or_warn({ "branch", "-d", "--", p_branch_name });
}

void RetroGit::create_remote(const String &p_remote_name, const String &p_remote_url) {
	_run_or_warn({ "remote", "add", "--", p_remote_name.strip_edges(), p_remote_url.strip_edges() });
}

void RetroGit::remove_remote(const String &p_remote_name) {
	_run_or_warn({ "remote", "remove", p_remote_name });
}

String RetroGit::get_current_branch_name() {
	return _run({ "symbolic-ref", "--short", "-q", "HEAD" }).output.strip_edges();
}

bool RetroGit::checkout_branch(const String &p_branch_name) {
	return _run_or_warn({ "checkout", "-q", p_branch_name });
}

void RetroGit::pull(const String &p_remote) {
	if (p_remote.is_empty()) {
		popup_error(U("Nenhum remoto configurado. Adicione um em Remotos (o botão ⋮ do painel)."));
		return;
	}
	const String branch = get_current_branch_name();
	Vector<String> args = { "pull", "--no-edit", "--no-rebase", p_remote };
	if (!branch.is_empty()) {
		args.push_back(branch);
	}
	_run_or_warn(args, true);
}

void RetroGit::push(const String &p_remote, bool p_force) {
	if (p_remote.is_empty()) {
		popup_error(U("Nenhum remoto configurado. Adicione um em Remotos (o botão ⋮ do painel)."));
		return;
	}
	const String branch = get_current_branch_name();
	if (branch.is_empty()) {
		popup_error(U("Nenhum ramo ativo para enviar (HEAD solto). Troque para um ramo antes."));
		return;
	}
	Vector<String> args = { "push", "-u" };
	if (p_force) {
		args.push_back("--force-with-lease");
	}
	args.push_back(p_remote);
	args.push_back(branch);
	_run_or_warn(args, true);
}

void RetroGit::fetch(const String &p_remote) {
	if (p_remote.is_empty()) {
		popup_error(U("Nenhum remoto configurado. Adicione um em Remotos (o botão ⋮ do painel)."));
		return;
	}
	_run_or_warn({ "fetch", "--prune", p_remote }, true);
}
