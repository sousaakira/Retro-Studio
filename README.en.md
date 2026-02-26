# Retro Studio

<p align="center">
  <img src="assets/icons/icon.svg" alt="Retro Studio" width="128" />
</p>

**IDE for Sega Mega Drive (Genesis) game development** with SGDK, MarsDev and integrated tools support.

[Português (BR)](README.md) · [Español](README.es.md) · [日本語](README.ja.md)

---

## About

Retro Studio is a desktop IDE for creating retro games on the Sega Mega Drive. It includes a code editor, asset manager, tilemap editor, integrated terminal, build/emulator and AI assistant for SGDK development.

![Main interface](img/redesingner.png)

### Features

- **Code editor** — Monaco Editor with syntax highlighting for C/SGDK
- **Asset manager** — Import sprites, tilemaps, sounds
- **Tilemap editor** — Create and edit visual maps
- **Integrated build** — Compile with MarsDev/SGDK in one click
- **Emulator** — Run the game directly in the IDE
- **AI assistant** — Qwen, vLLM and others to help with code
- **Integrated Git** — Version control in the interface

![Integrated build](img/build%20integrado.png)

![Asset manager](img/assets%20manage.png)

![Map editor](img/map%20editor.png)

![AI system](img/sistema-de-ia.png)

![Settings](img/setings.png)

![Blastem debug](img/Debug%20integrado%20no%20blestem.png)

---

## Installation

### Prerequisites

- Node.js 18+
- MarsDev Toolkit (downloadable from the IDE itself)

### Development

```bash
git clone https://github.com/retro-studio/retro-studio.git
cd retro-studio
npm install
npm run dev
```

### Distribution build

```bash
npm run build
npm run build:linux   # AppImage, .deb
npm run build:win     # Windows
npm run build:mac     # macOS
```

---

## Contributing

Contributions are welcome! Here's how to get involved:

1. **Fork** the repository
2. Create a **branch** for your feature (`git checkout -b feature/new-feature`)
3. **Commit** your changes (`git commit -m 'Add new feature'`)
4. **Push** to the branch (`git push origin feature/new-feature`)
5. Open a **Pull Request**

### Guidelines

- Follow the existing code style
- Include tests when applicable
- Document significant changes
- For bugs, use the issue template

### Code of conduct

Be respectful and constructive. The project fosters a collaborative and inclusive environment.

---

## License

This project is licensed under the **MIT License**. You may use, modify and distribute the software, including for commercial purposes and monetization. See the [LICENSE](LICENSE) file for details.

---

## Credits

- [SGDK](https://github.com/Stephane-D/SGDK) — Sega Genesis Development Kit
- [MarsDev](https://github.com/andwn/marsdev) — Mega Drive toolchain
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Code editor
- [Electron](https://www.electronjs.org/) — Desktop framework

---

<p align="center">
  Made with ❤️ for the retro scene
</p>
