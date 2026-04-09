// ==UserScript==
// @name         GitHub PR Sticky Navigation
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  GitHub の Pull Request ページで、スクロール時に Conversation、Commits、Checks、Files changed のナビゲーションバーを固定表示する
// @author       SimplyRin
// @match        https://github.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/SimplyRin/github-pr-approved-viewer/main/src/github-pr-sticky-navigation.user.js
// @downloadURL  https://raw.githubusercontent.com/SimplyRin/github-pr-approved-viewer/main/src/github-pr-sticky-navigation.user.js
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

(function() {
    'use strict';

    // スタイルを追加
    GM_addStyle(`
        /* クローンされたナビゲーションバーのスタイル */
        #sticky-pr-nav {
          display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999;
            background-color: var(--bgColor-default, var(--color-canvas-default));
            border-bottom: 1px solid var(--borderColor-default, var(--color-border-default));
            box-shadow: 0 1px 0 rgba(31,35,40,0.04), inset 0 -1px 0 var(--borderColor-muted, var(--color-border-muted));
            transition: top 0.1s ease-in-out;
        }

        #sticky-pr-nav.is-visible {
            display: block;
        }

        /* 従来の .tabnav スタイル (conversation/checks/files) */
        #sticky-pr-nav .tabnav {
            margin: 0;
            padding: 0;
            border: none;
        }

        #sticky-pr-nav .tabnav-tabs {
            border-bottom: none;
        }

        #sticky-pr-nav .tabnav-tab {
            padding: 8px 12px;
            line-height: 20px;
        }

        #sticky-pr-nav .tabnav-extra {
            padding-top: 8px;
            padding-bottom: 8px;
        }

        /* React ベースの新しいナビゲーションスタイル (commits) */
        #sticky-pr-nav nav[aria-label="Pull request navigation tabs"] {
        }

        #sticky-pr-nav .prc-TabNav-TabNavTabList-Ave63 {
            border-bottom: none;
        }

        #sticky-pr-nav .prc-TabNav-TabNavLink-u3umI {
            padding: 8px 12px;
            line-height: 20px;
        }

        #sticky-pr-nav .flex-auto {
        }

        /* sticky-header-backdropがis-stuckの時、クローンナビをその下に配置 */
        #sticky-header-backdrop.is-stuck ~ #sticky-pr-nav,
        #sticky-pr-nav.below-header {
            top: var(--sticky-header-height, 60px);
        }

        /* files-changed ページのレビューツールバー (.pr-toolbar) */
        .pr-toolbar.is-stuck {
            margin-top: 8px !important;
        }

        /* ナビゲーションバーがある場合はツールバーをその下に配置 */
        #sticky-pr-nav.is-visible ~ .pr-toolbar.is-stuck {
            margin-top: 8px !important;
        }

        /* files ページのファイルツリー (Filter changed files) の上にスペースを追加 */
        #sticky-pr-nav-spacer {
            display: none;
            height: 0;
        }

        #sticky-pr-nav-spacer.is-visible {
            display: block;
        }
    `);

    let stickyNav = null;
    let originalNav = null;
    let stickyHeaderBackdrop = null;
    let headerObserver = null;
    let scrollHandler = null;
    let currentPageType = null; // 'conversation', 'commits', 'checks', 'files'

    function detectPageType() {
        const path = window.location.pathname;
        if (path.includes('/commits')) {
            return 'commits';
        } else if (path.includes('/checks')) {
            return 'checks';
        } else if (path.includes('/files') || path.includes('/changes')) {
            return 'files';
        } else {
            return 'conversation';
        }
    }

    function getFilesToolbar() {
        return document.querySelector('[class*="PullRequestFilesToolbar-module__toolbar"]');
    }

    function isFilesToolbarStuck(toolbar) {
        if (!toolbar) return false;
        return [...toolbar.classList].some(c => c.includes('PullRequestFilesToolbar-module__is-stuck'));
    }

    function getChecksHeader() {
        return document.getElementById('checks-header-wrapper');
    }

    function isChecksHeaderStuck(header) {
        if (!header) return false;
        return header.classList.contains('is-stuck');
    }

    function findNavigationElement() {
        // ページタイプを検出
        currentPageType = detectPageType();

        // 1. conversation/checks/files ページ: 従来の .tabnav を探す
        // div.tabnav の中に nav.tabnav-tabs[aria-label="Pull request tabs"] がある
        let nav = document.querySelector('nav.tabnav-tabs[aria-label="Pull request tabs"]')?.closest('.tabnav');
        if (nav) {
            return nav;
        }

        // 2. commits ページ: React ベースの新しいナビゲーションを探す
        // nav.prc-TabNav-TabNavNav-MHmhC の親要素を探す
        nav = document.querySelector('nav[aria-label="Pull request navigation tabs"]');
        if (nav) {
            // 親の div.flex-auto を取得し、適切なコンテナを返す
            const container = nav.closest('.flex-auto');
            if (container) {
                return container;
            }
            return nav;
        }

        // 3. フォールバック: 古いセレクタを試す
        nav = document.querySelector('.pull-request-tab-content')?.previousElementSibling;
        if (nav && nav.classList.contains('tabnav')) {
            return nav;
        }

        nav = document.querySelector('#discussion_bucket')?.previousElementSibling;
        if (nav && nav.classList.contains('tabnav')) {
            return nav;
        }

        return null;
    }

    function init() {
        // 既存のクローンがあれば削除（ページ遷移時の残留を防ぐ）
        const existingNav = document.getElementById('sticky-pr-nav');
        if (existingNav) {
            existingNav.remove();
        }

        // Pull Request ページかどうかを判断
        const path = window.location.pathname;
        if (!path.includes('/pull/')) {
            // Pull Request ページではない場合は処理を終了
            return;
        }

        // オリジナルのナビゲーションを取得
        originalNav = findNavigationElement();

        if (!originalNav) {
            console.log('GitHub PR Sticky Nav: Navigation not found');
            return;
        }

        // sticky-header-backdropを取得
        stickyHeaderBackdrop = document.getElementById('sticky-header-backdrop');

        // クローンを作成
        stickyNav = document.createElement('div');
        stickyNav.id = 'sticky-pr-nav';
        stickyNav.innerHTML = originalNav.outerHTML;
        document.body.appendChild(stickyNav);

        // files ページの場合、ファイルツリーの上にスペーサーを追加
        if (currentPageType === 'files') {
            setupFileTreeSpacer();
        }

        // スクロールイベントとIntersectionObserverの設定
        setupScrollDetection();
        setupHeaderObserver();

        // 初期状態をチェック
        checkVisibility();
    }

    function setupFileTreeSpacer() {
        // 既存のスペーサーを削除
        const existingSpacer = document.getElementById('sticky-pr-nav-spacer');
        if (existingSpacer) {
            existingSpacer.remove();
        }

        // ファイルツリーのコンテナを探す (.subnav-search の親要素)
        const fileTreeFilter = document.querySelector('#file-tree-filter-field');
        if (fileTreeFilter) {
            const container = fileTreeFilter.closest('.subnav-search')?.parentElement;
            if (container) {
                // スペーサーを作成してファイルツリーの前に挿入
                const spacer = document.createElement('div');
                spacer.id = 'sticky-pr-nav-spacer';
                container.insertBefore(spacer, container.firstChild);
            }
        }
    }

    function setupScrollDetection() {
        // IntersectionObserverでオリジナルナビの表示状態を監視
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                // オリジナルナビが画面外に出たら、クローンを表示
                if (!entry.isIntersecting) {
                    showStickyNav();
                } else {
                    hideStickyNav();
                }
            });
        }, {
            root: null,
            rootMargin: '-60px 0px 0px 0px', // ヘッダーの高さを考慮
            threshold: 0
        });

        observer.observe(originalNav);
    }

    function setupHeaderObserver() {
        // sticky-header-backdropのis-stuckクラスを監視
        if (stickyHeaderBackdrop) {
            headerObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.attributeName === 'class') {
                        updateStickyNavPosition();
                    }
                });
            });

            headerObserver.observe(stickyHeaderBackdrop, {
                attributes: true,
                attributeFilter: ['class']
            });
        }

        // 新しいスティッキーPRヘッダーのクラス変化を監視（is-stuckの付加/削除を検知）
        const newStickyHeader = document.querySelector('[class*="StickyPullRequestHeader-module__prHeader"]');
        if (newStickyHeader) {
            const stickyHeaderObserver = new MutationObserver(() => {
                updateStickyNavPosition();
            });
            stickyHeaderObserver.observe(newStickyHeader, {
                attributes: true,
                attributeFilter: ['class']
            });
        }

        // checks ページのヘッダーのクラス変化を監視（is-stuck の付加/削除を検知）
        if (currentPageType === 'checks') {
            const checksHeader = getChecksHeader();
            if (checksHeader) {
                const checksHeaderObserver = new MutationObserver(() => {
                    updateStickyNavPosition();
                });
                checksHeaderObserver.observe(checksHeader, {
                    attributes: true,
                    attributeFilter: ['class']
                });
            }
        }

        // files ページのツールバーのクラス変化を監視（is-stuck の付加/削除を検知）
        if (currentPageType === 'files') {
            const filesToolbar = getFilesToolbar();
            if (filesToolbar) {
                const filesToolbarObserver = new MutationObserver(() => {
                    updateStickyNavPosition();
                    if (stickyNav?.classList.contains('is-visible')) {
                        updateFileTreeSpacer();
                    }
                });
                filesToolbarObserver.observe(filesToolbar, {
                    attributes: true,
                    attributeFilter: ['class']
                });
            }
        }

        // すべてのページでスクロール時に位置を更新
        window.addEventListener('scroll', () => {
            if (stickyNav?.classList.contains('is-visible')) {
                updateStickyNavPosition();
            }
        }, { passive: true });

        // ウィンドウリサイズ時に位置を更新
        window.addEventListener('resize', () => {
            if (stickyNav?.classList.contains('is-visible')) {
                updateStickyNavPosition();
            }
        }, { passive: true });
    }

    function showStickyNav() {
        if (stickyNav) {
            stickyNav.classList.add('is-visible');
            requestAnimationFrame(() => {
                updateStickyNavPosition();
                if (currentPageType === 'files') {
                    updateFileTreeSpacer();
                }
            });
        }
    }

    function updateFileTreeSpacer() {
        const spacer = document.getElementById('sticky-pr-nav-spacer');
        if (!spacer) return;

        const toolbar = getFilesToolbar();
        const stickyNavRect = stickyNav?.getBoundingClientRect();

        if (toolbar && stickyNavRect && stickyNav?.classList.contains('is-visible')) {
            // ナビゲーションバーの下端をスペーサーの高さに設定
            spacer.style.height = `${stickyNavRect.bottom}px`;
            spacer.classList.add('is-visible');
        } else {
            spacer.style.height = '0';
            spacer.classList.remove('is-visible');
        }
    }

    function hideStickyNav() {
        if (stickyNav) {
            stickyNav.classList.remove('is-visible');
            if (currentPageType === 'files') {
                // ファイルツリーのスペーサーを非表示
                const spacer = document.getElementById('sticky-pr-nav-spacer');
                if (spacer) {
                    spacer.style.height = '0';
                    spacer.classList.remove('is-visible');
                }
            }
        }
    }

    function updateStickyNavPosition() {
        if (!stickyNav || !originalNav) return;

        // 元のナビゲーションの水平位置を取得して適用
        const originalRect = originalNav.getBoundingClientRect();
        stickyNav.style.paddingLeft = `${originalRect.left}px`;
        stickyNav.style.paddingRight = `${window.innerWidth - originalRect.right}px`;

        // files ページの場合、ツールバーの下に配置
        if (currentPageType === 'files') {
            const toolbar = getFilesToolbar();
            if (toolbar && isFilesToolbarStuck(toolbar)) {
                const toolbarRect = toolbar.getBoundingClientRect();
                stickyNav.style.top = `${toolbarRect.bottom}px`;
                stickyNav.classList.add('below-header');
                // file-header の位置も更新（ナビゲーションバーの下に配置）
                requestAnimationFrame(() => {
                    const stickyNavRect = stickyNav.getBoundingClientRect();
                    const fileHeaders = document.querySelectorAll('.sticky-file-header');
                    fileHeaders.forEach(header => {
                        header.style.top = `${stickyNavRect.bottom}px`;
                    });
                });
                return;
            }
        }

        // checks ページの場合、#checks-header-wrapper の下に配置
        if (currentPageType === 'checks') {
            const checksHeader = getChecksHeader();
            if (checksHeader && isChecksHeaderStuck(checksHeader)) {
                const headerRect = checksHeader.getBoundingClientRect();
                stickyNav.style.top = `${headerRect.bottom}px`;
                stickyNav.classList.add('below-header');
                return;
            }
        }

        // 1. 新しいスティッキーPRヘッダー（クラス名パターンで検索）を確認
        const newStickyHeader = document.querySelector('[class*="StickyPullRequestHeader-module__prHeader"]');
        if (newStickyHeader) {
            const isStuck = [...newStickyHeader.classList].some(c => c.includes('is-stuck'));
            if (isStuck) {
                const headerRect = newStickyHeader.getBoundingClientRect();
                if (headerRect.bottom > 0) {
                    stickyNav.style.top = `${headerRect.bottom}px`;
                    stickyNav.classList.add('below-header');
                    return;
                }
            }
        }

        // 2. 従来のスティッキーヘッダー構造を確認
        const isHeaderStuck = stickyHeaderBackdrop?.classList.contains('is-stuck');

        if (isHeaderStuck) {
            // 従来のヘッダー構造 (conversation/checks/files ページ) を試す
            const headerWrapper = document.getElementById('partial-discussion-header');
            if (headerWrapper) {
                const stickyHeader = headerWrapper.querySelector('.sticky-header-container');
                if (stickyHeader) {
                    const headerRect = stickyHeader.getBoundingClientRect();
                    const headerBottom = headerRect.bottom;
                    stickyNav.style.top = `${headerBottom}px`;
                    stickyNav.classList.add('below-header');
                    return;
                }
            }

            // フォールバック: CSSカスタムプロパティを使用
            const observedHeight = getComputedStyle(document.documentElement).getPropertyValue('--observed-header-height');
            if (observedHeight) {
                stickyNav.style.top = observedHeight;
            } else {
                stickyNav.style.top = '60px';
            }
            stickyNav.classList.add('below-header');
        } else {
            stickyNav.style.top = '0px';
            stickyNav.classList.remove('below-header');
        }
    }

    function checkVisibility() {
        if (!originalNav) return;

        const rect = originalNav.getBoundingClientRect();

        // スティッキーPRヘッダーが表示中の場合、その高さを考慮
        let headerHeight = 0;
        const newStickyHeader = document.querySelector('[class*="StickyPullRequestHeader-module__prHeader"]');
        if (newStickyHeader) {
            const isStuck = [...newStickyHeader.classList].some(c => c.includes('is-stuck'));
            if (isStuck) {
                headerHeight = newStickyHeader.getBoundingClientRect().bottom;
            }
        }
        if (headerHeight <= 0) {
            headerHeight = 60; // フォールバック
        }

        if (rect.bottom < headerHeight) {
            showStickyNav();
        } else {
            hideStickyNav();
        }
    }

    // ページ読み込み完了後に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Turbo/PJAXナビゲーション対応
    document.addEventListener('turbo:load', init);
    document.addEventListener('pjax:end', init);

    // URLの変更を監視（SPA対応）
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(init, 100);
        }
    }).observe(document, { subtree: true, childList: true });

})();
