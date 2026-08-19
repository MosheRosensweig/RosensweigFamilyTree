/**
 * Rosensweig Family Tree - CSV-based Parser & Renderer
 * Fetches the family tree data from a Google Spreadsheet CSV
 * and renders an interactive, collapsible tree view.
 */

const SPREADSHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1ACLX4txK8fj_KTWEkWI1OyzqtRUAdds1E-NPljAVRUo/export?format=csv';

const CORS_PROXIES = [
    (url) => url,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1LMeR4x4cZbSG3LYVtNmvTJlaNYCOCrBnE684N32ML7i3huce4mGTMi5kpWWaAYA6/exec'; // Deploy the Apps Script (see google_apps_script.js) and paste the URL here

// ============================================
// DATA STATE
// ============================================

let currentTreeData = null;
let parsedRows = [];
let totalMemberCount = 0;
let isCountRevealed = false;

// ============================================
// CSV PARSER
// ============================================

function parseCSV(text) {
    const lines = text.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const row = [];
        let inQuotes = false;
        let currentToken = '';
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(currentToken.trim());
                currentToken = '';
            } else {
                currentToken += char;
            }
        }
        row.push(currentToken.trim());
        result.push(row);
    }
    return result;
}

function processFamilyCSV(csvText) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];
    const result = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 4) continue;
        const placement = (r[0] || '').trim();
        const lastName = (r[1] || '').trim();
        const maidenName = (r[2] || '').trim();
        const firstName = (r[3] || '').trim();
        const middleName = (r[4] || '').trim();
        const hebrewName = (r[5] || '').trim();
        const nickname = (r[6] || '').trim();
        const hebrewBirthDate = (r[7] || '').trim();
        const englishBirthDate = (r[8] || '').trim();
        const hebrewYartzeit = (r[9] || '').trim();
        const englishYartzeit = (r[10] || '').trim();
        const address = (r[11] || '').trim();
        const email = (r[12] || '').trim();
        if (!placement) continue;
        result.push({
            placement, lastName, maidenName, firstName, middleName,
            hebrewName, nickname, hebrewBirthDate, englishBirthDate,
            hebrewYartzeit, englishYartzeit, address, email
        });
    }
    return result;
}

// ============================================
// NAME DISPLAY
// ============================================

function buildDisplayName(person) {
    if (!person) return '?';
    const primary = person.nickname || person.hebrewName || person.firstName || '?';
    const parts = [primary];
    const firstName = person.firstName || '';
    const middleName = person.middleName || '';
    const hebrewName = person.hebrewName || '';
    const nameInParens = [];
    if (firstName && firstName !== primary) {
        nameInParens.push(firstName);
    }
    if (middleName) {
        if (nameInParens.length > 0) {
            nameInParens.push(middleName);
        } else if (middleName !== primary) {
            nameInParens.push(middleName);
        }
    }
    if (nameInParens.length > 0) {
        parts.push('(' + nameInParens.join(' ') + ')');
    }
    if (hebrewName && hebrewName !== primary && hebrewName !== firstName) {
        parts.push(hebrewName);
    }
    return parts.join(' ');
}

function buildCoupleDisplayName(personData, spouseData) {
    const personName = buildDisplayName(personData);
    if (!spouseData) return escapeHtml(personName);
    const spouseName = buildDisplayName(spouseData);
    const maidenPart = spouseData.maidenName ? ' (' + escapeHtml(spouseData.maidenName) + ')' : '';
    const lastName = personData.lastName || spouseData.lastName || '';
    return '<span class="person-name">' + escapeHtml(personName) + ' <span class="amp">&amp;</span> ' + escapeHtml(spouseName) + maidenPart + ' ' + escapeHtml(lastName) + '</span>';
}

// ============================================
// TREE BUILDER (from placement codes)
// ============================================

function buildTree(rows) {
    const bloodRelatives = {};
    const spouses = {};
    let rootPerson = null;
    let rootSpouse = null;

    rows.forEach(row => {
        const p = row.placement;
        row.displayName = buildDisplayName(row);
        if (p === '1a') {
            rootPerson = row;
        } else if (p === '1b') {
            rootSpouse = row;
        } else if (isSpousePlacement(p)) {
            spouses[p] = row;
        } else {
            bloodRelatives[p] = row;
        }
    });

    function isSpousePlacement(p) {
        if (p.endsWith('+')) return true;
        if (p.match(/\.\+\d+$/)) return true;
        return false;
    }

    function findSpousePlacement(bloodPlacement) {
        const directSpouse = bloodPlacement + '+';
        if (spouses[directSpouse]) return directSpouse;
        for (const key of Object.keys(spouses)) {
            const base = key.replace(/\+$/, '');
            if (base === bloodPlacement) return key;
        }
        return null;
    }

    function getChildPlacements(parentPlacement) {
        const prefix = parentPlacement + '.';
        const childSet = [];
        Object.keys(bloodRelatives).forEach(p => {
            if (!p.startsWith(prefix)) return;
            const suffix = p.slice(prefix.length);
            if (/^\d+$/.test(suffix)) {
                childSet.push({ placement: p, num: parseInt(suffix, 10) });
            }
        });
        childSet.sort((a, b) => a.num - b.num);
        return childSet;
    }

    function buildNode(placement) {
        const person = bloodRelatives[placement];
        if (!person) return null;
        const spousePlacement = findSpousePlacement(placement);
        const spouse = spousePlacement ? spouses[spousePlacement] : null;
        const node = { person, spouse, children: [], placement };
        const children = getChildPlacements(placement);
        children.forEach(child => {
            const childNode = buildNode(child.placement);
            if (childNode) node.children.push(childNode);
        });
        return node;
    }

    if (!rootPerson) return null;

    const root = {
        person: rootPerson,
        spouse: rootSpouse,
        children: [],
        placement: '1'
    };

    const rootChildren = getChildPlacements('1');
    rootChildren.forEach(child => {
        const childNode = buildNode(child.placement);
        if (childNode) root.children.push(childNode);
    });

    return root;
}

// ============================================
// TREE RENDERER
// ============================================

function renderTree(root) {
    currentTreeData = root;
    const container = document.getElementById('tree-root');
    container.innerHTML = '';
    container.appendChild(renderRootNode(root));
    const branchesEl = document.createElement('div');
    branchesEl.className = 'branches';
    root.children.forEach((child, index) => {
        branchesEl.appendChild(renderBranch(child, 1, index));
    });
    container.appendChild(branchesEl);
    updateStats(root);
}

function renderRootNode(node) {
    const el = document.createElement('div');
    el.className = 'tree-root-node';
    const coupleHtml = buildCoupleDisplayName(node.person, node.spouse);
    el.innerHTML = '<div>' + coupleHtml + '</div><div class="person-detail">Saba &amp; Mimi</div>';
    return el;
}

function renderBranch(node, generation, siblingIndex) {
    const hasChildren = node.children && node.children.length > 0;
    if (!hasChildren) return renderLeafNode(node, generation);

    const container = document.createElement('div');
    container.className = 'branch-container gen-' + generation;
    container.dataset.name = (node.person.displayName || '').toLowerCase();

    const header = document.createElement('div');
    header.className = 'branch-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const expandIcon = '<div class="expand-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></div>';

    const displayNum = isCountRevealed ? (node.person.placement || '•') : '•';
    const numberBadge = '<span class="branch-number" data-number="' + escapeHtml(node.person.placement) + '">' + displayNum + '</span>';

    const nameHtml = buildCoupleDisplayName(node.person, node.spouse);

    const childCount = countDescendants(node);
    const plural = childCount !== 1 ? 's' : '';
    const countText = isCountRevealed ? childCount + ' descendant' + plural : 'B"H descendant' + plural;
    const revealedClass = isCountRevealed ? ' revealed' : '';
    const countBadge = '<button class="child-count' + revealedClass + '" data-count="' + childCount + '" title="Click for count options">' + countText + '</button>';

    const birthdayBadgeHtml = hasAnyDate(node) ? '<button class="node-birthday-badge" title="View birthday & yahrzeit information">🎂</button>' : '';

    const personInfoBadgeHtml = (node.person.address || node.person.email) ? '<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>' : '';

    header.innerHTML = expandIcon + numberBadge + '<span class="person-name">' + nameHtml + '</span>' + countBadge + birthdayBadgeHtml + personInfoBadgeHtml;

    const countBtn = header.querySelector('.child-count');
    if (countBtn) {
        countBtn.addEventListener('click', e => {
            e.stopPropagation();
            showBHModal();
        });
    }

    const bdayBtn = header.querySelector('.node-birthday-badge');
    if (bdayBtn) {
        bdayBtn.addEventListener('click', e => {
            e.stopPropagation();
            showPersonBirthdayModal(node);
        });
    }

    if (node.person.address || node.person.email) {
        header.classList.add('has-contact');
        const badgeBtn = header.querySelector('.contact-badge');
        if (badgeBtn) {
            badgeBtn.addEventListener('click', e => {
                e.stopPropagation();
                showContactModal(node);
            });
        }
    }

    const content = document.createElement('div');
    content.className = 'branch-content';
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'branch-children';
    node.children.forEach((child, idx) => {
        childrenContainer.appendChild(renderBranch(child, generation + 1, idx));
    });
    content.appendChild(childrenContainer);
    container.appendChild(header);
    container.appendChild(content);

    header.addEventListener('click', e => {
        if (!e.target.closest('.contact-badge') && !e.target.closest('.node-birthday-badge') && !e.target.closest('.child-count')) {
            toggleBranch(header, content);
        }
    });
    header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleBranch(header, content);
        }
    });
    return container;
}

