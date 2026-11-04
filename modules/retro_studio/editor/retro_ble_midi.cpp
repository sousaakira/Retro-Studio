#include "retro_ble_midi.h"

#include "core/input/input.h"
#include "core/input/input_event.h"
#include "core/os/os.h"

#ifdef DBUS_ENABLED
#ifdef SOWRAP_ENABLED
#include "platform/linuxbsd/dbus-so_wrap.h"
#else
#include <dbus/dbus.h>
#endif
#endif

static String U8(const char *p_text) {
	return String::utf8(p_text);
}

void RetroBleMidi::_set_status(const String &p_status, bool p_connected, const String &p_name) {
	MutexLock lock(mutex);
	status = p_status;
	connected = p_connected;
	if (!p_name.is_empty()) {
		device_name = p_name;
	}
}

bool RetroBleMidi::is_connected() {
	MutexLock lock(mutex);
	return connected;
}

String RetroBleMidi::get_status() {
	MutexLock lock(mutex);
	return status;
}

String RetroBleMidi::get_device_name() {
	MutexLock lock(mutex);
	return device_name;
}

void RetroBleMidi::start() {
	if (running.is_set()) {
		return;
	}
	if (thread.is_started()) {
		thread.wait_to_finish();
	}
	quit.clear();
	running.set();
	_set_status(U8("procurando o teclado Bluetooth…"));
	thread.start(_thread, this);
}

void RetroBleMidi::stop() {
	quit.set();
	if (thread.is_started()) {
		thread.wait_to_finish();
	}
	running.clear();
	_set_status(String());
}

RetroBleMidi::~RetroBleMidi() {
	stop();
}

void RetroBleMidi::_thread(void *p_self) {
	static_cast<RetroBleMidi *>(p_self)->_run();
}

#ifndef DBUS_ENABLED

void RetroBleMidi::_run() {
	_set_status(U8("esta versão foi compilada sem D-Bus: o Bluetooth não está disponível."));
	running.clear();
}

#else

static constexpr const char *MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
static constexpr const char *MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";

