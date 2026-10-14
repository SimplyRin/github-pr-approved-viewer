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

    function isPRPage() {
        const path = window.location.pathname;
        // /owner/repo/pull/number の形式をチェック
        const match = path.match(/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/);
        return match !== null;
    }
    function getCodeOwnersUrl() {
        const [, owner, repo] = window.location.pathname.split('/');
        // "wants to merge X commits into {TARGET} from {SOURCE}" のテキストパターンから
        // ターゲットブランチを取得（DOM のクラス名変更に影響されない方法）
        let branch = 'main'; // フォールバック
        const treePrefix = `/${owner}/${repo}/tree/`;
        const links = document.querySelectorAll(`a[href^="${treePrefix}"]`);
        for (const link of links) {
            const parent = link.parentElement;
            if (parent && /wants to merge .+ into/.test(parent.textContent)) {
                branch = decodeURIComponent(link.getAttribute('href').slice(treePrefix.length));
                break;
            }
        }
        return `https://github.com/${owner}/${repo}/blob/${branch}/.github/CODEOWNERS`;
    }
    async function getTeamMembers(owner, team) {
        try {
            const baseUrl = `https://github.com/orgs/${owner}/teams/${team}`;
            let page = 1;
            const list = [];

            while (true) {
                const res = await fetch(`${baseUrl}?page=${page}`);
                const html = await res.text();

                const doc = new DOMParser().parseFromString(html, 'text/html');

                const uls = doc.getElementsByClassName(
                    "member-listing table-list table-list-bordered adminable"
                );

                for (let i = 0; i < uls.length; i++) {
                    const lis = uls[i].getElementsByTagName("li");

                    for (let j = 0; j < lis.length; j++) {
                        const span = lis[j].querySelector('span[itemprop="name"]');

                        if (span) {
                            const name = span.textContent.trim();
                            if (!list.includes(name)) list.push(name);
                        } else {
                            const name = lis[j].textContent.trim();
                            if (!list.includes(name)) list.push(name);
                        }
                    }
                }

                const nextBtn = doc.querySelector('a[rel="next"]');
                if (!nextBtn) break;

                page++;
            }

            return list;
        } catch (e) {
            console.error(e);
        }
    }
    async function fetchDoc(url) {
        const res = await fetch(url);
        const html = await res.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    // GitHub の CSS Modules のクラス名はビルドごとにハッシュ部分が変わる
    // (例: "Diff-module__diffHeaderWrapper__UgUyv" → "diffHeaderWrapper__Ab12Cd")
    // ため、ハッシュを含まない部分一致のセレクタを生成する
    function moduleClassSelector(name) {
        return `[class*="${name}__"]`;
    }

    // オブジェクトを再帰的に探索し、rawLines 配列を探す
    function findRawLines(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 10) return null;
        if (Array.isArray(obj.rawLines) && obj.rawLines.every(l => typeof l === 'string')) {
            return obj.rawLines;
        }
        for (const value of Object.values(obj)) {
            const found = findRawLines(value, depth + 1);
            if (found) return found;
        }
        return null;
    }

    // blob ページの HTML からファイル本文を取り出す（DOM 構成の変更に備えて複数の方法を順に試す）
    function extractBlobText(doc) {
        // 1. React アプリの埋め込みデータ (payload.blob.rawLines)
        for (const script of doc.querySelectorAll('script[data-target="react-app.embeddedData"], script[type="application/json"]')) {
            try {
                const lines = findRawLines(JSON.parse(script.textContent));
                if (lines) return lines.join('\n');
            } catch (e) {
                // JSON でないスクリプトは無視
            }
        }

        // 2. 読み取り専用のテキストエリア
        const textarea = doc.querySelector('#read-only-cursor-text-area');
        if (textarea && textarea.value) return textarea.value;

        // 3. コード表示の各行要素（行単位で取得し、改行で連結する）
        const cells = doc.querySelectorAll('[data-testid="code-cell"], .react-file-line, td.blob-code');
        if (cells.length > 0) {
            return Array.from(cells, cell => cell.textContent.replace(/\n$/, '')).join('\n');
        }

        return null;
    }

    //
    // CODEOWNER 取得
    //
    async function getCodeOwners() {
        try {
            const res = await fetch(getCodeOwnersUrl());
            if (res.status === 404) {
                return false;
            }
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            return extractBlobText(doc) || null;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async function getFilesChanged() {
        const doc = await fetchDoc(`${window.location.href}/changes`);

        const list = [];
        const add = name => {
            name = name && name.trim();
            if (name && !list.includes(name)) list.push(name);
        };

        // React 版の差分ビュー: ファイルヘッダー内の h3 > code
        doc.querySelectorAll(`${moduleClassSelector('diffHeaderWrapper')} h3 code`).forEach(code => add(code.textContent));

        // 従来版の差分ビュー: data 属性にファイルパスを持つ
        if (list.length === 0) {
            doc.querySelectorAll('[data-tagsearch-path], copilot-diff-entry[data-file-path], .file-header[data-path]').forEach(el => {
                add(el.getAttribute('data-tagsearch-path') || el.getAttribute('data-file-path') || el.getAttribute('data-path'));
            });
        }

        list.forEach((name, i) => console.log(`diff[${i}]: ${name}`));

        return list;
    }

    function cleanFileName(name) {
        return name.replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim();
    }

    function findCodeOwners(codeownersText, changedFiles) {
        const rules = codeownersText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                const parts = line.split(/\s+/);
                const pattern = parts[0];
                const owners = parts.slice(1);
                return { pattern, owners };
            });

        const result = [];

        for (let file of changedFiles) {
            file = cleanFileName(file);

            file = ensureLeadingSlash(file);

            let matchedOwners = [];
            let matchedPattern = null;
            let matchedIndex = -1;

            for (let i = 0; i < rules.length; i++) {
                const regex = patternToRegex(ensureLeadingSlash(rules[i].pattern));

                if (regex.test(file)) {
                    matchedOwners = rules[i].owners;
                    matchedPattern = rules[i].pattern;
                    matchedIndex = i;
                }
            }

            result.push({
                file: file,
                codeowner: matchedPattern,
                owners: matchedOwners,
                ruleIndex: matchedIndex
            });
        }

        return result;
    }

    function groupByPattern(result, sortMode, wildcardFirst) {
        const map = new Map();
        for (const row of result) {
            const key = row.codeowner || '(no match)';
            if (!map.has(key)) {
                map.set(key, { codeowner: row.codeowner, owners: row.owners, files: [], ruleIndex: row.ruleIndex });
            }
            map.get(key).files.push(row.file);
        }

        let groups = Array.from(map.values());

        if (sortMode === 'codeowners') {
            // CODEOWNERS ファイルのルール定義順
            groups = groups.sort((a, b) => {
                if (a.ruleIndex === -1 && b.ruleIndex === -1) return 0;
                if (a.ruleIndex === -1) return 1;
                if (b.ruleIndex === -1) return -1;
                return a.ruleIndex - b.ruleIndex;
            });
        } else if (sortMode === 'atoz') {
            // アルファベット順（マッチなしは末尾）
            groups = groups.sort((a, b) => {
                if (a.codeowner === null && b.codeowner === null) return 0;
                if (a.codeowner === null) return 1;
                if (b.codeowner === null) return -1;
                return a.codeowner.localeCompare(b.codeowner);
            });
        }
        // 'default' は Map の挿入順（差分ファイルの処理順）をそのまま維持

        // * を常に先頭に固定するオプション
        if (wildcardFirst) {
            const wildcardIdx = groups.findIndex(g => g.codeowner === '*');
            if (wildcardIdx > 0) {
                const [wildcard] = groups.splice(wildcardIdx, 1);
                groups.unshift(wildcard);
            }
        }

        return groups;
    }

    async function resolveTeamOwners(result) {
        // 未キャッシュのチームを収集
        const uncached = new Set();
        for (const row of result) {
            for (const owner of row.owners) {
                const m = owner.match(/^@([^/]+)\/(.+)$/);
                if (m && !_teamCache.has(owner)) {
                    uncached.add(owner);
                }
            }
        }

        // 未キャッシュのチームのみフェッチ
        for (const teamOwner of uncached) {
            const m = teamOwner.match(/^@([^/]+)\/(.+)$/);
            if (m) {
                const [, org, team] = m;
                const members = await getTeamMembers(org, team);
                _teamCache.set(teamOwner, (members || []).map(u => `@${u}`));
            }
        }

        return result.map(row => {
            const expanded = [];
            for (const owner of row.owners) {
                if (_teamCache.has(owner)) {
                    for (const member of _teamCache.get(owner)) {
                        if (!expanded.includes(member)) expanded.push(member);
                    }
                } else {
                    if (!expanded.includes(owner)) expanded.push(owner);
                }
            }
            return { ...row, owners: expanded };
        });
    }

    function ensureLeadingSlash(path) {
        if (!path.startsWith('/')) {
            return '/' + path;
        }
        return path;
    }

    function patternToRegex(pattern) {
        const normalized = pattern.replace(/^\/+/, '/');

        let regex = normalized
            .replace(/\*\*/g, '\x00GLOBSTAR\x00')
            .replace(/\./g, '\\.')
            .replace(/\*/g, '[^/]*')
            .replace(/\x00GLOBSTAR\x00/g, '.*');

        if (normalized === '/*' || normalized === '/') {
            // ルートワイルドカード: 全ファイルにマッチ
            regex = '^/.*$';
        } else if (normalized.endsWith('/')) {
            // ディレクトリパターン: 配下の全ファイルにマッチ
            regex = '^' + regex + '.*$';
        } else if (!normalized.includes('/')) {
            // スラッシュなし: どのディレクトリのファイルにもマッチ
            regex = '^.*/' + regex.replace(/^\//, '') + '$';
        } else {
            regex = '^' + regex + '$';
        }

        return new RegExp(regex);
    }

    // マージボックス（Reviews / Merging is blocked などを含む領域）を取得する
    function findMergeBox() {
        return document.querySelector('[data-testid="mergebox-partial"]');
    }

    // GitHub 側の CSS Modules（ハッシュ付きクラス名）に依存しないよう、
    // 表示に必要なスタイルは独自クラスとして注入する
    function ensureStyles() {
        if (document.getElementById('codeowner-styles')) return;
        const style = document.createElement('style');
        style.id = 'codeowner-styles';
        style.textContent = `
.codeowner-container {
    position: relative;
}
.codeowner-mergeability-icon {
    display: none;
    position: absolute;
    top: 0;
    left: -55px;
    width: 40px;
    height: 40px;
    align-items: center;
    justify-content: center;
    border-radius: var(--borderRadius-medium, 6px);
    color: var(--fgColor-onEmphasis, #fff);
}
@media (min-width: 1012px) {
    .codeowner-mergeability-icon { display: flex; }
}
.codeowner-box {
    border: var(--borderWidth-thin, 1px) solid var(--borderColor-default, #d1d9e0);
    border-radius: var(--borderRadius-medium, 6px);
    overflow: hidden;
}
.codeowner-header {
    position: relative;
    display: flex;
    gap: var(--base-size-8, 8px);
    padding: var(--base-size-16, 16px);
}
.codeowner-header-can-expand:hover {
    cursor: pointer;
    background: var(--control-transparent-bgColor-hover, rgba(208, 215, 222, 0.32));
}
.codeowner-header-can-expand:focus-within {
    outline: 2px solid var(--focus-outlineColor, #0969da);
    outline-offset: -2px;
}
.codeowner-header-content {
    display: flex;
    flex: 1;
    gap: var(--base-size-8, 8px);
    min-width: 0;
}
.codeowner-heading {
    margin: 0;
    font-size: var(--text-body-size-large, 16px);
    font-weight: var(--base-text-weight-semibold, 600);
    line-height: 1.5;
}
.codeowner-header-description {
    margin: 0;
    color: var(--fgColor-muted, #59636e);
    font-size: var(--text-body-size-medium, 14px);
}
.codeowner-toggle {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    opacity: 0;
    cursor: pointer;
}
.codeowner-chevron {
    display: flex;
    transition: transform 0.2s ease-in-out;
}
.codeowner-chevron.codeowner-is-expanded {
    transform: rotate(90deg);
}
.codeowner-expandable {
    max-height: 300px;
    overflow-y: auto;
    padding: var(--base-size-8, 8px);
    border-top: var(--borderWidth-thin, 1px) solid var(--borderColor-muted, #d1d9e0b3);
    background-color: var(--bgColor-inset, #f6f8fa);
}
.codeowner-expandable[hidden] {
    display: none;
}
@keyframes codeowner-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
}
.codeowner-skel {
    background-color: var(--bgColor-neutral-muted, rgba(175,184,193,0.2));
    border-radius: 6px;
    animation: codeowner-pulse 1.5s ease-in-out infinite;
    display: inline-block;
}
`;
        document.head.appendChild(style);
    }

    const SHIELD_LOCK_ICON = `<svg aria-hidden="true" focusable="false" class="octicon octicon-shield-lock" viewBox="0 0 16 16" width="24" height="24" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM9.5 6.5c0 .536-.286 1.032-.75 1.3v2.45a.75.75 0 0 1-1.5 0V7.8A1.5 1.5 0 1 1 9.5 6.5Z"></path></svg>`;

    // 既存のセクションを置き換えて、マージボックスの直前にセクションの外枠を挿入する
    function insertSectionShell(mergeBox, { iconBg, borderColor, innerHTML, loading = false }) {
        ensureStyles();

        const existing = document.querySelector('div[data-codeowner-section="true"]');
        if (existing) existing.remove();

        const wrapper = document.createElement('div');
        // マージボックスと同じ余白・インデントにする（ユーティリティクラス名の変更にも追従するため既存要素からコピー）
        wrapper.className = mergeBox.className || 'tmp-ml-md-6 tmp-pl-md-3 tmp-my-3';
        wrapper.setAttribute('data-codeowner-section', 'true');

        const container = document.createElement('div');
        container.className = 'codeowner-container';

        const icon = document.createElement('div');
        icon.className = 'codeowner-mergeability-icon';
        icon.style.backgroundColor = iconBg;
        icon.innerHTML = SHIELD_LOCK_ICON;

        const box = document.createElement('div');
        box.className = 'codeowner-box';
        if (borderColor) box.style.borderColor = borderColor;

        const section = document.createElement('section');
        section.setAttribute('aria-label', 'Code owner approval status');
        if (loading) section.setAttribute('data-codeowner-loading', 'true');
        section.innerHTML = innerHTML;

        box.appendChild(section);
        container.appendChild(icon);
        container.appendChild(box);
        wrapper.appendChild(container);

        mergeBox.before(wrapper);

        return section;
    }

    function sectionHeaderHtml({ avatarHtml, titleHtml, descriptionHtml, expandableId }) {
        return `
<div class="codeowner-header${expandableId ? ' codeowner-header-can-expand' : ''}">
    <div class="d-flex width-full">
        <div class="mr-2 flex-shrink-0">
            <div style="overflow: hidden; border-radius: 50%; width: 32px; height: 32px;">
                ${avatarHtml}
            </div>
        </div>
        <div class="codeowner-header-content">
            <div class="flex-1">
                <h3 class="codeowner-heading">${titleHtml}</h3>
                ${descriptionHtml}
            </div>
        </div>
    </div>
    ${expandableId ? `
    <button aria-label="Code owner review" type="button" class="codeowner-toggle" aria-expanded="true" aria-controls="${expandableId}"></button>
    <div class="fgColor-muted pr-2 pt-2">
        <div class="codeowner-chevron codeowner-is-expanded">
            <svg aria-hidden="true" focusable="false" class="octicon octicon-chevron-right" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>
        </div>
    </div>` : ''}
</div>
`;
    }

    function circleIconHtml(bgColor, iconSvg) {
        return `<div style="display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; background-color: ${bgColor}; color: var(--fgColor-onEmphasis, #fff);">${iconSvg}</div>`;
    }

    function insertNoCodeOwnersSection() {
        const mergeBox = findMergeBox();
        if (!mergeBox) return;

        insertSectionShell(mergeBox, {
            iconBg: 'var(--bgColor-neutral-emphasis)',
            innerHTML: sectionHeaderHtml({
                avatarHtml: circleIconHtml(
                    'var(--bgColor-neutral-emphasis)',
                    `<svg aria-hidden="true" focusable="false" class="octicon octicon-alert-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"></path></svg>`
                ),
                titleHtml: 'Code owner review',
                descriptionHtml: '<p class="codeowner-header-description">No .github/CODEOWNERS file found in this repository.</p>',
            }),
        });
    }

    function insertSkeletonSection() {
        const mergeBox = findMergeBox();
        if (!mergeBox) return;

        const skeletonRow = (titleWidth, descWidth) => `
    <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
        <div style="width: 24px; flex-shrink: 0;">
            <span class="codeowner-skel" style="display:block;width:16px;height:16px;border-radius:50%;"></span>
        </div>
        <div style="flex: 2; padding-left: 8px; display:flex; flex-direction:column; gap:4px;">
            <span class="codeowner-skel" style="height:12px;width:${titleWidth}px;"></span>
            <span class="codeowner-skel" style="height:10px;width:${descWidth}px;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:20px;width:20px;border-radius:50%;display:inline-block;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:12px;width:40px;"></span>
        </div>
    </div>`;

        insertSectionShell(mergeBox, {
            iconBg: 'var(--bgColor-neutral-emphasis)',
            loading: true,
            innerHTML: sectionHeaderHtml({
                avatarHtml: '<span class="codeowner-skel" style="display:block;width:32px;height:32px;border-radius:50%;"></span>',
                titleHtml: '<span class="codeowner-skel" style="display:inline-block;height:16px;width:160px;vertical-align:middle;"></span>',
                descriptionHtml: '<span class="codeowner-skel" style="display:inline-block;height:12px;width:220px;margin-top:4px;"></span>',
            }) + `
<div>
    <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
        <div style="width: 24px; flex-shrink: 0;"></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 2; padding-left: 8px;"><span class="codeowner-skel" style="height:10px;width:28px;"></span></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 1;"><span class="codeowner-skel" style="height:10px;width:72px;"></span></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 1;"><span class="codeowner-skel" style="height:10px;width:68px;"></span></div>
    </div>
    ${skeletonRow(80, 200)}
    ${skeletonRow(120, 160)}
</div>
`,
        });
    }

    async function insertCodeOwnerSection(result) {

        const approvedList = getApprovedList();

        if (!findMergeBox()) return;

        // 設定を読み込む
        const settings = await new Promise(resolve => {
            chrome.storage.sync.get({ sortOrder: 'default', wildcardFirst: true }, resolve);
        });

        // 設定の読み込み中に SPA 遷移などでマージボックスが入れ替わっている可能性があるため再取得する
        const mergeBox = findMergeBox();
        if (!mergeBox) return;

        const grouped = groupByPattern(result, settings.sortOrder, settings.wildcardFirst);

        const allApproved = grouped.length > 0 && grouped.every(row => {
            return row.owners && row.owners.length > 0 && row.owners.some(owner => {
                const username = owner.replace('@', '');
                return approvedList[username] === true;
            });
        });

        const headerIconBg = allApproved
            ? 'var(--bgColor-success-emphasis)'
            : 'var(--bgColor-attention-emphasis)';

        const headerIcon = allApproved
            ? `<svg aria-hidden="true" focusable="false" class="octicon octicon-check" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`
            : `<svg aria-hidden="true" focusable="false" class="octicon octicon-dot-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"></path></svg>`;

        const sectionId = 'codeowner-expandable-' + Date.now();

        const container = insertSectionShell(mergeBox, {
            iconBg: headerIconBg,
            borderColor: allApproved
                ? 'var(--borderColor-success, #1a7f37)'
                : 'var(--borderColor-attention, #9a6700)',
            innerHTML: sectionHeaderHtml({
                avatarHtml: circleIconHtml(headerIconBg, headerIcon),
                titleHtml: 'Code owner review',
                descriptionHtml: `<p class="codeowner-header-description">${allApproved ? 'All code owners have approved.' : 'Code owner review required.'}</p>`,
                expandableId: sectionId,
            }) + `
<div id="${sectionId}" class="codeowner-expandable">
            <div class="d-flex flex-items-center p-2 borderColor-muted" style="gap: 0;">
                <div style="width: 24px; flex-shrink: 0;"></div>
                <div class="text-small text-bold fgColor-muted" style="flex: 2; padding-left: 8px;">File</div>
                <div class="text-small text-bold fgColor-muted" style="flex: 1;">Code Owners</div>
                <div class="text-small text-bold fgColor-muted" style="flex: 1;">Approved by</div>
            </div>
            ${(() => {
                const approvedUsersAll = Object.entries(approvedList).filter(([, v]) => v).map(([u]) => u);
                return `
                <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
                    <div style="width: 24px; flex-shrink: 0;">
                        ${approvedUsersAll.length > 0 ? iconApproved() : iconPending()}
                    </div>
                    <div style="flex: 2; padding-left: 8px;">
                        <div class="text-bold text-small">Approved users</div>
                    </div>
                    <div style="flex: 1; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                        <span class="text-small fgColor-muted">-</span>
                    </div>
                    <div style="flex: 1; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                        ${approvedUsersAll.length > 0
                            ? approvedUsersAll.map(u => avatar('@' + u)).join('')
                            : '<span class="text-small fgColor-muted">-</span>'
                        }
                    </div>
                </div>
                `;
            })()}

            ${grouped.map((row, rowIdx) => {
                const rowApproved = row.owners && row.owners.some(owner => {
                    const username = owner.replace('@', '');
                    return approvedList[username] === true;
                });
                const approvedOwners = (row.owners || []).filter(owner => {
                    const username = owner.replace('@', '');
                    return approvedList[username] === true;
                });
                const fileCount = row.files.length;
                const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
                return `
                <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
                    <div style="width: 24px; flex-shrink: 0;">
                        ${rowApproved ? iconApproved() : iconPending()}
                    </div>
                    <div style="flex: 2; padding-left: 8px;">
                        <div class="text-bold text-small">${row.codeowner || '(no match)'}</div>
                        <div class="text-small fgColor-muted">${fileLabel}</div>
                    </div>
                    <div style="flex: 1; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                        ${ownersToggleHtml(row.owners, sectionId + '-row-' + rowIdx)}
                    </div>
                    <div style="flex: 1; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                        ${approvedOwners.length > 0
                            ? approvedOwners.map(owner => avatar(owner)).join('')
                            : '<span class="text-small fgColor-muted">-</span>'
                        }
                    </div>
                </div>
                `;
            }).join('')}
</div>
`,
        });

        const toggleBtn = container.querySelector('.codeowner-toggle');
        const expandable = container.querySelector(`#${sectionId}`);
        const chevron = container.querySelector('.codeowner-chevron');

        toggleBtn.addEventListener('click', () => {
            const expanded = toggleBtn.getAttribute('aria-expanded') !== 'true';
            toggleBtn.setAttribute('aria-expanded', String(expanded));
            expandable.hidden = !expanded;
            chevron.classList.toggle('codeowner-is-expanded', expanded);
        });

        container.querySelectorAll('.codeowner-more-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const hiddenId = btn.dataset.hiddenId;
                const moreCount = btn.dataset.moreCount;
                const hiddenEl = document.getElementById(hiddenId);
                if (!hiddenEl) return;
                const isHidden = hiddenEl.style.display === 'none';
                if (isHidden) {
                    hiddenEl.style.display = 'contents';
                    btn.textContent = 'less';
                } else {
                    hiddenEl.style.display = 'none';
                    btn.textContent = moreCount + ' more';
                }
            });
        });

    }

    function iconApproved() {

        return `
<svg class="octicon octicon-check color-fg-success" width="16" height="16">
<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"></path>
</svg>
`;

    }


    function iconPending() {

        return `
<svg class="octicon octicon-dot-fill color-fg-attention" width="16" height="16">
<path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"></path>
</svg>
`;

    }

    function avatar(user) {

        const u = user.replace('@', '');

        return `
<a
href="https://github.com/${u}"
data-hovercard-type="user"
data-hovercard-url="/users/${u}/hovercard"
style="display:inline-block;line-height:0;"
tabindex="-1">
<img
src="https://github.com/${u}.png"
alt="${user}"
width="20"
height="20"
class="avatar circle">
</a>
`;

    }

    function ownersToggleHtml(owners, idPrefix, threshold = 14) {
        if (!owners || owners.length === 0) {
            return '<span class="text-small fgColor-muted">-</span>';
        }
        if (owners.length <= threshold) {
            return owners.map(o => avatar(o)).join('');
        }
        const visible = owners.slice(0, threshold);
        const hidden = owners.slice(threshold);
        const moreCount = hidden.length;
        const hiddenId = idPrefix + '-hidden';
        const btnId = idPrefix + '-btn';
        return `${visible.map(o => avatar(o)).join('')}<span id="${hiddenId}" style="display:none;">${hidden.map(o => avatar(o)).join('')}</span><button id="${btnId}" type="button" class="codeowner-more-btn text-small" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--fgColor-accent,#0969da);white-space:nowrap;" data-hidden-id="${hiddenId}" data-more-count="${moreCount}">${moreCount} more</button>`;
    }

    function getApprovedList() {
        const results = {};

        // サイドバーの Reviewers 欄: ユーザー名要素と同じ行に承認状態のアイコンが並ぶ
        document.querySelectorAll('[data-hovercard-type="user"][data-assignee-name]').forEach(nameEl => {
            const userName = nameEl.dataset.assigneeName;
            if (!userName) return;

            // 状態アイコンを含む行要素まで遡る（他のレビュアーを含む要素には遡らない）
            let row = nameEl.parentElement;
            while (
                row && row.parentElement &&
                !row.querySelector('.reviewers-status-icon') &&
                row.parentElement.querySelectorAll('[data-assignee-name]').length === 1
            ) {
                row = row.parentElement;
            }
            if (!row) return;

            const isApproved = row.querySelector(
                'svg.octicon-check.color-fg-success, svg.octicon-check.fgColor-success, svg.octicon-check.color-fg-muted, svg.octicon-check.fgColor-muted'
            ) !== null;

            results[userName] = isApproved;
        });

        return results;
    }

    async function main() {
        if (!isPRPage()) {
            return;
        }

        const gen = _generation;

        const codeowner = await getCodeOwners();
        if (gen !== _generation) return;

        if (codeowner === false) {
            insertNoCodeOwnersSection();
            return;
        }

        if (!codeowner) {
            return;
        }

        console.log(`location: ${window.location.href}`);
        const changed = await getFilesChanged();
        if (gen !== _generation) return;

        console.log(`codeowner: ${codeowner}`);
        console.log(`changed: ${changed}`);

        const codeowners = findCodeOwners(codeowner, changed);

        console.log(`result: ${JSON.stringify(codeowners, null, 2)}`);

        const resolved = await resolveTeamOwners(codeowners);
        if (gen !== _generation) return;

        console.log(`resolved: ${JSON.stringify(resolved, null, 2)}`);

        const approvedList = getApprovedList();

        console.log(`approvedList: ${JSON.stringify(approvedList, null, 2)}`);

        _lastResolved = resolved;
        insertCodeOwnerSection(resolved);
    }

    // ページ遷移・SPA ナビゲーションの管理
    let _lastUrl = null;
    let _generation = 0;
    let _navTimer = null;
    let _reviewObserver = null;
    let _lastResolved = null;

    // チームメンバーのセッションキャッシュ（ブラウザ起動中は保持）
    const _teamCache = new Map();

    // 設定変更時にその場で再描画する
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (!isPRPage()) return;
        if (!_lastResolved) return;
        insertCodeOwnerSection(_lastResolved);
    });

    // Reviews セクションの出現を監視し、スケルトンを即時挿入してデータ取得を開始する
    function watchForPRContent() {
        if (_reviewObserver) {
            _reviewObserver.disconnect();
            _reviewObserver = null;
        }

        if (!isPRPage()) return;

        function tryInit() {
            if (findMergeBox()) {
                insertSkeletonSection();
                main();
                return true;
            }
            return false;
        }

        if (!tryInit()) {
            _reviewObserver = new MutationObserver(() => {
                if (tryInit()) {
                    _reviewObserver.disconnect();
                    _reviewObserver = null;
                }
            });
            _reviewObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    function onUrlChange() {
        const url = window.location.href;
        if (url === _lastUrl) return;
        _lastUrl = url;
        _generation++;
        _lastResolved = null;

        // 古いセクションを削除
        const existing = document.querySelector('div[data-codeowner-section="true"]');
        if (existing) existing.remove();

        watchForPRContent();
    }

    function scheduleNavCheck() {
        if (_navTimer) clearTimeout(_navTimer);
        _navTimer = setTimeout(() => {
            _navTimer = null;
            onUrlChange();
        }, 200);
    }

    // 初期実行
    scheduleNavCheck();

    // ページ遷移を検出（SPA対応）
    window.addEventListener('popstate', scheduleNavCheck);

    // GitHub が使用する Turbo / Turbolinks のナビゲーション完了イベントを検出
    document.addEventListener('turbo:load', scheduleNavCheck);
    document.addEventListener('turbolinks:load', scheduleNavCheck);

    // History API による遷移も検出
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function(...args) {
        originalPushState.apply(window.history, args);
        scheduleNavCheck();
    };

    window.history.replaceState = function(...args) {
        originalReplaceState.apply(window.history, args);
        scheduleNavCheck();
    };

})();
