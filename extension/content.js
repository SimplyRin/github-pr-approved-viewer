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
        // PRのベースブランチをDOMから取得、見つからなければ 'main' にフォールバック
        const branch =
            document.querySelector('.base-ref')?.textContent?.trim() ||
            document.querySelector('[data-base-ref]')?.dataset?.baseRef ||
            'main';
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

            const codeowner = doc.querySelector(
                '#copilot-button-positioner > div.CodeBlob-module__codeBlobInner__tfjuQ > div > div.react-code-lines'
            )?.textContent;

            return codeowner || null;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async function getFilesChanged() {
        const doc = await fetchDoc(`${window.location.href}/changes`);

        const elements = doc.getElementsByClassName('Diff-module__diffHeaderWrapper__UgUyv');

        const list = [];

        for (let i = 0; i < elements.length; i++) {
            const code = elements[i].querySelector('h3 code');
            if (code) {
                list.push(code.textContent.trim());
                console.log(`diff[${i}]: ${code.textContent.trim()}`);
            }
        }

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

    function insertNoCodeOwnersSection() {
        const existingSection = document.querySelector('div[data-codeowner-section="true"]');
        if (existingSection) existingSection.remove();

        const mergeBox = document.querySelector('div[data-testid="mergebox-partial"]');
        if (!mergeBox) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'tmp-ml-md-6 tmp-pl-md-3 tmp-my-3';
        wrapper.setAttribute('data-codeowner-section', 'true');

        const mergePartialContainer = document.createElement('div');
        mergePartialContainer.className = 'MergeBox-module__mergePartialContainer__MTXP9 position-relative';

        const borderContainer = document.createElement('div');
        borderContainer.className = 'rounded-2';
        borderContainer.style.border = '1px solid var(--borderColor-default)';
        borderContainer.style.overflow = 'hidden';

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'd-none d-lg-block';
        iconWrapper.innerHTML = `<div class="d-flex flex-justify-center flex-items-center mr-2 rounded-2 height-2 width-2 position-absolute MergeabilityIcon-module__mergeabilityIcon__pgZrk" style="background-color: var(--bgColor-neutral-emphasis);"><svg aria-hidden="true" focusable="false" class="octicon octicon-shield-lock fgColor-onEmphasis" viewBox="0 0 16 16" width="24" height="24" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM9.5 6.5c0 .536-.286 1.032-.75 1.3v2.45a.75.75 0 0 1-1.5 0V7.8A1.5 1.5 0 1 1 9.5 6.5Z"></path></svg></div>`;

        const container = document.createElement('section');
        container.setAttribute('aria-label', 'Code owner approval status');
        container.innerHTML = `
<div class="MergeBoxSectionHeader-module__wrapper___70DU">
    <div class="d-flex width-full">
        <div class="mr-2 flex-shrink-0">
            <div style="overflow: hidden; border-width: 0px; border-radius: 50%; border-style: solid; border-color: var(--borderColor-default); width: 32px; height: 32px;">
                <div style="display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; background-color: var(--bgColor-neutral-emphasis);">
                    <svg aria-hidden="true" focusable="false" class="octicon octicon-alert-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom; color: var(--fgColor-onEmphasis);"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"></path></svg>
                </div>
            </div>
        </div>
        <div class="d-flex flex-1 flex-column flex-sm-row gap-2">
            <div class="flex-1">
                <h3 class="MergeBoxSectionHeader-module__MergeBoxSectionHeading__Kr_f8 prc-Heading-Heading-MtWFE">Code owner review</h3>
                <p class="fgColor-muted mb-0">No .github/CODEOWNERS file found in this repository.</p>
            </div>
        </div>
    </div>
</div>
`;

        borderContainer.appendChild(container);
        mergePartialContainer.appendChild(iconWrapper);
        mergePartialContainer.appendChild(borderContainer);
        wrapper.appendChild(mergePartialContainer);

        mergeBox.before(wrapper);
    }

    function ensureSkeletonStyles() {
        if (document.getElementById('codeowner-skeleton-styles')) return;
        const style = document.createElement('style');
        style.id = 'codeowner-skeleton-styles';
        style.textContent = `
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

    function insertSkeletonSection() {
        ensureSkeletonStyles();

        const mergeBox = document.querySelector('div[data-testid="mergebox-partial"]');
        if (!mergeBox) return;

        const existing = document.querySelector('div[data-codeowner-section="true"]');
        if (existing) existing.remove();

        const wrapper = document.createElement('div');
        wrapper.className = 'tmp-ml-md-6 tmp-pl-md-3 tmp-my-3';
        wrapper.setAttribute('data-codeowner-section', 'true');

        const mergePartialContainer = document.createElement('div');
        mergePartialContainer.className = 'MergeBox-module__mergePartialContainer__MTXP9 position-relative';

        const borderContainer = document.createElement('div');
        borderContainer.className = 'border rounded-2 borderColor-default';

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'd-none d-lg-block';
        iconWrapper.innerHTML = `<div class="d-flex flex-justify-center flex-items-center mr-2 rounded-2 height-2 width-2 position-absolute MergeabilityIcon-module__mergeabilityIcon__pgZrk" style="background-color: var(--bgColor-neutral-emphasis);"><svg aria-hidden="true" focusable="false" class="octicon octicon-shield-lock fgColor-onEmphasis" viewBox="0 0 16 16" width="24" height="24" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM9.5 6.5c0 .536-.286 1.032-.75 1.3v2.45a.75.75 0 0 1-1.5 0V7.8A1.5 1.5 0 1 1 9.5 6.5Z"></path></svg></div>`;

        const container = document.createElement('section');
        container.setAttribute('aria-label', 'Code owner approval status');
        container.setAttribute('data-codeowner-loading', 'true');

        container.innerHTML = `
<div class="MergeBoxSectionHeader-module__wrapper___70DU MergeBoxSectionHeader-module__wrapperCanExpand__iicCN">
    <div class="d-flex width-full">
        <div class="mr-2 flex-shrink-0">
            <div style="overflow: hidden; border-width: 0px; border-radius: 50%; border-style: solid; border-color: var(--borderColor-default); width: 32px; height: 32px;">
                <span class="codeowner-skel" style="display:block;width:32px;height:32px;border-radius:50%;"></span>
            </div>
        </div>
        <div class="d-flex flex-1 flex-column flex-sm-row gap-2">
            <div class="flex-1">
                <h3 class="MergeBoxSectionHeader-module__MergeBoxSectionHeading__Kr_f8 prc-Heading-Heading-MtWFE">
                    <span class="codeowner-skel" style="display:inline-block;height:16px;width:160px;vertical-align:middle;"></span>
                </h3>
                <span class="codeowner-skel" style="display:inline-block;height:12px;width:220px;margin-top:4px;"></span>
            </div>
        </div>
    </div>
</div>
<div>
    <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
        <div style="width: 24px; flex-shrink: 0;"></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 2; padding-left: 8px;"><span class="codeowner-skel" style="height:10px;width:28px;"></span></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 1;"><span class="codeowner-skel" style="height:10px;width:72px;"></span></div>
        <div class="text-small text-bold fgColor-muted" style="flex: 1;"><span class="codeowner-skel" style="height:10px;width:68px;"></span></div>
    </div>
    <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
        <div style="width: 24px; flex-shrink: 0;">
            <span class="codeowner-skel" style="display:block;width:16px;height:16px;border-radius:50%;"></span>
        </div>
        <div style="flex: 2; padding-left: 8px; display:flex; flex-direction:column; gap:4px;">
            <span class="codeowner-skel" style="height:12px;width:80px;"></span>
            <span class="codeowner-skel" style="height:10px;width:200px;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:20px;width:20px;border-radius:50%;display:inline-block;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:12px;width:40px;"></span>
        </div>
    </div>
    <div class="d-flex flex-items-center p-2 border-top borderColor-muted" style="gap: 0;">
        <div style="width: 24px; flex-shrink: 0;">
            <span class="codeowner-skel" style="display:block;width:16px;height:16px;border-radius:50%;"></span>
        </div>
        <div style="flex: 2; padding-left: 8px; display:flex; flex-direction:column; gap:4px;">
            <span class="codeowner-skel" style="height:12px;width:120px;"></span>
            <span class="codeowner-skel" style="height:10px;width:160px;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:20px;width:20px;border-radius:50%;display:inline-block;"></span>
        </div>
        <div style="flex: 1;">
            <span class="codeowner-skel" style="height:12px;width:40px;"></span>
        </div>
    </div>
</div>
`;

        borderContainer.appendChild(container);
        mergePartialContainer.appendChild(iconWrapper);
        mergePartialContainer.appendChild(borderContainer);
        wrapper.appendChild(mergePartialContainer);

        mergeBox.before(wrapper);
    }

    async function insertCodeOwnerSection(result) {

        // スケルトンまたは既存のセクションを削除
        const existingSection = document.querySelector('div[data-codeowner-section="true"]');
        if (existingSection) existingSection.remove();

        const approvedList = getApprovedList();

        const mergeBox = document.querySelector('div[data-testid="mergebox-partial"]');

        if (!mergeBox) return;

        // 設定を読み込む
        const settings = await new Promise(resolve => {
            chrome.storage.sync.get({ sortOrder: 'default', wildcardFirst: true }, resolve);
        });

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
            ? `<svg aria-hidden="true" focusable="false" class="octicon octicon-check" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom; color: var(--fgColor-onEmphasis);"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"></path></svg>`
            : `<svg aria-hidden="true" focusable="false" class="octicon octicon-dot-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom; color: var(--fgColor-onEmphasis);"><path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"></path></svg>`;

        const sectionId = 'codeowner-expandable-' + Date.now();

        const wrapper = document.createElement('div');
        wrapper.className = 'tmp-ml-md-6 tmp-pl-md-3 tmp-my-3';
        wrapper.setAttribute('data-codeowner-section', 'true');

        const mergePartialContainer = document.createElement('div');
        mergePartialContainer.className = 'MergeBox-module__mergePartialContainer__MTXP9 position-relative';

        const borderContainer = document.createElement('div');
        borderContainer.className = 'rounded-2';
        borderContainer.style.border = allApproved
            ? '1px solid var(--borderColor-success, #1a7f37)'
            : '1px solid var(--borderColor-attention, #9a6700)';
        borderContainer.style.overflow = 'hidden';

        const container = document.createElement("section");
        container.setAttribute("aria-label", "Code owner approval status");

        container.innerHTML = `
<div class="MergeBoxSectionHeader-module__wrapper___70DU MergeBoxSectionHeader-module__wrapperCanExpand__iicCN">
    <div class="d-flex width-full">
        <div class="mr-2 flex-shrink-0">
            <div style="overflow: hidden; border-width: 0px; border-radius: 50%; border-style: solid; border-color: var(--borderColor-default); width: 32px; height: 32px;">
                <div style="display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; background-color: ${headerIconBg};">
                    ${headerIcon}
                </div>
            </div>
        </div>
        <div class="d-flex flex-1 flex-column flex-sm-row gap-2">
            <div class="flex-1">
                <h3 class="MergeBoxSectionHeader-module__MergeBoxSectionHeading__Kr_f8 prc-Heading-Heading-MtWFE">Code owner review</h3>
                <p class="fgColor-muted mb-0">${allApproved ? 'All code owners have approved.' : 'Code owner review required.'}</p>
            </div>
        </div>
    </div>
    <button aria-label="Code owner review" type="button" class="MergeBoxSectionHeader-module__button__R1r_x" aria-expanded="true" aria-controls="${sectionId}"></button>
    <div class="fgColor-muted pr-2 pt-2">
        <div style="transition: transform 0.15s ease-in-out;">
            <svg aria-hidden="true" focusable="false" class="octicon octicon-chevron-up" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 1 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z"></path></svg>
        </div>
    </div>
</div>
<div id="${sectionId}" class="MergeBoxExpandable-module__expandableWrapper__IcZEm MergeBoxExpandable-module__isExpanded__WZlhA" style="visibility: visible;">
    <div class="MergeBoxExpandable-module__expandableContent__xCBlh MergeBoxExpandable-module__isExpanded__WZlhA">
        <div class="ReviewerSection-module__reviewerGroupsContainer__it7zd">
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
    </div>
</div>
`;

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'd-none d-lg-block';
        iconWrapper.innerHTML = `<div class="d-flex flex-justify-center flex-items-center mr-2 rounded-2 height-2 width-2 position-absolute MergeabilityIcon-module__mergeabilityIcon__pgZrk" style="background-color: ${headerIconBg};"><svg aria-hidden="true" focusable="false" class="octicon octicon-shield-lock fgColor-onEmphasis" viewBox="0 0 16 16" width="24" height="24" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM9.5 6.5c0 .536-.286 1.032-.75 1.3v2.45a.75.75 0 0 1-1.5 0V7.8A1.5 1.5 0 1 1 9.5 6.5Z"></path></svg></div>`;

        borderContainer.appendChild(container);
        mergePartialContainer.appendChild(iconWrapper);
        mergePartialContainer.appendChild(borderContainer);
        wrapper.appendChild(mergePartialContainer);

        mergeBox.before(wrapper);

        const toggleBtn = container.querySelector('.MergeBoxSectionHeader-module__button__R1r_x');
        const expandable = container.querySelector(`#${sectionId}`);
        const chevron = container.querySelector('.fgColor-muted.pr-2.pt-2 > div');

        toggleBtn.addEventListener('click', () => {
            const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            if (isExpanded) {
                toggleBtn.setAttribute('aria-expanded', 'false');
                expandable.classList.remove('MergeBoxExpandable-module__isExpanded__WZlhA');
                expandable.style.visibility = 'hidden';
                chevron.style.transform = 'rotate(180deg)';
            } else {
                toggleBtn.setAttribute('aria-expanded', 'true');
                expandable.classList.add('MergeBoxExpandable-module__isExpanded__WZlhA');
                expandable.style.visibility = 'visible';
                chevron.style.transform = '';
            }
        });

        wrapper.querySelectorAll('.codeowner-more-btn').forEach(btn => {
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
        const reviewerRows = document.querySelectorAll('form.js-issue-sidebar-form p.d-flex');

        reviewerRows.forEach(row => {
            const nameEl = row.querySelector('span[data-hovercard-type="user"]');
            if (!nameEl) return;

            const userName = nameEl.dataset.assigneeName;

            const isApproved = row.querySelector('svg.octicon-check.color-fg-success, svg.octicon-check.color-fg-muted') !== null;

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
            if (document.querySelector('div[data-testid="mergebox-partial"]')) {
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