namespace {

struct Found {
	String device; // Caminho do aparelho no BlueZ (/org/bluez/hci0/dev_…).
	String name;
	bool connected = false;
	bool resolved = false;
	String characteristic; // Caminho da característica MIDI (vazio até os serviços serem lidos).
};

// Chama um método e devolve a resposta (nullptr + r_error se falhou).
DBusMessage *_call(DBusConnection *p_bus, const char *p_path, const char *p_interface, const char *p_method, int p_timeout, String &r_error) {
	DBusMessage *message = dbus_message_new_method_call("org.bluez", p_path, p_interface, p_method);
	if (!message) {
		r_error = "D-Bus";
		return nullptr;
	}
	DBusError error;
	dbus_error_init(&error);
	DBusMessage *reply = dbus_connection_send_with_reply_and_block(p_bus, message, p_timeout, &error);
	dbus_message_unref(message);
	if (dbus_error_is_set(&error)) {
		r_error = String::utf8(error.message ? error.message : "erro do D-Bus");
		dbus_error_free(&error);
		return nullptr;
	}
	return reply;
}

String _string(DBusMessageIter *p_iter) {
	const char *text = nullptr;
	dbus_message_iter_get_basic(p_iter, &text);
	return text ? String::utf8(text) : String();
}

// Lê o valor de uma variante (s, b ou as) como texto/bool/lista.
void _variant(DBusMessageIter *p_value, String &r_text, bool &r_bool, Vector<String> &r_list) {
	DBusMessageIter inner;
	dbus_message_iter_recurse(p_value, &inner);
	const int type = dbus_message_iter_get_arg_type(&inner);
	if (type == DBUS_TYPE_STRING || type == DBUS_TYPE_OBJECT_PATH) {
		r_text = _string(&inner);
	} else if (type == DBUS_TYPE_BOOLEAN) {
		dbus_bool_t value = 0;
		dbus_message_iter_get_basic(&inner, &value);
		r_bool = value;
	} else if (type == DBUS_TYPE_ARRAY) {
		DBusMessageIter items;
		dbus_message_iter_recurse(&inner, &items);
		while (dbus_message_iter_get_arg_type(&items) == DBUS_TYPE_STRING) {
			r_list.push_back(_string(&items).to_lower());
			dbus_message_iter_next(&items);
		}
	}
}

// GetManagedObjects: o primeiro aparelho pareado que anuncia o serviço MIDI e a característica dele.
Found _find(DBusConnection *p_bus, String &r_error) {
	Found found;
	DBusMessage *message = dbus_message_new_method_call("org.bluez", "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects");
	DBusError error;
	dbus_error_init(&error);
	DBusMessage *reply = dbus_connection_send_with_reply_and_block(p_bus, message, 5000, &error);
	dbus_message_unref(message);
	if (dbus_error_is_set(&error)) {
		r_error = String::utf8(error.message ? error.message : "erro do D-Bus");
		dbus_error_free(&error);
		return found;
	}
	struct Characteristic {
		String path, uuid;
	};
	Vector<Characteristic> characteristics;
	DBusMessageIter root, objects;
	dbus_message_iter_init(reply, &root);
	dbus_message_iter_recurse(&root, &objects);
	while (dbus_message_iter_get_arg_type(&objects) == DBUS_TYPE_DICT_ENTRY) {
		DBusMessageIter object, interfaces;
		dbus_message_iter_recurse(&objects, &object);
		const String path = _string(&object);
		dbus_message_iter_next(&object);
		dbus_message_iter_recurse(&object, &interfaces);
		while (dbus_message_iter_get_arg_type(&interfaces) == DBUS_TYPE_DICT_ENTRY) {
			DBusMessageIter interface, properties;
			dbus_message_iter_recurse(&interfaces, &interface);
			const String name = _string(&interface);
			dbus_message_iter_next(&interface);
			dbus_message_iter_recurse(&interface, &properties);
			String alias, uuid;
			bool paired = false, connected = false, resolved = false;
			Vector<String> uuids;
			while (dbus_message_iter_get_arg_type(&properties) == DBUS_TYPE_DICT_ENTRY) {
				DBusMessageIter property;
				dbus_message_iter_recurse(&properties, &property);
				const String key = _string(&property);
				dbus_message_iter_next(&property);
				String text;
				bool flag = false;
				Vector<String> list;
				_variant(&property, text, flag, list);
				if (key == "Alias") {
					alias = text;
				} else if (key == "Paired") {
					paired = flag;
				} else if (key == "Connected") {
					connected = flag;
				} else if (key == "ServicesResolved") {
					resolved = flag;
				} else if (key == "UUIDs") {
					uuids = list;
				} else if (key == "UUID") {
					uuid = text.to_lower();
				}
				dbus_message_iter_next(&properties);
			}
			if (name == "org.bluez.Device1" && paired && uuids.has(MIDI_SERVICE) && found.device.is_empty()) {
				found.device = path;
				found.name = alias;
				found.connected = connected;
				found.resolved = resolved;
			} else if (name == "org.bluez.GattCharacteristic1" && uuid == MIDI_CHARACTERISTIC) {
				characteristics.push_back({ path, uuid });
			}
			dbus_message_iter_next(&interfaces);
		}
		dbus_message_iter_next(&objects);
	}
	dbus_message_unref(reply);
	for (const Characteristic &characteristic : characteristics) {
		if (!found.device.is_empty() && characteristic.path.begins_with(found.device + "/")) {
			found.characteristic = characteristic.path;
		}
	}
	return found;
}

// Mensagens MIDI → InputEventMIDI, montado como o MIDIDriver::send_event do Godot (o mesmo caminho do
// teclado USB). Running status; SysEx é ignorado; mensagens de tempo real não mexem no status corrente.
struct MidiParser {
	uint8_t status = 0;
	uint8_t data[2] = {};
	int count = 0;
	bool sysex = false;

	static int expected(uint8_t p_status) {
		const uint8_t kind = p_status & 0xf0;
		if (kind == 0xc0 || kind == 0xd0) {
			return 1;
		}
		if (kind >= 0x80 && kind <= 0xe0) {
			return 2;
		}
		return p_status == 0xf2 ? 2 : (p_status == 0xf1 || p_status == 0xf3 ? 1 : 0);
	}