function renderLeafNode(node, generation) {
    const el = document.createElement('div');
    el.className = 'leaf-node gen-' + generation;
    el.dataset.name = (node.person.displayName || '').toLowerCase();

    const nameHtml = buildCoupleDisplayName(node.person, node.spouse);
    const birthdayBadgeHtml = hasAnyDate(node) ? '<button class="node-birthday-badge" title="View birthday & yahrzeit information">🎂</button>' : '';
    const personInfoBadgeHtml = (node.person.address || node.person.email) ? '<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>' : '';

    el.innerHTML = '<span class="leaf-dot"></span><span class="person-name">' + nameHtml + '</span>' + birthdayBadgeHtml + personInfoBadgeHtml;

    const bdayBtn = el.querySelector('.node-birthday-badge');
    if (bdayBtn) {
        bdayBtn.addEventListener('click', e => {
            e.stopPropagation();
            showPersonBirthdayModal(node);
        });
    }

    if (node.person.address || node.person.email) {
        el.classList.add('has-contact');
        const badgeBtn = el.querySelector('.contact-badge');
        if (badgeBtn) {
            badgeBtn.addEventListener('click', e => {
                e.stopPropagation();
                showContactModal(node);
            });
        }
        el.addEventListener('click', e => {
            if (!e.target.closest('.contact-badge') && !e.target.closest('.node-birthday-badge')) {
                showContactModal(node);
            }
        });
    }

    return el;
}

function toggleBranch(header, content) {
    const isExpanded = header.classList.contains('expanded');
    if (isExpanded) {
        header.classList.remove('expanded');
        content.classList.remove('expanded');
        header.setAttribute('aria-expanded', 'false');
    } else {
        header.classList.add('expanded');
        content.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
    }
}

function hasAnyDate(node) {
    if (!node || !node.person) return false;
    const p = node.person;
    if (p.hebrewBirthDate || p.englishBirthDate || p.hebrewYartzeit || p.englishYartzeit) return true;
    if (node.spouse) {
        const s = node.spouse;
        if (s.hebrewBirthDate || s.englishBirthDate || s.hebrewYartzeit || s.englishYartzeit) return true;
    }
    return false;
}

// ============================================
// STATS & UTILITIES
// ============================================

function countDescendants(node) {
    if (!node.children || node.children.length === 0) return 0;
    let count = node.children.length;
    node.children.forEach(child => { count += countDescendants(child); });
    return count;
}

function countAllMembers(node) {
    let count = 1;
    if (node.spouse) count++;
    if (node.children) {
        node.children.forEach(child => { count += countAllMembers(child); });
    }
    return count;
}

function getMaxDepth(node) {
    if (!node.children || node.children.length === 0) return 1;
    let maxChildDepth = 0;
    node.children.forEach(child => {
        const d = getMaxDepth(child);
        if (d > maxChildDepth) maxChildDepth = d;
    });
    return 1 + maxChildDepth;
}

function updateStats(root) {
    const total = countAllMembers(root);
    const generations = getMaxDepth(root);
    const branches = root.children ? root.children.length : 0;
    totalMemberCount = total;
    updateAllCounts();
    animateNumber('stat-gen-number', generations);
    animateNumber('stat-families-number', branches);
}

function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const duration = 1200;
    const startTime = performance.now();
    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(target * eased);
        el.textContent = current;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getAllNodes(root) {
    if (!root) return [];
    const list = [];
    function traverse(node) {
        list.push(node);
        if (node.children) node.children.forEach(traverse);
    }
    traverse(root);
    return list;
}

// ============================================
// SEARCH & AUTOCOMPLETE
// ============================================

let currentMatches = [];
let currentMatchIndex = -1;
let autocompleteItems = [];
let selectedAutocompleteIndex = -1;

function setupSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    const dropdown = document.getElementById('autocomplete-dropdown');
    const resultsLabel = document.getElementById('search-results');
    const addMemberBtn = document.getElementById('add-member-btn');
    let debounceTimer;

    function checkUnlock(val) {
        const cleaned = (val || '').toLowerCase().replace(/['""'']/g, '').trim();
        if (cleaned === 'add member' || cleaned === 'addmember') {
            if (addMemberBtn) addMemberBtn.style.setProperty('display', 'inline-flex', 'important');
            input.value = '';
            if (clearBtn) clearBtn.classList.remove('visible');
            clearSearch();
            hideAutocomplete();
            if (resultsLabel) {
                resultsLabel.textContent = '✨ Add Member unlocked';
                setTimeout(() => { if (resultsLabel.textContent === '✨ Add Member unlocked') resultsLabel.textContent = ''; }, 4000);
            }
            return true;
        }
        return false;
    }

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value;
        if (checkUnlock(query)) return;
        clearBtn.classList.toggle('visible', query.trim().length > 0);
        debounceTimer = setTimeout(() => {
            const qTrim = input.value.trim();
            if (qTrim.length === 0) { clearSearch(); hideAutocomplete(); resultsLabel.textContent = ''; return; }
            performSearch(qTrim);
        }, 150);
    });

    input.addEventListener('keydown', e => {
        if (checkUnlock(input.value)) { e.preventDefault(); return; }
        const isDropdownVisible = dropdown && dropdown.style.display !== 'none' && autocompleteItems.length > 0;
        if (e.key === 'ArrowDown') {
            if (isDropdownVisible) { e.preventDefault(); selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, autocompleteItems.length - 1); updateSelectedAutocompleteItem(); }
        } else if (e.key === 'ArrowUp') {
            if (isDropdownVisible) { e.preventDefault(); selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1); updateSelectedAutocompleteItem(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (isDropdownVisible && selectedAutocompleteIndex >= 0) {
                selectAutocompleteItem(selectedAutocompleteIndex);
            } else if (currentMatches.length > 0) {
                hideAutocomplete();
                currentMatchIndex = e.shiftKey
                    ? (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length
                    : (currentMatchIndex + 1) % currentMatches.length;
                focusMatch(currentMatchIndex);
            }
        } else if (e.key === 'Escape') {
            hideAutocomplete();
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.remove('visible');
        clearSearch();
        hideAutocomplete();
        resultsLabel.textContent = '';
        input.focus();
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-container')) hideAutocomplete();
    });
}

function calculateMatchScore(query, text) {
    const q = query.trim().toLowerCase();
    const t = text.toLowerCase();
    if (t === q) return 1000;
    if (t.startsWith(q)) return 800;
    const words = t.split(/[\s(),&]+/);
    for (let i = 0; i < words.length; i++) {
        if (words[i].startsWith(q)) return 600 - (i * 10);
    }
    const idx = t.indexOf(q);
    if (idx !== -1) return 400 - idx;
    return 0;
}

function getAncestorPath(node) {
    const pathParts = [];
    let current = node.parentElement;
    while (current) {
        if (current.classList.contains('branch-container')) {
            const header = current.querySelector(':scope > .branch-header');
            if (header && header !== node) {
                const nameEl = header.querySelector('.person-name');
                if (nameEl) pathParts.unshift(nameEl.textContent.replace(/\s+/g, ' ').trim());
            }
        }
        current = current.parentElement;
    }
    return pathParts.join(' > ');
}

function performSearch(query) {
    const resultsLabel = document.getElementById('search-results');
    const normalizedQuery = query.toLowerCase();
    clearSearch();
    const allNodes = document.querySelectorAll('.leaf-node, .branch-header');
    const matchesWithScores = [];

    allNodes.forEach(node => {
        const nameEl = node.querySelector('.person-name');
        if (!nameEl) return;
        const text = nameEl.textContent;
        const normalizedText = text.toLowerCase();
        if (normalizedText.includes(normalizedQuery)) {
            expandParents(node);
            highlightText(nameEl, query);
            const container = node.closest('.branch-container') || node;
            container.classList.add('search-match');
            const score = calculateMatchScore(query, text);
            const path = getAncestorPath(node);
            matchesWithScores.push({ node, name: text.replace(/\s+/g, ' ').trim(), path, score });
        }
    });

    matchesWithScores.sort((a, b) => b.score - a.score);
    currentMatches = matchesWithScores.map(m => m.node);
    autocompleteItems = matchesWithScores;
    selectedAutocompleteIndex = -1;

    if (currentMatches.length > 0) {
        currentMatchIndex = 0;
        focusMatch(0, false);
        renderAutocomplete(query);
    } else {
        currentMatchIndex = -1;
        hideAutocomplete();
        resultsLabel.textContent = 'No matches found';
    }
}

function focusMatch(index, scroll) {
    if (scroll === undefined) scroll = true;
    const resultsLabel = document.getElementById('search-results');
    document.querySelectorAll('.active-search-match').forEach(el => el.classList.remove('active-search-match'));
    if (index < 0 || index >= currentMatches.length) return;
    const activeNode = currentMatches[index];
    activeNode.classList.add('active-search-match');
    resultsLabel.textContent = 'Match ' + (index + 1) + ' of ' + currentMatches.length + ' (Press Enter for next)';
    if (scroll) activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAutocomplete(query) {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown) return;
    if (autocompleteItems.length === 0) { hideAutocomplete(); return; }
    dropdown.innerHTML = '';
    autocompleteItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item' + (index === selectedAutocompleteIndex ? ' selected' : '');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'autocomplete-item-name';
        nameDiv.innerHTML = highlightMatchHTML(item.name, query);
        div.appendChild(nameDiv);
        if (item.path) {
            const pathDiv = document.createElement('div');
            pathDiv.className = 'autocomplete-item-path';
            pathDiv.textContent = item.path;
            div.appendChild(pathDiv);
        }
        div.addEventListener('click', e => { e.stopPropagation(); selectAutocompleteItem(index); });
        dropdown.appendChild(div);
    });
    dropdown.style.display = 'block';
}

function highlightMatchHTML(text, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return escapeHtml(text);
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + query.length);
    const after = text.substring(idx + query.length);
    return escapeHtml(before) + '<span class="search-highlight">' + escapeHtml(match) + '</span>' + escapeHtml(after);
}

function updateSelectedAutocompleteItem() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, idx) => {
        if (idx === selectedAutocompleteIndex) { item.classList.add('selected'); item.scrollIntoView({ block: 'nearest' }); }
        else item.classList.remove('selected');
    });
}

