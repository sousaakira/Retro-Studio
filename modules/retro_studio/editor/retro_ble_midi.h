#pragma once

#include "core/os/mutex.h"
#include "core/os/thread.h"
#include "core/string/ustring.h"
#include "core/templates/safe_refcount.h"

// #89: teclado MIDI por Bluetooth (BLE-MIDI) direto pelo BlueZ, via D-Bus. O BlueZ do Ubuntu/Pop!_OS vem
// sem o plugin de MIDI, então o SMK-25 pareado nunca vira porta ALSA; aqui a IDE faz o que o Web
// Bluetooth fazia no Electron: conecta no aparelho pareado que anuncia o serviço MIDI, assina as
// notificações da característica MIDI e entrega cada mensagem ao Godot como InputEventMIDI (o mesmo
// caminho do teclado USB). Roda numa thread; reconecta sozinho se o teclado desligar.
class RetroBleMidi {
	Thread thread;
	SafeFlag quit;
	SafeFlag running;
	Mutex mutex;
	String status;
	String device_name;
	bool connected = false;

	static void _thread(void *p_self);
	void _run();
	void _set_status(const String &p_status, bool p_connected = false, const String &p_name = String());

public:
	static constexpr int DEVICE_INDEX = 90; // Índice dos eventos (as portas ALSA começam em 0).

	// Liga a busca/conexão (idempotente). Sem D-Bus ou sem Bluetooth, o status explica.
	void start();
	void stop();
	bool is_running() const { return running.is_set(); }
	bool is_connected();
	String get_status();
	String get_device_name();

	~RetroBleMidi();
};