	void emit() {
		Ref<InputEventMIDI> event;
		event.instantiate();
		event->set_device(RetroBleMidi::DEVICE_INDEX);
		event->set_channel(status < 0xf0 ? status & 0x0f : 0);
		const MIDIMessage message = MIDIMessage(status < 0xf0 ? status >> 4 : status);
		event->set_message(message);
		switch (message) {
			case MIDIMessage::NOTE_OFF:
			case MIDIMessage::NOTE_ON:
				event->set_pitch(data[0]);
				event->set_velocity(data[1]);
				break;
			case MIDIMessage::AFTERTOUCH:
				event->set_pitch(data[0]);
				event->set_pressure(data[1]);
				break;
			case MIDIMessage::CONTROL_CHANGE:
				event->set_controller_number(data[0]);
				event->set_controller_value(data[1]);
				break;
			case MIDIMessage::PROGRAM_CHANGE:
				event->set_instrument(data[0]);
				break;
			case MIDIMessage::CHANNEL_PRESSURE:
				event->set_pressure(data[0]);
				break;
			case MIDIMessage::PITCH_BEND:
				event->set_pitch((data[1] << 7) | data[0]);
				break;
			default:
				break;
		}
		Input::get_singleton()->parse_input_event(event);
	}

	void feed(uint8_t p_byte) {
		if (p_byte & 0x80) {
			if (p_byte >= 0xf8) {
				return; // Tempo real (clock, start…): o compositor não usa.
			}
			if (p_byte == 0xf0) {
				sysex = true;
				return;
			}
			if (p_byte == 0xf7) {
				sysex = false;
				return;
			}
			sysex = false;
			status = p_byte;
			count = 0;
			if (expected(status) == 0) {
				status = 0;
			}
			return;
		}
		if (sysex || !status) {
			return;
		}
		data[count++] = p_byte;
		if (count == expected(status)) {
			emit();
			count = 0;
			if (status >= 0xf0) {
				status = 0; // Mensagens de sistema não têm running status.
			}
		}
	}
};

// BLE-MIDI: byte 0 = cabeçalho; cada mensagem vem depois de um byte de tempo (bit 7 ligado); bytes de
// dados sem tempo continuam a mensagem anterior (running status). Os tempos saem; o resto vai ao parser.
void _parse_packet(const uint8_t *p_data, int p_length, MidiParser &r_parser) {
	if (p_length < 2 || !(p_data[0] & 0x80)) {
		return;
	}
	int index = 1;
	while (index < p_length) {
		if (p_data[index] & 0x80) {
			index++; // Byte de tempo.
			if (index < p_length && (p_data[index] & 0x80)) {
				r_parser.feed(p_data[index]); // Status (ou o F7 do fim de um SysEx).
				index++;
			}
			continue;
		}
		r_parser.feed(p_data[index]);
		index++;
	}
}

bool _sleep(SafeFlag &p_quit, int p_milliseconds) {
	for (int waited = 0; waited < p_milliseconds && !p_quit.is_set(); waited += 100) {
		OS::get_singleton()->delay_usec(100000);
	}
	return !p_quit.is_set();
}

} // namespace

