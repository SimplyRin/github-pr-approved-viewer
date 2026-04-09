# github-tampermonkey
GitHub のページを改良する [Tampermonkey](https://www.tampermonkey.net/) ユーザースクリプト集 & Chrome 拡張機能です。

## インストール

### Tampermonkey ユーザースクリプト

1. お使いのブラウザに Tampermonkey 拡張機能をインストールします
   - [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/ja/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. 各スクリプトの **Install** リンクをクリックしてインストールします

### Chrome 拡張機能

GitHub PR Approved Viewer は Chrome ウェブストアからもインストールできます。

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/github-pr-approved-viewer/ihbbhemhgbniepfbmobfgaknmkfhopih?hl=ja)

---

## スクリプト一覧

### GitHub PR Approved Viewer

[![Install](https://img.shields.io/badge/Install-Tampermonkey-blue)](https://raw.githubusercontent.com/SimplyRin/github-tampermonkey/main/src/github-pr-approved-viewer.user.js) [![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/github-pr-approved-viewer/ihbbhemhgbniepfbmobfgaknmkfhopih?hl=ja)

Pull Request ページに **Code Owner の承認状況** を表示します。

- リポジトリの `.github/CODEOWNERS` を自動取得
- 変更されたファイルに対応するコードオーナーを表示
- 誰が承認済みかをアバターで一覧表示
- 全オーナーが承認済みかどうかをヘッダーで確認可能

---

### GitHub PR Sticky Navigation

[![Install](https://img.shields.io/badge/Install-Tampermonkey-blue)](https://raw.githubusercontent.com/SimplyRin/github-tampermonkey/main/src/github-pr-sticky-navigation.user.js)

Pull Request ページで **ナビゲーションバーをスクロール時に固定表示** します。

- Conversation / Commits / Checks / Files changed タブが常に画面上部に表示
- 長い PR のレビュー時にタブ切り替えがスムーズになります

---

### GitHub PR Auto Video Tag

[![Install](https://img.shields.io/badge/Install-Tampermonkey-blue)](https://raw.githubusercontent.com/SimplyRin/github-tampermonkey/main/src/github-pr-upload-link-logger.user.js)

Pull Request の説明欄やコメント欄に **動画をアップロードした際、自動で `<video>` タグに変換** します。

- `https://github.com/user-attachments/assets/...` 形式のリンク挿入を自動検知
- リンク先の Content-Type が `video/*` の場合、`<video src="..."></video>` に自動変換
- 動画がプレビュー可能な形式で挿入されるようになります
- 同時に 2 件以上のリンクが挿入された場合はスキップ（誤動作防止）
