# Retro Studio

<p align="center">
  <img src="assets/icons/icon.svg" alt="Retro Studio" width="128" />
</p>

**セガメガドライブ（ジェネシス）ゲーム開発用IDE** — SGDK、MarsDev、統合ツール対応

[Português (BR)](README.md) · [English](README.en.md) · [Español](README.es.md)

---

## 概要

Retro Studioはセガメガドライブ向けレトロゲーム開発用のデスクトップIDEです。コードエディタ、アセットマネージャー、タイルマップエディタ、統合ターミナル、ビルド/エミュレータ、SGDK開発用AIアシスタントを備えています。

![メインインターフェース](img/redesingner.png)

### 機能

- **コードエディタ** — C/SGDK用シンタックスハイライト付きMonaco Editor
- **アセットマネージャー** — スプライト、タイルマップ、サウンドのインポート
- **タイルマップエディタ** — ビジュアルマップの作成・編集
- **統合ビルド** — MarsDev/SGDKでワンクリックコンパイル
- **エミュレータ** — IDE内で直接ゲームを実行
- **AIアシスタント** — Qwen、vLLMなどでコーディングをサポート
- **統合Git** — インターフェース内でバージョン管理

![統合ビルド](img/build%20integrado.png)

![アセットマネージャー](img/assets%20manage.png)

![マップエディタ](img/map%20editor.png)

![AIシステム](img/sistema-de-ia.png)

![設定](img/setings.png)

![Blastemデバッグ](img/Debug%20integrado%20no%20blestem.png)

---

## インストール

### 必要環境

- Node.js 18以上
- MarsDev Toolkit（IDE内からダウンロード可能）

### 開発用

```bash
git clone https://github.com/retro-studio/retro-studio.git
cd retro-studio
npm install
npm run dev
```

### 配布用ビルド

```bash
npm run build
npm run build:linux   # AppImage, .deb
npm run build:win     # Windows
npm run build:mac     # macOS
```

---

## コントリビューション

コントリビューションを歓迎します！参加方法：

1. リポジトリを**フォーク**
2. 機能用の**ブランチ**を作成（`git checkout -b feature/新機能`）
3. 変更を**コミット**（`git commit -m '新機能を追加'`）
4. ブランチに**プッシュ**（`git push origin feature/新機能`）
5. **Pull Request**を開く

### ガイドライン

- 既存のコードスタイルに従う
- 該当する場合はテストを含める
- 重要な変更は文書化する
- バグの場合はissueテンプレートを使用

### 行動規範

敬意を持ち、建設的に接してください。プロジェクトは協調的で包括的な環境を大切にしています。

---

## ライセンス

本プロジェクトは**MITライセンス**の下で公開されています。商用利用やマネタイズを含め、ソフトウェアの使用、改変、配布が可能です。詳細は[LICENSE](LICENSE)を参照してください。

---

## クレジット

- [SGDK](https://github.com/Stephane-D/SGDK) — Sega Genesis Development Kit
- [MarsDev](https://github.com/andwn/marsdev) — メガドライブ用ツールチェーン
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — コードエディタ
- [Electron](https://www.electronjs.org/) — デスクトップフレームワーク

---

<p align="center">
  レトロシーンに ❤️ を込めて
</p>