void RetroBleMidi::_run() {
#ifdef SOWRAP_ENABLED
	static bool loaded = initialize_dbus(OS::get_singleton()->is_stdout_verbose()) == 0;
	if (!loaded) {
		_set_status(U8("a biblioteca do D-Bus (libdbus) não foi encontrada."));
		running.clear();
		return;
	}
#endif
	DBusError error;
	dbus_error_init(&error);
	DBusConnection *bus = dbus_bus_get_private(DBUS_BUS_SYSTEM, &error);
	if (dbus_error_is_set(&error) || !bus) {
		_set_status(U8("sem acesso ao D-Bus do sistema: ") + String::utf8(error.message ? error.message : ""));
		dbus_error_free(&error);
		running.clear();
		return;
	}
	dbus_connection_set_exit_on_disconnect(bus, false);
	MidiParser parser;
	String match;
	while (!quit.is_set()) {
		String problem;
		Found found = _find(bus, problem);
		if (!problem.is_empty()) {
			_set_status(U8("o Bluetooth não respondeu (") + problem + U8("). Tentando de novo…"));
			_sleep(quit, 3000);
			continue;
		}
		if (found.device.is_empty()) {
			_set_status(U8("nenhum teclado MIDI Bluetooth pareado. Pareie o SMK-25 nas configurações de Bluetooth."));
			_sleep(quit, 3000);
			continue;
		}
		if (!found.connected) {
			_set_status(U8("conectando ") + found.name + U8(" por Bluetooth…"), false, found.name);
			DBusMessage *reply = _call(bus, found.device.utf8().get_data(), "org.bluez.Device1", "Connect", 20000, problem);
			if (!reply) {
				_set_status(found.name + U8(": não conectou (") + problem + U8("). Ligue o teclado; tentando de novo…"), false, found.name);
				_sleep(quit, 3000);
				continue;
			}
			dbus_message_unref(reply);
		}
		// Os serviços GATT aparecem alguns instantes depois de conectar.
		for (int attempt = 0; attempt < 50 && found.characteristic.is_empty() && !quit.is_set(); attempt++) {
			_sleep(quit, 200);
			found = _find(bus, problem);
		}
		if (found.characteristic.is_empty()) {
			_set_status(found.name + U8(": conectado, mas sem a característica MIDI. Tentando de novo…"), false, found.name);
			_sleep(quit, 3000);
			continue;
		}
		if (!match.is_empty()) {
			dbus_bus_remove_match(bus, match.utf8().get_data(), nullptr);
		}
		match = "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',path_namespace='" + found.device + "'";
		dbus_bus_add_match(bus, match.utf8().get_data(), nullptr);
		DBusMessage *reply = _call(bus, found.characteristic.utf8().get_data(), "org.bluez.GattCharacteristic1", "StartNotify", 5000, problem);
		if (!reply) {
			_set_status(found.name + U8(": não recebeu as notas (") + problem + U8("). Tentando de novo…"), false, found.name);
			_sleep(quit, 3000);
			continue;
		}
		dbus_message_unref(reply);
		_set_status(found.name, true, found.name);
		const CharString characteristic = found.characteristic.utf8();
		const CharString device = found.device.utf8();
		bool lost = false;
		while (!quit.is_set() && !lost) {
			if (!dbus_connection_read_write(bus, 100)) {
				lost = true;
				break;
			}
			DBusMessage *message;
			while ((message = dbus_connection_pop_message(bus))) {
				if (dbus_message_is_signal(message, "org.freedesktop.DBus.Properties", "PropertiesChanged") && dbus_message_get_path(message)) {
					const String path = String::utf8(dbus_message_get_path(message));
					DBusMessageIter args, changes;
					dbus_message_iter_init(message, &args);
					const String interface = _string(&args);
					dbus_message_iter_next(&args);
					dbus_message_iter_recurse(&args, &changes);
					while (dbus_message_iter_get_arg_type(&changes) == DBUS_TYPE_DICT_ENTRY) {
						DBusMessageIter entry, value;
						dbus_message_iter_recurse(&changes, &entry);
						const String key = _string(&entry);
						dbus_message_iter_next(&entry);
						dbus_message_iter_recurse(&entry, &value);
						if (interface == "org.bluez.GattCharacteristic1" && key == "Value" && path == characteristic.get_data() && dbus_message_iter_get_arg_type(&value) == DBUS_TYPE_ARRAY) {
							DBusMessageIter bytes;
							dbus_message_iter_recurse(&value, &bytes);
							const uint8_t *data = nullptr;
							int length = 0;
							dbus_message_iter_get_fixed_array(&bytes, &data, &length);
							_parse_packet(data, length, parser);
						} else if (interface == "org.bluez.Device1" && key == "Connected" && path == device.get_data() && dbus_message_iter_get_arg_type(&value) == DBUS_TYPE_BOOLEAN) {
							dbus_bool_t on = 1;
							dbus_message_iter_get_basic(&value, &on);
							lost = lost || !on;
						}
						dbus_message_iter_next(&changes);
					}
				}
				dbus_message_unref(message);
			}
		}
		if (lost && !quit.is_set()) {
			_set_status(found.name + U8(" desconectou. Reconectando…"), false, found.name);
			_sleep(quit, 1500);
		} else {
			// Saindo da tela Música: para as notificações (o teclado fica livre para outro programa).
			String ignored;
			DBusMessage *stop_reply = _call(bus, characteristic.get_data(), "org.bluez.GattCharacteristic1", "StopNotify", 2000, ignored);
			if (stop_reply) {
				dbus_message_unref(stop_reply);
			}
		}
	}
	if (!match.is_empty()) {
		dbus_bus_remove_match(bus, match.utf8().get_data(), nullptr);
	}
	dbus_connection_close(bus);
	dbus_connection_unref(bus);
	running.clear();
}

#endif