function selectAutocompleteItem(index) {
    if (index < 0 || index >= autocompleteItems.length) return;
    const item = autocompleteItems[index];
    const input = document.getElementById('search-input');
    input.value = item.name;
    hideAutocomplete();
    currentMatchIndex = index;
    focusMatch(index, true);
}

function hideAutocomplete() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    selectedAutocompleteIndex = -1;
}

function highlightText(element, query) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);
        if (index === -1) return;
        const before = text.substring(0, index);
        const match = text.substring(index, index + query.length);
        const after = text.substring(index + query.length);
        const span = document.createElement('span');
        span.className = 'search-highlight';
        span.textContent = match;
        const parent = textNode.parentNode;
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(span);
        if (after) frag.appendChild(document.createTextNode(after));
        parent.replaceChild(frag, textNode);
    });
}

function expandParents(node) {
    let current = node.parentElement;
    while (current) {
        if (current.classList.contains('branch-content')) {
            current.classList.add('expanded');
            const header = current.previousElementSibling;
            if (header && header.classList.contains('branch-header')) {
                header.classList.add('expanded');
                header.setAttribute('aria-expanded', 'true');
            }
        }
        current = current.parentElement;
    }
}

function clearSearch() {
    document.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
    });
    document.querySelectorAll('.search-match').forEach(el => el.classList.remove('search-match'));
    document.querySelectorAll('.active-search-match').forEach(el => el.classList.remove('active-search-match'));
    currentMatches = [];
    currentMatchIndex = -1;
    autocompleteItems = [];
    selectedAutocompleteIndex = -1;
}

// ============================================
// EXPAND / COLLAPSE ALL
// ============================================

