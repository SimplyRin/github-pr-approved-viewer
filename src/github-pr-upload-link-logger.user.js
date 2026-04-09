// ==UserScript==
// @name         GitHub PR Upload Link Logger
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  GitHub Pull Request ページで動画・ファイルのアップロード完了後に挿入されるリンクを console.log に出力する
// @author       @SimplyRin
// @match        https://github.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/SimplyRin/github-pr-approved-viewer/main/src/github-pr-upload-link-logger.user.js
// @downloadURL  https://raw.githubusercontent.com/SimplyRin/github-pr-approved-viewer/main/src/github-pr-upload-link-logger.user.js
// ==/UserScript==

// MIT License
// Copyright (c) 2026 SimplyRin
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

(function () {
    'use strict';

    // アップロード完了後に挿入される user-attachments リンクの正規表現
    const ATTACHMENT_URL_REGEX = /https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+/g;

    // 監視中のテキストエリアとその前回の値を保持する WeakMap
    const previousValues = new WeakMap();

    // textarea の value プロパティのネイティブ descriptor（フック回避用）
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

    function getNativeValue(textarea) {
        return nativeDescriptor.get.call(textarea);
    }

    function setNativeValue(textarea, value) {
        nativeDescriptor.set.call(textarea, value);
    }

    /**
     * GM_xmlhttpRequest で HEAD リクエストを送り Content-Type を取得する
     */
    function getContentType(url) {
        console.log('[Upload Link Logger] [DEBUG] GET リクエスト開始:', url);
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        'Accept': '*/*',
                    },
                    onload: function (response) {
                        console.log('[Upload Link Logger] [DEBUG] レスポンス受信 status=' + response.status);
                        console.log('[Upload Link Logger] [DEBUG] 最終URL (リダイレクト先):', response.finalUrl);
                        console.log('[Upload Link Logger] [DEBUG] レスポンスヘッダー:', response.responseHeaders);
                        const match = response.responseHeaders.match(/^content-type:\s*(.+)$/mi);
                        const contentType = match ? match[1].trim().split(';')[0].trim() : null;
                        console.log('[Upload Link Logger] [DEBUG] Content-Type:', contentType);
                        resolve(contentType);
                    },
                    onerror: function (error) {
                        console.error('[Upload Link Logger] [DEBUG] リクエスト失敗 (onerror):', error);
                        console.error('[Upload Link Logger] [DEBUG] error.finalUrl:', error.finalUrl);
                        console.error('[Upload Link Logger] [DEBUG] error.responseHeaders:', error.responseHeaders);
                        console.error('[Upload Link Logger] [DEBUG] error.responseText (先頭500文字):', (error.responseText || '').substring(0, 500));
                        resolve(null);
                    },
                    ontimeout: function () {
                        console.error('[Upload Link Logger] [DEBUG] リクエストタイムアウト');
                        resolve(null);
                    },
                    timeout: 15000,
                });
            } catch (e) {
                console.error('[Upload Link Logger] [DEBUG] GM_xmlhttpRequest 呼び出し例外:', e);
                resolve(null);
            }
        });
    }

    /**
     * テキスト内で URL が HTML 属性（引用符）の中に入っていない（裸の）状態かを判定する
     */
    function isBareLinkInText(text, url) {
        let pos = 0;
        while ((pos = text.indexOf(url, pos)) !== -1) {
            const charBefore = pos > 0 ? text[pos - 1] : '';
            const charAfter = pos + url.length < text.length ? text[pos + url.length] : '';
            if (charBefore !== '"' && charBefore !== "'" && charAfter !== '"' && charAfter !== "'") {
                return true;
            }
            pos += url.length;
        }
        return false;
    }

    /**
     * リンクの Content-Type が video/* なら <video> タグで囲む
     */
    async function checkAndWrapVideoLink(textarea, url) {
        console.log('[Upload Link Logger] [DEBUG] checkAndWrapVideoLink 開始 url=' + url);
        try {
            // 裸のリンクかどうかを確認
            const currentValue = getNativeValue(textarea);
            console.log('[Upload Link Logger] [DEBUG] textarea 現在値 (先頭200文字):', currentValue.substring(0, 200));
            const isBare = isBareLinkInText(currentValue, url);
            console.log('[Upload Link Logger] [DEBUG] 裸リンク判定:', isBare);
            if (!isBare) {
                console.log('[Upload Link Logger] [DEBUG] 裸リンクではないためスキップ');
                return;
            }

            // Content-Type を確認
            console.log('[Upload Link Logger] [DEBUG] Content-Type 取得中...');
            const contentType = await getContentType(url);
            console.log('[Upload Link Logger] [DEBUG] 取得した Content-Type:', contentType);
            if (!contentType) {
                console.log('[Upload Link Logger] [DEBUG] Content-Type が取得できなかったため終了');
                return;
            }
            if (!contentType.startsWith('video/')) {
                console.log('[Upload Link Logger] [DEBUG] video/* ではないためスキップ (' + contentType + ')');
                return;
            }

            // 非同期処理中に値が変わっている可能性があるため再取得
            const latestValue = getNativeValue(textarea);
            const isBareAfterAwait = isBareLinkInText(latestValue, url);
            console.log('[Upload Link Logger] [DEBUG] 非同期後の裸リンク再判定:', isBareAfterAwait);
            if (!isBareAfterAwait) {
                console.log('[Upload Link Logger] [DEBUG] 非同期待ち中に裸リンクではなくなったためスキップ');
                return;
            }

            // 裸の URL のみを <video> タグで置換（引用符で囲まれたものは除外）
            const videoTag = '<video src="' + url + '"></video>';
            const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const bareUrlRegex = new RegExp('(?<!["\'])' + escapedUrl + '(?!["\'])', 'g');
            const newValue = latestValue.replace(bareUrlRegex, videoTag);
            console.log('[Upload Link Logger] [DEBUG] 置換前後の差分あり:', latestValue !== newValue);

            if (latestValue === newValue) {
                console.log('[Upload Link Logger] [DEBUG] 置換が発生しなかったため終了');
                return;
            }

            // ネイティブ setter で値を設定（自前のフックを回避）
            setNativeValue(textarea, newValue);
            previousValues.set(textarea, newValue);

            // GitHub 側のハンドラに変更を通知
            textarea.dispatchEvent(new Event('input', { bubbles: true }));

            console.log('[Upload Link Logger] 動画リンクを <video> タグで囲みました:', url);
        } catch (e) {
            console.error('[Upload Link Logger] 動画チェックエラー:', e);
        }
    }

    /**
     * テキストエリアの値が変化したときに、新しく挿入されたリンクを検出してログ出力する
     */
    function handleTextareaInput(event) {
        const textarea = event.target;
        const currentValue = textarea.value;
        const prevValue = previousValues.get(textarea) || '';

        // 現在の値から全てのリンクを抽出
        const currentLinks = new Set(currentValue.match(ATTACHMENT_URL_REGEX) || []);
        // 前回の値から全てのリンクを抽出
        const prevLinks = new Set(prevValue.match(ATTACHMENT_URL_REGEX) || []);

        // 新しく追加されたリンクを検出
        const newLinks = [...currentLinks].filter(link => !prevLinks.has(link));

        // 同時に2件以上挿入された場合はその分だけスキップ（以降の個別挿入は引き続き処理する）
        if (newLinks.length === 1) {
            console.log('[Upload Link Logger] アップロード完了:', newLinks[0]);
            checkAndWrapVideoLink(textarea, newLinks[0]);
        } else if (newLinks.length >= 2) {
            console.log('[Upload Link Logger] 同時に' + newLinks.length + '件のリンクが挿入されたためスキップ（監視は継続）:', newLinks);
        }

        // 現在の値を保存（スキップ時も更新し、次回の差分検出に備える）
        previousValues.set(textarea, currentValue);
    }

    /**
     * テキストエリアに監視を設定する
     */
    function observeTextarea(textarea) {
        if (textarea.dataset.uploadLinkLoggerAttached) return;
        textarea.dataset.uploadLinkLoggerAttached = 'true';

        // 初期値を記録
        previousValues.set(textarea, textarea.value);

        // input イベントで変化を検知（ユーザー入力やプログラムによる挿入の両方をカバー）
        textarea.addEventListener('input', handleTextareaInput);

        // GitHub はプログラム的に value を書き換える場合があるため、
        // value プロパティの setter をフックして変更を検知する
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) {
            const originalSetter = descriptor.set;
            Object.defineProperty(textarea, 'value', {
                get: function () {
                    return descriptor.get.call(this);
                },
                set: function (newValue) {
                    const prevValue = descriptor.get.call(this);
                    originalSetter.call(this, newValue);

                    // 新しく追加されたリンクを検出
                    const currentLinks = new Set(newValue.match(ATTACHMENT_URL_REGEX) || []);
                    const prevLinks = new Set((prevValue || '').match(ATTACHMENT_URL_REGEX) || []);
                    const newLinks = [...currentLinks].filter(link => !prevLinks.has(link));

                    // 同時に2件以上挿入された場合はその分だけスキップ（以降の個別挿入は引き続き処理する）
                    if (newLinks.length === 1) {
                        console.log('[Upload Link Logger] アップロード完了:', newLinks[0]);
                        checkAndWrapVideoLink(this, newLinks[0]);
                    } else if (newLinks.length >= 2) {
                        console.log('[Upload Link Logger] 同時に' + newLinks.length + '件のリンクが挿入されたためスキップ（監視は継続）:', newLinks);
                    }

                    // スキップ時も更新し、次回の差分検出に備える
                    previousValues.set(this, newValue);
                },
                configurable: true,
            });
        }
    }

    /**
     * ページ内のコメント用テキストエリアを全て検出して監視を設定する
     */
    function attachToTextareas() {
        // GitHub PR の Description やコメント欄のテキストエリア
        const selectors = [
            'textarea[name="pull_request[body]"]',       // PR 作成ページの Description
            'textarea.js-comment-field',                  // コメント欄全般
            'textarea.CommentBox-input',                  // 新UIのコメント欄
        ];

        const textareas = document.querySelectorAll(selectors.join(', '));
        textareas.forEach(observeTextarea);
    }

    // 初回実行
    attachToTextareas();

    // DOM の動的変更に対応（SPAナビゲーションや動的に追加されるコメント欄）
    const domObserver = new MutationObserver(() => {
        attachToTextareas();
    });

    domObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
