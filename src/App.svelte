<script>
    export let name;

    let sidebarExpanded = true;
    let isDarkTheme = false;
    let selectedTab = 'global';

    // Load theme preference from localStorage on component initialization
    if (typeof localStorage !== 'undefined') {
        const savedTheme = localStorage.getItem('isDarkTheme');
        if (savedTheme !== null) {
            isDarkTheme = JSON.parse(savedTheme);
        }
    }

    const tabs = [
        {id: 'follows', icon: '👥', label: 'follows'},
        {id: 'global', icon: '🌍', label: 'global'},
        {id: 'write', icon: '✏️', label: 'write'}
    ];

    function toggleSidebar() {
        sidebarExpanded = !sidebarExpanded;
    }

    function toggleTheme() {
        isDarkTheme = !isDarkTheme;
        // Save theme preference to localStorage
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('isDarkTheme', JSON.stringify(isDarkTheme));
        }
    }

    function selectTab(tabId) {
        selectedTab = tabId;
    }

    $: selectedTabData = tabs.find(tab => tab.id === selectedTab);

    $: if (typeof document !== 'undefined') {
        if (isDarkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }
</script>

<!-- Header -->
<header class="main-header" class:dark-theme={isDarkTheme}>
    <div class="header-content">
        <img src="/orly.png" alt="Orly Logo" class="logo"/>
        <div class="tab-label-area">
            <span class="selected-tab-label">{selectedTabData.label}</span>
        </div>
        <button class="theme-toggle-btn" on:click={toggleTheme}>
            {isDarkTheme ? '☀️' : '🌙'}
        </button>
        <button class="login-btn">📥</button>
    </div>
</header>

<!-- Main Content Area -->
<div class="app-container" class:dark-theme={isDarkTheme}>
    <!-- Sidebar -->
    <aside class="sidebar" class:collapsed={!sidebarExpanded}
           class:dark-theme={isDarkTheme}>
        <div class="sidebar-content">
            <div class="tabs">
                {#each tabs as tab}
                    <div class="tab" class:active={selectedTab === tab.id}
                         on:click={() => selectTab(tab.id)}>
                        <span class="tab-icon">{tab.icon}</span>
                        {#if sidebarExpanded}<span
                                class="tab-label">{tab.label}</span>{/if}
                    </div>
                {/each}
            </div>
            <button class="toggle-btn" on:click={toggleSidebar}>
                {sidebarExpanded ? '◀' : '▶'}
            </button>
        </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
        <h1>Hello {name}!</h1>
    </main>
</div>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        --bg-color: #eeeeee;
        --header-bg: #eeeeee;
        --border-color: #dee2e6;
        --text-color: #444444;
        --sidebar-bg: #eeeeee;
        --tab-hover-bg: #ddd;
        --input-border: #ccc;
        --button-bg: #f8f9fa;
        --button-hover-bg: #ddd;
        --primary: #00BCD4;
    }

    :global(body.dark-theme) {
        --bg-color: #1e272c;
        --header-bg: #1e272c;
        --border-color: #404040;
        --text-color: #ffffff;
        --sidebar-bg: #1e272c;
        --tab-hover-bg: #263238;
        --input-border: #555;
        --button-bg: #263238;
        --button-hover-bg: #1e272c;
        --primary: #00BCD4;
    }

    /* Header Styles */
    .main-header {
        height: 2.5em;
        background-color: var(--header-bg);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        color: var(--text-color);
    }

    .header-content {
        height: 100%;
        display: flex;
        align-items: center;
        padding: 0.25em 0 0 0;
        gap: 0;
    }

    .logo {
        height: 2.5em;
        width: 2.5em;
        object-fit: contain;
        flex-shrink: 0;
    }

    .tab-label-area {
        flex: 1;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 0;
        padding: 0 1rem;
    }

    .selected-tab-icon {
        font-size: 1.2em;
        flex-shrink: 0;
    }

    .selected-tab-label {
        font-size: 1em;
        font-weight: 600;
        text-transform: capitalize;
        color: var(--text-color);
    }

    .theme-toggle-btn {
        padding: 0;
        border: none;
        background-color: var(--button-bg);
        cursor: pointer;
        flex-shrink: 0;
        font-size: 0.8em;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-color);
        height: 3em;
        width: 2.5em;
        line-height: 1;
    }

    .theme-toggle-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .login-btn {
        padding: 0;
        border: none;
        background-color: var(--primary);
        color: white;
        cursor: pointer;
        flex-shrink: 0;
        height: 2.5em;
        width: 2.5em;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1em;
        line-height: 1em;
    }

    .login-btn:hover {
        background-color: #0056b3;
    }

    /* App Container */
    .app-container {
        display: flex;
        margin-top: 2.5em;
        height: calc(100vh - 2.5em);
    }

    /* Sidebar Styles */
    .sidebar {
        width: 140px;
        background-color: var(--sidebar-bg);
        transition: width 0.3s ease;
        overflow: hidden;
        color: var(--text-color);
    }

    .sidebar.collapsed {
        width: 60px;
    }

    .sidebar-content {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 1rem 0;
    }

    .tabs {
        flex: 1;
    }

    .tab {
        height: 2.5em;
        display: flex;
        align-items: center;
        padding: 0 1rem;
        cursor: pointer;
        transition: background-color 0.2s ease;
        margin-bottom: 0.5em;
        gap: 0.75rem;
    }

    .tab:hover {
        background-color: var(--tab-hover-bg);
    }

    .tab.active {
        background-color: var(--tab-hover-bg);
        border-left: 3px solid var(--primary);
    }

    .tab-icon {
        font-size: 1.2em;
        flex-shrink: 0;
        width: 1.5em;
        text-align: center;
    }

    .tab-label {
        font-size: 0.9em;
        font-weight: 500;
        white-space: nowrap;
    }

    .toggle-btn {
        height: 2.5em;
        margin: 0;
        background-color: var(--bg-color);
        cursor: pointer;
        transition: background-color 0.2s ease;
        color: var(--text-color);
    }

    .toggle-btn:hover {
        background-color: var(--button-hover-bg);
        padding: 0;
    }

    /* Main Content */
    .main-content {
        flex: 1;
        padding: 2rem;
        overflow-y: auto;
        background-color: var(--bg-color);
        color: var(--text-color);
    }

    .main-content h1 {
        color: #ff3e00;
        text-transform: uppercase;
        font-size: 4em;
        font-weight: 100;
        text-align: center;
    }

    @media (max-width: 640px) {
        .header-content {
            padding: 0 0.5rem;
            gap: 0.5rem;
        }

        .text-area textarea {
            font-size: 0.8em;
        }

        .sidebar {
            width: 120px;
        }

        .sidebar.collapsed {
            width: 50px;
        }

        .main-content {
            padding: 1rem;
        }

        .main-content h1 {
            font-size: 2.5em;
        }
    }
</style>