function setupControls() {
    document.getElementById('expand-all').addEventListener('click', () => {
        document.querySelectorAll('.branch-header').forEach(header => {
            header.classList.add('expanded');
            header.setAttribute('aria-expanded', 'true');
        });
        document.querySelectorAll('.branch-content').forEach(content => content.classList.add('expanded'));
    });
    document.getElementById('collapse-all').addEventListener('click', () => {
        document.querySelectorAll('.branch-header').forEach(header => {
            header.classList.remove('expanded');
            header.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.branch-content').forEach(content => content.classList.remove('expanded'));
    });
    document.getElementById('refresh-btn').addEventListener('click', () => loadFamilyTree());
}

// ============================================
// HEBREW CALENDAR MODULE
// ============================================

const HEBREW_MONTH_MAP = {
    'תשרי': 'Tishrei', 'חשון': 'Cheshvan', 'מרחשון': 'Cheshvan', 'כסלו': 'Kislev', 'כסליו': 'Kislev',
    'טבת': 'Tevet', 'שבט': 'Shevat', 'אדר': 'Adar', 'אדר א': 'Adar I', 'אדר ב': 'Adar II',
    'ניסן': 'Nisan', 'אייר': 'Iyyar', 'סיון': 'Sivan', 'סיוון': 'Sivan', 'תמוז': 'Tamuz',
    'אב': 'Av', 'מנחם אב': 'Av', 'אלול': 'Elul'
};

const HEBREW_DAY_LETTERS = [
    '', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י',
    'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ',
    'כא', 'כב', 'כג', 'כד', 'כה', 'כו', 'כז', 'כח', 'כט', 'ל'
];

function formatHebrewDayName(dayNum) {
    if (!dayNum || dayNum < 1 || dayNum > 30) return '';
    const name = HEBREW_DAY_LETTERS[dayNum];
    if (name.length === 1) return name + '\u05F3';
    return name.slice(0, 1) + '\u05F4' + name.slice(1);
}

function parseHebrewBirthdayString(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let clean = raw.replace(/\(.*?\)/g, '').replace(/['"\u05F4\u05F3\u201D\u201C]/g, '').trim();
    clean = clean.replace(/\s+/g, ' ');
    if (!clean) return null;
    let foundMonth = null;
    let foundKey = '';
    const monthKeys = Object.keys(HEBREW_MONTH_MAP).sort((a, b) => b.length - a.length);
    for (const k of monthKeys) {
        if (clean.includes(k)) { foundMonth = HEBREW_MONTH_MAP[k]; foundKey = k; break; }
    }
    if (!foundMonth) return null;
    let dayStr = clean.replace(foundKey, '').trim();
    if (dayStr.startsWith('ב ')) dayStr = dayStr.substring(2).trim();
    const valMap = { 'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'כ':20,'ל':30 };
    let dayNum = 0;
    if (/^\d+$/.test(dayStr)) {
        dayNum = parseInt(dayStr, 10);
    } else {
        for (const char of dayStr) { if (valMap[char]) dayNum += valMap[char]; }
    }
    return { raw: raw.trim(), month: foundMonth, day: dayNum, monthHe: foundKey };
}

function parseEnglishBirthdayString(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const clean = raw.trim();
    if (!clean) return null;
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    let foundMonthIdx = -1;
    let foundMonthName = '';
    for (let i = 0; i < months.length; i++) {
        if (clean.toLowerCase().includes(months[i].toLowerCase()) || clean.toLowerCase().includes(months[i].substring(0, 3).toLowerCase())) {
            foundMonthIdx = i;
            foundMonthName = months[i];
            break;
        }
    }
    if (foundMonthIdx === -1) {
        const slashMatch = clean.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
        if (slashMatch) {
            const m = parseInt(slashMatch[1], 10) - 1;
            const d = parseInt(slashMatch[2], 10);
            if (m >= 0 && m <= 11) {
                return { raw: clean, monthIdx: m, monthName: months[m], day: d };
            }
        }
        return null;
    }
    const dayMatch = clean.match(/(\d{1,2})/);
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;
    return { raw: clean, monthIdx: foundMonthIdx, monthName: foundMonthName, day };
}

function formatHebrewYear(numYear) {
    const y = parseInt(numYear, 10);
    if (isNaN(y)) return numYear || '';
    let rem = y % 1000;
    let str = '';
    const hundreds = [{ v:400,l:'ת' },{ v:300,l:'ש' },{ v:200,l:'ר' },{ v:100,l:'ק' }];
    for (const h of hundreds) { while (rem >= h.v) { str += h.l; rem -= h.v; } }
    const tens = [{ v:90,l:'צ' },{ v:80,l:'פ' },{ v:70,l:'ע' },{ v:60,l:'ס' },{ v:50,l:'נ' },{ v:40,l:'מ' },{ v:30,l:'ל' },{ v:20,l:'כ' },{ v:10,l:'י' }];
    if (rem === 15) { str += 'טו'; rem = 0; }
    else if (rem === 16) { str += 'טז'; rem = 0; }
    else { for (const t of tens) { if (rem >= t.v) { str += t.l; rem -= t.v; break; } } }
    const units = [{ v:9,l:'ט' },{ v:8,l:'ח' },{ v:7,l:'ז' },{ v:6,l:'ו' },{ v:5,l:'ה' },{ v:4,l:'ד' },{ v:3,l:'ג' },{ v:2,l:'ב' },{ v:1,l:'א' }];
    for (const u of units) { if (rem >= u.v) { str += u.l; rem -= u.v; break; } }
    if (str.length === 1) return str + '\u05F3';
    if (str.length > 1) return str.slice(0, -1) + '\u05F4' + str.slice(-1);
    return numYear.toString();
}

function getHebrewDateInfo(date) {
    const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
    const partsHe = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
    const monthPart = parts.find(p => p.type === 'month');
    const dayPart = parts.find(p => p.type === 'day');
    const yearPart = parts.find(p => p.type === 'year');
    const monthHePart = partsHe.find(p => p.type === 'month');
    const yearHePart = partsHe.find(p => p.type === 'year');
    const numYear = yearPart ? yearPart.value.replace(/[^0-9]/g, '') : '';
    const formattedHeYear = numYear ? formatHebrewYear(numYear) : (yearHePart ? yearHePart.value : '');
    return {
        month: monthPart ? monthPart.value : '',
        day: dayPart ? parseInt(dayPart.value, 10) : 1,
        year: formattedHeYear,
        monthHe: monthHePart ? monthHePart.value : ''
    };
}

function matchesHebrewHoliday(holidayHDate, targetHDate) {
    if (!holidayHDate || !holidayHDate.month || !holidayHDate.day) return false;
    if (holidayHDate.day !== targetHDate.day) return false;
    return holidayHDate.month === targetHDate.month;
}

function matchesHebrewDate(personHDate, targetHDate) {
    if (!personHDate || !personHDate.month || !personHDate.day) return false;
    if (personHDate.day !== targetHDate.day) return false;
    let pMonth = personHDate.month;
    let tMonth = targetHDate.month;
    if (tMonth === 'Adar' && (pMonth === 'Adar I' || pMonth === 'Adar II')) pMonth = 'Adar';
    return pMonth === tMonth;
}

function matchesEnglishDate(personEDate, targetDate) {
    if (!personEDate || personEDate.monthIdx < 0 || !personEDate.day) return false;
    return personEDate.monthIdx === targetDate.getMonth() && personEDate.day === targetDate.getDate();
}

// ============================================
// BIRTHDAY & YAHRZEIT ENGINE
// ============================================

function getBirthdayEventsForNode(node) {
    if (!node || !node.person) return [];
    const results = [];
    function processPerson(person, role) {
        const hebrewParsed = parseHebrewBirthdayString(person.hebrewBirthDate);
        const englishParsed = parseEnglishBirthdayString(person.englishBirthDate);
        const hebrewYartParsed = parseHebrewBirthdayString(person.hebrewYartzeit);
        const englishYartParsed = parseEnglishBirthdayString(person.englishYartzeit);
        if (hebrewParsed || englishParsed || hebrewYartParsed || englishYartParsed) {
            results.push({
                name: [person.displayName || person.firstName, person.lastName].filter(Boolean).join(' '),
                role,
                hebrewParsed, englishParsed,
                hebrewYartParsed, englishYartParsed,
                hebrewRaw: person.hebrewBirthDate,
                englishRaw: person.englishBirthDate,
                hebrewYartRaw: person.hebrewYartzeit,
                englishYartRaw: person.englishYartzeit
            });
        }
    }
    processPerson(node.person, 'primary');
    if (node.spouse) processPerson(node.spouse, 'spouse');
    return results;
}

// ============================================
// CONTACT MODAL SETUP (address + email only)
// ============================================

function setupContactModal() {
    const overlay = document.getElementById('person-info-overlay');
    const closeBtn = document.getElementById('person-info-close');
    const dismissBtn = document.getElementById('person-info-dismiss');
    const hide = () => { const m = document.getElementById('person-info-modal'); if (m) m.style.display = 'none'; };
    if (overlay) overlay.addEventListener('click', hide);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (dismissBtn) dismissBtn.addEventListener('click', hide);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}

// ============================================
// PERSON BIRTHDAY MODAL
// ============================================

function setupPersonBirthdayModal() {
    const overlay = document.getElementById('person-bday-overlay');
    const closeBtn = document.getElementById('person-bday-close');
    const dismissBtn = document.getElementById('person-bday-dismiss');
    const hide = () => { const m = document.getElementById('person-birthday-modal'); if (m) m.style.display = 'none'; };
    if (overlay) overlay.addEventListener('click', hide);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (dismissBtn) dismissBtn.addEventListener('click', hide);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}

function showPersonBirthdayModal(node) {
    const modal = document.getElementById('person-birthday-modal');
    const titleEl = document.getElementById('person-bday-title');
    const subtitleEl = document.getElementById('person-bday-subtitle');
    const bodyEl = document.getElementById('person-bday-body');
    if (!modal || !bodyEl) return;

    const events = getBirthdayEventsForNode(node);
    let displayName = node.person.displayName;
    if (node.spouse) displayName += ' & ' + node.spouse.displayName;

    titleEl.textContent = '🎂 Birthday Information';
    subtitleEl.textContent = 'Birthdays for ' + displayName;

    if (events.length === 0) {
        bodyEl.innerHTML = '<div style="text-align:center;padding:1.5rem 0.5rem;"><div style="font-size:2.2rem;margin-bottom:0.5rem;">📅</div><p style="color:var(--text-primary);font-weight:500;">No birthday on record yet for ' + escapeHtml(displayName) + '.</p><p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.25rem;">You can add their birthday using the <strong>Add Member</strong> button above.</p></div>';
    } else {
        bodyEl.innerHTML = events.map(item => {
            let html = '<div style="margin-bottom:0.75rem;">';
            html += '<h4 style="color:var(--gold-200);font-size:1rem;">👤 ' + escapeHtml(item.name) + (item.role === 'spouse' ? ' <span style="font-size:0.8rem;opacity:0.7;font-weight:normal;">(Spouse)</span>' : '') + '</h4>';
            html += '<div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem;">';
            html += '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;"><span>🎂 <strong>English:</strong></span><span>' + (item.englishRaw ? escapeHtml(item.englishRaw) : '<span style="color:var(--text-muted);font-style:italic;">Not listed</span>') + '</span></div>';
            html += '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;"><span>📜 <strong>Hebrew:</strong></span><span style="color:var(--gold-200);font-weight:500;">' + (item.hebrewRaw ? escapeHtml(item.hebrewRaw) : '<span style="color:var(--text-muted);font-style:italic;">Not listed</span>') + '</span></div>';
            html += '</div></div>';
            return html;
        }).join('');
    }
    modal.style.display = 'flex';
}

// ============================================
// CONTACT MODAL (address + email only)
// ============================================

function showContactModal(node) {
    const modal = document.getElementById('person-info-modal');
    const titleEl = document.getElementById('person-info-title');
    const subtitleEl = document.getElementById('person-info-subtitle');
    const bodyEl = document.getElementById('person-info-body');
    if (!modal || !bodyEl) return;

    let displayName = node.person.displayName;
    if (node.spouse) displayName += ' & ' + node.spouse.displayName;

    titleEl.textContent = '📇 Contact Details';
    subtitleEl.textContent = 'Contact info for ' + displayName;

    let html = '';
    function addPersonSection(person, role) {
        if (!person) return;
        const name = buildDisplayName(person);
        const roleLabel = role === 'spouse' ? ' <span style="font-size:0.8rem;opacity:0.7;font-weight:normal;">(Spouse)</span>' : '';
        const hasContact = person.address || person.email;
        if (!hasContact) return;
        html += '<div style="margin-bottom:0.75rem;">';
        html += '<h4 style="color:var(--gold-200);font-size:1rem;">👤 ' + escapeHtml(name) + roleLabel + '</h4>';
        html += '<div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem;">';
        if (person.address) {
            html += '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;"><span>🏠 <strong>Address:</strong></span><span>' + escapeHtml(person.address) + '</span></div>';
        }
        if (person.email) {
            html += '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;"><span>📧 <strong>Email:</strong></span><a href="mailto:' + escapeHtml(person.email) + '" style="color:var(--gold-400);text-decoration:none;">' + escapeHtml(person.email) + '</a></div>';
        }
        html += '</div></div>';
    }
    addPersonSection(node.person, 'primary');
    if (node.spouse) addPersonSection(node.spouse, 'spouse');

    if (!html) {
        html = '<div style="text-align:center;padding:1.5rem 0.5rem;"><p style="color:var(--text-muted);">No contact information on record for ' + escapeHtml(displayName) + '.</p></div>';
    }

    bodyEl.innerHTML = html;
    modal.style.display = 'flex';
}

// ============================================
// BIRTHDAY & YAHRZEIT POPUP MODAL
// ============================================

function setupBirthdayPopup() {
    const btn = document.getElementById('birthdays-btn');
    const modal = document.getElementById('birthdays-popup-modal');
    const overlay = document.getElementById('bday-popup-overlay');
    const closeBtn = document.getElementById('bday-popup-close');
    const dismissBtn = document.getElementById('bday-popup-dismiss');
    if (btn) btn.addEventListener('click', () => renderBirthdayPopup(true));
    const hide = () => { if (modal) modal.style.display = 'none'; };
    if (overlay) overlay.addEventListener('click', hide);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (dismissBtn) dismissBtn.addEventListener('click', hide);
}

function renderBirthdayPopup(triggerUserAction) {
    const modal = document.getElementById('birthdays-popup-modal');
    const banner = document.getElementById('bday-popup-today-banner');
    const todayList = document.getElementById('bday-today-list');
    const recentList = document.getElementById('bday-recent-list');
    const upcomingList = document.getElementById('bday-upcoming-list');
    if (!modal || !todayList || !recentList || !upcomingList) return;

    const now = new Date();
    const todayHDate = getHebrewDateInfo(now);
    const enTodayStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const heTodayStr = formatHebrewDayName(todayHDate.day) + ' ' + (todayHDate.monthHe || todayHDate.month) + ' ' + todayHDate.year;
    if (banner) banner.textContent = 'Today: ' + enTodayStr + ' \u2022 ' + heTodayStr;

    const todayMatches = [];
    const recentMatches = [];
    const upcomingMatches = [];

    if (!currentTreeData) return;
    const allNodes = getAllNodes(currentTreeData);

    allNodes.forEach(node => {
        const events = getBirthdayEventsForNode(node);
        events.forEach(evt => {
            const dateInfos = [];
            if (evt.englishParsed) dateInfos.push({ type: 'birthday', calType: 'English Birthday', parsed: evt.englishParsed, raw: evt.englishRaw });
            if (evt.hebrewParsed) dateInfos.push({ type: 'birthday', calType: 'Hebrew Birthday', parsed: evt.hebrewParsed, raw: evt.hebrewRaw });
            if (evt.englishYartParsed) dateInfos.push({ type: 'yahrzeit', calType: 'English Yahrzeit', parsed: evt.englishYartParsed, raw: evt.englishYartRaw });
            if (evt.hebrewYartParsed) dateInfos.push({ type: 'yahrzeit', calType: 'Hebrew Yahrzeit', parsed: evt.hebrewYartParsed, raw: evt.hebrewYartRaw });

            dateInfos.forEach(di => {
                const isEngDate = di.type === 'birthday' && di.parsed && di.parsed.monthIdx >= 0;
                const isHebDate = di.type === 'birthday' && di.parsed && di.parsed.month;
                const isEngYart = di.type === 'yahrzeit' && di.parsed && di.parsed.monthIdx >= 0;
                const isHebYart = di.type === 'yahrzeit' && di.parsed && di.parsed.month;

                let isToday = false;
                let isRecent = false;
                let isUpcoming = false;
                let todayReason = '';
                let recentReason = '';
                let upcomingReason = '';

                if (isHebDate && matchesHebrewDate(di.parsed, todayHDate)) { isToday = true; todayReason = di.calType + ' Today'; }
                if (isEngDate && matchesEnglishDate(di.parsed, now)) { isToday = true; todayReason = todayReason ? todayReason + ' & English' : di.calType + ' Today'; }
                if (isHebYart && matchesHebrewDate(di.parsed, todayHDate)) { isToday = true; todayReason = di.calType + ' Today'; }
                if (isEngYart && matchesEnglishDate(di.parsed, now)) { isToday = true; todayReason = todayReason ? todayReason + ' & English' : di.calType + ' Today'; }

                if (!isToday) {
                    for (let diff = 1; diff <= 7; diff++) {
                        const pastDate = new Date(now.getTime() - diff * 86400000);
                        const pastHDate = getHebrewDateInfo(pastDate);
                        const daysAgoStr = diff === 1 ? '1 day ago' : diff + ' days ago';
                        let match = false;
                        let reason = '';
                        if (isHebDate && matchesHebrewDate(di.parsed, pastHDate)) { match = true; reason = di.calType + ' (' + daysAgoStr + ')'; }
                        if (isEngDate && matchesEnglishDate(di.parsed, pastDate)) { match = true; reason = reason ? reason + ' & English' : di.calType + ' (' + daysAgoStr + ')'; }
                        if (isHebYart && matchesHebrewDate(di.parsed, pastHDate)) { match = true; reason = di.calType + ' (' + daysAgoStr + ')'; }
                        if (isEngYart && matchesEnglishDate(di.parsed, pastDate)) { match = true; reason = reason ? reason + ' & English' : di.calType + ' (' + daysAgoStr + ')'; }
                        if (match) { isRecent = true; recentReason = reason; break; }
                    }
                }

                if (!isToday && !isRecent) {
                    for (let diff = 1; diff <= 7; diff++) {
                        const futureDate = new Date(now.getTime() + diff * 86400000);
                        const futureHDate = getHebrewDateInfo(futureDate);
                        const inDaysStr = diff === 1 ? 'Tomorrow' : 'in ' + diff + ' days';
                        let match = false;
                        let reason = '';
                        if (isHebDate && matchesHebrewDate(di.parsed, futureHDate)) { match = true; reason = di.calType + ' (' + inDaysStr + ')'; }
                        if (isEngDate && matchesEnglishDate(di.parsed, futureDate)) { match = true; reason = reason ? reason + ' & English' : di.calType + ' (' + inDaysStr + ')'; }
                        if (isHebYart && matchesHebrewDate(di.parsed, futureHDate)) { match = true; reason = di.calType + ' (' + inDaysStr + ')'; }
                        if (isEngYart && matchesEnglishDate(di.parsed, futureDate)) { match = true; reason = reason ? reason + ' & English' : di.calType + ' (' + inDaysStr + ')'; }
                        if (match) { isUpcoming = true; upcomingReason = reason; break; }
                    }
                }

                if (isToday) {
                    todayMatches.push({ name: evt.name, reason: todayReason, raw: di.raw, type: di.type });
                } else if (isRecent) {
                    recentMatches.push({ name: evt.name, reason: recentReason, raw: di.raw, type: di.type });
                } else if (isUpcoming) {
                    upcomingMatches.push({ name: evt.name, reason: upcomingReason, raw: di.raw, type: di.type });
                }
            });
        });
    });

    function renderItems(matches, listEl, emptyMsg, isTodayList) {
        if (matches.length > 0) {
            listEl.innerHTML = matches.map(m => {
                const icon = m.type === 'yahrzeit' ? '🕯️' : '🎂';
                const cls = isTodayList ? 'bday-item today-item' : 'bday-item';
                return '<div class="' + cls + '"><div class="bday-name">' + icon + ' ' + escapeHtml(m.name) + '</div><div class="bday-tags"><span class="bday-badge gold">' + escapeHtml(m.reason) + '</span>' + (m.raw ? '<span class="bday-badge">' + escapeHtml(m.raw) + '</span>' : '') + '</div></div>';
            }).join('');
        } else {
            listEl.innerHTML = '<p class="bday-empty">' + emptyMsg + '</p>';
        }
    }

    renderItems(todayMatches, todayList, 'No birthdays or yahrzeits today.', true);
    renderItems(recentMatches, recentList, 'No birthdays or yahrzeits in the last 7 days.', false);
    renderItems(upcomingMatches, upcomingList, 'No birthdays or yahrzeits in the next 7 days.', false);

    if (triggerUserAction || todayMatches.length > 0 || recentMatches.length > 0 || upcomingMatches.length > 0) {
        modal.style.display = 'flex';
    }
}

// ============================================
// FULL-YEAR & MONTHLY CALENDAR ENGINE
// ============================================

const JEWISH_HOLIDAYS_FIXED_HEBREW = [
    { month: 'Tishrei', day: 1, name: 'Rosh Hashana I', he: 'ראש השנה א׳', type: 'jewish' },
    { month: 'Tishrei', day: 2, name: 'Rosh Hashana II', he: 'ראש השנה ב׳', type: 'jewish' },
    { month: 'Tishrei', day: 3, name: 'Tzom Gedaliah', he: 'צום גדליה', type: 'jewish' },
    { month: 'Tishrei', day: 10, name: 'Yom Kippur', he: 'יום כיפור', type: 'jewish' },
    { month: 'Tishrei', day: 15, name: 'Sukkot I', he: 'סוכות א׳', type: 'jewish' },
    { month: 'Tishrei', day: 16, name: 'Sukkot II', he: 'סוכות ב׳', type: 'jewish' },
    { month: 'Tishrei', day: 17, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 18, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 19, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 20, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 21, name: 'Hoshana Rabba', he: 'הושענא רבה', type: 'jewish' },
    { month: 'Tishrei', day: 22, name: 'Shemini Atzeret', he: 'שמיני עצרת', type: 'jewish' },
    { month: 'Tishrei', day: 23, name: 'Simchat Torah', he: 'שמחת תורה', type: 'jewish' },
    { month: 'Kislev', day: 25, name: 'Chanukah I', he: 'חנוכה א׳', type: 'jewish' },
    { month: 'Kislev', day: 26, name: 'Chanukah II', he: 'חנוכה ב׳', type: 'jewish' },
    { month: 'Kislev', day: 27, name: 'Chanukah III', he: 'חנוכה ג׳', type: 'jewish' },
    { month: 'Kislev', day: 28, name: 'Chanukah IV', he: 'חנוכה ד׳', type: 'jewish' },
    { month: 'Kislev', day: 29, name: 'Chanukah V', he: 'חנוכה ה׳', type: 'jewish' },
    { month: 'Kislev', day: 30, name: 'Chanukah VI', he: 'חנוכה ו׳', type: 'jewish' },
    { month: 'Tevet', day: 1, name: 'Chanukah VII', he: 'חנוכה ז׳', type: 'jewish' },
    { month: 'Tevet', day: 2, name: 'Chanukah VIII', he: 'חנוכה ח׳', type: 'jewish' },
    { month: 'Tevet', day: 10, name: "Asara B'Tevet (Fast)", he: 'עשרה בטבת', type: 'jewish' },
    { month: 'Shevat', day: 15, name: 'Tu BiShvat', he: 'ט״ו בשבט', type: 'jewish' },
    { month: 'Adar', day: 13, name: "Ta'anit Esther", he: 'תענית אסתר', type: 'jewish' },
    { month: 'Adar', day: 14, name: 'Purim', he: 'פורים', type: 'jewish' },
    { month: 'Adar', day: 15, name: 'Shushan Purim', he: 'שושן פורים', type: 'jewish' },
    { month: 'Adar I', day: 14, name: 'Purim Katan', he: 'פורים קטן', type: 'jewish' },
    { month: 'Adar I', day: 15, name: 'Shushan Purim Katan', he: 'שושן פורים קטן', type: 'jewish' },
    { month: 'Adar II', day: 13, name: "Ta'anit Esther", he: 'תענית אסתר', type: 'jewish' },
    { month: 'Adar II', day: 14, name: 'Purim', he: 'פורים', type: 'jewish' },
    { month: 'Adar II', day: 15, name: 'Shushan Purim', he: 'שושן פורים', type: 'jewish' },
    { month: 'Nisan', day: 14, name: 'Erev Pesach', he: 'ערב פסח', type: 'jewish' },
    { month: 'Nisan', day: 15, name: 'Pesach I', he: 'פסח א׳', type: 'jewish' },
    { month: 'Nisan', day: 16, name: 'Pesach II', he: 'פסח ב׳', type: 'jewish' },
    { month: 'Nisan', day: 17, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 18, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 19, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 20, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 21, name: 'Pesach VII', he: 'שביעי של פסח', type: 'jewish' },
    { month: 'Nisan', day: 22, name: 'Pesach VIII', he: 'אחרון של פסח', type: 'jewish' },
    { month: 'Nisan', day: 27, name: 'Yom HaShoah', he: 'יום השואה', type: 'jewish' },
    { month: 'Iyyar', day: 4, name: 'Yom HaZikaron', he: 'יום הזיכרון', type: 'israel' },
    { month: 'Iyyar', day: 5, name: 'Yom HaAtzmaut', he: 'יום העצמאות', type: 'israel' },
    { month: 'Iyyar', day: 18, name: 'Lag BaOmer', he: 'ל״ג בעומר', type: 'jewish' },
    { month: 'Iyyar', day: 28, name: 'Yom Yerushalayim', he: 'יום ירושלים', type: 'israel' },
    { month: 'Sivan', day: 6, name: 'Shavuot I', he: 'שבועות א׳', type: 'jewish' },
    { month: 'Sivan', day: 7, name: 'Shavuot II', he: 'שבועות ב׳', type: 'jewish' },
    { month: 'Tamuz', day: 17, name: "Shiva Asar B'Tammuz (Fast)", he: 'י״ז בתמוז', type: 'jewish' },
    { month: 'Av', day: 9, name: "Tisha B'Av (Fast)", he: 'תשעה באב', type: 'jewish' },
    { month: 'Av', day: 15, name: "Tu B'Av", he: 'ט״ו באב', type: 'jewish' }
];

function getUSHolidaysForYear(year) {
    const list = [];
    list.push({ monthIdx: 0, day: 1, name: "New Year's Day", type: 'us' });
    list.push({ monthIdx: 5, day: 19, name: 'Juneteenth', type: 'us' });
    list.push({ monthIdx: 6, day: 4, name: 'Independence Day', type: 'us' });
    list.push({ monthIdx: 10, day: 11, name: 'Veterans Day', type: 'us' });
    list.push({ monthIdx: 11, day: 25, name: 'Christmas Day', type: 'us' });
    const getNthWeekday = (mIdx, targetDayOfWeek, n) => {
        let count = 0;
        for (let d = 1; d <= 31; d++) {
            const date = new Date(year, mIdx, d);
            if (date.getMonth() !== mIdx) break;
            if (date.getDay() === targetDayOfWeek) { count++; if (count === n) return d; }
        }
        return null;
    };
    const getLastWeekday = (mIdx, targetDayOfWeek) => {
        let lastDay = 1;
        for (let d = 1; d <= 31; d++) {
            const date = new Date(year, mIdx, d);
            if (date.getMonth() !== mIdx) break;
            if (date.getDay() === targetDayOfWeek) lastDay = d;
        }
        return lastDay;
    };
    list.push({ monthIdx: 0, day: getNthWeekday(0, 1, 3), name: 'MLK Day', type: 'us' });
    list.push({ monthIdx: 1, day: getNthWeekday(1, 1, 3), name: "Presidents' Day", type: 'us' });
    list.push({ monthIdx: 4, day: getLastWeekday(4, 1), name: 'Memorial Day', type: 'us' });
    list.push({ monthIdx: 8, day: getNthWeekday(8, 1, 1), name: 'Labor Day', type: 'us' });
    list.push({ monthIdx: 9, day: getNthWeekday(9, 1, 2), name: 'Columbus Day', type: 'us' });
    list.push({ monthIdx: 10, day: getNthWeekday(10, 4, 4), name: 'Thanksgiving', type: 'us' });
    return list;
}

let calendarState = {
    year: new Date().getFullYear(),
    monthIdx: new Date().getMonth(),
    viewMode: 'year'
};

function renderCalendarEngine() {
    const container = document.getElementById('calendar-content-area');
    if (!container) return;
    container.innerHTML = '';
    const targetYear = calendarState.year;
    const usHolidays = getUSHolidaysForYear(targetYear);
    const monthsToRender = calendarState.viewMode === 'year'
        ? [0,1,2,3,4,5,6,7,8,9,10,11]
        : [calendarState.monthIdx];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Shabbat'];

    monthsToRender.forEach(mIdx => {
        const monthSheet = document.createElement('div');
        monthSheet.className = 'calendar-month-sheet';
        monthSheet.dataset.monthIdx = mIdx;
        monthSheet.dataset.monthName = monthNames[mIdx] + ' ' + targetYear;

        const firstDate = new Date(targetYear, mIdx, 1);
        const lastDate = new Date(targetYear, mIdx + 1, 0);
        const totalDays = lastDate.getDate();
        const startDayOfWeek = firstDate.getDay();

        const firstHDate = getHebrewDateInfo(firstDate);
        const lastHDate = getHebrewDateInfo(lastDate);
        const hebrewMonthRange = firstHDate.monthHe === lastHDate.monthHe
            ? firstHDate.monthHe + ' ' + firstHDate.year
            : firstHDate.monthHe + ' \u2013 ' + lastHDate.monthHe + ' ' + firstHDate.year;
        monthSheet.dataset.hebrewRange = hebrewMonthRange;

        monthSheet.innerHTML = '<div class="calendar-month-header"><div class="cal-month-title">' + monthNames[mIdx] + ' ' + targetYear + '</div><div class="cal-month-legend-inline"><span class="cal-event-tag cal-badge-hebrew-bday">🎈 Hebrew Birthday</span><span class="cal-event-tag cal-badge-english-bday">🎂 English Birthday</span><span class="cal-event-tag cal-badge-hebrew-yahrzeit">🕯️ Hebrew Yahrzeit</span><span class="cal-event-tag cal-badge-english-yahrzeit">🕯️ English Yahrzeit</span><span class="cal-event-tag cal-badge-jewish-holiday">✡️ Jewish Holiday</span><span class="cal-event-tag cal-badge-us-holiday">🇺🇸 US Holiday</span><span class="cal-event-tag cal-badge-israel-holiday">🇮🇱 Israel Holiday</span><span class="cal-event-tag cal-badge-rosh-chodesh">🌙 Rosh Chodesh</span></div><div class="cal-hebrew-month-subtitle">' + hebrewMonthRange + '</div></div><table class="calendar-grid-table"><thead><tr>' + weekdayNames.map(w => '<th>' + w + '</th>').join('') + '</tr></thead><tbody id="cal-tbody-' + mIdx + '"></tbody></table>';
        const tbody = monthSheet.querySelector('#cal-tbody-' + mIdx);
        let currentDay = 1;
        let weekRow = document.createElement('tr');

        for (let i = 0; i < startDayOfWeek; i++) {
            const prevMonthLastDay = new Date(targetYear, mIdx, 0).getDate();
            const dayNum = prevMonthLastDay - startDayOfWeek + i + 1;
            const td = document.createElement('td');
            td.className = 'cal-other-month';
            td.innerHTML = '<div class="cal-day-header"><span class="cal-secular-date">' + dayNum + '</span></div>';
            weekRow.appendChild(td);
        }

        const today = new Date();
        const isCurrentRealMonth = today.getFullYear() === targetYear && today.getMonth() === mIdx;

        while (currentDay <= totalDays) {
            if (weekRow.children.length === 7) { tbody.appendChild(weekRow); weekRow = document.createElement('tr'); }
            const thisDate = new Date(targetYear, mIdx, currentDay);
            const hDate = getHebrewDateInfo(thisDate);
            const td = document.createElement('td');
            if (isCurrentRealMonth && today.getDate() === currentDay) td.classList.add('cal-today');

            const events = [];

            if (hDate.day === 1 || hDate.day === 30) {
                events.push({ text: hDate.day === 1 ? '\uD83C\uDF19 \u05E8\u05D0\u05F4\u05D7 ' + hDate.monthHe : '\uD83C\uDF19 \u05E8\u05D0\u05F4\u05D7', type: 'rosh-chodesh', badgeClass: 'cal-badge-rosh-chodesh' });
            }

            JEWISH_HOLIDAYS_FIXED_HEBREW.forEach(jh => {
                if (matchesHebrewHoliday(jh, hDate)) {
                    events.push({ text: (jh.type === 'israel' ? '\uD83C\uDDF1\uD83C\uDDEE ' : '\u2721\uFE0F ') + jh.name, type: jh.type, badgeClass: jh.type === 'israel' ? 'cal-badge-israel-holiday' : 'cal-badge-jewish-holiday' });
                }
            });

            usHolidays.forEach(uh => {
                if (uh.monthIdx === mIdx && uh.day === currentDay) {
                    events.push({ text: '\uD83C\uDDFA\uD83C\uDDF8 ' + uh.name, type: 'us', badgeClass: 'cal-badge-us-holiday' });
                }
            });

            if (currentTreeData) {
                const allNodes = getAllNodes(currentTreeData);
                allNodes.forEach(node => {
                    function checkPerson(person) {
                        if (!person) return;
                        if (person.englishBirthDate) {
                            const eParsed = parseEnglishBirthdayString(person.englishBirthDate);
                            if (eParsed && matchesEnglishDate(eParsed, thisDate)) {
                                events.push({ text: '\uD83C\uDF82 ' + (person.firstName || person.nickname || '?') + ' ' + (person.lastName || ''), type: 'english-bday', badgeClass: 'cal-badge-english-bday' });
                            }
                        }
                        if (person.hebrewBirthDate) {
                            const hParsed = parseHebrewBirthdayString(person.hebrewBirthDate);
                            if (hParsed && matchesHebrewDate(hParsed, hDate)) {
                                events.push({ text: '\uD83C\uDF88 ' + (person.firstName || person.nickname || '?') + ' ' + (person.lastName || ''), type: 'hebrew-bday', badgeClass: 'cal-badge-hebrew-bday' });
                            }
                        }
                        if (person.englishYartzeit) {
                            const eyParsed = parseEnglishBirthdayString(person.englishYartzeit);
                            if (eyParsed && matchesEnglishDate(eyParsed, thisDate)) {
                                events.push({ text: '\uD83D\uDD6F\uFE0F ' + (person.firstName || person.nickname || '?') + ' ' + (person.lastName || '') + ' (Yahrzeit)', type: 'english-yahrzeit', badgeClass: 'cal-badge-english-yahrzeit' });
                            }
                        }
                        if (person.hebrewYartzeit) {
                            const hyParsed = parseHebrewBirthdayString(person.hebrewYartzeit);
                            if (hyParsed && matchesHebrewDate(hyParsed, hDate)) {
                                events.push({ text: '\uD83D\uDD6F\uFE0F ' + (person.firstName || person.nickname || '?') + ' ' + (person.lastName || '') + ' (Yahrzeit)', type: 'hebrew-yahrzeit', badgeClass: 'cal-badge-hebrew-yahrzeit' });
                            }
                        }
                    }
                    checkPerson(node.person);
                    if (node.spouse) checkPerson(node.spouse);
                });
            }

            const hebrewDayStr = formatHebrewDayName(hDate.day);
            td.innerHTML = '<div class="cal-day-header"><span class="cal-secular-date">' + currentDay + '</span><span class="cal-hebrew-date">' + hebrewDayStr + '</span></div><div class="cal-events-container">' + events.map(ev => '<span class="cal-event-tag ' + ev.badgeClass + '" title="' + escapeHtml(ev.text) + '">' + escapeHtml(ev.text) + '</span>').join('') + '</div>';
            weekRow.appendChild(td);
            currentDay++;
        }

        let nextMonthDay = 1;
        while (weekRow.children.length < 7 && weekRow.children.length > 0) {
            const td = document.createElement('td');
            td.className = 'cal-other-month';
            td.innerHTML = '<div class="cal-day-header"><span class="cal-secular-date">' + (nextMonthDay++) + '</span></div>';
            weekRow.appendChild(td);
        }
        if (weekRow.children.length > 0) tbody.appendChild(weekRow);
        container.appendChild(monthSheet);
    });

    updateStickyMonthHeader();
}

function updateStickyMonthHeader() {
    const container = document.getElementById('calendar-content-area');
    const leftTitleEl = document.getElementById('cal-sticky-left-title');
    const rightTitleEl = document.getElementById('cal-sticky-right-title');
    if (!container || !leftTitleEl || !rightTitleEl) return;
    const sheets = container.querySelectorAll('.calendar-month-sheet');
    if (!sheets || sheets.length === 0) return;
    const containerTop = container.getBoundingClientRect().top;
    let activeSheet = sheets[0];
    for (let i = 0; i < sheets.length; i++) {
        const rect = sheets[i].getBoundingClientRect();
        if (rect.bottom - containerTop > 80) { activeSheet = sheets[i]; break; }
    }
    if (activeSheet) {
        leftTitleEl.textContent = activeSheet.dataset.monthName || '';
        rightTitleEl.textContent = activeSheet.dataset.hebrewRange || '';
    }
}

function setupCalendarModal() {
    const btn = document.getElementById('calendar-btn');
    const modal = document.getElementById('calendar-modal');
    const overlay = document.getElementById('calendar-modal-overlay');
    const closeBtn = document.getElementById('calendar-modal-close');
    const dismissBtn = document.getElementById('calendar-modal-dismiss');
    const yearSelect = document.getElementById('cal-year-select');
    const viewSelect = document.getElementById('cal-view-select');
    const monthSelect = document.getElementById('cal-month-select');
    const monthContainer = document.getElementById('cal-month-select-container');
    const prevMonthBtn = document.getElementById('cal-prev-month');
    const nextMonthBtn = document.getElementById('cal-next-month');
    const printBtn = document.getElementById('cal-print-btn');
    const contentArea = document.getElementById('calendar-content-area');
    if (!btn || !modal) return;

    const curYear = new Date().getFullYear();
    yearSelect.innerHTML = '<option value="' + (curYear - 1) + '">' + (curYear - 1) + '</option><option value="' + curYear + '" selected>' + curYear + '</option><option value="' + (curYear + 1) + '">' + (curYear + 1) + '</option><option value="' + (curYear + 2) + '">' + (curYear + 2) + '</option>';
    monthSelect.value = new Date().getMonth();

    const openCalendar = e => {
        if (e) e.preventDefault();
        calendarState.year = parseInt(yearSelect.value, 10) || curYear;
        calendarState.monthIdx = parseInt(monthSelect.value, 10) || 0;
        calendarState.viewMode = viewSelect.value || 'year';
        renderCalendarEngine();
        modal.style.display = 'flex';
    };

    const hideCalendar = () => { modal.style.display = 'none'; };

    btn.addEventListener('click', openCalendar);
    btn.addEventListener('touchend', openCalendar, { passive: false });
    if (overlay) { overlay.addEventListener('click', hideCalendar); overlay.addEventListener('touchend', e => { e.preventDefault(); hideCalendar(); }, { passive: false }); }
    if (closeBtn) { closeBtn.addEventListener('click', hideCalendar); closeBtn.addEventListener('touchend', e => { e.preventDefault(); hideCalendar(); }, { passive: false }); }
    if (dismissBtn) { dismissBtn.addEventListener('click', hideCalendar); dismissBtn.addEventListener('touchend', e => { e.preventDefault(); hideCalendar(); }, { passive: false }); }
    if (contentArea) contentArea.addEventListener('scroll', () => updateStickyMonthHeader());

    yearSelect.addEventListener('change', () => { calendarState.year = parseInt(yearSelect.value, 10); renderCalendarEngine(); });
    viewSelect.addEventListener('change', () => {
        calendarState.viewMode = viewSelect.value;
        if (monthContainer) monthContainer.style.display = calendarState.viewMode === 'month' ? 'flex' : 'none';
        renderCalendarEngine();
    });
    monthSelect.addEventListener('change', () => { calendarState.monthIdx = parseInt(monthSelect.value, 10); renderCalendarEngine(); });
    if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => {
        if (calendarState.monthIdx > 0) calendarState.monthIdx--;
        else { calendarState.monthIdx = 11; calendarState.year--; yearSelect.value = calendarState.year; }
        monthSelect.value = calendarState.monthIdx;
        renderCalendarEngine();
    });
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => {
        if (calendarState.monthIdx < 11) calendarState.monthIdx++;
        else { calendarState.monthIdx = 0; calendarState.year++; yearSelect.value = calendarState.year; }
        monthSelect.value = calendarState.monthIdx;
        renderCalendarEngine();
    });

    const printThemeSelect = document.getElementById('cal-print-theme-select');
    if (printBtn) printBtn.addEventListener('click', () => {
        const selectedTheme = printThemeSelect ? printThemeSelect.value : 'light';
        document.body.classList.remove('print-theme-bw', 'print-theme-dark');
        if (selectedTheme === 'bw') document.body.classList.add('print-theme-bw');
        else if (selectedTheme === 'dark') document.body.classList.add('print-theme-dark');
        window.print();
        setTimeout(() => document.body.classList.remove('print-theme-bw', 'print-theme-dark'), 1000);
    });
}

// ============================================
// B"H COUNTER MODAL
// ============================================

function showBHModal() {
    const modal = document.getElementById('bh-modal');
    if (modal) modal.style.display = 'flex';
}

function updateAllCounts() {
    const totalStatEl = document.getElementById('stat-total-number');
    if (totalStatEl) {
        if (isCountRevealed) animateNumber('stat-total-number', totalMemberCount);
        else totalStatEl.textContent = 'B"H';
    }
    document.querySelectorAll('.child-count').forEach(btn => {
        const count = btn.dataset.count;
        if (!count) return;
        const plural = count !== '1' ? 's' : '';
        if (isCountRevealed) { btn.textContent = count + ' descendant' + plural; btn.classList.add('revealed'); }
        else { btn.textContent = 'B"H descendant' + plural; btn.classList.remove('revealed'); }
    });
    document.querySelectorAll('.branch-number').forEach(el => {
        const rawNum = el.dataset.number;
        if (isCountRevealed) el.textContent = rawNum || '•';
        else el.textContent = '•';
    });
}

function setupBHPrompt() {
    const statTotal = document.getElementById('stat-total');
    const modal = document.getElementById('bh-modal');
    const overlay = document.getElementById('bh-modal-overlay');
    const closeBtn = document.getElementById('bh-modal-close');
    const keepBlessedBtn = document.getElementById('bh-keep-blessed-btn');
    const revealBtn = document.getElementById('bh-reveal-btn');
    if (statTotal) statTotal.addEventListener('click', showBHModal);
    const hideBHModal = () => { if (modal) modal.style.display = 'none'; };
    if (overlay) overlay.addEventListener('click', hideBHModal);
    if (closeBtn) closeBtn.addEventListener('click', hideBHModal);
    if (keepBlessedBtn) keepBlessedBtn.addEventListener('click', () => { isCountRevealed = false; updateAllCounts(); hideBHModal(); });
    if (revealBtn) revealBtn.addEventListener('click', () => { isCountRevealed = true; updateAllCounts(); hideBHModal(); });
}

// ============================================
// ADD MEMBER MODAL
// ============================================

function setupAddMemberModal() {
    const addBtn = document.getElementById('add-member-btn');
    const modal = document.getElementById('add-member-modal');
    const overlay = document.getElementById('add-modal-overlay');
    const closeBtn = document.getElementById('add-modal-close');
    const cancelBtn = document.getElementById('add-modal-cancel');
    const form = document.getElementById('add-member-form');
    const addTypeSelect = document.getElementById('add-type');
    const parentSearch = document.getElementById('parent-search');
    const parentDropdown = document.getElementById('parent-search-dropdown');
    const parentHidden = document.getElementById('parent-select-value');
    const parentDisplay = document.getElementById('parent-selected-display');
    const parentSelectLabel = document.getElementById('parent-select-label');
    const resultBox = document.getElementById('add-result-box');
    const doneBtn = document.getElementById('add-result-done');
    const submitStatus = document.getElementById('submit-status');
    const spouseOnlyFields = document.querySelectorAll('.spouse-only-field');
    const bdayMonth = document.getElementById('bday-month');
    const bdayDay = document.getElementById('bday-day');
    const bdayYear = document.getElementById('bday-year');
    const bdayHebrewDay = document.getElementById('bday-hebrew-day');
    const bdayHebrewMonth = document.getElementById('bday-hebrew-month');

    if (!addBtn || !modal) return;

    if (bdayDay && bdayDay.options.length <= 1) { for (let d = 1; d <= 31; d++) { const opt = document.createElement('option'); opt.value = d; opt.textContent = d; bdayDay.appendChild(opt); } }
    if (bdayYear && bdayYear.options.length <= 1) { const cy = new Date().getFullYear(); for (let y = cy; y >= 1920; y--) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; bdayYear.appendChild(opt); } }

    function getBirthdayString() {
        if (!bdayMonth || !bdayDay) return '';
        const m = bdayMonth.value, d = bdayDay.value, y = bdayYear ? bdayYear.value : '';
        if (!m && !d && !y) return '';
        let parts = [];
        if (m) parts.push(m);
        if (d) parts.push(d + ',');
        if (y) parts.push(y);
        return parts.join(' ').replace(/, ?$/, '');
    }

    function getHebrewBirthdayString() {
        if (!bdayHebrewDay || !bdayHebrewMonth) return '';
        const dVal = bdayHebrewDay.value, mVal = bdayHebrewMonth.value;
        if (!dVal && !mVal) return '';
        const dText = dVal ? formatHebrewDayName(parseHebrewBirthdayString(dVal + ' ' + (mVal || '\u05EA\u05E9\u05E8\u05D9'))?.day || 1) : '';
        return [dText, mVal].filter(Boolean).join(' ');
    }

    function updateFieldVisibility() {
        const isSpouse = addTypeSelect.value === 'spouse';
        spouseOnlyFields.forEach(el => { if (isSpouse) el.classList.remove('hidden'); else el.classList.add('hidden'); });
    }

    let parentOptions = [];

    function buildParentOptions() {
        const allNodes = getAllNodes(currentTreeData);
        parentOptions = [];
        const isSpouse = addTypeSelect.value === 'spouse';
        parentSelectLabel.textContent = isSpouse ? 'Who are they joining?' : 'Select Parent(s):';
        allNodes.forEach((node, idx) => {
            if (isSpouse) {
                if (!node.spouse) parentOptions.push({ idx, label: node.person.displayName, node });
            } else {
                let label = node.person.displayName;
                if (node.spouse) label += ' & ' + node.spouse.displayName;
                parentOptions.push({ idx, label, node });
            }
        });
    }

    function renderDropdown(query) {
        parentDropdown.innerHTML = '';
        const q = (query || '').toLowerCase().trim();
        const filtered = q ? parentOptions.filter(o => o.label.toLowerCase().includes(q)) : parentOptions;
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ps-option';
            empty.textContent = q ? 'No matches found' : 'No members available';
            empty.style.opacity = '0.5';
            empty.style.cursor = 'default';
            parentDropdown.appendChild(empty);
        } else {
            filtered.forEach(opt => {
                const div = document.createElement('div');
                div.className = 'ps-option';
                div.textContent = opt.label;
                div.addEventListener('mousedown', e => { e.preventDefault(); selectParent(opt); });
                parentDropdown.appendChild(div);
            });
        }
        parentDropdown.style.display = 'block';
    }

    function selectParent(opt) {
        parentHidden.value = opt.idx;
        parentSearch.value = '';
        parentDropdown.style.display = 'none';
        parentDisplay.innerHTML = '<span>' + opt.label + '</span><span class="ps-clear" title="Clear selection">\u2715</span>';
        parentDisplay.style.display = 'inline-flex';
        parentSearch.style.display = 'none';
        parentDisplay.querySelector('.ps-clear').addEventListener('click', clearSelection);
    }

    function clearSelection() {
        parentHidden.value = '';
        parentDisplay.style.display = 'none';
        parentSearch.style.display = '';
        parentSearch.value = '';
        parentSearch.focus();
    }

    function showStatus(msg, type) {
        submitStatus.textContent = msg;
        submitStatus.className = 'submit-status ' + type;
        submitStatus.style.display = 'block';
    }
    function hideStatus() { submitStatus.style.display = 'none'; }

    function openModal() {
        if (!currentTreeData) return;
        buildParentOptions();
        clearSelection();
        updateFieldVisibility();
        hideStatus();
        form.style.display = 'flex';
        resultBox.style.display = 'none';
        modal.style.display = 'flex';
    }

    function closeModal() {
        modal.style.display = 'none';
        form.reset();
        parentDropdown.style.display = 'none';
        clearSelection();
        hideStatus();
    }

    addBtn.addEventListener('click', openModal);
    if (overlay) overlay.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);
    addTypeSelect.addEventListener('change', () => { buildParentOptions(); clearSelection(); updateFieldVisibility(); });
    parentSearch.addEventListener('focus', () => renderDropdown(parentSearch.value));
    parentSearch.addEventListener('input', () => renderDropdown(parentSearch.value));
    parentSearch.addEventListener('blur', () => { setTimeout(() => { parentDropdown.style.display = 'none'; }, 150); });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const addType = addTypeSelect.value;
        const allNodes = getAllNodes(currentTreeData);
        const selectedIdx = parentHidden.value;
        if (selectedIdx === '' || !allNodes[selectedIdx]) return;
        const targetNode = allNodes[selectedIdx];
        const firstName = document.getElementById('new-first-name').value.trim();
        const middleName = document.getElementById('new-middle-name') ? document.getElementById('new-middle-name').value.trim() : '';
        const nickname = document.getElementById('new-nickname') ? document.getElementById('new-nickname').value.trim() : '';
        const hebrewName = document.getElementById('new-hebrew-name') ? document.getElementById('new-hebrew-name').value.trim() : '';
        const lastName = (addType === 'spouse') ? (document.getElementById('new-last-name') ? document.getElementById('new-last-name').value.trim() : '') : '';
        const birthday = getBirthdayString();
        const hebrewBirthday = getHebrewBirthdayString();
        const email = (addType === 'spouse') ? (document.getElementById('new-email') ? document.getElementById('new-email').value.trim() : '') : '';
        const address = (addType === 'spouse') ? (document.getElementById('new-address') ? document.getElementById('new-address').value.trim() : '') : '';

        const parentLastName = targetNode.person.lastName || '';
        const finalLastName = lastName || parentLastName;

        let csvRow = '';

        if (addType === 'spouse') {
            const newPlacement = targetNode.placement + '+';
            targetNode.spouse = {
                placement: newPlacement,
                lastName: finalLastName,
                maidenName: lastName,
                firstName: firstName,
                middleName: middleName,
                hebrewName: hebrewName,
                nickname: nickname,
                hebrewBirthDate: hebrewBirthday,
                englishBirthDate: birthday,
                hebrewYartzeit: '',
                englishYartzeit: '',
                address: address,
                email: email,
                displayName: buildDisplayName({ firstName, middleName, hebrewName, nickname })
            };
            csvRow = [newPlacement, finalLastName, lastName, firstName, middleName, hebrewName, nickname, hebrewBirthday, birthday, '', '', address, email].join(',');
        } else {
            const existingChildren = targetNode.children ? targetNode.children.length : 0;
            const childNum = existingChildren + 1;
            const newPlacement = targetNode.placement + '.' + childNum;
            const newNode = {
                person: {
                    placement: newPlacement,
                    lastName: finalLastName,
                    maidenName: '',
                    firstName: firstName,
                    middleName: middleName,
                    hebrewName: hebrewName,
                    nickname: nickname,
                    hebrewBirthDate: hebrewBirthday,
                    englishBirthDate: birthday,
                    hebrewYartzeit: '',
                    englishYartzeit: '',
                    address: '',
                    email: '',
                    displayName: buildDisplayName({ firstName, middleName, hebrewName, nickname })
                },
                spouse: null,
                children: [],
                placement: newPlacement
            };
            if (!targetNode.children) targetNode.children = [];
            targetNode.children.push(newNode);
            csvRow = [newPlacement, finalLastName, '', firstName, middleName, hebrewName, nickname, hebrewBirthday, birthday, '', '', '', ''].join(',');
        }

        renderTree(currentTreeData);

        document.getElementById('result-csv-text').value = csvRow;
        form.style.display = 'none';
        resultBox.style.display = 'flex';

        if (APPS_SCRIPT_URL) {
            const payload = {
                placement: addType === 'spouse' ? targetNode.placement + '+' : targetNode.placement + '.' + ((targetNode.children ? targetNode.children.length : 0)),
                lastName: addType === 'spouse' ? finalLastName : finalLastName,
                maidenName: addType === 'spouse' ? lastName : '',
                firstName: firstName,
                middleName: middleName,
                hebrewName: hebrewName,
                nickname: nickname,
                hebrewBirthDate: hebrewBirthday,
                englishBirthDate: birthday,
                hebrewYartzeit: '',
                englishYartzeit: '',
                address: address,
                email: email
            };
            fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            }).then(() => {
                console.log('Saved to Google Spreadsheet via Apps Script.');
            }).catch(err => {
                console.error('Apps Script POST error:', err);
            });
        }
    });

    const copyCsvBtn = document.getElementById('copy-csv-btn');
    if (copyCsvBtn) {
        copyCsvBtn.addEventListener('click', () => {
            const textarea = document.getElementById('result-csv-text');
            if (textarea) {
                textarea.select();
                navigator.clipboard.writeText(textarea.value);
                const orig = copyCsvBtn.textContent;
                copyCsvBtn.textContent = 'Copied!';
                setTimeout(() => { copyCsvBtn.textContent = orig; }, 1500);
            }
        });
    }
}

