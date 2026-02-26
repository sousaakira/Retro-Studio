# Retro Studio

<p align="center">
  <img src="assets/icons/icon.svg" alt="Retro Studio" width="128" />
</p>

**IDE para desarrollo de juegos Sega Mega Drive (Genesis)** con soporte para SGDK, MarsDev y herramientas integradas.

[Português (BR)](README.md) · [English](README.en.md) · [日本語](README.ja.md)

---

## Acerca de

Retro Studio es una IDE de escritorio para crear juegos retro en Sega Mega Drive. Incluye editor de código, gestor de assets, editor de tilemaps, terminal integrado, compilación/emulador y asistente de IA para desarrollo con SGDK.

![Interfaz principal](img/redesingner.png)

### Características

- **Editor de código** — Monaco Editor con resaltado de sintaxis para C/SGDK
- **Gestor de assets** — Importa sprites, tilemaps, sonidos
- **Editor de tilemaps** — Crea y edita mapas visuales
- **Compilación integrada** — Compila con MarsDev/SGDK en un clic
- **Emulador** — Ejecuta el juego directamente en la IDE
- **Asistente IA** — Qwen, vLLM y otros para ayudar con el código
- **Git integrado** — Control de versiones en la interfaz

![Compilación integrada](img/build%20integrado.png)

![Gestor de assets](img/assets%20manage.png)

![Editor de mapas](img/map%20editor.png)

![Sistema de IA](img/sistema-de-ia.png)

![Configuración](img/setings.png)

![Debug Blastem](img/Debug%20integrado%20no%20blestem.png)

---

## Instalación

### Requisitos previos

- Node.js 18+
- MarsDev Toolkit (descargable desde la propia IDE)

### Desarrollo

```bash
git clone https://github.com/retro-studio/retro-studio.git
cd retro-studio
npm install
npm run dev
```

### Build para distribución

```bash
npm run build
npm run build:linux   # AppImage, .deb
npm run build:win     # Windows
npm run build:mac     # macOS
```

---

## Cómo contribuir

¡Las contribuciones son bienvenidas! Así puedes participar:

1. Haz **fork** del repositorio
2. Crea una **rama** para tu función (`git checkout -b feature/nueva-funcionalidad`)
3. **Commit** tus cambios (`git commit -m 'Añade nueva funcionalidad'`)
4. **Push** a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un **Pull Request**

### Directrices

- Sigue el estilo de código existente
- Incluye pruebas cuando aplique
- Documenta cambios significativos
- Para bugs, usa la plantilla de issue

### Código de conducta

Sé respetuoso y constructivo. El proyecto fomenta un entorno colaborativo e inclusivo.

---

## Licencia

Este proyecto está bajo la licencia **MIT**. Puedes usar, modificar y distribuir el software, incluido para fines comerciales y monetización. Consulta el archivo [LICENSE](LICENSE) para más detalles.

---

## Créditos

- [SGDK](https://github.com/Stephane-D/SGDK) — Sega Genesis Development Kit
- [MarsDev](https://github.com/andwn/marsdev) — Toolchain Mega Drive
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Editor de código
- [Electron](https://www.electronjs.org/) — Framework de escritorio

---

<p align="center">
  Hecho con ❤️ para la escena retro
</p>