// ============================================
// DATA LOADING
// ============================================

async function fetchWithProxy(url, proxyFn) {
    const proxyUrl = proxyFn(url);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
}

async function loadFamilyTree() {
    const loading = document.getElementById('loading');
    const errorEl = document.getElementById('error-message');
    const treeRoot = document.getElementById('tree-root');

    isCountRevealed = false;
    const totalStatEl = document.getElementById('stat-total-number');
    if (totalStatEl) totalStatEl.textContent = 'B"H';

    loading.style.display = 'flex';
    errorEl.style.display = 'none';
    treeRoot.innerHTML = '';

    let csvText = null;
    let lastError = null;

    for (const proxyFn of CORS_PROXIES) {
        try {
            csvText = await fetchWithProxy(SPREADSHEET_CSV_URL, proxyFn);
            if (csvText && csvText.includes('Rosensweig')) break;
            csvText = null;
        } catch (e) {
            lastError = e;
            csvText = null;
        }
    }

    if (!csvText && typeof EMBEDDED_CSV !== 'undefined') {
        console.warn('Could not fetch live data, using embedded copy.');
        csvText = EMBEDDED_CSV;
    }

    loading.style.display = 'none';

    if (!csvText) {
        errorEl.style.display = 'block';
        document.getElementById('error-text').textContent = 'Unable to load the family tree data. Please check your internet connection and try again.';
        console.error('Could not fetch live data. Last error:', lastError);
        return;
    }

    loading.style.display = 'none';

    try {
        parsedRows = processFamilyCSV(csvText);
        const tree = buildTree(parsedRows);
        if (!tree) throw new Error('Could not build tree from data');
        currentTreeData = tree;
        renderTree(tree);

        const now = new Date();
        document.getElementById('last-refresh').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const topBranches = treeRoot.querySelectorAll('.branches > .branch-container > .branch-header');
        topBranches.forEach(header => {
            const content = header.nextElementSibling;
            header.classList.add('expanded');
            header.setAttribute('aria-expanded', 'true');
            if (content) content.classList.add('expanded');
        });

        renderBirthdayPopup(false);
    } catch (e) {
        console.error('Parse error:', e);
        errorEl.style.display = 'block';
        document.getElementById('error-text').textContent = 'Error parsing family tree data: ' + e.message;
    }
}

// ============================================
// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupControls();
    setupSearch();
    setupContactModal();
    setupPersonBirthdayModal();
    setupBHPrompt();
    setupBirthdayPopup();
    setupCalendarModal();
    setupAddMemberModal();
    loadFamilyTree();
});
